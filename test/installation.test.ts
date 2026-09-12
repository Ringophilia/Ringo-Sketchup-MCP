import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {installExtension,defaultConfigPath} from '../scripts/install.mjs';
import {diagnose} from '../scripts/doctor.mjs';

async function fixture(t:any) {
  const directory=await mkdtemp(join(tmpdir(),'ringo-install-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  return {directory,plugins:join(directory,'插件 with space'),configPath:join(directory,'config.json')};
}
test('upgrade keeps credentials, backs up loader and removes obsolete implementation files',async t=>{
  const f=await fixture(t);
  await mkdir(join(f.plugins,'ringo_sketchup_mcp'),{recursive:true});
  await writeFile(join(f.plugins,'ringo_sketchup_mcp.rb'),'old loader');
  await writeFile(join(f.plugins,'ringo_sketchup_mcp','obsolete.rb'),'old implementation');
  await writeFile(f.configPath,'\uFEFF'+JSON.stringify({host:'127.0.0.1',port:17876,token:'private-token-'.repeat(5),ruby_enabled:false}));
  const report=await installExtension({plugins:f.plugins},{configPath:f.configPath});
  assert.equal(JSON.parse(await readFile(f.configPath,'utf8')).token,'private-token-'.repeat(5));
  assert.ok(!JSON.stringify(report).includes('private-token'));
  assert.equal(await readFile(join(report.backup,'ringo_sketchup_mcp.rb'),'utf8'),'old loader');
  assert.equal(await readFile(join(report.backup,'ringo_sketchup_mcp','obsolete.rb'),'utf8'),'old implementation');
  await assert.rejects(access(join(f.plugins,'ringo_sketchup_mcp','obsolete.rb')));
  await access(join(f.plugins,'ringo_sketchup_mcp','references.rb'));
  const check=await diagnose({offline:true,configPath:f.configPath,plugins:f.plugins});
  assert.equal(check.success,true);
  assert.equal(check.checks.find(c=>c.code==='bridge').status,'skipped');
});
test('invalid configuration and dry run leave the installation untouched',async t=>{
  const f=await fixture(t);
  await installExtension({plugins:f.plugins,'dry-run':true},{configPath:f.configPath});
  await assert.rejects(access(f.plugins));
  await assert.rejects(access(f.configPath));
  await writeFile(f.configPath,'{ secret-token-invalid-json');
  await assert.rejects(installExtension({plugins:f.plugins},{configPath:f.configPath}),e=>/Invalid JSON/.test(e.message)&&!e.message.includes('secret-token'));
  await assert.rejects(access(f.plugins));
  assert.throws(()=>execFileSync(process.execPath,[resolve('scripts/install.mjs'),'--plugins'],{stdio:'pipe'}));
});
test('failed upgrade restores the previous extension pair',async t=>{
  const f=await fixture(t);
  await mkdir(join(f.plugins,'ringo_sketchup_mcp'),{recursive:true});
  await writeFile(join(f.plugins,'ringo_sketchup_mcp.rb'),'old loader');
  await writeFile(join(f.plugins,'ringo_sketchup_mcp','old.rb'),'old code');
  await mkdir(join(f.directory,'installation.json'));
  await assert.rejects(installExtension({plugins:f.plugins},{configPath:f.configPath}));
  assert.equal(await readFile(join(f.plugins,'ringo_sketchup_mcp.rb'),'utf8'),'old loader');
  assert.equal(await readFile(join(f.plugins,'ringo_sketchup_mcp','old.rb'),'utf8'),'old code');
  await assert.rejects(access(f.configPath));
});
test('diagnostics work before a build and provide actionable failures without credentials',async t=>{
  const f=await fixture(t);
  await writeFile(join(f.directory,'package.json'),JSON.stringify({version:'test'}));
  await writeFile(f.configPath,JSON.stringify({token:'secret',port:0,ruby_enabled:false}));
  const report=await diagnose({offline:true,directory:f.directory,configPath:f.configPath});
  assert.equal(report.success,false);
  assert.equal(report.checks.find(c=>c.code==='build').fix,'npm run build');
  assert.ok(!JSON.stringify(report).includes('secret'));
  assert.match(defaultConfigPath('darwin','/Users/example'),/Library[\\/]Application Support/);
});
