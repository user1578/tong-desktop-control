# Tong 024 阻塞收敛交付（2026-10-25）

**NOT READY：正式监控的隔离启动阻塞已解决，生产单次执行与独立完整回滚入口仍不可用。** 本轮不申请生产执行授权；提交推送后停止，等待 ChatGPT 复审。接手工具提交 `a7c1aca74d13fbd8ece801deb9b0adcd237e495d`，分支 `codex/024-maintenance-adapter-20261024`。没有修改生产 runtime/App、服务、任务、ACL、策略、信任库、安全标记、凭据或事故记录。

## 精确版本与最小修改

用户本轮明确允许以 90e3bc8 为父生成端口探测最小候选。产品候选 **`24431b263ab1bc6ec17cca48f82245f72f197d4c`**，唯一父提交 `90e3bc872989e63a6efe5bcef214e0489d54e052`；仅三个产品文件：Runtime 的 `unused`、新增 `TongRuntimePort.mjs/.ps1`。其余启动交接协议逐字节不变。开发 HEAD 含历史维护系统，仍不可作为产品发布树。

| 绑定 | 值 |
| --- | --- |
| 生产基线 | `024d5b0920d9ad8f1a2baf2e55640a5666ad4739` |
| 新候选 release | `D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\port-release-24431b2` |
| releaseDigest | `1f6df39f5f0cfa3b4efb00c2954c5482058f4741ff511df3f2a8a5d9a7d28e33` |
| sourceDigest | `edd525ba16f0ec170bdbe88c06cf8b21b439159c79ac5f1a0eb8469c41fb73ec` |
| 完整内容 | 303 源码项、23 原生项；Node 24.15.0 / ABI 137 |
| 独立部署的开发 Host SHA256 | `11aff7b3c03d449cc8a2729fd84d273dbdac9323aeb4da2c39cba4db22ebecfb` |
| 候选原版 runner SHA256 | `2a32d46a7307f088a827e06dbe81d85ee35ab2153e19cc85f3f69778c642684b` |

端口探测采用 Windows 监听表加 `SO_EXCLUSIVEADDRUSE`，不再以 1 秒 TCP 连接超时推断空闲，也不连接占用服务。失败保持拒绝；没有增加启动总预算。最终原生测试：实际占用和 wildcard 占用均拒绝、服务未被连接；空闲探测总计 1285ms，独占 bind 为 3ms，**没有声称整个探测低于一秒**。旧“所有 Node 拒绝样本都超过一秒”的诊断断言未成立，已保留为撤回草稿，不能作为旧故障的确定归因。

## 正式 Task → Host → runner：已解决与证据限度

生产原 Host 固定 PS5.1 `-NoLogo -NoProfile -NonInteractive -File <runner> -Mode run`。真实任务策略为 CurrentUser RemoteSigned。原 runner 没有 Zone.Identifier，签名 NotSigned；URLMON 路径/URI 均返回 HRESULT 0、zone 3，PS5 CLR 同为 Internet。D: 是本机固定盘，HKCU/HKLM ProtocolDefaults 的 file 均为 3。已定位拒绝来自 legacy 区域判定；**没有把某一个注册表值断言为全部区域映射的唯一根因**。

开发 Host 改用已安装且签名 Valid 的 PS7 7.6.6，保持 `-File`、无策略覆盖。PS7 对该无 ADS 本地文件判为 MyComputer；其实现优先尊重 Zone.Identifier，再判断本地磁盘。新建 Internet 标记的恶意探针仍被真实任务拒绝，原标记不变。参见 [PowerShell 实现](https://raw.githubusercontent.com/PowerShell/PowerShell/master/src/System.Management.Automation/utils/ClrFacade.cs) 与 [执行策略文档](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies/)；未更改策略、证书或文件区域。

越过签名拒绝后，真实任务仍曾返回 CLEANUP_REQUIRED。已沿 `guardianComplete → oldRuntimeGone → runtimeJobState → PS5 Add-Type` 定位：该任务无法在用户全局 Temp 创建编译临时文件。Task 内直接原生 OpenJobObject 得到 ERROR_FILE_NOT_FOUND=2；helper 的 SECURITY_UNAVAILABLE 不能当作 Job 非空或清理完成。Host 现在只为其子进程指定相邻 `temp` 的 TEMP/TMP，未改全局环境和 ACL。该修复后真实任务完成启动。

最终原生演练 `converge-formal-monitor-restart-20261025` 退出 **0**，使用候选原版 runner，仅替换隔离 root 与隔离 SID mutex 名称，没有注入健康事件或布尔结果：

- 真实 Task EnginePID → Host → PS7 runner 父子身份；重复 Run 仍只有同一个实例。
- 初始 `runtime_healthy`；观察到真实周期 doctor 子进程并按句柄验证 exe/startTicks 与退出 0；另外执行真实 doctor，返回 `healthy:true`，后续 MCP 仍读到同一 runId。**没有读取该周期子进程的 stdout，不能声称退出 0 本身代表健康。** 测试代码最后额外收紧 doctor 后的 runId/Supervisor 复核及双周期布尔括号，完成语法/表达式验证，没有再重复双周期原生矩阵。
- Gateway OAuth/PKCE、MCP initialize、tools/list，38 个工具。
- 原成功运行 `e8b0e1fb-26d0-4eed-a408-ccf5f66f61a1` 经独立进程 stop-run 正常停止；最终任务重新启动为 `f3589f4f-306f-4188-a37f-b3b15ba3325d`，再次健康/MCP，通过后正常停止，Task 退出 0。
- 最后一次运行 `-Cycles 1`，结合前一实际运行和独立停止证明重启；**不是宣称整段双周期脚本一次通过**。原失败是测试误用 `stop` 授权动作，已改成合法 `stop-run`，失败证据保留。恢复预算未清零。
- 最终所有隔离任务 Disabled/0 instances，已停树的所有记录身份消失、Job 为零、无残留 freeze。没有修改真实生产任务。

独立只读审查提出的 doctor 假阳性、PID 复用及 PowerShell 布尔优先级问题均已修正。Host 是独立开发运维产物，不属于上述最小产品候选；未来生产安装须单独绑定该 Host 摘要及相邻 temp 写入范围。

## 安装、连续拒绝与独立完整回滚

没有重跑完整 f182e55 矩阵。复用两个既有隔离根和依赖；新增候选构建、正式任务和两个安装异常场景。协议文件与 90e3bc8 完全一致，原多进程 wx/伪造 handoff 拒绝证据仍适用；本轮没有声称重跑了所有竞争边界。

真实完整候选安装在同一原生 gate 句柄持有期间完成，快照 667 项；随后交还原零字节 gate，普通 wx 入口仍因文件存在拒绝。024 集成测试复用既有安装器、原生 Handoff 与独立恢复器：

| 本轮场景 | 实际结果 |
| --- | --- |
| 实际端口占用导致候选启动失败 | 原生 Manager 退出 1、Job active=0、无 request；独立恢复完整024版本，随后新进程再次校验并完成 DPAPI 恢复暂存，退出0 |
| 完整安装后退出安装进程 | 安装器在 starting 检查点真实退出71；原 gate 保留；未通过缩短窗口或删除 freeze 放行 |
| 真实候选 ready 后控制进程异常退出 | 原生控制进程被终止（SIGTERM，code=null）；独立确认 owner 消失、原生树和 Job 为空，恢复原 gate；独立 Node PID48832 完整恢复639项并验证哈希，退出0 |
| 独立回滚绑定 | transaction `30486297-9ad3-4f1b-ba91-9ee1f0cf83df`；snapshot seal `0685462d3a33844fc825e51aa448b53b943ddfdf1a942de6db7a878a3d4f4643` |

639项包括完整源码、原生文件、profile、双pin、DPAPI授权与控制记录，恢复器逐项验证摘要、候选新增文件缺席以及旧版授权绑定。业务 DPAPI 备份解密到独立新目录并验证，**这是业务状态暂存，不是原路径业务数据覆盖验收**。完整控制证据目录：`D:\Tong\state\b23-maint-native-9b317b949460486f92ac4c2002304bf5\024-handoff-crash-evidence-24431b2-af56be52-da6a-47db-8f7c-27252c0a9ca0`。

这些仍是原生隔离测试编排，**没有因此得到可用生产执行器**。把原 ALS 安装器和原生 Handoff 接成新适配器的未验收草稿已撤回并保留 patch，不接入交付，不更改事故事务文件写入规则。

## 仍需停止的具体边界

1. **commit-intent/disarmed 冷停止未交付**。现有 gate-only 冷恢复仅在真实全部静默后可用，拒绝活树和已提交 completed 现场；不会把活进程判作清理完成。但原生 disarm 前后、归档前后进程退出后的受控冷停止与完整独立接续仍没有本轮证据。不能让普通 stop-run 跨过现存 freeze，也不能自动回滚已提交健康运行。生产维护须先具备受审的离线停止/恢复步骤，否则停在原件封存；不继续开发复杂在线接管。
2. **完整生产入口仍关闭**。`Tong024ProductionMaintenance.mjs run/rollback --root D:\Tong\runtime --error-json` 实际均退出1、MAINTENANCE_NOT_READY；前后 profile/gate/双pin摘要一致。旧适配器仍绑定34e2680及旧编排，不能换个候选常量或删除判断后使用。尚缺精确工具提交与24431发布、当前生产密封快照绑定、独立完整回滚的新进程入口；因此没有可直接批准的正向生产命令。Git checkout 和 gate-only 工具都不能替代它。
3. **ngrok 生产完整库存仍不可用**。07:01 UTC 只读 SCM 前后稳定 PID40452、Running/Auto/LocalSystem；OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION) 返回5，exe/startTicks/命令行不可读，仍 SECURITY_UNAVAILABLE。未扩大权限。历史 MONITOR_FAILED 根因仍 UNKNOWN，与上述库存、区域和隔离 Temp 失败分别记录。

## 留待人工批准的单次操作范围（本轮不执行）

完整生产操作单仍以[既有操作单](Tong024FinalReadiness.md)为基础，但其候选字段应在复审通过后绑定24431及上表摘要；不把旧命令视为可用。本轮只收敛以下准备：

- 固定一个维护窗口、工具提交、24431发布与原024现场。先只读核验 App/Manager、profile、双pin、旧run/Guardian/Launcher、Job/监听、原freeze身份及事故文件；第一项生产写入前密封完整源码/原生/profile/pin/DPAPI/控制记录、监控Host/runner/XML/预算和业务加密快照。事故事务原件不得被新运行覆盖。
- 用户本机亲自完成 CurrentUser DPAPI 的 backup/restore/manager/start/stop、AgentDock状态及 approve-login-recovery 挑战，精确绑定 App/Manager digest、SID/root/期限；聊天批准不替代挑战。
- **ngrok 单独批准**：仅在该维护窗口由有服务控制权限的操作员 `Stop-Service -Name ngrok`；30秒内确认 SCM Stopped、旧身份消失、完整库存可读，否则停止。结束时 `Start-Service -Name ngrok`，确认 Running、服务/PID/隧道绑定及公网 OAuth 后 MCP initialize/tools/list。不能 kill 不可读 PID、改服务账户/权限或把 SCM PID 单独当进程证明。本轮均未执行。
- 准确停止并核对旧监控和所有相关树/Job，持续保护原 gate。若 commit 状态不明或仍有活树，保留现场，交人工冷维护处理；未有可审冷停止工具前不得继续。若不能在现权限下安全冷停止，可另行批准关闭任务触发、保存现场后进行离线重启维护；重启后仍须重新证明静默、核对 completed 证据与快照，不能直接认定可回滚。该路线影响整机，超出本轮授权，未实施。
- 未来允许写入的文件仅为发布清单内 `D:\Tong\app`、`D:\Tong\runtime\releases\manager`、profile/双pin/精确授权、经审监控Host/runner/相邻temp、该次控制与日志记录；安装自身 Manager 验证 App/Manager、ready、doctor、认证 MCP、本机临时文件读写，按已验收方式正常停止后由唯一 Task 接管。旧直接 runner 必须先退出，预算不能清零。
- 安装中断/启动失败保持 gate 并停止；未知身份、库存、授权、seal/hash、Job、提交证据任一不明确就拒绝。已提交健康运行需单独明确停止/回滚决定。**生产完整回滚命令尚不可用**，补齐并验收之前不得批准安装。

这些生产动作属于原恢复目标的实施阶段，仍需新的明确授权；仅覆盖一个约定期限窗口及失败恢复，最坏是服务/隧道中断和部分安装，须靠事前密封快照及已验收的独立完整回滚恢复。不包含后续部署、策略/ACL/证书变更或其他候选。当前停止于复审，不请求生产批准。

## 所有本轮退出码与失败保留

所有 `converge-*` 实际捕获退出码、原始路径、时间和输出摘要见[机器证据](evidence/024-convergence-20261025.json)。关键最终检查、Host策略负测、端口原生探测、任务重接管、控制崩溃独立024回滚均为0；原生安装中断71及被终止控制进程的 null/SIGTERM 均按原样记录。

失败没有改写为成功：首版候选 `34f0acb681f298d4b2e05b856fc83af0c7e6a0eb` 错误删除了相邻 freeze 函数，已拒绝，**不得发布**；独立恢复90后才安装24431。另保留 Win32 wildcard 下 Node bind 假成功、未成立的全部样本超时断言、Host策略错误文本断言、误用生产DACL检查模拟授权容器、旧恢复目录冲突、诊断父命令行被库存识别、测试stop动作名错误等失败。一次 Start-Process 启动探针被中止，无 result.json，不补造退出码。

结论：本轮结束维护架构扩展；正式监控及新最小候选的基础MCP已形成原生证据，完整生产执行/冷停止/独立回滚入口和ngrok维护窗口仍是明确缺项。**NOT READY，禁止生产恢复。**
