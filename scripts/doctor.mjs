import {access} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {defaultConfigPath,readJson,validateConfig} from './install.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export async function diagnose({offline=false,directory=root,configPath=process.env.SKETCHUP_MCP_CONFIG ?? defaultConfigPath(),plugins}={}) {
  const checks=[];
  const add=(code,status,message,fix)=>checks.push({code,status,message,...(fix?{fix}: {})});
  const pkg=await readJson(join(directory,'package.json'));
  let ready=true;
  try {await access(join(directory,'dist/mcp-server.js'));add('build','ok','Node 服务已构建 / Server is built');}
  catch {ready=false;add('build','error','缺少构建输出 / Build missing','npm run build');}
  try {
    const config=await readJson(configPath);
    validateConfig({...config,token:process.env.SKETCHUP_TOKEN ?? config.token,port:Number(process.env.SKETCHUP_PORT ?? config.port)});
    add('config','ok','本地配置有效 / Local configuration is valid');
  } catch(error) {ready=false;add('config','error',error.code==='ENOENT'?'未安装配置 / Config missing':error.message,'npm run setup');}
  if(!plugins) {
    try {plugins=(await readJson(join(dirname(configPath),'installation.json'))).plugins;}catch{ /* RBZ/manual installs have no receipt. */ }
  }
  if(plugins) {
    try {
      for(const file of ['ringo_sketchup_mcp.rb','ringo_sketchup_mcp/main.rb','ringo_sketchup_mcp/config.rb','ringo_sketchup_mcp/operations.rb','ringo_sketchup_mcp/references.rb','ringo_sketchup_mcp/view.rb','ringo_sketchup_mcp/server.rb']) await access(join(plugins,file));
      add('extension','ok','扩展文件完整 / Extension files present');
    } catch {ready=false;add('extension','error','扩展安装不完整 / Incomplete extension','npm run setup，然后重启 SketchUp / then restart SketchUp');}
  } else add('extension','warning','没有安装记录；RBZ 手动安装通过实时连接验证 / No install receipt');
  let bridge;
  if(!offline && ready) {
    let client;
    try {
      const {SketchupClient}=await import(pathToFileURL(join(directory,'dist/sketchup-client.js')).href);
      client=new SketchupClient({timeoutMs:5000,connectTimeoutMs:2000});
      bridge=await client.call('bridge.status');
      if(bridge.version!==pkg.version) add('bridge','error',`运行中的扩展版本 ${bridge.version}，项目版本 ${pkg.version} / Version mismatch`,'npm run setup，然后关闭并重新启动 SketchUp');
      else add('bridge','ok',`SketchUp ${bridge.sketchup_version} / Ruby ${bridge.ruby_version} 已连接`);
    } catch(error) {
      const code=error.code;
      add('bridge','error',code===-32001?'认证失败 / Authentication failed':'SketchUp 未连接 / Bridge unavailable',code===-32001?'检查 Node 和 SketchUp 使用相同配置目录，再重启两端':'打开 SketchUp 模型，Extensions → Ringo SketchUp MCP → Start Server');
    } finally {await client?.close();}
  } else add('bridge','skipped',offline?'离线检查未连接 SketchUp / Offline check':'先修复安装问题 / Fix installation first');
  const success=!checks.some(check=>check.status==='error');
  return {success,mode:offline?'offline':'live',version:pkg.version,node:process.version,platform:process.platform,config:configPath,checks,...(bridge?{bridge}:{})};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const {values}=parseArgs({options:{json:{type:'boolean'},offline:{type:'boolean'},help:{type:'boolean'},plugins:{type:'string'}}});
    if(values.help) console.log('node scripts/doctor.mjs [--json] [--offline] [--plugins PATH]');
    else {
      const report=await diagnose(values);
      if(values.json) console.log(JSON.stringify(report,null,2));
      else {
        console.log(`Ringo SketchUp MCP ${report.version} · ${report.platform} · ${report.node}`);
        for(const check of report.checks) {console.log(`[${check.status.toUpperCase()}] ${check.message}`);if(check.fix)console.log(`  → ${check.fix}`);}
        console.log(`配置目录 / Config: ${report.config}`);
      }
      if(!report.success) process.exitCode=1;
    }
  } catch(error) {console.error('诊断失败 / Diagnosis failed: '+error.message);process.exitCode=1;}
}
