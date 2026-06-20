import type { AgentResult } from "../core/domain.js";
import { DuetError } from "../core/errors.js";
import { parseJsonLines } from "../core/json.js";
import { runCommand } from "../process/run-command.js";
import { resolveClaudeCommand } from "./commands.js";
import { sanitizedAgentEnvironment } from "./environment.js";
import type {
  AgentTurn,
  ProviderAdapter,
} from "./adapter.js";
import { CLAUDE_EFFORT, CLAUDE_MODELS } from "./profiles.js";

interface ClaudeResultEvent {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
}

export class ClaudeAdapter implements ProviderAdapter {
  readonly name = "claude" as const;

  async run(turn: AgentTurn): Promise<AgentResult> {
    const command = await resolveClaudeCommand();
    const tools =
      turn.mode === "read-only"
        ? "Read,Glob,Grep"
        : "Read,Glob,Grep,Edit,Write";
    const args = [
      ...command.argsPrefix,
      "--print",
      "--verbose",
      "--output-format",
      "stream-json",
      "--permission-mode",
      "dontAsk",
      "--tools",
      tools,
      "--setting-sources",
      "user",
      "--disable-slash-commands",
      "--no-chrome",
      "--max-budget-usd",
      String(turn.maxBudgetUsd ?? 0.75),
    ];
    if (turn.sessionId) {
      args.push("--resume", turn.sessionId);
    }
    const model = CLAUDE_MODELS[turn.profile ?? "balanced"];
    if (model) args.push("--model", model);
    const effort = CLAUDE_EFFORT[turn.profile ?? "balanced"];
    if (effort) args.push("--effort", effort);
    args.push(turn.prompt);

    const result = await runCommand(command.command, args, {
      cwd: turn.cwd,
      env: sanitizedAgentEnvironment(),
      timeoutMs: turn.timeoutMs,
      onStart: turn.onStart,
      onStdout: turn.onStdout,
      onStderr: turn.onStderr,
      onHeartbeat: turn.onHeartbeat,
      shouldCancel: turn.shouldCancel,
    });
    const events = parseJsonLines(result.stdout) as ClaudeResultEvent[];
    const completion = [...events]
      .reverse()
      .find((event) => event.type === "result");
    if (
      result.exitCode !== 0 ||
      !completion ||
      completion.subtype !== "success" ||
      completion.is_error !== false ||
      !completion.session_id
    ) {
      throw new DuetError(
        result.stderr.trim() ||
          completion?.result ||
          `Claude failed with exit code ${result.exitCode}.`,
        result.timedOut ? "AGENT_TIMEOUT" : "CLAUDE_FAILED",
      );
    }

    return {
      provider: "claude",
      sessionId: completion.session_id,
      finalText: completion.result ?? "",
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      usage: {
        inputTokens: completion.usage?.input_tokens,
        cachedInputTokens: completion.usage?.cache_read_input_tokens,
        outputTokens: completion.usage?.output_tokens,
        costUsd: completion.total_cost_usd,
        costKnown: completion.total_cost_usd !== undefined,
      },
    };
  }
}
