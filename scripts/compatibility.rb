# Runs in the host's Ruby, using isolated fake SketchUp API surfaces.
# No real SketchUp objects are modified.
folder = File.dirname(RingoSketchupMCP.method(:dispatch).source_location.first)
reports=[]
[false,true].each do |modern|
  namespace=Module.new
  fake_sketchup=Module.new
  material_class=Class.new
  material_class.class_eval { attr_accessor :roughness_factor } if modern
  fake_sketchup.const_set(:Material,material_class)
  fake_sketchup.const_set(:Camera,Class.new)
  entity=Object.new
  entity.define_singleton_method(:valid?) { true }
  fake_model=Object.new
  fake_model.define_singleton_method(:find_entity_by_id) { |id| entity }
  fake_model.define_singleton_method(:find_entity_by_persistent_id) { |id| entity } if modern
  fake_sketchup.define_singleton_method(:active_model) { fake_model }
  fake_sketchup.define_singleton_method(:redo) { nil } if modern
  namespace.const_set(:Sketchup,fake_sketchup)
  namespace.module_eval(File.read(File.join(folder,'config.rb')), 'isolated-config.rb')
  namespace.module_eval(File.read(File.join(folder,'operations.rb')), 'isolated-operations.rb')
  bridge=namespace.const_get(:RingoSketchupMCP)
  bridge.define_singleton_method(:config) { {'ruby_enabled'=>false} }
  caps=bridge.capabilities
  raise 'Wrong persistent ID capability' unless caps[:persistent_ids]==modern
  raise 'Wrong PBR capability' unless caps[:pbr]==modern
  raise 'Wrong redo capability' unless caps[:redo]==modern
  raise 'ID fallback broken' unless bridge.find_entity(42)==entity
  reports << {surface:modern ? 'newer_api' : 'older_api',capabilities:caps,id_resolution:true}
end
# Compile all shipped Ruby files in the actual embedded interpreter.
Dir[File.join(folder,'*.rb')].each { |path| RubyVM::InstructionSequence.compile_file(path) } if defined?(RubyVM::InstructionSequence)
{success:true,capability_profiles:reports,syntax_ruby:RUBY_VERSION}
