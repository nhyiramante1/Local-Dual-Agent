import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  claudeMcpStatus,
  codexMcpStatus,
  installClaudeMcp,
  installCodexMcp,
  uninstallClaudeMcp,
  uninstallCodexMcp,
  type CommandRunner,
} from "../src/mcp/install.js";

test("Claude MCP install, status and uninstall are idempotent with spaced paths", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-claude-mcp-"));
  const nodePath = path.join(directory, "Node Runtime", "node.exe");
  const entryPath = path.join(directory, "Duet App", "duet-mcp.js");
  await mkdir(path.dirname(nodePath), { recursive: true });
  await mkdir(path.dirname(entryPath), { recursive: true });
  await writeFile(nodePath, "");
  await writeFile(entryPath, "");
  let installed:
    | { nodePath: string; entryPath: string }
    | undefined;
  const calls: string[][] = [];
  const runner: CommandRunner = async (_command, args) => {
    calls.push(args);
    if (args[1] === "get") {
      return installed
        ? {
            exitCode: 0,
            stdout: `Command: ${installed.nodePath}\nArgs: ${installed.entryPath}`,
            stderr: "",
          }
        : { exitCode: 1, stdout: "", stderr: "not found" };
    }
    if (args[1] === "add") {
      const separator = args.indexOf("--");
      installed = {
        nodePath: args[separator + 1],
        entryPath: args[separator + 2],
      };
      return { exitCode: 0, stdout: "added", stderr: "" };
    }
    if (args[1] === "remove") {
      installed = undefined;
      return { exitCode: 0, stdout: "removed", stderr: "" };
    }
    throw new Error(`Unexpected Claude args: ${args.join(" ")}`);
  };
  const options = {
    nodePath,
    entryPath,
    claudeCommand: "claude-stub",
    runner,
  };
  try {
    assert.equal((await claudeMcpStatus(options)).state, "missing");
    assert.equal((await installClaudeMcp(options)).state, "installed");
    assert.deepEqual(installed, {
      nodePath: path.resolve(nodePath),
      entryPath: path.resolve(entryPath),
    });
    const adds = calls.filter((args) => args[1] === "add").length;
    assert.equal((await installClaudeMcp(options)).state, "installed");
    assert.equal(
      calls.filter((args) => args[1] === "add").length,
      adds,
      "second install must not invoke add again",
    );
    assert.equal((await uninstallClaudeMcp(options)).state, "missing");
    assert.equal((await uninstallClaudeMcp(options)).state, "missing");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Codex managed block preserves unrelated TOML and comments", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-codex-mcp-"));
  const configPath = path.join(directory, "Codex Home", "config.toml");
  const nodePath = path.join(directory, "Node Runtime", "node.exe");
  const entryPath = path.join(directory, "Duet App", "duet-mcp.js");
  await mkdir(path.dirname(nodePath), { recursive: true });
  await mkdir(path.dirname(entryPath), { recursive: true });
  await writeFile(nodePath, "");
  await writeFile(entryPath, "");
  await writeFile(
    configPath,
    [
      "# preserve this comment",
      'model = "gpt-test"',
      "",
      "[mcp_servers.other]",
      'command = "other"',
      "# preserve trailing comment",
      "",
    ].join("\n"),
    { encoding: "utf8", flag: "w" },
  ).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      [
        "# preserve this comment",
        'model = "gpt-test"',
        "",
        "[mcp_servers.other]",
        'command = "other"',
        "# preserve trailing comment",
        "",
      ].join("\n"),
    );
  });
  const options = { configPath, codexConfigPath: configPath, nodePath, entryPath };
  try {
    assert.equal((await codexMcpStatus(options)).state, "missing");
    assert.equal((await installCodexMcp(options)).state, "installed");
    const installed = await readFile(configPath, "utf8");
    assert.match(installed, /# preserve this comment/);
    assert.match(installed, /# preserve trailing comment/);
    assert.match(installed, /\[mcp_servers\.other]/);
    assert.match(installed, /\[mcp_servers\.duet]/);
    assert.match(
      installed,
      /\[mcp_servers\.duet\.tools\.duet_create_plan]\r?\napproval_mode = "prompt"/,
    );
    assert.match(
      installed,
      /\[mcp_servers\.duet\.tools\.duet_list_runs]\r?\napproval_mode = "approve"/,
    );
    assert.equal((await codexMcpStatus(options)).state, "installed");
    await installCodexMcp(options);
    assert.equal(await readFile(configPath, "utf8"), installed);

    assert.equal((await uninstallCodexMcp(options)).state, "missing");
    const removed = await readFile(configPath, "utf8");
    assert.match(removed, /# preserve this comment/);
    assert.match(removed, /\[mcp_servers\.other]/);
    assert.doesNotMatch(removed, /mcp_servers\.duet/);
    assert.equal((await uninstallCodexMcp(options)).state, "missing");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Codex refuses unmanaged duet config and backs it up before forced replacement", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-codex-force-"));
  const configPath = path.join(directory, "config.toml");
  const nodePath = path.join(directory, "node.exe");
  const entryPath = path.join(directory, "duet-mcp.js");
  await writeFile(nodePath, "");
  await writeFile(entryPath, "");
  await writeFile(
    configPath,
    [
      "# unrelated",
      "[mcp_servers.duet]",
      'command = "someone-else"',
      'args = ["server.js"]',
      "",
      "[mcp_servers.keep]",
      'command = "keep"',
      "",
    ].join("\n"),
  );
  const options = {
    codexConfigPath: configPath,
    nodePath,
    entryPath,
    now: () => new Date("2026-01-02T03:04:05.000Z"),
  };
  try {
    assert.equal((await codexMcpStatus(options)).state, "unmanaged");
    await assert.rejects(
      installCodexMcp(options),
      /unmanaged mcp_servers\.duet/,
    );
    await installCodexMcp({ ...options, force: true });
    const updated = await readFile(configPath, "utf8");
    assert.match(updated, /\[mcp_servers\.keep]/);
    assert.match(updated, /BEGIN DUET MCP/);
    const files = await readdir(directory);
    assert.ok(
      files.some((file) =>
        file.includes("config.toml.duet-backup-2026-01-02T03-04-05-000Z"),
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Codex detects and replaces alternate unmanaged duet TOML forms", async () => {
  const variants = [
    [
      'mcp_servers.duet = { command = "inline", args = ["server.js"] }',
      'keep = "root"',
      "",
    ].join("\n"),
    [
      "[mcp_servers]",
      'duet = { command = "inline-table", args = ["server.js"] }',
      'sibling = { command = "keep" }',
      "",
    ].join("\n"),
    [
      "[[mcp_servers.duet]]",
      'command = "array-table"',
      'args = ["server.js"]',
      "",
      "[mcp_servers.keep]",
      'command = "keep"',
      "",
    ].join("\n"),
  ];
  for (const [index, original] of variants.entries()) {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), `duet-codex-alternate-${index}-`),
    );
    const configPath = path.join(directory, "config.toml");
    const nodePath = path.join(directory, "node.exe");
    const entryPath = path.join(directory, "duet-mcp.js");
    await writeFile(nodePath, "");
    await writeFile(entryPath, "");
    await writeFile(configPath, original);
    const options = {
      codexConfigPath: configPath,
      nodePath,
      entryPath,
      now: () => new Date(`2026-01-02T03:04:0${index}.000Z`),
    };
    try {
      assert.equal((await codexMcpStatus(options)).state, "unmanaged");
      await assert.rejects(
        installCodexMcp(options),
        /unmanaged mcp_servers\.duet/,
      );
      await installCodexMcp({ ...options, force: true });
      const updated = await readFile(configPath, "utf8");
      assert.match(updated, /BEGIN DUET MCP/);
      assert.equal((await codexMcpStatus(options)).state, "installed");
      assert.doesNotMatch(updated, /inline|array-table/);
      if (index === 0) assert.match(updated, /keep = "root"/);
      if (index === 1) assert.match(updated, /sibling = \{ command = "keep" }/);
      if (index === 2) assert.match(updated, /\[mcp_servers\.keep]/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});
