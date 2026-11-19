# Small API double for reference/transport contracts, not a geometry kernel.
# Real solid geometry and undo behavior are checked by scripts/live-test.mjs.
module Geom
  class Transformation
    attr_reader :values

    def initialize(values = nil)
      @values = values || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    end

    def self.translation(point)
      values = new.to_a
      values[12, 3] = point.to_a
      new(values)
    end

    def *(other)
      b = other.values
      self.class.new(
        (0...16).map do |i|
          row = i % 4
          col = i / 4
          (0...4).sum { |k| values[k * 4 + row] * b[col * 4 + k] }
        end
      )
    end

    def to_a
      values.dup
    end
  end

  class Point3d
    def initialize(*args)
      @values = args.length == 1 ? args.first.to_a : args
    end

    def to_a
      @values.dup
    end

    def transform(matrix)
      m = matrix.to_a
      self.class.new((0...3).map { |i| m[i] * @values[0] + m[i + 4] * @values[1] + m[i + 8] * @values[2] + m[i + 12] })
    end
  end

  class BoundingBox
    def initialize
      @points = []
    end

    def add(*points)
      @points.concat(points.map { |p| p.to_a })
      self
    end

    def valid?
      !@points.empty?
    end

    def min
      Point3d.new((0...3).map { |i| @points.map { |p| p[i] }.min })
    end

    def max
      Point3d.new((0...3).map { |i| @points.map { |p| p[i] }.max })
    end

    def corner(i)
      Point3d.new((0...3).map { |j| (i & (1 << j)).zero? ? min.to_a[j] : max.to_a[j] })
    end

    def width
      max.to_a[0] - min.to_a[0]
    end

    def height
      max.to_a[1] - min.to_a[1]
    end

    def depth
      max.to_a[2] - min.to_a[2]
    end
  end
end

module Sketchup
  class << self
    attr_accessor :active_model, :status_text
  end

  def self.version
    'test-double'
  end

  def self.defaults
    @defaults ||= {}
  end

  def self.reset_defaults!
    @defaults = {}
    @status_text = nil
  end

  def self.read_default(section, key, default = nil)
    defaults.fetch("#{section}:#{key}", default)
  end

  def self.write_default(section, key, value)
    defaults["#{section}:#{key}"] = value
  end

  def self.set_status_text(text)
    @status_text = text
  end

  class Color
    attr_reader :values

    def initialize(*values)
      @values = values.length == 3 ? values + [255] : values
    end

    def to_a
      @values.dup
    end
  end

  class Material
    attr_accessor :name, :color, :alpha, :texture

    def initialize(name)
      @name = name
      @color = Color.new(255, 255, 255, 255)
      @alpha = 1.0
      @texture = nil
    end
  end

  class Materials < Array
    def [](key)
      key.is_a?(String) ? find { |m| m.name == key } : super
    end

    def add(name)
      mat = Material.new(name)
      self << mat
      mat
    end
  end

  class Layer
    attr_accessor :name, :visible

    def initialize(name, visible = true)
      @name = name
      @visible = visible
    end

    def visible?
      @visible
    end
  end

  class Layers < Array
    def [](key)
      key.is_a?(String) ? find { |l| l.name == key } : super
    end

    def add(name)
      layer = Layer.new(name)
      self << layer
      layer
    end
  end

  class Camera; end
  class Edge; end

  class Face
    attr_reader :pushpull_distance

    def normal
      Struct.new(:z).new(1)
    end

    def reverse!; end

    def pushpull(distance)
      @pushpull_distance = distance
    end
  end

  class Entities < Array
    attr_reader :owner, :circles, :faces

    def initialize(owner)
      @owner = owner
      @circles = []
      @faces = []
      super()
    end

    def add_instance(definition, transform)
      instance = ComponentInstance.new(owner, definition, transform)
      self << instance
      instance
    end

    def add_group(items = [])
      group = Group.new(owner)
      self << group
      items.each do |e|
        delete(e)
        e.parent = group.definition
        group.entities << e
      end
      group
    end

    def add_circle(center, normal, radius, segments = 24)
      circle = { center: center, normal: normal, radius: radius, segments: segments }
      @circles << circle
      circle
    end

    def add_face(*_)
      face = Face.new
      @faces << face
      face
    end

    def erase_entities(items)
      items.each(&:erase!)
    end
  end

  class ComponentDefinition
    attr_reader :entities, :instances

    def initialize
      @entities = Entities.new(self)
      @instances = []
    end

    def guid
      object_id.to_s
    end
  end

  class ComponentInstance
    attr_accessor :parent, :name, :transformation, :locked, :hidden, :material, :layer
    attr_reader :definition, :persistent_id

    def initialize(parent, definition = ComponentDefinition.new, transformation = Geom::Transformation.new)
      @parent = parent
      @definition = definition
      @transformation = transformation
      @persistent_id = object_id
      @name = ''
      @locked = false
      @hidden = false
      @valid = true
      @layer = Layer.new('Untagged')
      definition.instances << self
      Sketchup.active_model.registry[@persistent_id] = self
    end

    def valid?
      @valid
    end

    def locked?
      @locked
    end

    def hidden?
      @hidden
    end

    def typename
      self.class.name.split('::').last
    end

    def bounds
      box = Geom::BoundingBox.new
      [[0, 0, 0], [1, 2, 3]].each { |p| box.add(Geom::Point3d.new(p).transform(transformation)) }
      box
    end

    def transform!(t)
      @transformation = t * @transformation
    end

    def erase!
      @valid = false
      parent.entities.delete(self)
    end

    def manifold?
      true
    end

    def make_unique
      self
    end
  end

  class Group < ComponentInstance
    def entities
      definition.entities
    end

    def copy
      parent.entities.add_instance(definition, transformation)
    end
  end

  class Selection < Array
    def add(items)
      concat(items)
    end
  end

  class Model
    attr_reader :entities, :registry, :events, :selection, :materials, :layers
    attr_accessor :active_path

    def initialize
      @registry = {}
      @entities = Entities.new(self)
      @events = []
      @selection = Selection.new
      @materials = Materials.new
      @layers = Layers.new([Layer.new('Untagged')])
    end

    def active_entities
      active_path && !active_path.empty? ? active_path.last.definition.entities : entities
    end

    def find_entity_by_persistent_id(id)
      registry[id]
    end

    def start_operation(name, _)
      events << [:start, name]
    end

    def commit_operation
      events << :commit
    end

    def abort_operation
      events << :abort
    end

    def definitions
      []
    end

    def pages
      []
    end

    def title
      'Untitled'
    end

    def path
      ''
    end

    def modified?
      false
    end

    def options
      { 'UnitsOptions' => { 'LengthUnit' => 2 } }
    end
  end
end
