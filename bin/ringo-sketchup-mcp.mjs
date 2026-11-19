#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [command, ...rest] = process.argv.slice(2);

function printHelp() {
  console.log(`Ringo SketchUp MCP CLI

Usage:
  ringo-sketchup-mcp [serve]               Start stdio MCP server (default)
  ringo-sketchup-mcp setup [options]       Install SketchUp extension and generate agent configs
  ringo-sketchup-mcp install [options]     Install or upgrade the SketchUp Ruby extension
  ringo-sketchup-mcp doctor [options]      Diagnose build, config, extension and live bridge
  ringo-sketchup-mcp config [options]      Generate MCP client configuration snippets
  ringo-sketchup-mcp --version             Print package version
  ringo-sketchup-mcp --help                Show this help

Examples:
  npx @ringo/sketchup-mcp setup
  npx @ringo/sketchup-mcp doctor
  npx -y @ringo/sketchup-mcp`);
}

function runScript(scriptName, args) {
  const scriptPath = join(root, 'scripts', scriptName);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exitCode = 1;
    return;
  }
  process.exitCode = result.status ?? 0;
}

if (!command || command === 'serve') {
  const { startStdioServer } = await import('../dist/mcp-server.js');
  await startStdioServer();
} else if (command === '--version' || command === '-v' || command === 'version') {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  console.log(pkg.version);
} else if (command === '--help' || command === '-h' || command === 'help') {
  printHelp();
} else if (command === 'setup') {
  runScript('setup.mjs', rest);
} else if (command === 'install') {
  runScript('install.mjs', rest);
} else if (command === 'doctor') {
  runScript('doctor.mjs', rest);
} else if (command === 'config' || command === 'config:agents') {
  runScript('agent-config.mjs', rest);
} else {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exitCode = 1;
}
