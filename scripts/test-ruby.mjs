import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const result = spawnSync(process.env.RUBY || 'ruby', [fileURLToPath(new URL('../test/ruby/contracts_test.rb',import.meta.url))], {stdio:'inherit',windowsHide:true});
if(result.error) console.error('Install Ruby 2.7+ (with minitest), or set RUBY to its executable path. '+result.error.message);
process.exitCode=result.status ?? 1;
