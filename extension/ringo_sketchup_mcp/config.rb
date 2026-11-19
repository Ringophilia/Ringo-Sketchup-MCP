require 'json'
require 'socket'
require 'securerandom'
require 'fileutils'
require 'time'
require 'stringio'

module RingoSketchupMCP
  VERSION = '2.0.0'
  PROTOCOL = 3
  MAX_FRAME = 4 * 1024 * 1024
  PREFS_SECTION = 'RingoSketchUpMCP'.freeze
  PREFS_PROFILE_KEY = 'selected_profile_id'.freeze
  PREFS_AUTO_SELECT_KEY = 'auto_select_free_profile'.freeze

  module_function

  def config_root
    home = Dir.home
    if RUBY_PLATFORM =~ /mswin|mingw/
      File.join(ENV['APPDATA'] || File.join(home, 'AppData', 'Roaming'), 'RingoSketchUpMCP')
    elsif RUBY_PLATFORM =~ /darwin/
      File.join(home, 'Library', 'Application Support', 'RingoSketchUpMCP')
    else
      File.join(home, '.config', 'ringo-sketchup-mcp')
    end
  end

  def profile_catalog
    path = File.join(config_root, 'profiles.json')
    return [] unless File.file?(path)
    registry = JSON.parse(File.read(path, encoding: 'UTF-8').sub(/\A\uFEFF/, ''))
    raise 'Invalid profiles registry' unless registry.is_a?(Hash) && registry['profiles'].is_a?(Array)
    registry['profiles'].select do |p|
      p.is_a?(Hash) &&
        p['id'].is_a?(String) &&
        p['id'] =~ /\A[A-Za-z0-9][A-Za-z0-9._-]{0,63}\z/ &&
        p['config'].is_a?(String)
    end
  end

  def saved_profile_id
    return nil unless Sketchup.respond_to?(:read_default)
    id = Sketchup.read_default(PREFS_SECTION, PREFS_PROFILE_KEY, nil)
    return nil unless id.is_a?(String) && !id.empty?
    return nil unless profile_catalog.any? { |p| p['id'] == id }
    id
  rescue StandardError
    nil
  end

  def save_profile_id(id)
    return unless Sketchup.respond_to?(:write_default)
    Sketchup.write_default(PREFS_SECTION, PREFS_PROFILE_KEY, id.to_s)
  rescue StandardError
    nil
  end

  def auto_select_free_profile?
    if ENV.key?('SKETCHUP_MCP_AUTO_PROFILE')
      return ENV['SKETCHUP_MCP_AUTO_PROFILE'] == '1'
    end
    return false unless Sketchup.respond_to?(:read_default)
    value = Sketchup.read_default(PREFS_SECTION, PREFS_AUTO_SELECT_KEY, false)
    value == true || value == 'true' || value == 1
  rescue StandardError
    false
  end

  def set_auto_select_free_profile(enabled)
    return unless Sketchup.respond_to?(:write_default)
    Sketchup.write_default(PREFS_SECTION, PREFS_AUTO_SELECT_KEY, !!enabled)
  rescue StandardError
    nil
  end

  def set_status_notice(text)
    Sketchup.set_status_text(text) if Sketchup.respond_to?(:set_status_text)
  rescue StandardError
    nil
  end

  def requested_config_path
    return ENV['SKETCHUP_MCP_CONFIG'] if ENV['SKETCHUP_MCP_CONFIG'] && !@selected_profile_id
    id = @selected_profile_id || ENV['SKETCHUP_MCP_PROFILE'] || saved_profile_id
    if id
      profile = profile_catalog.find { |p| p['id'] == id }
      raise "Unknown profile #{id}; run npm run setup -- --profile #{id} --port PORT" unless profile
      return profile['config']
    end
    File.join(config_root, 'config.json')
  end

  def config_path
    @bound_config_path || requested_config_path
  end

  def select_profile(id)
    raise 'Unknown profile' unless profile_catalog.any? { |p| p['id'] == id }
    previous = @selected_profile_id
    stop if running?
    @selected_profile_id = id
    @config = nil
    started = start
    if started
      save_profile_id(id)
      ident = instance_identity
      set_status_notice("Ringo MCP: #{ident[:profile_name]} (#{ident[:profile_id]}) · Port #{config['port']}")
    end
    started
  rescue StandardError
    @selected_profile_id = previous
    @config = nil
    raise
  end

  def instance_identity
    {
      profile_id: config.fetch('profile_id', 'default'),
      profile_name: config.fetch('profile_name', config.fetch('profile_id', 'default')),
      instance_id: (@instance_id ||= SecureRandom.uuid),
      process_id: Process.pid,
      port: config['port']
    }
  end

  def config
    return @config if @config
    FileUtils.mkdir_p(File.dirname(config_path))
    unless File.exist?(config_path)
      File.open(config_path, File::WRONLY | File::CREAT | File::EXCL, 0o600) do |f|
        f.write(JSON.pretty_generate({ 'host' => '127.0.0.1', 'port' => 9876, 'token' => SecureRandom.hex(32), 'ruby_enabled' => false }))
      end
    end
    @config = JSON.parse(File.read(config_path, encoding: 'UTF-8').sub(/\A\uFEFF/, ''))
    @config['token'] = ENV['SKETCHUP_TOKEN'] if ENV['SKETCHUP_TOKEN'] && !@selected_profile_id
    @config['port'] = Integer(ENV['SKETCHUP_PORT']) if ENV['SKETCHUP_PORT'] && !@selected_profile_id
    @config['ruby_enabled'] = ENV['SKETCHUP_ENABLE_RUBY_EVAL'] == '1' if ENV.key?('SKETCHUP_ENABLE_RUBY_EVAL')
    raise 'Only localhost is supported' unless (@config['host'] || '127.0.0.1') == '127.0.0.1'
    raise 'Invalid token (minimum 32 characters)' unless @config['token'].is_a?(String) && @config['token'].size >= 32
    raise 'Invalid TCP port' unless (1..65535).include?(@config['port'])
    @config
  end

  def audit(event, data)
    path = File.join(File.dirname(config_path), 'bridge.log')
    FileUtils.mkdir_p(File.dirname(path))
    File.rename(path, path + '.1') if File.exist?(path) && File.size(path) > 2 * 1024 * 1024
    # Never log tokens, code, paths, or complete parameters.
    File.open(path, 'a') { |f| f.puts(JSON.generate({ time: Time.now.utc.iso8601, event: event, detail: data })) }
  rescue StandardError
    nil
  end

  def capabilities
    {
      ruby: !!config['ruby_enabled'],
      persistent_ids: Sketchup.active_model.respond_to?(:find_entity_by_persistent_id),
      redo: Sketchup.respond_to?(:redo),
      pbr: Sketchup::Material.method_defined?(:roughness_factor=),
      camera: defined?(Sketchup::Camera) ? true : false,
      snapshots: true,
      batch: true,
      mesh: true,
      view_capture: true,
      guarded_context: true,
      profiles: true,
      cancel: 'queued_only',
      progress: 'batch_steps',
      foreground_detection: false
    }
  end

  class BridgeError < StandardError
    attr_reader :code, :data

    def initialize(message, code = -32000, data = nil)
      super(message)
      @code = code
      @data = data
    end
  end

  class BoundedOutput
    attr_reader :string, :truncated

    def initialize
      @string = ''
      @truncated = false
    end

    def write(text)
      text = text.to_s
      remaining = 16000 - @string.bytesize
      @string << text.byteslice(0, remaining).to_s if remaining > 0
      @truncated = true if text.bytesize > remaining
      text.bytesize
    end

    def flush
      self
    end

    def tty?
      false
    end

    def puts(*args)
      args = [''] if args.empty?
      args.each do |a|
        write(a.to_s)
        write("\n") unless a.to_s.end_with?("\n")
      end
      nil
    end

    def print(*args)
      args.each { |a| write(a) }
      nil
    end
  end
end
