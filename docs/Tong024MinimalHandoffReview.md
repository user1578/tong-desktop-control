# Tong 024 最小启动锁交接复核（2026-10-25）

**生产恢复 NOT READY；禁止执行生产恢复。** 本轮仅修改开发目录及隔离环境，生产入口继续默认关闭。接手提交 `898d39673099d45779734c1c5f272bd82884c49e`。本报告是新候选的独立证据，不覆盖此前精确 34e2680 缺少交接能力的结论。

## 精确候选

- 最小功能父提交：`34e26801876d8b1a2fc874dddce72b0939924e87`。
- 新候选：`90e3bc872989e63a6efe5bcef214e0489d54e052`。
- 仅五个产品文件，334 行增加、15 行删除：新增 `Tong024Handoff.mjs/.ps1`，修改 Runtime、Launcher、StartupProtocol。没有引入 f182e55 维护系统、5362210 或可视化功能。
- 完整 release：`D:\Tong\state\b23-login-8e32da332608430bb4971bc668ef4ace\handoff-release-90e3bc8`，301 个源码项、23 个原生项，Node v24.15.0 / ABI 137。
- sourceDigest：`b3b2e7c7d2d601a94b9e1b5f5b78192e3c0fded6927d9efbb7cdd372b1c192a4`。
- releaseDigest：`0fdfe34e0685db76486e094d74369455f58857d5ff74db29c524037775b61af1`。

开发分支保留原维护代码及历史；上述候选是直接以 34e2680 为父的独立最小 Git 树。交付分支通过正常合并保留该候选的可达性；最终开发分支 SHA 见交付回复及 Git，避免报告自引用。

## 连续独占与跨进程权限

1. PS7 holder 用读写句柄、仅共享读取持有原 `backup.freeze`。原文件的卷号/文件索引及单硬链接身份不变；旧 wx 启动入口始终因文件存在被拒绝，原文件不能被另一个进程重命名或写入。
2. 先密封并 Flush 原冻结字节和独立 `snapshot.json`，再原地写入维护状态；旧控制记录在持锁期间归档。安装、双 pin、profile 和授权切换期间不移走原冻结文件。
3. 复用原 C# `CreateProcess` 的原子 `JOB_LIST`：新 Manager 在维护 Job 内以 suspended 状态创建，保存实际 PID、exe、创建时间、动作、profile/release 绑定后再 resume。外部 proof helper 要求自己的 OS ParentProcessId 等于声明请求者，并检查准确进程身份和 Job 成员；不能以传入别人的 PID、普通子进程或 AsyncLocalStorage 取得权限。
4. 维护 Job 的观察句柄只给当前 SID query/read-control；已持有的创建者句柄保留管理权。授权 Launcher 经同一证明后不再使用 BREAKAWAY，Guardian/Supervisor/服务进程同时留在外层维护 Job 和原有私有 Job。
5. 借用句柄关闭不 unlink。成功交接须验证 Manager 退出 0、实际 ready、准确 Guardian/Supervisor 身份及嵌套 Job、实际隔离 runner 初始/周期健康事件。先 Flush commit-intent，再取消外层 Job 的 KILL_ON_JOB_CLOSE，最后归档原 gate；此时才允许普通入口进入。
6. holder/控制进程异常退出时，Job 关闭终止子树，冻结保留。新 host 遇未完成 session 拒绝。独立 `recover024Freeze` 只在原 owner/controller、记录身份及四类 Job 均消失、原文件 ID 和快照摘要绑定后，将原字节写回同一文件；恢复出的零字节文件仍阻止普通 wx 启动，然后由既有完整恢复器恢复安装现场。

恢复意图落盘后、原 freeze 写回后均有真实强杀与新进程续跑。已有 intent 必须匹配 seal/fileKey/原像，且原恢复 worker 已消失。host/recover 原生入口自身拒绝重解析祖先路径，gate 打开后核对最终路径；测试覆盖根 Junction 以及 session 目录 Junction，均拒绝且未写入重定向目标。

## 独立审查修正

- 原版“移走 freeze 后再安装/启动”存在真实窗口，新实现始终持有原文件。
- Launcher 的安全环境刻意不保留 ProgramFiles。首个真实 release 在 Join-Path 空参数处失败，尚未创建 Guardian；已改用系统 KnownFolder 取得 PS7 路径，未更改执行策略或权限。
- 原生 proof 最初信任 stdin PID，现绑定 helper 的真实父进程，并限制 manager/launcher 两种角色；原始 helper 冒报已授权 PID 的回归测试退出 2。
- 完成时补齐 Guardian 准确创建时间、nodePid 与私有 Job 名称检查。
- 独立恢复最初不能接续自身中断，现通过验证旧 intent 和原像字节续跑；拒绝活 owner、损坏 gate、提交意图/已 disarm 状态。
- 复审补齐原生根路径、session 路径的重解析检查。没有把路径别名当成独立的生产写权限。
- 复用安装器的 `controls` 回调按每项操作触发，不能当作归档全部完成。一次真实接续因此得到 `CLEANUP_REQUIRED`，未生成新请求；独立恢复 639 项成功。测试改在真正的 `starting` 检查点退出，不放宽 Runtime 的旧现场检查。
- 复用授权时 `recordApprovedEnabledState` 使用 wx，已有 enabled 文件不能重复创建；测试改为校验已存在的合法状态，未覆盖它以求通过。

## 原生证据与边界

所有捕获命令、退出码、信号、stdout/stderr SHA256 和原始路径见 [机器证据](evidence/024-minimal-handoff-20261025.json)。原始证据保留在本机；不提交密封前像、DPAPI 密文、OAuth token、数据库或凭据。

- `Test-Tong024NativeHandoff`：Windows 原生文件/Job、多进程 PID 冒报、后代借权拒绝、holder/控制进程强杀、恢复 worker 两处强杀和续跑、重解析路径拒绝、截断 gate 拒绝。探针 worker 明确是原语测试，不冒充完整后端。
- `Test-Tong024HandoffRelease`：实际完整候选安装，App/Manager 各自校验、双 pin/profile、原生 CurrentUser DPAPI 隔离登录恢复授权、普通/伪造启动拒绝、真实 ready/doctor、OAuth+PKCE 后 MCP initialize/tools/list（38 工具）、监控观察、完成后普通 stop/start/doctor/stop，最终无异常 freeze。
- `Test-Tong024HandoffInstallRollback`：实际 024d5b0 源码 283 项、原生 23 项及真实旧版启动/停止；八个安装阶段分别进程退出 71，新进程回滚各退出 0、每次完整验证 639 个快照项。此矩阵使用中间候选 1f425e2；最终候选的实际接续结果单列，不能将矩阵冒称最终 SHA 的八次运行。
- `Test-Tong024HandoffRecoverPrestart`：真实候选遇部分旧控制记录而拒绝；新进程恢复 native freeze，再接原恢复器完整还原 024，退出 0。
- `Test-Tong024HandoffCrashRollback`：最终候选的启动失败/控制进程崩溃与完整 024 恢复接续结果见机器证据；没有以模拟布尔结果替代原生进程、Job、文件或 DPAPI 检查。

最终候选两个完整链均退出 0：

| 链 | 实际结果与证据 |
| --- | --- |
| 安装/交接/监控/正常重启 | `handoff-v2-real-r7-20261025`；首次 run `3b1ecfe9-5c09-427e-81d3-c671f488a6ca`，正常重启 `dfcf39e4-6dbf-4325-a8e0-72dcf717db40`。两个预期拒绝 start 为 1，其余五个 Manager 命令为 0，runner 为 0，最终无 freeze。 |
| 启动失败后独立回滚 | `handoff-v2-024-native-r7-20261025`；真实占用隔离端口，授权 Manager 为 1，外层 Job 活动数为 0；新进程恢复 freeze、639 个完整版本快照项及 DPAPI staging 状态，退出 0。seal `72c9dae525068d20af614975d94ed3c736700a0e4d6d69bd430b5ad77415f1c9`。 |
| ready 后控制进程强杀 | 同一捕获链；控制进程信号 SIGTERM，实际记录身份消失、四类原生 Job 清空；独立 worker 51916 完整恢复 024，退出 0，seal `9e140cea664aad82103648f731a87068ecdb745166a2acd96806a6dbb17532ca`。 |

最终恢复链证据目录：`D:\Tong\state\b23-maint-native-9b317b949460486f92ac4c2002304bf5\024-handoff-crash-evidence-90e3bc8`。两个安装器中断退出 71 是有意注入；DPAPI 业务状态解密至新的隔离 staging，未宣称已覆盖生产业务库或最新 OAuth 数据。版本、profile、双 pin、正式隔离授权密文和控制记录由原恢复器逐项恢复并验哈希；不修改该恢复器的安全判断。

已有基线绑定测试亦以精确新候选检查授权范围并通过（0）：只读生产非敏感 pin、283 项历史源码归档、23 个原生项、SQLite/ConPTY 原生加载。未读取生产凭据或运行生产恢复。

首个失败 release e13e4c9 现场保留于 `D:\Tong\state\b23-login-8e32da332608430bb4971bc668ef4ace\024-handoff\f25cf554-a8f5-4c02-a801-b067dafdebb1`。其原像是 34e2680，不是 024，不作为全量 024 回滚证据。r5、r6 及最终候选的 source/release 摘要均分别记录，没有将新增能力归属于 34e2680。

隔离 runner 来自安装版本，只调整 root、mutex 并添加健康观察事件；实际任务/Host 未修改。它证明真实隔离运行中的初始和周期 doctor，不等于生产任务接管或长期稳定性验收。

## 尚未解决与停止点

1. 生产完整 inventory 的 ngrok 身份仍按已知边界为 `SECURITY_UNAVAILABLE`；历史 `MONITOR_FAILED` 根因仍为 UNKNOWN。两者不是已证实的同一问题。本轮没有更改 ngrok、ACL 或库存筛选，也没有重跑生产审计。
2. 原生回滚入口明确拒绝 commit-intent/disarmed；该阶段可能已有存活的 ready 子树，必须另行完成准确运行身份的受控停止/接管后再恢复，不能据 holder 消失推断 Job 已空。
3. gate 内容损坏时继续拒绝自动恢复；保留独立密封快照供原生人工恢复，不猜测未知状态。生产旧异常现场的完整新执行器及正式任务接管仍未开放。
4. 本轮开发测试入口均限制隔离根。生产入口 `MAINTENANCE_NOT_READY` 保持；没有生成可立即执行的生产操作单或请求生产授权。

可行的后续路线是：在单独明确批准的维护窗口内，先由本机受管入口核清未知 ngrok/监控及全部旧身份，再使用本次精确候选与受控归档、完整密封快照及独立恢复组件；对已 disarm/损坏 gate 采用准确身份的冷停止和独立离线恢复。不得直接移走 freeze、忽略未知 inventory、只关计划任务或把测试脚本放开生产来恢复。

完成开发分支提交和正常推送后停止，等待 ChatGPT 最终复审；禁止自行生产恢复。
