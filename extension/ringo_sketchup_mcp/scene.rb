module RingoSketchupMCP
  module_function

  def op_selection_get(params)
    limit = [[Integer(params.fetch('limit', 100)), 1].max, 1000].min
    offset = [Integer(params.fetch('offset', 0)), 0].max
    unit = params.fetch('unit', 'mm')
    selected = model.selection.to_a
    total = selected.length
    prefix = (model.active_path || []).map { |e| pid(e) }
    page = selected.slice(offset, limit) || []
    entities = page.map do |e|
      ref = { 'entity_id' => pid(e), 'unit' => unit }
      ref['path'] = prefix + [pid(e)] unless prefix.empty?
      inspect_entity(ref)[:entity]
    end
    next_offset = offset + entities.length < total ? offset + entities.length : nil
    { entities: entities, total: total, limit: limit, offset: offset, next_offset: next_offset }
  end

  def op_selection_set(params)
    list = Array(params.fetch('entity_ids')).map { |id| find_entity(id) }
    raise ArgumentError, 'Selection must be in the current edit context' unless list.all? { |e| model.active_entities.include?(e) }
    model.selection.clear
    model.selection.add(list) unless list.empty?
    { count: model.selection.length }
  end

  def op_scene_clear(_params)
    raise ArgumentError, 'Leave the current component edit context before clearing' if model.active_path
    count = model.entities.length
    model.entities.erase_entities(model.entities.to_a)
    { deleted_count: count }
  end

  def op_materials_list(params)
    limit = [[Integer(params.fetch('limit', 500)), 1].max, 2000].min
    offset = [Integer(params.fetch('offset', 0)), 0].max
    all_materials = model.materials.to_a
    total = all_materials.length
    page = all_materials.slice(offset, limit) || []
    materials = page.map { |m| { name: m.name, color: m.color.to_a, alpha: m.alpha, textured: !!m.texture } }
    next_offset = offset + materials.length < total ? offset + materials.length : nil
    { materials: materials, total: total, limit: limit, offset: offset, next_offset: next_offset }
  end

  def op_materials_set(params)
    m = set_material(params)
    { name: m.name, color: m.color.to_a, alpha: m.alpha }
  end

  def set_material(params)
    name = params.fetch('name')
    mat = model.materials[name] || model.materials.add(name)
    if params['color']
      color = vector(params['color']).map(&:round)
      raise ArgumentError, 'RGB must be between 0 and 255' unless color.all? { |v| (0..255).include?(v) }
      mat.color = Sketchup::Color.new(*color)
    end
    if params['alpha']
      alpha = number(params['alpha'])
      raise ArgumentError, 'Alpha must be between 0 and 1' unless (0..1).include?(alpha)
      mat.alpha = alpha
    end
    mat.texture = params['texture'] if params['texture']
    if params['roughness']
      raise ArgumentError, 'Roughness must be between 0 and 1' unless (0..1).include?(number(params['roughness']))
      if mat.respond_to?(:roughness_factor=)
        mat.roughness_factor = number(params['roughness'])
      else
        @warnings << 'PBR roughness unavailable; using classic material'
      end
    end
    mat
  end

  def op_tags_list(params)
    limit = [[Integer(params.fetch('limit', 500)), 1].max, 2000].min
    offset = [Integer(params.fetch('offset', 0)), 0].max
    all_tags = model.layers.to_a
    total = all_tags.length
    page = all_tags.slice(offset, limit) || []
    tags = page.map { |l| { name: l.name, visible: l.visible? } }
    next_offset = offset + tags.length < total ? offset + tags.length : nil
    { tags: tags, total: total, limit: limit, offset: offset, next_offset: next_offset }
  end

  def op_tags_set(params)
    t = model.layers[params.fetch('name')] || model.layers.add(params['name'])
    t.visible = params['visible'] unless params['visible'].nil?
    { name: t.name, visible: t.visible? }
  end

  def op_scene_list(_params)
    { scenes: model.pages.map { |p| { name: p.name, description: p.description } } }
  end

  def op_scene_set(params)
    page = model.pages[params.fetch('name')]
    if params['action'] == 'select'
      raise ArgumentError, 'Scene not found' unless page
      model.pages.selected_page = page
    else
      page ? page.update : page = model.pages.add(params['name'])
    end
    { name: page.name }
  end

  def snapshot_entities
    rows = []
    budget = { visited: 0, deadline: Process.clock_gettime(Process::CLOCK_MONOTONIC) + 0.5 }
    outcome = walk(model.entities, [], Geom::Transformation.new, 0, 31, budget) do |e, path, trans|
      next unless children(e) || path.length == 1
      rows << summary(e, path, trans)
      raise ArgumentError, 'Snapshot exceeds 10000 containers' if rows.length > 10000
    end
    raise BridgeError.new('Snapshot exceeded traversal budget; use scoped entity_list for this model', -32005) if outcome == :budget || budget[:depth_limited]
    rows
  end

  def op_model_snapshot(_params)
    data = snapshot_entities
    @snapshots ||= {}
    id = SecureRandom.uuid
    @snapshots.shift if @snapshots.length >= 10
    @snapshots[id] = { model: model_id, entities: data }
    { snapshot_id: id, model_id: model_id, count: data.length }
  end

  def op_model_diff(params)
    previous = (@snapshots || {})[params.fetch('snapshot_id')]
    raise ArgumentError, 'Unknown snapshot' unless previous
    raise ArgumentError, 'Snapshot belongs to another model' unless previous[:model] == model_id
    limit = [[Integer(params.fetch('limit', 500)), 1].max, 5000].min
    now = snapshot_entities
    before = previous[:entities].each_with_object({}) { |r, h| h[r[:path].join('/')] = r }
    after = now.each_with_object({}) { |r, h| h[r[:path].join('/')] = r }

    added_keys = after.keys - before.keys
    removed_keys = before.keys - after.keys
    changed_keys = (before.keys & after.keys).select { |k| before[k] != after[k] }
    truncated = added_keys.length > limit || removed_keys.length > limit || changed_keys.length > limit
    @warnings << "Snapshot diff truncated to #{limit} entries per category; use counts for full totals." if truncated

    {
      added: added_keys.first(limit).map { |k| after[k] },
      removed: removed_keys.first(limit).map { |k| before[k] },
      changed: changed_keys.first(limit).map { |k| { before: before[k], after: after[k] } },
      counts: { added: added_keys.length, removed: removed_keys.length, changed: changed_keys.length },
      limit: limit,
      truncated: truncated
    }
  end

  def op_model_undo(_params)
    Sketchup.undo
    { requested: true }
  end

  def op_model_redo(_params)
    raise BridgeError.new('Redo API unavailable in this SketchUp version', -32004) unless Sketchup.respond_to?(:redo)
    Sketchup.redo
    { requested: true }
  end

  def output(params, method)
    path = params.fetch('path')
    raise ArgumentError, 'An absolute output path is required' unless path.is_a?(String) && (path.start_with?('/') || path =~ /\A[A-Za-z]:[\\\/]/)
    path = File.expand_path(path)
    raise ArgumentError, 'Output exists; pass overwrite=true explicitly' if File.exist?(path) && !params['overwrite']
    raise ArgumentError, 'Output directory does not exist' unless Dir.exist?(File.dirname(path))
    case method
    when 'model.save'
      raise ArgumentError, 'Use .skp' unless File.extname(path).downcase == '.skp'
      ok = model.save(path)
    when 'view.export'
      raise ArgumentError, 'Image format must be PNG or JPG' unless %w[.png .jpg .jpeg].include?(File.extname(path).downcase)
      ok = model.active_view.write_image(
        filename: path,
        width: params.fetch('width', 1600),
        height: params.fetch('height', 1200),
        antialias: true,
        transparent: params.fetch('transparent', false)
      )
    when 'model.export'
      ok = model.export(path, params.fetch('options', {}).each_with_object({}) { |(k, v), h| h[k.to_sym] = v })
    end
    raise BridgeError.new('Exporter unavailable or operation failed', -32004) unless ok && File.exist?(path)
    { path: path, bytes: File.size(path) }
  end

  def op_model_save(params)
    output(params, 'model.save')
  end

  def op_model_export(params)
    output(params, 'model.export')
  end

  def op_view_export(params)
    output(params, 'view.export')
  end
end
