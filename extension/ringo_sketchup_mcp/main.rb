require 'sketchup.rb'
require 'uri'
require_relative 'config'
require_relative 'operations'
require_relative 'server'
module RingoSketchupMCP
  unless file_loaded?(__FILE__)
    menu = UI.menu('Extensions').add_submenu('Ringo SketchUp MCP')
    menu.add_item('Start Server') { start }
    menu.add_item('Stop Server') { stop }
    menu.add_item('Connection Status') { UI.messagebox(JSON.pretty_generate(status)) }
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
