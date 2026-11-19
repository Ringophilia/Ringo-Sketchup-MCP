require_relative 'references'
require_relative 'view'
require_relative 'geometry'
require_relative 'scene'

module RingoSketchupMCP
  MUTATIONS = %w[
    scene.clear
    entity.create_box
    entity.create_cylinder
    entity.create_mesh
    entity.extrude
    entity.transform
    entity.delete
    entity.set_material
    entity.update
    entity.duplicate
    entity.group
    entity.make_unique
    tags.set
    materials.set
    scene.set
  ].freeze

  OPERATION_NAMES = {
    'scene.clear' => 'MCP: Clear Model',
    'entity.create_box' => 'MCP: Create Box',
    'entity.create_cylinder' => 'MCP: Create Cylinder',
    'entity.create_mesh' => 'MCP: Create Mesh',
    'entity.extrude' => 'MCP: Extrude Polygon',
    'entity.transform' => 'MCP: Transform Entity',
    'entity.delete' => 'MCP: Delete Entity',
    'entity.set_material' => 'MCP: Set Material',
    'entity.update' => 'MCP: Update Entity',
    'entity.duplicate' => 'MCP: Duplicate Entity',
    'entity.group' => 'MCP: Group Entities',
    'entity.make_unique' => 'MCP: Make Unique',
    'tags.set' => 'MCP: Set Tag',
    'materials.set' => 'MCP: Set Material',
    'scene.set' => 'MCP: Set Scene'
  }.freeze

  HANDLERS = {
    'model.get_info' => :op_model_get_info,
    'model.stats' => :op_model_stats,
    'entity.list' => :list_entities,
    'entity.inspect' => :inspect_entity,
    'selection.get' => :op_selection_get,
    'selection.set' => :op_selection_set,
    'scene.clear' => :op_scene_clear,
    'entity.create_box' => :op_entity_create_box,
    'entity.create_cylinder' => :op_entity_create_cylinder,
    'entity.create_mesh' => :op_entity_create_mesh,
    'entity.extrude' => :op_entity_extrude,
    'entity.transform' => :op_entity_transform,
    'entity.delete' => :op_entity_delete,
    'entity.update' => :op_entity_update,
    'entity.duplicate' => :op_entity_duplicate,
    'entity.make_unique' => :op_entity_make_unique,
    'entity.group' => :op_entity_group,
    'entity.set_material' => :op_entity_set_material,
    'materials.list' => :op_materials_list,
    'materials.set' => :op_materials_set,
    'tags.list' => :op_tags_list,
    'tags.set' => :op_tags_set,
    'scene.list' => :op_scene_list,
    'scene.set' => :op_scene_set,
    'camera.get' => :op_camera_get,
    'camera.set' => :op_camera_set,
    'view.capture' => :op_view_capture,
    'model.snapshot' => :op_model_snapshot,
    'model.diff' => :op_model_diff,
    'model.undo' => :op_model_undo,
    'model.redo' => :op_model_redo,
    'model.save' => :op_model_save,
    'model.export' => :op_model_export,
    'view.export' => :op_view_export,
    'batch.run' => :op_batch_run,
    'ruby.eval' => :op_ruby_eval
  }.freeze

  module_function

  def model
    Sketchup.active_model || raise(BridgeError.new('Open a SketchUp model first', -32007))
  end

  def model_id
    @models ||= {}
    @models[model] ||= SecureRandom.uuid
  end

  def number(value)
    raise ArgumentError, 'Expected a finite number' unless value.is_a?(Numeric) && value.to_f.finite?
    value.to_f
  end

  def vector(value, positive = false)
    raise ArgumentError, 'Expected three numbers' unless value.is_a?(Array) && value.size == 3
    value.map do |v|
      n = number(v)
      raise ArgumentError, 'Dimensions/scales must be positive' if positive && n <= 0
      n
    end
  end

  def factor(unit)
    { 'mm' => 1.0 / 25.4, 'cm' => 10.0 / 25.4, 'm' => 1000.0 / 25.4, 'in' => 1.0, 'ft' => 12.0 }.fetch(unit || 'mm') do
      raise ArgumentError, 'Unsupported unit'
    end
  end

  def point(values, unit = 'mm')
    vector(values).map { |v| v * factor(unit) }
  end

  def children(e)
    e.is_a?(Sketchup::Group) ? e.entities : e.is_a?(Sketchup::ComponentInstance) ? e.definition.entities : nil
  end

  def pid(e)
    e.respond_to?(:persistent_id) ? e.persistent_id : e.entityID
  end

  def find_entity(id)
    e = if model.respond_to?(:find_entity_by_persistent_id)
      model.find_entity_by_persistent_id(Integer(id))
    else
      model.find_entity_by_id(Integer(id))
    end
    raise BridgeError.new('Entity reference is stale', -32008) unless e && e.valid?
    e
  end

  def bounds_data(bounds, unit = 'mm')
    f = factor(unit)
    {
      min: bounds.min.to_a.map { |v| v / f },
      max: bounds.max.to_a.map { |v| v / f },
      size: [bounds.width, bounds.height, bounds.depth].map { |v| v.to_f / f },
      unit: unit
    }
  end

  def summary(e, path, transform = Geom::Transformation.new, unit = 'mm')
    b = Geom::BoundingBox.new
    if e.bounds.valid?
      8.times { |i| b.add(e.bounds.corner(i).transform(transform)) }
    end
    own = e.respond_to?(:transformation) ? e.transformation : Geom::Transformation.new
    matrix = (transform * own).to_a
    matrix[12, 3] = matrix[12, 3].map { |v| v / factor(unit) }
    {
      persistent_id: pid(e),
      model_id: model_id,
      path: path,
      type: e.typename,
      name: e.respond_to?(:name) ? e.name : '',
      tag: e.layer.name,
      material: e.respond_to?(:material) && e.material ? e.material.name : nil,
      hidden: e.hidden?,
      locked: e.respond_to?(:locked?) ? e.locked? : false,
      bounds: b.valid? ? bounds_data(b, unit) : nil,
      transform: matrix,
      transform_layout: 'column_major_translation_in_' + unit,
      child_count: children(e) ? children(e).length : 0,
      solid: e.respond_to?(:manifold?) ? e.manifold? : nil,
      definition_id: e.respond_to?(:definition) ? e.definition.guid : nil,
      reference_lifetime: e.respond_to?(:persistent_id) ? 'model_persistent_with_session_guard' : 'current_session_only'
    }
  end

  def walk(collection = model.entities, path = [], transform = Geom::Transformation.new, depth = 0, max_depth = 31, budget = nil, &block)
    budget ||= { visited: 0, deadline: Process.clock_gettime(Process::CLOCK_MONOTONIC) + 0.5 }
    collection.each do |e|
      budget[:visited] += 1
      if budget[:visited] % 128 == 0 && Process.clock_gettime(Process::CLOCK_MONOTONIC) > budget[:deadline]
        return :budget
      end
      p = path + [pid(e)]
      result = yield e, p, transform
      return :stopped if result == :stop
      nested = children(e)
      if nested && depth < max_depth
        result = walk(nested, p, transform * e.transformation, depth + 1, max_depth, budget, &block)
        return result if result
      elsif nested && nested.length > 0
        budget[:depth_limited] = true
      end
    end
    nil
  end

  def list_entities(params)
    depth = params['recursive'] ? Integer(params.fetch('max_depth', 16)) : 0
    depth = [[depth, 0].max, 32].min
    limit = [[Integer(params.fetch('limit', 100)), 1].max, 1000].min
    offset = [Integer(params.fetch('offset', 0)), 0].max
    rows = []
    total = 0
    scanned = 0
    truncated = false
    more = false
    unit = params.fetch('unit', 'mm')
    scan_limit = [[Integer(params.fetch('scan_limit', 100000)), 1000].max, 1000000].min
    if params['path'] || params['entity_id']
      located = locate_ref(params)
      root = children(located[:entity])
      base_path = located[:path]
      base_transform = located[:transform]
    else
      root = model.entities
      base_path = []
      base_transform = Geom::Transformation.new
    end
    raise ArgumentError, 'Entity has no children' unless root
    outcome = walk(root, base_path, base_transform, 0, depth) do |e, path, trans|
      if scanned >= scan_limit
        truncated = true
        :stop
      else
        scanned += 1
        next if params['type'] && e.typename.downcase != params['type'].downcase
        next if params['name'] && (!e.respond_to?(:name) || !e.name.include?(params['name']))
        next if params['tag'] && e.layer.name != params['tag']
        rows << summary(e, path, trans, unit) if total >= offset && rows.length < limit
        total += 1
        if !params['include_total'] && total > offset + limit
          more = true
          :stop
        end
      end
    end
    truncated ||= outcome == :budget
    if truncated
      @warnings << 'Query reached its work budget. Scope entity_list to a parent path, reduce max_depth, or use more specific queries.'
    end
    {
      entities: rows,
      total: total,
      total_exact: !truncated && !more,
      scanned: scanned,
      scan_limit: scan_limit,
      truncated: truncated,
      next_offset: offset + rows.length < total ? offset + rows.length : nil,
      model_id: model_id
    }
  end

  def transaction(name)
    model.start_operation(name, true)
    begin
      result = yield
      model.commit_operation
      result
    rescue StandardError, SyntaxError
      model.abort_operation
      raise
    end
  end

  def serialize(value, depth = 0)
    raise ArgumentError, 'Result nesting exceeds 12 levels' if depth > 12
    case value
    when NilClass, TrueClass, FalseClass, String, Integer
      value
    when Numeric
      number(value)
    when Array
      raise ArgumentError, 'Result array too large; paginate' if value.size > 100000
      value.map { |v| serialize(v, depth + 1) }
    when Hash
      value.each_with_object({}) { |(k, v), h| h[k.to_s] = serialize(v, depth + 1) }
    else
      value.respond_to?(:persistent_id) ? { persistent_id: pid(value), type: value.typename } : value.to_s
    end
  end

  def dispatch(method, params, nested = false)
    @warnings = [] unless nested
    check_model(params)
    if !nested && MUTATIONS.include?(method)
      begin
        @editing = true
        return transaction(OPERATION_NAMES.fetch(method, "MCP: #{method}")) { dispatch(method, params, true) }
      ensure
        @editing = false
      end
    end
    handler = HANDLERS[method]
    raise BridgeError.new('Unknown method: ' + method, -32601) unless handler
    send(handler, params)
  end

  def op_model_get_info(_params)
    {
      model_id: model_id,
      instance: instance_identity,
      title: model.title,
      path: model.path,
      modified: model.modified?,
      sketchup_version: Sketchup.version,
      ruby_version: RUBY_VERSION,
      units: %w[in ft mm cm m][model.options['UnitsOptions']['LengthUnit']] || 'unknown',
      entity_count: model.entities.length,
      selection_count: model.selection.length,
      active_path: (model.active_path || []).map { |e| pid(e) },
      capabilities: capabilities
    }
  end

  def op_model_stats(params)
    counts = Hash.new(0)
    solids = 0
    scanned = 0
    max_entities = [[Integer(params.fetch('max_entities', 100000)), 1000].max, 1000000].min
    truncated = false
    budget = { visited: 0, deadline: Process.clock_gettime(Process::CLOCK_MONOTONIC) + 0.5 }
    outcome = walk(model.entities, [], Geom::Transformation.new, 0, 31, budget) do |e, _, _|
      if scanned >= max_entities
        truncated = true
        :stop
      else
        scanned += 1
        counts[e.typename] += 1
        solids += 1 if e.respond_to?(:manifold?) && e.manifold?
      end
    end
    truncated ||= outcome == :budget || budget[:depth_limited]
    {
      model_id: model_id,
      counts: counts,
      solid_instances: solids,
      scanned: scanned,
      max_entities: max_entities,
      total_exact: !truncated,
      definitions: model.definitions.length,
      materials: model.materials.length,
      tags: model.layers.length,
      scenes: model.pages.length
    }
  end

  def op_batch_run(params)
    commands = params.fetch('commands')
    raise ArgumentError, 'Batch accepts 1–100 commands' unless commands.is_a?(Array) && (1..100).include?(commands.length)
    raise ArgumentError, 'Batch only supports typed model mutations' unless commands.all? { |c| MUTATIONS.include?(c['method']) }
    total = commands.length
    begin
      @editing = true
      transaction(params.fetch('operation_name', 'MCP batch')) do
        commands.each_with_index.map do |c, idx|
          notify_progress(idx, total, "Running step #{idx + 1}/#{total}: #{c['method']}") if respond_to?(:notify_progress)
          res = dispatch(c['method'], c.fetch('params', {}), true)
          notify_progress(idx + 1, total, "Completed step #{idx + 1}/#{total}: #{c['method']}") if respond_to?(:notify_progress)
          res
        end
      end
    ensure
      @editing = false
    end
  end

  def op_ruby_eval(params)
    raise BridgeError.new('Ruby execution disabled; enable ruby_enabled in the bridge config', -32001) unless config['ruby_enabled']
    code = params.fetch('code')
    raise ArgumentError, 'Ruby code exceeds 200 KB' unless code.is_a?(String) && code.bytesize <= 200000
    old = $stdout
    captured = BoundedOutput.new
    $stdout = captured
    begin
      sandbox = Object.new
      sandbox.define_singleton_method(:include) do |*mods|
        mods.reverse_each { |mod| extend(mod) }
        self
      end
      execute = proc { serialize(sandbox.instance_eval(code, 'mcp_script.rb', 1)) }
      result = params.fetch('transaction', true) ? transaction(params.fetch('operation_name', 'MCP Ruby')) { execute.call } : execute.call
      { result: result, stdout: captured.string.force_encoding('UTF-8').scrub, stdout_truncated: captured.truncated }
    ensure
      $stdout = old
    end
  end
end
