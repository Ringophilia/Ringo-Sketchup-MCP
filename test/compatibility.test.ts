import test from 'node:test';
import assert from 'node:assert/strict';
import {configPath,readConfig} from '../src/config.js';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('timeout_ms is read from the config file, and the environment still wins',t=>{
  const directory=mkdtempSync(join(tmpdir(),'ringo-config-')); const file=join(directory,'config.json');
  const saved={config:process.env.SKETCHUP_MCP_CONFIG,timeout:process.env.SKETCHUP_TIMEOUT_MS};
  t.after(()=>{
    for(const [key,value] of [['SKETCHUP_MCP_CONFIG',saved.config],['SKETCHUP_TIMEOUT_MS',saved.timeout]] as const) value===undefined ? delete process.env[key] : process.env[key]=value;
    rmSync(directory,{recursive:true,force:true});
  });
  writeFileSync(file,JSON.stringify({port:9876,token:'a'.repeat(64),timeout_ms:1234}));
  process.env.SKETCHUP_MCP_CONFIG=file; delete process.env.SKETCHUP_TIMEOUT_MS;
  assert.equal(readConfig().timeoutMs,1234);
  process.env.SKETCHUP_TIMEOUT_MS='5000';
  assert.equal(readConfig().timeoutMs,5000);
});
test('Windows/macOS config paths and shipped single implementation stay platform neutral',()=>{
  assert.match(configPath('darwin','/Users/example'),/Library[\\/]Application Support[\\/]RingoSketchUpMCP[\\/]config.json$/);
  assert.match(configPath('win32','C:/Users/example'),/RingoSketchUpMCP[\\/]config.json$/);
  const loader=readFileSync('extension/ringo_sketchup_mcp.rb','utf8');
  assert.match(loader,/register_extension/);
  assert.ok(!loader.includes('load File'), 'Extension Manager must control loading');
});
