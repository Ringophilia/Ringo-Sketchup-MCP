# 提升计划

> 基于 v1.3.3（`7cbc55e`）的代码审查，2026-10-25。
> 审查范围：`src/`、`extension/`、`scripts/`、`test/`、CI 与全部文档。本地 `npm run check`（19 项 Node 测试）全部通过；`npm run test:ruby` 因本机未安装独立 Ruby 未运行。

## 总体评价

项目的底子很扎实，在同类 SketchUp MCP 中属于工程化程度较高的一档：

- **安全边界清楚**：仅监听 `127.0.0.1`、逐请求 token 校验、Ruby 执行默认关闭、日志不记录 token 与参数。
- **"不重放修改"的语义贯穿始终**：超时、断线、排队取消都明确返回 `outcome: unknown`，并在文档中反复提醒。
- **引用模型严谨**：`persistent_id` + 实例路径 + `model_id` / `active_path` 会话守卫，能正确处理共享组件歧义与锁定祖先。
- **安装体验认真**：完整备份、失败回滚、doctor 诊断、多 profile 隔离、生成免 token 的客户端配置。
- **测试覆盖分层**：Node 单元/集成测试、Ruby 替身行为测试，以及实机回归、性能与安全脚本。

主要短板集中在四个方面：**依赖安全滞后**、**少数 API 不一致**、**代码可维护性**（高密度单行写法、版本号多处硬编码），以及**分发门槛**（必须克隆仓库并本地构建）。

---

## 一、发现的问题

按优先级排列。P0 应尽快处理；P1 建议在下个小版本处理；P2/P3 可排进路线图。

### P0 · 依赖存在已公开漏洞

`npm audit` 报告生产依赖中有多项 high / moderate 级别公告：

| 包 | 当前 | 级别 | 说明 |
|---|---|---|---|
| `@modelcontextprotocol/sdk` | 1.30.0 | high | ≤1.31.0 的多项公告（HTTP 传输、OAuth、任务会话绑定等） |
| `body-parser` | 2.x | high | 压缩请求体 DoS（SDK 间接依赖） |
| `zod` | 3.25.76 | high | 公告要求 ≥4.6.6，属于破坏性升级 |
| `fast-uri` / `hono` / `ip-address` | — | moderate | SDK 间接依赖 |

**实际影响有限**：本项目只使用 stdio 传输，不启动 HTTP 服务，多数公告涉及的代码路径不会执行。但安全扫描会持续报红，也会影响用户信任。

**建议**

1. 立即 `npm audit fix`，将 SDK 升到 1.32.x，刷新锁文件中的间接依赖。
2. zod 升级到 v4 单独作为一个任务处理（见 P1-4），因为 `z.record(z.unknown())` 等写法和 SDK 的 zod 适配需要一起验证。
3. 新增 `.github/dependabot.yml`，对 npm 和 GitHub Actions 开启每周版本更新（目前只有安全更新 PR）。
4. CI 增加 `npm audit --omit=dev --audit-level=high`，作为非阻塞或阻塞检查。

**验收**：`npm audit --omit=dev` 无 high；CI 中出现审计步骤。

### P1-1 · `entity_create_cylinder` 的单位语义不一致

- 位置：[src/mcp-server.ts:29](../src/mcp-server.ts#L29)、[extension/ringo_sketchup_mcp/operations.rb:357](../extension/ringo_sketchup_mcp/operations.rb#L357)
- 问题：工具 schema 要求 `radius_mm` / `height_mm`，但同时暴露 `unit` 参数。`unit` 只作用于 `origin`，不作用于半径和高度。Ruby 端其实支持带单位的 `radius` / `height`，但 MCP 层的 `.strict()` schema 会直接拒绝这两个字段，等于这条路径永远走不到。
- 影响：LLM 传 `{unit:'m', radius_mm:0.5}` 会得到 0.5 mm 的圆柱，而不是 0.5 m。其他几何工具都遵循"所有长度使用 `unit`"，只有它例外。
- 建议：schema 增加 `radius` / `height`（随 `unit` 换算），`radius_mm` / `height_mm` 保留为兼容别名并在描述中标注 deprecated；二者同时出现时报错。
- 验收：新增测试覆盖 `unit:'cm'` + `radius` 的换算，以及新旧字段互斥。

### P1-2 · 测试脚本的 glob 在 POSIX shell 下有隐患

- 位置：[package.json:16](../package.json#L16) `node --test --import tsx test/**/*.test.ts`
- 问题：glob 没有加引号。在 macOS/Linux 的 `sh` 中，`**` 没有 globstar 语义，会被当作 `*`，只匹配**一层子目录**。现在 `test/` 的子目录里没有 `.test.ts`，shell 匹配失败后把原字符串交给 Node，再由 Node 自己展开，所以恰好能跑。一旦有人新增 `test/foo/bar.test.ts`，shell 就只会传入这一个文件，**顶层的全部测试会被静默跳过**，而 CI 依然显示通过。
- 建议：改为 `node --test --import tsx "test/**/*.test.ts"`，交给 Node 的内置 glob 处理（Windows 的 cmd 不受影响）。
- 验收：在 `test/` 下临时放一个子目录测试，确认测试总数没有减少。

### P1-3 · 版本号在 5 处硬编码

- 位置：`package.json`、`src/protocol.ts`、`extension/ringo_sketchup_mcp.rb`、`extension/ringo_sketchup_mcp/config.rb`、`extension/extension.json`
- 问题：没有任何测试校验这些值是否一致。doctor 依赖版本比较来提示"扩展与服务不匹配"，一旦漏改一处，就会误报或者漏报。另外 [docs/compatibility.md:9](compatibility.md) 仍写着"软件版本为 `1.3.0`"，已经过时。
- 建议：
  - 以 `package.json` 为唯一来源，新增 `scripts/bump-version.mjs` 同步改写其余文件；
  - 新增 `test/version.test.ts` 断言 5 处一致；
  - 文档中不再写死当前版本号，改为指向 CHANGELOG。

### P1-4 · zod v4 与 MCP SDK 升级

zod 3 → 4 是破坏性升级，SDK 新版本已支持 zod v4。建议在升级 SDK 后单独开一个分支迁移，重点检查：`z.record(z.unknown())` 的签名变化、`.strict()` 行为、错误信息格式（`validateBatchArgs` 会把 `issues` 原样返回给客户端，格式变化会影响 LLM 读到的报错）。

### P1-5 · Ruby 端每个 tick 只执行一个任务

- 位置：[extension/ringo_sketchup_mcp/server.rb:19](../extension/ringo_sketchup_mcp/server.rb#L19)、[server.rb:136](../extension/ringo_sketchup_mcp/server.rb#L136)
- 问题：定时器 50 ms 触发一次，每次只 `@jobs.shift` 一个任务。即使每个操作只需 1 ms，吞吐上限也只有约 20 次/秒，多客户端或连续的小查询会明显排队。
- 建议：在单个 tick 内按时间预算（例如 30 ms）循环执行，直到队列为空或预算耗尽。UI 线程仍会周期性让出，不影响 SketchUp 响应。`queue_ms` 指标可以直接用来验证效果。
- 验收：`test:performance` 增加"100 次连续 `entity_inspect`"的总耗时记录，对比改动前后。

### P1-6 · 部分查询结果没有上限

- `selection.get`（[operations.rb:167](../extension/ringo_sketchup_mcp/operations.rb#L167)）会对每个选中实体执行完整的 `inspect_entity`。用户全选一个大模型时，结果会超过 4 MiB 帧限制，只能拿到 `-32005 Result too large`，**并且无法分页**。
- `materials.list`、`tags.list`、`model.diff` 同样没有分页。
- 建议：`selection_get` 增加 `limit` / `offset` 并返回 `total`；`model_diff` 增加每类结果的上限和 `truncated` 标记。

### P2-1 · 客户端在连接竞态下的错误不够干净

- 位置：[src/sketchup-client.ts:72](../src/sketchup-client.ts#L72)
- 问题：`send()` 用的是 `this.socket!`。如果连接在 `connect()` 返回后、`send()` 执行前断开，`this.socket` 已经是 `undefined`，会在 Promise 执行器中抛出 `TypeError`，但 pending 项和计时器仍然保留，直到超时才清理。最终用户看到的是 `Cannot read properties of undefined`，而不是规范的 `-32002` 连接错误。
- 建议：写入前检查 socket，无效时 `finish(id)` 并以 `RpcError(-32002)` 拒绝。补一个单元测试模拟这个时序。

### P2-2 · 冗余与小的不一致

- 实体引用检查在 [mcp-server.ts:70](../src/mcp-server.ts#L70) 和 `validateArguments`（第 135 行）中重复了一次。
- `SKETCHUP_TIMEOUT_MS` 只能通过环境变量设置，配置文件中的 `timeout_ms` 不生效（[src/config.ts:14](../src/config.ts#L14)）。而通过 Finder 启动的 Mac 应用读不到 shell 环境，文档也推荐用配置文件，两者有矛盾。
- `entity_set_material.color` 使用无范围的 `vec`，`materials_set.color` 则限制在 0–255，应统一。
- Undo 菜单里显示的操作名是内部方法名（例如 `entity.create_box`），可以映射成 `MCP: Create Box` 这类可读名称。
- `sketchup_run_ruby` 在 `TOPLEVEL_BINDING` 上执行，脚本里定义的局部变量和方法会在多次调用之间残留。建议改为每次新建 binding，或者在文档里明确说明这一点。

### P2-3 · Profile 选择不持久

- 位置：[extension/ringo_sketchup_mcp/config.rb:43](../extension/ringo_sketchup_mcp/config.rb#L43)
- 问题：`@selected_profile_id` 只保存在内存中。每次重启 SketchUp 都会回到 default，第二个窗口必然先撞上端口冲突，再要求用户手动选择。
- 建议：可选的"端口被占用时自动选用第一个空闲 profile"，或者记住上次选择（写入 `Sketchup.write_default`）。同时保留状态栏提示，避免静默连错实例。

### P2-4 · 代码可读性与规范

- `src/mcp-server.ts` 只有 187 行，但有 20 KB，37 个工具定义都挤在单行对象里；`operations.rb` 的 `dispatch` 是一个约 200 行的 `case`。代码审查和 diff 都很困难。
- 没有格式化或 lint 工具（`npm run lint` 实际上只是 `tsc --noEmit`）。
- 建议：
  - 按领域拆分工具定义：`tools/entity.ts`、`tools/scene.ts`、`tools/io.ts`……；
  - Ruby 的 `dispatch` 改为 `HANDLERS = { 'entity.transform' => :op_entity_transform, ... }` 方法表；
  - 引入 Prettier（或 Biome）+ ESLint、RuboCop（宽松配置），先做一次纯格式化提交，再开启 CI 检查；
  - 拆分时保持对外的工具名、参数和错误码不变，靠现有测试兜底。

### P2-5 · 没有利用 MCP 的新能力

- 工具没有 `title`，客户端 UI 只能显示 `entity_create_box` 这样的标识符。
- 没有 `outputSchema`。structuredContent 的结构是稳定的（`success / data / warnings / ...`），声明之后客户端可以做校验和类型推断。
- 没有 Prompts 和 Resources。可以提供：
  - Prompt `sketchup-modeling-workflow`：固化 `bridge_status → model_get_info → 修改 → view_capture` 这套推荐流程；
  - Resource `sketchup://model/info`、`sketchup://materials`：只读信息不必占用工具调用。
- 进度通知目前只有 0 和 1 两个点。`batch_run` 可以按子命令上报进度（需要协议增加进度帧）。

### P3 · 分发与发布

- **分发门槛高**：用户必须安装 Node、克隆仓库、本地构建。`package.json` 中 `private: true`，没有 `bin` 入口。
- **RBZ 未签名**：SketchUp 默认的扩展加载策略会对未签名扩展弹出提示，新用户容易误以为扩展损坏。
- **没有自动发布**：RBZ 只作为 CI artifact 上传，没有随 tag 自动生成 GitHub Release。
- **只有中文文档**：MCP 生态的用户以英文为主，英文 README 能显著扩大受众。
- **缺少演示素材**：README 中没有截图或动图，第一印象不够直观。

### 验证缺口

- **macOS 尚无实机验收**，项目自己的文档已经多次标注。这是对外宣称"支持 macOS"之前最重要的一项。
- CI 没有收集覆盖率，无法量化 `operations.rb` 这类核心文件的测试覆盖。
- Ruby 替身（`fake_sketchup.rb`）无法覆盖几何内核行为。实机脚本依赖手动运行，验证记录停留在 1.2.0 / 1.3.1。

---

## 二、路线图

### v1.3.4 · 安全与正确性补丁（约 1 天）

> ✅ 已在 1.3.4 完成。zod v4 迁移（P1-4）只需要改动 `z.record` 的签名，因此也提前在这个版本完成，`npm audit` 已清零。

| # | 任务 | 关联 |
|---|---|---|
| 1 | `npm audit fix`，SDK 升到 1.32.x，更新 CHANGELOG | P0 |
| 2 | 新增 `dependabot.yml`，CI 增加 `npm audit` | P0 |
| 3 | 给测试 glob 加引号 | P1-2 |
| 4 | 版本一致性测试 + `bump-version` 脚本，修正 compatibility.md | P1-3 |
| 5 | 修复 `send()` 的 socket 竞态 | P2-1 |
| 6 | `SKETCHUP_TIMEOUT_MS` 支持配置文件 `timeout_ms` | P2-2 |

### v1.4.0 · API 一致性与性能（约 1 周）

| # | 任务 | 关联 |
|---|---|---|
| 1 | 圆柱改为 `radius` / `height` + `unit`，旧字段兼容 | P1-1 |
| 2 | 按时间预算批量执行队列 | P1-5 |
| 3 | `selection_get` 分页，`model_diff` 设置上限 | P1-6 |
| 4 | 工具 `title`、`outputSchema`，可读的 Undo 名称 | P2-2、P2-5 |
| 5 | 新增 workflow Prompt 与只读 Resources | P2-5 |
| 6 | Profile 持久化 / 自动选择空闲 profile | P2-3 |
| 7 | **macOS 实机验收**，更新 validation.md | 验证缺口 |

### v1.5.0 · 可维护性（约 1–2 周，可与 1.4 并行）

| # | 任务 | 关联 |
|---|---|---|
| 1 | 引入格式化与 lint，先做一次纯格式化提交 | P2-4 |
| 2 | 拆分工具定义模块；Ruby `dispatch` 改为方法表 | P2-4 |
| 3 | zod v4 迁移 | P1-4 |
| 4 | CI 收集覆盖率（`node --test --experimental-test-coverage`，Ruby 用 SimpleCov） | 验证缺口 |

### v2.0 · 分发体验

| # | 任务 | 说明 |
|---|---|---|
| 1 | 发布 npm 包，支持 `npx @ringo/sketchup-mcp setup` | 免克隆、免构建；配置中的 `command` 可直接指向 `npx` |
| 2 | tag 触发的 Release 工作流 | 自动附带 RBZ、SHA-256 和变更说明 |
| 3 | RBZ 签名 / 上架 Extension Warehouse | 消除未签名扩展的加载提示 |
| 4 | 英文 README 与文档 | `README.en.md` 加双向链接 |
| 5 | 演示 GIF、示例提示词库 | 降低上手门槛 |
| 6 | 协议级进度帧（批次与长操作） | 需要协议 minor 能力协商 |

---

## 三、不建议做的事

为了守住项目已经建立的边界，以下方向不建议引入：

- **自动重试修改**：会破坏"超时不等于未执行"的核心语义。
- **监听非回环地址或提供 HTTP 端点**：远程访问应由用户在外层自行搭建隧道，并承担相应的安全责任。
- **为特定模型或家具增加专用工具**：与 CONTRIBUTING 中"保持通用"的原则冲突，应通过通用几何工具或 Ruby 脚本实现。
- **强制中止正在运行的 Ruby**：在 SketchUp UI 线程上没有安全的实现方式。
