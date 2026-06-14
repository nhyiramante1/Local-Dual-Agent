import type { AgentResult } from "../core/domain.js";
import { DuetError } from "../core/errors.js";
import { parseJsonLines } from "../core/json.js";
import { appRoot, codexHomePath } from "../paths.js";
import { runCommand } from "../process/run-command.js";
import type {
  AgentTurn,
  ProviderAdapter,
} from "./adapter.js";
import { resolveCodexCommand } from "./commands.js";
import { sanitizedAgentEnvironment } from "./environment.js";

interface CodexEvent {
  type?: string;
  thread_id?: string;
  item?: {
    type?: string;
    text?: string;
  };
  usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
  };
  error?: {
    message?: string;
  };
  message?: string;
}

export class CodexAdapter implements ProviderAdapter {
  readonly name = "codex" as const;

  async run(turn: AgentTurn): Promise<AgentResult> {
    const command = await resolveCodexCommand(appRoot());
    const args = [...command.argsPrefix, ...buildCodexArgs(turn)];

    const result = await runCommand(command.command, args, {
      cwd: turn.cwd,
      env: sanitizedAgentEnvironment({ CODEX_HOME: codexHomePath() }),
      timeoutMs: turn.timeoutMs,
      onStart: turn.onStart,
      onStdout: turn.onStdout,
      onStderr: turn.onStderr,
      onHeartbeat: turn.onHeartbeat,
      shouldCancel: turn.shouldCancel,
    });
    const events = parseJsonLines(result.stdout) as CodexEvent[];
    const sessionId = events.find(
      (event) => event.type === "thread.started",
    )?.thread_id ?? turn.sessionId;
    const finalText = [...events]
      .reverse()
      .find(
        (event) =>
          event.type === "item.completed" &&
          event.item?.type === "agent_message",
      )?.item?.text;
    const completion = [...events]
      .reverse()
      .find((event) => event.type === "turn.completed");
    const failure = [...events]
      .reverse()
      .find(
        (event) => event.type === "turn.failed" || event.type === "error",
      );

    if (
      result.exitCode !== 0 ||
      !sessionId ||
      !completion ||
      finalText === undefined
    ) {
      throw new DuetError(
        failure?.error?.message ||
          failure?.message ||
          result.stderr.trim() ||
          `Codex failed with exit code ${result.exitCode}.`,
        result.timedOut ? "AGENT_TIMEOUT" : "CODEX_FAILED",
      );
    }

    return {
      provider: "codex",
      sessionId,
      finalText,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      usage: {
        inputTokens: completion.usage?.input_tokens,
        cachedInputTokens: completion.usage?.cached_input_tokens,
        outputTokens: completion.usage?.output_tokens,
        reasoningOutputTokens: completion.usage?.reasoning_output_tokens,
        costKnown: false,
      },
    };
  }
}

export function buildCodexArgs(turn: AgentTurn): string[] {
  if (turn.sessionId) {
    return [
      "exec",
      "resume",
      "--json",
      "--ignore-user-config",
      "--ignore-rules",
      "-c",
      `sandbox_mode="${turn.mode}"`,
      "-c",
      'approval_policy="never"',
      turn.sessionId,
      turn.prompt,
    ];
  }
  return [
    "exec",
    "--json",
    "--sandbox",
    turn.mode,
    "--ignore-user-config",
    "--ignore-rules",
    "-c",
    'approval_policy="never"',
    "--cd",
    turn.cwd,
    turn.prompt,
  ];
}
