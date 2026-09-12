import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {agentConfigs} from '../scripts/agent-config.mjs';
import {installExtension,profileConfigPath,profilesRegistryPath} from '../scripts/install.mjs';

test('profiles allocate isolated configs, ports and agent services',async t=>{
  const root=await mkdtemp(join(tmpdir(),'ringo-profiles-')); t.after(()=>rm(root,{recursive:true,force:true}));
  const plugins=join(root,'Plugins'); const appdata=join(root,'AppData');
  const a=await installExtension({profile:'project-a',name:'Architecture',port:'9876',plugins},{platform:'win32',home:root,appdata});
  const b=await installExtension({profile:'project-b',name:'Furniture',port:'9877',plugins},{platform:'win32',home:root,appdata});
  assert.notEqual(a.config,b.config); assert.equal(a.port,9876); assert.equal(b.port,9877);
  assert.equal(JSON.parse(await readFile(a.config,'utf8')).profile_id,'project-a');
  assert.equal(JSON.parse(await readFile(b.config,'utf8')).profile_name,'Furniture');
  const registry=JSON.parse(await readFile(profilesRegistryPath('win32',root,appdata),'utf8'));
  assert.deepEqual(registry.profiles.map(p=>p.id),['project-a','project-b']);
  await assert.rejects(installExtension({profile:'project-c',port:'9877',plugins},{platform:'win32',home:root,appdata}),/Profile port conflict/);
  const configs=agentConfigs({instances:[{name:'sketchup-architecture',config:a.config},{name:'sketchup-furniture',config:b.config}]});
  const mcp=JSON.parse(configs['mcp.json']); assert.deepEqual(Object.keys(mcp.mcpServers),['sketchup-architecture','sketchup-furniture']);
  assert.match(configs['codex.toml'],/mcp_servers\.sketchup-architecture/); assert.match(configs['codex.toml'],/mcp_servers\.sketchup-furniture/);
});
