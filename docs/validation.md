# 验证记录

初始实机验证宿主：Windows，SketchUp 26.2.243，嵌入式 Ruby 3.2.2。

1.1.0 增加了嵌套实例路径、父级引用、批量参数校验和视图图片返回。当前自动化验证覆盖批量错误在 Node 侧被拦截、工具名到 RPC 方法名的规范化以及批次级 `model_id` 继承；本机未启动 SketchUp 时无法替代实机回归。

- Node 22、Node 24 自动化测试覆盖协议分帧、UTF-8 跨包、乱序响应、握手与认证、超时取消、断线后不重放修改、MCP 结构化结果、参数错误和跨平台路径。
- 实机通用回归覆盖查询、创建、变换、标签、材质、实例路径、批量回滚、脚本错误回滚、Undo/Redo、场景、相机、视图导出与多客户端。
- 实机协议检查覆盖无效 token、不兼容协议主版本、逐请求认证、过期队列、取消和未知方法。
- 嵌入式 Ruby 能力模拟验证了旧 API 缺少 persistent_id、PBR 或 redo 时的降级行为。
- 补充检查覆盖清空后 Undo 恢复、16 KB stdout 限制、文件覆盖保护和 DAE 导出。
- 初始验证不包含 macOS 实机和远程 GitHub Actions；推送后的 CI 结果以 [GitHub Actions](https://github.com/Ringophilia/Ringo-Sketchup-MCP/actions) 对应提交为准。CI 不运行 SketchUp 图形宿主。

验证脚本产生的日志、模型和图片保存在本地 `artifacts/` 目录中，该目录已加入 Git 忽略规则，不随项目发布。

后续每次有行为修改，应重跑相应检查，不能以旧结果证明新版本通过。
