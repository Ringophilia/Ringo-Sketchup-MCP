# 兼容策略与边界

本项目参考 legacy 使用 SketchupExtension 注册、用户 Plugins 目录和本机 socket 的简单集成方式。在此基础上，当前首发版本加入能力协商、单一实现、标准 RBZ 自动打包和诊断。

参考项目：[sketchup-mcp](https://github.com/Ringophilia/sketchup-mcp)。本次对照确认值得保留的做法是标准扩展注册、本机回环通信、通用 Ruby API 入口和简单的安装指南，并补齐了 MIT 许可与贡献说明。当前实现使用带认证的非阻塞通信、请求分帧及超时后不重放修改的策略；legacy 中的阻塞读取、完整请求日志和自动重试修改不适合直接引入。

## 版本原则

软件版本为 `1.0.0`；协议版本单独使用 major 3。协议 major 3 内的客户端通过 capabilities 协商；只有无法互相理解的协议主版本才明确拒绝连接，提示更新客户端或扩展。

推荐目标 SketchUp 2021+、Node 22/24。Ruby 实现尽量使用旧 API，CI 为 Ruby 2.7/3.2/3.3 检查语法。最低可用版本以实际 API 探测为准，不承诺所有旧版均已实测。

| 能力缺失 | 行为 |
|---|---|
| persistent_id 查找 | 降级 entityID，仅当前模型会话有效；返回 reference_lifetime |
| redo | 仅该工具返回不支持，其余工具继续工作 |
| PBR roughness | 使用经典材质并返回 warning |
| 某种格式 exporter | export 返回不支持/失败，不把不存在的文件当成功 |
| 前台状态检测 | capability=false，提供队列和耗时代替推测窗口状态 |
| Ruby 脚本权限 | 默认关闭，仅高级执行工具不可用，其余功能继续工作 |

## macOS

用户插件路径为 `~/Library/Application Support/SketchUp YYYY/SketchUp/Plugins`。安装器遍历版本目录，可用 --year 或 --plugins 覆盖。所有 Ruby 相对路径从脚本位置解析；MCP stdio 使用绝对 Node 入口。RBZ 无 Windows DLL、无原生 Node addon，设计支持 Intel 和 Apple Silicon。

macOS 上单一 SketchUp 进程可包含多个模型；每次排队时记录 active_model，执行时若已切换则拒绝。返回的 model_id 是桥接会话 ID，重启后需要重新查询。

**尚未获得 macOS SketchUp 实机运行证据。** 路径测试、能力模拟和 CI 配置是适配措施，不等于实机通过。发布前应在至少一个 Intel 或 Apple Silicon Mac 上运行 doctor、test:live 和 security-test。

## 安装验证

RBZ 内只有顶层 loader 和同名实现文件夹。安装器备份既有扩展，保留 token 和配置，不修改安全策略、许可证或 SketchUp 二进制。扩展禁用时不会自行加载。

## 限制

- 任意 Ruby 本身没有可靠沙箱或安全的强制中止机制；使用可信客户端。
- 复杂模型单次操作会占用 UI 线程；应分成批次，每次调用结束后报告进度。
- macOS SketchUp 实机和不同宿主版本仍需要用户反馈与集成测试；不能用“可自适应”保证永不出错。
