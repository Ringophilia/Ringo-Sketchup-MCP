import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {session} from './mcp-session.mjs';
const s=await session();const checks=[];const ids=[];
const call=async(name,args={})=>{const d=await s.call(name,args);checks.push(name);return d};
const near=(a,b)=>assert.ok(Math.abs(a-b)<0.001,a+' != '+b);
try {
  const info=await call('model_get_info'); const status=await call('bridge_status');
  assert.equal(status.protocol,3);
  await call('model_stats'); const camera=await call('camera_get');
  const snap=await call('model_snapshot');
  const box=(await call('entity_create_box',{size:[30,20,10],origin:[100,0,40],tag:'MCP QA',name:'QA Box'})).entity;
  ids.push(box.persistent_id);assert.equal(box.tag,'MCP QA');near(box.bounds.min[2],40);near(box.bounds.max[2],50);
  const b=await call('entity_transform',{entity_id:box.persistent_id,translation:[10,0,0],scale:[2,1,1],axis:[0,0,1],angle_degrees:90});
  near(b.entity.bounds.size[0],20);near(b.entity.bounds.size[1],60);
  await call('entity_update',{entity_id:box.persistent_id,name:'QA Renamed'});
  await call('materials_set',{name:'MCP QA Color',color:[12,140,60],roughness:0.4,alpha:1});
  await call('entity_set_material',{entity_id:box.persistent_id,material:'MCP QA Color'});
  await call('materials_list'); await call('tags_set',{name:'MCP QA',visible:true});await call('tags_list');
  const duplicate=(await call('entity_duplicate',{entity_id:box.persistent_id,name:'QA Copy',translation:[0,100,0]})).entity;ids.push(duplicate.persistent_id);
  await call('entity_make_unique',{entity_id:duplicate.persistent_id});
  await call('selection_set',{entity_ids:[box.persistent_id]});
  assert.equal((await call('selection_get')).entities.length,1);
  const cylinder=(await call('entity_create_cylinder',{radius_mm:10,height_mm:25,origin:[200,0,35],name:'QA Cylinder',tag:'MCP QA',smooth:true})).entity;ids.push(cylinder.persistent_id);near(cylinder.bounds.max[2],60);
  const mesh=(await call('entity_create_mesh',{vertices:[[0,0,0],[20,0,0],[0,20,0],[0,0,20]],faces:[[0,2,1],[0,1,3],[1,2,3],[2,0,3]],origin:[300,0,0],name:'QA Mesh'})).entity;ids.push(mesh.persistent_id);assert.equal(mesh.solid,true);
  const extrusion=(await call('entity_extrude',{points:[[0,0,0],[30,0,0],[20,20,0],[0,20,0]],distance:12,origin:[400,0,0],name:'QA Extrusion'})).entity;ids.push(extrusion.persistent_id);
  const group=(await call('entity_group',{entity_ids:[mesh.persistent_id,extrusion.persistent_id],name:'QA Assembly'})).entity;ids.push(group.persistent_id);
  const paths=await call('entity_list',{recursive:true,name:'QA Mesh'});assert.equal(paths.entities[0].path.length,2);
  await call('entity_inspect',{entity_id:mesh.persistent_id,path:paths.entities[0].path,model_id:info.model_id});
  await assert.rejects(s.call('entity_inspect',{entity_id:mesh.persistent_id,model_id:'wrong-session'}),/model/);
  const count=(await call('entity_list',{name:'QA Rollback'})).total;
  await assert.rejects(s.call('batch_run',{commands:[{method:'entity.create_box',params:{size:[1,2,3],name:'QA Rollback'}},{method:'entity.create_box',params:{size:[-1,2,3]}}]}));
  assert.equal((await call('entity_list',{name:'QA Rollback'})).total,count);
  const batch=await call('batch_run',{commands:[{method:'entity.update',params:{entity_id:box.persistent_id,name:'QA Batch'}},{method:'entity.update',params:{entity_id:duplicate.persistent_id,name:'QA Batch Copy'}}]});
  await call('model_undo');assert.equal((await call('entity_inspect',{entity_id:box.persistent_id})).entity.name,'QA Renamed');
  if(status.capabilities.redo){await call('model_redo');assert.equal((await call('entity_inspect',{entity_id:box.persistent_id})).entity.name,'QA Batch')}
  const diff=await call('model_diff',{snapshot_id:snap.snapshot_id});assert.ok(diff.added.length>=5);
  const script=await call('sketchup_run_ruby',{code:'puts "hello"; {answer: 6*7, main_thread: Thread.current == Thread.main}'});assert.equal(script.result.answer,42);assert.equal(script.result.main_thread,true);assert.match(script.stdout,/hello/);
  await assert.rejects(s.call('sketchup_run_ruby',{code:"g=Sketchup.active_model.entities.add_group; g.name='QA Script Rollback'; raise 'rollback proof'"}),/rollback proof/);
  assert.equal((await call('entity_list',{name:'QA Script Rollback'})).total,0);
  await assert.rejects(s.call('sketchup_run_ruby',{code:'def ! syntax broken'}));
  await call('model_get_info');
  await call('scenes_set',{name:'MCP QA View',action:'save'});await call('scenes_list');await call('scenes_set',{name:'MCP QA View',action:'select'});
  await call('camera_set',{eye:[250,-250,220],target:[0,0,40],up:[0,0,1]});
  await mkdir(resolve(s.root,'artifacts'),{recursive:true});
  await call('view_export',{path:resolve(s.root,'artifacts/qa-view.png'),overwrite:true,width:800,height:600});
  // Remove only QA objects created by this test. User model is preserved.
  for(const id of [group.persistent_id,cylinder.persistent_id,duplicate.persistent_id,box.persistent_id]) await call('entity_delete',{entity_id:id});
  ids.length=0;
  await call('sketchup_run_ruby',{code:"m=Sketchup.active_model; p=m.pages['MCP QA View']; m.pages.erase(p) if p; true"});
  await call('camera_set',{eye:camera.eye,target:camera.target,up:camera.up,perspective:camera.perspective,fov:camera.fov});
  const s2=await session();try {await Promise.all([call('model_get_info'),s2.call('model_get_info')]);checks.push('multi-client')}finally{await s2.close()}
  await writeFile(resolve(s.root,'artifacts/live-test.json'),JSON.stringify({success:true,host:info.sketchup_version,checked_at:new Date().toISOString(),checks:[...new Set(checks)]},null,2));
  console.log(JSON.stringify({success:true,checks:checks.length,unique:[...new Set(checks)]}));
} finally {
  for(const id of ids.reverse())try{await s.call('entity_delete',{entity_id:id})}catch{}
  await s.close();
}
