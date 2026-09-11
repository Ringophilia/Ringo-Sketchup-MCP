import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

test('generated agent configurations launch MCP outside the project without exposing credentials', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ringo-agent-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const config = join(directory, 'space 中文', 'config.json');
  execFileSync(process.execPath, [resolve('scripts/agent-config.mjs'), '--out', directory], {
    cwd: tmpdir(),
    env: {...process.env, SKETCHUP_MCP_CONFIG: config, SKETCHUP_TOKEN: 'test-secret-must-not-appear'},
  });
  const genericText = await readFile(join(directory, 'mcp.json'), 'utf8');
  const generic = JSON.parse(genericText).mcpServers.sketchup;
  const vscodeText = await readFile(join(directory, 'vscode.json'), 'utf8');
  const vscode = JSON.parse(vscodeText).servers.sketchup;
  const codex = await readFile(join(directory, 'codex.toml'), 'utf8');
  assert.equal(generic.command, process.execPath);
  assert.deepEqual(vscode, {type: 'stdio', ...generic});
  assert.equal(generic.env.SKETCHUP_MCP_CONFIG, config);
  assert.ok(codex.includes(`command = ${JSON.stringify(process.execPath)}`));
  assert.ok(codex.includes(`SKETCHUP_MCP_CONFIG = ${JSON.stringify(config)}`));
  for (const text of [genericText, vscodeText, codex]) assert.ok(!text.includes('test-secret-must-not-appear'));
  const client = new Client({name: 'generated-config-test', version: '1'}, {capabilities: {}});
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({...generic, cwd: tmpdir()}));
  const {tools} = await client.listTools();
  assert.ok(tools.some(tool => tool.name === 'bridge_status'));
});
