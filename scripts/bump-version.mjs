import {readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// package.json is the single source of truth; every other shipped copy is listed here.
export const versionSources=[
  {file:'src/protocol.ts',pattern:/(export const VERSION = ')([^']+)(')/},
  {file:'extension/ringo_sketchup_mcp.rb',pattern:/(ext\.version = ')([^']+)(')/},
  {file:'extension/ringo_sketchup_mcp/config.rb',pattern:/(VERSION = ')([^']+)(')/},
  {file:'extension/extension.json',pattern:/("version": ")([^"]+)(")/},
  {file:'README.md',pattern:/(badge\/version-)([0-9][^-]*)(-)/}
];
export async function readVersions(directory=root) {
  const pkg=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
  const versions={'package.json':pkg.version};
  for(const {file,pattern} of versionSources) versions[file]=(await readFile(join(directory,file),'utf8')).match(pattern)?.[2];
  return versions;
}
export async function bumpVersion(version,directory=root) {
  if(!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? '')) throw Error('Usage: node scripts/bump-version.mjs X.Y.Z');
  const pkg=join(directory,'package.json');
  await writeFile(pkg,(await readFile(pkg,'utf8')).replace(/("version": ")([^"]+)(")/,`$1${version}$3`));
  const lock=join(directory,'package-lock.json'); const json=JSON.parse(await readFile(lock,'utf8'));
  json.version=version; if(json.packages?.['']) json.packages[''].version=version;
  await writeFile(lock,JSON.stringify(json,null,2)+'\n');
  for(const {file,pattern} of versionSources) {
    const path=join(directory,file); const source=await readFile(path,'utf8');
    if(!pattern.test(source)) throw Error('Version marker not found: '+file);
    await writeFile(path,source.replace(pattern,`$1${version}$3`));
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {await bumpVersion(process.argv[2]); console.log(await readVersions());}
  catch(error) {console.error(error.message); process.exitCode=1;}
}
