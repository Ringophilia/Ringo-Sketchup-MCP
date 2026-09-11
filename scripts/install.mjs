import {cp,mkdir,readFile,writeFile,readdir,stat,chmod} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const option=k=>{const i=args.indexOf(k);return i<0?undefined:args[i+1]};
const base=process.platform==='win32' ? join(process.env.APPDATA||join(homedir(),'AppData','Roaming'),'SketchUp') : join(homedir(),'Library','Application Support');
let plugins=option('--plugins');
if(!plugins) {
  const years=(await readdir(base).catch(()=>[])).filter(n=>/^SketchUp 20\d\d$/.test(n)).sort().reverse();
  const year=option('--year'); const folder=year?'SketchUp '+year:years[0];
  if(!folder) throw Error('No SketchUp user folder detected. Launch SketchUp once, or pass --plugins PATH.');
  plugins=join(base,folder,'SketchUp','Plugins');
}
const configRoot=process.platform==='win32' ? join(process.env.APPDATA||join(homedir(),'AppData','Roaming'),'RingoSketchUpMCP') : process.platform==='darwin' ? join(homedir(),'Library','Application Support','RingoSketchUpMCP') : join(homedir(),'.config','ringo-sketchup-mcp');
const configPath=process.env.SKETCHUP_MCP_CONFIG||join(configRoot,'config.json');
await mkdir(dirname(configPath),{recursive:true});
let config={host:'127.0.0.1',port:9876,token:randomBytes(32).toString('hex'),ruby_enabled:false};
try {config={...config,...JSON.parse(await readFile(configPath,'utf8'))}} catch(e) {if(e.code!=='ENOENT')throw e}
if(args.includes('--enable-ruby')) config.ruby_enabled=true;
await writeFile(configPath,JSON.stringify(config,null,2)+'\n',{mode:0o600});
if(process.platform!=='win32')await chmod(configPath,0o600);
await mkdir(plugins,{recursive:true});
const installed=join(plugins,'ringo_sketchup_mcp');
try {await stat(installed); await cp(installed,join(configRoot,'backups',String(Date.now()),'ringo_sketchup_mcp'),{recursive:true})}catch(e){if(e.code!=='ENOENT')throw e}
await cp(join(root,'extension/ringo_sketchup_mcp'),installed,{recursive:true});
await cp(join(root,'LICENSE'),join(installed,'LICENSE'));
await cp(join(root,'extension/ringo_sketchup_mcp.rb'),join(plugins,'ringo_sketchup_mcp.rb'));
console.log(JSON.stringify({plugins,config:configPath,ruby_enabled:config.ruby_enabled,restart_required:true,mcp:{command:process.execPath,args:[join(root,'dist/mcp-server.js')]}},null,2));
