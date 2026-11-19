import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { batchMethods, toolDefs } from '../src/tools/index.js';

test('MCP exposes generic geometry, scene, diagnostics, prompts, resources and output schemas', async (t) => {
  const c = new Client({ name: 'test', version: '1' }, { capabilities: {} });
  t.after(() => c.close());
  await c.connect(
    new StdioClientTransport({ command: process.execPath, args: ['dist/mcp-server.js'] }),
  );

  const { tools } = await c.listTools();
  const names = tools.map((x) => x.name);
  for (const name of [
    'bridge_status',
    'entity_create_mesh',
    'entity_extrude',
    'model_snapshot',
    'model_diff',
    'batch_run',
    'view_export',
    'model_undo',
    'model_redo',
    'camera_set',
    'sketchup_run_ruby',
  ]) {
    assert.ok(names.includes(name), name);
  }
  assert.ok(!names.some((n) => /apple|furniture|table/.test(n)));
  assert.equal(
    tools.find((tool) => tool.name === 'entity_delete')?.annotations?.destructiveHint,
    true,
  );

  for (const tool of tools) {
    assert.ok(
      typeof tool.title === 'string' && tool.title.length > 0,
      `${tool.name} missing title`,
    );
    assert.ok(
      tool.outputSchema && tool.outputSchema.type === 'object',
      `${tool.name} missing outputSchema`,
    );
  }

  const { prompts } = await c.listPrompts();
  const workflowPrompt = prompts.find((p) => p.name === 'sketchup-modeling-workflow');
  assert.ok(workflowPrompt, 'sketchup-modeling-workflow prompt missing');
  const promptResult = await c.getPrompt({
    name: 'sketchup-modeling-workflow',
    arguments: { goal: 'Build a frame', unit: 'cm' },
  });
  const promptText = promptResult.messages
    .map((m) => (m.content.type === 'text' ? m.content.text : ''))
    .join('\n');
  assert.match(promptText, /bridge_status/);
  assert.match(promptText, /view_capture/);
  assert.match(promptText, /Build a frame/);
  assert.match(promptText, /cm/);

  const { resources } = await c.listResources();
  const uris = resources.map((r) => r.uri);
  assert.ok(uris.includes('sketchup://model/info'));
  assert.ok(uris.includes('sketchup://materials'));
});

test('Ruby HANDLERS and OPERATION_NAMES cover all MCP tool definitions', () => {
  const rubyOps = readFileSync('extension/ringo_sketchup_mcp/operations.rb', 'utf8');
  const handlersBlock = rubyOps.match(/HANDLERS\s*=\s*\{([\s\S]*?)\}\.freeze/)?.[1];
  assert.ok(handlersBlock, 'Ruby HANDLERS table not found');
  const registeredHandlers = new Set(
    [...handlersBlock.matchAll(/'([^']+)'\s*=>\s*:\w+/g)].map((m) => m[1]),
  );

  for (const def of toolDefs) {
    if (def.method === 'bridge.status') continue;
    assert.ok(registeredHandlers.has(def.method), `Ruby HANDLERS missing ${def.method}`);
  }

  const opNamesBlock = rubyOps.match(/OPERATION_NAMES\s*=\s*\{([\s\S]*?)\}\.freeze/)?.[1];
  assert.ok(opNamesBlock, 'Ruby OPERATION_NAMES table not found');
  const opNames = new Set([...opNamesBlock.matchAll(/'([^']+)'\s*=>\s*'[^']+'/g)].map((m) => m[1]));
  for (const method of batchMethods) {
    assert.ok(opNames.has(method), `Ruby OPERATION_NAMES missing ${method}`);
  }
});
