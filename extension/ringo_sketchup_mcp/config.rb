require 'json'
require 'socket'
require 'securerandom'
require 'fileutils'
require 'time'
require 'stringio'
module RingoSketchupMCP
  VERSION = '1.1.0'
  PROTOCOL = 3
  MAX_FRAME = 4 * 1024 * 1024
  module_function
  def config_path
    return ENV['SKETCHUP_MCP_CONFIG'] if ENV['SKETCHUP_MCP_CONFIG']
    home = Dir.home
    root = if RUBY_PLATFORM =~ /mswin|mingw/
      File.join(ENV['APPDATA'] || File.join(home, 'AppData', 'Roaming'), 'RingoSketchUpMCP')
    elsif RUBY_PLATFORM =~ /darwin/
      File.join(home, 'Library', 'Application Support', 'RingoSketchUpMCP')
    else
      File.join(home, '.config', 'ringo-sketchup-mcp')
    end
    File.join(root, 'config.json')
  end
  def config
    return @config if @config
    FileUtils.mkdir_p(File.dirname(config_path))
    unless File.exist?(config_path)
      File.open(config_path, File::WRONLY | File::CREAT | File::EXCL, 0600) { |f| f.write(JSON.pretty_generate({'host'=>'127.0.0.1', 'port'=>9876, 'token'=>SecureRandom.hex(32), 'ruby_enabled'=>false})) }
    end
    @config = JSON.parse(File.read(config_path, encoding: 'UTF-8').sub(/\A\uFEFF/, ''))
    @config['token'] = ENV['SKETCHUP_TOKEN'] if ENV['SKETCHUP_TOKEN']
    @config['port'] = Integer(ENV['SKETCHUP_PORT']) if ENV['SKETCHUP_PORT']
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
    File.open(path, 'a') { |f| f.puts(JSON.generate({time: Time.now.utc.iso8601, event: event, detail: data})) }
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
      snapshots: true, batch: true, mesh: true,
      cancel: 'queued_only', progress: 'queue_and_completion',
      foreground_detection: false
    }
  end
  class BridgeError < StandardError
    attr_reader :code, :data
    def initialize(message, code = -32000, data = nil); super(message); @code=code; @data=data; end
  end
  class BoundedOutput
    attr_reader :string, :truncated
    def initialize; @string=''; @truncated=false; end
    def write(text)
      text=text.to_s
      remaining=16000-@string.bytesize
      @string << text.byteslice(0,remaining).to_s if remaining>0
      @truncated=true if text.bytesize>remaining
      text.bytesize
    end
    def flush; self; end
    def tty?; false; end
    def puts(*args); args=[''] if args.empty?; args.each { |a| write(a.to_s); write("\n") unless a.to_s.end_with?("\n") }; nil; end
    def print(*args); args.each { |a| write(a) }; nil; end
  end
end
