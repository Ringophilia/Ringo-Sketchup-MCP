require 'minitest/autorun'
require_relative 'fake_sketchup'
require_relative '../../extension/ringo_sketchup_mcp/config'
require_relative '../../extension/ringo_sketchup_mcp/operations'
require_relative '../../extension/ringo_sketchup_mcp/server'

class BridgeContractsTest < Minitest::Test
  B = RingoSketchupMCP
  def setup
    Sketchup.active_model=Sketchup::Model.new
    B.instance_variable_set(:@warnings,[])
    B.instance_variable_set(:@editing,false)
  end
  def model; Sketchup.active_model; end
  def group(parent=model, position=[0,0,0])
    g=parent.entities.add_group
    g.transformation=Geom::Transformation.translation(position)
    g
  end
  def test_parent_id_and_path_return_same_world_transform_and_units
    parent=group(model,[10,20,30]); child=group(parent,[2,3,4])
    by_id=B.inspect_entity({'entity_id'=>child.persistent_id,'unit'=>'in'})[:entity]
    by_path=B.inspect_entity({'path'=>[parent.persistent_id,child.persistent_id],'unit'=>'in'})[:entity]
    assert_equal by_path,by_id
    assert_equal [12,23,34],by_id[:transform][12,3]
    assert_equal [12,23,34],by_id[:bounds][:min]
    scoped=B.list_entities({'entity_id'=>parent.persistent_id,'unit'=>'in'})[:entities].first
    assert_equal by_id,scoped
  end
  def test_creation_under_parent_id_includes_parent_transform
    parent=group(model,[10,20,30])
    result=B.dispatch('entity.create_box',{'parent_id'=>parent.persistent_id,'size'=>[1,2,3],'origin'=>[2,3,4],'unit'=>'in'})[:entity]
    assert_equal [12,23,34],result[:transform][12,3]
    assert_equal [parent.persistent_id,result[:persistent_id]],result[:path]
  end
  def test_component_duplicate_uses_owners_entities
    parent=group(model,[10,20,30])
    instance=parent.entities.add_instance(Sketchup::ComponentDefinition.new,Geom::Transformation.translation([2,3,4]))
    result=B.dispatch('entity.duplicate',{'path'=>[parent.persistent_id,instance.persistent_id],'translation'=>[5,0,0],'unit'=>'in'})[:entity]
    assert_equal [17,23,34],result[:transform][12,3]
    assert_equal parent.persistent_id,result[:path].first
  end
  def test_shared_id_rejected_before_delete_and_explicit_path_warns
    parent=group; child=group(parent)
    model.entities.add_instance(parent.definition,Geom::Transformation.translation([50,0,0]))
    assert_raises(B::BridgeError) { B.dispatch('entity.delete',{'entity_id'=>child.persistent_id}) }
    assert child.valid?
    B.dispatch('entity.update',{'path'=>[parent.persistent_id,child.persistent_id],'name'=>'shared'})
    assert_match(/shared definition/,B.instance_variable_get(:@warnings).join)
  end
  def test_stale_path_and_mismatched_id_do_not_mutate
    a=group; b=group; child=group(a)
    assert_raises(B::BridgeError) { B.dispatch('entity.delete',{'path'=>[b.persistent_id,child.persistent_id]}) }
    assert_raises(B::BridgeError) { B.dispatch('entity.delete',{'path'=>[a.persistent_id],'entity_id'=>b.persistent_id}) }
    assert child.valid?
    assert b.valid?
  end
  def test_locked_ancestors_are_enforced_in_batch
    parent=group; child=group(parent); parent.locked=true
    assert_raises(ArgumentError) { B.dispatch('batch.run',{'commands'=>[{'method'=>'entity.delete','params'=>{'path'=>[parent.persistent_id,child.persistent_id]}}]}) }
    assert child.valid?
    assert_equal :abort,model.events.last
  end
  def test_model_and_edit_context_guards_precede_transactions
    old=B.model_id; Sketchup.active_model=Sketchup::Model.new
    assert_raises(B::BridgeError) { B.dispatch('scene.clear',{'model_id'=>old}) }
    parent=group; model.active_path=[parent]
    assert_raises(B::BridgeError) { B.dispatch('entity.create_box',{'active_path'=>[],'size'=>[1,2,3]}) }
    assert_empty model.events
  end
  def test_selection_is_relative_to_active_instance
    parent=group; child=group(parent)
    copy=model.entities.add_instance(parent.definition,Geom::Transformation.translation([100,0,0]))
    model.active_path=[copy]; model.selection << child
    result=B.dispatch('selection.get',{})[:entities].first
    assert_equal [copy.persistent_id,child.persistent_id],result[:path]
    assert_in_delta 2540,result[:transform][12],0.001
  end
  def test_deep_inspection_does_not_fall_back_to_root_coordinates
    parent=model; chain=[]
    25.times { parent=group(parent,[1,0,0]); chain << parent.persistent_id }
    assert_equal chain,B.inspect_entity({'entity_id'=>parent.persistent_id})[:entity][:path]
    assert_in_delta 635,B.inspect_entity({'path'=>chain})[:entity][:transform][12],0.001
  end
  def test_bounded_scan_does_not_claim_complete_counts
    1005.times { group }
    result=B.list_entities({'scan_limit'=>1000,'limit'=>5,'include_total'=>true})
    assert_equal 1000,result[:scanned]
    refute result[:total_exact]
    assert_equal 5,result[:entities].length
  end
  def test_first_page_stops_before_visiting_the_rest_of_the_model
    1005.times { group }
    result=B.list_entities({'limit'=>5})
    assert_equal 6,result[:scanned]
    assert_equal 5,result[:next_offset]
    refute result[:total_exact]
  end
  def test_cancel_only_removes_the_request_on_its_own_connection
    a=Object.new; b=Object.new
    B.instance_variable_set(:@config,{'token'=>'a'*64,'ruby_enabled'=>false})
    B.instance_variable_set(:@clients,{a=>{authenticated:true,out:''},b=>{authenticated:true,out:''}})
    B.instance_variable_set(:@history,[])
    jobs=[a,b].map { |socket| {socket:socket,request:{'id'=>'same-id','method'=>'entity.delete'}} }
    B.instance_variable_set(:@jobs,jobs)
    B.receive_line(a,JSON.generate(jsonrpc:'2.0',id:'cancel',method:'bridge.cancel',token:'a'*64,params:{request_id:'same-id'}))
    assert_equal [b],jobs.map { |job| job[:socket] }
    assert_equal 'cancelled',B.instance_variable_get(:@history).last[:state]
  end
end
