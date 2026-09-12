# Ringo SketchUp MCP

让支持 MCP 的 AI 在桌面 SketchUp 中查询、建模、编辑和查看结果。Node.js 提供标准 stdio MCP，Ruby 扩展在 SketchUp UI 线程操作模型。

当前版本 **1.2.0**。Windows SketchUp 26.2.243 已完成实机回归。macOS 有安装路径、CI 和同一份 Ruby 实现，**尚未完成 macOS SketchUp 实机验收**。仅支持桌面 SketchUp，网页和 iPad 版不适用。

## 快速开始

1. 安装桌面 SketchUp 和 [Node.js 22 或 24 LTS](https://nodejs.org/)，先启动一次 SketchUp。
2. 下载并解压本仓库，或使用 Git 克隆。
3. Windows 双击 `setup.cmd`。macOS 在终端运行 `sh setup.command`。也可以在项目目录执行：

```sh
npm run setup
```

准备脚本会安装依赖、构建服务、备份并安装扩展、生成本机客户端配置。Ruby 脚本执行默认关闭，普通建模和图片预览不需要开启它。

4. 关闭并重新打开 SketchUp。在 AI 客户端导入 `.agent-config/` 中的对应配置，步骤见 [各 Agent 接入指南](docs/agents.md)。配置使用绝对路径，不包含 token。
5. 在项目目录运行 `npm run doctor`。它会逐项检查构建、配置、扩展、实时连接和版本，并在失败时给出下一步操作。

让 AI 做第一次连接验证：

> 使用 sketchup MCP，先调用 model_get_info 告诉我当前模型，然后用 view_capture 看看当前视图。

完整建模示例、嵌套组件与批量操作见 [使用指南](docs/usage.md)。

## 安装、升级与修复

```sh
npm run setup -- --year 2026
npm run setup -- --plugins "/custom/Plugins"
npm run setup -- --dry-run
```

多版本安装默认选择最新的 SketchUp 用户目录，可用 `--year` 指定。`--dry-run` 只显示计划，不修改文件。升级前记录完整扩展备份，包括 loader 和实现；安装失败会恢复它们及原配置。备份位置在配置目录的 `backups/`，安装完成后会打印。

已有开发环境也可以分步执行：

```sh
npm ci
npm run build
npm run install:extension
npm run config:agents
```

需要完整 SketchUp Ruby API 时，运行 `npm run setup -- --enable-ruby`，然后重启 SketchUp。脚本以本机用户权限执行，只允许可信客户端调用。

移动项目或升级 Node 后重新运行 `npm run config:agents` 并更新客户端配置。遇到连接问题先运行：

```sh
npm run doctor
npm run doctor -- --json
npm run doctor -- --offline
```

`--offline` 只检查安装文件，不能证明已经连上 SketchUp。手动通过 Extension Manager 安装 RBZ 的用户没有安装记录，可通过 `--plugins PATH` 指定检查位置。

## 通用功能

| 类别 | 工具 |
|---|---|
| 状态与模型 | bridge_status、model_get_info、model_stats |
| 查询与选择 | entity_list、entity_inspect、selection_get、selection_set |
| 几何创建 | entity_create_box、entity_create_cylinder、entity_create_mesh、entity_extrude |
| 编辑 | entity_transform、entity_update、entity_delete、entity_duplicate、entity_group、entity_make_unique |
| 材质与标签 | entity_set_material、materials_list、materials_set、tags_list、tags_set |
| 相机与场景 | camera_get、camera_set、scenes_list、scenes_set |
| 事务与比较 | batch_run、model_undo、model_redo、model_snapshot、model_diff |
| 图片与文件 | view_capture、view_export、model_save、model_export、scene_clear |
| 高级 API | sketchup_run_ruby |

`view_capture` 直接返回 MCP 图片，不需要指定保存位置。`view_export` 保存 PNG/JPG，小于等于 4 MiB 时也附带图片。`structuredContent` 提供机器可读结果，成功包含数据、警告、任务 ID、执行和排队耗时；失败有明确错误码。

## 模型操作约定

- 首次修改前调用 `model_get_info`。MCP 会记住模型会话并为后续修改补上 `model_id`；切换模型后需要重新查询。也可以显式携带该 ID。创建、选择、分组等依赖编辑上下文的操作同时检查 `active_path`。
- 输入和输出默认毫米。创建与增量变换使用父容器坐标；返回的 `transform` 是世界变换，按列排列，平移使用指定单位。`matrix` 输入用于替换局部变换，不应直接复用世界矩阵。
- 嵌套实体使用完整 `path`；`parent:{path:[...]}` 指定创建位置。共享组件的单一实体 ID 可能对应多个路径，此时要求显式路径。修改共享定义仍会影响其他实例；独立修改前先对祖先 `entity_make_unique`，再重新查询。
- `batch_run` 复用单工具参数校验和默认值。所有步骤在一个 Undo 事务内执行；运行中任一步失败则整体回滚。
- `entity_list` 默认获取一页后立即返回。`total_exact:false` 表示总数是下界；沿 `next_offset` 翻页。需要总数时传 `include_total:true`。达到数量或约 500 ms 遍历预算时返回 `truncated:true`，应按父级路径缩小查询范围。一次 SketchUp 原生 API 调用仍可能耗时较长。
- 保存和导出默认禁止覆盖，覆盖必须显式设置 `overwrite:true`。

## 运行边界

桥接仅监听 `127.0.0.1`，握手和每次请求检查随机 token；最多 16 个客户端、128 个排队任务、4 MiB 单帧。已过期或取消的排队任务不执行，客户端之间的取消请求相互隔离。模型或编辑上下文在排队期间变化会拒绝执行。

断线后不自动重放修改。**超时不等于操作没有执行**；检查 `bridge_status` 中的最近任务及实际模型。正在执行的任意 Ruby 无法安全强制中止，不能提交无限循环。模态框和宿主原生操作仍可能延迟响应。

快照保存容器及根实体元数据，最多 10,000 项、保留最近 10 个；不是逐顶点几何 diff。超过遍历预算会明确失败。日志不记录 token、完整参数或 Ruby 代码。

| 平台 | 配置文件 |
|---|---|
| Windows | `%APPDATA%/RingoSketchUpMCP/config.json` |
| macOS | `~/Library/Application Support/RingoSketchUpMCP/config.json` |
| 自定义 | `SKETCHUP_MCP_CONFIG` 环境变量 |

可覆盖 `SKETCHUP_PORT`、`SKETCHUP_TOKEN`、`SKETCHUP_TIMEOUT_MS`、`SKETCHUP_ENABLE_RUBY_EVAL`。通过 Finder 启动的 Mac 应用通常不继承 shell 环境，建议使用默认配置文件。

本项目提供本地 stdio MCP。内部 TCP 端口不是 HTTP endpoint；网页或云端 Agent 的接入边界见 [接入指南](docs/agents.md)。

## 验证与打包

```sh
npm run check
npm run check:ruby
npm run test:ruby
npm run test:live
npm run test:references
npm run test:performance
node scripts/security-test.mjs
npm run package:rbz
```

独立 Ruby 检查可用 `RUBY` 指定解释器路径；行为测试需要 minitest。实机脚本需要运行中的 SketchUp、根编辑上下文和开启 Ruby 的测试环境；使用一次性测试模型，它们会创建并清理 QA 对象，但会改变 Undo 历史和模型的修改标记。

RBZ 和 SHA-256 摘要生成在 `release/`；Windows/macOS 共用同一包。Node 服务仍需保留。CI 覆盖 Windows/macOS/Linux × Node 22/24，以及 Ruby 2.7/3.2/3.3 的语法和行为测试，不运行 SketchUp 图形宿主。

[验证记录](docs/validation.md) · [兼容策略](docs/compatibility.md) · [GitHub Actions](https://github.com/Ringophilia/Ringo-Sketchup-MCP/actions)

## 许可证与贡献

[MIT License](LICENSE)，允许个人和商业用途，分发时保留许可和版权声明。[贡献指南](CONTRIBUTING.md) · [问题反馈](https://github.com/Ringophilia/Ringo-Sketchup-MCP/issues) · [漏洞报告](SECURITY.md)。
