# 通信恢复复核与生产窗口补充（2026-10-26）

**最新状态：已授权生产窗口执行失败并安全回退，真实通信仍未恢复。** 详见文末实际生产结果。以下开发准备记录形成时尚未进行生产写入；其隔离通过不能替代生产验收。

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

## 已授权生产窗口实际结果：失败、安全回退

用户随后明确批准以 `bb51631d073080b6cdb826a5cb074726ab2c88b1`、固定七文件及本复核为依据执行一次 60 分钟生产窗口。窗口为 **2026-10-26 13:29:35Z 至 14:08:30Z**（日本时间 22:29:35 至 23:08:30），在限时内关闭。本段是实际执行结果，取代准备记录中“尚未授权”的状态。

执行前重新核对生产原版2号的 612 项文件、固定发布物、profile 仅双 digest 差异、Node/ABI、现有三项密文备份哈希、原 Host/runner、全部旧控制原件及三条既有预算。管理员只读原生检查确认 ngrok 的完整身份、七组历史运行的 Job/进程停止证明及完整无匹配库存。仅用已验证的非传播步骤修改八处指定 App DACL，再安装精确七文件到两个组件、双 pin/profile 和已验证 PS7 Host；安装核验 614 项文件/原生资产、17 个保留物理原件与版本描述符一致。

最终目标 Host 单文件由 Low 改为 Medium，Apply 与 VerifyOnly 均验证 SHA256、文件身份和 DACL 不变。用户本人在可见 PS7 输入版本绑定原生挑战；当前用户 preflight-login 与放行前管理员复核均通过。旧控制和同一个旧物理 gate 受控封存，预算保留原物理件及等字节工作副本。**正式 Task.Run 仅调用一次**，时间为 13:50:03.721Z；以下后两次均由原生 runner 在既有三次预算内自动进行，没有手动重跑、清空预算或放宽 120 秒期限。

| 本轮真实运行 | Launcher / Guardian 预检（均退出 0） | 实际失败 |
|---|---|---|
| `97158a7a-a328-454c-a443-c14da799c0b9` | 17285 / 17109ms | 总预算 120044ms，DevSpace `server_import_begin`，START_TIMEOUT |
| `e5b69347-6b26-46e6-bef1-61aadf865163` | 17029 / 16830ms | 总预算 120039ms；已到 Gateway `spawned`，该子阶段运行 4728ms 后耗尽全局预算 |
| `a5108ab9-f57c-4673-950a-087f09f8cca8` | 17683 / 17750ms | 总预算 120023ms；已到 Gateway `spawned`，该子阶段运行 9839ms 后耗尽全局预算 |

后两轮 Supervisor 已越过 DevSpace 初始化并创建 Gateway，stderr 未观察到先前的 chmod EPERM；但这不等于生产已修复。主记录的 `startupProgress` 最后值仍可能为 DevSpace `server_import_complete`，应与 Supervisor 的 Gateway 超时信息一起读取。表中的 120xxxms 来自 Manager 的全局预算事件，不能与 4728/9839ms 的子阶段耗时混淆。生产子进程令牌未取得可引用的存活快照，不把隔离令牌记录写成生产实测。真实启动链额外耗时的最早原因尚未闭环，不能仅凭这些耗时就归因于磁盘、Defender 或 OAuth。

三轮均无 READY。首次失败时观察器记录异常并禁用后续调度，已有同一原生 runner 仍按固有预算完成余下两次，最后退出 1；Task 最终 Disabled/0。未运行生产定期 doctor、完整 Gateway 认证 MCP 文件验收或 ChatGPT 网页文件读取，未创建生产验收文件。不把 AgentDock 启动期认证/list-tools 的局部成功算作全链通信成功。

### 实际失败回退与数据边界

14:01:06Z 的新鲜管理员原生证明覆盖历史七组和本轮三组，共十组运行：各四类 Job 均为 0，所有记录的原身份已消失（PID 重用独立比对），完整库存无匹配，生产端口空闲，Task Disabled/0，ngrok 身份仍成立。持有原 SID 生命周期 mutex 后，才执行物理回退：

- 原 17 个源码/绑定/Host/恢复授权物理原件、八处原 DACL、旧控制记录及原物理 gate 均恢复；新增 Protocol 与本轮失败控制移入本窗口事故证据，未删除原事故。
- 再核对原版2号 612 项文件、旧双 pin/profile、Host/runner 哈希、物理身份、原 Host Low 标签与真实状态目录原 DACL/标签。旧版本原生 preflight-login 退出 0、授权匹配。维护 gate 句柄和 mutex 随后释放。
- 本轮三条新增预算由原生 runner 正常产生并继续保留，旧预算物理原件也保留；不回写旧预算。ngrok 未进行服务控制或配置修改；未重启 Windows。
- 没有手工修改、清空或回写真实 DevSpace 数据库/OAuth。主 `devspace.sqlite` 文件仍为 122880 字节且哈希与窗口前相同；正常服务启动后 WAL 为 16512 字节，SHM 也发生变化，均保留。**主文件哈希相同不能证明包含 WAL 的逻辑 OAuth 数据全量一致，本轮没有作此保证，也没有把真实数据复制为可写测试夹具。**

本机审计目录：`D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\offline-9850e1a\production-comm-402b8fd5-d82d-47eb-a0eb-8987b769f0a0`。关键证据为 `formal-task.started.json`、`production.operation.failure.json`、`failed-attempt/run/`、`new-runs.stopped.admin.json`、`rollback.physical.completed.json`、`rollback.final-files.verified.json`、`rollback.preflight.original.json` 和 `maintenance.closed.failure.json`；完整原日志及私有元数据留在本机，不上传。

窗口最终状态为 `FAILED_STARTUP_TOTAL_TIMEOUT_SAFE_ROLLBACK_COMPLETED`。生产通信仍不可用，READY/doctor/定期监控、正式认证文件读写/重连/越界拒绝和 ChatGPT 网页实际读取均未达成。下一项阻塞是定位并修复真实生产启动链在原 120 秒边界内无法完成的问题；当前精确候选不能因为隔离通过而原样再次上线。本窗口已经关闭，没有追加生产重试或扩大代码安装范围。
