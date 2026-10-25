# Tong 024 最后收尾与生产操作单（2026-10-25）

> 本页保留为 a7c1aca 交付时的历史操作单。后续最小端口候选、正式任务修复和最新 NOT READY 边界见 [阻塞收敛交付](Tong024Convergence.md)；不得继续把本页90e3bc8字段当作本轮最终候选。

**NOT READY。当前操作单用于复审，所有生产写入均停止。** 接手 `9ec35b9ab7997aaebfc36e127a2658ec2d116b12`，开发分支 `codex/024-maintenance-adapter-20261024`。本轮没有部署、生产授权或更改生产文件、服务、任务、执行策略、证书、ACL、ngrok 配置及事故记录。

## 交付范围和精确绑定

唯一产品候选仍是 `90e3bc872989e63a6efe5bcef214e0489d54e052`，不是开发 HEAD。本轮没有生成新产品候选；未验收的六阶段 commit/finish/stop 草稿已撤回，不接入执行链。`Tong024Handoff.mjs/.ps1` 与接手提交逐字节 Git 内容相同。新工具 `Tong024ColdRecovery.mjs/.ps1` 是**开发隔离环境离线 gate 恢复器**，不被普通启动、安装器或生产入口引用。

| 绑定 | 精确值 |
| --- | --- |
| 生产基线 | `024d5b0920d9ad8f1a2baf2e55640a5666ad4739` |
| 候选父提交 | `34e26801876d8b1a2fc874dddce72b0939924e87` |
| 候选 release | `D:\Tong\state\b23-login-8e32da332608430bb4971bc668ef4ace\handoff-release-90e3bc8` |
| releaseDigest | `0fdfe34e0685db76486e094d74369455f58857d5ff74db29c524037775b61af1` |
| sourceDigest | `b3b2e7c7d2d601a94b9e1b5f5b78192e3c0fded6927d9efbb7cdd372b1c192a4` |
| 发布内容 | 301 源码项、23 原生项；Node v24.15.0 / ABI 137 |
| 当前生产 App / Manager | `D:\Tong\app` / `D:\Tong\runtime\releases\manager` |
| 当前生产双 pin | 均指向 024d5b0，SHA256 `482906d969ad9576b3de59e68df4d988898dc10f461d673231ac650d3dd892dd` |

本轮重新验证完整候选 release、隔离 App/Manager 和双 pin；没有重跑此前完整发布启动/MCP/639 项回滚矩阵。原有证据及其限制仍见 [最小候选报告](Tong024MinimalHandoffReview.md) 和 [原生证据](evidence/024-minimal-handoff-20261025.json)。

## commit-intent / disarmed / completed 的真实边界

90e3bc8 的 `complete` 实际顺序是：核对 ready、Guardian、Supervisor、外层 Job、直接 runner 的初始/周期健康事件 → gate 原地 Flush `commit-intent` → CreateNew/Flush `commit-intent.json` → `ReleaseSurvivors` → gate Flush `disarmed` → 关闭 gate 句柄 → Move 到 `completed.freeze` → stdout 回复 completed。**持久 gate 中没有 completed 阶段，也没有独立 completed.json 提交回执。** stdout 回复不能作为崩溃后的唯一证明。

| 崩溃边界 | 文件与可能的原生活树 | 当前允许处理 |
| --- | --- | --- |
| commit-intent 写前 | 原 gate 留在原位，外层 Job 应仍 armed；独立监控可能存活 | 核对每个 PID/exe/startTicks、原生 Job、监听表；有未知即停 |
| gate 已写 intent，intent 文件未完成 | gate / intent 可能不完整，Job 尚 armed | 不依据半文件自动恢复；密封原件后进入离线冷恢复评估 |
| intent 文件完成，disarm 前 | 原 gate 和 intent 存在；Job armed | 不把 owner 消失当作树已清空 |
| disarm 后、gate 尚未写 disarmed | gate 仍可能是 intent，但树已可继续存活 | 拒绝普通 recover；准确身份接管或停止尚未实现原生验收 |
| gate 已 disarmed、归档前 | 原 gate 可能存在；关闭句柄后还存在 Move 前边界；服务/Guardian/Supervisor可能存活 | 同上；不能直接覆盖现场 |
| 归档后、回复前/后 | 原 gate 不存在，completed.freeze 内容通常仍是 disarmed；服务可存活，普通入口可进入 | 先对 pin/profile/request/runId、所有身份、Job、当前健康和归档证据交叉核验；禁止自动回滚健康服务 |

Windows 的 KILL_ON_JOB_CLOSE 在**最后一个句柄**关闭时生效；query 观察句柄也可能延长 Job 生命周期。因此本报告撤回任何“holder 一退出就必然全树消失”的绝对推断。实际必须查询 Job 及进程身份。[Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)

本轮**没有**用伪造 gate 阶段、模拟健康结果或补写 Guardian/Launcher 回执填补这些崩溃点。六处提交阶段的完整真实服务退出/独立接管验收仍未完成；自动 finish/stop 不交付。现有 `recover024Freeze` 继续拒绝 commit-intent/disarmed。离线工具拒绝 `completed.freeze`、`completed.json` 或有效 completed gate，不能把已提交现场转换成回滚成功。

## 受控离线冷恢复：已验证的最小实现

入口必须绑定 root/mode/profileDigest/releaseDigest、session、用户复核的 snapshot SHA、当前损坏 gate SHA 以及原文件卷号/文件索引/单链接身份。JS 和原生 PS7 各自拒绝生产。原生 helper 单独校验 profile.root 与实际目标 root，重新调用原生 CurrentUser DPAPI restore 授权，写回前再次核验授权有效性。

先确认原 owner/controller/client、现存有效 gate 的同类身份、控制记录全部身份已消失、外层及私有 Job 为零、Windows 原生监听表无目标端口、没有同根外来进程。Node、AgentDock、Host、PowerShell 的元数据未知均拒绝；CIM 退出竞态只有 native handle signaled 或 OpenProcess 明确 ERROR_INVALID_PARAMETER 才视为消失，ACCESS_DENIED 保持未知。隔离库存按既有 production-simulation 范围，不包含生产 ngrok；**这不能证明生产完整库存可用**。

原 snapshot、original.freeze、损坏字节副本和授权元数据均由持续禁止写入/替换的文件句柄保护，并在写回前复核最终路径、单链接身份及摘要。损坏字节先 CreateNew/Flush 到唯一 cold 证据目录，随后才把原字节写回**同一个** backup.freeze 并 Flush；不删除或更换 gate。恢复后的零字节 gate 仍阻止普通 wx 启动。

旧会话不得覆盖有效后继会话；已有 restored 回执必须完整解析并绑定原像，仅允许精确原像幂等确认。封存前后、写回后进程退出可由新进程接续，原件均保留。该工具**仅恢复 gate，不恢复完整 App/Manager/业务状态**。完整快照必须由既有版本/状态恢复器另行验证；目前没有可执行的生产完整回滚链。

实际隔离入口（参数文件必须人工复核为该隔离根的非秘密绑定；此处未包含生产解锁选项）：

```powershell
Get-Content -LiteralPath '<隔离恢复绑定.json>' -Raw |
  & D:\node\node.exe D:\Tong\development\tong-024-startup-recovery\scripts\Tong024ColdRecovery.mjs --recover
```

JSON 字段为 `profile`、`sessionId`、`snapshotSha256`、`gateSha256`。不要输入授权密文或凭据。profile 必须为 `production-simulation`；当前生产 root 一律拒绝，不能改名/做路径别名绕过。

## ngrok 和正式监控

原生只读探针用 SCM QUERY_STATUS 前后夹取服务 PID，再尝试 `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)`、`QueryFullProcessImageName`、`GetProcessTimes`。实际 ngrok 为 LocalSystem / Auto / Running，SCM 稳定 PID 40452；OpenProcess 返回 **5 ACCESS_DENIED**，exe/startTicks 不能证明，CIM 的 exe/命令行亦不可读。结论仍为 **SECURITY_UNAVAILABLE**，没有忽略该进程或启用 SeDebugPrivilege。[进程映像读取权限](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-queryfullprocessimagenamew)

正式任务 `TongLoginRuntime` 只读核对：原 XML SHA256 `925671f84b50311377cdb2585eeadf3f87548e7de0124d786729321a0694a4f3`，IgnoreNew、当前交互用户、非提升、Host 路径正确；检查时 Enabled/Ready、0 instances、LastTaskResult=1，未发现生产 Host/runner。前后 XML 摘要相同。该结果不是长期健康证明。

隔离新任务已经真实注册并启动原版编译 Host；PS5.1 在运行探针 runner 前以未签名 UnauthorizedAccess 退出，任务结果 1。独立 command-only 只读任务证实实际策略为 **CurrentUser RemoteSigned**，并非 AllSigned；32/64 位直接检查一致。PS5.1 对探针及生产 runner 文件 URL 的 Zone 判断为 Internet；没有 Zone.Identifier，runner NotSigned，CurrentUser\My 未找到代码签名证书。Zone 结果与签名拒绝一致；区域映射为何如此尚未定位，不能把它解释成历史 MONITOR_FAILED 原因。没有更改执行策略、文件来源标记、信任库或改用命令内联运行被拒绝的 runner。[PowerShell 执行策略与区域验证](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies?view=powershell-5.1)

两个隔离任务均已 Disabled/0 instances，保留原定义和失败证据。这个探针只验证 Task/Host 平台链路，正式 runner 的任务接管、IgnoreNew 重入、Host/runner 实际父子绑定、正常退出和再次接管均**尚未通过**。原有直接隔离 runner 的健康结果不替代它。90e3bc8 的 complete 还要求 runner 父 PID 为维护 controller，正式 runner 父进程却是 Host，不能直接塞入同一个证明字段；需最小、独立验收的正式接管步骤后才能开放生产。

历史 `MONITOR_FAILED` 根因仍是 **UNKNOWN**。已知 runtimeStatus/runtimeDoctor 与 Supervisor 周期异常、完整 maintenance inventory 分属不同调用链，不能把 ngrok 库存失败当作唯一原因。

## 待复审的生产操作单：当前停在第 0 步

0. **停止条件**：正式监控签名/区域准入、提交阶段持久证明与真实接管/停止、提交阶段六边界崩溃验收、完整库存、生产独立回滚任何一项未具备，均不得开始。当前全部尚未闭合，生产入口保持 MAINTENANCE_NOT_READY；不删除这个判断，不把测试脚本放开为生产工具。
1. **复核与快照**：重新只读验证 024d5b0 App/Manager 全清单、上述双 pin/profile、事故 runId/记录、所有原生身份/Job/监听端口。原始备份另存到批准的 `D:\Tong\state\024-production-<窗口ID>`：全部源码/原生文件及移除清单、profile、双 pin、DPAPI 密文和授权索引、业务加密快照、run 控制记录、旧监控 Host/runner/XML/预算/日志及原 gate 文件身份。Flush、密封清单、摘要和独立恢复入口必须在第一项生产写入前完成；不输出凭据明文。保留历史 maintenance-transaction.json 等事故事务，另设新目录，禁止覆盖。
2. **ngrok 维护窗口**：如当前权限仍不足，由用户另行批准 Windows 原生服务控制。复核服务名 ngrok、LocalSystem、Auto、SCM 当前 PID 和配置摘要；保存服务原状态。用 `Stop-Service -Name ngrok`，30 秒界限内确认 SCM Stopped、旧 PID 已消失且完整库存可读；未知/重启/超时即停止，不用 kill PID 代替。恢复时 `Start-Service -Name ngrok`，核对 Running、新 PID、服务绑定、隧道和认证 MCP；恢复失败停止窗口并保留证据。该流程本轮未执行；SCM PID 绑定不能替代之前缺失的进程证明。
3. **监控停止及独占**：在明确授权后暂停现有任务触发，准确核对并受控停止旧 Host/runner 及其监控命令子进程，核对 task instances、CIM/native 身份、Job、预算状态。任务 GetInstances 可见范围受调用者权限限制，不能独自证明全局无 runner。由原 gate 文件句柄保持连续生命周期独占；任何未知均退出。不能只关计划任务就安装。
4. **安装修改清单**：仅按90e3bc8发布清单更新 `D:\Tong\app` 和 `D:\Tong\runtime\releases\manager` 的全部源码/原生文件，更新 `D:\Tong\runtime\profile.json`、`run\release-pin.json`、`run\manager-pin.json` 和精确候选的原生授权密文/索引；旧控制记录密封归档，不伪造 Launcher/Guardian 回执。旧 backup.freeze 持原身份原地保护，按经复审交接协议归档。正常运行另会生成 request/runtime/Guardian/Launcher/stop/监控预算及日志，应列入预先审核的写入范围。
5. **授权**：通过 `TongProductionApproval.ps1 -Mode approve -ProfileJson <精确非秘密profile JSON> -Action <动作>` 的本机可见原生挑战，由用户亲自完成；动作按实际需要限于 backup、restore、manager、start、stop、AgentDock启用状态，以及单独 approve-login-recovery。App/Manager 配置分别绑定，CurrentUser/SID、root、source/release digest、期限必须匹配。不得代填挑战或用聊天文本替代。Host/runner 采用经认可的签名产物及独立摘要绑定；若需新增证书信任或区域设置，那是新增权限范围，必须另行决策，不在本恢复授权内。
6. **启动与单 runner 接管**：安装版本自身 Manager 启动，分别验证 App/Manager、ready、Guardian/Supervisor/子进程真实身份和嵌套 Job、doctor。按经过新增原生验收的顺序退出临时监控，确认其及监控命令子树消失后再启动唯一正式任务，核对 Task实例→Host→runner 的真实父子身份、摘要、初始及周期健康。IgnoreNew 防同任务重复；SID 操作 mutex 不是生命周期单 runner 保证，禁止同时用旧直启 runner 和新任务。健康服务的切换不得触发错误 stop/restart，预算不清零。
7. **MCP 验收**：本机浏览器由用户完成 Gateway OAuth/PKCE，认证会话只留内存；执行 initialize、notifications/initialized、tools/list，再以用户批准的临时目录验证文件读写。不得把 token/授权码写入日志。核对所需基础工具、doctor 和至少两个正常健康周期，按审核顺序正常 stop→start→Task接管；确认无异常 gate、无双 runner、无错误重启。原有90e3bc8 MCP 38工具成功是历史隔离证据，本轮未重复执行。
8. **故障与独立回滚**：安装未完成或启动失败时保持 gate，不继续启动。先准确核对/停止运行树及监控；无法确认就保留现场停止。损坏 gate 先密封原件、校验完整快照和文件身份，走受管冷恢复；已提交健康运行不自动回滚。然后新进程恢复完整024源码、原生文件、profile、双 pin、DPAPI授权和控制记录，逐项验哈希，再由旧版自身验证。当前 `Tong024ProductionMaintenance.mjs rollback --root D:\Tong\runtime --transaction-id <ID>` **只会拒绝 MAINTENANCE_NOT_READY，并非可用回滚命令**；现有 `resumeMaintenanceTransaction` 也仅支持隔离。一个经审查且与当前现场密封快照绑定的生产独立回滚入口仍是强制缺项，不能用 Git checkout 或本轮 gate-only CLI 替代。

若提交阶段不能安全自动接续，有限替代路线是：单独批准原生离线维护窗口，准确受控停止全部相关树及 ngrok，保存原件并验证全量快照，恢复完整024现场；解决正式 runner 准入后，复用90e3bc8连续 gate 启动一个新会话。该路线仍需受管生产适配器和独立回滚，不扩大成完整维护平台。

最终批准内容应明确：仅一次上述固定候选/固定现场恢复，影响列明的 App/Manager/runtime 文件与唯一监控任务；ngrok 服务 stop/start 另列。它属于既有恢复目标，但生产实施需新的明确批准。最坏结果是服务/隧道中断或部分安装，依靠事前密封快照及已验收的新进程完整回滚恢复。授权仅覆盖一个明确期限的维护窗口及约定失败恢复，不包含后续部署、ACL/策略/证书变更或其他候选。**当前不请求该批准，先交 ChatGPT 复审。**

## 本轮真实证据与未完成项

所有捕获退出码、时间、stdout/stderr 哈希、原始路径见 [本轮机器证据](evidence/024-final-readiness-20261025.json)，包括失败和已撤回草稿测试。主要原生证据根复用 `D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a`，没有重复复制依赖或完整源码。

- 冷恢复首轮完整正向退出0；最终定向边界退出0，session `d3bfe566-66b0-45b8-8ab1-1286777f224d`，独立 Node worker44944。两处 native helper 强杀后接续、8次封存写/rename拒绝、真实端口占用、授权过期、旧会话重放、截断回执拒绝，损坏字节和原 fileKey 保留。
- 直接原生生产/跨root拒绝及 JS 生产拒绝退出0；最终语法、未改原Handoff、完整release和隔离App/Manager复验退出0。
- Task/Host原生探针退出1；只读任务策略诊断退出0；ngrok探针退出0但身份结果为不可用；生产绑定/任务只读检查退出0。探针0表示检查执行完成，不表示生产健康。
- 中间失败保留：工具路径引号失败 -4058；旧API红测1/撤回草稿绿测0；冷恢复外来进程拒绝1、测试退出监听注册时序错误13、connect未知拒绝1；收紧库存后元数据未知拒绝1（原拒绝未保存PID，具体来源UNKNOWN）；一次最终检查与正在修改gate的边界测试重叠而读到31字节、退出1，改为顺序执行后退出0。没有放宽断言或把这些失败删除。

仍缺：正式Task/Host/runner原生正向准入及单runner接管；提交阶段六边界真实崩溃与独立存活树接管/停止及持久提交证明；生产完整库存的ngrok处理；精确当前现场可用的生产执行/独立完整回滚入口。**NOT READY，生产写入口继续关闭。** 本轮提交推送后停止，等待 ChatGPT 最终复审。
