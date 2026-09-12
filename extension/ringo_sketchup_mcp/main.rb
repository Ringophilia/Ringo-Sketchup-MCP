require 'sketchup.rb'
require 'uri'
require_relative 'config'
require_relative 'operations'
require_relative 'server'
module RingoSketchupMCP
  def self.connection_message
    data=status
    [
      "Ringo SketchUp MCP #{VERSION}",
      data[:running] ? '桥接已启动 / Bridge running' : '桥接已停止 / Bridge stopped',
      "已连接进程 / Connected clients: #{data[:clients]}",
      "等待任务 / Queued requests: #{data[:queue_depth]}",
      "SketchUp #{Sketchup.version} · Ruby #{RUBY_VERSION}",
      '',
      '首次连接：在项目目录运行 npm run setup，按 docs/agents.md 导入客户端配置。',
      'First connection: run npm run setup and import the generated client configuration.',
      '连接问题 / Troubleshooting: npm run doctor',
      "配置 / Config: #{config_path}"
    ].join("\n")
  end
  unless file_loaded?(__FILE__)
    menu = UI.menu('Extensions').add_submenu('Ringo SketchUp MCP')
    menu.add_item('Start Server') do
      begin
        start
      rescue StandardError => error
        UI.messagebox('启动失败 / Could not start: '+error.message+"\n运行 npm run doctor 获取修复步骤。")
      end
    end
    menu.add_item('Stop Server') { stop }
    menu.add_item('Connection Status') { UI.messagebox(connection_message) }
    menu.add_item('Open Configuration Folder') do
      path=File.dirname(config_path).tr('\\', '/')
      UI.openURL((path.start_with?('/') ? 'file://' : 'file:///') + URI::DEFAULT_PARSER.escape(path))
    end
    begin
      start
    rescue StandardError => error
      audit('startup_error', error.class.name + ': ' + error.message)
      UI.messagebox('Ringo MCP could not start: ' + error.message + "\nConfiguration: " + config_path)
    end
    file_loaded(__FILE__)
  end
end
