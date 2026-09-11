import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
export function configPath(platform = process.platform, home = homedir()): string {
  return process.env.SKETCHUP_MCP_CONFIG ?? (platform === 'win32'
    ? join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'RingoSketchUpMCP', 'config.json')
    : platform === 'darwin' ? join(home, 'Library', 'Application Support', 'RingoSketchUpMCP', 'config.json')
    : join(home, '.config', 'ringo-sketchup-mcp', 'config.json'));
}
export function readConfig(): {host: string; port: number; token: string; timeoutMs: number} {
  let file: Record<string, unknown> = {};
  try { file = JSON.parse(readFileSync(configPath(), 'utf8').replace(/^\uFEFF/, '')); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const host = String(process.env.SKETCHUP_HOST ?? file.host ?? '127.0.0.1');
  const port = Number(process.env.SKETCHUP_PORT ?? file.port ?? 9876);
  const timeoutMs = Number(process.env.SKETCHUP_TIMEOUT_MS ?? 60000);
  const token = String(process.env.SKETCHUP_TOKEN ?? file.token ?? '');
  if (host !== '127.0.0.1') throw new Error('The bridge only supports IPv4 loopback (127.0.0.1)');
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 600000) throw new Error('Invalid port or timeout');
  return { host, port, token, timeoutMs };
}
