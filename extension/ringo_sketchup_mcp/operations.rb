require_relative 'references'
require_relative 'view'
module RingoSketchupMCP
  MUTATIONS = %w[scene.clear entity.create_box entity.create_cylinder entity.create_mesh entity.extrude entity.transform entity.delete entity.set_material entity.update entity.duplicate entity.group entity.make_unique tags.set materials.set scene.set]
  module_function
  def model; Sketchup.active_model || raise(BridgeError.new('Open a SketchUp model first', -32007)); end
  def model_id; @models ||= {}; @models[model] ||= SecureRandom.uuid; end
  def number(value)
    raise ArgumentError, 'Expected a finite number' unless value.is_a?(Numeric) && value.to_f.finite?
    value.to_f
  end
  def vector(value, positive = false)
    raise ArgumentError, 'Expected three numbers' unless value.is_a?(Array) && value.size == 3
    value.map { |v| n=number(v); raise ArgumentError, 'Dimensions/scales must be positive' if positive && n <= 0; n }
  end
  def factor(unit); {'mm'=>1.0/25.4, 'cm'=>10.0/25.4, 'm'=>1000.0/25.4, 'in'=>1.0, 'ft'=>12.0}.fetch(unit || 'mm') { raise ArgumentError, 'Unsupported unit' }; end
  def point(values, unit = 'mm'); vector(values).map { |v| v * factor(unit) }; end
  def children(e); e.is_a?(Sketchup::Group) ? e.entities : e.is_a?(Sketchup::ComponentInstance) ? e.definition.entities : nil; end
  def pid(e); e.respond_to?(:persistent_id) ? e.persistent_id : e.entityID; end
  def find_entity(id)
    e = if model.respond_to?(:find_entity_by_persistent_id)
      model.find_entity_by_persistent_id(Integer(id))
    else
      model.find_entity_by_id(Integer(id))
    end
    raise BridgeError.new('Entity reference is stale', -32008) unless e && e.valid?
    e
  end
  def bounds_data(bounds, unit='mm')
    f=factor(unit)
    {min: bounds.min.to_a.map { |v| v/f }, max: bounds.max.to_a.map { |v| v/f }, size: [bounds.width,bounds.height,bounds.depth].map { |v| v.to_f/f }, unit: unit}
  end
  def summary(e, path, transform=Geom::Transformation.new, unit='mm')
    b = Geom::BoundingBox.new
    if e.bounds.valid?
      8.times { |i| b.add(e.bounds.corner(i).transform(transform)) }
    end
    own = e.respond_to?(:transformation) ? e.transformation : Geom::Transformation.new
    matrix = (transform * own).to_a
    matrix[12,3] = matrix[12,3].map { |v| v / factor(unit) }
    {
      persistent_id: pid(e), model_id: model_id, path: path, type: e.typename,
      name: e.respond_to?(:name) ? e.name : '', tag: e.layer.name,
      material: e.respond_to?(:material) && e.material ? e.material.name : nil,
      hidden: e.hidden?, locked: e.respond_to?(:locked?) ? e.locked? : false,
      bounds: b.valid? ? bounds_data(b,unit) : nil, transform: matrix,
      transform_layout: 'column_major_translation_in_' + unit,
      child_count: children(e) ? children(e).length : 0,
      solid: e.respond_to?(:manifold?) ? e.manifold? : nil,
      definition_id: e.respond_to?(:definition) ? e.definition.guid : nil,
      reference_lifetime: e.respond_to?(:persistent_id) ? 'model_persistent_with_session_guard' : 'current_session_only'
    }
  end
  def walk(collection=model.entities, path=[], transform=Geom::Transformation.new, depth=0, max_depth=31, budget=nil, &block)
    budget ||= {visited:0, deadline:Process.clock_gettime(Process::CLOCK_MONOTONIC)+0.5}
    collection.each do |e|
      budget[:visited] += 1
      if budget[:visited] % 128 == 0 && Process.clock_gettime(Process::CLOCK_MONOTONIC) > budget[:deadline]
        return :budget
      end
      p = path + [pid(e)]
      result = yield e,p,transform
      return :stopped if result == :stop
      nested=children(e)
      if nested && depth < max_depth
        result = walk(nested,p,transform*e.transformation,depth+1,max_depth,budget,&block)
        return result if result
      elsif nested && nested.length > 0
        budget[:depth_limited] = true
      end
    end
    nil
  end
  def list_entities(params)
    depth = params['recursive'] ? Integer(params.fetch('max_depth',16)) : 0
    depth = [[depth,0].max,32].min
    limit = [[Integer(params.fetch('limit',100)),1].max,1000].min
    offset = [Integer(params.fetch('offset',0)),0].max
    rows=[]; total=0; scanned=0; truncated=false; more=false; unit=params.fetch('unit','mm')
    scan_limit = [[Integer(params.fetch('scan_limit',100000)),1000].max,1000000].min
    if params['path'] || params['entity_id']
      located = locate_ref(params)
      root = children(located[:entity]); base_path = located[:path]; base_transform = located[:transform]
    else
      root = model.entities; base_path = []; base_transform = Geom::Transformation.new
    end
    raise ArgumentError, 'Entity has no children' unless root
    outcome=walk(root,base_path,base_transform,0,depth) do |e,path,trans|
      if scanned >= scan_limit
        truncated=true
        :stop
      else
        scanned += 1
        next if params['type'] && e.typename.downcase != params['type'].downcase
        next if params['name'] && (!e.respond_to?(:name) || !e.name.include?(params['name']))
        next if params['tag'] && e.layer.name != params['tag']
        rows << summary(e,path,trans,unit) if total >= offset && rows.length < limit
        total+=1
        if !params['include_total'] && total > offset+limit
          more=true
          :stop
        end
      end
    end
    truncated ||= outcome == :budget
    if truncated
      @warnings << 'Query reached its work budget. Scope entity_list to a parent path, reduce max_depth, or use more specific queries.'
    end
    {entities: rows, total: total, total_exact: !truncated && !more, scanned: scanned, scan_limit: scan_limit, truncated: truncated, next_offset: offset+rows.length < total ? offset+rows.length : nil, model_id: model_id}
  end
  def transaction(name)
    model.start_operation(name, true)
    begin
      result=yield
      model.commit_operation
      result
    rescue StandardError, SyntaxError
      model.abort_operation
      raise
    end
  end
  def serialize(value, depth=0)
    raise ArgumentError,'Result nesting exceeds 12 levels' if depth > 12
    case value
    when NilClass,TrueClass,FalseClass,String,Integer; value
    when Numeric; number(value)
    when Array
      raise ArgumentError,'Result array too large; paginate' if value.size > 100000
      value.map { |v| serialize(v,depth+1) }
    when Hash; value.each_with_object({}) { |(k,v),h| h[k.to_s]=serialize(v,depth+1) }
    else
      value.respond_to?(:persistent_id) ? {persistent_id: pid(value),type:value.typename} : value.to_s
    end
  end
  def dispatch(method, params, nested=false)
    @warnings=[] unless nested
    check_model(params)
    if !nested && MUTATIONS.include?(method)
      begin
        @editing = true
        return transaction(method) { dispatch(method,params,true) }
      ensure
        @editing = false
      end
    end
    case method
    when 'model.get_info'
      {model_id: model_id, instance:instance_identity, title: model.title, path: model.path, modified: model.modified?,
       sketchup_version: Sketchup.version, ruby_version: RUBY_VERSION, units: %w[in ft mm cm m][model.options['UnitsOptions']['LengthUnit']] || 'unknown',
       entity_count: model.entities.length, selection_count: model.selection.length,
       active_path: (model.active_path || []).map { |e| pid(e) }, capabilities: capabilities}
    when 'model.stats'
      counts=Hash.new(0); solids=0; scanned=0; max_entities=[[Integer(params.fetch('max_entities',100000)),1000].max,1000000].min; truncated=false
      budget={visited:0, deadline:Process.clock_gettime(Process::CLOCK_MONOTONIC)+0.5}
      outcome=walk(model.entities,[],Geom::Transformation.new,0,31,budget) do |e,_,_|
        if scanned >= max_entities
          truncated=true
          :stop
        else
          scanned+=1; counts[e.typename]+=1; solids+=1 if e.respond_to?(:manifold?) && e.manifold?
        end
      end
      truncated ||= outcome == :budget || budget[:depth_limited]
      {model_id: model_id, counts: counts, solid_instances: solids, scanned: scanned, max_entities: max_entities, total_exact: !truncated, definitions:model.definitions.length, materials:model.materials.length,tags:model.layers.length,scenes:model.pages.length}
    when 'entity.list'; list_entities(params)
    when 'entity.inspect'; inspect_entity(params)
    when 'selection.get'
      prefix=(model.active_path || []).map { |e| pid(e) }
      {entities: model.selection.map { |e|
        ref={'entity_id'=>pid(e)}
        ref['path']=prefix + [pid(e)] unless prefix.empty?
        inspect_entity(ref)[:entity]
      }}
    when 'selection.set'
      list=Array(params.fetch('entity_ids')).map { |id| find_entity(id) }
      raise ArgumentError,'Selection must be in the current edit context' unless list.all? { |e| model.active_entities.include?(e) }
      model.selection.clear; model.selection.add(list) unless list.empty?
      {count: model.selection.length}
    when 'scene.clear'
      raise ArgumentError,'Leave the current component edit context before clearing' if model.active_path
      count=model.entities.length
      model.entities.erase_entities(model.entities.to_a)
      {deleted_count:count}
    when 'entity.create_box','entity.create_cylinder','entity.create_mesh','entity.extrude'
      create_geometry(method,params)
    when 'entity.transform'
      e=resolve_ref(params)
      raise ArgumentError,'Transform requires a group or component instance' unless e.respond_to?(:transform!)
      raise ArgumentError,'Entity is locked' if e.locked?
      unit=params.fetch('unit','mm')
      # Validate everything before the first mutation; operations are rolled back on failure.
      scale=params['scale'] ? vector(params['scale'],true) : nil
      translation=params['translation'] ? point(params['translation'],unit) : nil
      rotation=params['rotation_degrees'] ? vector(params['rotation_degrees']) : nil
      center=params['pivot'] ? Geom::Point3d.new(point(params['pivot'],unit)) : e.bounds.center
      if params['matrix']
        values=params['matrix']; raise ArgumentError,'Expected 16 finite matrix values' unless values.is_a?(Array) && values.size==16
        values=values.map { |v| number(v) }
        raise ArgumentError,'Only affine matrices are supported' unless [values[3],values[7],values[11]]==[0,0,0] && values[15]==1
        values[12,3]=values[12,3].map { |v| v*factor(unit) }
        determinant=values[0]*(values[5]*values[10]-values[9]*values[6])-values[4]*(values[1]*values[10]-values[9]*values[2])+values[8]*(values[1]*values[6]-values[5]*values[2])
        raise ArgumentError,'Singular matrix' if determinant.abs < 1e-12
        transform=Geom::Transformation.new(values); transform.inverse # reject singular matrices on newer APIs
        e.transformation=transform
      else
        e.transform!(Geom::Transformation.scaling(center,*scale)) if scale
        if params['axis'] || params['angle_degrees']
          axis=Geom::Vector3d.new(vector(params.fetch('axis'))); raise ArgumentError,'Zero rotation axis' if axis.length==0
          e.transform!(Geom::Transformation.rotation(center,axis,number(params.fetch('angle_degrees'))*Math::PI/180))
        end
        if rotation
          rotation.each_with_index { |angle,i| axis=[0,0,0]; axis[i]=1; e.transform!(Geom::Transformation.rotation(center,axis,angle*Math::PI/180)) unless angle==0 }
        end
        e.transform!(Geom::Transformation.translation(translation)) if translation
      end
      inspect_entity(params)
    when 'entity.delete'
      e=resolve_ref(params); raise ArgumentError,'Entity is locked' if e.respond_to?(:locked?) && e.locked?
      e.erase!; {deleted:true}
    when 'entity.update'
      e=resolve_ref(params)
      e.name=params['name'] if params['name'] && e.respond_to?(:name=)
      e.layer=(model.layers[params['tag']] || model.layers.add(params['tag'])) if params['tag']
      e.hidden=params['hidden'] unless params['hidden'].nil?
      e.locked=params['locked'] if !params['locked'].nil? && e.respond_to?(:locked=)
      inspect_entity(params)
    when 'entity.duplicate'
      e=resolve_ref(params)
      raise ArgumentError,'Only group/component duplication supported' unless children(e)
      source = locate_ref(params)
      copy=e.is_a?(Sketchup::Group) ? e.copy : e.parent.entities.add_instance(e.definition,e.transformation)
      copy.name=params['name'] if params['name']
      copy.transform!(Geom::Transformation.translation(point(params.fetch('translation',[0,0,0]),params['unit'])))
      source_parent_path = source[:path][0...-1]
      {entity: summary(copy, source_parent_path + [pid(copy)], source[:parent_transform], params.fetch('unit','mm'))}
    when 'entity.make_unique'
      e=resolve_ref(params); raise ArgumentError,'Not a group/component' unless e.respond_to?(:make_unique)
      e.make_unique; inspect_entity(params)
    when 'entity.group'
      items=params.fetch('entity_ids').map { |id| find_entity(id) }
      raise ArgumentError,'Group entities must be in current edit context' unless items.all? { |e| model.active_entities.include?(e) }
      context=active_context; g=model.active_entities.add_group(items); g.name=params.fetch('name','Group'); {entity: summary(g,context[:path]+[pid(g)],context[:transform])}
    when 'entity.set_material'
      e=resolve_ref(params); mat=set_material({'name'=>params.fetch('material'),'color'=>params['color']}.reject { |_,v| v.nil? })
      if params['scope']=='faces'
        e.make_unique if e.respond_to?(:make_unique)
        raise ArgumentError,'No face container' unless children(e)
        children(e).grep(Sketchup::Face).each { |f| f.material=mat; f.back_material=mat }
      else
        raise ArgumentError,'Entity cannot have a material' unless e.respond_to?(:material=)
        e.material=mat
      end
      inspect_entity(params)
    when 'materials.list'
      {materials:model.materials.map { |m| {name:m.name,color:m.color.to_a,alpha:m.alpha,textured:!!m.texture} }}
    when 'materials.set'
      m=set_material(params); {name:m.name,color:m.color.to_a,alpha:m.alpha}
    when 'tags.list'; {tags:model.layers.map { |l| {name:l.name,visible:l.visible?} }}
    when 'tags.set'
      t=model.layers[params.fetch('name')] || model.layers.add(params['name'])
      t.visible=params['visible'] unless params['visible'].nil?
      {name:t.name,visible:t.visible?}
    when 'scene.list'; {scenes:model.pages.map { |p| {name:p.name,description:p.description} }}
    when 'scene.set'
      page=model.pages[params.fetch('name')]
      if params['action']=='select'
        raise ArgumentError,'Scene not found' unless page
        model.pages.selected_page=page
      else
        page ? page.update : page=model.pages.add(params['name'])
      end
      {name:page.name}
    when 'camera.get'; camera_data
    when 'view.capture'; capture_view(params)
    when 'camera.set'
      view=model.active_view
      if params['eye']
        view.camera=Sketchup::Camera.new(point(params['eye'],params['unit']),point(params.fetch('target'),params['unit']),vector(params.fetch('up',[0,0,1])))
      end
      view.camera.perspective=params['perspective'] unless params['perspective'].nil?
      view.camera.fov=number(params['fov']) if params['fov'] && view.camera.perspective?
      view.camera.height=number(params['height'])*factor(params['unit']) if params['height'] && !view.camera.perspective?
      if params['entity_id'] || params['path']
        location=locate_ref(params)
        box=Geom::BoundingBox.new
        8.times { |i| box.add(location[:entity].bounds.corner(i).transform(location[:parent_transform])) } if location[:entity].bounds.valid?
        frame_bounds(view,box) if box.valid?
      end
      view.zoom_extents if params['zoom_extents']
      view.invalidate
      camera_data
    when 'model.snapshot'
      data=snapshot_entities
      @snapshots ||= {}; id=SecureRandom.uuid; @snapshots.shift if @snapshots.length >= 10
      @snapshots[id]={model:model_id,entities:data}
      {snapshot_id:id,model_id:model_id,count:data.length}
    when 'model.diff'
      previous=(@snapshots || {})[params.fetch('snapshot_id')]; raise ArgumentError,'Unknown snapshot' unless previous
      raise ArgumentError,'Snapshot belongs to another model' unless previous[:model]==model_id
      now=snapshot_entities
      before=previous[:entities].each_with_object({}) { |r,h| h[r[:path].join('/')]=r }
      after=now.each_with_object({}) { |r,h| h[r[:path].join('/')]=r }
      {added:(after.keys-before.keys).map { |k| after[k] },removed:(before.keys-after.keys).map { |k| before[k] },changed:(before.keys & after.keys).select { |k| before[k]!=after[k] }.map { |k| {before:before[k],after:after[k]} }}
    when 'model.undo'; Sketchup.undo; {requested:true}
    when 'model.redo'
      raise BridgeError.new('Redo API unavailable in this SketchUp version',-32004) unless Sketchup.respond_to?(:redo)
      Sketchup.redo; {requested:true}
    when 'model.save','model.export','view.export'
      output(params,method)
    when 'batch.run'
      commands=params.fetch('commands'); raise ArgumentError,'Batch accepts 1–100 commands' unless commands.is_a?(Array) && (1..100).include?(commands.length)
      raise ArgumentError,'Batch only supports typed model mutations' unless commands.all? { |c| MUTATIONS.include?(c['method']) }
      begin
        @editing = true
        transaction(params.fetch('operation_name','MCP batch')) { commands.map { |c| dispatch(c['method'],c.fetch('params',{}),true) } }
      ensure
        @editing = false
      end
    when 'ruby.eval'
      raise BridgeError.new('Ruby execution disabled; enable ruby_enabled in the bridge config',-32001) unless config['ruby_enabled']
      code=params.fetch('code'); raise ArgumentError,'Ruby code exceeds 200 KB' unless code.is_a?(String) && code.bytesize <= 200000
      old=$stdout; captured=BoundedOutput.new; $stdout=captured
      begin
        execute=proc { serialize(TOPLEVEL_BINDING.eval(code,'mcp_script.rb',1)) }
        result=params.fetch('transaction',true) ? transaction(params.fetch('operation_name','MCP Ruby')) { execute.call } : execute.call
        {result:result,stdout:captured.string.force_encoding('UTF-8').scrub,stdout_truncated:captured.truncated}
      ensure
        $stdout=old
      end
    else
      raise BridgeError.new('Unknown method: '+method,-32601)
    end
  end
  def create_geometry(method,params)
    unit=params.fetch('unit','mm'); origin=point(params.fetch('origin',[0,0,0]),unit)
    parent_params = params['parent'] || (params['parent_id'] ? {'entity_id'=>params['parent_id']} : nil)
    if parent_params
      parent_location = locate_ref(parent_params)
      assert_editable(parent_location, {}, include_leaf: true)
      parent_entity = parent_location[:entity]
      container = children(parent_entity)
      parent_path = parent_location[:path]
      parent_transform = parent_location[:transform]
    else
      container=model.active_entities
      context=active_context; parent_path=context[:path]; parent_transform=context[:transform]
    end
    raise ArgumentError,'Parent is not a container' unless container
    g=container.add_group; g.name=params.fetch('name','Geometry')
    g.layer=(model.layers[params['tag']] || model.layers.add(params['tag'])) if params['tag']
    case method
    when 'entity.create_box'
      w,d,h=vector(params.fetch('size'),true).map { |v| v*factor(unit) }
      f=g.entities.add_face([0,0,0],[w,0,0],[w,d,0],[0,d,0])
      f.reverse! if f.normal.z<0; f.pushpull(h)
    when 'entity.create_cylinder'
      radius=number(params['radius'] || params.fetch('radius_mm'))*factor(params['radius'] ? unit : 'mm')
      height=number(params['height'] || params.fetch('height_mm'))*factor(params['height'] ? unit : 'mm')
      segments=Integer(params.fetch('segments',48)); raise ArgumentError,'Invalid cylinder parameters' unless radius>0 && height>0 && (8..256).include?(segments)
      f=g.entities.add_face(g.entities.add_circle([0,0,0],[0,0,1],radius,segments))
      f.reverse! if f.normal.z<0; f.pushpull(height)
    when 'entity.create_mesh'
      vertices=params.fetch('vertices').map { |v| point(v,unit) }; faces=params.fetch('faces')
      raise ArgumentError,'Mesh too large' if vertices.size>50000 || faces.size>100000
      faces.each do |indices|
        raise ArgumentError,'Face needs 3 or more valid indices' unless indices.is_a?(Array) && indices.size>=3 && indices.all? { |i| i.is_a?(Integer) && i>=0 && i<vertices.length }
        raise ArgumentError,'Degenerate or nonplanar face; triangulate input' unless g.entities.add_face(indices.map { |i| vertices[i] })
      end
    when 'entity.extrude'
      polygon=params.fetch('points').map { |v| point(v,unit) }
      height=number(params.fetch('distance'))*factor(unit)
      f=g.entities.add_face(polygon); raise ArgumentError,'Invalid planar polygon' unless f
      f.reverse! if f.normal.z<0; f.pushpull(height)
    end
    g.entities.grep(Sketchup::Edge).each { |e| e.soft=true; e.smooth=true } if params['smooth']
    g.transform!(Geom::Transformation.translation(origin))
    {entity:summary(g,parent_path + [pid(g)],parent_transform,unit)}
  end
  def snapshot_entities
    rows=[]
    budget={visited:0, deadline:Process.clock_gettime(Process::CLOCK_MONOTONIC)+0.5}
    outcome=walk(model.entities,[],Geom::Transformation.new,0,31,budget) do |e,path,trans|
      next unless children(e) || path.length==1
      rows << summary(e,path,trans)
      raise ArgumentError,'Snapshot exceeds 10000 containers' if rows.length>10000
    end
    raise BridgeError.new('Snapshot exceeded traversal budget; use scoped entity_list for this model',-32005) if outcome == :budget || budget[:depth_limited]
    rows
  end
  def set_material(params)
    name=params.fetch('name'); mat=model.materials[name] || model.materials.add(name)
    if params['color']
      color=vector(params['color']); raise ArgumentError,'RGB must be between 0 and 255' unless color.all? { |v| (0..255).include?(v) }
      mat.color=Sketchup::Color.new(*color)
    end
    if params['alpha']
      alpha=number(params['alpha']); raise ArgumentError,'Alpha must be between 0 and 1' unless (0..1).include?(alpha)
      mat.alpha=alpha
    end
    mat.texture=params['texture'] if params['texture']
    if params['roughness']
      raise ArgumentError,'Roughness must be between 0 and 1' unless (0..1).include?(number(params['roughness']))
      if mat.respond_to?(:roughness_factor=); mat.roughness_factor=number(params['roughness'])
      else; @warnings << 'PBR roughness unavailable; using classic material'; end
    end
    mat
  end
  def camera_data
    c=model.active_view.camera
    {eye:c.eye.to_a.map { |v| v*25.4 },target:c.target.to_a.map { |v| v*25.4 },up:c.up.to_a,perspective:c.perspective?,fov:c.perspective? ? c.fov : nil,height:c.perspective? ? nil : c.height*25.4,unit:'mm'}
  end
  def output(params,method)
    path=params.fetch('path')
    raise ArgumentError,'An absolute output path is required' unless path.is_a?(String) && (path.start_with?('/') || path =~ /\A[A-Za-z]:[\\\/]/)
    path=File.expand_path(path)
    raise ArgumentError,'Output exists; pass overwrite=true explicitly' if File.exist?(path) && !params['overwrite']
    raise ArgumentError,'Output directory does not exist' unless Dir.exist?(File.dirname(path))
    case method
    when 'model.save'
      raise ArgumentError,'Use .skp' unless File.extname(path).downcase=='.skp'
      ok=model.save(path)
    when 'view.export'
      raise ArgumentError,'Image format must be PNG or JPG' unless %w[.png .jpg .jpeg].include?(File.extname(path).downcase)
      ok=model.active_view.write_image({filename:path,width:params.fetch('width',1600),height:params.fetch('height',1200),antialias:true,transparent:params.fetch('transparent',false)})
    when 'model.export'
      ok=model.export(path,params.fetch('options',{}).each_with_object({}) { |(k,v),h| h[k.to_sym]=v })
    end
    raise BridgeError.new('Exporter unavailable or operation failed',-32004) unless ok && File.exist?(path)
    {path:path,bytes:File.size(path)}
  end
end
