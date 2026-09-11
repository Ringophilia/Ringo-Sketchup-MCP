import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
const files=['extension/ringo_sketchup_mcp.rb',...readdirSync('extension/ringo_sketchup_mcp').filter(f=>f.endsWith('.rb')).map(f=>'extension/ringo_sketchup_mcp/'+f)];
for(const file of files){const r=spawnSync('ruby',['-c',file],{stdio:'inherit',windowsHide:true});if(r.error)console.error('Ruby syntax check could not run: '+r.error.message);if(r.status!==0)process.exit(r.status||1)}
