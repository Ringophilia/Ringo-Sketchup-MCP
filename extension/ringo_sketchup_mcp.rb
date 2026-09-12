require 'sketchup.rb'
require 'extensions.rb'
module RingoSketchupMCP
  unless file_loaded?(__FILE__)
    ext = SketchupExtension.new('Ringo SketchUp MCP', 'ringo_sketchup_mcp/main')
    ext.version = '1.2.0'
    ext.creator = 'Ringo'
    ext.description = 'General-purpose local MCP bridge'
    Sketchup.register_extension(ext, true)
    file_loaded(__FILE__)
  end
end
