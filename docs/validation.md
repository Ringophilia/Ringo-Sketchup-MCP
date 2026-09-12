# 验证记录

## 1.3.1 · 2026-09-12

- 双实例 acceptance：apple/9876 与 pear/9877 两个 SketchUp 进程均连接成功，profile、instance_id、model_id 各自独立；分别创建并保存了 apple-multi-instance.skp 和 pear-multi-instance.skp，两个 PNG 预览已生成。
- 修复真实 SketchUp 材质 RGB 必须使用整数的问题。

## 1.2.0 · 2026-09-12

验证宿主：Windows，SketchUp 26.2.243，嵌入式 Ruby 3.2.2；本地 Node 24.19.0、独立 Ruby 3.2.11。

| 验收范围 | 验证方式与证据 |
|---|---|
| 构建、协议、MCP 及安装 | `npm run check`：14 项 Node 测试，包括批量参数拒绝、模型绑定、配置生成、完整升级备份、失败回滚、离线诊断和图片返回 |
| Ruby 引用及服务行为 | `npm run test:ruby`：12 项测试、35 个断言，覆盖世界变换、共享路径、25 层嵌套、锁定祖先、模型/上下文保护、分页和跨客户端取消隔离 |
| Ruby 语法 | `npm run check:ruby`：全部发布 Ruby 文件在独立 Ruby 3.2.11 通过；嵌入式编译由兼容检查覆盖 |
| 通用实机操作 | `npm run test:live`：查询、四种几何创建、变换、材质、标签、选择、分组、批量运行错误回滚、脚本回滚、Undo/Redo、相机、场景、图片、多客户端 |
| 复杂模型实机回归 | `npm run test:references`：6 组场景；嵌套旋转缩放与原生 InstancePath 比较、共享组件歧义、组件复制、祖先锁定、make_unique、上下文切换、PNG 图片内容与尺寸 |
| 大模型 | `npm run test:performance`：5000 个实例；首页访问 101 项取得 100 项结果。最终验收测得首页 124 ms，定位最后一个实例 126 ms。记录仅代表这台机器和这个模型，不保证任意复杂模型延迟 |
| 认证与协议实机 | `node scripts/security-test.mjs`：6 项，错误 token、协议主版本、逐请求认证、过期任务、排队取消、未知方法 |
| 首次准备流程 | `scripts/setup.mjs --plugins <隔离目录>` 实际完成 npm ci、构建、安装、客户端配置生成；doctor 离线检查通过 |
| 默认权限 | 关闭 Ruby 后，普通盒体创建、PNG 预览、删除通过，任意脚本被拒绝 |
| 本机安装 | 完整备份后安装 1.2.0，doctor 的构建、配置、扩展文件与实时连接均为 OK |
| 安装包 | `npm run package:rbz` 生成包含 loader、实现及 MIT 许可的 RBZ 和 SHA-256 摘要 |

行为测试使用小型 SketchUp API 替身，不能证明原生几何内核行为；实机脚本补充验证了这一部分。开发验证在新建的测试模型和独立桥接端口上运行，工作区实现的 source_location 已核对。

JSON 日志与图片保存在被 Git 忽略的 `artifacts/`，脚本可以复现。CI 覆盖 Windows/macOS/Linux × Node 22/24、Ruby 2.7/3.2/3.3 的语法及 Ruby 行为测试；当前提交结果以 [GitHub Actions](https://github.com/Ringophilia/Ringo-Sketchup-MCP/actions) 为准。

## 仍然保留的边界

- 尚未获得 macOS SketchUp 图形宿主的实机证据；Mac 的路径和 CI 通过不能替代这项验收。
- 任意 Ruby、单次原生 API、模态窗口无法保证在客户端超时前返回；不自动重放修改。
- 几何快照是元数据比较，不覆盖逐顶点差异；模型变化期间的 offset 分页需要重新开始。
- 测试会改变 Undo 历史和模型的修改标记。实机回归使用一次性模型。

1.0.0 初始 Windows 实机记录涵盖基本建模、DAE 导出、覆盖保护和 stdout 限制。不能用旧记录证明后续代码已经通过；行为变更后应重新运行相应检查。
