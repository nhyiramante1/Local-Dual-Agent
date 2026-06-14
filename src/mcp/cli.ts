import { DuetError } from "../core/errors.js";
import {
  installMcp,
  mcpStatus,
  uninstallMcp,
  type McpTarget,
} from "./install.js";

function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function targets(value: string | undefined): McpTarget[] {
  if (value === "all") return ["claude", "codex"];
  if (value === "claude" || value === "codex") return [value];
  throw new DuetError(
    "MCP target must be claude, codex, or all.",
    "INVALID_ARGUMENT",
  );
}

export async function mcpCli(args: string[]): Promise<void> {
  const action = args.shift();
  const selected = targets(args.shift());
  const force = takeFlag(args, "--force");
  if (
    !action ||
    !["install", "status", "uninstall"].includes(action) ||
    args.length > 0 ||
    (force && action === "status")
  ) {
    throw new DuetError(
      "Usage: duet mcp install|status|uninstall claude|codex|all [--force]",
      "INVALID_ARGUMENT",
    );
  }
  for (const target of selected) {
    const result =
      action === "install"
        ? await installMcp(target, { force })
        : action === "uninstall"
          ? await uninstallMcp(target, { force })
          : await mcpStatus(target);
    console.log(`${result.target}: ${result.state} - ${result.detail}`);
  }
}
