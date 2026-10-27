import test from 'node:test';
import assert from 'node:assert/strict';
import {readVersions} from '../scripts/bump-version.mjs';
test('every shipped version marker matches package.json',async()=>{
  const versions=await readVersions();
  const expected=versions['package.json'];
  for(const [file,version] of Object.entries(versions)) assert.equal(version,expected,`${file} has version ${version}; run npm run version:bump -- ${expected}`);
});
