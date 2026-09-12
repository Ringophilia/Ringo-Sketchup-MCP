import {access,realpath,mkdir,writeFile} from 'node:fs/promises';
import {dirname,join,resolve,delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {installOptions,installExtension} from './install.mjs';
import {agentConfigs} from './agent-config.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
async function npmCli() {
  const candidates=[process.env.npm_execpath,join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),join(dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')];
  for(const dir of (process.env.PATH || '').split(delimiter)) candidates.push(join(dir,'npm'));
  for(const path of candidates.filter(Boolean)) {try {const actual=await realpath(path);await access(actual);if(actual.endsWith('.js'))return actual;}catch{}}
  throw Error('找不到 npm。请安装 Node.js 22/24 LTS（含 npm） / Install Node.js LTS with npm.');
}
try {
  const {values}=parseArgs({options:installOptions});
  if(values.help) console.log('node scripts/setup.mjs [--year 2026 | --plugins PATH] [--enable-ruby] [--dry-run]\n安装依赖、构建、备份安装扩展、生成客户端配置 / Prepare the full local installation.');
  else {
    if(Number(process.versions.node.split('.')[0])<22) throw Error('请升级到 Node.js 22 或 24 / Node.js 22+ required.');
    const plan=await installExtension({...values,'dry-run':true});
    if(values['dry-run']) console.log(JSON.stringify(plan,null,2));
    else {
      const npm=await npmCli();
      for(const args of [['ci'],['run','build']]) {
        console.log('准备 / Preparing: npm '+args.join(' '));
        const result=spawnSync(process.execPath,[npm,...args],{cwd:root,stdio:'inherit',windowsHide:true});
        if(result.status!==0) throw Error('npm '+args.join(' ')+' 失败；修复上面的错误后重新运行 / See the error above.');
      }
      const installed=await installExtension(values);
      const output=installed.profile==='default' ? join(root,'.agent-config') : join(root,'.agent-config',installed.profile);await mkdir(output,{recursive:true});
      for(const [name,content] of Object.entries(agentConfigs({config:installed.config,name:installed.profile==='default'?'sketchup':`sketchup-${installed.profile}`}))) await writeFile(join(output,name),content,'utf8');
      console.log(`\n安装完成 / Installed ${installed.version}\n扩展 / Extension: ${installed.plugins}\n配置片段 / Client configs: ${output}`);
      if(installed.backup) console.log('旧版本备份 / Backup: '+installed.backup);
      console.log('1. 关闭并重新打开 SketchUp / Restart SketchUp.\n2. 按 docs/agents.md 导入客户端配置 / Import the generated client config.\n3. npm run doctor\n4. 让 Agent 调用 model_get_info，然后 view_capture / Verify the connection and preview.');
    }
  }
} catch(error) {console.error('准备失败 / Setup failed: '+error.message);process.exitCode=1;}
