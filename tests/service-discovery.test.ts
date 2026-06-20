import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  acquireServiceLock,
  getProcessIdentity,
  loadOrCreateServiceSecret,
  reclaimStaleServiceLock,
  releaseServiceLock,
  verifyServiceProcess,
} from "../src/service/discovery.js";

test("service secret, lock owner, and process identity are locally verifiable", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-discovery-"));
  const previous = process.env.DUET_HOME;
  process.env.DUET_HOME = directory;
  try {
    const secret = await loadOrCreateServiceSecret();
    assert.ok(secret.length >= 40);
    await acquireServiceLock();
    await assert.rejects(reclaimStaleServiceLock(), /live process/);
    const identity = await getProcessIdentity(process.pid);
    assert.ok(identity);
    assert.equal(
      await verifyServiceProcess({
        instanceId: "test",
        pid: process.pid,
        processStartedAt: identity!.startedAt,
        commandHash: identity!.commandHash,
        port: 0,
        apiVersion: "v1",
        startedAt: identity!.startedAt,
      }),
      true,
    );
    await releaseServiceLock();
  } finally {
    if (previous === undefined) delete process.env.DUET_HOME;
    else process.env.DUET_HOME = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
