# Prompt Library / 示例提示词库

Copy-paste these prompts into ChatGPT Desktop, Codex, Claude, or Cursor once your SketchUp MCP server is connected. For multi-step workflows, clients that support MCP Prompts can also invoke `sketchup-modeling-workflow`.

## 1. Status & Visual Inspection / 连接检查与视图预览

**中文**
> 使用 sketchup MCP：先调用 `bridge_status` 确认连接的实例和端口，然后调用 `model_get_info` 读取模型会话与单位，并用 `view_capture` 查看当前视图。

**English**
> Using the sketchup MCP, call `bridge_status` to confirm the target instance and port, read `model_get_info` to check units and edit context, and capture the current viewport with `view_capture`.

## 2. Studio Desk with Units & Cylinders / 带单位与圆柱的桌面建模

**中文**
> 先确认当前模型。以毫米为单位创建一个工作台：四条 45 × 45 × 720 mm 的桌腿（四角分布），上面是一块 1400 × 700 × 30 mm 的桌面；在桌面右上角添加一个半径 4.5 cm、高 11 cm 的圆柱形笔筒（`unit: "cm"`, `smooth: true`）。最后设置好相机角度并用 `view_capture` 展示给我。

**English**
> Check the active model first. Build a studio desk in millimeters: four 45 × 45 × 720 mm legs under a 1400 × 700 × 30 mm tabletop. Place a cylindrical pen cup on the top-right corner using `unit: "cm"` (`radius: 4.5`, `height: 11`, `smooth: true`). Frame the desk with `camera_set` and inspect the render with `view_capture`.

## 3. Atomic Batch Edits / 批量修改（单次撤销）

**中文**
> 读取模型信息后，用一次 `batch_run`（`operation_name: "建立三层置物架"`）创建三块 800 × 300 × 20 mm 的隔板，Z 高度分别为 200、550 和 900 mm，并分别命名为 Shelf-1、Shelf-2、Shelf-3。完成后查看结果，如果需要回退请只执行一次 `model_undo`。

**English**
> Read `model_get_info`, then run a single `batch_run` (`operation_name: "Build 3-tier shelf"`) creating three 800 × 300 × 20 mm boards at Z = 200, 550, and 900 mm named Shelf-1, Shelf-2, and Shelf-3. Inspect with `view_capture`.

## 4. Nested & Shared Components / 嵌套与共享组件编辑

**中文**
> 用 `entity_list(recursive: true)` 查找包含共享子组件的实例路径。先对需要独立修改的那个外部祖先调用 `entity_make_unique`，重新查询更新后的 `path`，再对该子组件执行平移或改名，避免误改其他副本。

**English**
> Use `entity_list(recursive: true)` to locate shared component paths. Call `entity_make_unique` on the outermost shared ancestor you want to isolate, re-query the refreshed `path`, and then transform or rename the child without affecting sibling instances.

## 5. Materials, Tags & Scenes / 材质、标签、相机与场景

**中文**
> 创建两个材质：`Oak`（RGB `[186, 134, 84]`，roughness `0.55`）和 `MatteSteel`（RGB `[64, 70, 78]`，roughness `0.35`），分别赋予桌面和桌腿，把桌面放到 `Wood` 标签、桌腿放到 `Metal` 标签，然后保存一个名为 `Overview` 的场景并导出视图。

**English**
> Create `Oak` (`[186, 134, 84]`, roughness `0.55`) and `MatteSteel` (`[64, 70, 78]`, roughness `0.35`) materials, assign them to the tabletop and legs respectively, tag them `Wood` and `Metal`, save a scene named `Overview`, and capture the view.

## 6. Large-Model Paginated Queries & Diffs / 大模型分页查询与快照对比

**中文**
> 先调用 `model_snapshot` 保存基线。使用 `entity_list` 时限定目标父级 `path` 并设置 `limit: 50` 翻页（通过 `next_offset` 获取后续页面）。完成一轮修改后调用 `model_diff`（设置 `limit: 100`），检查 `counts` 和 `truncated` 确认变更范围。

**English**
> Take a baseline with `model_snapshot`. Query large assemblies using scoped `entity_list` with `path`, `max_depth`, and `limit: 50`, paging via `next_offset`. After editing, run `model_diff` with `limit: 100` and inspect `counts` and `truncated`.

## 7. Multi-Instance Isolated Workflows / 多开 SketchUp 项目隔离

**中文**
> 分别调用 `sketchup-project-a` 和 `sketchup-project-b` 的 `bridge_status`，核对 `profile_id` 与 `port` 后再调用各自的 `model_get_info`。只向 `sketchup-project-a` 添加主体体块，只向 `sketchup-project-b` 添加测试参考体块，不要跨实例混用 `model_id` 或实体路径。

**English**
> Call `bridge_status` on both `sketchup-project-a` and `sketchup-project-b` to confirm `profile_id` and `port`, then call `model_get_info` on each. Keep entity paths, snapshots, and `model_id` strictly separated per server.

## 8. Isolated Ruby Evaluation / 高级 Ruby API（仅在显式开启时）

**中文**
> 确认 `bridge_status` 中 `capabilities.ruby` 为 `true` 后，使用 `sketchup_run_ruby` 查询当前选中面总面积（以平方米输出）。注意每次脚本都在独立上下文中运行，不要依赖上一次脚本的局部变量。

**English**
> After confirming `capabilities.ruby` is `true` in `bridge_status`, run a read-only `sketchup_run_ruby` script (`transaction: false`) to sum the area of selected faces in square meters. Each invocation runs in an isolated context, so do not rely on local variables or helper methods defined in previous calls.
