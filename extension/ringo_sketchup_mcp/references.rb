module RingoSketchupMCP
  module_function

  def check_model(params)
    if params['model_id'] && params['model_id'] != model_id
      raise BridgeError.new('Active model/session changed; query model_get_info again', -32007)
    end
    if params.key?('active_path') && params['active_path'] != (model.active_path || []).map { |e| pid(e) }
      raise BridgeError.new('Edit context changed; query model_get_info again', -32007)
    end
  end

  # Every location uses the same contract: transform includes the leaf, while
  # parent_transform maps the containing Entities coordinates into the model.
  def locate_path(path)
    raise ArgumentError, 'Path must contain 1-32 entity IDs' unless path.is_a?(Array) && (1..32).include?(path.length)
    owner = model
    parent_transform = transform = Geom::Transformation.new
    entities = []
    ids = path.map { |id| Integer(id) }
    ids.each_with_index do |id, index|
      entity = find_entity(id)
      unless entity.parent == owner
        raise BridgeError.new('Instance path is stale; query entity_list again', -32008)
      end
      entities << entity
      parent_transform = transform
      transform = transform * entity.transformation if entity.respond_to?(:transformation)
      if index < ids.length - 1
        raise BridgeError.new('Path enters a non-container', -32008) unless children(entity)
        owner = entity.definition
      end
    end
    {entity: entities.last, path: ids, entities: entities, transform: transform, parent_transform: parent_transform}
  end

  # Follow definition instances upwards. This avoids visiting every face in a
  # large model just to resolve one ID, and rejects ambiguous shared instances.
  def locate_entity(target)
    paths = []
    ascend = lambda do |entity, suffix|
      chain = [entity] + suffix
      raise BridgeError.new('Reference exceeds 32 levels; use a shallower container', -32005) if chain.length > 32
      owner = entity.parent
      if owner == model
        paths << chain.map { |item| pid(item) }
      elsif owner.respond_to?(:instances)
        owner.instances.each do |instance|
          next unless instance.valid?
          ascend.call(instance, chain)
          break if paths.length > 1
        end
      end
    end
    ascend.call(target, [])
    raise BridgeError.new('Entity is not present in the active model', -32008) if paths.empty?
    raise BridgeError.new('Entity ID has multiple instance paths; provide path from entity_list', -32008) if paths.length > 1
    locate_path(paths.first)
  end

  def locate_ref(params)
    check_model(params)
    location = params['path'] ? locate_path(params['path']) : locate_entity(find_entity(params.fetch('entity_id')))
    if params['entity_id'] && Integer(params['entity_id']) != pid(location[:entity])
      raise BridgeError.new('Entity ID does not match instance path', -32008)
    end
    location
  end

  def resolve_ref(params)
    location = locate_ref(params)
    assert_editable(location, params) if @editing
    location[:entity]
  end

  def assert_editable(location, params = {}, include_leaf: false)
    location[:entities].each_with_index do |entity, index|
      unlocking = index == location[:entities].length - 1 && params['locked'] == false
      if entity.respond_to?(:locked?) && entity.locked? && !unlocking
        raise ArgumentError, 'Entity or ancestor is locked; unlock it first'
      end
    end
    affected = include_leaf ? location[:entities] : location[:entities][0...-1]
    shared = affected.any? { |entity| entity.respond_to?(:definition) && entity.definition.instances.count { |i| i.valid? } > 1 }
    if shared
      warning = 'This edit changes a shared definition and affects other instances. Make the ancestor unique first for an independent edit.'
      @warnings << warning unless @warnings.include?(warning)
    end
  end

  def active_context
    path = (model.active_path || []).map { |entity| pid(entity) }
    return {path: [], transform: Geom::Transformation.new} if path.empty?
    location = locate_path(path)
    assert_editable(location, {}, include_leaf: true) if @editing
    {path: path, transform: location[:transform]}
  end

  def inspect_entity(params)
    location = locate_ref(params)
    {entity: summary(location[:entity], location[:path], location[:parent_transform], params.fetch('unit', 'mm'))}
  end
end
