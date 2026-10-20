# Tong 快速信任目录生产升级 — 全量修正版（2026-10-20）

**当前状态：已准备好应用与Manager的双组件候选，受控生产预检通过，尚未执行最终切换。**

## 上次故障与修复

上一轮仅升级应用至 `0a2da3c`，保留旧Manager `a1b56b3`，导致 `TongLoginRecovery.validateLoginRecoveryDescriptor` 拒绝新旧版本发布摘要不一致的固定恢复授权（用户当时看到 `New login recovery not approved`）。故障不是用户输入错误。旧应用和授权已由回滚过程恢复，原运行版本为 `a1b56b3666651c3648327f05e0ea4154284645c3`，回滚时报告旧实例恢复。

本轮改为**同一源码发布清单绑定App与Manager**，一起更新：
- 应用目录：`D:\Tong\app`
- 受管Manager目录：`D:\Tong\runtime\releases\manager`
- 固定登录运行脚本：`D:\Tong\runtime\login-management\TongLoginRuntime.ps1`
- 与同一候选哈希绑定的 `release-pin.json`、`manager-pin.json`、`profile.json`

还发现上一个新版本的受限MCP工具白名单没有 `tong_project_prepare`，会让自动授权入口在正式MCP中不可见。该问题已通过 `scripts/Apply-TongDevSpacePatch.mjs` 修复并补充 `tests/Test-TongQuickTrustAllowlist.mjs` 检测补丁幂等。两个部署目录都要一起更新三项精确哈希的DevSpace补丁文件，并留存旧文件以便回滚。

## 本次固定发布与验收证据

- 当前生产基线：`a1b56b3666651c3648327f05e0ea4154284645c3`（应用及Manager）。
- 新发布版本：`d9983bbc5fe1640f51d4a649ff0f018c9f458c6f`（应用及Manager均使用相同版本）。
- 新发布包：`D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-release-d9983bb`
- 离线恢复：`D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-d9983bb`
- 快照：`D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-full-cutover-20261020084000551-ffdcdbb2`
- 新发布包核验：265项源码、23项原生模块；离线npm安装/补丁检查、SQLite native模块成功。
- 候选真实 `server.js` 已含 `tong_project_prepare`，其文件SHA-256与发布清单一致。
- 旧生产应用191项源码、旧Manager191项源码、旧三项DevSpace补丁、旧应用/Manager Pin和profile及登录运行脚本均在快照中，已逐文件验证。
- `TongLoginRecovery.validateLoginRecoveryDescriptor` 已使用新发布包的**同版本**App+Manager资料通过非模型静态测试。
- 完整脚本的只读 `Preflight` 通过：当前健康生产运行、已签核对的候选、正确的计划任务和受限服务边界均通过。
- 旧的 `Invoke-TongQuickTrustProduction.ps1 -Mode Deploy` 已故意拒绝执行，避免误用仅应用升级路线；新入口禁止后台自动执行`Deploy`。

## 唯一升级入口

双击原来的文件：

`D:\Tong\development\tong-desktop-control\scripts\Upgrade-Tong-QuickTrust.cmd`

它现在调用 `Invoke-TongQuickTrustFullProduction.ps1 -Mode Deploy`，绝不再调用旧的仅App脚本。

需使用真正的Windows本机可见、未重定向的PowerShell 7 ConsoleHost。现有正式生产授权器会要求本人依次批准与发布哈希绑定的 `start`、`stop`、`enable-agentdock`、`manager` 操作（已有且未过期的相同授权可以复用）。**所有这些完成之前不会停止正在运行的Tong。**

全部确认后才会：
1. 核对之前的完整旧版源码快照（不重复备份旧源码），保存原本的计划任务配置。
2. 通过已有登录恢复授权停止现有监控与确切运行实例，验证Guardian/Job全部结束。
3. 备份停机状态下的授权、运行、认证加密文件与数据库等私有状态到快照目录（只存，不输出原文；目录继承受保护ACL）。
4. 安装精确固定SHA的新应用、新Manager源码与两者三项DevSpace补丁。
5. 通过正式受控 `pinRuntimeRelease(manager)` 和 `updateRuntimeProfile(app)` 绑定**同一个**发布包；更新LoginRuntime固定脚本；核验全部哈希。
6. 要求一次本机登录恢复授权确认（本次两者版本一致，预检描述校验通过）。
7. 重启计划任务和Tong；检测ready、Guardian和Supervisor存活、AgentDock、网关鉴权，以及双方新的commit。
8. 失败时停止并从双组件快照回滚，重新申请旧版恢复授权；无权限无法完成时保持可诊断状态而不绕过审批。

停机窗口中不要关闭PowerShell 7。**如果失败，把最后20行输出发给ChatGPT，不要重复运行同一个脚本。**

## 生产更新成功之后

1. 在本机打开 `D:\Tong\app\scripts\Connect-TongFolder.cmd`，选择 `D:\作业` 并首次确认一次。此项长期信任尚未预先授予。
2. 在ChatGPT里说“让Codex在TravelGuard继续开发”，通过 `tong_project_prepare` 自动补齐项目的持续开发授权，再启动原生Codex可见会话。
3. 后续其他项目路径可复用同一个已信任根目录；新根目录首次仍需本机一次确认，高风险任务独立确认。

**本次完整修正未启动DSH模型，不改变用户现有项目代码，不修改main。**
