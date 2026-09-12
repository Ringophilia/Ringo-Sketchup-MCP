import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {session} from './mcp-session.mjs';
if(!process.argv[2]) throw Error('Usage: node scripts/ruby.mjs SCRIPT.rb [--no-transaction]');
const path=resolve(process.argv[2]);
const source=await readFile(path,'utf8');
const s=await session();
try {
  await s.call('model_get_info');
  console.log(JSON.stringify(await s.call('sketchup_run_ruby',{code:`TOPLEVEL_BINDING.eval(${JSON.stringify(source)},${JSON.stringify(path)},1)`,transaction:!process.argv.includes('--no-transaction')}),null,2));
} finally {await s.close();}
