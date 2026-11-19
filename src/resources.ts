import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SketchupClient } from './sketchup-client.js';

export type ObservedModel = { model_id: string; active_path: number[] };

function unwrapBridgeData(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && 'success' in raw && 'data' in raw) {
    return (raw as { data: unknown }).data;
  }
  return raw;
}

export function registerResources(
  server: McpServer,
  client: SketchupClient,
  onModelObserved?: (model: ObservedModel) => void,
): void {
  server.registerResource(
    'model-info',
    'sketchup://model/info',
    {
      title: 'Active SketchUp Model Info',
      description:
        'Read-only metadata for the active SketchUp model session, units and edit context.',
      mimeType: 'application/json',
    },
    async (uri, extra) => {
      const raw = await client.call('model.get_info', {}, extra.signal);
      const data = unwrapBridgeData(raw) as
        | { model_id?: unknown; active_path?: unknown }
        | undefined;
      if (data && typeof data.model_id === 'string' && Array.isArray(data.active_path)) {
        onModelObserved?.({ model_id: data.model_id, active_path: data.active_path });
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    'materials',
    'sketchup://materials',
    {
      title: 'SketchUp Model Materials',
      description: 'Read-only list of materials in the active SketchUp model.',
      mimeType: 'application/json',
    },
    async (uri, extra) => {
      const raw = await client.call('materials.list', { limit: 500, offset: 0 }, extra.signal);
      const data = unwrapBridgeData(raw);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    },
  );
}
