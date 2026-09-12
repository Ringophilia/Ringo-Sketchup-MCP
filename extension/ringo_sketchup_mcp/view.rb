require 'tempfile'
require 'base64'
module RingoSketchupMCP
  module_function
  def frame_bounds(view, bounds)
    camera=view.camera
    radius=[bounds.diagonal/2.0,0.001].max
    aspect=[view.vpwidth.to_f/[view.vpheight,1].max,0.001].max
    if camera.perspective?
      half_angle=camera.fov*Math::PI/360.0
      if camera.respond_to?(:fov_is_height?) && camera.fov_is_height?
        half_angle=Math.atan(Math.tan(half_angle)*[aspect,1].min)
      else
        half_angle=Math.atan(Math.tan(half_angle)/[aspect,1].max)
      end
      distance=radius/Math.sin(half_angle)*1.1
    else
      camera.height=radius*2.2/[aspect,1].min
      distance=[camera.eye.distance(camera.target),radius*3].max
    end
    center=bounds.center
    camera.set(center.offset(camera.direction,-distance),center,camera.up)
    view.camera=camera
  end

  def capture_view(params)
    width=Integer(params.fetch('width',1280)); height=Integer(params.fetch('height',960))
    raise ArgumentError,'Preview dimensions must be 64-2048 pixels' unless (64..2048).include?(width) && (64..2048).include?(height)
    Tempfile.create(['ringo-preview-','.png']) do |file|
      path=file.path
      file.close
      ok=model.active_view.write_image(filename:path,width:width,height:height,antialias:true,transparent:params.fetch('transparent',false))
      raise BridgeError.new('Could not capture the active view',-32004) unless ok
      raise BridgeError.new('Preview exceeds 2 MiB; reduce width and height',-32005) if File.size(path)>2*1024*1024
      {mime_type:'image/png',image_base64:Base64.strict_encode64(File.binread(path)),width:width,height:height,model_id:model_id}
    end
  end
end
