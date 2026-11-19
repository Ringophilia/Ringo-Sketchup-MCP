import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { agentConfigs } from '../scripts/agent-config.mjs';

const run = promisify(execFile);
const binPath = resolve('bin/ringo-sketchup-mcp.mjs');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

test('CLI exposes version, help and stdio MCP server', async (t) => {
  const versionOut = execFileSync(process.execPath, [binPath, '--version'], {
    encoding: 'utf8',
  }).trim();
  assert.equal(versionOut, pkg.version);

  const helpOut = execFileSync(process.execPath, [binPath, '--help'], { encoding: 'utf8' });
  assert.match(helpOut, /setup/);
  assert.match(helpOut, /doctor/);
  assert.match(helpOut, /config/);

  const client = new Client({ name: 'cli-test', version: '1' }, { capabilities: {} });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [binPath] }));
  const { tools } = await client.listTools();
  assert.ok(tools.some((tool) => tool.name === 'bridge_status'));
});

test('agentConfigs supports npx mode without leaking credentials', () => {
  const configs = agentConfigs({ npx: true, config: '/tmp/ringo/config.json', name: 'sketchup' });
  const mcp = JSON.parse(configs['mcp.json']).mcpServers.sketchup;
  const vscode = JSON.parse(configs['vscode.json']).servers.sketchup;
  assert.equal(mcp.command, 'npx');
  assert.deepEqual(mcp.args, ['-y', '@ringo/sketchup-mcp']);
  assert.equal(vscode.type, 'stdio');
  assert.equal(vscode.command, 'npx');
  assert.match(configs['codex.toml'], /command = "npx"/);
  assert.match(configs['codex.toml'], /args = \["-y",\s*"@ringo\/sketchup-mcp"\]/);
});

test('npm pack dry-run includes runtime, extension and docs while excluding local artifacts', async () => {
  const { stdout } =
    process.platform === 'win32'
      ? await run('cmd.exe', ['/d', '/s', '/c', 'npm pack --dry-run --json'])
      : await run('npm', ['pack', '--dry-run', '--json']);
  const packed = JSON.parse(stdout);
  const paths = new Set((packed[0]?.files ?? []).map((file: { path: string }) => file.path));

  for (const required of [
    'bin/ringo-sketchup-mcp.mjs',
    'dist/mcp-server.js',
    'extension/ringo_sketchup_mcp.rb',
    'extension/ringo_sketchup_mcp/operations.rb',
    'scripts/setup.mjs',
    'README.md',
    'README.en.md',
    'LICENSE',
  ]) {
    assert.ok(paths.has(required), `npm pack missing ${required}`);
  }

  for (const file of paths) {
    assert.ok(!file.startsWith('artifacts/'), `unexpected artifacts file: ${file}`);
    assert.ok(!file.startsWith('release/'), `unexpected release file: ${file}`);
    assert.ok(!file.startsWith('test/'), `unexpected test file: ${file}`);
  }
});
