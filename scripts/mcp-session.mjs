import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export async function session(){
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const transport=new StdioClientTransport({command:process.execPath,args:[resolve(root,'dist/mcp-server.js')],env:Object.fromEntries(Object.entries(process.env).filter(([,v])=>v!==undefined)),stderr:'inherit'});
  const client=new Client({name:'ringo-verifier',version:'3'},{capabilities:{}});
  await client.connect(transport);
  const call=async(name,args={})=>{
    const res=await client.callTool({name,arguments:args},undefined,{timeout:180000});
    const result=res.structuredContent||JSON.parse(res.content[0].text);
    if(res.isError||result.success===false) throw new Error(name+': '+JSON.stringify(result));
    return result.data ?? result;
  };
  return {client,call,root,close:()=>client.close()};
}
