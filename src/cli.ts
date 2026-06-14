#!/usr/bin/env node

import { nodeVersionError } from "./bootstrap.js";

const versionError = nodeVersionError(process.versions.node);
if (versionError) {
  console.error(versionError);
  process.exitCode = 1;
} else {
  const args = process.argv.slice(2);
  const embeddedIndex = args.indexOf("--embedded");
  const localOnly =
    embeddedIndex >= 0 ||
    args[0] === "doctor" ||
    args[0] === "auth";
  if (embeddedIndex >= 0) process.argv.splice(embeddedIndex + 2, 1);
  let embeddedLock = false;
  const load = async () => {
    if (
      embeddedIndex >= 0 &&
      args.filter((arg) => arg !== "--embedded")[0] !== "doctor" &&
      args.filter((arg) => arg !== "--embedded")[0] !== "auth"
    ) {
      const {
        acquireServiceLock,
        readServiceInfo,
        reclaimStaleServiceLock,
      } = await import("./service/discovery.js");
      const { probeService } = await import("./service/client.js");
      const info = await readServiceInfo();
      if (info && (await probeService(info))) {
        throw new Error(
          "SERVICE_LOCKED: Stop duetd before using embedded mutation mode.",
        );
      }
      await reclaimStaleServiceLock();
      await acquireServiceLock();
      embeddedLock = true;
    }
    return await import(localOnly ? "./main.js" : "./service-cli.js");
  };
  load().then(async (module) => {
    try {
      if (localOnly) return await module.main();
      return await module.serviceMain();
    } finally {
      if (embeddedLock) {
        const { releaseServiceLock } = await import("./service/discovery.js");
        await releaseServiceLock();
      }
    }
  }).catch((error: unknown) => {
    if (
      error instanceof Error &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
    ) {
      console.error(`${(error as { code: string }).code}: ${error.message}`);
    } else {
      console.error(
        error instanceof Error ? error.stack ?? error.message : String(error),
      );
    }
    process.exitCode = 1;
  });
}
