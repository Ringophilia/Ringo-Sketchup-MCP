module RingoSketchupMCP
  TICK_BUDGET_SECONDS = 0.03

  module_function

  def running?
    !!@server
  end

  def status
    {
      version: VERSION,
      protocol: PROTOCOL,
      running: running?,
      instance: instance_identity,
      startup_error: @startup_error,
      port: config['port'],
      queue_depth: (@jobs || []).length,
      clients: (@clients || {}).length,
      current: @current,
      recent: (@history || []).last(30),
      capabilities: capabilities,
      sketchup_version: Sketchup.version,
      ruby_version: RUBY_VERSION,
      platform: RUBY_PLATFORM
    }
  end

  def start
    return if running?
    @bound_config_path = requested_config_path
    @config = nil
    @instance_id = SecureRandom.uuid
    @startup_error = nil
    @auto_selected_notice = false
    @clients = {}
    @jobs = []
    @history = []
    @snapshots = {}
    @models = {}
    @active_job = nil
    @server = TCPServer.new('127.0.0.1', config['port'])
    # All I/O is nonblocking, with a time-bounded workload per UI tick. No Ruby worker
    # touches SketchUp objects and no waiting worker can starve another client.
    @timer = UI.start_timer(0.05, true) { tick }
    audit('started', { version: VERSION, protocol: PROTOCOL })
    true
  rescue Errno::EADDRINUSE
    port = config['port']
    profile = config.fetch('profile_id', 'default')
    @server = nil
    @startup_error = "端口 #{port} 已被占用 / Port in use. Another SketchUp may own this profile. Choose a different profile in Extensions → Ringo SketchUp MCP → Select Profile."
    audit('port_conflict', { port: port, profile: profile })
    @bound_config_path = nil
    false
  end

  def start_or_select_free_profile
    return true if start
    return false unless auto_select_free_profile?
    return false if ENV['SKETCHUP_MCP_CONFIG'] || ENV['SKETCHUP_PORT'] || ENV['SKETCHUP_TOKEN']

    attempted_id = config.fetch('profile_id', @selected_profile_id || 'default')
    previous_selected = @selected_profile_id
    profile_catalog.each do |entry|
      next if entry['id'] == attempted_id
      @selected_profile_id = entry['id']
      @config = nil
      if start
        @auto_selected_notice = true
        ident = instance_identity
        audit('auto_selected_profile', { from: attempted_id, to: entry['id'], port: config['port'] })
        set_status_notice(
          "Ringo MCP: 端口已占用，已自动切换到空闲 Profile #{ident[:profile_name]} (#{ident[:profile_id]}) · Port #{config['port']} / Auto-selected free profile."
        )
        return true
      end
    rescue StandardError
      next
    end
    @selected_profile_id = previous_selected
    @bound_config_path = nil
    @config = nil
    false
  end

  def stop
    UI.stop_timer(@timer) if @timer
    (@clients || {}).keys.each { |socket| socket.close rescue nil }
    @server.close if @server
    @server = nil
    @clients = {}
    @jobs = []
    @current = nil
    @active_job = nil
    audit('stopped', {})
    @bound_config_path = nil
    @config = nil
    @startup_error = nil
  end

  def reply(socket, id, result = nil, error = nil)
    state = @clients[socket]
    return unless state
    msg = { 'jsonrpc' => '2.0', 'id' => id }
    if error
      msg['error'] = { 'code' => error.respond_to?(:code) ? error.code : -32000, 'message' => error.message }
      msg['error']['data'] = error.data if error.respond_to?(:data) && error.data
    else
      msg['result'] = result
    end
    line = JSON.generate(msg) + "\n"
    if line.bytesize > MAX_FRAME
      line = JSON.generate({ 'jsonrpc' => '2.0', 'id' => id, 'error' => { 'code' => -32005, 'message' => 'Result too large; paginate the query' } }) + "\n"
    end
    state[:out] << (state[:out].encoding == Encoding::BINARY ? line.b : line)
    disconnect(socket) if state[:out].bytesize > MAX_FRAME * 2
  end

  def disconnect(socket)
    @clients.delete(socket)
    socket.close rescue nil
    (@jobs || []).delete_if { |job| job[:socket] == socket }
  end

  def flush_socket(socket)
    state = @clients[socket]
    return unless state && !state[:out].empty? && socket.respond_to?(:write_nonblock)
    n = socket.write_nonblock(state[:out])
    state[:out] = state[:out].byteslice(n..-1) || ''.b
  rescue IO::WaitWritable
    nil
  rescue EOFError, IOError, SystemCallError
    disconnect(socket)
  end

  def notify_progress(progress, total = nil, message = nil)
    return unless @active_job
    socket = @active_job[:socket]
    state = @clients[socket]
    return unless state && state[:progress_frames]
    params = { 'request_id' => @active_job[:request_id], 'progress' => progress }
    params['total'] = total unless total.nil?
    params['message'] = message unless message.nil?
    line = JSON.generate({ 'jsonrpc' => '2.0', 'method' => 'bridge.progress', 'params' => params }) + "\n"
    return if line.bytesize > MAX_FRAME
    state[:out] << (state[:out].encoding == Encoding::BINARY ? line.b : line)
    disconnect(socket) if state[:out].bytesize > MAX_FRAME * 2
    flush_socket(socket)
  end

  def drain_jobs(budget_seconds = TICK_BUDGET_SECONDS)
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + budget_seconds
    until @jobs.empty?
      job = @jobs.shift
      next unless job && @clients[job[:socket]]
      execute_job(job)
      flush_socket(job[:socket])
      break if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
    end
  end

  def receive_line(socket, line)
    request = JSON.parse(line.force_encoding('UTF-8'))
    valid_id = request.is_a?(Hash) && (request['id'].is_a?(String) || request['id'].is_a?(Integer))
    raise BridgeError.new('Invalid JSON-RPC request', -32600) unless valid_id && request['jsonrpc'] == '2.0' && request['method'].is_a?(String) && (request['params'].nil? || request['params'].is_a?(Hash))
    token = request['token'].to_s
    expected = config['token']
    same = token.bytesize == expected.bytesize && token.bytes.zip(expected.bytes).inject(0) { |memo, (a, b)| memo | (a ^ b) } == 0
    raise BridgeError.new('Unauthorized', -32001) unless same
    state = @clients[socket]
    method = request['method']
    params = request['params'] || {}
    if method == 'bridge.hello'
      raise BridgeError.new('Unsupported protocol major', -32004, { supported_protocols: [PROTOCOL] }) unless params['protocol'] == PROTOCOL
      client_caps = params['capabilities'].is_a?(Hash) ? params['capabilities'] : {}
      state[:authenticated] = true
      state[:progress_frames] = !!client_caps['progress_frames']
      reply(socket, request['id'], { protocol: PROTOCOL, supported_protocols: [PROTOCOL], version: VERSION, capabilities: capabilities, instance: instance_identity })
    else
      raise BridgeError.new('Handshake required', -32001) unless state[:authenticated]
      case method
      when 'bridge.status'
        reply(socket, request['id'], status)
      when 'bridge.cancel'
        target = params['request_id']
        removed = @jobs.select { |job| job[:socket] == socket && job[:request]['id'] == target }
        removed.each do |job|
          @jobs.delete(job)
          reply(job[:socket], target, nil, BridgeError.new('Cancelled before execution', -32003))
          @history << { id: target, method: job[:request]['method'], state: 'cancelled' }
          @history.shift while @history.length > 100
        end
        reply(socket, request['id'], { cancelled: !removed.empty?, running: @current && @current[:id] == target })
      else
        raise BridgeError.new('Queue full; retry after checking status', -32006) if @jobs.length >= 128
        raise BridgeError.new('Duplicate pending request ID', -32600) if @jobs.any? { |j| j[:socket] == socket && j[:request]['id'] == request['id'] }
        @jobs << { socket: socket, request: request, queued_at: Process.clock_gettime(Process::CLOCK_MONOTONIC), model: Sketchup.active_model, active_path: (Sketchup.active_model.active_path || []).map { |e| pid(e) } }
      end
    end
  rescue JSON::ParserError
    reply(socket, nil, nil, BridgeError.new('Invalid JSON', -32700))
  rescue StandardError => e
    reply(socket, request.is_a?(Hash) ? request['id'] : nil, nil, e)
  end

  def tick
    return unless @server
    4.times do
      begin
        socket = @server.accept_nonblock
        if @clients.length >= 16
          socket.close
          next
        end
        socket.setsockopt(Socket::IPPROTO_TCP, Socket::TCP_NODELAY, 1)
        @clients[socket] = { input: ''.b, out: ''.b, authenticated: false, activity: Time.now.to_f }
      rescue IO::WaitReadable
        break
      end
    end
    @clients.keys.each do |socket|
      state = @clients[socket]
      begin
        8.times do
          begin
            bytes = socket.read_nonblock(65536)
            state[:input] << bytes
            state[:activity] = Time.now.to_f
          rescue IO::WaitReadable
            break
          end
        end
        128.times do
          index = state[:input].index("\n")
          break unless index
          line = state[:input].slice!(0, index + 1)
          raise 'Frame too large' if line.bytesize > MAX_FRAME
          receive_line(socket, line)
        end
        raise 'Frame too large' if state[:input].bytesize > MAX_FRAME
        flush_socket(socket)
        disconnect(socket) if @clients[socket] && !state[:authenticated] && Time.now.to_f - state[:activity] > 10
      rescue EOFError, IOError, SystemCallError, RuntimeError
        disconnect(socket)
      end
    end
    drain_jobs
  rescue StandardError => e
    audit('tick_error', e.class.name)
  end

  def execute_job(job)
    req = job[:request]
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    @current = { id: req['id'], method: req['method'], state: 'running' }
    @active_job = { socket: job[:socket], request_id: req['id'] }
    begin
      raise BridgeError.new('Request expired before execution', -32003) if req['deadline_ms'] && Time.now.to_f * 1000 > Float(req['deadline_ms'])
      raise BridgeError.new('Active model changed while request was queued', -32007) unless job[:model] == Sketchup.active_model
      if job[:active_path] != (Sketchup.active_model.active_path || []).map { |e| pid(e) }
        raise BridgeError.new('Edit context changed while request was queued', -32007)
      end
      data = dispatch(req['method'], req['params'] || {})
      elapsed = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000).round
      reply(job[:socket], req['id'], { success: true, data: data, warnings: @warnings || [], operation_id: req['id'], elapsed_ms: elapsed, queue_ms: ((started - job[:queued_at]) * 1000).round })
      @current[:state] = 'completed'
    rescue StandardError, SyntaxError => error
      error = BridgeError.new(error.message, -32602) if error.is_a?(ArgumentError) || error.is_a?(KeyError)
      reply(job[:socket], req['id'], nil, error)
      @current[:state] = 'failed'
      @current[:error_code] = error.code if error.respond_to?(:code)
    ensure
      @active_job = nil
      @current[:elapsed_ms] = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000).round
      audit('request', @current)
      @history << @current
      @history.shift while @history.length > 100
      @current = nil
    end
  end
end
