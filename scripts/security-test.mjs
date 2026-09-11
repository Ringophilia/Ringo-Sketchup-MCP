import net from 'node:net';
import {readConfig} from '../dist/config.js';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const cfg=readConfig();const socket=net.createConnection(cfg.port,'127.0.0.1');
let buffer='';const replies=new Map();let counter=0;
socket.setEncoding('utf8');
socket.on('data',data=>{buffer+=data;while(buffer.includes('\n')){const i=buffer.indexOf('\n');const response=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);replies.get(response.id)?.(response);replies.delete(response.id)}});
await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject)});
function pending(id) {return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Timeout '+id)),5000);replies.set(id,r=>{clearTimeout(t);resolve(r)})})}
async function call(method,params={},extra={}){const id=String(++counter);const p=pending(id);socket.write(JSON.stringify({jsonrpc:'2.0',id,method,params,token:cfg.token,...extra})+'\n');return p}
try {
  assert.equal((await call('bridge.hello',{protocol:3},{token:'invalid'})).error.code,-32001);
  assert.equal((await call('bridge.hello',{protocol:2})).error.code,-32004);
  assert.equal((await call('bridge.hello',{protocol:3})).result.protocol,3);
  assert.equal((await call('model.get_info',{}, {token:'invalid'})).error.code,-32001);
  assert.equal((await call('model.get_info',{}, {deadline_ms:Date.now()-1})).error.code,-32003);
  const job='cancel-job',cancel='cancel-request';const p1=pending(job),p2=pending(cancel);
  socket.write(JSON.stringify({jsonrpc:'2.0',id:job,method:'model.get_info',params:{},token:cfg.token})+'\n'+JSON.stringify({jsonrpc:'2.0',id:cancel,method:'bridge.cancel',params:{request_id:job},token:cfg.token})+'\n');
  assert.equal((await p1).error.code,-32003);assert.equal((await p2).result.cancelled,true);
  assert.equal((await call('no.such.method')).error.code,-32601);
  await mkdir('artifacts',{recursive:true});
  await writeFile('artifacts/security-test.json',JSON.stringify({success:true,checks:['missing token','wrong protocol major','per-request auth','expired job','queued cancellation','unknown method']},null,2));
  console.log('6 real bridge security/protocol checks passed');
} finally {socket.destroy()}
