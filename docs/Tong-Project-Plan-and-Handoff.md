# Tong Desktop Control — 项目现况、近期路线图与跨对话交接

> **项目最高层完整任务书**：[Tong-Master-Project-Taskbook.md](Tong-Master-Project-Taskbook.md)。本页作为当前状态与快速交接导航；覆盖所有Agent、统筹MCP、系统/磁盘/RAM维护和长期里程碑的完整规划以总任务书为准。

更新：2026-10-27。**本文件是未来对话与Codex接手时优先阅读的当前导航，不把历史已验收和未来目标混为一谈。**

### 最近运维进度（2026-10-27 23:18 JST，只读实测）

- 用户最终需求已确认：见[22项需求定稿](Tong-GrillMe-Final-Decisions-20261027.md)、[跨新对话修复指南](Tong-New-Chat-Repair-Guide.md)。当前最高优先级是**生产长时间稳定与诊断**，磁盘第二批清理和新功能暂缓。
- 正式run `2b871eeb-ea5c-4690-b4ec-d46454f3a9ed`运行约2小时后，Runner在2026-10-27 12:59:03Z的doctor遇`APPROVAL_DENIED`（原始native退出码1），12:59:16Z记录runner_failed；同run后续Supervisor发生`MONITOR_FAILED`并完整关闭。**现有证据不能证明二者由同一个底层错误触发**。
- 用户在正式预检`Approved=True`且预算0/3、旧Guardian清理完成后，**手动启动一次**正式Task；最新run `d90f5e72-dd41-4ee4-9e2a-9eb3b0f490dd`于14:14:36Z进入READY，14:14:59Z记录runtime_healthy。23:18 JST网页ChatGPT通过Tong实际再查Task Running、唯一Host、12个项目、授权工作区和生命周期日志成功。新run在当时未出现shutdown；**这不是长期稳定性或故障根治证明**。
- 源码疑点：`TongLoginRecovery.mjs`的loadGrant会将底层失败压成统一`APPROVAL_DENIED`，Supervisor定期监控将任意失败压成`MONITOR_FAILED`，丢失精确阶段。**底层具体错误仍未查明**；在取得故障根因和受控升级批准前，不改生产pin、授权、预算或Task。
- **开发稳定性诊断补丁（未部署生产）**：在`TongLoginRecovery.mjs`、`TongAgentDockRuntime.mjs`和`TongLoginRuntime.ps1`增加固定枚举的`stage/kind`错误标签；授权失效仍拒绝操作，监控异常仍安全关闭；保留现有重试预算、进程所有权和主程序拓扑。Supervisor遇监控错误时尝试写入两处脱敏元数据记录，不能泄露凭据或源错误文本。
- **实测验证**：新`Test-TongRuntimeFailureDiagnostics.mjs`覆盖错误标签白名单和敏感字符串消隐；`Test-TongRuntimeReadiness.mjs`启动时序测试通过；`Test-TongLoginRecoveryAuthorization.mjs`在独立生产模拟环境验证旧授权被拒、篡改被拒、撤销后不可恢复、正常授信可恢复，全部通过；PowerShell/Node语法检查通过。一次模拟测试留下约2.57MB可识别的新夹具`D:\Tong\state\b23-login-0b609051c3bd41b393094b3ce4bf81bf`（非生产pin）；后续只按授权的精确清理流程处理，不把它当正式发布资产。
- **接下来必须做的事**：评审这些仅诊断的源码差异，并制定受控的生产候选、版本/审批/回退/真实可用性验证。只有新版明确记录了下一次实际失败阶段，或通过有界模拟稳定复现，才针对已定位根因提出真正修复；**不能把这次记录增强宣称为长期稳定性已经修好**。


### 第三批候选：10套Quick Trust重复环境（审查通过，未执行删除）

在之前五根容量报告基础上，仅针对前三个最大的历史state根进行定向元数据分类，不重扫全盘。`p27-autonomy-candidate-20261017`下10套约605MB Quick Trust候选合计6,051,846,951字节（5.636GiB）：现役pin指向其他root；任务/服务/活动进程未直接引用这些历史根；10套release归档与候选提交一一对应，逐文件核验2,765个候选源码文件和250个保留归档文件内容哈希均匹配，另外仅发现每套候选自身的恢复验证JSON（需要在审计中保留关键证据）。对应10套release均保留，另外两套staged环境继续保留。详见[第三批候选审查](maintenance/Tong-Disk-Cleanup-Batch3-QuickTrust-Review-20261028.md)。开发清理器已支持此严格类别并通过专门合成测试；**但因正式部署/独立state清理授权未完成，没有删除这6GB，也没有绕过Tong现有写入边界。**

### 受管磁盘清理与容量治理（开发版）

新增[受管磁盘清理能力与容量治理说明](maintenance/Tong-Managed-Disk-Cleanup.md)，开发源码包含MCP `tong_disk_cleanup_plan`和`tong_disk_cleanup_execute`。针对登记且可写的项目目录，支持特定缓存及有完整保留release的历史候选，通过预检、短期一次性计划、执行前重验、路径防重定向和审计记录执行，不允许删除任意目录。当前**尚未在正式Tong部署，`D:\Tong\state`也没有受管写权限**，不能把全盘元数据可读权限当作删除授权。累计两批实际清理逻辑1,584,629,549字节；五根43.622GiB中的依赖内容约35.117GiB，是后续去重的重点。生产发布与state长期清理权限仍需本机一次性受控授权及升级验证。

### 第二批清理：历史B2.3候选（2026-10-28，已成功删除并复核）

依照[第一批报告下一批候选](maintenance/Tong-Disk-Cleanup-Batch1-20261027.md)的已核验清单，仅针对 `D:\Tong\state\b23-release-fgKPTn\candidate-58786f6`和`candidate-9589698`补齐归档/引用验证，不再扫描五根目录。对应保留的release（58786f6 / 9589698）均含源码、原生文件归档以及各自不同的package-lock.json；默认B2.3测试依赖的 `npm-cache` 原位保留。

精确预检脚本 `scripts/Clean-TongB23Candidates.ps1 -Mode Check`已通过：正式run仍ready，双pin仍绑定b9fe801版本与另一个releaseRoot；无计划任务、服务或其他进程引用两个candidate；保留release的source.tar、lock、native归档SHA核验通过；候选顶层无意外项目、递归无reparse。两候选分别603,120,383和603,448,013字节，总计**1,206,568,396字节（约1.12GiB）**；共77,571个普通文件。用户通过本人Windows PowerShell 7按精确脚本实际执行，两项均返回`deleted`。ChatGPT后续用Tong再次核对：两个候选目录均不存在；两个保留release和npm-cache均存在；生产run仍`ready`，独立监测器仍采样`healthy=true`。详见[第二批实际删除回执](maintenance/Tong-Disk-Cleanup-Batch2-20261028.md)。不把文件逻辑长度误称为NTFS实际释放空间。

操作边界：`D:\Tong\state`当前并不是获得直接递归删除权限的Tong开发工作区；因此本批由用户本机Shell执行固定脚本，而不是从开发项目的受管命令中越权删除。开发分支已经加入受管清理计划/执行接口，见前述开发文档；正式部署、本机受控清理范围持久授权和全尺寸真实候选压测**仍待完成**，不能假称现有生产接口已允许递归删除。

### 独立只读监控（开发脚本已实现，需从本机启动）

监控脚本与手动CMD入口已添加：详见[独立监测与故障取证说明](maintenance/Tong-External-Health-Monitor.md)。按需从用户Windows资源管理器双击启动；后台持续记录运行身份、Host、Supervisor/Guardian、任务/端口、ngrok状态、本地端点探针，以及原有结构化错误事件，日志限量轮转。模拟离线和授权拒绝事件、敏感字段不外泄、真实只读冒烟已验证；**尚未在独立Windows Shell启动长期驻留，也未验收Tong真正退出后监测器存活**。它不修复已知故障，故障根因仍待受控诊断升级和后续实测。确认监控独立运行后可开始下一批精准清理的只读盘点，不直接授权批量删除。

### 短时稳定性测试（2026-10-27 23:41–23:43 JST，已实测）

- 正式生产基线继续保持runId `d90f5e72-dd41-4ee4-9e2a-9eb3b0f490dd`、phase=`ready`、TongLoginRuntime Task=`Running`；TongLoginHost始终1个（PID 30820），Supervisor（24292）和Guardian（18288）在当前检查时均存活；7676/7677/18765均监听，ngrok服务Running。恢复预算最近30分钟为0次。未运行正式doctor（此前曾导致native退出/授权拒绝）。
- **持续观察**：2026-10-27 23:41:42–23:42:41 JST，7次间隔检查**7/7通过**，每次均有唯一Host、相同runId、Supervisor/Guardian实际进程及3个端口；窗口内未新增login-management或该run生命周期事件，也没有重启、停止或版本切换。
- **网页端实际调用**：`tong_list_projects`返回12个登记项目；`tong_goal_list`返回4个已保存Goal；受管`read`实际读到项目需求文件，`tong_windows_inspect`确认唯一Host。127.0.0.1:7676的OAuth discovery HTTP 200，127.0.0.1:4040的ngrok本地API HTTP 200；这不是未经认证公网终端的全面压测。
- **开发环境回归**：`node tests/Test-TongRuntimeFailureDiagnostics.mjs`通过、`node tests/Test-TongRuntimeReadiness.mjs`通过；测试未触发生产故障注入、生产升级或服务重启。
- **边界**：短时Smoke通过，不等于至少2小时/24小时连续稳定验收；未验证Windows重启后恢复、周期doctor在长时间运行下的安全性、Codex长Goal满负荷期间的可靠性、重新获取授权或生产部署后的兼容性。提交`614aa0e`的诊断代码**尚未打包部署到生产**，所以现役服务的旧诊断缺口仍然存在。生产版本继续维持原pin，长期稳定性仍为**待验收**。

## 1. 目标与分工

Tong是连接ChatGPT网页端与用户Windows本机的统一入口。用户用自然语言提出一个**完整目标**；ChatGPT负责识别目标、限定范围、安排执行Agent、监督进度、核验证据、必要时追加修复回合，并在**整个目标**完成后统一反馈。

- 没指定Agent：ChatGPT优先通过Tong的本机工具直接执行已授权操作，不自动创建Codex会话。
- 明确指定Codex或要求Codex完成开发：必须通过Tong调用真实Codex原生任务/会话，不得以ChatGPT自己操作后“冒充Codex”、CLI假会话、虚构消息代替。
- 用户可在Codex Desktop中看到并继续原生对话；默认同一项目优先关联最新可用的原生会话，若用户点名某一会话则沿用指定ID。Writer已被桌面端占用时按受支持的恢复/交接流程处理，不删除锁、强杀桌面App、不换新会话假冒续接。
- 典型任务分2–4个必要回合；具体由验收需要决定，不强制凑轮数，也不“一个回合成功就提前汇报”。只有完整目标通过业务验收或确需用户处理的实质阻塞才作正式结论。
- 长期目标：不同Agent（Codex、Claude CLI、DSH及以后其他提供者）在Tong统一任务接口下运行；当前生产Agent的真实能力以工具枚举和实际验收为准，不把合成适配器当已上线。

## 2. 当前资产和目录角色

| 位置 | 角色 / 处理原则 |
| --- | --- |
| D:\Tong\app | 正式应用，保持原位 |
| D:\Tong\runtime | 正式登录Host、pin、状态、恢复、密钥与日志；保持原位 |
| D:\Tong\tools\ngrok | 现役服务依赖；保持原位 |
| D:\Tong\development\tong-desktop-control | 开发主仓库，生产pin仍将其作为sourceRepository；保留共享.git与node_modules |
| D:\Tong\development\tong-024-startup-recovery | 当前维护、文档及恢复工作树，分支codex/024-maintenance-adapter-20261024 |
| D:\Tong\development\tong-launcher-startup-recovery、tong-startup-hotfix | 其他Git worktree；有分叉提交，不按重复目录删除 |
| D:\Tong\state | 历史测试、候选包和部分仍被生产/任务引用的依赖；允许**逐项精准精简**，禁止整根通配删除 |
| D:\agentdock-poc-20261010、D:\tong-agentdock-local、D:\tong-codex-acceptance-20261010、D:\tong-desktop-control | D盘四处历史工程，目标是审查后整合到Tong内；旧Git/未提交源码/授权/绝对路径先梳理 |

**Git及磁盘策略**：代码、任务书、非敏感必要证据通过GitHub保存；不上传token、OAuth、DPAPI、真实数据库、业务数据或私有日志。对于可重建的npm/pytest缓存、重复部署副本，在排除当前引用之后直接删并记录路径与实际结果，**不额外制作整目录备份**；不能从“文件名旧、测试已禁用”直接推断可删。单任务预计额外落盘超过1GiB先评估必要性和轻量替代，必要时取得明确资源授权。不要反复重装node_modules、创建巨型隔离环境。

## 3. 目前已经实际验证的事实

- 2026-10-27 本机最小恢复：正式Task TongLoginRuntime仅启动一次，新runId **2b871eeb-ea5c-4690-b4ec-d46454f3a9ed**进入READY，正式doctor.healthy=true、三个端口监听、ngrok正常；网页ChatGPT后来实际调用认证Tong MCP列出12项目、读取授权目录/文件、复核新runId与端口。恢复版本仍为**b9fe80150f9cdea47130e8952e85e39503187677**；**并不代表长期稳定、重启后自动恢复和底层故障已经根治**。
- 2026-10-27已有一次doctor native_fast_fail（0xC0000409），随后另一次监控进入MONITOR_FAILED导致shutdown；触发链已记录但**底层异常没有充分诊断信息**。不要把此前缓存清理误当成故障原因。专项证据见[生产恢复记录](maintenance/Tong-Production-Abnormal-Exit-Recovery-20261027.md)。
- 网页端通过Tong真实读取、写入、编辑已在授权文件夹D:\作业\111验收。未指定Agent时ChatGPT直接操作可用。
- Codex原生会话在D:\作业\111已做过同会话多Turn及Desktop可见、继续测试；有时用户必须完全退出再打开Codex Desktop，新任务才出现在列表。**“正在执行时立即可见并自动刷新，无需重启”尚未验收通过**。
- Goal Supervisor具备持久目标、真实原生child Turn、进度查询、同一session多回合及整个Goal结束通知的代码/历史验收；业务验收标记和技术检查应分开。有界wait代码存在，但本次当前MCP工具清单未暴露tong_goal_wait，不得声称网页侧已经实际调用。**ChatGPT网页端固定面板自动持续刷新和回复结束后主动消息推送尚未实现/验证**。
- 磁盘：五处根目录在2026-10-27只读盘点的逻辑大小为43.622GiB（不等于可回收NTFS空间）；2026-10-27已精准删除两个历史npm-cache，共378,061,153字节/约360.55MiB。具体回执见[第一批清理记录](maintenance/Tong-Disk-Cleanup-Batch1-20261027.md)。本文件不声称磁盘已重新全量统计。

## 4. 工作优先级（按以下顺序推进）

**P0 — 文档/资产边界与磁盘精简（进行中）**

1. 用本文件、根AGENTS.md和[任务书](Tong-Codex-Goal-Supervision-Taskbook.md)维护一个稳定入口；以后只维护这些入口与实际成果证据，不生成几十份重复说明。
2. 下一批先核查D:\Tong\state\b23-release-fgKPTn两个candidate-58786f6（603,120,383字节）和candidate-9589698（603,448,013字节）的native、node_modules及temp差异，再查是否有绝对路径/恢复依赖；当前**未获删除许可的证据标准**，不能因源码SHA匹配就全目录删除。同根npm-cache（188,785,956字节）被现有回归测试默认引用，当前保留。
3. 深入复核p27-autonomy-candidate、b23-switch、native-codex-acceptance等大体积历史根的部署副本，按确定无需保留的**精确子目录**分批删；先核对生产pin、任务参数、Git/独有数据与重要事故证据。目标是减少重复依赖和冗余发布副本，而非保留每次完整现场。
4. D盘四外置旧根在确认真实使用者、原生会话cwd、受管登记与绝对路径后，优先迁入D:\Tong\archives及development\acceptance；能安全删的缓存先删，不为迁移额外生成5GiB副本。敏感运行态不入GitHub，不能随意改ACL/DPAPI或移动活动目录。

**P1 — 运行稳定与故障可诊断（下一开发阶段）**

1. 在**开发仓库**补Supervisor监控分段脱敏原始错误、native诊断回执/错误码，避免再次只有MONITOR_FAILED。
2. 研究doctor native非零退出、Runner结束及Windows任务为何未持续自动恢复；尽量复用已有监控/重试逻辑，保持预算、次数、授权边界不变，不盲目延长超时。
3. 小规模合成故障与有界回归先通过，形成精确源码差异和升级方案；生产部署需独立受控授权/回退验证，禁止直接修改app/runtime或强行重启“证明”。

**P2 — 用户重点：ChatGPT→Codex任务级监督＋Desktop原生会话＋网页进度（最高功能优先级）**

执行顺序参见[专项任务书](Tong-Codex-Goal-Supervision-Taskbook.md)：核实现有Goal真实可用性与准确业务验收；修复Desktop早期可见与列表刷新；提供可查询的进行中步骤与独立进度展示；只在**整项目标**完成或需用户实际处理时统一报告。新回合共享原生session，不让Desktop抢同一Thread writer。**任务状态、原生会话列表和ChatGPT UI实际展示是三件事，须逐个验收。**

**P3 — 后续扩展**

项目归档整理持续滚动；稳定后再开发已安装其他Agent的真实可用适配器，先Claude CLI，DSH受限执行器解决后再接，Zcode/Work Buddy需先发现协议。统一Tong调度，不为每个Agent另开一套MCP公开面。Windows常用文件/项目操作再按需求扩展。

## 5. 典型端到端任务流程

用户下任务 → 查已授权项目和最新原生会话 → 明确任务完整验收与有界步骤 → 由ChatGPT直接处理或Tong goal_start派给Codex → 在当前活动对话中轮询goal_status/可用wait、展示**有证据**的实际进度 → 需要独立审核时检查结果/差异/测试，未达到要求则在同一Goal/Session追加回合 → 整项目标完成再通知并集中汇报。异常与确实需要用户交互的授权阻塞可提前告知，不把正常子Turn结束当最终答复。常驻实时进度卡若宿主无法订阅，应准确显示“最近一次查询时间”，不能伪装自动刷新。

## 6. 操作约束与工作标准

- 按本轮Git状态保护原有用户文件；当前主开发仓库含2个修改、17个未跟踪；维护工作树原先有一份用户未提交的review文档改动。不得趁“整理”替用户清理、暂存或覆盖这些状态。
- 当前开发默认在codex/分支推进；仅提交本任务文件，差异检查/必要测试后正常push，不修改main、不force push、不把敏感产物上传GitHub。
- 普通开发、已有授信项目中读写与可逆测试按现有持久授权直接走；正式生产部署/ACL/身份、凭据、Windows任务、重要数据删除仍按工具和用户明确授权处理，不绕过native门禁。
- 测试原则：目标明确、一次真实端到端 + 相应有界回归，避免每次都重做整套安装、冷启动和几十GB事故拷贝；区分模拟成功、原生Turn结束、业务验收通过、Desktop用户可见和真正网页实时显示。
- 任何跨对话迁移前更新本文件中的当前状态/下一步/提交号，并链接实际依据；旧报告保留索引，不重写历史。

## 7. 新会话接手指南（按顺序）

1. 阅读根 [AGENTS.md](../AGENTS.md) → **本文件** → [专项任务书](Tong-Codex-Goal-Supervision-Taskbook.md)。
2. 按需阅读[最新生产恢复回执](maintenance/Tong-Production-Abnormal-Exit-Recovery-20261027.md)、[磁盘清理记录](maintenance/Tong-Disk-Cleanup-Batch1-20261027.md)、[五处根独立复核](maintenance/Tong-Five-Root-Consolidation-ChatGPT-Review-20261027.md)及[Desktop历史验收](Tong-Codex-Desktop-Progress-Handoff-20261021.md)；这些是证据，不等同现在仍然健康。
3. 先读Git status、实际生产profile/pin/Task快照及可用MCP工具列表；确认真实边界后做P0或P1/P2的下一个尚未完成项，不重复旧调查。
4. 每项结束在同一入口更新“完成/未完成/阻塞/具体下一步”、精确路径、提交和测试证据。对长期UI/运行状态不得靠静态Markdown冒充实时。

**下一步默认事项**：从P0两个旧candidate的只读去重与引用核查开始，交付精确可删项；随后优先P1的monitor/native诊断设计，P2的任务进度与Desktop可见性专项。若用户指定更高优先级，则以其当前指令为准。
