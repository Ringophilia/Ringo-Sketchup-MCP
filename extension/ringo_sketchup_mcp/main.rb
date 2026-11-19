require 'sketchup.rb'
require 'uri'
require_relative 'config'
require_relative 'operations'
require_relative 'server'

module RingoSketchupMCP
  def self.connection_message
    data = status
    [
      "Ringo SketchUp MCP #{VERSION}",
      data[:running] ? '桥接已启动 / Bridge running' : '桥接已停止 / Bridge stopped',
      "实例 / Profile: #{data[:instance][:profile_name]} (#{data[:instance][:profile_id]}) · Port #{data[:port]}",
      data[:startup_error],
      "已连接进程 / Connected clients: #{data[:clients]}",
      "等待任务 / Queued requests: #{data[:queue_depth]}",
      "SketchUp #{Sketchup.version} · Ruby #{RUBY_VERSION}",
      '',
      '首次连接：在项目目录运行 npm run setup，按 docs/agents.md 导入客户端配置。',
      'First connection: run npm run setup and import the generated client configuration.',
      '连接问题 / Troubleshooting: npm run doctor',
      "配置 / Config: #{config_path}"
    ].compact.join("\n")
  end

  unless file_loaded?(__FILE__)
    menu = UI.menu('Extensions').add_submenu('Ringo SketchUp MCP')
    menu.add_item('Start Server') do
      begin
        UI.messagebox(connection_message) unless start
      rescue StandardError => error
        UI.messagebox('启动失败 / Could not start: ' + error.message + "\n运行 npm run doctor 获取修复步骤。")
      end
    end
    menu.add_item('Stop Server') { stop }
    menu.add_item('Connection Status') { UI.messagebox(connection_message) }
    menu.add_item('Select Profile') do
      begin
        profiles = profile_catalog
        if profiles.empty?
          UI.messagebox('没有 profile。运行 npm run setup -- --profile project-a --port 9876，然后重新打开此菜单。')
        else
          labels = profiles.map { |p| "#{p['id']} : #{p['name']} (#{p['port']})" }
          current_id = config.fetch('profile_id', 'default')
          current_index = profiles.index { |p| p['id'] == current_id } || 0
          choice = UI.inputbox(['Profile'], [labels[current_index]], [labels.join('|')], 'Choose this SketchUp process profile')
          if choice
            index = labels.index(choice.first)
            select_profile(profiles[index]['id']) if index
            UI.messagebox(connection_message)
          end
        end
      rescue StandardError => error
        UI.messagebox('Profile selection failed: ' + error.message)
      end
    end
    auto_item = menu.add_item('Auto-Select Free Profile on Conflict') do
      enabled = !auto_select_free_profile?
      set_auto_select_free_profile(enabled)
      notice = enabled ? '已开启端口冲突自动选择空闲 Profile / Auto-select free profile enabled.' : '已关闭自动选择空闲 Profile / Auto-select free profile disabled.'
      set_status_notice("Ringo MCP: #{notice}")
    end
    menu.set_validation_proc(auto_item) { auto_select_free_profile? ? MF_CHECKED : MF_UNCHECKED }
    menu.add_item('Open Configuration Folder') do
      path = File.dirname(config_path).tr('\\', '/')
      UI.openURL((path.start_with?('/') ? 'file://' : 'file:///') + URI::DEFAULT_PARSER.escape(path))
    end
    begin
      if start_or_select_free_profile
        ident = instance_identity
        if !@auto_selected_notice && ident[:profile_id] != 'default'
          set_status_notice("Ringo MCP: #{ident[:profile_name]} (#{ident[:profile_id]}) · Port #{config['port']}")
        end
      else
        set_status_notice('Ringo MCP: 端口已占用；请在扩展菜单选择其他 Profile / Port occupied; choose another profile.')
      end
    rescue StandardError => error
      audit('startup_error', error.class.name + ': ' + error.message)
      UI.messagebox('Ringo MCP could not start: ' + error.message + "\nConfiguration: " + config_path)
    end
    file_loaded(__FILE__)
  end
end
