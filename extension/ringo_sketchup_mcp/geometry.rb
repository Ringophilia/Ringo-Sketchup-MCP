module RingoSketchupMCP
  module_function

  def create_geometry(method, params)
    unit = params.fetch('unit', 'mm')
    origin = point(params.fetch('origin', [0, 0, 0]), unit)
    parent_params = params['parent'] || (params['parent_id'] ? { 'entity_id' => params['parent_id'] } : nil)
    if parent_params
      parent_location = locate_ref(parent_params)
      assert_editable(parent_location, {}, include_leaf: true)
      parent_entity = parent_location[:entity]
      container = children(parent_entity)
      parent_path = parent_location[:path]
      parent_transform = parent_location[:transform]
    else
      container = model.active_entities
      context = active_context
      parent_path = context[:path]
      parent_transform = context[:transform]
    end
    raise ArgumentError, 'Parent is not a container' unless container
    g = container.add_group
    g.name = params.fetch('name', 'Geometry')
    g.layer = (model.layers[params['tag']] || model.layers.add(params['tag'])) if params['tag']

    case method
    when 'entity.create_box'
      w, d, h = vector(params.fetch('size'), true).map { |v| v * factor(unit) }
      f = g.entities.add_face([0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0])
      f.reverse! if f.normal.z < 0
      f.pushpull(h)
    when 'entity.create_cylinder'
      raise ArgumentError, 'Use either radius or deprecated radius_mm, not both' if params.key?('radius') && params.key?('radius_mm')
      raise ArgumentError, 'Use either height or deprecated height_mm, not both' if params.key?('height') && params.key?('height_mm')
      radius = number(params.key?('radius') ? params['radius'] : params.fetch('radius_mm')) * factor(params.key?('radius') ? unit : 'mm')
      height = number(params.key?('height') ? params['height'] : params.fetch('height_mm')) * factor(params.key?('height') ? unit : 'mm')
      segments = Integer(params.fetch('segments', 48))
      raise ArgumentError, 'Invalid cylinder parameters' unless radius > 0 && height > 0 && (8..256).include?(segments)
      f = g.entities.add_face(g.entities.add_circle([0, 0, 0], [0, 0, 1], radius, segments))
      f.reverse! if f.normal.z < 0
      f.pushpull(height)
    when 'entity.create_mesh'
      vertices = params.fetch('vertices').map { |v| point(v, unit) }
      faces = params.fetch('faces')
      raise ArgumentError, 'Mesh too large' if vertices.size > 50000 || faces.size > 100000
      faces.each do |indices|
        raise ArgumentError, 'Face needs 3 or more valid indices' unless indices.is_a?(Array) && indices.size >= 3 && indices.all? { |i| i.is_a?(Integer) && i >= 0 && i < vertices.length }
        raise ArgumentError, 'Degenerate or nonplanar face; triangulate input' unless g.entities.add_face(indices.map { |i| vertices[i] })
      end
    when 'entity.extrude'
      polygon = params.fetch('points').map { |v| point(v, unit) }
      height = number(params.fetch('distance')) * factor(unit)
      raise ArgumentError, 'Extrusion distance cannot be zero' if height == 0
      f = g.entities.add_face(polygon)
      raise ArgumentError, 'Invalid planar polygon' unless f
      f.reverse! if f.normal.z < 0
      f.pushpull(height)
    end

    g.entities.grep(Sketchup::Edge).each { |e| e.soft = true; e.smooth = true } if params['smooth']
    g.transform!(Geom::Transformation.translation(origin))
    { entity: summary(g, parent_path + [pid(g)], parent_transform, unit) }
  end

  def op_entity_create_box(params)
    create_geometry('entity.create_box', params)
  end

  def op_entity_create_cylinder(params)
    create_geometry('entity.create_cylinder', params)
  end

  def op_entity_create_mesh(params)
    create_geometry('entity.create_mesh', params)
  end

  def op_entity_extrude(params)
    create_geometry('entity.extrude', params)
  end

  def op_entity_transform(params)
    e = resolve_ref(params)
    raise ArgumentError, 'Transform requires a group or component instance' unless e.respond_to?(:transform!)
    raise ArgumentError, 'Entity is locked' if e.locked?
    unit = params.fetch('unit', 'mm')
    # Validate everything before the first mutation; operations are rolled back on failure.
    scale = params['scale'] ? vector(params['scale'], true) : nil
    translation = params['translation'] ? point(params['translation'], unit) : nil
    rotation = params['rotation_degrees'] ? vector(params['rotation_degrees']) : nil
    center = params['pivot'] ? Geom::Point3d.new(point(params['pivot'], unit)) : e.bounds.center
    if params['matrix']
      values = params['matrix']
      raise ArgumentError, 'Expected 16 finite matrix values' unless values.is_a?(Array) && values.size == 16
      values = values.map { |v| number(v) }
      raise ArgumentError, 'Only affine matrices are supported' unless [values[3], values[7], values[11]] == [0, 0, 0] && values[15] == 1
      values[12, 3] = values[12, 3].map { |v| v * factor(unit) }
      determinant = values[0] * (values[5] * values[10] - values[9] * values[6]) -
                    values[4] * (values[1] * values[10] - values[9] * values[2]) +
                    values[8] * (values[1] * values[6] - values[5] * values[2])
      raise ArgumentError, 'Singular matrix' if determinant.abs < 1e-12
      transform = Geom::Transformation.new(values)
      transform.inverse # reject singular matrices on newer APIs
      e.transformation = transform
    else
      e.transform!(Geom::Transformation.scaling(center, *scale)) if scale
      if params['axis'] || params['angle_degrees']
        axis = Geom::Vector3d.new(vector(params.fetch('axis')))
        raise ArgumentError, 'Zero rotation axis' if axis.length == 0
        e.transform!(Geom::Transformation.rotation(center, axis, number(params.fetch('angle_degrees')) * Math::PI / 180))
      end
      if rotation
        rotation.each_with_index do |angle, i|
          axis = [0, 0, 0]
          axis[i] = 1
          e.transform!(Geom::Transformation.rotation(center, axis, angle * Math::PI / 180)) unless angle == 0
        end
      end
      e.transform!(Geom::Transformation.translation(translation)) if translation
    end
    inspect_entity(params)
  end

  def op_entity_delete(params)
    e = resolve_ref(params)
    raise ArgumentError, 'Entity is locked' if e.respond_to?(:locked?) && e.locked?
    e.erase!
    { deleted: true }
  end

  def op_entity_update(params)
    e = resolve_ref(params)
    e.name = params['name'] if params['name'] && e.respond_to?(:name=)
    e.layer = (model.layers[params['tag']] || model.layers.add(params['tag'])) if params['tag']
    e.hidden = params['hidden'] unless params['hidden'].nil?
    e.locked = params['locked'] if !params['locked'].nil? && e.respond_to?(:locked=)
    inspect_entity(params)
  end

  def op_entity_duplicate(params)
    e = resolve_ref(params)
    raise ArgumentError, 'Only group/component duplication supported' unless children(e)
    source = locate_ref(params)
    copy = e.is_a?(Sketchup::Group) ? e.copy : e.parent.entities.add_instance(e.definition, e.transformation)
    copy.name = params['name'] if params['name']
    copy.transform!(Geom::Transformation.translation(point(params.fetch('translation', [0, 0, 0]), params['unit'])))
    source_parent_path = source[:path][0...-1]
    { entity: summary(copy, source_parent_path + [pid(copy)], source[:parent_transform], params.fetch('unit', 'mm')) }
  end

  def op_entity_make_unique(params)
    e = resolve_ref(params)
    raise ArgumentError, 'Not a group/component' unless e.respond_to?(:make_unique)
    e.make_unique
    inspect_entity(params)
  end

  def op_entity_group(params)
    items = params.fetch('entity_ids').map { |id| find_entity(id) }
    raise ArgumentError, 'Group entities must be in current edit context' unless items.all? { |e| model.active_entities.include?(e) }
    context = active_context
    g = model.active_entities.add_group(items)
    g.name = params.fetch('name', 'Group')
    { entity: summary(g, context[:path] + [pid(g)], context[:transform]) }
  end

  def op_entity_set_material(params)
    e = resolve_ref(params)
    mat = set_material({ 'name' => params.fetch('material'), 'color' => params['color'] }.reject { |_, v| v.nil? })
    if params['scope'] == 'faces'
      e.make_unique if e.respond_to?(:make_unique)
      raise ArgumentError, 'No face container' unless children(e)
      children(e).grep(Sketchup::Face).each do |f|
        f.material = mat
        f.back_material = mat
      end
    else
      raise ArgumentError, 'Entity cannot have a material' unless e.respond_to?(:material=)
      e.material = mat
    end
    inspect_entity(params)
  end
end
