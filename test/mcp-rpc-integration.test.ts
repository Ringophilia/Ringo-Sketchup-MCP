import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fakeBridge, hello, respond, TOKEN } from './fixture.js';

test('MCP structured results, RPC errors, resources and validation are unambiguous', async (t) => {
  const seen: any[] = [];
  const b = await fakeBridge((r, s) => {
    if (hello(r, s)) return;
    if (r.method === 'model.get_info') {
      respond(s, r, {
        success: true,
        data: { model_id: 'model-1', active_path: [] },
        warnings: [],
      });
      return;
    }
    if (r.method === 'materials.list') {
      respond(s, r, {
        success: true,
        data: {
          materials: [{ name: 'Oak', color: [160, 110, 60, 255], alpha: 1, textured: false }],
          total: 1,
          limit: 500,
          offset: 0,
          next_offset: null,
        },
        warnings: [],
      });
      return;
    }
    seen.push(r);
    if (r.method === 'entity.delete') {
      s.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: r.id, error: { code: -32008, message: 'stale entity' } })}\n`,
      );
    } else if (r.method === 'batch.run') {
      s.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          method: 'bridge.progress',
          params: {
            request_id: r.id,
            progress: 1,
            total: r.params.commands.length,
            message: 'Completed step 1/2',
          },
        })}\n`,
      );
      s.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          method: 'bridge.progress',
          params: {
            request_id: r.id,
            progress: 2,
            total: r.params.commands.length,
            message: 'Completed step 2/2',
          },
        })}\n`,
      );
      setTimeout(
        () => respond(s, r, { success: true, data: r.params, warnings: [], operation_id: r.id }),
        15,
      );
    } else {
      respond(s, r, { success: true, data: r.params, warnings: [], operation_id: r.id });
    }
  });
  const c = new Client({ name: 'test', version: '1' }, { capabilities: {} });
  t.after(async () => {
    await c.close();
    await b.close();
  });
  await c.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['dist/mcp-server.js'],
      env: { ...process.env, SKETCHUP_PORT: String(b.port), SKETCHUP_TOKEN: TOKEN },
    }),
  );

  // Unbound mutation fails before hitting the bridge.
  const unbound = await c.callTool({ name: 'entity_create_box', arguments: { size: [1, 2, 3] } });
  assert.equal((unbound.structuredContent as any).error.code, -32007);
  assert.equal(seen.length, 0);

  // Reading sketchup://model/info binds observedModel, and sketchup://materials returns JSON.
  const infoRes = await c.readResource({ uri: 'sketchup://model/info' });
  assert.equal(JSON.parse((infoRes.contents[0] as any).text).model_id, 'model-1');
  const matRes = await c.readResource({ uri: 'sketchup://materials' });
  assert.equal(JSON.parse((matRes.contents[0] as any).text).materials[0].name, 'Oak');

  // Legacy cylinder radius_mm/height_mm still accepted.
  const legacyCylinder = await c.callTool({
    name: 'entity_create_cylinder',
    arguments: { radius_mm: 20, height_mm: 50 },
  });
  assert.equal(legacyCylinder.isError, undefined);
  assert.equal((legacyCylinder.structuredContent as any).data.radius_mm, 20);
  assert.equal((legacyCylinder.structuredContent as any).data.model_id, 'model-1');

  // New unit-aware radius/height accepted and forwarded.
  const unitCylinder = await c.callTool({
    name: 'entity_create_cylinder',
    arguments: { unit: 'cm', radius: 2, height: 5 },
  });
  assert.equal(unitCylinder.isError, undefined);
  assert.equal((unitCylinder.structuredContent as any).data.unit, 'cm');
  assert.equal((unitCylinder.structuredContent as any).data.radius, 2);
  assert.equal((unitCylinder.structuredContent as any).data.height, 5);

  // Conflicting or missing cylinder dimensions and invalid material colors are rejected before bridge.
  for (const [toolName, badArgs] of [
    ['entity_create_cylinder', { unit: 'cm', radius: 2, radius_mm: 20, height: 5 }],
    ['entity_create_cylinder', { unit: 'cm', radius: 2, height: 5, height_mm: 50 }],
    ['entity_create_cylinder', { unit: 'cm' }],
    ['entity_set_material', { entity_id: 1, material: 'Red', color: [300, 0, 0] }],
    ['entity_set_material', { entity_id: 1, material: 'Red', color: [-1, 0, 0] }],
    ['entity_create_box', { size: [1, -2, 3] }],
  ] as const) {
    const res = await c.callTool({ name: toolName, arguments: badArgs });
    assert.equal(res.isError, true, `${toolName} should reject ${JSON.stringify(badArgs)}`);
  }
  assert.equal(seen.length, 2);

  // RPC error propagation.
  const bad = await c.callTool({ name: 'entity_delete', arguments: { entity_id: 123 } });
  assert.equal(bad.isError, true);
  assert.equal((bad.structuredContent as any).error.code, -32008);

  // Pagination & diff limit params forwarded cleanly.
  const sel = await c.callTool({
    name: 'selection_get',
    arguments: { limit: 10, offset: 5, unit: 'cm' },
  });
  assert.equal(sel.isError, undefined);
  assert.deepEqual((sel.structuredContent as any).data, { limit: 10, offset: 5, unit: 'cm' });

  const diff = await c.callTool({
    name: 'model_diff',
    arguments: { snapshot_id: 's1', limit: 25 },
  });
  assert.equal(diff.isError, undefined);
  assert.equal((diff.structuredContent as any).data.limit, 25);

  // Batch validation rejects bad inputs and cylinder conflicts before reaching the bridge.
  const batchInvalid = await c.callTool({
    name: 'batch_run',
    arguments: { commands: [{ method: 'entity_create_box', params: { size: [1, -2, 3] } }] },
  });
  assert.equal(batchInvalid.isError, true);
  assert.match(
    (batchInvalid.structuredContent as any).error.message,
    /Invalid parameters for batch command/,
  );

  for (const args of [
    {
      model_id: 'model-1',
      commands: [{ method: 'entity.delete', params: { entity_id: 1, model_id: 'other' } }],
    },
    { commands: [{ method: 'model_save', params: { path: 'test.skp' } }] },
    { commands: [{ method: 'entity_transform', params: { entity_id: 1, axis: [0, 0, 1] } }] },
    { commands: [{ method: 'entity_create_box', params: { size: [1, 2, 3], misspelled: true } }] },
    {
      commands: [
        { method: 'entity_create_cylinder', params: { radius: 2, radius_mm: 20, height: 5 } },
      ],
    },
  ]) {
    const res = await c.callTool({ name: 'batch_run', arguments: args });
    assert.equal(res.isError, true);
  }
  assert.equal(seen.length, 5);

  const progressEvents: any[] = [];
  await c.callTool(
    {
      name: 'batch_run',
      arguments: {
        model_id: 'model-1',
        commands: [
          { method: 'entity_create_box', params: { size: [1, 2, 3] } },
          { method: 'entity_create_box', params: { size: [2, 3, 4] } },
        ],
      },
    },
    undefined,
    { onprogress: (p) => progressEvents.push(p) },
  );
  assert.equal(seen[5].method, 'batch.run');
  assert.equal(seen[5].params.commands[0].method, 'entity.create_box');
  assert.equal(seen[5].params.commands[0].params.model_id, 'model-1');
  assert.ok(progressEvents.some((p) => p.progress === 1 && p.total === 2));
  assert.ok(progressEvents.some((p) => p.progress === 2 && p.total === 2));
  assert.deepEqual(seen[0].params.active_path, []);
  assert.equal(seen[0].params.model_id, 'model-1');

  const imagePath = resolve('artifacts', 'mcp-image-test.png');
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(
    imagePath,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  const imageResult = await c.callTool({
    name: 'view_export',
    arguments: { path: imagePath, overwrite: true },
  });
  assert.ok((imageResult.content as any[]).some((item) => item.type === 'image'));
  await rm(imagePath, { force: true });
});
