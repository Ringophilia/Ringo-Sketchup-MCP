import test from 'node:test';
import assert from 'node:assert/strict';
import {configPath} from '../src/config.js';
import {readFileSync} from 'node:fs';
test('Windows/macOS config paths and shipped single implementation stay platform neutral',()=>{
  assert.match(configPath('darwin','/Users/example'),/Library[\\/]Application Support[\\/]RingoSketchUpMCP[\\/]config.json$/);
  assert.match(configPath('win32','C:/Users/example'),/RingoSketchUpMCP[\\/]config.json$/);
  const loader=readFileSync('extension/ringo_sketchup_mcp.rb','utf8');
  assert.match(loader,/register_extension/);
  assert.ok(!loader.includes('load File'), 'Extension Manager must control loading');
});
