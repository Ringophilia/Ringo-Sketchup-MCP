import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { registerPrompts } from './prompts.js';
import { RpcError, VERSION } from './protocol.js';
import { type ObservedModel, registerResources } from './resources.js';
import { SketchupClient } from './sketchup-client.js';
import { toolDefs, toolOutputSchema, validateArguments, validateBatchArgs } from './tools/index.js';

const CONTEXT_TOOLS = new Set(['selection.set', 'entity.group', 'scene.clear', 'batch.run']);
const CREATION_TOOLS = new Set([
  'entity.create_box',
  'entity.create_cylinder',
  'entity.create_mesh',
  'entity.extrude',
]);

async function loadExportedImage(
  path: string,
  expectedPath: string,
): Promise<{ type: 'image'; data: string; mimeType: string } | undefined> {
  const ext = path.toLowerCase().split('.').pop();
  if (
    resolve(path) !== resolve(expectedPath) ||
    (ext !== 'png' && ext !== 'jpg' && ext !== 'jpeg')
  ) {
    return undefined;
  }
  try {
    const file = await open(path, 'r');
    try {
      if ((await file.stat()).size <= 4 * 1024 * 1024) {
        const bytes = Buffer.alloc(4 * 1024 * 1024 + 1);
        const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
        if (bytesRead <= 4 * 1024 * 1024) {
          return {
            type: 'image',
            data: bytes.subarray(0, bytesRead).toString('base64'),
            mimeType: ext === 'png' ? 'image/png' : 'image/jpeg',
          };
        }
      }
    } finally {
      await file.close();
    }
  } catch {
    /* the path remains available in structuredContent */
  }
  return undefined;
}

function normalizeResult(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && 'success' in raw) {
    const record = raw as Record<string, unknown>;
    return {
      ...record,
      warnings: Array.isArray(record.warnings) ? record.warnings : [],
    };
  }
  return { success: true, data: raw, warnings: [] };
}

export function createServer(client = new SketchupClient()) {
  let observedModel: ObservedModel | undefined;
  const server = new McpServer(
    { name: 'Ringo SketchUp MCP', version: VERSION },
    {
      instructions:
        'Call bridge_status first and confirm data.instance.profile_id, data.instance.profile_name, and port identify the intended SketchUp process. Read model_get_info before editing. Lengths default to mm; model references are session scoped. Use generic tools or Ruby scripts, never model-specific server additions. Inspect geometry and export a view to verify visual work. A timeout is not proof that a mutation did not execute.',
    },
  );

  for (const def of toolDefs) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: z.object(def.schema).strict(),
        outputSchema: toolOutputSchema,
        annotations: {
          readOnlyHint: !!def.read,
          destructiveHint: !!def.destructive,
          idempotentHint: !!def.read,
          openWorldHint: def.method === 'ruby.eval',
        },
      },
      async (args, extra) => {
        const started = Date.now();
        const token = extra._meta?.progressToken;
        try {
          validateArguments(def.method, args);
          const guarded = { ...args } as Record<string, unknown>;
          if (!def.read) {
            guarded.model_id ??= observedModel?.model_id;
            if (!guarded.model_id) {
              throw new RpcError(
                'Read model_get_info before editing, or provide its model_id.',
                -32007,
              );
            }
            const usesContext =
              CONTEXT_TOOLS.has(def.method) ||
              (CREATION_TOOLS.has(def.method) && !guarded.parent && !guarded.parent_id);
            if (usesContext && observedModel?.model_id === guarded.model_id) {
              guarded.active_path ??= observedModel.active_path;
            }
          }
          const requestArgs = def.method === 'batch.run' ? validateBatchArgs(guarded) : guarded;
          const initialTotal =
            def.method === 'batch.run' && Array.isArray(requestArgs.commands)
              ? requestArgs.commands.length
              : 1;
          let lastProgress = 0;
          let lastTotal = initialTotal;
          let progressQueue = Promise.resolve();
          const emitProgress = (params: { progress: number; total?: number; message?: string }) => {
            if (token === undefined) return;
            progressQueue = progressQueue
              .then(() =>
                extra.sendNotification({
                  method: 'notifications/progress',
                  params: { progressToken: token, ...params },
                }),
              )
              .catch(() => {});
          };
          if (token !== undefined) {
            emitProgress({ progress: 0, total: initialTotal, message: 'Waiting for SketchUp' });
          }
          const raw = await client.call(def.method, requestArgs, {
            signal: extra.signal,
            onProgress:
              token === undefined
                ? undefined
                : (event) => {
                    lastProgress = event.progress;
                    if (event.total !== undefined) lastTotal = event.total;
                    emitProgress({
                      progress: event.progress,
                      ...(event.total !== undefined ? { total: event.total } : {}),
                      ...(event.message !== undefined ? { message: event.message } : {}),
                    });
                  },
          });
          const result = normalizeResult(raw);
          if (def.method === 'model.get_info') {
            const data = result.data as { model_id?: unknown; active_path?: unknown } | undefined;
            if (data && typeof data.model_id === 'string' && Array.isArray(data.active_path)) {
              observedModel = { model_id: data.model_id, active_path: data.active_path };
            }
          }
          if (token !== undefined) {
            if (lastProgress < lastTotal) {
              emitProgress({ progress: lastTotal, total: lastTotal, message: 'Completed' });
            }
            await progressQueue;
          }
          let preview: { type: 'image'; data: string; mimeType: string } | undefined;
          if (def.method === 'view.capture') {
            const data = result.data as Record<string, unknown> | undefined;
            if (
              typeof data?.image_base64 !== 'string' ||
              data.mime_type !== 'image/png' ||
              data.image_base64.length > 3 * 1024 * 1024
            ) {
              throw new RpcError('Invalid preview response', -32600);
            }
            preview = { type: 'image', data: data.image_base64, mimeType: 'image/png' };
            const { image_base64: _, ...metadata } = data;
            result.data = metadata;
          }
          const content: Array<
            { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
          > = [{ type: 'text', text: JSON.stringify(result) }];
          if (preview) content.push(preview);
          if (def.method === 'view.export' && 'data' in result) {
            const output = result.data;
            const path =
              output &&
              typeof output === 'object' &&
              typeof (output as { path?: unknown }).path === 'string'
                ? (output as { path: string }).path
                : undefined;
            if (path) {
              const exportedImage = await loadExportedImage(path, String(guarded.path));
              if (exportedImage) content.push(exportedImage);
            }
          }
          return { content, structuredContent: result };
        } catch (error) {
          const err = error as Error;
          const result = {
            success: false,
            error: {
              code: err instanceof RpcError ? err.code : -32603,
              message: err.message,
              details: err instanceof RpcError ? (err.data ?? null) : null,
            },
            elapsed_ms: Date.now() - started,
          };
          return {
            isError: true,
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
            structuredContent: result,
          };
        }
      },
    );
  }

  registerPrompts(server);
  registerResources(server, client, (model) => {
    observedModel = model;
  });

  return { server, client };
}

export async function startStdioServer(): Promise<void> {
  const { server, client } = createServer();
  const shutdown = async () => {
    await client.close();
    await server.close();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  process.stdin.once('end', () => void shutdown());
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startStdioServer();
}
