import {cp,mkdir,readFile,writeFile,readdir,stat,chmod,rename,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const installOptions={year:{type:'string'},plugins:{type:'string'},profile:{type:'string'},name:{type:'string'},port:{type:'string'},'enable-ruby':{type:'boolean'},'dry-run':{type:'boolean'},help:{type:'boolean'}};
export function defaultConfigPath(platform=process.platform,home=homedir(),appdata=process.env.APPDATA) {
  return join(platform==='win32' ? join(appdata || join(home,'AppData','Roaming'),'RingoSketchUpMCP') : platform==='darwin' ? join(home,'Library','Application Support','RingoSketchUpMCP') : join(home,'.config','ringo-sketchup-mcp'),'config.json');
}
export function validateProfileId(profile) {
  if(typeof profile!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(profile)) throw Error('profile 必须以字母或数字开头，只能包含字母、数字、点、下划线和短横线 / Invalid profile id.');
  return profile;
}
export function configRootPath(platform=process.platform,home=homedir(),appdata=process.env.APPDATA) {
  return dirname(defaultConfigPath(platform,home,appdata));
}
export function profileConfigPath(profile,platform=process.platform,home=homedir(),appdata=process.env.APPDATA) {
  validateProfileId(profile);
  return join(configRootPath(platform,home,appdata),'profiles',profile+'.json');
}
export function profilesRegistryPath(platform=process.platform,home=homedir(),appdata=process.env.APPDATA) {
  return join(configRootPath(platform,home,appdata),'profiles.json');
}
export function validateConfig(config) {
  if(!config || typeof config!=='object' || Array.isArray(config)) throw Error('配置必须是 JSON 对象 / Config must be a JSON object.');
  if(config.host!==undefined && config.host!=='127.0.0.1') throw Error('host 必须是 127.0.0.1 / Only local loopback is supported.');
  if(!Number.isInteger(config.port) || config.port<1 || config.port>65535) throw Error('端口必须在 1–65535 之间 / Invalid port.');
  if(typeof config.token!=='string' || config.token.length<32) throw Error('认证配置无效 / Token must contain at least 32 characters.');
  if(typeof config.ruby_enabled!=='boolean') throw Error('ruby_enabled 必须为 true 或 false / Invalid Ruby permission.');
  return config;
}
export async function readJson(path) {
  const source=await readFile(path,'utf8');
  try {return JSON.parse(source.replace(/^\uFEFF/,''));} catch {throw Error(`JSON 格式无效 / Invalid JSON: ${path}`);}
}
async function exists(path) {try {await stat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
export async function installExtension(values={},context={}) {
  const platform=context.platform ?? process.platform;
  const home=context.home ?? homedir();
  const appdata=context.appdata ?? process.env.APPDATA;
  const profile=values.profile ?? context.profile;
  if(profile) validateProfileId(profile);
  const configPath=resolve(context.configPath ?? (profile ? profileConfigPath(profile,platform,home,appdata) : process.env.SKETCHUP_MCP_CONFIG ?? defaultConfigPath(platform,home,appdata)));
  if(values.year && !/^20\d\d$/.test(values.year)) throw Error('--year 需要四位年份，例如 2026 / Expected a SketchUp year.');
  const base=platform==='win32' ? join(appdata || join(home,'AppData','Roaming'),'SketchUp') : join(home,'Library','Application Support');
  let plugins=values.plugins;
  if(!plugins) {
    if(!['win32','darwin'].includes(platform)) throw Error('SketchUp 需要 Windows 或 macOS 桌面宿主 / Pass --plugins for packaging tests.');
    const years=(await readdir(base).catch(e=>{if(e.code==='ENOENT')return [];throw e;})).filter(name=>/^SketchUp 20\d\d$/.test(name)).sort().reverse();
    const folder=values.year ? 'SketchUp '+values.year : years[0];
    if(!folder || !years.includes(folder)) throw Error('未发现 SketchUp 用户目录。先启动 SketchUp，或指定 --plugins PATH / Launch SketchUp first.');
    plugins=join(base,folder,'SketchUp','Plugins');
  }
  plugins=resolve(plugins);
  let config={host:'127.0.0.1',port:profile && profile!=='default' ? 9877 : 9876,token:randomBytes(32).toString('hex'),ruby_enabled:false};
  const originalConfig=await exists(configPath) ? await readFile(configPath) : undefined;
  if(originalConfig) config={...config,...await readJson(configPath)};
  if(values['enable-ruby']) config.ruby_enabled=true;
  if(values.port!==undefined) { const port=Number(values.port); if(!Number.isInteger(port)) throw Error('--port 必须是数字 / Invalid port.'); config.port=port; }
  if(profile) { config.profile_id=profile; config.profile_name=values.name ?? config.profile_name ?? profile; }
  validateConfig(config);
  const pkg=await readJson(join(root,'package.json'));
  const report={version:pkg.version,profile:profile ?? config.profile_id ?? 'default',profile_name:config.profile_name ?? profile ?? 'default',port:config.port,plugins,config:configPath,ruby_enabled:config.ruby_enabled,restart_required:true,dry_run:!!values['dry-run'],backup:null};
  const registryPath=context.registryPath ?? (context.configPath ? join(dirname(configPath),'profiles.json') : profilesRegistryPath(platform,home,appdata));
  const originalRegistry=await exists(registryPath) ? await readFile(registryPath) : undefined;
  const registry=originalRegistry ? await readJson(registryPath) : {version:1,profiles:[]};
  if(!Array.isArray(registry.profiles)) throw Error('Invalid profiles registry: '+registryPath);
  const conflicting=registry.profiles.find(item=>item && item.id!==report.profile && item.port===config.port);
  if(conflicting) throw Error(`端口 ${config.port} 已配置给 profile ${conflicting.id}。请使用 --port 选择独立端口 / Profile port conflict.`);
  registry.profiles=registry.profiles.filter(item=>item && item.id!==report.profile);
  registry.profiles.push({id:report.profile,name:report.profile_name,port:config.port,config:configPath,ruby_enabled:config.ruby_enabled});
  if(values['dry-run']) return report;
  await mkdir(plugins,{recursive:true});
  await mkdir(dirname(configPath),{recursive:true});
  const stage=join(plugins,'.ringo-stage-'+randomUUID());
  const loader=join(plugins,'ringo_sketchup_mcp.rb');
  const implementation=join(plugins,'ringo_sketchup_mcp');
  const backup=join(dirname(configPath),'backups',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID());
  const hadLoader=await exists(loader), hadImplementation=await exists(implementation);
  let changed=false;
  try {
    await mkdir(stage);
    await cp(join(root,'extension/ringo_sketchup_mcp'),join(stage,'ringo_sketchup_mcp'),{recursive:true});
    await cp(join(root,'extension/ringo_sketchup_mcp.rb'),join(stage,'ringo_sketchup_mcp.rb'));
    await cp(join(root,'LICENSE'),join(stage,'ringo_sketchup_mcp/LICENSE'));
    if(hadLoader || hadImplementation) {
      await mkdir(backup,{recursive:true});
      if(hadLoader) await cp(loader,join(backup,'ringo_sketchup_mcp.rb'));
      if(hadImplementation) await cp(implementation,join(backup,'ringo_sketchup_mcp'),{recursive:true});
      report.backup=backup;
    }
    changed=true;
    if(hadImplementation) await rm(implementation,{recursive:true});
    await rename(join(stage,'ringo_sketchup_mcp'),implementation);
    await cp(join(stage,'ringo_sketchup_mcp.rb'),loader);
    const configTemp=configPath+'.'+randomUUID()+'.tmp';
    try {await writeFile(configTemp,JSON.stringify(config,null,2)+'\n',{mode:0o600});await rename(configTemp,configPath);}
    finally {await rm(configTemp,{force:true});}
    if(platform!=='win32') await chmod(configPath,0o600);
    await writeFile(join(dirname(configPath),'installation.json'),JSON.stringify({version:pkg.version,plugins,installed_at:new Date().toISOString()},null,2));
    await mkdir(dirname(registryPath),{recursive:true});
    await writeFile(registryPath,JSON.stringify(registry,null,2)+'\n');
    return report;
  } catch(error) {
    if(changed) {
      await rm(implementation,{recursive:true,force:true});
      if(hadImplementation) await cp(join(backup,'ringo_sketchup_mcp'),implementation,{recursive:true});
      if(hadLoader) await cp(join(backup,'ringo_sketchup_mcp.rb'),loader);
      else await rm(loader,{force:true});
      if(originalConfig) await writeFile(configPath,originalConfig,{mode:0o600});
      else await rm(configPath,{force:true});
      if(originalRegistry) await writeFile(registryPath,originalRegistry);
      else await rm(registryPath,{force:true});
    }
    throw error;
  } finally {await rm(stage,{recursive:true,force:true});}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const {values}=parseArgs({options:installOptions});
    if(values.help) console.log('Install: node scripts/install.mjs [--year 2026 | --plugins PATH] [--profile project-a --port 9876] [--enable-ruby] [--dry-run]\n多开时每个 SketchUp 模型选择独立 profile。');
    else console.log(JSON.stringify(await installExtension(values),null,2));
  } catch(error) {console.error('安装失败 / Installation failed: '+error.message);process.exitCode=1;}
}
