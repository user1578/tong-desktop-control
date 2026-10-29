# 生产升级、最终清理与目录归并交接（2026-10-28）

## 2026-10-30 01:16 JST：网页ChatGPT接手剩余9套持久清理（最新）

- 用户已刷新Tong插件连接；新`tong_disk_cleanup_run`、`tong_disk_cleanup_job`均在网页会话可调用。正式生产独立核对App/Manager双pin均`f81d1d0ddcc6da354cb475be628e6b79ca822516`，原run `1f5c6443-b05f-4459-a559-2b17e27f0015` READY，Task Running、唯一Host、端口7676/7677/18765均存在。持久授权`tong-state-cleanup`范围和revision未变。
- 首套已完成任务`a723c80a-b1e1-4467-a6d1-949b73a0a8ef`正式回执：`d780561/node_modules`删除36,323文件、592,590,773字节，保留735受保护项。独立元数据核验匹配release、候选内`AGENTS.md`仍在，任务记录D盘空闲从122,497,609,728增加到123,132,186,624字节（期间净增，不将全部增量归因于任务）。
- 剩余9项原有持久批任务ID `69e8a4f6-ac31-4bf2-906c-e641177c1a87`（idempotencyKey=`batch-20261029`）。**严禁重新发起同目标新清理任务或绕过受管删除接口**。第一个`024d5b0/node_modules`返回`CLEANUP_RUNTIME_REFERENCE_OR_UNKNOWN`已安全跳过。恢复原任务后第二个`0a2da3c/node_modules`正式完成：删除36,323文件、592,590,575逻辑字节；候选根`AGENTS.md`和匹配release仍在，保留735项保护内容。两套总删除**72,646文件、1,185,181,348逻辑字节（约1.10GiB）**。
- 批任务继续到第三个`1a78e48/node_modules`时worker出现`CLEANUP_WORKER_INTERRUPTED`，先后两次被状态接口检测死亡，第二次恢复后仅核验113文件便再次中断；**本项未删除、进度需以持久记录为准**。该批任务目前`status=blocked`、`recoverable=true`、`index=2`、`workerAlive=false`，最后worker PID 32728。不能无限重复`resume`导致反复从头扫描。应先查本机spawn/worker进程退出原因、异常记录、子进程生命周期/Job对象、原子状态更新遗留.tmp；保持正式Gateway/生产，不清理事故取证。
- 曾一次网页工具通信返回`McpServerError: Session terminated`，随后同一jobId可继续查询并证明原worker仍执行；不能把网页连接终止直接等同于worker终止。持久任务源码`scripts/TongCleanupJobs.mjs`使用`spawn(process.execPath,[...,'--worker'])`及`detached:true`、`stdio:'ignore'`，当前没有可靠worker退出原因与stderr；新增诊断应最小化且不记录敏感内容。Windows Application事件的最近错误查询未返回对应项，不足以证明没有崩溃。
- 后续：先修复稳定的持久worker生命周期/退出码审计，隔离测试跨请求/多个候选连续运行、跨服务重启恢复，然后继续**同一个**批任务，逐套保存真实删除回执、检查AGENTS.md/release/staged、D盘空闲、生产健康；`024d5b0`被拒应单独定向复核引用，不绕过。未完成任务不是成功完成；正式生产变更仍按版本pin/回退门禁走。


## 2026-10-30 JST 最新：0bfae12正式升级已完成，首次大任务安全拒绝，修正已通过实物只读验证

**接手直接使用：**修正代码 `f81d1d0ddcc6da354cb475be628e6b79ca822516` 已推送，release/candidate-f81d1d0核验与正式Preflight通过；当前0bfae12回退快照为`quick-trust-full-cutover-20261029150746835-47dc17a5`（双端各575源码）。本人双击此新快照内 `Open-Upgrade-Confirmation.cmd` 完成本机门禁；不要重跑旧5de2371基线入口。新窗口完成后核实回执和正式健康，再从正式MCP resume任务`a723c80a-b1e1-4467-a6d1-949b73a0a8ef`，不是start重复幂等键。已有正式Gateway认证验收脚本在首轮快照`quick-trust-full-cutover-20261029142731706-9cc921a1/Mcp-Cleanup-Acceptance.mjs`，`resume-first`模式已绑定f81d1d0并调用真实MCP resume；它只在内存处理认证，不输出或存储Owner/Token。真实回执`mcp-autonomous-cleanup-acceptance.json`也在首轮快照，现只有首次blocked证据；job-started原始控制台记录的启动耗时1380ms，不把旧脚本误标的整项时长当启动耗时。当前新品尚待此新门禁，依赖删除仍0字节。

本人完成修复后的本机确认窗口；正式双pin为0bfae12，run `ed658092-4b3d-43de-bf04-5d0f97f42035` READY、唯一Host27576、原许可revision未变。正式认证Gateway实测42工具；新run在1,380ms返回真实job `a723c80a-b1e1-4467-a6d1-949b73a0a8ef`，扫描后因`build/Release`误分类在归档阶段拒绝，新增实际删除0。开发修正保留所有硬保护，仅允许已证明第三方依赖中的常规Release/runtime目录；真实全量只读核验36,323文件/592,590,773字节通过（438.736秒），并移除原生Read已覆盖的重复元数据读取。独立复核未见新增阻塞，修正尚须新版本绑定，不直接热改生产。准确说明见[任务书第七节](Tong-Autonomous-Disk-Cleanup-Taskbook-20261029.md#七2026-10-2930-本轮开发记录0bfae12已部署首次实删被保护规则拒绝)。下方首轮准备状态是历史，不要重跑旧5de2371基线入口。

## 2026-10-29 自主清理代码已实现，生产与实删仍待正式门禁

**当前准确发布绑定：**代码 `0bfae1251e661e48fb68ad4b5753a4e32f915091` 已推送；`quick-trust-release-0bfae12` / `quick-trust-candidate-0bfae12` 已验证；回退快照 `quick-trust-full-cutover-20261029142731706-9cc921a1` 绑定当前5de2371。归档正式包装器Preflight实测通过，旧run `7b02c3f4-f393-4575-b3b5-078ce5cb592c` 健康。本人从资源管理器双击快照内 `Open-Upgrade-Confirmation.cmd` 完成本机挑战后，先查 `native-window-result.json`、双pin、健康与原清理许可；此文件/窗口本身不等于批准或部署成功。再从正式MCP对d780561/node_modules启动新run/job，核对单套实际删除、保护项、配对release和空闲变化，之后才处理其它9套。当前尚未打开正式确认窗口，新增主体实际删除0字节。

**启动器修正：**本人首次双击仅闪退，未生成本机窗口回执。原生确认PS1解析正常；CMD改为ASCII/CRLF，在原控制台同步调用PS7、保留退出码和pause，取消分离的start子窗口。相同入口 `--check` 只读检测实测输出7.6.6与CONFIRMATION_PARSE_OK；不改执行策略，不执行Deploy。需重新双击同一入口，保留实际窗口报错或批准结果；本次修正未改变发布绑定、清理许可或生产代码。

本轮在指定维护分支实现持久选择性清理 worker、run/job MCP、精确普通路径与硬保护、原生句柄及中断恢复；不再要求整套候选父目录消失，也不重新审批安全缓存。指定d780561依赖的早期只读核验已完成（188.378秒，选中589,390,384字节），没有复制依赖。源码和隔离实删通过不能代替生产验收：**当前生产仍5de2371，十套主体本轮新增实际删除0字节**。详细实现与未完成项见[新任务书第七节](Tong-Autonomous-Disk-Cleanup-Taskbook-20261029.md#七2026-10-29-本轮开发记录未部署未完成实际大目录清理验收)。不得按下文旧“整套删除”流程清掉Agent文件；正式切换后先对d780561/node_modules用新run/job验收，再逐套处理其余9项。

> **2026-10-29用户更正后的最终规则（最新）**：用户说“清理空间/清理缓存”就是清理已获准的安全临时文件；点名普通删除路径即可直接执行，**不重复询问、不扫描整个C/D盘、不反复创建批准窗口**。用户账户/登录状态、`AGENTS.md`、`agent.md`和Agent其它说明/配置、Git/数据库/独有文件、生产与事故材料**绝对保留**。历史候选本身带有这些文件，因此优先清各套约600MB的经证明重复`node_modules`等依赖子目录，保留受保护文件与父目录骨架，不要求整套父目录消失。完整规则、A/B/C分类、限时/持久worker和验收见[修订后的Tong通用清理任务书](Tong-Autonomous-Disk-Cleanup-Taskbook-20261029.md)。目前十套编译缓存实删5,310文件/13,199,400字节，约5.636GiB主体重复依赖仍待清理；新增通用能力尚未部署。旧章节保留为历史证据，不再以过去“必须整套目录删除”作为唯一业务验收。


## 2026-10-29 最终只读核对：十套编译缓存已全部受管删除，完整候选仍未删除（最新）

- 2026-10-29正式网页Tong MCP重新Plan→Execute，新增删除`024d5b0` 531文件/1,319,948字节、`4ebdbc3` 531文件/1,319,948字节、`d9983bb` 531文件/1,319,932字节；原先运行引用检查拒绝的三项在本次实时重验通过后才执行，均返回`status=deleted`，**没有放宽引用规则或绕过受管接口**。
- 连同本页既有7套，累计十套`temp/node-compile-cache`的正式删除回执为 **5,310文件、13,199,400逻辑字节（约12.59MiB）**。随后的`tong_scan_directory`针对十个父`temp`逐项返回0条目；持久许可仍可查询，唯一TongLoginHost PID42676，D盘当次空闲`123693494272`字节。这不等于十套约5.636GiB完整候选被删除：**整套删除0/10**。
- 定向只读性能检查：选`quick-trust-candidate-d780561/node_modules`实测约38,108文件/2,641目录/600,977,566逻辑字节；完整候选的正式MCP Plan两次曾超时。尝试在开发源码中并行路径/依赖校验，三项核心、Quick Trust及跨进程回归通过，但对真实单套候选的**只读性能测试仍在约118秒被超时终止**，没有取得Plan回执。**该性能补丁已从开发工作树撤回，未提交、未部署，测试合成临时夹具也已按精确路径清理**；不能据此声称整套可安全删除。
- **目前真实阻塞**：完整候选Plan必须核验约600MB/38k文件并在网页工具调用时限内生成计划；尚无可用计划，所以不得使用Execute或Shell直接删除候选。下一步应定向开发可恢复、可查询进度的**受管异步Plan**（或经过真实大候选性能验证的优化实现），保持授权revision、当前pin、链接、release完整性、差异拒绝、Execute重验与审计；测试证明单套完整候选Plan成功且可执行后再受控上线，继而逐套Plan→Execute。不得重复清除已经删除的十套缓存或重新扫描全盘。
- GitHub仓库的连接写入曾报403；本地此页与项目总交接页的更新需通过已有授权的本地Git分支提交、推送，勿覆盖无关未提交的`Tong-Five-Root-Consolidation-ChatGPT-Review-20261027.md`。


## 2026-10-29 正式MCP跨调用验收及历史缓存实删（最新）

生产升级控制台返回 exit code 0、持久许可未变。网页ChatGPT的**两个独立正式MCP调用**已对`quick-trust-candidate-d780561/temp/node-compile-cache`成功完成Plan→Execute（plan `277104e6-d6f4-467c-ac21-9dfbd90afdd4`，531文件/1,319,916字节），确认`5de2371`开发修复已在正式MCP发挥作用，不再出现原跨调用`CLEANUP_PLAN_EXPIRED`。当前查询仍见唯一Host PID42676、授权`tong-state-cleanup`登记有效，未通过受限命令接口独立读取升级后双pin/完整doctor，因此**不把这两项只读核对冒充完整生产验收**。

**实际成功删除7套候选中的精确`temp/node-compile-cache`（不是整个候选）：**

| suffix | files | logical bytes |
| --- | ---: | ---: |
| d780561 | 531 | 1,319,916 |
| 1a78e48 | 531 | 1,319,972 |
| 5362210 | 531 | 1,319,956 |
| 7d11382 | 531 | 1,319,940 |
| 376a328 | 531 | 1,319,956 |
| 37dc649 | 531 | 1,319,932 |
| 0a2da3c | 531 | 1,319,900 |
| **合计** | **3,717** | **9,239,572（约8.81MiB）** |

七项Execute均返回`status=deleted`，之后独立`tong_scan_directory`逐项检查`temp`均为0条目。其他三项未删：`024d5b0`、`4ebdbc3`在已授权Plan后的Execute重查报`CLEANUP_RUNTIME_REFERENCE_OR_UNKNOWN`；`d9983bb`在Plan阶段报相同错误。**没有绕过接口，也没有删除整套候选。**

**新阻塞：**对缓存已清的`d780561`和`1a78e48`分别执行完整候选`tong_disk_cleanup_plan`，均超过ChatGPT工具编排时间限制，未获得可用Plan ID，因而未调用Execute。完整候选（每套约600MB）的`verifyHistoric`逐文件归档/依赖校验需做定向性能诊断与可恢复的长任务Plan机制，不能直接省略哈希、引用或授权重查；避免原样反复调用超时Plan。10套候选历史合计约5.636GiB，**本次整个候选实际删除仍为0**。D盘批末`freeBytes=123692969984`，不把空闲增加全部归因于上述删除；配对release、staged、当前生产、事故证据均未被本轮主动删除。

**下一步：**先修大候选Plan的超时或提供持久长任务接口，再通过受管方式对完整候选逐项Plan→Execute并保留release。对三项被拒的缓存只做精确运行引用诊断，授权通过才再尝试；不要重扫五根、重删已清7项缓存或用Shell绕过。完成10套后按本MD原计划继续历史文件夹归类、重复依赖精简和Codex原生会话集成。原生`0xC0000409`稳定性问题仍单列跟踪。



本轮由 Codex Desktop 执行；不开发其他Provider、不改Codex调度、不搬外部项目、不删除十套大型候选。以下开发、测试、生产和删除状态分别记录。

## 2026-10-29：跨调用清理修复正式发布已准备（尚待本机批准）

用户要求“先修然后试一下”。开发分支已包含 `1233d8f` 的持久化清理计划修复及 `5de2371` 的交接文档。本轮**没有再次修改清理逻辑，也没有调用旧版正式MCP去删除历史缓存**；已直接走已有发布归档/快照门禁准备下一个固定版本。

- 正式生产只读核对：App/Manager 双pin仍为 `9850cc45abd812156d59d16808f20c97bdfdc035`，run `d20966d1-26ad-4854-a435-2ae135d1096a`、phase `ready`、Task Running、Host 1，独立健康监测最新样本healthy=true；持久 `tong-state-cleanup`许可及revision保持不变。未运行危险的故障注入。
- 新目标commit `5de2371614cf5987dcea68c37b3f9848537ea48a`，归档 `D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-release-5de2371` 已用原 `TongRuntimeRelease.buildRelease` 构建并自带verify通过，566源码/23 native/590归档条目。Git CMD可执行程序因有硬链接被发布器拒绝，改用安装中已有的单链接 `C:\Program Files\Git\bin\git.exe`；未放松安全校验。
- 增量 `quick-trust-candidate-5de2371` 从经过验证的release源码分阶段暂存。历史证据文件存在Windows长路径，使用 `\\?\` 扩展路径复制，随后逐项校验566源码、23 native和三份DevSpace补丁哈希；SDK只建立到既有共享开发依赖的junction，没有再安装整套node_modules。
- 新快照 `D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-full-cutover-20261029044748358-b9fdfe86`，保存当前 App/Manager 各565源码和既有pin/profile/Runner，状态 `snapshotted`。从**新候选内的正式归档包装器** `Invoke-TongQuickTrustFullProduction.ps1 -Mode Preflight` 已真实输出 `PRECHECK PASS`，新commit与旧 `9850cc4` 基线绑定通过，无生产改变。
- 正式本机确认入口已生成在上述快照内：`Open-Upgrade-Confirmation.cmd`（双击后在本人独立Windows控制台调用`Run-Approved-Upgrade.ps1`）；确认脚本PS7 parser通过。它固定新/旧提交、release/candidate/snapshot路径，先检查已有cleanup grant范围和revision，再按原正式 `-Mode Deploy` 走真实本机哈希挑战、升级或回退；不会重发许可、不会删除5.636GiB大候选，窗口结果记录 `native-window-result.json`。
- **本轮尚未启动正式批准窗口，生产没有升级，新增历史实际删除0字节。** 用户下一步自行从文件资源管理器双击上述cmd，完成本机哈希挑战并保留控制台回执；不得由Tong受管MCP子进程代替这个独立控制台，否则服务停机可能终止自己的升级控制器。
- 若回执为 `PRODUCTION-UPGRADE-OK`，下一次ChatGPT先核双pin到 `5de2371`、run/Task/Host/端口和监测稳定，再调用**两个独立正式MCP工具调用**对`D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-d780561\temp\node-compile-cache` 执行Plan→Execute：实时计划须 `deletionAuthorized=true` 且路径精确，成功后验证审计和目标不存在。如果此步仍返回PLAN_EXPIRED或健康异常，停止大候选清理并保留失败证据。
- 通过后依旧按本MD第4节10套名单先清候选内明确可重建缓存、再重新Plan候选整体并逐套Execute，配对release/staged/生产pin和事故证据原位保留；随后处理历史目录归类与Codex原生会话整合，不重扫258万文件。

## 0. 2026-10-29 执行交接：直接删除阻塞与修复（已完成开发阶段）

**结论：目前不是清理授权不足，而是现役MCP的跨调用Plan状态缺陷。开发补丁已提交和测试，尚未部署到正式生产；本轮10套历史候选实际删除0字节。** 不再用原生产版本反复试验Execute，也不绕过受管删除接口用Shell删除。

### 精确状态

- 当前正式App/Manager仍为`9850cc45abd812156d59d16808f20c97bdfdc035`（基于最近已验升级回执；重新部署前须由Codex核实双pin）；正式run最近为`d20966d1-26ad-4854-a435-2ae135d1096a`。2026-10-29本轮网页Tong只读调用确认唯一LoginHost PID41336、`tong_list_projects`返回12项目及现有持久清理许可，未重新运行生产doctor，不能借此宣称已根治`0xC0000409`。
- `tong-state-cleanup`持久授权仍有效，根为`D:\Tong\state`，类别仅cache、historical-candidate、quick-trust-candidate，revision `c4da4b91-5d4a-42ff-9877-70eadadc8629`。此前**正式Gateway同一连接**的69字节缓存Plan→Execute验收成功，这与网页ChatGPT**跨调用**失败不矛盾。
- 旧版`TongManagedCleanup.mjs`的`#plans=new Map()`只存当前server实例内存；网页工具先Plan再Execute可能落到不同实例，导致Plan创建后马上以`CLEANUP_PLAN_EXPIRED`拒绝。此轮在同一次ChatGPT编排内实测：`quick-trust-candidate-d780561\temp\node-compile-cache`Plan授权成功（531文件/2目录、1,319,916字节，planId `ba726b21-b712-417c-86ac-0757970aac87`），紧接的Execute立即报`CLEANUP_PLAN_EXPIRED`；目标未删。**不是用户等待太久，也不能通过延长TTL来根治。**
- 此前`quick-trust-candidate-5362210`曾报`CLEANUP_RUNTIME_REFERENCE_OR_UNKNOWN`；2026-10-29重新执行只读Windows引用检查，结果references=0、unknown=0、1条已批准受信COM任务警告，再调生产Plan得到`CLEANUP_UNARCHIVED_TEMP`。当前没有持续的引用阻塞证据，但执行前必须重新检查，不能自动忽略已知引用。
- 其他九套候选同样被非空`temp\node-compile-cache`挡住；缓存属可重建类别，先删精确缓存目录，再对整个候选重新Plan，不要直接放宽候选归档一致性要求。
- 前两批已删逻辑1,584,629,549字节，正式MCP另已成功删69字节；**本轮新增历史候选实际删除0，剩余第三批10套历史候选6,051,846,951字节（5.636GiB）**。不把预计释放当实际空闲空间增量。

### 开发修复与验收

- 修复commit **`1233d8f9c711cb510a862594dda1ec55d7d84043`**，branch `codex/024-maintenance-adapter-20261024`，已推送并与origin同步；**没有修改正式App/Manager、Task、pin、gate、授权或历史候选**。
- `scripts/TongManagedCleanup.mjs`现将一次性计划写入受控`stateDir/disk-cleanup-plans/<UUID>.json`，Execute通过同目录原子rename领取并消费，跨进程可读取，重放返回`CLEANUP_PLAN_NOT_FOUND`，真实过期才为`CLEANUP_PLAN_EXPIRED`。既有持久授权revision、目标快照、归档SHA、任务/进程引用、审计保持重验，不改删除类别。
- 新增`tests/Test-TongCleanupCrossClient.mjs`，两个**独立Node进程**分别调用Plan与Execute并验证实际夹具消失、审计两条和重放拒绝；此外`Test-TongManagedCleanup.mjs`、`Test-TongQuickTrustCleanup.mjs`、`Test-TongMcpMetadataTools.mjs`、`Test-TongMcpGateway.mjs`、Node语法检查全部通过。模拟夹具不是生产验收。
- 仅提交本任务的4个文件：清理器、两份测试、`docs/maintenance/Tong-Managed-Disk-Cleanup.md`；`docs/maintenance/Tong-Five-Root-Consolidation-ChatGPT-Review-20261027.md`是用户原有未提交修改，未碰也未暂存。

### 下一次直接执行顺序：不重新扫描、不重做旧测试

1. **部署一次修复：**Codex在本地基于`1233d8f`核对现役9850cc4、READY、Task、独立监控、无未知gate及现有回退快照；仅为新增修复重新构建并绑定正式release、candidate、回退快照，使用既有受控升级入口及用户本人真实本机哈希确认。不要覆盖旧release、篡改许可或绕过原切换门禁；失败立即停在回退验收。
2. **先验网页跨调用：**正式升级READY且40项MCP工具可见后，从ChatGPT网页的两个独立`tong_disk_cleanup_plan`和`tong_disk_cleanup_execute`调用开始，以`D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-d780561\temp\node-compile-cache`作为真实受管小缓存验收对象（历史测得531文件、1,319,916字节，重新Plan以实时值为准）；必须有`deletionAuthorized=true`及精确路径、审计`cleanup_begin/cleanup_deleted`、目标目录不存在、健康不退化才继续。**不要再让用户每批手动运行删除脚本。**
3. **第三批清理：**沿用本文件第4节10个精确候选清单。对各候选先用受管Plan清理其内部可重建`temp\node-compile-cache`（只处理存在且获批者），保留空temp可直接按受管候选清理流程处理；再重新对该候选Plan核实当下pin、完整release、依赖及引用，授权真才Execute。单项失败就标记跳过继续其他安全项，绝不Shell强删。
4. **批末核对：**逐条保存Plan/Execute回执、对象消失、配对release仍在、staged仍在、事故证据未动；核对审计、Host/Runner、Task、doctor只读健康、三个端口及D盘前后空闲差，逻辑大小与实际NTFS空间分别报告。
5. **进入下一阶段：**对其他大历史state根（`b23-switch`、`native-codex-acceptance`等）沿用旧容量索引做精确核查、重复依赖清理；四个旧独立根`D:\tong-codex-acceptance-20261010`、`D:\tong-desktop-control`、`D:\agentdock-poc-20261010`、`D:\tong-agentdock-local`先保护Git dirty/untracked、原生会话cwd、项目注册引用，再迁移到`D:\Tong`统一管理。随后打通ChatGPT—Codex Desktop原生可见/可续会话，解决真实使用问题，最后再接其他Agent。
6. **减少重复交接开销：**后续对话只须先读本节及第4/5/6节清单、核对生产版本/授权/工具目录；不用重扫五根258万文件，不重复创建600MB整套依赖，不重新读取前两批完整取证。

### 操作原则

用户已经明确同意积极清理经过审查的可重建重复依赖、历史候选和旧目录；**不需要为每个安全缓存重复征询**。真正的限制是当前生产代码未部署跨调用修复，及具体对象的受管计划和本机生产升级授权。禁止用开发工作区Shell、任意删除或停机操作绕过这些实际限制。保持当下正在运行的9850cc4，直到下一次受控升级入口具备完整回退。

## 1. 当前生产与升级通道

### 9850cc4正式上线，MCP小缓存删除验收通过（2026-10-29 11:46 JST，最新）

本人完成新版本本机哈希挑战后，04:30 JST控制台输出`PRODUCTION-UPGRADE-OK`；App/Manager均为`9850cc45abd812156d59d16808f20c97bdfdc035`，run `d20966d1-26ad-4854-a435-2ae135d1096a`。新快照`quick-trust-full-cutover-20261028191510376-62cbbcf1`的窗口回执为`ready-for-formal-mcp-cache-test`，原持久清理许可revision及69字节缓存均核对复用，没有重新授权、覆盖缓存或自动反复升级。安装后实际`verify-installed`再次核对App/Manager源码、补丁、pin/profile和Runner，通过。

**中途登录监测故障必须保留：**11:42 JST续验时虽然三端口、Gateway和Supervisor仍READY，但Host为0、Task Ready，独立监测healthy=false。实际日志表明04:51:43 JST Runner35216调用doctor遇原生退出`0xC0000409`（-1073740791、stdout为空），随后Runner退出；不是本次清理Plan/Execute造成。现有证据不能证明该原生崩溃根因已解决。当前直接doctor healthy=true后，沿用本机已颁发的恢复许可，仅启动一次既有TongLoginRuntime Task，11:44:35记录runtime_healthy；没有重启Supervisor、切换run、修改Task定义/许可/恢复预算或另做升级。

恢复后唯一Host **41336**、PS7 Runner **32844**，Task实例`f2e99c78-b12f-4c3e-9322-04f1e7d7fc0b`；使用归档包装器同一真实身份函数核验Task实例、Host真实路径、唯一子进程、PS7真实路径、完整参数和创建时间，通过。Supervisor20520、Guardian12764仍属于同一run。7676 Gateway/PID56100、7677 upstream/PID19452、18765 AgentDock/PID43456全部监听；gate不存在。

**11:45 JST正式MCP实际验收：**SDK通过正式Gateway7676的OAuth/PKCE认证连接执行，而非直接调用清理模块或Shell删除。tools/list实测40项，项目查询12项、cleanupScopes有效。`tong_disk_cleanup_plan`返回planId **`7be98004-b089-409f-9ce9-b4f75567f0cc`**，projectId `tong-state-cleanup`，目标`D:\Tong\state\cleanup-acceptance-20261028\npm-cache`，category=cache、deletionAuthorized=true、1文件/1目录/69字节；计划仅有已批准的受保护SYSTEM任务警告。客户端逐项核对后在同一连接调用`tong_disk_cleanup_execute`，返回`status=deleted`、files=1、logicalBytes=69。

删除后目标ENOENT、父目录仍存在；App runtime的`disk-cleanup-audit.jsonl`有相同planId的`cleanup_begin`和`cleanup_deleted`，路径、计数、原因及`referenceWarnings`完整一致。凭据脱敏回执保留在上述新快照的`mcp-cleanup-acceptance-20261029024507334.json`；没有将OAuth/Owner凭据写入回执或Git。授权状态复查仍enabled=true、revision `c4da4b91-5d4a-42ff-9877-70eadadc8629`，三种原有scope保持不变，持续到本人撤销。

删除后实际doctor healthy=true，AgentDock认证MCP工具7项、Tong discovery及未认证拒绝均通过；独立监测11:45:36、11:45:47 JST连续healthy=true、同run、HostCount1、Task Running、三端口及Gateway正常、checkErrors为空。`rollback-preflight`只读核验54f3072旧App/Manager各561源码和快照绑定，返回rollbackPrepared=true；**未执行实际生产回退**，既有隔离回退证据复用。以上仅证明观察窗口与本次小缓存验收通过，不能宣称原生崩溃已根治或长期稳定验收通过。

下一步交给ChatGPT处理大规模清理：先刷新Tong宿主工具目录（当前静态目录仍旧38项，服务新认证目录40项），再在新对话选Tong，按保留清单逐目录Plan核对后Execute。刷新入口及官方说明见后文。**十套5.636GiB历史候选及其他目录本轮未删除，也未重新扫描磁盘。**此处验收不自动批准新的删除对象；继续时先确认健康监测仍更新并审阅每个精确计划。

### 54f3072上线、持久许可与COM引用预检修复（历史）

本人完成本机确认后，App/Manager正式双pin为`54f307282dedd00a48d942154645e95a9f3d11a6`，run `b3529663-aaf3-4c35-89aa-fb84d5323685`。唯一Host PID9572，Task Running、7676/7677/18765、READY及doctor healthy=true已核验；独立监测持续更新，04:12 JST样本仍healthy=true、同run且无检查错误。旧e0eb933及更早失败快照完整保留。

受保护策略目录的持久清理许可已于2026-10-28T16:30:25.878Z正式启用，revision `c4da4b91-5d4a-42ff-9877-70eadadc8629`；projectId `tong-state-cleanup`、根`D:\Tong\state`、cache/historical-candidate/quick-trust-candidate三个范围。后续升级复用此许可，不重新颁发或扩大范围。测试目标`D:\Tong\state\cleanup-acceptance-20261028\npm-cache`已存在，只有一个69字节文件；不重建或覆盖。

正式Gateway认证SDK的tools/list返回40项，已含Plan/Execute；项目查询返回12项及有效cleanupScopes。实际Plan因`CLEANUP_REFERENCE_CHECK_FAILED`拒绝，未产生planId、未调用Execute、未删除缓存。原回执保留在54f3072快照的`mcp-cleanup-acceptance-20261028163355203.json`。根因是ScheduledTask COM-handler没有ExecAction的Execute字段，StrictMode导致整个引用检查失败。

修复按实际任务类型读取字段，并只读检查双视图HKLM/HKCU COM服务器、CodeBase、AppID服务、TreatAs和打包COM路径，不实例化COM。GetStagedPackagePathByFullName明确确认未staged的旧包记录不会遮蔽当前有效包；即便旧包仍保留已知绝对引用，仍拒删。读取/API失败、仅有旧包、未知非系统任务均保持拒绝。

用户明确批准受限规则：仅位于系统Microsoft\\Windows任务目录、以SYSTEM运行、任务定义及祖先不可被非SYSTEM/Administrators替换且无reparse的任务，其未解析COM实现可成为审计警告。所有已知路径引用仍拒删。实际只读检查得到references=0、unknown=0和一条`TRUSTED_SYSTEM_COM_UNRESOLVED`：`\Microsoft\Windows\BrokerInfrastructure\BgTaskRegistrationMaintenanceTask`，CLSID `{e984d939-0e00-4dd9-ac3a-7aca04745521}`。Plan展示警告，Execute重查并写入审计；此规则仍有系统处理程序间接依赖无法完整证明的已知限制。

新增PS7隔离测试覆盖COM字段/服务器/服务/打包路径、URI、先前读取失败后仍收集已知引用、SYSTEM/ACL/owner/reparse/祖先/遍历边界和枚举失败；引用证明协议测试及受管清理夹具测试通过。实际只读检查通过，没有重新运行旧部署/回退矩阵、扫描磁盘或触碰生产代码。仍须构建新commit绑定的release/候选/54f3072回退快照，正式Preflight及新本机哈希挑战后上线，再执行正式MCP小缓存验收。大规模候选仍未删除。

当前模型连接工具目录仍是旧38项，而新认证tools/list是40项，属于宿主目录未刷新。按[OpenAI连接说明](https://developers.openai.com/plugins/deploy/connect-chatgpt)在Tong连接详情Refresh，再用新对话选Tong验证；当前没有可调用的宿主Refresh API，未擅自卸载、重建连接或修改权限。既有项目查询认证正常，先刷新目录，只有连接要求重新认证时才重连。

修复commit **`9850cc45abd812156d59d16808f20c97bdfdc035`已推送**。新`quick-trust-release-9850cc4` build/verify通过（565源码、23 native）；`quick-trust-candidate-9850cc4`仅源码/三补丁/共享SDK，无依赖安装。新快照`quick-trust-full-cutover-20261028191510376-62cbbcf1`逐项保留54f3072旧App/Manager各561源码，并绑定新旧commit；04:16 JST归档包装器正式Preflight输出`PRECHECK PASS`，旧run健康且无生产修改。控制器SHA仍为`9379c38974dbf7aee9f6807e14f2d4a0dd6c191a7e06645a7df532b20d431749`，stopped probe仍为`544a545ce87c50a2e06c1dae5ad4329a69b2c28e71c1f0cd0265dd93d65367ac`，未改校验值。新本机启动器仅Deploy及核对既有许可/缓存，不调用grant-state，不创建缓存或删除目录。新版本仍待本人哈希确认，不把Preflight当成部署成功。

### 正式e0eb933已上线，清理授权存储修复准备（2026-10-29，最新）

2026-10-28 18:34 JST在用户完成真实本机哈希挑战后执行一次正式升级，控制台输出`PRODUCTION-UPGRADE-OK`。正式App/Manager双pin已一致为`e0eb933cec1b3cb88a4d34b19e3257228f39541e`；新run为`cd8d0e41-e961-44eb-b8b3-2ab31128b4b8`，18:41:15进入READY。归档控制器`verify-installed`确认完整源码/补丁/Runner/pin/profile一致；实际doctor healthy=true，认证AgentDock MCP及Tong discovery通过；唯一Host PID57820、Supervisor29972、Guardian45820和7676/7677/18765正常，gate已由正式机制释放。本次没有发生自动回退或反复升级。

独立监测PID47076连续运行，覆盖请求停机、安装、启动到恢复健康。维护停机约18:35–18:41 JST有预期不健康样本；随后Gateway端点恢复，2026-10-29 01:02 JST仍为同一新run健康，无检查错误。当前只声称已观察窗口，不扩展为重启/长期稳定验收。正式连接器项目查询实测返回12项并新增cleanupAuthorizationAvailable=true，尚无cleanupScopes。

整个维护窗口最终记`native-window-failed-or-cancelled`，准确原因是升级成功后`TongCleanupControl.mjs grant-state`在首次ACL检查报`ACL_DENIED`，没有进入真实本机清理确认。App元数据目录`D:\Tong\app\runtime`继承了开发沙盒写ACE，不适合保存递归删除许可。未改ACL、未跳过校验、未手工写入许可；小缓存也尚未创建/删除。原失败回执、快照和授权审计保留。

已准备最小源码修复：正式清理许可固定迁到已存在且通过安全校验的`D:\Tong\runtime\tong-policy\disk-cleanup-grants.json`；Control的锁、临时文件和授权审计也使用该策略目录，每次生产读取重新核对runtime、policy目录及许可文件ACL。开发/隔离夹具维持原有路径语义，MCP仍没有颁发许可入口，scope/revision/撤销规则不扩大。没有搬迁其他状态、改权限或迁移旧许可（尚不存在）。

新增只读`Test-TongCleanupProductionStore.mjs`先复现旧路径失败，再验证新目录ACL、status可读和开发入口不能grant，通过；没有重跑之前的隔离矩阵。独立静态审查未发现阻塞问题。该两文件修复尚须绑定新候选并由本人批准新的维护窗口，不能覆盖已安装e0eb933字节。新的生产基线应为e0eb933，旧b9fe801快照继续保留。

SDK验收已打通：按已部署DevSpace契约使用允许的loopback回调，并经同一正式Gateway的7676认证端点（不直连7677）；生产Owner凭据使用TongRuntimeServer同一只读loadDevspaceFiles流程，仅在进程内用于标准OAuth/PKCE，不输出、复制或修改原凭据。之前的公开网络UND_ERR_SOCKET、错误回调和误用simulation DPAPI路径的失败回执原样保留。

2026-10-29 01:11 JST正式认证tools/list实测返回38项，**清理工具实际缺失，并非宿主缓存**；项目查询返回12项且cleanupScopes为空。回执为已用e0eb933快照下`mcp-discovery-acceptance-20261028161112404.json`。根因是上游server.js的固定TONG_ALLOWED_TOOLS漏了两个清理工具，尽管注册模块和Gateway已支持。已补纯补丁变换仅添加Plan/Execute，原补丁SHA保留为previousHash15，新补丁真实输出SHA为`75cc461fd74af533629e87247520f5f82524351ccea9586fbd75d4dcae10703c`。新增注册测试先复现两工具被过滤，再验证真实guard允许清理工具、拒绝exec_command、重复应用幂等并匹配归档哈希；相应历史allowlist期望更新后通过。

`1079b1a`仅包含许可存储修复，已build/verify生成`quick-trust-release-1079b1a`，**不是最终上线候选**，没有创建其生产切换或覆盖原归档。两个增量修复均经独立静态审查无阻塞发现，最终commit **`54f307282dedd00a48d942154645e95a9f3d11a6`已推送**至当前codex分支。

最终release为同根`quick-trust-release-54f3072`，561源码/23 native，build/verify通过；暂存`quick-trust-candidate-54f3072`仅源码/3补丁/共享SDK。在新暂存内实际应用补丁，输出server.js SHA75cc461f…，没有改正式App或共享开发依赖。新回退快照`quick-trust-full-cutover-20261028161419921-ecccdfec`绑定54f3072/e0eb933，旧App/Manager各559源码/补丁/pin/profile/Runner核验通过。01:15 JST从最终归档包装器执行正式Preflight，输出旧run健康、候选验证通过且无生产变更。

01:16 JST新快照内`Run-Approved-Upgrade.ps1`已打开可见PS7窗口，初始PID58832，回执`awaiting-native-approvals`；只有本人完成新哈希挑战后才切换，失败回到e0eb933，旧b9fe801快照继续保留。MCP小缓存验收客户端也在同快照，已按正式OAuth/PKCE和7676 Gateway实际契约准备；使用同一连接执行Plan→Execute。此刻尚未颁发新许可或执行删除，不把待批准写成完成。

本次1079中间release、54最终release/暂存/e0回退快照共约62.34MiB（不含小型测试/SDK诊断回执），没有完整依赖复制或安装。历史大候选继续保留。

### 前一轮JSON修复与发布准备（历史）

### CLI单JSON协议故障续修（2026-10-28，最新）

2fcea75这次正式升级已经失败并自动回退，不能继续使用上一节历史的“等待授权”作为当前状态。快照`quick-trust-full-cutover-20261028042414441-0da1d9af`于13:38:20 JST进入`rolled-back-old-code`；13:42:41登录日志记录旧版run `9cdb151b-8250-4b65-bf41-02e306878b0b`健康。`native-window-result.json`仍记`native-window-failed-or-cancelled`，表示升级未成功，与回退成功不矛盾。失败快照、授权审计和已释放门禁的`upgrade-gate.json`回执全部保留。

17:22 JST直接只读核对：App/Manager双pin均`b9fe80150f9cdea47130e8952e85e39503187677`；两套各284源码逐文件、3份补丁、实际Runner与profile/pin digest匹配。当前run为`1c07a229-806c-4795-b418-b401c847cfbf`、READY，Task Running、唯一Host PID36492、7676/7677/18765均监听，`backup.freeze`不存在。本轮没有停止Task或调整gate。旧版15:06再次启动，16:23 Gateway退出`0xC0000409/native_fast_fail`，16:27自动恢复成功；此历史稳定性问题不属于本次stdout修复，未声称根治。独立监测器当前无活动进程，最后样本为13:46 JST，不能当作当前连续健康证据。

根因与准确边界：`install-activate`在同一CLI中依次调用install、installRunner、checkInstalled，三者各写一条stdout JSON。完整调用正常退出后，包装器Native将stdout合并再ConvertFrom-Json一次，于是报`Additional text encountered after finished reading JSON content`并进入自动回退。隔离执行同一实际组合代码复现“exit=0但3条JSON”。现场未保存原始stdout，三条输出的确认来自归档代码和隔离复现；原快照最终阶段不能还原全部中间时间线。回退后的同一报错是外层重新抛出原安装解析错误，不等于回退再失败。新版释放gate路径也有同类嵌套输出，已一起覆盖。

修复：所有内部步骤返回对象；CLI只在完整动作及最后lease proof成功后输出一个成功JSON，异常只输出一个失败JSON并返回非零退出码，诊断使用stderr。Native严格要求一个JSON对象，不采用取最后一行或吞掉多条结果的兼容；错误带具体操作名，异常原文不回显。自动回退最终状态明确区分`UPGRADE_FAILED_OLD_VERSION_RECOVERED`和`UPGRADE_FAILED_ROLLBACK_FAILED`，后者同时保留原升级及恢复失败原因。

隔离测试覆盖复合安装、释放gate、最终lease proof失败、部分安装后失败、回退文件恢复失败、自动回退成功/源码恢复失败/旧版启动失败，以及多JSON、空输出、数组、stdout诊断、stderr诊断和exit=0但ok=false。使用真实小文件复制/回退与真实CLI stdout，Task/授权等外部边界保持隔离。独立审查指出原partial-install用例首个复制文件内容相同，已改为先实际写入新版payload并断言现场已改变，再断言回退还原；新版复合stdout及PS Native/自动回退测试通过，原增量回退、Runner身份/包装器、升级gate/版本绑定和控制字节绑定回归通过。

修复commit **`e0eb933cec1b3cb88a4d34b19e3257228f39541e`已推送**至当前codex分支。新发布绑定如下（均在`D:\Tong\state\p27-autonomy-candidate-20261017`）：

- release：`quick-trust-release-e0eb933`，559源码/23 native，完整build/verify通过。
- candidate：`quick-trust-candidate-e0eb933`，源码+3份已核对补丁+共享SDK；不是完整npm恢复，不重新安装依赖。
- snapshot：`quick-trust-full-cutover-20261028083606841-c7ddb8fd`，新/旧commit分别绑定e0eb933/b9fe801，App/Manager旧源码各284文件验证通过，stage=`snapshotted`。

17:36 JST从新归档包装器执行`-Mode Preflight`实际输出PRECHECK PASS；现场旧run `1c07a229-806c-4795-b418-b401c847cfbf`健康、无生产变更。归档内`Test-TongUpgradeControlBinding.mjs`通过；helper新SHA为`9379c38974dbf7aee9f6807e14f2d4a0dd6c191a7e06645a7df532b20d431749`，与Git归档实际导出字节和release清单一致，未改旧归档或停用校验。正式认证MCP项目查询成功返回12项，仍是旧版、没有cleanupScopes。新增三处产物约34MiB，仅包含必要源码/native/回退材料及少量暂存；未复制完整依赖。

新快照内`Run-Approved-Upgrade.ps1`仅已准备并通过PS7解析，**本次未打开窗口或执行Deploy**。遵守用户“本次不要直接重试生产升级”：下一次明确进入维护窗口前先恢复独立监测（由本人自己的Windows Shell启动现有入口），重新读取实时门禁，再由本人完成新哈希绑定挑战。旧快照、回执、授权材料及所有历史候选保留；小缓存与5.636GiB候选均未删除。新候选的生产运行/MCP清理/真实小缓存验收仍未完成。

### 前一轮Runner修复与发布准备（历史）

### Runner身份匹配故障续修（2026-10-28）

本机cb0355b升级窗口在`Stop-Login()`报`Unable to identify the single original monitor runner`，失败回执为`native-window-failed-or-cancelled`。原快照`quick-trust-full-cutover-20261027174339358-177eb337`仍为`snapshotted`；其候选绑定、失败回执和授权审计保留，不覆盖旧归档。现场只读确认Task唯一实例EnginePID=30820、Host真实路径为runtime/login-management/TongLoginHost.exe，唯一子Runner PID28216实际为`C:\Program Files\PowerShell\7\pwsh.exe`。旧过滤器只接受PS5.1，故匹配为零；未停止正式运行。

本次只修当前完整升级/独立回退共用的进程识别：固定PS7及系统PS5路径白名单、完整启动命令、唯一子进程、Task动作/实例GUID/EnginePID、Host路径、父子关系及创建时间；禁用Task后和调用stop-run前重新读取并逐项对比，消失、复用或身份变化均拒绝停止。预检现在也读取同一完整身份。无强杀、无按名称泛匹配。真实Host无参数命令尾部空白可以存在，额外参数仍拒绝。

同类固定PS5匹配还见于旧`Invoke-TongQuickTrustProduction.ps1`、`Set-TongSilentLogin.ps1`的一次性历史切换，当前FullProduction/FullCutover/独立Rollback不调用它们，本次不启用或迁移旧入口。当前冻结门及Host使用PS7；`TongProductionProfile.mjs`、`TongRuntimeSecurity.mjs`的固定PS5调用是原有原生安全/DPAPI助手契约，不是Runner身份过滤，本次保持不变。

新增PS7回归先在旧代码复现同一报错，再验证正常停止及18项身份/竞态拒绝；真实隔离Host/PS7正常退出通过（最终夹具`test-temp/runner-stop-12dd5acaf81548a997227da2a2bfab21`，仅Scheduler和Manager请求投递为测试适配器）。原升级包装器、实际文件增量完整/部分安装回退、生命周期gate、升级版本绑定、readiness和控制脚本绑定测试通过。只读独立审查发现外层catch会在身份拒绝后按任务名重启；已补实际外层catch的先红后绿回归，并改为只允许重新验证完整原身份和原健康run后Enable，不自动Start。以上不是生产切换成功。

修复commit **`2fcea7523d358190661fc905a23b482386f6fecd`已推送**至`codex/024-maintenance-adapter-20261024`。新release为`D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-release-2fcea75`，557源码/23 native，完整build/verify通过；新暂存为同根`quick-trust-candidate-2fcea75`，仅源码、3补丁和共享SDK。新快照为同根`quick-trust-full-cutover-20261028042414441-0da1d9af`，原App/Manager各284源码、pin/profile/Runner及补丁验证通过，新/旧commit分别绑定2fcea75/b9fe801。旧cb0355b归档与失败快照未覆盖或改绑定。

13:24 JST从新归档包装器执行正式`-Mode Preflight`实际通过，包括真实Task/Host/PS7 Runner身份；生产仍是原run、READY、三端口及独立监测healthy，未出现backup.freeze。13:25 JST新快照内`Run-Approved-Upgrade.ps1`已打开可见PS7控制台（初始PID4980），回执`awaiting-native-approvals`，待本人真实挑战。新版本需要新哈希绑定普通许可，旧许可不代替；先验证再停止、安装/激活、恢复许可、READY，之后才限定清理许可与小缓存MCP验收。独立回退使用新候选归档包装器`-Mode Rollback`及本段三个路径、完整新/旧commit。

本次三处新release/暂存/快照合计35,634,645逻辑字节（约33.98MiB，不含小型测试夹具），没有安装或复制整套依赖。没有重扫磁盘、删除小缓存或5.636GiB候选。当前仍须根据本机窗口回执与现场状态确认生产结果，不能把预检通过记为正式升级成功。

### 上一轮准备与失败现场（历史）

本轮实测双pin为 `b9fe80150f9cdea47130e8952e85e39503187677`，run `d90f5e72-dd41-4ee4-9e2a-9eb3b0f490dd` 为ready；独立HealthMonitor持续记录healthy=true、唯一Host和7676/7677/18765，正式MCP返回12个项目。`preflight-login`实际approved=true，但开发入口`getApprovedProductionProfile('manager')`实际APPROVAL_DENIED。旧版本持久恢复许可不包含新版本部署，这是权限分离，不能改密文绕过。

旧`Tong024ProductionMaintenance.mjs`仍绑定024事故并保留MAINTENANCE_NOT_READY；本轮修复既有`Invoke-TongQuickTrustFullProduction.ps1` / `TongQuickTrustFullCutover.mjs`通道：显式旧/新commit、所有控制脚本字节绑定、正常stop-run让Runner/Host退出、增量源码快照、原生生命周期门、双pin/profile/App/Manager同步激活及独立Rollback。未强杀进程或复制整套运行态；OAuth/DPAPI/真实数据库原位保留。

gate先在快照内准备并持久保存物理身份回执，再不覆盖地原子移入run；中断可以续接。最终验证与移除gate在同一原生互斥内进行。未知gate、授权到期、快照/版本不符、进程或端口不明时拒绝继续。普通本机签名必须覆盖候选start/enable-agentdock/manager及原版本restore；安装后的固定恢复许可由用户通过正式Manager入口重新确认。

代码：`f46f425`为升级/清理授权修复；`8afb610`补Windows扩展路径解包，315字符回归通过。初次构建因262字符证据路径失败，残留`quick-trust-release-f46f425`只是部分源码归档，不能当恢复release；本轮保留不删。默认Git为硬链接，发布器拒绝；改用仓库测试原本使用的单链接Git，未降低检查。

`78f302b`补齐PS5对长路径的真实ACL枚举，仍核对owner/DACL/reparse，不修改ACL或系统设置；`cb0355b`修复停止证明的过期字节指纹并增加回归。最终候选绑定`cb0355ba4de216aa0ff712252df8041bad2edc11`；`8afb610`/`78f302b`为故障定位中间产物，不是当前生产pin。本轮保留这些精确产物供后续受管整理，未以删除掩盖失败。

### 最终候选和本机维护窗口（2026-10-28 02:49 JST）

- release：`D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-release-cb0355b`，完整build/verify通过，554个源码、23个native，归档文件合计23,112,231逻辑字节。
- 暂存：`D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-cb0355b`，源码与3份补丁的增量安装源；复用前次暂存，仅更新2文件。SDK是指向现有开发依赖的junction；不是完整npm恢复环境，不伪造release-restore-evidence。
- 小型回退快照：`D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-full-cutover-20261027174339358-177eb337`；原App/Manager各284个源码及必要补丁/pin/profile/Runner验证通过。旧快照尚未使用，仅将候选绑定由78f302b原子更新为cb0355b，并保留小型原元数据，不复制第二套旧源码。
- 从归档控制脚本执行正式包装器`-Mode Preflight`实际输出`PRECHECK PASS`，正式旧run健康，最终候选验证通过，无生产变更。
- 上述快照中的`Run-Approved-Upgrade.ps1`已由PS7解析并打开本机真实控制台。`native-window-result.json`只记脱敏阶段；`awaiting-native-approvals`不代表批准或部署。必须等真实挑战完成并现场验收。窗口内升级成功才申请限定清理许可，再建立小缓存；不删除大候选。
- 若需独立回退，使用同一归档`Invoke-TongQuickTrustFullProduction.ps1 -Mode Rollback`，带本节release/candidate/snapshot和完整ExpectedCommit/ExpectedOldCommit；当前原版本为`b9fe80150f9cdea47130e8952e85e39503187677`。普通批准过期会要求本人续签，不能清gate或修改密文。

本轮6处明确发布/暂存/快照产物元数据合计90,245,564逻辑字节（86.06MiB，含前述失败/中间产物，跳过1个SDK junction，不含小型测试夹具）。没有重新安装或复制整套node_modules。维护窗口初始阶段为`awaiting-native-approvals`，随后在Runner身份检查处失败，见本节顶部最新记录；未替用户输入挑战、未正式切换、未授予state清理许可、未执行小缓存或大候选删除。

## 2. 验证与未完成项

- 10项针对性测试通过：清理授权、原清理器、Quick Trust、升级绑定、原生升级gate、增量安装/回退、原维护租约、MCP元数据、Gateway、PS升级包装器；另有长路径、readiness、脱敏诊断测试通过。
- 真实隔离`Test-TongLoginRecoveryLifecycle.mjs`通过三组件启动、重复启动拒绝、故障恢复、私有Job清理及撤销后拒启。复用开发依赖；夹具为`D:\Tong\state\b23-login-c98d197c33354b2e8a303853c6076805`，不是生产验收。
- gate测试覆盖回执落盘后中断/续接、第二控制器拒绝、释放后回退新一代gate；增量回退测试在小夹具实际执行生产函数，覆盖部分/完整安装还原与额外用户文件保留，不冒充正式任务切换。
- `Test-TongProductionProfile.mjs`、`Test-TongLoginRecoveryAuthorization.mjs`本次在Windows PowerShell 5.1脚本安全策略拒绝处失败；没有降低策略/断言，也不计为通过。
- **生产升级、新工具正式发现、持久清理许可、正式MCP小缓存删除仍待本机批准及实测**；不得根据以上测试预先记成功。

## 3. 一次性限定清理授权

部署后使用`D:\node\node.exe D:\Tong\runtime\releases\manager\scripts\TongCleanupControl.mjs grant-state`，用户在本机真实控制台确认。开发源码入口不能颁发正式许可。独立非凭据许可保存在`D:\Tong\app\runtime\disk-cleanup-grants.json`，ID=`tong-state-cleanup`；`tong_list_projects`返回cleanupScopes。`revoke-state`可撤销；revision变化/撤销后旧Plan拒绝。project.write不再隐含递归删除权，也不因此授予Shell、Agent或一般state写入权。

许可只覆盖state内规定缓存和两类有匹配保留release的历史候选。执行重验路径、链接、pin、任务/服务/进程直接引用及归档；两类候选都核验完整源码，temp须为空，node_modules逐文件与保留依赖一致，三份DevSpace补丁按历史release哈希核对。数据库、凭据、Git、独有文件拒删，无法确认引用或差异也拒绝。

本轮只建立`D:\Tong\state\cleanup-acceptance-20261028\npm-cache`微型独立缓存，通过正式认证MCP执行Plan→Execute；核实目录消失、父目录保留，审计含路径/类别/依据/文件数/逻辑字节/时间/结果，Tong READY、三端口、Host/Supervisor/Guardian与独立监测正常。此验收未完成前不能声称可从网页直接清理。

## 4. A类：下一轮逐项Plan的精确候选

沿用[第三批源码与归档审查](Tong-Disk-Cleanup-Batch3-QuickTrust-Review-20261028.md)：2,765源码文件、250归档文件已核验，实物仍在。新版依赖逐文件规则**没有冒充已对十套实物验收**；下一轮只有Plan成功且deletionAuthorized=true才Execute，拒绝项转B核查，禁止改用Shell绕过。

| 精确路径 | 历史逻辑字节 |
| --- | ---: |
| `D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-5362210` | 605,318,136 |
| `D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-d780561` | 605,293,288 |
| `D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-024d5b0` | 605,275,611 |
| `D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-1a78e48` | 605,266,938 |
| `D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-4ebdbc3` | 605,246,372 |
| `D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-7d11382` | 605,154,390 |
| `D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-376a328` | 605,135,958 |
| `D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-37dc649` | 605,101,901 |
| `D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-d9983bb` | 605,043,710 |
| `D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-0a2da3c` | 605,010,647 |
| 合计 | **6,051,846,951（5.636GiB）** |

对应`quick-trust-release-同后缀`原位保留，staged-app/staged-manager不在名单。预计升级并授权后可由Tong直接删，当前未有正式执行证据。前两批已删除1,584,629,549逻辑字节不重复计入收益；NTFS实际释放量需另按现场空闲空间记录。

## 5. 增量盘点及B/C类

2026-10-28约02:05 JST仅扫描已知缓存和根目录命名元数据，未重扫五根约258万文件或读取私人正文。以下均无普通读错误，可靠物理占用未取得，记UNKNOWN。

| 目标 | 逻辑字节/文件/子目录 | 分类与依据 |
| --- | --- | --- |
| `C:\Users\Rune\AppData\Local\npm-cache` | **1,900,919,770 / 123,774 / 11,205** | 新大头约1.770GiB，含_cacache/_logs/_npx/_prebuilds，跨项目共享。**B**：尚须活动消费者、独有内容和离线恢复审查；不是Tong重复副本，不在state授权内。 |
| `C:\Users\Rune\AppData\Local\Temp\tong-session-coordination-nLN98w` | 9,712 / 1 / 0 | **C**：会话协调残留可能仍有用途，收益极小，本轮不清会话。 |
| `D:\Tong\development\test-temp` | 131,210 / 20 / 34，跳过1个reparse | **B**：当时失败夹具快照，后续测试已增加内容，不能当最终实时总量；按精确夹具处理，不跟随junction。 |

D根目录命名匹配tong/agentdock/devspace/mcp仍只有原五根，没有发现额外大项目根。新增主要大头为C盘共享npm缓存，不能加到旧43.622GiB后声称全部可删。

**B迁移整理**：`D:\tong-desktop-control`本轮只读Git仍50项tracked修改/13项untracked；`D:\tong-codex-acceptance-20261010`在main、2项untracked；另有`D:\agentdock-poc-20261010`、`D:\tong-agentdock-local`。四根约4.90GiB是旧快照，未冒充本轮重算。独有refs/未推送commit、dirty/untracked、原生Session cwd、projectId和恢复状态未保存映射前不能删。

**C必须保留**：当前App/runtime/tools、双pin指向release、共享主仓库.git/node_modules及worktree、配对Quick Trust release、当前和上一个实测恢复版本、授权/DPAPI/OAuth/数据库/会话/事故原件。新候选和小型回退快照在升级验收前保留，不能根据Disabled/test/old名称通配清理。

## 6. 下一轮顺序与长期目录管理

1. 先完成生产升级、清理许可和小缓存正式验收。下一ChatGPT先调用`tong_list_projects`核对cleanupScopes，随后按十条路径逐个`tong_disk_cleanup_plan({projectId:'tong-state-cleanup',path})`→Execute。记录回执、目标消失和release保留，批末检查健康、C/D空闲空间；无需重新扫全盘或让用户逐批粘贴删除脚本。
2. 再定向审C共享npm缓存及npm/npx活动、各类别恢复条件。它需要独立精确本机授权与AppData支持，不能直接扩大state许可或绕过保护；本轮未删。
3. 四旧根按计算器→旧Tong源码→PoC→旧AgentDock运行态依次处理；建议目的地分别`D:\Tong\development\acceptance\tong-codex-20261010`、`D:\Tong\development\legacy\tong-desktop-control`、`D:\Tong\archives\legacy-agentdock-poc-20261010`、`D:\Tong\archives\legacy-agentdock-local`。同卷移动不释放容量，不复制新环境。
4. 每根先保护所需Git refs和未提交原创文件，检查敏感历史后才同步适当GitHub；仅推HEAD会漏dirty。OAuth/DPAPI/数据库/私有日志不上传。保持projectId的受管root更新、同原生Session迁移/续接尚无本轮已验入口，必须先闭合，writer冲突不清锁、不换会话冒充。
5. 复用旧报告引用索引，精准核对脚本默认值、Windows任务Execute/Arguments/WorkingDirectory、服务、环境变量和MCP注册。只更新该根必要引用；本机正式许可后才搬迁。迁后验收同projectId/同Session和读写/启动，失败同卷移回并恢复引用。正式App/runtime保持原位。
6. 最后按锁、ABI/native补丁和无消费者证据删除重复node_modules/venv；开发共享依赖和生产依赖保留。其他state大根沿用已有容量索引，审精确子目录。

保持development/app/runtime/state/tools分区语义；archives仅收独有小源码/文档和必要本地恢复材料，不存几十套依赖。测试优先复用隔离夹具、共享不可变依赖并单独保留少量需改DevSpace文件；锁/native变化才建独立环境。正常只保留当前、一个实测回退版本、一个待验候选，其余进入受管审查。成功测试沿用finally清本次临时目录；失败先留精确路径/小诊断，再据marker/引用/独有数据退役。自动清理应接明确测试/发布收尾，不装广泛定时删除；此自动收尾扩展尚未实施，不能声称已启用。
