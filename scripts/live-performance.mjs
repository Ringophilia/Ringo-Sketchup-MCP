import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {session} from './mcp-session.mjs';
const s=await session();let root;const timings={};
try {
  const info=await s.call('model_get_info');
  if(info.active_path.length) throw Error('Use the root edit context for the performance regression.');
  const marker='Ringo performance '+randomUUID();
  const result=await s.call('sketchup_run_ruby',{code:`m=Sketchup.active_model; g=m.entities.add_group; g.name=${JSON.stringify(marker)}; d=m.definitions.add(${JSON.stringify(marker)}); d.entities.add_face([0,0,0],[1,0,0],[1,1,0],[0,1,0]).pushpull(1); last=nil; 5000.times { |i| last=g.entities.add_instance(d,Geom::Transformation.translation([i%100*2,i/100*2,0])) }; {root:g.persistent_id,last:last.persistent_id,definition:d.guid}`});
  root=result.result.root;
  let started=performance.now();
  const page=await s.call('entity_list',{path:[root],limit:100});
  timings.first_page_ms=Math.round(performance.now()-started);
  assert.equal(page.entities.length,100);assert.equal(page.scanned,101);assert.equal(page.next_offset,100);
  assert.equal(page.total_exact,false);
  started=performance.now();
  const last=await s.call('entity_inspect',{entity_id:result.result.last});
  timings.last_entity_ms=Math.round(performance.now()-started);
  assert.deepEqual(last.entity.path,[root,result.result.last]);
  const capped=await s.call('entity_list',{path:[root],include_total:true,scan_limit:1000,limit:10});
  assert.equal(capped.total_exact,false);assert.equal(capped.truncated,true);assert.equal(capped.scanned,1000);
  // A generous regression threshold detects accidental full-model scans without
  // claiming a real-time guarantee for all machines and arbitrary geometry.
  assert.ok(timings.first_page_ms<5000 && timings.last_entity_ms<5000);
  await writeFile(join(s.root,'artifacts/live-performance.json'),JSON.stringify({success:true,instances:5000,timings,host:info.sketchup_version,checked_at:new Date().toISOString()},null,2));
  console.log(JSON.stringify({success:true,instances:5000,timings}));
} finally {
  if(root) await s.call('entity_delete',{entity_id:root});
  await s.close();
}
