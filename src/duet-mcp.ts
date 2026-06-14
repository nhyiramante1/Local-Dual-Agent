#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { nodeVersionError } from "./bootstrap.js";
import { createDuetMcpServer } from "./mcp/server.js";

const versionError = nodeVersionError(process.versions.node);
if (versionError) {
  console.error(versionError);
  process.exitCode = 1;
} else {
  const server = createDuetMcpServer();
  server
    .connect(new StdioServerTransport())
    .catch((error: unknown) => {
      console.error(
        error instanceof Error ? error.stack ?? error.message : String(error),
      );
      process.exitCode = 1;
    });
}
