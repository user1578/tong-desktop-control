# Tong Quick Trust 生产升级交接（2026-10-20）

状态：**新应用候选、离线恢复、旧应用源码快照及生产只读预检完成；生产尚未切换。**

## 固定版本

- 当前应用 / Manager：`a1b56b3666651c3648327f05e0ea4154284645c3`。
- 本轮目标应用：`0a2da3c61a71da65191640bd18e4711992430667`。
- **Manager 不升级**：经Git精确差异检查，本轮不需要更改 TongAgentDockRuntime、TongRuntimeServer、TongProductionProfile、TongLoginRecovery 等生产管理入口。
- 发布包：`D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-release-0a2da3c`。
- 恢复候选：同级 `quick-trust-candidate-0a2da3c`。
- 源码回滚快照：同级 `quick-trust-snapshot-0a2da3c`，已保存旧生产应用191个已验证源码文件、旧应用/Manager pin和profile（尚不包含停机时一致的运行状态副本）。
- 新候选包含260个源码文件和23个原生文件；离线恢复复用已有npm缓存，SQLite native和DevSpace Patch核验通过。没有在准备阶段触碰生产运行代码、认证状态或服务。

## 切换方式

在**真实本机PowerShell 7交互终端**双击：
`D:\Tong\development\tong-desktop-control\scripts\Upgrade-Tong-QuickTrust.cmd`

入口调用：
`scripts/Invoke-TongQuickTrustProduction.ps1 -Mode Deploy`。

此脚本先复核当前服务、GitHub发布包及完整候选，然后使用正式的本机交互式生产批准器签发新版本的`start`与`enable-agentdock`凭据；用户须亲自在ConsoleHost中按屏幕提示确认完整挑战。**聊天消息、MCP后台或自动输入不能代替这些本机批准。**

获准后，脚本按现有、固定的Login Task身份停用监控，使用旧版Login Recovery授权准确停止当前运行实例，并验证Guardian Job活动数为0。随后复制六组小型私有运行状态（不回显其内容）至受保护快照；在确认旧版源码及新发布包哈希后仅更新 `D:\Tong\app` 的260项源码，调用**生产已有的正式** `updateRuntimeProfile` 更新app pin/profile并复验Manager原pin，要求本人重新签发固定登录恢复授权。最后重新启动登录监控，校验ready、Guardian、AgentDock、网关、版本commit及计划任务运行状态。异常时停止并尝试按原版源码/Pin回滚，若恢复授权重新签发失败则保持停机并要求本机处理，不静默放宽批准。

### 为什么仍有本机挑战

这属于生产服务替换，不是日常项目开发。现行Tong生产政策把许可绑定到精确源码/发布包Hash、操作类型和本人ConsoleHost；不能省略。日常项目免重复确认功能待升级完成后才启用。

### 升级后首次文件夹信任

再双击候选应用中新功能的 `D:\Tong\app\scripts\Connect-TongFolder.cmd`，选择 `D:\作业`。首次本机确认一次后，TravelGuard和这个目录下的其他项目可自动登记/复用普通Codex开发授权；其他目录也可以再次选取并分别信任。**目录信任不是生产升级授权，也不会被自动预先授予。**

## 现场安全边界

- 所有生产切换必须从本地可见终端执行，预检和静态验收可通过Tong远程检查。
- 备份/发布及回滚代码固定基线与目标，拒绝任意执行路径/发布版本或额外未知文件碰撞。
- `TongQuickTrustProductionCutover.mjs preflight`、`snapshot`可以在旧生产运行时执行；`backup-state`、`install-files`、`rollback`强制要求已经停机、Guardian Job=0。
- 本地脚本即使批准成功也可能因外部认证、预检漂移、过期回执、任务身份不同而拒绝，绝不声称仅运行脚本就保证升级成功。
- DSH-S1实验功能未纳入生产调度，生产Manager保持原版。
