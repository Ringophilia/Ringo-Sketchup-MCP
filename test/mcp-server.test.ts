import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
test('MCP exposes generic geometry, scene, diagnostics and transaction tools',async t=>{
  const c=new Client({name:'test',version:'1'},{capabilities:{}});
  t.after(()=>c.close());
  await c.connect(new StdioClientTransport({command:process.execPath,args:['dist/mcp-server.js']}));
  const {tools}=await c.listTools();const names=tools.map(x=>x.name);
  for(const name of ['bridge_status','entity_create_mesh','entity_extrude','model_snapshot','model_diff','batch_run','view_export','model_undo','model_redo','camera_set','sketchup_run_ruby'])assert.ok(names.includes(name),name);
  assert.ok(!names.some(n=>/apple|furniture|table/.test(n)));
  assert.equal(tools.find(t=>t.name==='entity_delete')?.annotations?.destructiveHint,true);
});
