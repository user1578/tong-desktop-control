# Tong Desktop Control — 全项目总任务书

> **2026-10-29新增最高优先专项**：用户要求Tong今后能从ChatGPT直接完成通用Windows与开发缓存清理，不再每次受困于几万文件同步Plan超时。分类白/灰/禁止清单、可撤销本机授权、受管持久扫描/Plan/Execute、进度/取消/恢复、真实单套38k文件验收、完整10套5.636GiB清理顺序和官方资料，统一见[通用磁盘清理开发任务书](maintenance/Tong-Autonomous-Disk-Cleanup-Taskbook-20261029.md)。当前仅已删十套候选内部编译缓存5,310文件/13,199,400字节，**完整候选仍0/10**，能力尚未上线。先完成这一专项再推进旧根归类和其他Provider，不能将现有D:\Tong\state许可扩成全C/D默认删除权。

> **2026-10-28历史执行范围**：生产升级/回退、一次性限定清理许可与小型MCP验收、增量盘点及最终清理/迁移顺序；不提前进入其他Provider或Codex调度。当前实测及本机批准状态见[最终清理与目录归并交接](maintenance/Tong-Final-Cleanup-and-Directory-Order-20261028.md)，本页较早的“本轮只读”范围为历史记录，不覆盖用户这次新授权。正式生产和真实删除仍以实际本机门禁与回执为准。

> **2026-10-27用户最终产品决定**：[22项Grill-Me需求定稿](Tong-GrillMe-Final-Decisions-20261027.md)；跨新对话和新电脑维护参见[零长交接及修复指南](Tong-New-Chat-Repair-Guide.md)。本总任务书是全局规划，需求取舍以用户已确认的决定为准，不能把未来实现目标说成已上线。

更新：2026-10-27。范围：**整个Tong长期项目**，不只是磁盘清理或Codex当前阶段。本文件是项目级最高规划入口；AGENTS.md定义执行约束，Tong-Project-Plan-and-Handoff.md是简要现状，其他报告是专项证据。每次跨对话接手先看本文件和当前Git/生产实况。

## 1. 最终定位与统一架构

**ChatGPT = 主Agent/总调度；Tong = 单一Windows本机MCP能力网关、Agent统筹中心。** 用户在ChatGPT提出完整目标，ChatGPT直接调用受管本机工具或选择Agent，持续监督整个Goal直到业务完成，并给出统一结果。用户指定某个Agent必须优先使用实际指定的Provider，不得静默换Agent。

核心关系：
用户 → ChatGPT主Agent（理解、拆解、决定执行者、监督、复核、报告） → 唯一Tong MCP Gateway（认证/授权/项目管理） → {Windows文件/系统/资源/开发工具；Goal Supervisor及Provider Registry} → {Codex Desktop、DeepSeek Harness、Claude Code、Zcode/Zode、Work Buddy、未来Agent} → 真实文件/会话/状态与任务证据 → ChatGPT整体报告。

**没有指定Agent：** ChatGPT优先用Tong自己做。**指定Codex：** 必须真实Codex原生Session，桌面端可见并能续聊。**指定其他Agent：** 接入后使用该Provider的真实CLI/API/会话能力；不能把CLI恢复谎称成桌面可见。**多个Agent协作：** ChatGPT主管理分工与验收，Tong负责执行、依赖/状态/日志/会话和受限结果交接。

**公开MCP面要统一**：项目列表/受管本机工具 + 通用 goal_start/status/list/resume/cancel/result/review/可用wait。新增Agent使用内部Provider适配器，不每个Agent新增一套公开MCP。现有工具和字段以当前真实部署的schema为准。

## 2. 全项目功能目录及当前成熟度

状态说明：已实测 = 本机或网页真实验证；部分实现 = 已有代码/部分真实测试，尚不完整；合成/开发 = 尚未正式部署验收；待开发 = 目标。所有状态均按2026-10-27的实际证据，后续必须更新。

| 编号 | 模块 | 完整功能目标 | 当前状态 |
| --- | --- | --- | --- |
| F01 | MCP通信 | 网页ChatGPT→本机Windows受控连接、OAuth/认证、拒绝未授权访问、ngrok与服务状态 | 已实测，长期/重启稳定仍未验收 |
| F02 | 本机工具 | 文件、目录、搜索/扫描、读写/编辑、Git、受管命令、项目与桌面应用操作 | 部分功能已实测；新工具逐项验收 |
| F03 | 项目授权/发现 | 一次性信任父目录、项目发现/自动注册、持久最小权限、多项目隔离 | 部分实现；一键项目登记需核对生产版 |
| F04 | Codex原生会话 | 真实创建/关联/续聊原生Session，桌面端可见，用户可继续对话 | 部分真实验收；列表偶发需退出重进 |
| F05 | 完整目标监督 | 多回合、同Session、审查/修复/测试、阻塞/恢复、只在整项结束汇报 | Goal Supervisor已有；业务验收需强化 |
| F06 | 任务进度界面 | ChatGPT显示Agent正在执行什么、已验收步骤/证据、更新时间；Desktop可查 | 后端部分实现，长驻实时面板尚未验收 |
| F07 | 多Provider统一 | Codex、DeepSeek Harness、Claude、Zcode/Zode、Work Buddy等经过Tong统一调用 | Codex已用，其余多为开发/协议调研 |
| F08 | 多Agent编排 | ChatGPT统筹多Agent依赖和结果交接、同项目冲突保护、单目标验收 | 合成/开发阶段 |
| F09 | 资源观测 | C/D磁盘容量/目录、RAM/CPU/GPU、进程/启动项/服务、网络与系统日志快照 | C/D/RAM/Tong递归/进程已实测，其余待扩展 |
| F10 | 电脑清理维护 | 发现/分类临时文件及缓存、持久长任务Plan/Execute、撤权、断线续查、真实释放空间核验 | 两批历史缓存及十套编译缓存已实删；完整5.636GiB候选0/10，38k文件同步Plan超时；[新专项任务书](maintenance/Tong-Autonomous-Disk-Cleanup-Taskbook-20261029.md)待开发验收 |
| F11 | 生产稳定性 | 原生进程监护、启动、故障诊断/恢复、版本pin/回滚、真实重启自动恢复 | 部分实现；native fast-fail及MONITOR_FAILED根因未解决 |
| F12 | 开发与知识管理 | 合理目录、AGENTS/任务书、GitHub代码记录、证据分层、受控升级及测试 | 进行中，D盘四个旧根未归并 |

## 3. 必须满足的产品交互原则

用户给出完整目标后，ChatGPT明确真正需要的项目、范围和交付条件，再选择直接Tong或指定Provider。预计需要多轮时优先使用持久Goal：任务ID、项目ID、Provider、原生Session ID、Turn ID、阶段、证据、截止/重试预算与结果绑定。同一目标中的正常子Turn结束**不能**发整项成功通知或要求用户每一轮确认，常见目标2–4个必要回合，不为了凑轮数多发无意义请求。只有业务成果经核验完成、用户必须操作或阻塞不可恢复时才集中报告。

Desktop的原生会话和ChatGPT的任务状态不是同一层：必须分别实测创建、在Desktop不退出重进可发现、同一Thread出现所有原生Turn、后续可继续、Writer不冲突、进度与结果准确。当前Goal后端支持状态查询，但ChatGPT**普通MCP在聊天回答结束后不能凭空持续更新旧消息**；如果宿主支持持续订阅/原生面板，就使用官方机制，否则提供真实查询状态和更新时间，或建设经认证的Tong进度看板。绝不使用静态假百分比或模拟会话冒充上线。

## 4. Provider接口与接入路线

Tong内部Provider Registry统一定义：
- discover/health：查可信安装、版本、登录/可用性，失败返回原因。
- capabilities：明确只读、写文件、终端、网页、GUI、成本、取消、原生Session恢复、是否Desktop可见，各自独立标记。
- authorize：Provider+项目+能力范围的本机权限，不能借用其他Provider隐式扩权。
- start/resume：任务和真实原生会话ID、cwd、幂等；优先复用指定或项目最近可用Session，不擅自新建替代旧会话。
- status/events：真实当前步骤/运行状态、脱敏输出、限额与时戳；后台任务能查询、不靠ChatGPT猜测。
- cancel/result：真实停止、恢复状态、代码/产物、错误、时长/资源或计费可读时记录。
- nativeLink：有官方支持的原生Desktop/网页会话地址并验收才返回；无则标“不支持”。
- isolation：文件/进程/网络/凭据范围、Windows Job和需要的Token门禁、超时/Writer保护。

顺序：①稳定Codex Desktop原生会话和Goal → ②Claude Code CLI受管Runner及恢复 → ③DeepSeek Harness（现有Desktop/CLI/SDK；必须先解决受限加载/执行安全） → ④Zcode/Zode（用户的名称需核对本机真实产品与协议） → ⑤Work Buddy → ⑥其他已安装Agent。先能力/授权/协议只读发现，再Mock合同、真实有限测试、项目隔离与审批、生产切换。DSH已有合成Runner和桌面CLI发现，历史受限子进程出现0xC0000022；不绕过安全门禁。Claude CLI原生恢复曾真实验收，但**不是**生产统一Provider或Desktop可见证明。

多Agent流程可以串行、必要时并行；保留结果来源与依赖图，受控中间文件/上下文传递，独立查验每个Provider产物；ChatGPT整项统一汇报，不允许Agent之间擅自共享所有本机权限。未来如果Agent失败，按用户指定和受管策略停止/重试/请求授权，不能静默切另一Agent交差。

## 5. Windows电脑资源观测和空间清理（用户长期要求）

用户今后可直接要求“扫描我的电脑”“D盘什么最占空间”“看内存和CPU”“帮我清垃圾文件”“定期检查电脑”。Tong应实现常用只读诊断→精确分类→按用户目标清理→复核的完整工作流：

**磁盘**：C/D及以后新卷容量、可用/已用、文件夹递归排序、大文件、重解析点、硬链接、重复的node_modules/venv、临时构建、下载/压缩包、历史日志/完整发布副本；报告逻辑文件大小与实际NTFS可释放物理占用的区别。扫描不默认阅读私人文件内容，不跟随junction进入未知位置。

**内存与系统**：真实物理RAM/可用/缓存/提交量、内存高占用进程、CPU占用、GPU/显卡驱动/温度（仅实际可读时）、开机启动项/计划任务/服务、网络/蓝牙/更新与运行错误。要有采样时间，不能以一次高占用就断定内存泄漏；不要因为用户想“释放内存”就擅自杀Windows/安全程序。清磁盘**不等于**清RAM。

**清理分类**：
A. 可重建、无当前依赖的缓存/临时产物：用户授权后可精确删除，不再额外制作整套备份；
B. 重复依赖与过时版本：先核对hash、锁文件、native补丁、正式启动/恢复引用，再按精确根删除，不重装大量副本；
C. 独有非敏感源码/文档：先保留在现有GitHub仓库或另建用户选择的仓库，用Git ref可恢复，禁止上传secret、OAuth/DPAPI、数据库、私有日志；
D. 正式生产pin/服务/真实业务/个人文件/原生会话：默认保留，需明确用户决定和正式系统操作门禁。

按准确LiteralPath删选中项，先记文件数/大小/引用/范围，删除后验证目录不存在、父目录存在、必要功能没断、实际空闲空间变化。不允许对D:\Tong\state、C盘系统目录、整个Downloads等执行模糊通配清空，不绕过拒绝访问的MCP权限。不要求把每次可重建缓存整目录再备份一份。空间清理属于**长期Tong能力**，不限于Tong项目自身；用户未要求动的其他项目和私密数据只做元数据观察。未来可建立受授权、已部署的周期报告及低剩余空间阈值提醒；不能假称当前已自动后台监控。

**当前现场数据**：2026-10-27 C/D、物理RAM、D:\Tong和四处旧根已实测，详见[2026-10-27本机资源扫描快照](maintenance/Tong-System-Storage-Snapshot-20261027.md)。未来必须标记“快照时点”，不能把旧数字当现在空闲量。

## 6. 目录治理和磁盘收敛

D:\Tong\app、runtime、tools\ngrok、生产pin指定releaseRoot、授权和恢复控制状态、共用Git主仓库/各worktree及node_modules目标保持原位。D:\Tong\state有大量重复完整测试环境，不能因为名字old/test就通配删除；但用户**明确要求精简**，后续应按高容量根优先验证可重建副本，避免保留每一轮测试的完整app、manager、node_modules与回滚副本。

当前最占空间的state根：p27-autonomy-candidate-20261017约7.03GiB，b23-switch-c104fcca2aa9约3.54GiB，native-codex-acceptance-20261018约2.87GiB，另有多份每根约1.12GiB的b23-login-*。生产pin及21个直接state任务路径引用必须核实后才能改动。有些事故根也包含独有证据；清理优先判断**精确子目录**而不是全根。

D盘四处旧项目（agentdock-poc、tong-agentdock-local、tong-codex-acceptance、tong-desktop-control）约4.90GiB，下一步统一管理到Tong下，但同盘移动不释放容量；必须先核对旧Git dirty/refs、授权项目ID、会话cwd、旧硬编码路径、敏感运行态。停止无意义新大备份；把可维护的小型非敏感源码与记录放GitHub，重复依赖确认后删。

## 7. 可靠性、测试与发布原则

2026-10-27生产经历doctor native 0xC0000409及MONITOR_FAILED，已最小恢复新run 2b871eeb-ea5c-4690-b4ec-d46454f3a9ed READY、正式doctor正常、网页MCP独立复验，但根因未解决；新的事故先看实时日志和新run，而不是根据历史EPERM/超时猜测。开发分支增加监控分阶段脱敏错误与真正异常记录、有限处理和任务恢复证据；任何生产版修改需独立评审、明确维护授权和回退流程，不修改main、不强杀Writer、不清锁、不随意重置预算。

测试先静态检查/针对性测试，再在已获准D:\作业\111真实端到端；代码成功、原生Turn成功、业务验收、Desktop用户目视、ChatGPT界面显示分别有不同证明。Git每次先status，保留dirty和untracked；只提交本任务文件到codex/分支，正常push，完成后报告commit与真实验收，不让每项操作都生成巨型副本/几十份重复md。

## 8. 全项目里程碑（长期执行顺序）

| 里程碑 | 任务 | 当前状态 | 验收标准 |
| --- | --- | --- | --- |
| M0 项目治理 | 总任务书、AGENTS、入口、存储扫描、日志/文件精简 | 本轮进行中 | 入口一致、现状真实、清理有证据无误删 |
| M1 生产可靠 | 原生异常诊断、守护与重启恢复 | 部分实现 | 原因可追踪、受管恢复、真实重启验收 |
| M2 单一Tong MCP | 工具合同、项目授权、直接本机操作 | 部分实测 | 真实网页直连、隔离和合法命令 |
| M3 Codex任务UX | 原生会话、Desktop立即可见、多Turn与网页进度、整项报告 | 部分实现，核心待验 | 不重启桌面能看新会话，业务步骤真实可查询，整体才汇报 |
| M4 Agent Provider SDK | 通用适配器/能力/授权/健康/会话 | 开发/规划 | 第二Provider通过**同一Tong任务接口**真实验收 |
| M5 其他Agent接入 | Claude、DeepSeek Harness、Zcode/Zode、Work Buddy | 开发/规划 | 逐个做真实新建、续聊、状态、取消、权限门禁 |
| M6 多Agent协作 | ChatGPT调度任务依赖、结果交接与独立验收 | 合成/规划 | 两种真实Provider在同一Goal协作并通过验证 |
| M7 通用PC维护 | 磁盘/RAM/CPU/进程诊断、精确清理、空间核验 | 部分实测 | 通用只读→清理建议→合法清理→验收完整可用 |
| M8 使用体验/交付 | 任务看板、跨对话恢复、可观察性、版本化部署与文档 | 规划/部分 | 用户可追踪任务/会话，失败可恢复且生产版本可审计 |

**优先推进**：当前M0（磁盘和文档）→ M1稳定性和M3任务UX（按故障风险与用户优先级安排）→ M4/M5多Provider → M6真正统筹 → M7/M8持续完善。M7日常诊断与磁盘清理可以随用户请求并行开展，不必等所有Agent先接完。

## 9. 后续每个聊天/Agent接手标准

先读根AGENTS.md、本总任务书及Tong-Project-Plan-and-Handoff.md，再读当前专项任务书和最新有证据记录；获取实时Git status、当前pin/Task/MCP schema，核对已有工作，不重复写架构与做同一个旧测试。任务归属M0–M8，记录状态、真正执行结果、剩余阻塞、下一准确动作、Git提交。跨对话仅通过少量索引文件/版本化源码交接，不复制敏感私有日志和整套恢复镜像。**未取得实机证据的一律标待验收，不把本总任务书当成生产部署/大规模删除授权。**

近期唯一主动执行范围：只读本机扫描、更新总任务书和项目规则；不在本轮继续删除或搬迁、重启/发布、改服务/凭据/ACL/预算。
