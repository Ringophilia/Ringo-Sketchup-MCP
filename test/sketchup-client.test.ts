import test from 'node:test';
import assert from 'node:assert/strict';
import {SketchupClient} from '../src/sketchup-client.js';
import {fakeBridge,hello,respond,TOKEN} from './fixture.js';
test('handshake tolerates minor version differences and UTF-8 split/out-of-order responses',async t=>{
  const requests:any[]=[];
  const b=await fakeBridge((r,s)=>{
    assert.equal(r.token,TOKEN);
    if(hello(r,s))return;
    requests.push(r);
    if(requests.length===2){
      const bytes=Buffer.from(JSON.stringify({jsonrpc:'2.0',id:requests[1].id,result:'通用载荷 🧩'})+'\n'+JSON.stringify({jsonrpc:'2.0',id:requests[0].id,result:42})+'\n');
      const split=bytes.indexOf(Buffer.from('通用'))+1;s.write(bytes.subarray(0,split));setTimeout(()=>s.write(bytes.subarray(split)),5);
    }
  });
  const c=new SketchupClient({port:b.port,token:TOKEN,timeoutMs:2000});
  t.after(async()=>{await c.close();await b.close()});
  assert.deepEqual(await Promise.all([c.call('first'),c.call('second')]),[42,'通用载荷 🧩']);
  assert.equal(c.capabilities.pbr,false);
});
test('disconnect drops unfinished frame; next request reconnects without replaying mutations',async t=>{
  let count=0;
  const b=await fakeBridge((r,s)=>{if(hello(r,s))return;count++;if(count===1){s.write('{"jsonrpc":"2.0"');s.end()}else respond(s,r,{ok:true})});
  const c=new SketchupClient({port:b.port,token:TOKEN,timeoutMs:1000});
  t.after(async()=>{await c.close();await b.close()});
  await assert.rejects(c.call('mutate'),/Connection lost/);
  assert.deepEqual(await c.call('inspect'),{ok:true});assert.equal(count,2);
});
test('timeouts send cancellation and never replay',async t=>{
  const seen:string[]=[];
  const b=await fakeBridge((r,s)=>{if(hello(r,s))return;seen.push(r.method)});
  const c=new SketchupClient({port:b.port,token:TOKEN,timeoutMs:120});
  t.after(async()=>{await c.close();await b.close()});
  await assert.rejects(c.call('mutate'),/timed out/);
  await new Promise(r=>setTimeout(r,30));
  assert.deepEqual(seen,['mutate','bridge.cancel']);
});
test('authentication failure is reported immediately',async t=>{
  const b=await fakeBridge((r,s)=>s.write(JSON.stringify({jsonrpc:'2.0',id:r.id,error:{code:-32001,message:'Unauthorized'}})+'\n'));
  const c=new SketchupClient({port:b.port,token:TOKEN});
  t.after(async()=>{await c.close();await b.close()});
  await assert.rejects(c.call('model.get_info'),/Unauthorized/);
});
