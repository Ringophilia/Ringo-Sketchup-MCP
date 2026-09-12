import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SketchupClient } from './sketchup-client.js';
import { VERSION, RpcError } from './protocol.js';
import { pathToFileURL } from 'node:url';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';

const n = z.number().finite();
const vec = z.tuple([n,n,n]);
const positive = z.tuple([n.positive(),n.positive(),n.positive()]);
const unit = z.enum(['mm','cm','m','in','ft']).default('mm');
const id = z.number().int().positive().safe();
const ref = {entity_id: id.optional(), model_id: z.string().optional(), path: z.array(id).min(1).max(32).optional()};
const modelRef = {model_id: z.string().min(1).optional(), active_path:z.array(id).max(32).optional()};
const parentRef = z.object({entity_id:id.optional(),model_id:z.string().optional(),path:z.array(id).min(1).max(32).optional()}).refine(value=>value.entity_id !== undefined || value.path !== undefined,'Parent requires entity_id or path');
const output = {path:z.string().min(1), overwrite:z.boolean().default(false)};
const name = z.string().min(1).max(255);
const defs: Array<{name:string; method:string; description:string; schema:z.ZodRawShape; read?:boolean; destructive?:boolean}> = [
{name:'bridge_status',method:'bridge.status',description:'Inspect connection, selected SketchUp profile/instance, capabilities, queue and recent request states. Runtime permissions and optional APIs are discovered here.',schema:{},read:true},
{name:'model_get_info',method:'model.get_info',description:'Get model session ID, path, units, edit context and runtime capabilities.',schema:{},read:true},
{name:'model_stats',method:'model.stats',description:'Count entities through instance paths, materials, tags and scenes. Results are bounded by max_entities.',schema:{...modelRef,max_entities:z.number().int().min(1000).max(1000000).default(100000)},read:true},
{name:'entity_list',method:'entity.list',description:'Paginate entities with paths and world bounds. Recursive traversal distinguishes shared component instances. Use scan_limit for large models; total_exact reports whether total is complete.',schema:{...modelRef,entity_id:id.optional(),path:z.array(id).min(1).max(32).optional(),type:name.optional(),name:name.optional(),tag:name.optional(),recursive:z.boolean().default(false),max_depth:z.number().int().min(0).max(32).default(16),limit:z.number().int().min(1).max(1000).default(100),offset:z.number().int().nonnegative().default(0),include_total:z.boolean().default(false),scan_limit:z.number().int().min(1000).max(1000000).default(100000),unit},read:true},
{name:'entity_inspect',method:'entity.inspect',description:'Inspect persistent ID, instance path, world bounds, solid status and transform. Translation entries in matrices use the requested unit.',schema:{...ref,unit},read:true},
{name:'selection_get',method:'selection.get',description:'Read current selected entities.',schema:{},read:true},
{name:'selection_set',method:'selection.set',description:'Set selection using existing entity IDs; empty list clears selection.',schema:{...modelRef,entity_ids:z.array(id).max(1000)}},
{name:'entity_create_box',method:'entity.create_box',description:'Create a box toward positive Z with an undo transaction. Default unit is mm.',schema:{...modelRef,size:positive,origin:vec.optional(),unit,name:name.optional(),tag:name.optional(),parent_id:id.optional(),parent:parentRef.optional()}},
{name:'entity_create_cylinder',method:'entity.create_cylinder',description:'Create a positive Z cylinder, in mm, with optional smooth sides.',schema:{...modelRef,radius_mm:n.positive(),height_mm:n.positive(),origin:vec.optional(),unit,segments:z.number().int().min(8).max(256).default(48),smooth:z.boolean().default(false),name:name.optional(),tag:name.optional(),parent_id:id.optional(),parent:parentRef.optional()}},
{name:'entity_create_mesh',method:'entity.create_mesh',description:'Create arbitrary grouped geometry from vertices and zero-based face indices. Triangulate nonplanar faces. Supports smooth shading.',schema:{...modelRef,vertices:z.array(vec).min(3).max(50000),faces:z.array(z.array(z.number().int().nonnegative()).min(3).max(256)).min(1).max(100000),smooth:z.boolean().default(true),origin:vec.optional(),unit,name:name.optional(),tag:name.optional(),parent_id:id.optional(),parent:parentRef.optional()}},
{name:'entity_extrude',method:'entity.extrude',description:'Extrude a planar polygon along its normal. XY polygons are oriented toward positive Z.',schema:{...modelRef,points:z.array(vec).min(3).max(1000),distance:n,origin:vec.optional(),unit,name:name.optional(),tag:name.optional(),parent_id:id.optional(),parent:parentRef.optional()}},
{name:'entity_transform',method:'entity.transform',description:'Transform a group/instance in its parent coordinates. Scale, rotate, then translate. Matrix replaces transform; column major with translation in unit. Axis-angle preferred; legacy Euler X,Y,Z supported.',schema:{...ref,unit,translation:vec.optional(),rotation_degrees:vec.optional(),axis:vec.optional(),angle_degrees:n.optional(),pivot:vec.optional(),scale:positive.optional(),matrix:z.array(n).length(16).optional()}},
{name:'entity_update',method:'entity.update',description:'Set entity name, tag, visibility or lock state.',schema:{...ref,name:name.optional(),tag:name.optional(),hidden:z.boolean().optional(),locked:z.boolean().optional()}},
{name:'entity_delete',method:'entity.delete',description:'Delete an existing entity in an undoable operation.',schema:ref,destructive:true},
{name:'entity_duplicate',method:'entity.duplicate',description:'Copy a group or component; offset in the parent coordinate system.',schema:{...ref,name:name.optional(),translation:vec.default([0,0,0]),unit}},
{name:'entity_group',method:'entity.group',description:'Group existing entities in the current edit context.',schema:{...modelRef,entity_ids:z.array(id).min(1).max(1000),name:name.optional()}},
{name:'entity_make_unique',method:'entity.make_unique',description:'Make a component instance or group independent of shared geometry.',schema:ref},
{name:'entity_set_material',method:'entity.set_material',description:'Assign material to an instance or its direct faces. Faces scope makes instances unique first.',schema:{...ref,material:name,color:vec.optional(),scope:z.enum(['instance','faces']).default('instance')}},
{name:'materials_list',method:'materials.list',description:'List material color, alpha and texture status.',schema:{},read:true},
{name:'materials_set',method:'materials.set',description:'Create/update material. Optional PBR roughness gracefully falls back on older SketchUp.',schema:{...modelRef,name,color:z.tuple([n.min(0).max(255),n.min(0).max(255),n.min(0).max(255)]).optional(),alpha:n.min(0).max(1).optional(),texture:z.string().optional(),roughness:n.min(0).max(1).optional()}},
{name:'tags_list',method:'tags.list',description:'List tags and visibility.',schema:{},read:true},
{name:'tags_set',method:'tags.set',description:'Create a tag or set its visibility.',schema:{...modelRef,name,visible:z.boolean().optional()}},
{name:'scenes_list',method:'scene.list',description:'List saved SketchUp scenes.',schema:{},read:true},
{name:'scenes_set',method:'scene.set',description:'Save/update the current view as a scene, or select an existing scene.',schema:{...modelRef,name,action:z.enum(['save','select']).default('save')}},
{name:'camera_get',method:'camera.get',description:'Read camera eye, target and up vector.',schema:{},read:true},
{name:'camera_set',method:'camera.set',description:'Set camera and optionally frame an entity or the whole model.',schema:{...modelRef,eye:vec.optional(),target:vec.optional(),up:vec.optional(),perspective:z.boolean().optional(),height:n.positive().optional(),fov:n.min(1).max(120).optional(),entity_id:id.optional(),path:z.array(id).min(1).max(32).optional(),zoom_extents:z.boolean().optional(),unit}},
{name:'model_snapshot',method:'model.snapshot',description:'Capture bounded entity/path metadata for subsequent changes comparison.',schema:modelRef,read:true},
{name:'model_diff',method:'model.diff',description:'Compare entity metadata with a snapshot; reports additions, deletions and changes, not individual mesh vertices.',schema:{...modelRef,snapshot_id:z.string()},read:true},
{name:'model_undo',method:'model.undo',description:'Undo the most recent SketchUp operation.',schema:modelRef,destructive:true},
{name:'model_redo',method:'model.redo',description:'Redo when supported by this SketchUp version.',schema:modelRef,destructive:true},
{name:'scene_clear',method:'scene.clear',description:'Erase all model entities in one undoable operation. Requires root edit context.',schema:modelRef,destructive:true},
{name:'model_save',method:'model.save',description:'Save SKP to an absolute path. Explicit overwrite flag protects existing files.',schema:{...modelRef,...output}},
{name:'model_export',method:'model.export',description:'Export through the installed SketchUp exporter selected by file extension. Availability depends on the host edition/version.',schema:{...modelRef,...output,options:z.record(z.unknown()).optional()}},
{name:'view_capture',method:'view.capture',description:'See the current SketchUp view directly as an image. No output path required. Use after modeling to visually verify the result.',schema:{...modelRef,width:z.number().int().min(64).max(2048).default(1280),height:z.number().int().min(64).max(2048).default(960),transparent:z.boolean().default(false)},read:true},
{name:'view_export',method:'view.export',description:'Export PNG/JPG from SketchUp for visual verification.',schema:{...modelRef,...output,width:z.number().int().min(64).max(4096).default(1600),height:z.number().int().min(64).max(4096).default(1200),transparent:z.boolean().default(false)}},
{name:'batch_run',method:'batch.run',description:'Run 1–100 typed model mutations in a single atomic undo operation. Ruby, save, undo, and nested batches excluded.',schema:{...modelRef,commands:z.array(z.object({method:z.string(),params:z.record(z.unknown()).default({})})).min(1).max(100),operation_name:name.default('MCP batch')}},
{name:'sketchup_run_ruby',method:'ruby.eval',description:'Execute trusted SketchUp Ruby on the UI thread. Requires ruby_enabled. Default transaction rolls back failures; do not start nested SketchUp operations. Captures stdout. Running Ruby cannot be forcibly cancelled safely.',schema:{...modelRef,code:z.string().min(1).refine(s=>Buffer.byteLength(s)<=200000,'Code exceeds 200 KB'),transaction:z.boolean().default(true),operation_name:name.default('MCP Ruby')},destructive:true},
];
export function createServer(client = new SketchupClient()) {
  let observedModel: {model_id:string;active_path:number[]} | undefined;
  const server = new McpServer({name:'Ringo SketchUp MCP',version:VERSION}, {instructions:'Call bridge_status first and confirm data.instance.profile_id, data.instance.profile_name, and port identify the intended SketchUp process. Read model_get_info before editing. Lengths default to mm; model references are session scoped. Use generic tools or Ruby scripts, never model-specific server additions. Inspect geometry and export a view to verify visual work. A timeout is not proof that a mutation did not execute.'});
  for (const def of defs) server.registerTool(def.name, {
    description:def.description,inputSchema:z.object(def.schema).strict(),
    annotations:{readOnlyHint:!!def.read,destructiveHint:!!def.destructive,idempotentHint:!!def.read,openWorldHint:def.method==='ruby.eval'}
  }, async (args, extra) => {
    const started=Date.now();
    const token=extra._meta?.progressToken;
    try {
      if (token !== undefined) await extra.sendNotification({method:'notifications/progress',params:{progressToken:token,progress:0,total:1,message:'Waiting for SketchUp'}});
      if (referenceMethods.has(def.method) && (!args || (args.entity_id === undefined && args.path === undefined))) {
        throw new RpcError('Entity reference requires entity_id or path',-32602);
      }
      validateArguments(def.method,args);
      const guarded = {...args} as Record<string,unknown>;
      if (!def.read) {
        guarded.model_id ??= observedModel?.model_id;
        if (!guarded.model_id) throw new RpcError('Read model_get_info before editing, or provide its model_id.',-32007);
        const usesContext = ['selection.set','entity.group','scene.clear','batch.run'].includes(def.method) || (['entity.create_box','entity.create_cylinder','entity.create_mesh','entity.extrude'].includes(def.method) && !guarded.parent && !guarded.parent_id);
        if (usesContext && observedModel?.model_id === guarded.model_id) guarded.active_path ??= observedModel.active_path;
      }
      const requestArgs = def.method === 'batch.run' ? validateBatchArgs(guarded) : guarded;
      const raw=await client.call(def.method,requestArgs,extra.signal) as Record<string,unknown>;
      const result = raw && typeof raw==='object' && 'success' in raw ? raw : {success:true,data:raw,warnings:[]};
      if (def.method === 'model.get_info') {
        const data=result.data as {model_id?:unknown;active_path?:unknown};
        if (data && typeof data.model_id === 'string' && Array.isArray(data.active_path)) observedModel={model_id:data.model_id,active_path:data.active_path};
      }
      if (token !== undefined) await extra.sendNotification({method:'notifications/progress',params:{progressToken:token,progress:1,total:1,message:'Completed'}}).catch(()=>{});
      let preview: {type:'image';data:string;mimeType:string} | undefined;
      if(def.method==='view.capture') {
        const data=result.data as Record<string,unknown>;
        if(typeof data?.image_base64 !== 'string' || data.mime_type !== 'image/png' || data.image_base64.length>3*1024*1024) throw new RpcError('Invalid preview response',-32600);
        preview={type:'image',data:data.image_base64,mimeType:'image/png'};
        const {image_base64,...metadata}=data;
        result.data=metadata;
      }
      const content: Array<{type:'text';text:string}|{type:'image';data:string;mimeType:string}> = [{type:'text',text:JSON.stringify(result)}];
      if (preview) content.push(preview);
      if (def.method === 'view.export' && result && typeof result === 'object' && 'data' in result) {
        const output = (result as {data?: unknown}).data;
        const path = output && typeof output === 'object' && typeof (output as {path?: unknown}).path === 'string'
          ? (output as {path: string}).path : undefined;
        const ext = path?.toLowerCase().split('.').pop();
        if (path && resolve(path)===resolve(String(guarded.path)) && (ext === 'png' || ext === 'jpg' || ext === 'jpeg')) {
          try {
            const file=await open(path,'r');
            try {
              if ((await file.stat()).size <= 4*1024*1024) {
                const bytes=Buffer.alloc(4*1024*1024+1);
                const {bytesRead}=await file.read(bytes,0,bytes.length,0);
                if(bytesRead<=4*1024*1024) content.push({type:'image',data:bytes.subarray(0,bytesRead).toString('base64'),mimeType:ext === 'png' ? 'image/png' : 'image/jpeg'});
              }
            } finally { await file.close(); }
          } catch { /* the path remains available in structuredContent */ }
        }
      }
      return {content,structuredContent:result};
    } catch(error) {
      const e=error as Error;
      const result={success:false,error:{code:e instanceof RpcError ? e.code : -32603,message:e.message,details:e instanceof RpcError ? e.data ?? null : null},elapsed_ms:Date.now()-started};
      return {isError:true,content:[{type:'text' as const,text:JSON.stringify(result)}],structuredContent:result};
    }
  });
  return {server,client};
}

const batchMethods = new Set([
  'scene.clear','entity.create_box','entity.create_cylinder','entity.create_mesh','entity.extrude',
  'entity.transform','entity.delete','entity.set_material','entity.update','entity.duplicate',
  'entity.group','entity.make_unique','tags.set','materials.set','scene.set'
]);
const referenceMethods = new Set(['entity.inspect','entity.transform','entity.update','entity.delete','entity.duplicate','entity.make_unique','entity.set_material']);
function validateArguments(method:string, args:Record<string,unknown>): void {
  const fail=(message:string):never=>{throw new RpcError(message,-32602);};
  if(referenceMethods.has(method) && args.entity_id===undefined && args.path===undefined) fail('Entity reference requires entity_id or path');
  if(args.entity_id!==undefined && Array.isArray(args.path) && args.path.at(-1)!==args.entity_id) fail('Entity ID must match the last ID in path');
  if(args.parent!==undefined && args.parent_id!==undefined) fail('Use either parent or parent_id');
  if(method==='entity.transform') {
    if((args.axis===undefined)!==(args.angle_degrees===undefined)) fail('axis and angle_degrees must be provided together');
    if(Array.isArray(args.axis) && args.axis.every(v=>v===0)) fail('Rotation axis cannot be zero');
    if(args.matrix && ['translation','scale','axis','angle_degrees','rotation_degrees','pivot'].some(k=>args[k]!==undefined)) fail('matrix cannot be combined with scale, rotation, pivot or translation');
    if(args.axis && args.rotation_degrees) fail('Choose axis-angle or Euler rotation');
  }
  if(method==='camera.set') {
    if((args.eye===undefined)!==(args.target===undefined)) fail('eye and target must be provided together');
    if(args.up && !args.eye) fail('up requires eye and target');
  }
  if(method==='entity.create_mesh') {
    const vertices=args.vertices as unknown[]; const faces=args.faces as number[][];
    if(faces.some(face=>face.some(index=>index>=vertices.length) || new Set(face).size!==face.length)) fail('Mesh faces require distinct valid vertex indices');
  }
  if(method==='entity.extrude' && args.distance===0) fail('Extrusion distance cannot be zero');
}
function validateBatchArgs(input: unknown): Record<string, unknown> {
  const parsed = z.object({
    ...modelRef,
    commands:z.array(z.object({method:z.string(),params:z.record(z.unknown()).default({})})).min(1).max(100),
    operation_name:name.default('MCP batch')
  }).strict().safeParse(input);
  if (!parsed.success) throw new RpcError('Invalid batch request: '+parsed.error.issues.map(issue=>issue.message).join('; '),-32602,parsed.error.issues);
  const args = parsed.data;
  const commands = args.commands.map((command,index) => {
    const definition = defs.find(definition => definition.method === command.method || definition.name === command.method);
    if (!definition || !batchMethods.has(definition.method)) throw new RpcError(`Batch command ${index+1} is not an allowed model mutation: ${command.method}`,-32602);
    if (referenceMethods.has(definition.method) && command.params.entity_id === undefined && command.params.path === undefined) {
      throw new RpcError(`Entity reference required for batch command ${index+1} (${command.method})`,-32602);
    }
    const checked = z.object(definition.schema).strict().safeParse(command.params);
    if (!checked.success) throw new RpcError(`Invalid parameters for batch command ${index+1} (${command.method}): `+checked.error.issues.map(issue=>issue.message).join('; '),-32602,checked.error.issues);
    validateArguments(definition.method,checked.data);
    const params = {...checked.data} as Record<string, unknown>;
    if (args.model_id && params.model_id !== undefined && params.model_id !== args.model_id) {
      throw new RpcError(`Batch command ${index+1} model_id does not match the batch model_id`,-32602);
    }
    if (args.model_id && params.model_id === undefined) params.model_id = args.model_id;
    if (args.active_path && 'active_path' in definition.schema) params.active_path ??= args.active_path;
    return {method:definition.method,params};
  });
  return {...args,commands};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const {server,client}=createServer();
  const shutdown=async()=>{ await client.close(); await server.close(); };
  process.once('SIGINT',()=>void shutdown()); process.once('SIGTERM',()=>void shutdown());
  process.stdin.once('end',()=>void shutdown());
  await server.connect(new StdioServerTransport());
}
