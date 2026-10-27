# Tong — ChatGPT任务级Codex调度、桌面原生可见性与网页进度专项任务书

版本：2026-10-27。执行入口：D:\Tong\development\tong-024-startup-recovery；主开发源码位于D:\Tong\development\tong-desktop-control（共享Git worktree，不得拆散）。本任务书定义**目标、现状、分步实现和验收**，不是完成证明，也不授权立即生产发布。

## 1. 用户需求（不可弱化）

1. 用户在ChatGPT网页给一个完整任务；若指定“让Codex做”，ChatGPT经Tong下发真实Codex原生任务，原生会话可在Codex Desktop看到并**从该对话继续**。用户没指定Agent时，ChatGPT通过Tong直接操作，不能无故叫Codex。
2. 同一目标可能需要多轮Codex执行、检查、修复、再测。ChatGPT承担主Agent监督，**子Turn完成不等于目标完成**；用户只在整体通过或真有无法自动处理的阻塞时收到结论。常规目标期望2–4轮，不为了凑轮数强制继续，最长以步骤/时长/成本预算限制。
3. Codex正在工作时，ChatGPT一侧展示“正在处理哪个目标、当前步骤、已验证步骤、Agent状态/证据/阻塞”；进度应反映实际阶段，能主动查询状态。若宿主支持订阅/长连接，可做持续更新；不支持时应通过当前活动回复有界轮询与明确的“上次查询时间”展示，不得声称后台常驻实时刷新。
4. 桌面端**不应每次退出重开才能看到新对话**。调查会话创建、app-server/CLI持久化、Desktop列表缓存/同步、deep-link、project根和writer所有权；提供不影响正在执行writer的显示/刷新路径。必须由用户目视/测试证明确实显示，不能用“deep-link命令成功/桌面进程存在”替代。
5. 任务与上下文跨会话能恢复：同一goalId关联projectId、nativeSessionId、child turn、验收证据和报告；中断之后查询/继续已有任务，不默默新建会话。

## 2. 现有实现和缺口（先复用，不重写）

| 模块 | 已有代码/实测 | 缺口/限制 |
| --- | --- | --- |
| 原生Codex调用 | TongTrustedCodexBroker、TongAgentTasks、TongCodexAppServer；原生SessionId/TurnId、start/resume、幂等、取消已有 | writer冲突、不同Desktop客户端实时可见性须专项核实 |
| Goal Supervisor | scripts/TongGoalSupervisor.mjs；tong_goal_start/status/list/result/cancel/review/resume；同目标多Turn共享原生Session；历史D:\作业\111 真实验收 | 复杂任务终态必须经业务独立验收，不能单看turn success |
| 真实进度 | Goal有technicalCheckCount、completedCount、businessComplete、steps proofLevel、current child phase、cursor；开发已有tong_goal_wait实现 | 本会话Tong公开工具未列tong_goal_wait；正式工具版本需明确验证，客户端UI没有自动常驻刷新 |
| 桌面端 | TongCodexDesktopLink.mjs用codex://threads/<nativeId>；历史对话可见、可继续；Goal完成后统一deep-link/通知 | 用户反馈新消息可能需完整重启Desktop才出现；多轮Goal运行中桌面端立即显示尚不稳定/未验收，终态通知不能替代运行中可见 |
| 多Agent | Codex以外Claude CLI及DSH已形成部分独立/合成模块 | 不是本专项前置，不可假装生产多Provider可用 |
| 持续可靠 | 2026-10-27已最小恢复READY/MCP；异常链native_fast_fail与MONITOR_FAILED已定位触发位置 | 根因未定位，正式任务执行需先检查runtime确实健康 |

**特别注意**：当前 goal_start 的工具说明明确“内部子Turn不打开Desktop，整个Goal结束才打开并通知”。这可避免抢writer，却与用户要求“运行中即可在Desktop看到”有张力。**不能把此行为说成已满足运行中可见**，要设计无需占用writer的早期会话展示/只读同步，在真实Desktop验收后才上线。

## 3. 实施任务、输出和严格验收

### T0 — 基线/配置/证据冻结（只读，最高优先）

- 查当前安装版App/Manager来源pin、工具schema、git status、原生Codex sessions和目标数据；确认是否暴露goal_wait，核实D:\作业\111的持久项目grant。
- 选择已有可用的原生Session作复查；对用户未指定会话默认项目最新有效会话，若是不同目标且已存在writer，按现有受管所有权流程处理。
- 验收：给出现有模块→真实工具→桌面列表能力矩阵；明确每项“已真实验证/仅合成/未部署/未验证”；不动生产、不生成测试副本。

### T1 — 整项任务监督语义和真实业务验收（P2-核心）

- 优先走tong_goal_start，分解3–5个有序业务验收步骤，尽量使用review-required作为最终门禁；每个child同一nativeSessionId、有唯一turnId和parentGoalId。
- 保持“technical-only”和“businessAccepted”严格不同：Codex反馈拒绝/未完成/工具政策阻塞不得打业务完成勾；文件存在/metadata只提供低强度技术证据。真正代码任务应核对diff、有效测试、日志与明确用户验收目标。
- 中断时保存同一goalId、sessionId、step、attempt、idempotencyKey、进度，能继续同一会话，不重复执行高影响动作。
- 验收：3步骤真实开发任务中，至少一次需要修复/二次检查；每个Turn后goal仍处于running/awaiting-review，**不能提前发整项成功通知**；只有最终独立验收通过才businessComplete=true、终态一次通知/一次总报告。人工审批真实阻塞时及时显示，不假完成。
- 优先新增针对性测试在tests/Test-TongGoalVerifiedProgress.mjs、Test-TongGoalDesktopHandoff.mjs和Test-TongGoalSupervisor.mjs内，避免另造目标监督器。

### T2 — Desktop会话无需重启的可见性/同步（P2-核心）

- 真实调研Codex Desktop已有thread列表和session持久化/通知的官方受支持路径，不直接写私有session DB、不注入内部文件、不强占writer；区分“列表可见”“打开同一thread”“内容是全部原生Turn”“Desktop实时刷新”“后续原生续聊”。
- 对当前一次新goal，在执行期即找到准确threadId，检查Desktop**不完全退出、不重新打开App**时能否发现及打开；观察具体失效发生在哪一层，形成复现脚本/短日志（不存隐私正文）。
- 实现安全的可见性/通知策略：不可因提早deep-link导致Desktop抢占writer、阻塞后续Codex child；如果平台没有只读刷新API，明确支持边界，优先以Goal进行中状态卡+终态deep-link实现可用替代，不做不可信黑客式注入。
- 验收：在D:\作业\111做至少一次真实新会话+2个原生Turn。用户**亲眼确认**无需完整重启Desktop即可发现，后续两轮出现在同一thread且能继续；无法做到时必须标未通过，不以Codex进程存在/命令退出0替代。测试不能篡改授权或关掉用户桌面端。

### T3 — ChatGPT网页运行中进度展示（P2-核心）

- 后端读取 tong_goal_status 的goalId、stepIndex、steps、technicalCheckCount、businessComplete、current.phase/message、updatedAt、cursor；若部署工具实际提供tong_goal_wait则用<=15秒有界等待。不得直接读取私有任务日志或未授权会话原文。
- 展示字段：任务名称、projectId、原生session是否建立、当前child步骤、具体活动消息、已验收/技术已检查/待审查数量、最新更新时间、阻塞原因；用非成功状态标注没有证据的步骤。
- ChatGPT在**当前正在处理的回合**展示可读的结构化状态/进度；有变化时刷新文本或支持的交互展示，但不每次child结束都发“任务已完成”。若要用户所说“持续存在且自动更新的面板”，独立评审ChatGPT宿主支持的订阅与生命周期；如平台暂不支持，只能提供真实查询/当前回合更新或另设受权Web看板，不可伪装平台能力已上线。
- 验收：任务实际运行期间至少3个不同时间点取状态，有不同step/phase的真实变化；用户看到的“已完成”必须有独立业务证据；任务结束后面板终态与唯一正式报告一致；回复已结束后不能凭普通MCP声称自动推送。

### T4 — 完整目标报告与桌面/网页跨端一致性

- 终态报告仅一次，包含目标结果、已完成项、未完成项、关键文件/commit、测试、原生Session ID与Desktop可操作入口、下一步；child日志属于内部过程，不用每轮生成Markdown文件。
- user-action-required/blocked主动提示具体受阻步骤、原始错误、受管恢复方法；用户操作完成后沿用goalId+sessionId，避免新建替代会话。
- 验收：完整Goal多轮结束总报告一次、Desktop终态显示一个项目会话、ChatGPT状态与Git/本机文件实况一致。由用户目视验证桌面可见，不做仅合成的“目测”推断。

### T5 — 运行可靠性与生产交付（独立阶段，不和T0-T4混合部署）

- 结合2026-10-27真实native_fast_fail与MONITOR_FAILED事故单独在开发分支加强阶段/错误诊断；不扩大自动重启与预算、不替换正式pin、不以T0-T4功能修复触发生产重启。
- 先源码diff/有界模拟回归→一次授权测试目标D:\作业\111→生产候选签名、身份/ACL/回退验证→单独批准部署。部署后再让ChatGPT网页实际查询、用户Desktop目视确认，不拿开发版成功冒充正式上线。
- 本专项所有源码与测试提交至授权codex分支。保留现有未提交文件、共享node_modules和生产旧事故证据；不修改main、不force push。

## 4. 任务启动前置与阻塞处理

- 先核对Tong是否ready和可用工具。如果连接器失败，返回原始错误；不能说已经下发Codex。用户本机可从已授权Codex Desktop直接执行本任务书，取得真实session和commit后再回到ChatGPT核验。
- 项目无grant时按受管项目准备/本机一次性授权走流程；已有可信项目普通开发不重复审批。高影响生产、删除真实数据、系统级变更需独立明示授权。
- Codex Desktop中存在active writer时不删lock、不结束App、不伪造旧thread。安全的排队/恢复策略优先于“立刻执行”。
- 小问题按必要轮数完成，不盲目达到固定4轮；若任务进度长时间不变，应核对真实后台状态、deadline与工具记录，不能根据静态百分比给假进度。
- 中间状态更新应简短，有意义；只有目标完成/关键阻塞才给正式结论。若宿主无法在回复结束后推送，明确告知用户需要重新查询，不能许诺后台继续回消息。

## 5. 运行和文档规范

- 主要复用 scripts/TongGoalSupervisor.mjs、TongAgentTasks.mjs、TongCodexAppServer.mjs、TongCodexDesktopLink.mjs、TongMcpTools.mjs、TongMcpGateway.mjs；目标任务测试复用现有对应tests。
- 每完成T0/T1/T2/T3/T4，**更新本任务书状态行**并附Git提交+真实测试证据，不拆成几十份说明。必要审计证明引用既有docs/Tong-Codex-Desktop-Progress-Handoff-20261021.md，不重写旧实测。
- 最终只以“具体目标已实现且真实端到端验收通过”作为Done；不能因为Codex给出自然语言success或Window通知发出就宣称已经实现用户所要的体验。

**当前任务状态：T0待开始；T1部分代码已有、待针对性业务端到端验收；T2尚未解决用户所述偶发列表不刷新；T3后端状态查询可用但ChatGPT自动常驻面板未实现/验收；T4已有基础Goal终态通知但需业务和Desktop整体验收；T5独立稳定性专项待实施。**
