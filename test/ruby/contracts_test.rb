if ENV['COVERAGE'] == '1'
  require 'simplecov'
  SimpleCov.start do
    add_filter '/test/'
  end
end

require 'json'
require 'minitest/autorun'
require 'tmpdir'
require_relative 'fake_sketchup'
require_relative '../../extension/ringo_sketchup_mcp/config'
require_relative '../../extension/ringo_sketchup_mcp/operations'
require_relative '../../extension/ringo_sketchup_mcp/server'

class BridgeContractsTest < Minitest::Test
  B = RingoSketchupMCP

  def setup
    Sketchup.reset_defaults!
    Sketchup.active_model = Sketchup::Model.new
    B.instance_variable_set(:@warnings, [])
    B.instance_variable_set(:@editing, false)
    B.instance_variable_set(:@selected_profile_id, nil)
    B.instance_variable_set(:@bound_config_path, nil)
    B.instance_variable_set(:@config, nil)
    B.instance_variable_set(:@snapshots, {})
    B.instance_variable_set(:@models, {})
  end

  def model
    Sketchup.active_model
  end

  def group(parent = model, position = [0, 0, 0])
    g = parent.entities.add_group
    g.transformation = Geom::Transformation.translation(position)
    g
  end

  def test_parent_id_and_path_return_same_world_transform_and_units
    parent = group(model, [10, 20, 30])
    child = group(parent, [2, 3, 4])
    by_id = B.inspect_entity({ 'entity_id' => child.persistent_id, 'unit' => 'in' })[:entity]
    by_path = B.inspect_entity({ 'path' => [parent.persistent_id, child.persistent_id], 'unit' => 'in' })[:entity]
    assert_equal by_path, by_id
    assert_equal [12, 23, 34], by_id[:transform][12, 3]
    assert_equal [12, 23, 34], by_id[:bounds][:min]
    scoped = B.list_entities({ 'entity_id' => parent.persistent_id, 'unit' => 'in' })[:entities].first
    assert_equal by_id, scoped
  end

  def test_creation_under_parent_id_includes_parent_transform
    parent = group(model, [10, 20, 30])
    result = B.dispatch('entity.create_box', { 'parent_id' => parent.persistent_id, 'size' => [1, 2, 3], 'origin' => [2, 3, 4], 'unit' => 'in' })[:entity]
    assert_equal [12, 23, 34], result[:transform][12, 3]
    assert_equal [parent.persistent_id, result[:persistent_id]], result[:path]
    assert_equal [:start, 'MCP: Create Box'], model.events.first
  end

  def test_cylinder_unit_conversion_and_deprecated_aliases
    res = B.dispatch('entity.create_cylinder', { 'unit' => 'cm', 'radius' => 2, 'height' => 5 })[:entity]
    cyl = model.find_entity_by_persistent_id(res[:persistent_id])
    assert_in_delta 2.0 * 10.0 / 25.4, cyl.entities.circles.first[:radius], 1e-6
    assert_in_delta 5.0 * 10.0 / 25.4, cyl.entities.faces.first.pushpull_distance, 1e-6

    legacy = B.dispatch('entity.create_cylinder', { 'unit' => 'cm', 'radius_mm' => 20, 'height_mm' => 50 })[:entity]
    cyl2 = model.find_entity_by_persistent_id(legacy[:persistent_id])
    assert_in_delta 20.0 / 25.4, cyl2.entities.circles.first[:radius], 1e-6
    assert_in_delta 50.0 / 25.4, cyl2.entities.faces.first.pushpull_distance, 1e-6

    assert_raises(ArgumentError) { B.dispatch('entity.create_cylinder', { 'radius' => 2, 'radius_mm' => 20, 'height' => 5 }) }
    assert_raises(ArgumentError) { B.dispatch('entity.create_cylinder', { 'radius' => 2, 'height' => 5, 'height_mm' => 50 }) }
  end

  def test_component_duplicate_uses_owners_entities
    parent = group(model, [10, 20, 30])
    instance = parent.entities.add_instance(Sketchup::ComponentDefinition.new, Geom::Transformation.translation([2, 3, 4]))
    result = B.dispatch('entity.duplicate', { 'path' => [parent.persistent_id, instance.persistent_id], 'translation' => [5, 0, 0], 'unit' => 'in' })[:entity]
    assert_equal [17, 23, 34], result[:transform][12, 3]
    assert_equal parent.persistent_id, result[:path].first
  end

  def test_shared_id_rejected_before_delete_and_explicit_path_warns
    parent = group
    child = group(parent)
    model.entities.add_instance(parent.definition, Geom::Transformation.translation([50, 0, 0]))
    assert_raises(B::BridgeError) { B.dispatch('entity.delete', { 'entity_id' => child.persistent_id }) }
    assert child.valid?
    B.dispatch('entity.update', { 'path' => [parent.persistent_id, child.persistent_id], 'name' => 'shared' })
    assert_match(/shared definition/, B.instance_variable_get(:@warnings).join)
  end

  def test_stale_path_and_mismatched_id_do_not_mutate
    a = group
    b = group
    child = group(a)
    assert_raises(B::BridgeError) { B.dispatch('entity.delete', { 'path' => [b.persistent_id, child.persistent_id] }) }
    assert_raises(B::BridgeError) { B.dispatch('entity.delete', { 'path' => [a.persistent_id], 'entity_id' => b.persistent_id }) }
    assert child.valid?
    assert b.valid?
  end

  def test_locked_ancestors_are_enforced_in_batch
    parent = group
    child = group(parent)
    parent.locked = true
    assert_raises(ArgumentError) { B.dispatch('batch.run', { 'commands' => [{ 'method' => 'entity.delete', 'params' => { 'path' => [parent.persistent_id, child.persistent_id] } }] }) }
    assert child.valid?
    assert_equal :abort, model.events.last
  end

  def test_model_and_edit_context_guards_precede_transactions
    old = B.model_id
    Sketchup.active_model = Sketchup::Model.new
    assert_raises(B::BridgeError) { B.dispatch('scene.clear', { 'model_id' => old }) }
    parent = group
    model.active_path = [parent]
    assert_raises(B::BridgeError) { B.dispatch('entity.create_box', { 'active_path' => [], 'size' => [1, 2, 3] }) }
    assert_empty model.events
  end

  def test_selection_is_relative_to_active_instance_and_paginates
    parent = group
    child = group(parent)
    copy = model.entities.add_instance(parent.definition, Geom::Transformation.translation([100, 0, 0]))
    model.active_path = [copy]
    model.selection << child
    result = B.dispatch('selection.get', {})[:entities].first
    assert_equal [copy.persistent_id, child.persistent_id], result[:path]
    assert_in_delta 2540, result[:transform][12], 0.001

    model.active_path = nil
    model.selection.clear
    items = 5.times.map { group }
    model.selection.concat(items)
    page1 = B.dispatch('selection.get', { 'limit' => 2, 'offset' => 1 })
    assert_equal 5, page1[:total]
    assert_equal 2, page1[:entities].length
    assert_equal 3, page1[:next_offset]
    assert_equal items[1].persistent_id, page1[:entities][0][:persistent_id]
  end

  def test_materials_tags_and_model_diff_limits
    4.times { |i| model.materials.add("Mat#{i}") }
    mats = B.dispatch('materials.list', { 'limit' => 2, 'offset' => 1 })
    assert_equal 4, mats[:total]
    assert_equal %w[Mat1 Mat2], mats[:materials].map { |m| m[:name] }
    assert_equal 3, mats[:next_offset]

    3.times { |i| model.layers.add("Tag#{i}") }
    tags = B.dispatch('tags.list', { 'limit' => 2, 'offset' => 2 })
    assert_equal 4, tags[:total]
    assert_equal 2, tags[:tags].length
    assert_nil tags[:next_offset]

    snap = B.dispatch('model.snapshot', {})
    4.times { group }
    diff = B.dispatch('model.diff', { 'snapshot_id' => snap[:snapshot_id], 'limit' => 2 })
    assert_equal 2, diff[:added].length
    assert_equal 4, diff[:counts][:added]
    assert_equal true, diff[:truncated]
    assert_match(/truncated/, B.instance_variable_get(:@warnings).join)
  end

  def test_deep_inspection_does_not_fall_back_to_root_coordinates
    parent = model
    chain = []
    25.times do
      parent = group(parent, [1, 0, 0])
      chain << parent.persistent_id
    end
    assert_equal chain, B.inspect_entity({ 'entity_id' => parent.persistent_id })[:entity][:path]
    assert_in_delta 635, B.inspect_entity({ 'path' => chain })[:entity][:transform][12], 0.001
  end

  def test_bounded_scan_does_not_claim_complete_counts
    1005.times { group }
    result = B.list_entities({ 'scan_limit' => 1000, 'limit' => 5, 'include_total' => true })
    assert_equal 1000, result[:scanned]
    refute result[:total_exact]
    assert_equal 5, result[:entities].length
  end

  def test_first_page_stops_before_visiting_the_rest_of_the_model
    1005.times { group }
    result = B.list_entities({ 'limit' => 5 })
    assert_equal 6, result[:scanned]
    assert_equal 5, result[:next_offset]
    refute result[:total_exact]
  end

  def test_cancel_only_removes_the_request_on_its_own_connection
    a = Object.new
    b = Object.new
    B.instance_variable_set(:@config, { 'token' => 'a' * 64, 'ruby_enabled' => false })
    B.instance_variable_set(:@clients, { a => { authenticated: true, out: '' }, b => { authenticated: true, out: '' } })
    B.instance_variable_set(:@history, [])
    jobs = [a, b].map { |socket| { socket: socket, request: { 'id' => 'same-id', 'method' => 'entity.delete' } } }
    B.instance_variable_set(:@jobs, jobs)
    B.receive_line(a, JSON.generate(jsonrpc: '2.0', id: 'cancel', method: 'bridge.cancel', token: 'a' * 64, params: { request_id: 'same-id' }))
    assert_equal [b], jobs.map { |job| job[:socket] }
    assert_equal 'cancelled', B.instance_variable_get(:@history).last[:state]
  end

  def test_ruby_eval_isolates_locals_and_methods_across_calls
    B.instance_variable_set(:@config, { 'token' => 'a' * 64, 'ruby_enabled' => true })
    first = B.dispatch('ruby.eval', { 'code' => 'secret_local = 41; def temp_helper; 1; end; secret_local + temp_helper' })
    assert_equal 42, first[:result]
    assert_raises(NameError) { B.dispatch('ruby.eval', { 'code' => 'secret_local' }) }
    assert_raises(NameError) { B.dispatch('ruby.eval', { 'code' => 'temp_helper' }) }
  end

  def test_drain_jobs_executes_multiple_jobs_within_budget
    Dir.mktmpdir('ringo-ruby-drain-') do |dir|
      cfg = File.join(dir, 'config.json')
      File.write(cfg, JSON.generate({ 'host' => '127.0.0.1', 'port' => 9876, 'token' => 'a' * 64, 'ruby_enabled' => false }))
      B.instance_variable_set(:@bound_config_path, cfg)

      client = Object.new
      B.instance_variable_set(:@clients, { client => { authenticated: true, out: ''.b } })
      B.instance_variable_set(:@history, [])
      now = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      jobs = (1..5).map do |i|
        {
          socket: client,
          request: { 'id' => "req-#{i}", 'method' => 'model.get_info', 'params' => {} },
          queued_at: now,
          model: model,
          active_path: []
        }
      end
      B.instance_variable_set(:@jobs, jobs)
      B.drain_jobs(0.5)
      assert_empty B.instance_variable_get(:@jobs)
      lines = B.instance_variable_get(:@clients)[client][:out].split("\n")
      assert_equal 5, lines.length
      lines.each do |line|
        msg = JSON.parse(line)
        assert_nil msg['error']
        assert_equal true, msg.dig('result', 'success')
      end

      B.instance_variable_get(:@clients)[client][:out] = ''.b
      capped_jobs = (1..3).map do |i|
        {
          socket: client,
          request: { 'id' => "cap-#{i}", 'method' => 'model.get_info', 'params' => {} },
          queued_at: now,
          model: model,
          active_path: []
        }
      end
      B.instance_variable_set(:@jobs, capped_jobs)
      B.drain_jobs(0.0)
      assert_equal 2, B.instance_variable_get(:@jobs).length
      assert_equal 1, B.instance_variable_get(:@clients)[client][:out].split("\n").length
    end
  end

  def test_batch_run_emits_progress_frames_only_when_negotiated
    Dir.mktmpdir('ringo-ruby-progress-') do |dir|
      cfg = File.join(dir, 'config.json')
      File.write(cfg, JSON.generate({ 'host' => '127.0.0.1', 'port' => 9876, 'token' => 'a' * 64, 'ruby_enabled' => false }))
      B.instance_variable_set(:@bound_config_path, cfg)

      stream_client = Object.new
      legacy_client = Object.new
      B.instance_variable_set(
        :@clients,
        {
          stream_client => { authenticated: true, progress_frames: true, out: ''.b },
          legacy_client => { authenticated: true, progress_frames: false, out: ''.b }
        }
      )
      B.instance_variable_set(:@history, [])
      now = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      commands = [
        { 'method' => 'entity.create_box', 'params' => { 'size' => [1, 2, 3] } },
        { 'method' => 'entity.create_box', 'params' => { 'size' => [2, 3, 4] } }
      ]
      B.instance_variable_set(
        :@jobs,
        [
          { socket: stream_client, request: { 'id' => 'batch-stream', 'method' => 'batch.run', 'params' => { 'commands' => commands } }, queued_at: now, model: model, active_path: [] },
          { socket: legacy_client, request: { 'id' => 'batch-legacy', 'method' => 'batch.run', 'params' => { 'commands' => commands } }, queued_at: now, model: model, active_path: [] }
        ]
      )
      B.drain_jobs(1.0)

      stream_msgs = B.instance_variable_get(:@clients)[stream_client][:out].split("\n").map { |l| JSON.parse(l) }
      progress_msgs = stream_msgs.select { |m| m['method'] == 'bridge.progress' }
      assert_equal 4, progress_msgs.length
      assert_equal 'batch-stream', progress_msgs.first.dig('params', 'request_id')
      assert_equal [0, 1, 1, 2], progress_msgs.map { |m| m.dig('params', 'progress') }
      assert_equal true, stream_msgs.last.dig('result', 'success')

      legacy_msgs = B.instance_variable_get(:@clients)[legacy_client][:out].split("\n").map { |l| JSON.parse(l) }
      assert_equal 1, legacy_msgs.length
      assert_equal true, legacy_msgs.first.dig('result', 'success')
    end
  end

  def test_profile_persistence_and_auto_select_free_profile
    Dir.mktmpdir('ringo-ruby-profiles-') do |dir|
      cfg_a = File.join(dir, 'a.json')
      cfg_b = File.join(dir, 'b.json')
      File.write(cfg_a, JSON.generate({ 'host' => '127.0.0.1', 'port' => 9876, 'token' => 'a' * 64, 'profile_id' => 'alpha', 'profile_name' => 'Alpha', 'ruby_enabled' => false }))
      File.write(cfg_b, JSON.generate({ 'host' => '127.0.0.1', 'port' => 9877, 'token' => 'b' * 64, 'profile_id' => 'beta', 'profile_name' => 'Beta', 'ruby_enabled' => false }))
      registry = File.join(dir, 'profiles.json')
      File.write(registry, JSON.generate({ 'version' => 1, 'profiles' => [{ 'id' => 'alpha', 'name' => 'Alpha', 'port' => 9876, 'config' => cfg_a }, { 'id' => 'beta', 'name' => 'Beta', 'port' => 9877, 'config' => cfg_b }] }))

      orig_root = B.method(:config_root)
      orig_start = B.method(:start)
      B.define_singleton_method(:config_root) { dir }
      begin
        assert_equal cfg_a, B.profile_catalog.first['config']

        # select_profile saves preference and survives clearing @selected_profile_id.
        B.define_singleton_method(:start) do
          @bound_config_path = requested_config_path
          @config = nil
          true
        end
        assert_equal true, B.select_profile('beta')
        assert_equal 'beta', B.saved_profile_id
        B.instance_variable_set(:@selected_profile_id, nil)
        B.instance_variable_set(:@bound_config_path, nil)
        B.instance_variable_set(:@config, nil)
        assert_equal cfg_b, B.requested_config_path

        # When auto-select is disabled, conflict stays on the preferred profile and returns false.
        B.save_profile_id('alpha')
        B.set_auto_select_free_profile(false)
        B.define_singleton_method(:start) { false }
        assert_equal false, B.start_or_select_free_profile
        assert_nil B.instance_variable_get(:@selected_profile_id)

        # When auto-select is enabled, conflict falls back to the free profile without overwriting saved preference.
        B.set_auto_select_free_profile(true)
        attempts = 0
        B.define_singleton_method(:start) do
          attempts += 1
          return false if attempts == 1
          @bound_config_path = requested_config_path
          @config = nil
          true
        end
        assert_equal true, B.start_or_select_free_profile
        assert_equal 'beta', B.instance_variable_get(:@selected_profile_id)
        assert_equal 'alpha', B.saved_profile_id
        assert_match(/Beta/, Sketchup.status_text)
      ensure
        B.define_singleton_method(:start, orig_start)
        B.define_singleton_method(:config_root, orig_root)
      end
    end
  end
end
