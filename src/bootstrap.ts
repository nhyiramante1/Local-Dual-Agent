export function nodeVersionError(version: string): string | undefined {
  const major = Number(version.split(".", 1)[0]);
  if (!Number.isFinite(major) || major < 24) {
    return `DUET_NODE_UNSUPPORTED: Duet requires Node.js 24 or newer; found ${version}.`;
  }
  return undefined;
}
