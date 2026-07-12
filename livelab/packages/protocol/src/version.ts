/**
 * Protocol version shared by runtime, extension, webview, CLI, and MCP server.
 * Major bump = incompatible. Clients must refuse to attach to a runtime with a
 * different major version and report `PROTOCOL_MISMATCH`.
 */
export const PROTOCOL_VERSION = '1.0.0';

export function protocolMajor(version: string): number {
  const major = Number(version.split('.')[0]);
  return Number.isFinite(major) ? major : -1;
}

export function isCompatibleProtocol(remote: string): boolean {
  return protocolMajor(remote) === protocolMajor(PROTOCOL_VERSION);
}
