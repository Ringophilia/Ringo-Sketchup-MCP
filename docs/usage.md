# 使用指南

## 第一次建模

把下面的话交给已经连接 sketchup MCP 的 Agent：

> 先确认当前 SketchUp 模型。创建一个 1200 × 600 × 30 毫米的桌面，桌面底部离地 720 毫米；创建四条 40 × 40 毫米的桌腿，给它们起清楚的名字，最后调整相机并把视图展示出来。

推荐流程：`model_get_info` → `entity_list` → 创建/编辑 → `camera_set` → `view_capture`。首次修改前必须读取模型信息，防止在错误模型里执行。模型切换后重新读取；超时后先检查状态及模型，再决定是否重试。

## 实体与坐标

`entity_list` 返回 `persistent_id`、完整 `path`、`model_id`、世界包围盒和世界变换。路径只包含从模型根到实体的组/组件实例及最终实体 ID。

例如父组件路径是 `[100,200]`，在该父级里创建一个盒子：

```json
{
  "model_id": "从 model_get_info 取得",
  "parent": {"path": [100,200]},
  "size": [200,100,50],
  "origin": [10,20,0],
  "unit": "mm",
  "name": "配件"
}
```

这里 `origin` 是父容器的局部坐标，返回包围盒和 `transform` 已包含父级的移动、旋转和缩放。后续引用使用返回的完整路径，例如 `[100,200,300]`。同时提供 ID 和路径时，ID 必须等于路径最后一项。

`entity_transform` 的增量平移、旋转轴和缩放中心也在父坐标系中。`matrix` 是替换局部变换的 16 元素列主序矩阵；平移项为第 13–15 项（索引 12–14），使用 `unit`。它不能和增量旋转、缩放、平移混用。世界变换矩阵不能直接作为嵌套实体的局部矩阵。

共享组件的子实体在多个实例中有相同 ID；只提供 ID 时会报告歧义。显式路径能定位实例，但编辑共享定义中的子实体仍会影响其他实例。需要独立修改时，对最外层共享祖先调用 `entity_make_unique`，再沿路径重新查询，直到目标父级独立。原子实体 ID 可能已经失效。

## 批量修改与撤销

`batch_run` 的 `method` 支持 MCP 工具名或内部 RPC 方法名，所有步骤复用单工具参数校验和默认值：

```json
{
  "model_id": "从 model_get_info 取得",
  "operation_name": "创建两块板",
  "commands": [
    {"method": "entity_create_box", "params": {"size": [500,300,20], "name": "底板"}},
    {"method": "entity_create_box", "params": {"size": [500,20,300], "origin": [0,280,20], "name": "背板"}}
  ]
}
```

批次级 `model_id` 会传给子命令；冲突的模型 ID、未知参数、非法尺寸或不支持的方法会在发送前被拒绝。合法请求进入 SketchUp 后，某一步运行失败会回滚前面的修改。一个批次对应一次 `model_undo`。

批次仅支持工具描述中的模型修改，不包括文件保存、Ruby、Undo/Redo 或嵌套批次。创建结果不能在同一批次里用变量引用；需要新增实体 ID 时，先创建，再查询或使用返回值发起下一批操作。

## 大模型查询

优先按 `path` 查询目标组件的子实体，限制 `max_depth`，再用 `name`、`type` 或 `tag` 筛选。

默认 `limit:100`。普通查询会在拿到一页并确认还有下一项后返回，`total` 可能只是已发现匹配项数量；以 `total_exact` 判断它是否是完整总数，以 `next_offset` 翻页。

需要总数时传 `include_total:true`。数量上限 `scan_limit` 默认 100,000；还存在约 500 ms 的协作式遍历预算。`truncated:true` 表示扫描未完成，应缩小父级范围或减少深度。增加数量上限不能取消时间预算。分页期间如果模型发生变化，应从头查询，避免偏移错位。

`model_stats` 也会报告 `total_exact:false`。快照无法完整遍历时会明确失败，避免把未扫描的对象误报为删除。

## 图片、文件与高级脚本

`view_capture` 不需要路径，直接返回 PNG，默认 1280 × 960；过大的复杂视图可降低分辨率。它不会把大段 base64 再复制到文本结果里。

`view_export` 用于保存 PNG/JPG，路径必须绝对，默认不覆盖。`model_save` 保存 SKP，`model_export` 使用宿主安装的导出器。不同 SketchUp 版本和授权可能支持不同格式；以工具的实际返回结果为准。

`sketchup_run_ruby` 默认关闭。开启后可以运行完整 SketchUp API，且无法可靠强制取消正在运行的脚本。默认自动事务，脚本内部不要再调用 `start_operation`；自行管理事务时显式传 `transaction:false`。

## 常见错误

| 现象 | 处理方式 |
|---|---|
| 首次修改提示先读取模型 | 调用 `model_get_info`，确认标题和路径后继续 |
| `-32007` 模型或编辑上下文变化 | 重新读取模型信息，重新确认目标 |
| `-32008` 引用失效或歧义 | 用 `entity_list` 重新查完整路径；不要猜 ID |
| 锁定实体或祖先 | 先确认是否需要解锁，再修改对应祖先 |
| `-32602` 参数错误 | 按错误信息修正参数；未成功的批次不应盲目重试 |
| `-32003` 超时/取消 | 查 `bridge_status` 和实际模型；执行结果可能未知 |
| `-32005` 结果/查询过大 | 缩小父级范围、降低深度或图片尺寸 |
| doctor 显示版本不一致 | 运行 `npm run setup`，关闭并重启 SketchUp |
| doctor 显示认证失败 | 检查两端使用相同配置目录，保留原 token，重启两端 |
| 工具能列出但 SketchUp 未连接 | 打开桌面模型、启用扩展并运行 `npm run doctor` |

## 升级与恢复

升级时先关闭 SketchUp，再更新仓库并运行 `npm run setup`。备份包含原 loader 与整个实现目录，安装日志打印备份位置。

需要恢复旧版本时，关闭 SketchUp，将备份中的 `ringo_sketchup_mcp.rb` 和 `ringo_sketchup_mcp/` 一起恢复到原 Plugins 目录，并使用匹配版本的 Node 服务。不要混用新旧扩展文件。正常升级保留 token；无需在聊天中复制认证信息。

## 同时做两个项目

为两个项目建立不同 profile：

```sh
npm run setup -- --profile project-a --name "Project A" --port 9876
npm run setup -- --profile project-b --name "Project B" --port 9877
```

在 `.agent-config/project-a/` 和 `.agent-config/project-b/` 中分别找到生成的 `mcp.json`、`codex.toml` 和 `vscode.json`，合并两个服务。两个服务会分别显示为 `sketchup-project-a` 和 `sketchup-project-b`。profile ID 是用户自定义的路由标签。

打开两个 SketchUp 后，在每个窗口分别选择 **Extensions → Ringo SketchUp MCP → Select Profile**。不要让两个进程都使用 default；如果端口冲突，扩展会在状态栏提示选择另一个 profile。

给 LLM 的安全指令应该明确目标：

> 先调用 sketchup-project-a 的 bridge_status，确认 profile_id=project-a 和模型路径；只在这个服务中修改项目 A。完成后调用 sketchup-project-b 的 bridge_status，确认 profile_id=project-b；只在这个服务中修改项目 B。

每次修改前，LLM 都应该确认服务名、profile、模型标题和模型路径。两个服务的实体 ID、快照和会话不能互换。开发者验证多实例隔离的方法见[验证记录](validation.md)。
