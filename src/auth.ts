import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { appRoot, codexHomePath } from "./paths.js";
import { resolveCodexCommand } from "./providers/commands.js";

export async function loginCodex(cwd: string): Promise<number> {
  const projectRoot = appRoot();
  const codexHome = codexHomePath();
  await mkdir(codexHome, { recursive: true });

  const command = await resolveCodexCommand(projectRoot);
  console.log(`Using isolated Codex credentials at ${codexHome}`);

  return await new Promise((resolve, reject) => {
    const child = spawn(
      command.command,
      [...command.argsPrefix, "login"],
      {
        cwd: path.resolve(cwd),
        env: { ...process.env, CODEX_HOME: codexHome },
        shell: false,
        windowsHide: false,
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("close", (exitCode) => resolve(exitCode ?? 1));
  });
}
