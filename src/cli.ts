#!/usr/bin/env node

import { nodeVersionError } from "./bootstrap.js";

const versionError = nodeVersionError(process.versions.node);
if (versionError) {
  console.error(versionError);
  process.exitCode = 1;
} else {
  import("./main.js").catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.stack ?? error.message : String(error),
    );
    process.exitCode = 1;
  });
}
