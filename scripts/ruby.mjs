import {readFile} from 'node:fs/promises';
import {session} from './mcp-session.mjs';
const s=await session();
try {console.log(JSON.stringify(await s.call('sketchup_run_ruby',{code:await readFile(process.argv[2],'utf8'),transaction:!process.argv.includes('--no-transaction')}),null,2))}
finally{await s.close()}
