import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readVersions } from '../scripts/bump-version.mjs';
import { extractReleaseNotes } from '../scripts/release-notes.mjs';

test('every shipped version marker matches package.json', async () => {
  const versions = await readVersions();
  const expected = versions['package.json'];
  for (const [file, version] of Object.entries(versions))
    assert.equal(
      version,
      expected,
      `${file} has version ${version}; run npm run version:bump -- ${expected}`,
    );
});

test('extractReleaseNotes parses CHANGELOG section for current version', async () => {
  const versions = await readVersions();
  const changelog = readFileSync('CHANGELOG.md', 'utf8');
  const notes = extractReleaseNotes(changelog, versions['package.json']);
  assert.match(notes, new RegExp(`^## ${versions['package.json'].replace(/\./g, '\\.')}`));
  assert.throws(() => extractReleaseNotes(changelog, '99.99.99'), /not found/);
});
