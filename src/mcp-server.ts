import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SketchupClient } from './sketchup-client.js';
import { VERSION, RpcError } from './protocol.js';
import { pathToFileURL } from 'node:url';

const n = z.number().finite();
const vec = z.tuple([n,n,n]);
const positive = z.tuple([n.positive(),n.positive(),n.positive()]);
const unit = z.enum(['mm','cm','m','in','ft']).default('mm');
const id = z.number().int().positive().safe();
const ref = {entity_id: id, model_id: z.string().optional(), path: z.array(id).min(1).max(32).optional()};
const output = {path:z.string().min(1), overwrite:z.boolean().default(false)};
const name = z.string().min(1).max(255);
const defs: Array<{name:string; method:string; description:string; schema:z.ZodRawShape; read?:boolean; destructive?:boolean}> = [
{name:'bridge_status',method:'bridge.status',description:'Inspect connection, capabilities, queue and recent request states. Runtime permissions and optional APIs are discovered here.',schema:{},read:true},
{name:'model_get_info',method:'model.get_info',description:'Get model session ID, path, units, edit context and runtime capabilities.',schema:{},read:true},
{name:'model_stats',method:'model.stats',description:'Count entities through instance paths, materials, tags and scenes.',schema:{},read:true},
{name:'entity_list',method:'entity.list',description:'Paginate entities with paths and world bounds. Recursive traversal distinguishes shared component instances.',schema:{type:name.optional(),name:name.optional(),tag:name.optional(),recursive:z.boolean().default(false),max_depth:z.number().int().min(0).max(32).default(16),limit:z.number().int().min(1).max(1000).default(100),offset:z.number().int().nonnegative().default(0),unit},read:true},
{name:'entity_inspect',method:'entity.inspect',description:'Inspect persistent ID, instance path, world bounds, solid status and transform. Translation entries in matrices use the requested unit.',schema:{...ref,unit},read:true},
{name:'selection_get',method:'selection.get',description:'Read current selected entities.',schema:{},read:true},
{name:'selection_set',method:'selection.set',description:'Set selection using existing entity IDs; empty list clears selection.',schema:{entity_ids:z.array(id).max(1000)}},
{name:'entity_create_box',method:'entity.create_box',description:'Create a box toward positive Z with an undo transaction. Default unit is mm.',schema:{size:positive,origin:vec.optional(),unit,name:name.optional(),tag:name.optional(),parent_id:id.optional()}},
{name:'entity_create_cylinder',method:'entity.create_cylinder',description:'Create a positive Z cylinder, in mm, with optional smooth sides.',schema:{radius_mm:n.positive(),height_mm:n.positive(),origin:vec.optional(),unit,segments:z.number().int().min(8).max(256).default(48),smooth:z.boolean().default(false),name:name.optional(),tag:name.optional(),parent_id:id.optional()}},
{name:'entity_create_mesh',method:'entity.create_mesh',description:'Create arbitrary grouped geometry from vertices and zero-based face indices. Triangulate nonplanar faces. Supports smooth shading.',schema:{vertices:z.array(vec).min(3).max(50000),faces:z.array(z.array(z.number().int().nonnegative()).min(3).max(256)).min(1).max(100000),smooth:z.boolean().default(true),origin:vec.optional(),unit,name:name.optional(),tag:name.optional(),parent_id:id.optional()}},
{name:'entity_extrude',method:'entity.extrude',description:'Extrude a planar polygon along its normal. XY polygons are oriented toward positive Z.',schema:{points:z.array(vec).min(3).max(1000),distance:n,origin:vec.optional(),unit,name:name.optional(),tag:name.optional(),parent_id:id.optional()}},
{name:'entity_transform',method:'entity.transform',description:'Transform a group/instance in its parent coordinates. Scale, rotate, then translate. Matrix replaces transform; column major with translation in unit. Axis-angle preferred; legacy Euler X,Y,Z supported.',schema:{...ref,unit,translation:vec.optional(),rotation_degrees:vec.optional(),axis:vec.optional(),angle_degrees:n.optional(),pivot:vec.optional(),scale:positive.optional(),matrix:z.array(n).length(16).optional()}},
{name:'entity_update',method:'entity.update',description:'Set entity name, tag, visibility or lock state.',schema:{...ref,name:name.optional(),tag:name.optional(),hidden:z.boolean().optional(),locked:z.boolean().optional()}},
{name:'entity_delete',method:'entity.delete',description:'Delete an existing entity in an undoable operation.',schema:ref,destructive:true},
{name:'entity_duplicate',method:'entity.duplicate',description:'Copy a group or component; offset in the parent coordinate system.',schema:{...ref,name:name.optional(),translation:vec.default([0,0,0]),unit}},
{name:'entity_group',method:'entity.group',description:'Group existing entities in the current edit context.',schema:{entity_ids:z.array(id).min(1).max(1000),name:name.optional()}},
{name:'entity_make_unique',method:'entity.make_unique',description:'Make a component instance or group independent of shared geometry.',schema:ref},
{name:'entity_set_material',method:'entity.set_material',description:'Assign material to an instance or its direct faces. Faces scope makes instances unique first.',schema:{...ref,material:name,color:vec.optional(),scope:z.enum(['instance','faces']).default('instance')}},
{name:'materials_list',method:'materials.list',description:'List material color, alpha and texture status.',schema:{},read:true},
{name:'materials_set',method:'materials.set',description:'Create/update material. Optional PBR roughness gracefully falls back on older SketchUp.',schema:{name,color:z.tuple([n.min(0).max(255),n.min(0).max(255),n.min(0).max(255)]).optional(),alpha:n.min(0).max(1).optional(),texture:z.string().optional(),roughness:n.min(0).max(1).optional()}},
{name:'tags_list',method:'tags.list',description:'List tags and visibility.',schema:{},read:true},
{name:'tags_set',method:'tags.set',description:'Create a tag or set its visibility.',schema:{name,visible:z.boolean().optional()}},
{name:'scenes_list',method:'scene.list',description:'List saved SketchUp scenes.',schema:{},read:true},
{name:'scenes_set',method:'scene.set',description:'Save/update the current view as a scene, or select an existing scene.',schema:{name,action:z.enum(['save','select']).default('save')}},
{name:'camera_get',method:'camera.get',description:'Read camera eye, target and up vector.',schema:{},read:true},
{name:'camera_set',method:'camera.set',description:'Set camera and optionally frame an entity or the whole model.',schema:{eye:vec.optional(),target:vec.optional(),up:vec.optional(),perspective:z.boolean().optional(),fov:n.min(1).max(120).optional(),entity_id:id.optional(),zoom_extents:z.boolean().optional(),unit}},
{name:'model_snapshot',method:'model.snapshot',description:'Capture bounded entity/path metadata for subsequent changes comparison.',schema:{},read:true},
{name:'model_diff',method:'model.diff',description:'Compare entity metadata with a snapshot; reports additions, deletions and changes, not individual mesh vertices.',schema:{snapshot_id:z.string()},read:true},
{name:'model_undo',method:'model.undo',description:'Undo the most recent SketchUp operation.',schema:{},destructive:true},
{name:'model_redo',method:'model.redo',description:'Redo when supported by this SketchUp version.',schema:{},destructive:true},
{name:'scene_clear',method:'scene.clear',description:'Erase all model entities in one undoable operation. Requires root edit context.',schema:{},destructive:true},
{name:'model_save',method:'model.save',description:'Save SKP to an absolute path. Explicit overwrite flag protects existing files.',schema:output},
{name:'model_export',method:'model.export',description:'Export through the installed SketchUp exporter selected by file extension. Availability depends on the host edition/version.',schema:{...output,options:z.record(z.unknown()).optional()}},
{name:'view_export',method:'view.export',description:'Export PNG/JPG from SketchUp for visual verification.',schema:{...output,width:z.number().int().min(64).max(4096).default(1600),height:z.number().int().min(64).max(4096).default(1200),transparent:z.boolean().default(false)}},
{name:'batch_run',method:'batch.run',description:'Run 1–100 typed model mutations in a single atomic undo operation. Ruby, save, undo, and nested batches excluded.',schema:{commands:z.array(z.object({method:z.string(),params:z.record(z.unknown()).default({})})).min(1).max(100),operation_name:name.default('MCP batch')}},
{name:'sketchup_run_ruby',method:'ruby.eval',description:'Execute trusted SketchUp Ruby on the UI thread. Requires ruby_enabled. Default transaction rolls back failures; do not start nested SketchUp operations. Captures stdout. Running Ruby cannot be forcibly cancelled safely.',schema:{code:z.string().min(1).refine(s=>Buffer.byteLength(s)<=200000,'Code exceeds 200 KB'),transaction:z.boolean().default(true),operation_name:name.default('MCP Ruby')},destructive:true},
];
export function createServer(client = new SketchupClient()) {
  const server = new McpServer({name:'Ringo SketchUp MCP',version:VERSION}, {instructions:'Use bridge_status to discover optional APIs. Read model and entity paths before editing. Lengths default to mm; model references are session scoped. Use generic tools or Ruby scripts, never model-specific server additions. Inspect geometry and export a view to verify visual work. A timeout is not proof that a mutation did not execute.'});
  for (const def of defs) server.registerTool(def.name, {
    description:def.description,inputSchema:def.schema,
    annotations:{readOnlyHint:!!def.read,destructiveHint:!!def.destructive,idempotentHint:!!def.read,openWorldHint:def.method==='ruby.eval'}
  }, async (args, extra) => {
    const started=Date.now();
    const token=extra._meta?.progressToken;
    try {
      if (token !== undefined) await extra.sendNotification({method:'notifications/progress',params:{progressToken:token,progress:0,total:1,message:'Waiting for SketchUp'}});
      const raw=await client.call(def.method,args,extra.signal) as Record<string,unknown>;
      const result = raw && typeof raw==='object' && 'success' in raw ? raw : {success:true,data:raw,warnings:[]};
      if (token !== undefined) await extra.sendNotification({method:'notifications/progress',params:{progressToken:token,progress:1,total:1,message:'Completed'}});
      return {content:[{type:'text' as const,text:JSON.stringify(result)}],structuredContent:result};
    } catch(error) {
      const e=error as Error;
      const result={success:false,error:{code:e instanceof RpcError ? e.code : -32603,message:e.message,details:e instanceof RpcError ? e.data ?? null : null},elapsed_ms:Date.now()-started};
      return {isError:true,content:[{type:'text' as const,text:JSON.stringify(result)}],structuredContent:result};
    }
  });
  return {server,client};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const {server,client}=createServer();
  const shutdown=async()=>{ await client.close(); await server.close(); };
  process.once('SIGINT',()=>void shutdown()); process.once('SIGTERM',()=>void shutdown());
  process.stdin.once('end',()=>void shutdown());
  await server.connect(new StdioServerTransport());
}
