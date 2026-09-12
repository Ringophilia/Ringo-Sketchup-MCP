# Ringo SketchUp MCP

通用的 SketchUp MCP：TypeScript / Node.js 服务端 + 原生 Ruby 扩展。模型类型不写进服务器；家具、建筑及分析任务通过同一套几何工具和 Ruby API 完成。

当前版本：`1.1.0`。Windows SketchUp 2026 已实际连接验证。macOS 使用同一份 Ruby 扩展和 Node 服务，**尚未做 macOS SketchUp 实机验收**。

## 安装与连接

安装桌面版 SketchUp、Node.js 22 或 24 和 Git，然后：

```sh
git clone https://github.com/Ringophilia/Ringo-Sketchup-MCP.git
cd Ringo-Sketchup-MCP
npm ci
npm run build
npm run install:extension
npm run config:agents
```

项目支持本地 stdio MCP。**ChatGPT 桌面版（原 Codex 桌面版）优先使用 `.agent-config/codex.toml`**；Claude/Cursor 使用生成的 `mcp.json`，VS Code/Copilot 使用 `vscode.json`。配置生成器填入本机 Node 和项目的绝对路径，无需手工拼接，也不包含 token。详细操作见 **[各 Agent 接入指南](docs/agents.md)**。

### macOS 能否安装？

**可以按项目现有跨平台设计安装，但尚未完成 Mac 上的 SketchUp 实机验收。** SketchUp 官方提供 Ruby 扩展和 RBZ 安装机制；本项目没有 Windows DLL 或原生 Node addon，Intel/Apple Silicon 使用同一份源码。必须使用支持扩展的桌面 SketchUp；网页和 iPad 版不适用本地 Ruby 桥接。SketchUp 版本还需满足官方操作系统及硬件要求。

Mac 安装器寻找 `~/Library/Application Support/SketchUp YYYY/SketchUp/Plugins`。先启动一次 SketchUp，再执行上面的命令。也可以运行 `npm run package:rbz`，通过 SketchUp 的 Extension Manager 安装 `release/` 下的 RBZ；Node 服务仍需保留。Mac GUI 应用的 PATH 可能与终端不同，优先使用配置生成器输出的绝对 Node 路径。

官方参考：[扩展安装](https://help.sketchup.com/en/extension-warehouse/adding-extensions-sketchup)、[Ruby API 版本说明](https://ruby.sketchup.com/file.ReleaseNotes.html)、[OpenAI MCP 接入](https://developers.openai.com/codex/mcp/)。更多限制见 [兼容策略](docs/compatibility.md)。

安装器自动寻找 SketchUp 用户目录。多版本共存时可指定：

```sh
node scripts/install.mjs --year 2026
node scripts/install.mjs --plugins "/custom/Plugins"
```

如果需要 AI 使用完整 SketchUp Ruby API：

```sh
node scripts/install.mjs --year 2026 --enable-ruby
```

Ruby 执行默认关闭。安装时生成随机 token，Node 与扩展读取同一配置，无需把 token 粘贴到聊天或 MCP 配置里。

重启 SketchUp，打开模型。插件遵循 Extension Manager 的启用状态；菜单 **Extensions → Ringo SketchUp MCP** 提供启动、停止、状态、配置目录。插件不绕过 Extension Manager 的加载策略。

MCP 客户端配置：

```json
{
  "mcpServers": {
    "sketchup": {
      "command": "node",
      "args": ["/absolute/path/to/Ringo-Sketchup-MCP/dist/mcp-server.js"]
    }
  }
}
```

Windows 路径可用 `C:/Projects/Ringo-Sketchup-MCP/dist/mcp-server.js`。安装器会打印本机准确配置；`npm run config:agents` 会按客户端生成可合并的配置文件。

ChatGPT 网页版需要额外的 HTTPS MCP endpoint 或官方 Secure MCP Tunnel；本仓库提供本地 stdio 服务，内部 TCP 端口不是 HTTP endpoint。详见 [网页端接入边界](docs/agents.md#5-chatgpt-网页版--云端-agent)。

```sh
npm run doctor
```

诊断会显示版本、功能能力、队列、最近请求和端口，不打印认证 token。

## 通用功能

| 类别 | 工具 |
|---|---|
| 状态与模型 | bridge_status、model_get_info、model_stats |
| 查询 | entity_list、entity_inspect、selection_get、selection_set |
| 几何 | entity_create_box、entity_create_cylinder、entity_create_mesh、entity_extrude |
| 编辑 | entity_transform、entity_update、entity_delete、entity_duplicate、entity_group、entity_make_unique |
| 材质与标签 | entity_set_material、materials_list、materials_set、tags_list、tags_set |
| 相机与场景 | camera_get、camera_set、scenes_list、scenes_set |
| 事务与比较 | batch_run、model_undo、model_redo、model_snapshot、model_diff |
| 文件与视图 | model_save、model_export、view_export、scene_clear |
| 高级 API | sketchup_run_ruby |

输入与输出默认毫米，变换矩阵按列排列，平移元素也使用指定单位。轴角旋转优先；Euler 兼容入口按 X、Y、Z 顺序执行。修改对象前查询路径和 `model_id`，在后续操作中携带该 ID 防止编辑错误的模型。

实例路径区分共享组件；修改组件定义中的实体会影响它的其他实例。需要独立修改时，先对父组件调用 `entity_make_unique`，再重新查询子实体。创建工具可用 `parent:{path:[...]}` 指定嵌套容器；返回结果会带完整实例路径和世界坐标摘要。共享组件作为父级时，响应会附带影响其他实例的警告。

所有实体修改工具都接受 `model_id`，批量命令也会继承批次级 `model_id`。`batch_run` 在发送到 SketchUp 前复用单工具参数校验，参数错误不会进入桥接队列。`view_export` 除返回文件路径外，会在图片不超过 4 MiB 时直接返回 MCP image 内容，便于 Agent 立即检查结果。`entity_list` 和 `model_stats` 默认最多扫描 100,000 个实体，返回 `total_exact:false` 时应缩小查询或提高 `scan_limit` / `max_entities`，避免大模型阻塞 UI。

工具返回 MCP `structuredContent` 及等价文本，成功含 `success/data/warnings/operation_id/elapsed_ms/queue_ms`，失败含 `isError` 和明确错误码。读写及破坏性工具带 MCP annotations。

## 运行与安全

- 桥接强制监听 `127.0.0.1`，握手和每个请求都检查 token。
- Ruby API 只在 SketchUp UI 线程执行；TCP 采用非阻塞 I/O，最多 16 个客户端、128 个排队任务、4 MiB 单帧。
- 已过期或取消的排队任务不执行。**正在运行的任意 Ruby 无法安全强制中止**，不要提交无限循环；客户端超时不等于操作没有执行。
- 不自动重放修改请求；断线后的下一次新调用重新连接。状态工具可查询最近任务。
- 标准模型修改自动事务；批量任一步失败则整体回滚。Ruby 默认也有事务，脚本中不要再嵌套 start_operation；自行管理时传 `transaction:false`。
- stdout 捕获上限 16 KB；日志轮转且不记录 token、脚本、完整参数。
- 保存、导出默认不覆盖文件，需要显式 `overwrite:true`。
- 快照比较容器及根实体的元数据，最多 10,000 项，保留最近 10 个；不是逐顶点几何 diff。
- 桥接没有可靠的跨平台前台窗口检测，因此报告 capability=false；GUI 忙碌、模态框或很长的脚本仍可能延迟响应。

配置目录：

| 平台 | 位置 |
|---|---|
| Windows | `%APPDATA%/RingoSketchUpMCP/config.json` |
| macOS | `~/Library/Application Support/RingoSketchUpMCP/config.json` |
| 自定义 | 环境变量 `SKETCHUP_MCP_CONFIG` |

可覆盖 `SKETCHUP_PORT`、`SKETCHUP_TOKEN`、`SKETCHUP_TIMEOUT_MS`、`SKETCHUP_ENABLE_RUBY_EVAL`。macOS 通过 Finder 启动的应用通常不继承 shell 环境，因此优先编辑配置文件。

## 验证与打包

```sh
npm run check
npm run check:ruby
npm run test:live
node scripts/security-test.mjs
npm run package:rbz
```

`check:ruby` 需要独立 Ruby；没有独立 Ruby 的机器可通过 `scripts/compatibility.rb` 在 SketchUp 嵌入式解释器中做语法和能力探测测试。`test:live` 需要运行中的 SketchUp；只生成并清除 QA 对象，不清空用户模型。

RBZ 输出在 `release/`，可用 Extension Manager 安装，Windows/macOS 共用，内附 MIT 许可。仅分发 Ruby 源码，无需按 Intel/ARM 编译原生扩展。CI 覆盖 Windows/macOS/Linux × Node 22/24 和 Ruby 语法矩阵；各提交的运行结果见 [GitHub Actions](https://github.com/Ringophilia/Ringo-Sketchup-MCP/actions)。

[兼容策略](docs/compatibility.md) · [验证记录](docs/validation.md)

项目包含完整 Ruby 扩展、Node MCP 服务和验证脚本，安装不依赖相邻的 legacy 仓库。

## 许可证

本项目使用 [MIT License](LICENSE)，允许个人和商业用途的使用、修改、分发和再许可。
分发源码或软件副本时须保留版权和许可声明；软件按原样提供，不附带担保。

欢迎通过 [Issues](https://github.com/Ringophilia/Ringo-Sketchup-MCP/issues) 反馈问题，或 Fork 后提交 Pull Request。开发与贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)，漏洞报告见 [SECURITY.md](SECURITY.md)。
