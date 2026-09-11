import net from 'node:net';
import {once} from 'node:events';
export const TOKEN='a'.repeat(64);
export async function fakeBridge(handler:(r:any,s:net.Socket)=>void) {
  const sockets=new Set<net.Socket>();
  const server=net.createServer(s=>{
    sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('error',()=>{});
    s.setEncoding('utf8');let buffer='';
    s.on('data',b=>{buffer+=b;while(buffer.includes('\n')){const i=buffer.indexOf('\n');const line=buffer.slice(0,i);buffer=buffer.slice(i+1);handler(JSON.parse(line),s)}});
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  return {port:(server.address() as net.AddressInfo).port,close:async()=>{for(const s of sockets)s.destroy();server.close();await once(server,'close')}};
}
export function respond(s:net.Socket,r:any,result:any) {s.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\n')}
export function hello(r:any,s:net.Socket):boolean {
  if(r.method!=='bridge.hello')return false;
  respond(s,r,{protocol:3,version:'2.99.42',capabilities:{ruby:true,pbr:false}});
  return true;
}
