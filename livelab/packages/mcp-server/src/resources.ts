import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RuntimeClient } from './client';

/**
 * MCP resources (spec §8). Artifact access is constrained to LiveLab-generated
 * evidence — metadata only via resources; binary content flows through the
 * screenshot tool's inline option. No arbitrary file reads.
 */
export function registerResources(server: McpServer, client: RuntimeClient): void {
  server.registerResource(
    'runtime-status',
    'livelab://runtime/status',
    { description: 'LiveLab runtime status, capabilities, and diagnostics', mimeType: 'application/json' },
    async (uri) => {
      let payload: unknown;
      try {
        payload = await client.request('GET', '/status');
      } catch (err) {
        payload = { running: false, error: String((err as Error).message ?? err) };
      }
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(payload, null, 2) }] };
    },
  );

  server.registerResource(
    'sessions',
    'livelab://sessions',
    { description: 'Active LiveLab device sessions', mimeType: 'application/json' },
    async (uri) => {
      const payload = await client.request('GET', '/sessions');
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(payload, null, 2) }] };
    },
  );

  server.registerResource(
    'session-current',
    new ResourceTemplate('livelab://sessions/{sessionId}/current', { list: undefined }),
    { description: 'Current state of one session: info, recent errors, recent failed requests', mimeType: 'application/json' },
    async (uri, variables) => {
      const sessionId = String(variables.sessionId);
      const [info, errors, network] = await Promise.all([
        client.request('GET', `/sessions/${sessionId}`),
        client.request('GET', `/sessions/${sessionId}/errors?limit=20`),
        client.request('GET', `/sessions/${sessionId}/network?failedOnly=true&limit=20`),
      ]);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ info, recentErrors: errors, recentNetworkFailures: network }, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    'report',
    new ResourceTemplate('livelab://reports/{reportId}', { list: undefined }),
    { description: 'Full LiveLab report (smoke or change) by id', mimeType: 'application/json' },
    async (uri, variables) => {
      const payload = await client.request('GET', `/reports/${String(variables.reportId)}`);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(payload, null, 2) }] };
    },
  );

  server.registerResource(
    'artifact-metadata',
    new ResourceTemplate('livelab://artifacts/{artifactId}/metadata', { list: undefined }),
    { description: 'Metadata for a LiveLab-generated artifact (path, type, size, provenance)', mimeType: 'application/json' },
    async (uri, variables) => {
      const payload = await client.request('GET', `/artifacts/${String(variables.artifactId)}/metadata`);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(payload, null, 2) }] };
    },
  );
}
