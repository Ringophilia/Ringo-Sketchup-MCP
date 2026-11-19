import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const entries = {};
for (const f of await readdir(join(root, 'extension/ringo_sketchup_mcp')))
  if (f.endsWith('.rb'))
    entries[`ringo_sketchup_mcp/${f}`] = [
      new Uint8Array(await readFile(join(root, 'extension/ringo_sketchup_mcp', f))),
      { mtime: new Date('2020-01-01T00:00:00Z') },
    ];
entries['ringo_sketchup_mcp.rb'] = [
  new Uint8Array(await readFile(join(root, 'extension/ringo_sketchup_mcp.rb'))),
  { mtime: new Date('2020-01-01T00:00:00Z') },
];
entries['ringo_sketchup_mcp/LICENSE'] = [
  new Uint8Array(await readFile(join(root, 'LICENSE'))),
  { mtime: new Date('2020-01-01T00:00:00Z') },
];
await mkdir(join(root, 'release'), { recursive: true });
const path = join(root, 'release', `ringo-sketchup-mcp-${pkg.version}.rbz`);
const data = zipSync(entries, { level: 9 });
await writeFile(path, data);
await writeFile(`${path}.sha256`, `${createHash('sha256').update(data).digest('hex')}\n`);
console.log(path);
