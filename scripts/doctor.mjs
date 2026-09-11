import {SketchupClient} from '../dist/sketchup-client.js';
import {configPath} from '../dist/config.js';
const client=new SketchupClient();
try { const result=await client.call('bridge.status'); console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,config:configPath(),bridge:result},null,2)); }
catch(e){console.error(JSON.stringify({success:false,code:e.code,message:e.message,config:configPath()}));process.exitCode=1}
finally{await client.close()}
