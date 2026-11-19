import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function extractReleaseNotes(changelogText, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = changelogText.match(
    new RegExp(`^## ${escaped}\\r?\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'),
  );
  if (!match) {
    throw Error(`Changelog section for ${version} not found.`);
  }
  return `## ${version}\n${match[1].trim()}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const version = process.argv[2]?.replace(/^v/, '');
    if (!version) throw Error('Usage: node scripts/release-notes.mjs X.Y.Z');
    const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8');
    process.stdout.write(extractReleaseNotes(changelog, version));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
