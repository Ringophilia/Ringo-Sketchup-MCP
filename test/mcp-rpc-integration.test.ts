import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fakeBridge,hello,respond,TOKEN} from './fixture.js';
test('MCP structured results, RPC errors and invalid inputs are unambiguous',async t=>{
  const seen:any[]=[];
  const b=await fakeBridge((r,s)=>{
    if(hello(r,s))return;seen.push(r);
    if(r.method==='entity.delete')s.write(JSON.stringify({jsonrpc:'2.0',id:r.id,error:{code:-32008,message:'stale entity'}})+'\n');
    else respond(s,r,{success:true,data:r.params,warnings:[],operation_id:r.id});
  });
  const c=new Client({name:'test',version:'1'},{capabilities:{}});
  t.after(async()=>{await c.close();await b.close()});
  await c.connect(new StdioClientTransport({command:process.execPath,args:['dist/mcp-server.js'],env:{...process.env,SKETCHUP_PORT:String(b.port),SKETCHUP_TOKEN:TOKEN}}));
  const result=await c.callTool({name:'entity_create_cylinder',arguments:{radius_mm:20,height_mm:50}});
  assert.equal(result.isError,undefined);assert.equal((result.structuredContent as any).data.radius_mm,20);
  const bad=await c.callTool({name:'entity_delete',arguments:{entity_id:123}});
  assert.equal(bad.isError,true);assert.equal((bad.structuredContent as any).error.code,-32008);
  const invalid=await c.callTool({name:'entity_create_box',arguments:{size:[1,-2,3]}});
  assert.equal(invalid.isError,true);assert.equal(seen.length,2);
});
