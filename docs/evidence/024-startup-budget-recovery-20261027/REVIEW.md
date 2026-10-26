# 启动预算最小修复候选：开发与隔离验证

本轮没有安装生产、放行正式 Task 或写入真实状态。原版2号、安全停止、旧 gate 和恢复预算继续保留。本文的 READY、doctor、文件操作均为隔离验证，不能称为正式生产通信恢复。

## 三次生产超时的实际时间线

原始窗口为 `production-comm-402b8fd5-d82d-47eb-a0eb-8987b769f0a0`。已完整读取对应 Launcher/Guardian 回执、Manager/lifecycle、Guardian、Supervisor、runner/Host 日志、三轮存在的六类子进程流、失败快照和清理/回退资料。读取文件的路径、长度、SHA256 及三轮 **70 段**实际起止时间见 [TIMELINE.json](TIMELINE.json)。缺失的第一轮 Gateway 流明确标为 absent，没有以其他轮替代。Supervisor 专用 jsonl 没有这三轮记录，Supervisor 退出码使用 Guardian 原生观察，均为 1。

以下为 UTC 2026-10-26；日本时间加9小时。每轮总预算只计算一次，不把子阶段耗时当作总耗时。

| 阶段 | `97158a7a…` | `e5b69347…` | `a5108ab9…` |
|---|---|---|---|
| 总期限起点 | 13:50:37.219 | 13:53:25.100 | 13:56:13.499 |
| Launcher 预检 | 13:50:38.728→56.013，17.285s | 13:53:26.489→43.518，17.029s | 13:56:14.870→32.553，17.683s |
| Guardian 创建→首次预检后日志 | 13:50:56.035→13:51:14.472，18.437s | 13:53:43.539→13:54:01.593，18.054s | 13:56:32.570→51.503，18.933s |
| Guardian 编译/读取请求 | 13:51:14.472→14.680，0.208s | 13:54:01.593→01.817，0.224s | 13:56:51.503→51.726，0.223s |
| Guardian 第二次预检 | 13:51:14.680→31.789，17.109s | 13:54:01.817→18.647，16.830s | 13:56:51.726→13:57:09.476，17.750s |
| Job / Node 创建 | 13:51:31.789→31.870，0.081s | 13:54:18.647→18.757，0.110s | 13:57:09.476→09.618，0.142s |
| Node 创建→Supervisor start | 13:51:31.860→52.302，20.442s | 13:54:18.747→38.710，19.963s | 13:57:09.608→30.186，20.578s |
| AgentDock 创建及认证健康检查 | 13:51:52.302→55.987，3.685s | 13:54:38.710→42.759，4.049s | 13:57:30.186→33.545，3.359s |
| request→DevSpace readiness begin | **78.768s** | **77.659s** | **80.046s** |
| DevSpace 创建/恢复上下文→settings | 13:51:55.987→13:52:08.151，12.164s | 13:54:42.759→55.155，12.396s | 13:57:33.545→46.119，12.574s |
| DevSpace 授权校验 | 13:52:08.151→15.447，7.296s | 13:54:55.155→13:55:02.113，6.958s | 13:57:46.119→53.438，7.319s |
| DevSpace 双候选校验 | 13:52:15.447→23.938，8.491s | 13:55:02.113→09.656，7.543s | 13:57:53.438→13:58:01.043，7.605s |
| 配置/日志保护/Tong 工具导入 | 13:52:23.938→26.425，2.487s | 13:55:09.656→10.008，0.352s | 13:58:01.043→01.418，0.375s |
| DevSpace server 导入 | 13:52:26.425→37.231，10.806s 后被总期限截断 | 13:55:10.008→20.246，10.238s | 13:58:01.418→03.560，2.142s |
| 导入完成→OAuth/创建/listen/ready | 未到达 | 13:55:20.246→20.378，0.132s | 13:58:03.560→03.666，0.106s |
| Gateway 创建及就绪等待 | 未到达 | 13:55:20.379→25.107，**4.728s** 即耗尽总期限 | 13:58:03.667→13.506，**9.839s** 即耗尽总期限 |
| Manager 全局失败事件 | 13:52:37.263，120.044s | 13:55:25.139，120.039s | 13:58:13.522，120.023s |

前两轮 request 文件被后续请求覆盖；其总期限起点由 Manager `failure.at-durationMs` 还原。第三轮保留原 request。deadline 在 UUID/createdAt 采样之前生成，两者可能差1ms，不能声称派生起点就是已丢失的原 createdAt。原生 ticks 在表中截至毫秒，JSON 保留来源信息。`node_to_job_receipt` 与 Supervisor bootstrap 重叠，不能重复加总。

首个可消除的重复工作在 Guardian：生产根分支已执行 `preflight-login`，读取 request 后的恢复分支又执行同一个预检。两者之间没有创建运行 Job 或 Node，只增加约0.2秒的本机编译/读取；后一个回执覆盖了前一个。首个预检的单独 CPU/起止时间未知，18.054～18.933秒是初始化与该预检的合计，不能写成精确的17秒。第二次预检16.830～17.750秒有直接回执。本修复在第一次原生授权前绑定请求，在创建 Job 前重新核对 request/grant，只保留一次完整预检。

最长有直接边界的单段为 Supervisor bootstrap 19.963～20.578秒，包含恢复授权、布局、双候选/安全校验、secret 读取、身份与二进制检查；其内部细分尚未知。DevSpace 在开始 server 导入前还消耗27.249～30.438秒。没有证据支持删除这些跨进程检查或缓存授权，因此本轮保留它们。

只有后两轮导入有 CPU 指标：第二轮 import 内部墙钟10231ms，user1719ms/system484ms；第三轮2141ms，user1515ms/system531ms。墙钟与 CPU 的差8028/95ms属于未分类时间，不能据此归因为磁盘、Defender 或 OAuth 等待。其他阶段 CPU 和精确等待时间均 UNKNOWN。OAuth 构造是同步 createServer 的一部分，只能由导入完成至 readiness_complete 的132/106ms给出上界，不能单独量出；第一轮没有进入该段。Gateway 两轮在首个 settings IPC 前被全局期限截断，其内部细分也未知。

## 最小改动与期限协调

相对上一精确候选，仅 Runtime 与 Guardian 两个源码不同。相对原版2号仍为原七文件闭合依赖，**没有带入整个开发分支或改动 DevSpace 依赖/数据库代码**。

- Guardian 去除重复恢复预检，保留固定生产入口、根目录、RunId、grant 格式/匹配、原生授权、预检私有 Job 和创建运行 Job 前的请求复核。
- `startupProgress` 在 readiness_begin 立即记录新角色的 spawned，在完成时记录 ready，解决 Gateway 已创建而 Manager 仍报 DevSpace 的问题；slow 观察不刷新阶段起点。
- 默认生产及 production-simulation 的 request 总上限120→180秒；普通 synthetic 保持30秒，调用参数仍受1ms至对应最大值约束。总 deadline 在 request 创建附近生成一次并传递至 Launcher、Guardian、Supervisor、子就绪等待，进度不续期。
- DevSpace 75秒、Gateway 35秒、spawned30秒、导入30秒等阶段上限全部不变；Manager 清理30秒、原生清理期限、取消、身份/哈希校验、Job 包含证明及3次/30分钟恢复预算均未放宽。

依据不是把所有超时上限机械相加：实际生产在 DevSpace 前约80秒，去掉重复预检后仍约63秒；实测校验/导入慢路径下，隔离 request→READY 约130秒，原120秒确实不足。180秒还容纳两次约17秒的必要预检、约20.6秒 bootstrap、75/35秒子阶段及有限交接/健康检查余量。它是固定封顶值，不保证任意负载都能成功；卡死仍会在原30秒阶段期限失败。

Manager 只接受本次 runId、ready 且尚未过期的记录。旧 request/终态不能用于新启动或清理证明。既有 Supervisor 在最终 health/capture 后没有再次检查期限，极端情况下可晚写内部 READY；Manager 仍拒绝超期成功。本轮未改变这项既有行为，不能声称内部记录绝无晚到 READY。

## 隔离验证与证据范围

复用现有 `b23-login-70f1…`、`b23-login-c2db…`，没有复制新的完整依赖树、真实用户数据库或清空恢复预算。两根均为新进程独立启动、持久合成 OAuth 数据；Medium Host/Node 与 Medium 状态目录经原生快照核对。第二根还模拟生产 USERPROFILE/APPDATA/LOCALAPPDATA 的目录选择。真实 `C:\Users\Rune\.local\share\devspace` 的内容、锁竞争、磁盘缓存和外部负载没有复制，故不是生产等价性能保证。

每次原生预检执行真实授权与全部校验后，受原 deadline/abort 保护地补足至17秒，分别记录 validationElapsedMs/controlledWaitMs。慢根额外按生产观测补足 settings12.5秒、授权7.3秒、候选8.5秒、server import19秒；只改变测试副本并重新绑定合成 pin，生产候选中没有等待开关。所有版本差异和测试专用根重定位均保留。

| 完整原生 Task 轮次 | 实测 | 最终结果 |
|---|---|---|
| 独立根1正常启动 `10badad6…` | request→READY **78292ms**，Task→healthy130573ms；预检17027/17062ms | 独立 doctor、定期 doctor退出0、OAuth认证38工具、两条文件读取路径、创建/编辑/重读、目录、重连/refresh、越界及junction拒绝通过；正常Task退出0/Disabled；原身份消失、四Job0、完整库存无残留、Host/runner原件恢复 |
| 独立根2慢冷启动 `78cacdc6…` | request检查点→READY约**130.3s**，Task→healthy174303ms；预检17048/17107ms，DevSpace48334ms、Gateway29322ms | 同一原生链实际READY；初始request随后被恢复覆盖，保留checkpoint，不能把约数称为原request精确毫秒值 |
| 同根2异常恢复 `44e7a85e…` | 精确终止原Supervisor，由同一Runner恢复；request→READY **130098ms** | 仅消费一次预算，已有未过期条目保留；恢复后独立doctor与完整认证文件验收通过；正常Task退出0/Disabled、原身份消失、四Job0、完整库存无残留、原件恢复 |

关键原始隔离证据在两根最新 task-originals 目录内，包括 task-outcome、crash-recovery、communication、预算 before/after、devspace-access 及原生父子链身份。公开 [VALIDATION.json](VALIDATION.json) 仅包含审查所需的时间/结果元数据，不包含凭据或原始用户日志。

真实 IPC 故障测试在 CreateProcess 原子绑定的独立原生 Job 中运行：导入阶段卡死在30013ms拒绝，子提前退出保留退出码7，取消约1016ms生效；各 child close/IPC handler 清除、父进程退出0及 Job0 均核实。虚拟时钟测试覆盖全局/子/阶段期限、重复/倒序进度不续期、超期ready拒绝、spawn失败、观察/abort/日志失败、丢失或错轮回执、错误身份与清理不能证明时保留锁。相同 readiness/budget/progress 实现与精确候选逐字比较，未用工作区差异冒充候选验证。

完整 Manager→Launcher 原生短期限探针也通过：4000ms共享总期限触发后，Launcher4129ms关闭，Manager保留原始START_TIMEOUT，原生端按abort终止；预检取消时Launcher1432ms关闭，原生START_ABORT保留。包含前置授权/校验和清理观察的整项墙钟分别37789/34908ms，不能误标为4000ms预算失效。两项均有终态负回执、原身份消失、四Job0和完整库存证明，Runner恢复预算文件逐字节不变。只读库存使用已有开发观察器，未把后来的维护库存功能加入精确候选。

最初正常Task已READY/doctor/正常退出0，但文件验收被旧候选的profile/pin留存基线拒绝，整轮未记为通过。新候选采用独立版本基线，四项旧配置/加密凭据先与原基线核对，旧记录保留。一个慢夹具把等待放在导入完成后，已受控取消，未让Runner重试；修正后通过上表慢路径。原生故障夹具曾误把Windows的`[null,SIGTERM]`判成未退出；修正并保存诊断后复验。4秒探针还揭示deadline/createdAt的1ms采样差，校验改为原始预算事件、同一绝对期限及不延长的上界，未增加生产期限。

## 精确候选与未来变更边界

候选为 `b9fe80150f9cdea47130e8952e85e39503187677`，源自上一候选 `3740082…`；七文件的 LF 源码和实际 CRLF 打包哈希见 [CANDIDATE-MANIFEST.json](CANDIDATE-MANIFEST.json)，两文件增量见 [candidate-vs-previous.patch](candidate-vs-previous.patch)。source.tar SHA256 `c1bc5c18e5a91193a8d634c14a82cc2e56675c5db28e28de252e70c0d6593888`，release-manifest SHA256 `1f3cfcfd6f12212e1c9eb82e5de93c889dd52d82a16bbeba26cde1f365551015`；284项源码、23项原生资产，App/Manager共614项。实际打包字节是发布绑定依据，不能用LF diff哈希替代。

独立只读复核未发现新增的重要/严重问题；保留上述既有晚写内部READY限制。没有重做EPERM修复、构建Host、修改生产权限或维护平台。新发布包只生成一次，测试只新增小型归档/源码原件/日志；沿用已有原生资产及备份，未清理任何旧证据。

最终只读复验：原版2号612项源码/原生文件、profile/双pin、旧Host哈希与Low标签、17项留存DACL全部匹配；正式Task定义与窗口前相同、Disabled/0、LastResult1，7676/7677/18765无监听，旧空gate存在，ngrok仍为原PID40764运行。真实DB122880、WAL16512、SHM32768字节，三者哈希与本轮开始时一致，状态目录DACL及隐含Medium标签未变。未打开SQLite连接或作checkpoint，不以这些文件哈希证明逻辑OAuth数据全量一致。新候选完整包17176813字节，其余为小型源码归档、物理原件和日志；没有新增完整依赖副本。

若后续批准生产窗口，具体变更仍需新的明确授权：在开始后60分钟内，仅安装此修正七文件到指定App/Manager、更新profile/双pin和版本授权绑定，复用已验证PS7 Host并仅调整最终Host到Medium、原报告八处精确App DACL；受控保存旧控制记录，最多一次正式Task.Run及现有3次/30分钟恢复，不重置预算。版本绑定原生挑战由用户本人可见输入。恢复授权若启用，按既有机制保持至撤销或换版；本轮没有为生产启用它。

失败必须先核实本次Launcher/Guardian/Supervisor及后代原身份消失、四Job0、端口和Task停止，再保存事故现场并恢复旧物理源码/绑定/Host/DACL/控制和gate。沿用原备份，不覆盖真实DB/OAuth/WAL/SHM、不改ngrok/系统策略、不重启Windows。身份、哈希、权限或清理不一致时保持安全停止。最坏结果是再次无法启动并回到当前原版2号安全停机状态，不能保证旧版立即通信。

本轮尚未执行该生产变更；正式生产READY、doctor/定期监控、正式认证文件读写和ChatGPT网页真实读取仍待未来窗口实际验收。
