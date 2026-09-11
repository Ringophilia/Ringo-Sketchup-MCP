import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function agentConfigs({node = process.execPath, directory = root, config = process.env.SKETCHUP_MCP_CONFIG} = {}) {
  const entry = {command: node, args: [join(directory, 'dist', 'mcp-server.js')]};
  // Only forward the config location. Credentials stay in the local bridge config.
  if (config) entry.env = {SKETCHUP_MCP_CONFIG: resolve(config)};
  const codex = [
    '[mcp_servers.sketchup]',
    `command = ${JSON.stringify(entry.command)}`,
    `args = ${JSON.stringify(entry.args)}`,
    'startup_timeout_sec = 20',
    'tool_timeout_sec = 90',
    ...(entry.env ? ['[mcp_servers.sketchup.env]', `SKETCHUP_MCP_CONFIG = ${JSON.stringify(entry.env.SKETCHUP_MCP_CONFIG)}`] : []),
    '',
  ].join('\n');
  return {
    'codex.toml': codex,
    'mcp.json': JSON.stringify({mcpServers: {sketchup: entry}}, null, 2) + '\n',
    'vscode.json': JSON.stringify({servers: {sketchup: {type: 'stdio', ...entry}}}, null, 2) + '\n',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {values} = parseArgs({options: {out: {type: 'string'}, help: {type: 'boolean'}}});
  if (values.help) {
    console.log('Usage: node scripts/agent-config.mjs [--out DIRECTORY]\nGenerate local ChatGPT/Codex, Claude/Cursor and VS Code MCP configuration snippets.');
  } else {
    const output = resolve(values.out ?? join(root, '.agent-config'));
    await mkdir(output, {recursive: true});
    for (const [name, content] of Object.entries(agentConfigs())) {
      const path = join(output, name);
      await writeFile(path, content, 'utf8');
      console.log(path);
    }
    console.log('Merge the sketchup entry into your agent configuration, then restart its MCP server. See docs/agents.md.');
  }
}
