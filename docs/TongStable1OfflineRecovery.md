# Tong 1号一次性离线恢复操作单

接手：`9850e1a80912ec18d80112544a7ab524d4798365`。本次仅准备 **2号 → 1号**；开发分支为 `codex/024-maintenance-adapter-20261024`，工具提交以最终交付 SHA 为准。

**NOT READY，禁止执行生产回退。** 已补齐新密封文件备份及隔离安装/独立回写验证；生产入口关闭、旧 freeze 到原版 1号的离线交接尚无生产执行证明。本工具有意不提供生产安装、生产归档或生产恢复写入模式。下列只读命令可复核证据；服务/任务操作必须另获本机维护批准。

| 编号 | 精确提交 | 本次用途 |
| --- | --- | --- |
| 1号 | `37dc649c46ad0e267c3471f750b97227cf106310` | 唯一恢复目标 |
| 2号 | `024d5b0920d9ad8f1a2baf2e55640a5666ad4739` | 故障原像及失败回退目标；回到原像不代表服务健康 |
| 3号 | `24431b263ab1bc6ec17cca48f82245f72f197d4c` | 历史记录，不扩展、不部署 |

不修改 main，不部署 5362210，不使用历史 a1b56b3 的 quick-trust-full-cutover 冒充 1号。既有 1号完整原生验收见 [原验收](TongStable1RecoveryPreparation.md)；本次没有重复原有 Gateway/MCP/Codex 矩阵，没有改变 1号 App/Manager 源码。

## 新备份及保管

以下路径均在本机，备份与明文业务副本不得提交 Git 或传至外部。

```text
操作目录 D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\offline-9850e1a
生产备份 <操作目录>\production-6ac61ad1-c9e5-4d21-8142-af1c4aa59956
生产 seal db00d0725d89b0141ae31d972b9d96800a2c53d7c2dd9d2876a467c71a273e8f
隔离备份 <操作目录>\isolation-52b84969-c847-4f78-9699-d57c5d46842a
隔离 seal b1d1921e283fb6d261718fe5c474ef0c41c0f0b19ba756fc52ec6571117e16da
完整影子 <操作目录>\production-shadow
```

生产备份于 `2026-10-25T08:51:38.8735365Z` 密封，77,485 个文件，33,305 个唯一内容，逻辑总量 1,635,563,708 字节。`payload.aes` 为 286,155,104 字节，SHA256 `7f5a5bb2ec8d757af19834f5797777303cba0ffd3aecc4a58bdfa872af381208`；`manifest.dpapi` 为 18,125,606 字节，SHA256 `495bec397f7143d91c635e379d26614b29b241a87ab23b82b2d8f64f369934f1`。seal 的 SHA256 必须从本文/交付提交核对，不能从待验文件自身取得后当作信任依据。

| 文件组 | 项数 | 内容 |
| --- | ---: | --- |
| app / manager | 38,606 / 38,458 | 全部现有普通文件，包含实际依赖树、源码、原生文件、补丁及业务 runtime |
| binding / control | 2 / 16 | profile、production-root、双 pin、原始 freeze 与全部 run 控制记录 |
| secrets / policy / backend | 63 / 13 / 1 | DPAPI 密文及授权索引、策略、后端状态 |
| config / oauth | 2 / 3 | 用户 DevSpace 配置、实际 OAuth DB、WAL、SHM |
| monitor / logs | 10 / 248 | 外部监控程序、runner、预算/撤销及事故日志 |
| node / ngrok / agentdock | 1 / 1 / 61 | 实际 Node、服务配置、AgentDock 全部文件 |

正式任务 XML 和 ngrok SCM 配置（账户、路径、启动模式及当时状态）另在 DPAPI 保护的 manifest 内。没有输出令牌、授权明文或数据库内容。捕获时先以只读/share-read 方式打开所有源文件再读取，核对文件身份、主要目录文件集合及任务 XML；生产源没有写入。新鲜 PS7 进程已解密并校验全部内容，不只检查清单。

这是文件内容备份和监控配置记录，**不是包含 ACL、ADS、空目录、注册表/系统/任务服务对象的卷镜像**。没有修改 ACL 或全局策略。CurrentUser DPAPI 要求原用户及可用的 Windows 用户密钥；不能假设 WinRE 或另一账户可解密。维护窗口前需重新核对文件集合/业务变更；本备份不能默认为未来时刻的最新状态。ngrok 当时仍运行，服务内部未落盘的状态不在文件备份中。

完整影子是映射至私有目录的真实文件副本，有真实 OAuth/业务敏感内容；只用于回写校验，绝不启动或注册它的任务/服务。用户已明确批准本轮在上述操作目录内最多 **2,500,000,000 字节**隔离占用；不包含生产写入、部署或删除授权。历史原件、候选和原始快照完整保留。

## 本次独立回退与安装验收

结果和非敏感摘要见 [机器证据](evidence/stable1-offline-20261025.json)。独立入口 `scripts/TongStable1Offline.ps1` 使用 PS7/.NET，不导入当前安装的 Manager；只有静默状态探针复用开发分支的原生身份/Job/端口元数据工具。

1. 在已有私有隔离根构造精确 2号 App/Manager，复制原事故控制记录；不补造 Launcher 回执。密封 3,625 个文件，196,602,526 字节。隔离数据、模拟授权和生产授权严格分离。
2. 分别在 App 写到一半、双 pin/profile 更新后真实退出安装进程（退出 71）。另破坏 Manager 入口、业务状态、OAuth 探针表、DPAPI 密文、控制记录，并在后一轮截断 profile。
3. 每轮由不同 PS7 进程从密封备份恢复原路径；校验全部原字节、双 pin、2号 App/Manager；新增候选文件移入独立 retired 目录，保留内容，不删除原件。不能把只还原 gate 当作成功。
4. 完整安装 1号清单、原生及旧补丁，验证 App/Manager；持续保持原隔离 freeze 的同一文件身份。受控保存原事故记录后，仅在隔离根归档原 freeze，不用于生产放行。
5. 新建真实隔离 Task→外部 PS7 Host→runner，1号达到 ready/doctor 健康，runId `af5757a4-294d-4991-9bf1-041097b3d71b`；正常停止、任务退出 0。随后再由独立进程完整恢复隔离 2号原像，原 freeze 身份未变。最终隔离任务 Disabled/0实例，2号原像有 gate，不留运行服务。
6. 实际生产备份的全部 77,485 项另在固定、无激活能力的影子目录回写；再破坏 Manager、真实业务/OAuth/授权密文、profile、控制与监控文件并加入额外文件，由第二个独立进程完整校验/回写。任务和服务配置只恢复为可读取的备份元数据，未应用到系统。生产原路径没有被回写。

第 6 项已通过：首次进程 PID3208 回写全部 77,485 项；第二进程 PID40980 校验全部文件并重新写回 2,941,549 字节，7 个受损文件摘要复原，4 个新增文件均移入保留目录。两次影子 gate 身份均为 `3025126315:65536:3281891`，与真实生产 gate 分开。不能把影子数据验证等同于已恢复生产 Windows 对象、DPAPI 权限可用或完整离线交接。

本次操作目录 78,309 个文件，逻辑量 1,976,166,995 字节；D: 已只读确认 NTFS 簇 4,096 字节，含逐文件簇余量及 64MiB 预留的估算上界为 2,364,029,523 字节，低于获批额度。最终隔离原生静默检查退出0，生产只读复核 `2026-10-25T11:46:33.428Z` 的88项摘要仍相同。

保留的诊断失败：生产备份辅助进程仍活动时，初次静默检查拒绝；启动面审计首次与 PowerShell 自动变量 `$matches` 冲突，改用 `$entryMatches` 后通过；末次检查经嵌套 pwsh 控制进程启动时拒绝额外匹配进程，改为直接在既有 PS7 中调用后通过，没有放宽库存断言。预期安装退出71与生产范围/错误seal拒绝退出1另列在机器证据。自动只读复核因使用额度限制未返回意见，**不算复核通过**；完成本地逐项检查，仍等待ChatGPT最终复审。

1号 releaseDigest：`164f740171b8094133893dc8f0cc1ca2f60eb82b191d54b3607391b1eca63ed0`；270 源码/23 原生。Node v24.15.0/ABI137，摘要 `3331e1ffe19874215472217c5e94f5a0c6d8e18c4ac7111d3937aa0ad5e9b4a5`。不下载、不重建依赖。

**外部组件单独绑定**：复用外部 `TongLoginHost.exe`，摘要 `28d5db5e41d7ea079550d04377f383dc858dd126f57ce9a1b1f51cea00d33718`，来自已有 `monitor-88ca27ee-e599-4482-b849-7c96923272fb`。产品内 Host/runner 保持 1号原字节。原 runner 摘要 `2a32d46a7307f088a827e06dbe81d85ee35ab2153e19cc85f3f69778c642684b`；本次外部隔离 runner 仅替换 root 和 mutex，摘要 `8fbbda10ed4524af3cebbc58f08c47941f438d9ec539ef2d6aa73f3018decc3e`。Host 子进程使用相邻独立 TEMP，PS7 7.6.6，沿用 RemoteSigned，不改全局 TEMP/执行策略。**隔离 runner 不能部署到正式 root**；正式 runner 与 Task action 的精确绑定仍须在正式窗口核验。

## 可执行复核命令

从已核对交付 SHA 的开发工作树执行。第一条只读生产备份并解密到内存，要求原 Rune 用户；后两条仅检查生产状态/启动面，不改变任务服务。

```powershell
Set-Location -LiteralPath 'D:\Tong\development\tong-024-startup-recovery'
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoLogo -NoProfile -NonInteractive -File '.\scripts\TongStable1Offline.ps1' -Mode Verify -Snapshot 'D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\offline-9850e1a\production-6ac61ad1-c9e5-4d21-8142-af1c4aa59956' -ExpectedSeal 'db00d0725d89b0141ae31d972b9d96800a2c53d7c2dd9d2876a467c71a273e8f'
& 'D:\node\node.exe' '.\tests\Test-Tong024PlanBProductionAudit.mjs'
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoLogo -NoProfile -NonInteractive -File '.\scripts\Inspect-TongStable1OfflineEntries.ps1'
```

审查用隔离恢复入口（**只写固定隔离根，不是生产命令；现有演练已通过，不必再运行整轮**）：

```powershell
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoLogo -NoProfile -NonInteractive -File '.\scripts\TongStable1Offline.ps1' -Mode RestoreIsolation -Snapshot 'D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\offline-9850e1a\isolation-52b84969-c847-4f78-9699-d57c5d46842a' -ExpectedSeal 'b1d1921e283fb6d261718fe5c474ef0c41c0f0b19ba756fc52ec6571117e16da'
```

完整影子入口为 `-Mode RestoreShadow`，固定生产 snapshot/seal，另需 `-ResourceBudgetBytes 2500000000`。它永远映射到 `production-shadow`，没有目标路径参数，不应用捕获的绝对生产路径或任务/服务。测试驱动 `tests/Test-TongStable1OfflineShadow.mjs --approved-2500000000` 仅针对本次证据；结果已存在即拒绝重新做整轮。

## 正式窗口的最小人工前提与停止点

最新只读现场：2号双 pin、profile、88 项受控文件总摘要 `ff89b0cba58e6ce1ddffd95ebfbe0a92fb6ca2f6acb753417db3a2c4dabb2642` 未变；旧 phase=abnormal_exit，10 个记录进程已消失，三组 Job 均为 0，生产端口无监听。原零字节 freeze 文件身份 `3025126315:89915392:3025673` 未动。缺失 Launcher 回执/旧 Guardian containment 依然缺失，不能补造或改写原件。

只读启动面盘点了 222 个任务、322 个服务、16 个 Run/RunOnce 值、3 个启动目录文件及 WMI consumer。121 个脚本/间接包装入口尚未逐个追溯；另有 `SERVICE_IMAGE_UNAVAILABLE`。它们不是 121 个已证实的 Tong 入口，也不是“没有其他入口”的证据。正式 TongLoginRuntime 仍 Enabled、0实例、上次结果1；ngrok Running/Auto/LocalSystem、PID40452，其 exe/命令行不可读，库存 `SECURITY_UNAVAILABLE`。缺少权限的事实不能通过放宽库存断言消除。

**本轮在此停止，不开放生产写入。** 用户以后批准实施时，最小人工处理是：

1. 在同一可见维护窗口内，由具有所需任务/服务查询与控制权限的操作员核实 ngrok 完整原生身份，追溯可能触发 Tong 的包装入口，并停止/禁用确认相关的自动触发；关闭其他可发起 Tong 启动的会话/客户端。保存原 task XML、触发器及服务配置，分别记录如何恢复。不能将“当前没有进程”作为持续独占。
2. 若仍不能证明所有相关入口受控，改为**生产 Windows 不运行、生产卷由受控维护系统离线访问**的人工方案；不能继续在线试装。先在原账户验证 DPAPI 备份和可用原像，确定原账户恢复访问方式及映射路径；本次影子不能直接作为可启动产品。离线卷写入、原像重放、启动对象恢复与首次启动顺序尚未演练，不提供未经验证的复制命令。
3. 无论选择哪条路径，先完成受控停止和独立原生身份/Job/端口复核，且有覆盖安装与失败回退的持续独占。已存在的 freeze 必须按原文件身份持续保护，保留原事故记录，形成由操作者确认的归档交接。1号使用 `open(backup.freeze,'wx')`，不能继承持锁 gate；本次隔离的 close/move 只证明原件可保存，**没有证明生产竞争窗口消失**。禁止直接删除或改名生产 freeze 后普通 start。
4. 原生授权由用户在本机可见 ConsoleHost 完成，精确绑定 1号 profile/release、App/Manager、backup/restore/start/stop、AgentDock 与登录恢复；不能复制模拟授权、代填挑战、篡改 DPAPI 或把聊天许可当作原生授权。尚未完成这些授权，不得安装。

只有上述前提与固定生产路径安装/独立回退验证补齐，才可形成经最终复审的**一次性生产安装命令**。当前提供生产复制/移锁/启动组合命令会绕过已发现的实际门禁，因此本交付明确没有该命令。这是尚缺的操作前提，不是要求继续开发方案B或通用维护系统。

正式实施顺序固定为：关入口及受控停机 → 同窗口最新密封备份与新进程验证 → 保持独占及旧 gate → 按完整 1号清单安装 App/Manager/原生/依赖/补丁及 profile/双 pin → 单独绑定正式 PS7 Host/runner/TEMP → 受控归档旧事故和 gate → 原生批准 → 唯一正式 Task 启动及验收。任何一步不能闭合都停在写入前；已写入失败则由独立进程恢复全部 2号原像和新增文件清单，保留事故，恢复原任务/服务状态，不能自动宣称健康。

## ngrok 单独服务窗口（本轮未执行）

需要该服务的 Query/Stop/Start 权限和可读取 exe/命令行/创建时间的身份查询权限；不修改服务账户、ACL、启动模式或配置。实施授权前说明公网隧道/OAuth/MCP 的停机影响，记录原 Running/Auto、任务 XML 和配置摘要；不得直接 kill 不可读 PID。

仅供批准后的操作员参考，**不属于当前可执行恢复命令**：

```powershell
Stop-Service -Name 'ngrok' -ErrorAction Stop
(Get-Service -Name 'ngrok').WaitForStatus('Stopped',[TimeSpan]::FromSeconds(30))
# 必须另核对原 PID 的原生身份已消失，库存完整、端口与 Job 符合预期。
# 核验失败即停止安装；不得继续杀进程、改权限或加长无界等待。
Start-Service -Name 'ngrok' -ErrorAction Stop
(Get-Service -Name 'ngrok').WaitForStatus('Running',[TimeSpan]::FromSeconds(30))
```

维护成功或放弃时按原配置恢复原服务状态，并验证新身份、隧道、OAuth/认证 MCP。不能只凭 Running 判定公网恢复。若服务无法恢复，保留备份和原配置，停止扩大操作并报告；不假称已回到窗口前状态。任务 stop/disable/start、ngrok 操作、正式文件写入均未在本轮执行。

## 授权边界、失败停止与后续验收

未来申请生产批准时须简洁说明五项：仅一次 2号→1号维护及失败原像回写；影响 App/Manager、profile/pin、业务/授权原文件、控制/监控和指定任务；这是既有目标的生产实施，ngrok 单列权限；最坏是本机服务及公网访问持续中断，以本窗口密封 2号原像恢复并保留 gate；授权只覆盖这一维护窗口，不包含后续部署、清理、ACL/策略变更。当前资源批准不等于该批准，本轮不发起生产授权挑战。

停止条件：seal/版本/文件身份不符；DPAPI 不可恢复或授权失效；未知进程/Job/端口/启动入口；独占丢失；文件/业务集合变化；空间超批准额度；安装中断或状态不明；独立回退进程失败；外部 Host/runner 摘要不符；ngrok 服务窗口无法闭合。不得跳过断言、伪造回执、清除 freeze 或延长无界重试。

真实恢复后仍需 ChatGPT 实际客户端文件读写/公网 OAuth、正式 AgentDock/基础 MCP 与 Codex 原生会话验收；此前仅本地 SDK 路径通过的项目不能冒充 ChatGPT UI 已验收。最后经批准进行真实 Windows 重启和登录，重启后 ready、doctor 健康才判定恢复完成。本轮未重启 Windows。

恢复并重启稳定后才做清理清单与正式 `docs/Tong-Recovery-Handoff.md`：记录事故时间线、版本/原因、真实恢复和验证、Git/备份位置、实际清理、遗留问题和后续研发顺序。重要删除单列批准，保留生产数据、有效授权、唯一回滚备份、原事故证据和 Git 历史。本轮没有清理或编造“恢复成功”交接。
