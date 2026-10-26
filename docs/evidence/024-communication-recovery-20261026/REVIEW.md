# 通信恢复复核与生产窗口补充（2026-10-26）

生产尚未恢复。本轮没有写入正式 App、Manager、Task、Host、ngrok、真实 DevSpace 状态或生产 gate。此前操作单的“准备完成”不等于最后一次生产故障已经解决；本文件补充其缺失的完整性级别条件。

## 独立还原的实际失败

最新失败窗口为本机 `production-seven-1b978bf7-6c28-4cf5-a07f-dceab58a0c31`，读取了原始 DIAGNOSIS、关闭记录及对应 Task/Launcher/Guardian/Supervisor/DevSpace 日志，没有改写它们。

| 运行 | 已观察事实 | 结论边界 |
|---|---|---|
| `91a42d83-8ef1-4ad0-ae0f-2d28bdbc19a9` | Launcher/Guardian 预检分别 17.252/17.095 秒，退出 0；DevSpace 到 `server_import_begin`；120075ms 后 START_TIMEOUT | 固定 15 秒不足以容纳实际预检；不能把此轮超时直接归为 chmod |
| `c7ada677-fbf8-4afe-9f6c-303928bd0992`、`bc185bee-8502-4229-b4ad-79abde0a75fb` | DevSpace 导入完成后退出 1，实际堆栈为 `chmodSync → dist/db/client.js:12:5 → SqliteOAuthStore → SingleUserOAuthProvider → createServer` | 失败发生于 OAuth 数据库打开前；AgentDock 已监听且认证列工具成功，Gateway 未达到 READY |
| 历史 `74cd4ad3-f21b-40ec-96f5-3f9015649e5d` | MONITOR_FAILED，旧监控未保留原始异常 | 精确原因仍 UNKNOWN，不能用本轮 EPERM 替代 |
| 历史 CLEANUP_REQUIRED / 无回执 be3 | 事故控制记录缺少可直接交接的新协议终态证明 | 属于安全退役/清理问题；不补造回执 |
| 当前 ChatGPT 工具失败 | 实际 Tong 只读调用返回 MCP -32603；ngrok 正在运行但本机 7676 无监听，公开发现端点返回 502/ERR_NGROK_8012 | 当前通信链确实不可用；尚不能验证真实网页端认证/文件操作 |

实际依赖为 DevSpace 1.0.8，Node v24.15.0 / libuv 1.51.0。生产编译产物 `dist/db/client.js` SHA256 为 `beb61280c2187e16220252f7333e23d97759309d8e6a16cb3b0c77352a37085e`；复现直接导入该实际文件，而非仅查看上游 TypeScript。

## 根因对照：DACL 之外的 Windows MIC

只读原生 LABEL 检查发现 `D:\Tong` 为可继承 Low，已安装正式 Host 继承 Low；用户 DevSpace 状态目录没有显式标签，按 Windows 规则视为 Medium。早期合成状态也在 Tong 下继承 Low，因而掩盖了差异。实际捕获的 Task→Host→PS7→Node 子进程同属当前用户，但其令牌为 Low (`S-1-16-4096`)，观察者为 Medium；非受限令牌、非 AppContainer。

在复制真实 DACL、明确设为 Medium 的专用空状态目录内，保持同一 PS7 Host 字节与 DACL：Low Host 的 Node 在相同 `client.js:12` 收到 chmod EPERM，数据库尚未创建；只把该合成 Host 文件改为 Medium 后，Node 令牌变为 Medium，首次 SQLite/WAL 写入及再次加载分别得到 1/2 行，均退出 0。真实生产死进程的令牌无法追溯捕获；当前正式 Host 标签和同条件复现共同解释最新 EPERM，不声称解释所有历史异常。

这符合 [Microsoft MIC 文档](https://learn.microsoft.com/en-us/windows/win32/secauthz/mandatory-integrity-control)：低完整性进程即使有 DACL 权限也不能写 Medium 对象，子进程的级别受到父进程/可执行文件级别限制。本轮没有吞掉 EPERM、跳过 chmod 或补丁替换 DevSpace。

## 最小修改与回归

- `Set-TongLoginHostIntegrity.ps1`：只操作明确路径、预期 SHA256 的单链接普通 `TongLoginHost.exe`；拒绝重解析点，锁定句柄后验证文件身份，仅写 LABEL_SECURITY_INFORMATION，验证字节/身份/DACL不变；`VerifyOnly` 不写入。
- `Build-TongLoginHost.ps1`：新编译 Host 后调用该步骤。**复制到 Low 父目录会重新继承 Low，因此安装后必须再次对最终 Host 目标执行，不能只处理暂存源。**
- 新增针对 MIC、Windows 目录/数据库、OAuth/MCP 文件操作及受控崩溃的隔离测试；调整既有 Task 观察器。原测试 Task 的五分钟限制不改；专用崩溃 Task 使用七分钟有界限制，见下述实际差异；120 秒启动预算不改。

本轮最终相关命令与结果（工作目录为开发仓库，PowerShell 均为安装的 PS7）：

| 命令/验证 | 实际结果 |
|---|---|
| `pwsh -File tests/Test-TongHostIntegrity.ps1` | 退出 0：Low EPERM 对照、两次 Medium SQLite/WAL、错误哈希/硬链接/junction 拒绝、复制目标继承检测；中断安装恢复原物理文件后 inode/原 Low 标签/DACL/字节一致 |
| `pwsh -File tests/Test-TongDevSpaceWindows.ps1` | 退出 0：新建/已有目录、目录/数据库 chmod、SQLite/WAL/重开、交互与独立 Limited InteractiveToken Task；拒绝属性写入为 EPERM，拒绝数据写入为 SQLITE_CANTOPEN |
| `node tests/Test-TongLauncherBudget.mjs --minimal-candidate` | 退出 0：慢预检、丢回执 fail closed、旧运行不能充当新证明、原始失败保留 |
| `node tests/Test-TongProductionPreflight.mjs --minimal-candidate --cases=minimal-denied,minimal-timeout` | 退出 0：明确拒绝与超时均不创建 Guardian，预检 Job 及其余三类 Job 为 0，原始失败分类保留 |
| `node tests/Test-TongMcpGateway.mjs`、`node tests/Test-TongMcpSessionContinuity.mjs` | 均退出 0：认证/会话、拒绝工具后继续、断线重连、上游关闭、解析错误恢复；日志脱敏 |
| `node tests/Test-TongToolBoundaries.mjs` | 退出 0；Windows 文件 symlink 因权限 SKIP，junction 拒绝实际执行；不声称文件 symlink 已验证 |
| `pwsh -File tests/Test-Tong024HostPolicy.ps1` | 退出 0：新 Build 步骤及 MOTW 拒绝，原内容和标记保留；合成 Task 退出 1 为预期拒绝 |

完整 Task 冷启动使用既有合成 Task、独立端口 29675/29676/29677、新的合成密钥；Host 为 Medium，状态目录为 Medium，实测 DevSpace 令牌为 Medium。App/Manager 保留原版2号其余代码，只重定位 Launcher/Guardian 的两个固定测试根。没有拿真实 OAuth/数据库做可写测试。

| 运行 | 证据 |
|---|---|
| `196e2caf-77ef-4e8c-b3f9-498aa054dbfd` | 完整原生链 READY；request→READY 74311ms；doctor、定期 doctor 原生退出 0；38 工具、OAuth、目录/真实测试文件读写编辑、越界/junction 拒绝、关闭重连、refresh；正常停止、四 Job 0、Task 0。最后报表谓词错误使外层脚本退出 1，原失败保留；独立重算验证时间，不把该命令写为退出 0 |
| `e593a3d2-38b2-402a-9a80-85baf29cc443` | 独立新状态根；`pwsh -File tests/Test-TongSevenFileTask.ps1 -Communication -MediumIntegrityHost -SimulationRoot <合成根>` 整体退出 0；request→READY 74062ms；同上全部检查通过，Task 0/Disabled、进程身份消失、四 Job 0 |

最终异常恢复命令 `pwsh -File tests/Test-TongSevenFileTask.ps1 -Communication -MediumIntegrityHost -ExerciseCrash -SyntheticTaskName TongCommRecovery-590f89ef9d19433795543ec10de68085` 整体退出 0。初始 `b6cdee0b-1160-43b9-bea5-c59cf22e2280` 达到原生健康事件后，仅终止精确 Supervisor；同一 runner PID+exe+ticks 及 `recovery_succeeded.runnerPid` 证明自动恢复为 `0ab0cdb7-951c-438d-98ce-56a7e937295b`，恢复 request→READY **71511ms**。恢复预算仅新增一次，原未过期条目完整保留；一条旧尝试自然过期，完整 before/after 均封存。恢复后独立 doctor、OAuth/38 工具、Tong 项目/Windows 元数据、真实 AgentDock 读取、DevSpace 读写编辑/列目录/越界拒绝、关闭重连两种读取、refresh 均通过。AgentDock 只新增对合成 demo 的三个只读工具授权，不授予 Shell/真实项目权限。最终正常停止，原身份消失、四 Job 0、库存完整无残留、Task 退出 0/Disabled，原测试 Host/runner 物理件恢复。

原生整轮验证后仅补充了报表的 `requestToReadyRunId` 和对应匹配断言；用本轮实际 request/事件/结果离线验证一致，并在 PS7 重新解析。崩溃轮的总表 `requestToReadyMs` 对应恢复请求，初始冷启动只使用独立的 Task→healthy 指标；不把恢复耗时误标为初始运行。

资源差异已只读核实：正式 Task 为 PT0S，旧合成 Task 为 PT5M。两次启动、异常检测、独立 doctor/MCP 及停止总实测约五分半，后者在完整验收结束前终止 Host。因此新增无触发器、同 Limited InteractiveToken/IgnoreNew/合成 Host 路径的 `TongCommRecovery-590f89ef9d19433795543ec10de68085`，仅给予整轮测试 PT7M；不改正式或旧测试 Task，不延长单次 120 秒启动或恢复预算。该 Task 留存 Disabled，便于复核。再次执行前等待旧合成根的预算自然过期，未写入或清空预算，也未另建数据根绕过限制。

失败证据全部保留：早期路径拒绝实际为 RPC -32602，观察器已修正；早期崩溃观察器等待错事件及随后五分钟 Task 到期并非生产根因；一次停止库存误包含测试观察器，现仅按 PID+exe+ticks 排除明确控制器；旧根恢复预算耗尽后没有清空。另一次 Medium 崩溃恢复已重新 READY、doctor/MCP 通过，但整体因 Task 达原五分钟上限退出 1，不能冒充完整通过。新回归减少重复的崩溃前 doctor，恢复后仍执行完整 doctor/MCP，新增同 Runner 和预算仅消费一次断言。

合成配置、profile、双 pin 和加密 owner/AgentDock 凭据跨重启哈希不变；已有合成 OAuth client 仍能授权。真实用户旧数据未用于写入试验，未测试真实登录触发、Windows 重启或 ChatGPT 外网文件读取。新增独立状态根约 190MB，其余复用既有依赖/发布物，未安装依赖、重打包或复制完整备份；所有产物保留。

## 新生产窗口相对旧操作单的必要修正

以 [既有操作单](../024-deployment-preparation-20261026/PRODUCTION-RUNBOOK.md) 的物理原件保存、静止证明、版本校验、原生审批与失败回退为基础，不能不经修改照搬：

1. 运行证明应加入最新三次失败 `91a42d83…` / `c7ada677…` / `bc185bee…`，逐项核对对应身份、四类 Job、终态回执及完整库存；保留旧无回执事故和全部原始证据。预算不清空，不把历史失败改为成功。
2. 生产 App 上次回退恢复了原 DACL。必须在明确批准范围内，仅对 `D:\Tong\app`、`app\scripts` 及六个原有启动源码（AgentDockRuntime、RuntimeLaunch、RuntimeGuardian、RuntimeSecurity.mjs/.ps1、LoginRecovery）设置 Tong 要求的私有 DACL：当前用户/SYSTEM/Administrators、保护继承，移除这些目标上的其他 ACE。先保存原 DACL，使用此前验证的非传播原生句柄步骤，保持 owner/字节/物理身份及其他子项 DACL 不变。禁止递归重设或改变真实状态目录 DACL。
3. 仍只安装原七文件候选及 profile/双 pin，切换已验证 PS7 Host；不安装本开发分支整套代码。Host 复制到正式最终路径后，调用本轮单文件 helper，再 `VerifyOnly`，确认实际后续 Node 令牌 Medium。helper 当前工作副本 SHA256 为 `482ef6f344aadf2bc3ad784406d7641141eb7a27a1d15360bb6956c2f292f07f`，执行前重新比对。
4. 该操作仅将最终 `D:\Tong\runtime\login-management\TongLoginHost.exe` 从 Low 改为 Medium；不递归改变 Tong 标签、不更改全局 Node/AgentDock 标签、不降低真实用户状态标签或放宽权限。旧 Host 物理原件保留，其原标签随物理回退恢复；同样恢复八处原 DACL。
5. 原生人工批准入口优先使用可见 PS7，调用正式 `TongProductionApproval.ps1 -Mode approve-login-recovery`，不照搬旧操作单固定的 5.1/Bypass 命令；本轮未证实该人工入口存在必须使用 5.1 的要求。不修改系统默认 Shell/执行策略。候选内原有 Windows 辅助进程保持被审核版本，实际按其目标版本验证。
6. 完成精确版本绑定后，由用户在可见本机入口完成版本绑定的恢复挑战，Agent 不代填。原 gate 仅能在新窗口明确批准受控退役后同卷保存原物理件，不能删除/重建。只放行一次正式 Task，由既有有界恢复策略最多消费 3 次/30 分钟预算；不直接 start、不扩大重试。
7. 正式验收加入认证 MCP、授权测试目录读/新建/编辑/重读、拒绝越界、关闭重连、ngrok 实际路由，以及 ChatGPT 侧真实读取。只有最后一项实际成功后才能称真实通信已恢复。

固定候选仍为本地对象 `3740082b3c11ca4403d1abdceed75d539878a161`，不因本轮测试而改包：source.tar `fc03213b58a9b050ba84502fe990b98b3d54866fdf603930113eb3f0ca16dea3`；release-manifest `ebd4f21fe831bc4e4cd8ff2db553a22cfd7c09341e94d0ce33427db977dfd750`。发布物 308 项文件重新核验匹配，安装使用既有 INSTALL-MANIFEST 的实际 CRLF packagedSha256。

既有完整备份三项封存/密文哈希重新匹配，没有解密或重做。旧七文件候选的半安装 App/Manager、错 pin 拒绝及 14 个物理源码原件回退证据仍适用（候选未变）；本轮补充 Host 标签的物理回退验证。

最终生产只读检查：App/Manager 共 612 项源码/原生文件匹配 `024d5b0920d9ad8f1a2baf2e55640a5666ad4739`，正式 Task Disabled/0、LastResult=1，7676/7677/18765 无监听；原 Host hash `0d516bb5b26686b8ab2f0c3b1022beba7f48f8ad23e57a60e690cde9bdfc0c3b` 及 Low 标签未变，旧空 gate 和原三条恢复预算保留。当前生产窗口、Task 启用、精确生产文件/DACL/Host 标签写入均尚未获本轮授权；最坏回退终点仍是安全停机的原版2号事故现场。
