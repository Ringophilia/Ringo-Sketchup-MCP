import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {session} from './mcp-session.mjs';

const s=await session();
const ids=[]; const checks=[]; const prefix='Ringo regression '+randomUUID();
let info, camera;
const ruby=async(code,transaction=true)=> (await s.call('sketchup_run_ruby',{code,transaction,model_id:info.model_id})).result;
const near=(a,b)=>assert.ok(Math.abs(a-b)<0.001,`${a} != ${b}`);
try {
  info=await s.call('model_get_info');
  if(info.active_path.length) throw Error('Run the reference regression from the root model context.');
  camera=await s.call('camera_get');
  const parent=await ruby(`g=Sketchup.active_model.entities.add_group; g.name=${JSON.stringify(prefix)}; g.entities.add_face([0,0,0],[1,0,0],[0,1,0]); g.transformation=Geom::Transformation.new([0,2,0,0,-3,0,0,0,0,0,1,0,1000.mm,2000.mm,300.mm,1]); g.persistent_id`);
  ids.push(parent);
  const child=(await s.call('entity_create_box',{parent_id:parent,size:[40,50,60],origin:[10,20,30],name:prefix+' child'})).entity;
  assert.deepEqual(child.path,[parent,child.persistent_id]);
  [940,2020,330].forEach((v,i)=>near(child.transform[12+i],v));
  const byPath=(await s.call('entity_inspect',{path:child.path})).entity;
  const scoped=(await s.call('entity_list',{path:[parent],type:'Group'})).entities[0];
  assert.deepEqual(byPath.transform,scoped.transform);
  const native=await ruby(`m=Sketchup.active_model; t=Sketchup::InstancePath.new(${JSON.stringify(child.path)}.map { |id| m.find_entity_by_persistent_id(id) }).transformation.to_a; t[12,3]=t[12,3].map { |x| x*25.4 }; t`);
  native.forEach((v,i)=>near(child.transform[i],v));
  checks.push('nested rotated and scaled parent: create/list/inspect match native InstancePath');

  const instance=await ruby(`m=Sketchup.active_model; g=m.find_entity_by_persistent_id(${parent}); copy=m.entities.add_instance(g.definition,Geom::Transformation.translation([5000.mm,0,0])); copy.persistent_id`);
  ids.push(instance);
  await assert.rejects(s.call('entity_delete',{entity_id:child.persistent_id}),/multiple instance paths/);
  const shared=(await s.call('entity_inspect',{path:[instance,child.persistent_id]})).entity;
  near(shared.transform[12],5010);
  const copy=(await s.call('entity_duplicate',{path:[instance],translation:[0,500,0]})).entity;
  ids.push(copy.persistent_id); near(copy.transform[13],500);
  checks.push('shared definitions reject ambiguous delete and duplicate component correctly');

  await s.call('entity_update',{path:[parent],locked:true});
  await assert.rejects(s.call('entity_delete',{path:[parent,child.persistent_id]}),/locked/);
  await s.call('entity_update',{path:[parent],locked:false});
  await assert.rejects(s.call('entity_create_box',{model_id:'wrong-model',size:[1,2,3]}),/model/);
  checks.push('locked ancestor and stale model guard preserve geometry');

  await s.call('entity_make_unique',{path:[instance]});
  const uniqueChildren=(await s.call('entity_list',{path:[instance],type:'Group'})).entities;
  assert.notEqual(uniqueChildren[0].persistent_id,child.persistent_id);
  await s.call('entity_update',{path:uniqueChildren[0].path,name:prefix+' independent'});
  assert.equal((await s.call('entity_inspect',{path:child.path})).entity.name,prefix+' child');
  checks.push('make_unique isolates edits and returns fresh child references');

  await ruby(`Sketchup.active_model.active_path=[Sketchup.active_model.find_entity_by_persistent_id(${instance})]; true`,false);
  await assert.rejects(s.call('entity_create_box',{size:[2,3,4]}),/context/);
  await s.call('model_get_info');
  const inContext=(await s.call('entity_create_box',{size:[20,30,40],origin:[1,2,3],name:prefix+' context'})).entity;
  assert.equal(inContext.path[0],instance);
  const nativeContext=await ruby(`m=Sketchup.active_model; t=Sketchup::InstancePath.new(${JSON.stringify(inContext.path)}.map { |id| m.find_entity_by_persistent_id(id) }).transformation.to_a; t[12,3]=t[12,3].map { |v| v*25.4 }; t`);
  nativeContext.forEach((v,i)=>near(inContext.transform[i],v));
  await ruby('Sketchup.active_model.active_path=nil; true',false);
  await s.call('model_get_info');
  checks.push('edit context changes reject stale writes; context creation matches native world transform');

  await s.call('camera_set',{entity_id:parent});
  const preview=await s.client.callTool({name:'view_capture',arguments:{width:800,height:600}});
  assert.notEqual(preview.isError,true);
  const image=preview.content.find(item=>item.type==='image');
  assert.ok(image);
  assert.equal(image.mimeType,'image/png');
  const bytes=Buffer.from(image.data,'base64');
  assert.equal(bytes.subarray(1,4).toString(),'PNG');
  assert.equal(bytes.readUInt32BE(16),800); assert.equal(bytes.readUInt32BE(20),600);
  assert.equal(preview.structuredContent.data.image_base64,undefined,'large base64 must not be duplicated in structuredContent');
  await mkdir(join(s.root,'artifacts'),{recursive:true});
  await writeFile(join(s.root,'artifacts/reference-preview.png'),bytes);
  checks.push('view_capture returns an actual PNG with requested dimensions');
} finally {
  if(info) {
    await ruby('Sketchup.active_model.active_path=nil; true',false).catch(()=>{});
    await s.call('model_get_info').catch(()=>{});
    for(const id of ids.reverse()) await s.call('entity_delete',{entity_id:id,model_id:info.model_id}).catch(()=>{});
    if(camera) await s.call('camera_set',{eye:camera.eye,target:camera.target,up:camera.up,perspective:camera.perspective,fov:camera.fov}).catch(()=>{});
  }
  await s.close();
}
await writeFile(join(s.root,'artifacts/live-references.json'),JSON.stringify({success:true,host:info.sketchup_version,checked_at:new Date().toISOString(),checks},null,2));
console.log(JSON.stringify({success:true,checks},null,2));
