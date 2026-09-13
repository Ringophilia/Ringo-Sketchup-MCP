# Agent 接入指南

Ringo SketchUp MCP 提供标准 MCP stdio 服务。Agent 启动本机 Node 进程，Node 再通过带认证的回环 TCP 连接运行中的 SketchUp。所有客户端使用同一套工具，不需要为不同模型改服务器代码。

## 1. 安装并生成本机配置

先运行 npm run setup 安装扩展、构建 Node 服务并重启 SketchUp，然后在项目目录执行：

```sh
npm run config:agents
npm run doctor
```

配置生成器使用当前 Node 可执行文件和项目入口的**绝对路径**，适用于含空格、中文的 Windows/macOS 路径。生成文件保存在 `.agent-config/`，已被 Git 忽略。生成器不读取或复制 token，也不会覆盖其他 Agent 的配置。移动项目或升级 Node 后重新生成。

| 文件 | 用途 |
|---|---|
| `.agent-config/codex.toml` | ChatGPT 桌面版、Codex CLI、Codex IDE 扩展 |
| `.agent-config/mcp.json` | 使用 `mcpServers` 的客户端，例如 Claude Desktop、Claude Code、Cursor |
| `.agent-config/vscode.json` | VS Code / GitHub Copilot 的 MCP 配置 |

如使用自定义 `SKETCHUP_MCP_CONFIG`，在运行生成器前设置它。生成器仅将该配置文件路径写入片段。SketchUp 和 Node 必须使用同一配置文件；Finder 启动的 SketchUp 通常不继承终端环境，Mac 上建议使用默认配置目录。

## 2. ChatGPT 桌面版（原 Codex 桌面版）

官方 MCP 文档说明，ChatGPT 桌面版、Codex CLI 和 IDE 扩展共享同一 Codex host 的 MCP 配置。

最直观的接法：打开 **Settings → MCP servers → Add server**，名称填 `sketchup`，传输选择 **STDIO**，从生成的配置复制 `command` 和 `args`，保存后点击 **Restart**。

也可以把 `.agent-config/codex.toml` 的内容合并到 `~/.codex/config.toml`。如果已经存在 `[mcp_servers.sketchup]`，更新它，不要重复添加同名表。项目级配置可以放在 `.codex/config.toml`，需要客户端信任项目。

CLI 等价命令（替换成生成器给出的本机路径）：

```sh
codex mcp add sketchup -- "/absolute/path/to/node" "/absolute/path/to/Ringo-Sketchup-MCP/dist/mcp-server.js"
codex mcp list
```

在桌面版或 CLI 输入 `/mcp` 检查连接，然后让 Agent 调用 `bridge_status` 和 `model_get_info`。工具目录能列出，仅表示 MCP 进程正常；`bridge_status` 成功才表示已经连上 SketchUp。

## 3. Claude Desktop / Claude Code / Cursor

将 `.agent-config/mcp.json` 中的 `sketchup` 项合并到客户端的 `mcpServers`，保留已有服务。

- Claude Desktop：通过应用的开发者配置入口编辑 `claude_desktop_config.json`。macOS 常见路径为 `~/Library/Application Support/Claude/claude_desktop_config.json`，Windows 为 `%APPDATA%/Claude/claude_desktop_config.json`。
- Claude Code：合并到项目 `.mcp.json`；也可使用下面的 CLI 命令。
- Cursor：合并到项目 `.cursor/mcp.json` 或用户 `~/.cursor/mcp.json`。

```sh
claude mcp add --transport stdio --scope user sketchup -- "/absolute/path/to/node" "/absolute/path/to/Ringo-Sketchup-MCP/dist/mcp-server.js"
claude mcp get sketchup
```

`.mcp.json.example` 是结构模板。优先使用生成器输出，避免手填路径错误。客户端可能要求信任项目或启用服务。

## 4. VS Code / GitHub Copilot

仓库自带 `.vscode/mcp.json`，构建完成后可在 VS Code 中启动 `sketchup` 服务，要求 VS Code 能找到 `node`。也可用 **MCP: Open User Configuration**，合并 `.agent-config/vscode.json`；该文件使用绝对 Node 路径，适合 GUI 应用找不到 PATH 的情况。

**MCP: List Servers** 可查看服务状态。VS Code 的顶层键是 `servers`，不要直接把 `mcpServers` 原样粘贴进去。

## 5. ChatGPT 网页版 / 云端 Agent

网页端不会读取本机 `~/.codex/config.toml`，也不能直接启动本机 Node。官方当前提供两种开发接入方式：公开 HTTPS MCP endpoint，或 **Secure MCP Tunnel** 连接私有 stdio/HTTP MCP 服务，具体可用性取决于账号与工作区策略。

本项目目前提供 **stdio**，未实现公开 HTTP 服务或 OAuth。若账号支持 Secure MCP Tunnel，可在运行 SketchUp 的机器上，按 OpenAI 官方流程将隧道的 stdio 目标设为生成器给出的 `command` / `args`，再在 ChatGPT Plugins 的连接设置中选择该 tunnel。此仓库没有完成网页端隧道实测，不能把桌面版测试当作云端通过。

TCP `127.0.0.1:9876` 是项目内部桥接协议，**不是 HTTP MCP endpoint**；不要把该地址填入 ChatGPT 的 MCP URL。GitHub Pages 只能托管静态文件，不能运行 Node/Ruby 或控制本机 SketchUp。提交到 GitHub 的仓库用于分发代码，不会自动把 SketchUp 变成云服务。

## Agent 工作流与故障排查

可以直接把这段话交给 Agent：

> 使用 sketchup MCP：先调用 bridge_status 和 model_get_info，确认当前模型及能力；用 entity_list / entity_inspect 获取实体 ID 和实例路径。默认单位为毫米。修改前确认目标，引用实体时携带 model_id。创建嵌套几何时用 parent.path，后续始终携带返回的完整 path。共享组件需要独立编辑时先 make_unique 再重新查询。使用 batch_run 合并关联修改，批量参数错误会在发送前被拦截。大型模型注意 entity_list / model_stats 的 total_exact 和扫描上限。完成后调用 view_capture 直接查看图片；需要保存时使用 view_export。超时后检查最近操作状态，不要自动重放修改。只有 ruby capability 开启时才使用 sketchup_run_ruby。

常见问题：

- `ENOENT` / 找不到 Node：重新运行生成器，使用绝对 `command`，重启客户端。
- 找不到 `dist/mcp-server.js`：运行 `npm ci`、`npm run build`。
- 连接拒绝：启动桌面 SketchUp，启用扩展，重启或使用扩展菜单启动桥接；运行 `npm run doctor`。
- 认证失败：检查 Node 与 SketchUp 的配置路径是否相同，重新启动两端。
- Ruby 未启用：普通几何工具仍可用；需要完整 API 时运行 `node scripts/install.mjs --enable-ruby` 并重启 SketchUp。
- 远程容器、WSL、SSH：Node 的 `127.0.0.1` 必须能到达 SketchUp 所在宿主。本项目默认按同一台 Windows/macOS 主机部署，不要把本地配置直接当成远程配置。

## 官方依据

核对日期：2026-09-11。界面名称和账号开放范围可能随客户端更新。

- [OpenAI：MCP、桌面版共享配置、CLI 和网页端区别](https://developers.openai.com/codex/mcp/)
- [OpenAI：连接与测试插件、HTTPS / Secure MCP Tunnel](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt/)
- [MCP：stdio 与 Streamable HTTP 传输规范](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [Claude Code：MCP 安装与配置](https://code.claude.com/docs/en/mcp)
- [VS Code：MCP 配置](https://code.visualstudio.com/docs/copilot/customization/mcp-servers)

以上是协议和客户端配置依据；本项目的实际测试范围见 [验证记录](validation.md)。

## 多个 SketchUp 实例

多实例使用独立 profile，不共享端口：

```sh
npm run setup -- --profile project-a --name "Project A" --port 9876
npm run setup -- --profile project-b --name "Project B" --port 9877
npm run config:agents -- --profile project-a
npm run config:agents -- --profile project-b
```

请把两个 profile 生成的服务都合并到客户端配置。LLM 必须把服务名视为目标边界：调用 `sketchup-project-a` 的工具只会连接 project-a profile，调用 `sketchup-project-b` 的工具只会连接 project-b profile。每个目标的第一步都是 `bridge_status`，检查 `data.instance.profile_id`、`profile_name`、`port` 和进程 ID。示例名称只是路由标签，用户可按实际项目改名。

扩展菜单中的 **Select Profile** 只改变当前 SketchUp 进程使用的 profile，并重新启动本地桥接。不要在两个 SketchUp 中选择同一个 profile；`npm run doctor -- --profile <id>` 可以检查配置和端口注册。
