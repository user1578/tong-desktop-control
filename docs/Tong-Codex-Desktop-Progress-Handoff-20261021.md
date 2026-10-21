# Tong × Codex Desktop 会话可见性与进度回报交接（2026-10-21）

> **当前最新状态：2026-10-21 已部署 `7d11382`，生产健康且在 `111` 完成真实Codex任务验收。** 后文更早的版本、失败状态及“未部署”是历史时间点记录，不能代替最新现场。

## 2026-10-21 新一轮进度体验与会话复用开发（尚未部署）

- 用户已确认真实 Windows 完成提示卡可以看到；由于正在规划ChatGPT侧的分步骤进度展示，短通知时长可接受。不要再把本机弹窗时长当作首要问题。
- Codex原生会话的 **真正创建/继续、ChatGPT通过Tong发任务、任务完成后Desktop可见** 已实测成功。新会话运行中强制抢Desktop仍不保证安全，不列为已完成。
- 用户提议强制“每个新会话最少3轮、最多4～5轮”。评估决定：**不硬性限制**。同一项目与同一工作主题优先使用`sessionMode=latest`或指定`existing`，新目标、用户明确新建、长上下文或真实会话不可用才开`new`；3～5轮可作为软性观察区间，而非强制凑轮或打断。Tong之前本就默认`latest`，过去的一轮新对话主要由生产验收时人为指定`sessionMode=new`造成。
- 开发分支增加 `progress.checklist`，四项分别是“检查任务与授权”“连接Codex原生会话”“执行Codex任务”“收集结果并准备汇报”。各项只有收到持久化事件（实际原生线程接入回调、原生turn完成、结果已收集）才打钩；支持`pending/active/completed/waiting/failed`状态以及完成项计数。兼容旧版已完成任务的记录；恢复/重试会重置本轮的检查点。
- 这四项是**可核验的任务生命周期**，不是“需求分析、编码、测试、Git提交”等自动规划后的业务步骤；业务步骤仍需未来通过Codex结构化计划及对应证据单独映射，**不得靠AI生成的段落虚构进度百分比、自动打钩或宣称测试通过**。
- `tong_agent_status`和`tong_agent_wait`现有接口返回同一个progress对象，待新版本部署并刷新客户端工具schema后，ChatGPT可以按checklist展示可视进度。普通聊天轮次结束后它不会自动修改已结束的回复，也不能主动注入一条新的ChatGPT消息；前台持续查询必须保持活动轮次或交给真正支持通知的宿主。
- 针对性回归涵盖新建、已保存线程的`latest`复用、执行中四阶段状态、成功时四项完成、自动打开失败不影响Codex结果。**仅开发分支、生产仍为`7d11382`；不要未经再次发布审批覆盖生产。** 所有真实E2E测试都放在`D:\作业\111`，不再占用TravelGuard。

## 2026-10-21 生产升级与111项目验收（历史生产基线）

- 用户在本机PowerShell 7完成受控升级：`PRODUCTION-UPGRADE-OK`。App/Manager精确提交均为 `7d11382300b9635d60b598e54a40e1d5083f7bb0`，运行ID `02278c79-c0dc-4d76-94eb-cdd06838111d`；生产Manager `doctor.healthy=true`、`phase=ready`、受保护路径ACL检查全部通过；7676、7677、18765三个监听端口存在，最后复查登录监控为Running。
- **发布回滚快照**：`D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-full-cutover-20261020190433769-1aa422e5`。原生产 `376a328` 的App/Manager各275项源码快照已验证，新候选 `7d11382` 的278项源码及23项原生文件、补丁和SQLite native均校验通过。之后如需回滚应先复核当前运行与该快照的绑定关系，勿直接覆盖生产目录。
- 用户明确：**所有后续Tong/Codex功能测试默认只用 `D:\作业\111`（项目ID `p0-homework-111`），禁止继续在TravelGuard业务项目里反复创建验收会话。** `111`已由既有`D:\作业`根目录信任自动获得开发授权，但无git.push；它不是Git仓库，不应该为了测试而初始化Git。
- 真实E2E任务 `f97d8524-fee8-4cbb-8039-edecc5e1c502`，新原生会话 `01a15caf-bca4-7a53-98c8-e2adc0aef6f0`，`success`，约22.8秒。Codex只读列出 `111` 顶层目录，报告 `你好.txt` 一项（文件数=1）。任务Result的`changedFiles=[]`，随后独立查看`111`仍只有原文件，无修改。
- `tong_agent_sessions`确认会话标题已设置；`tong_agent_status.progress`实际返回执行中消息、commandExecution的started/completed及完成状态。日志有`Codex Desktop session deep link dispatched after turn.`与`Windows desktop task notification dispatched.`。**日志仅证明派发，最终Desktop自动打开和新提示卡是否由用户实际看到，仍等用户截图/口头确认；不得当作已通过UI验收。**
- **ACL根因修复有真实证据**：新版本Codex App Server使用独立的 `D:\Tong\state\codex-sandbox-temp`，该路径有沙盒SID访问记录；执行完整Codex任务前后，生产`D:\Tong\runtime\temp`的非预期ACE均为 **0**。任务完成后再次调用Manager doctor仍是`healthy=true`，生产ACL未再次受Codex沙盒污染。此结论为一次真实任务的验收，不表示未来所有Windows或Codex更新均不会改变沙盒行为。
- 用户之前已确认过新版开发测试的 `Tong · travelguard` 提示卡**独立测试可见**。本次生产`111`完成提示卡已派发，仍需要用户确认是否真的显示。该提示卡是Windows本地窗体，不是ChatGPT主动发新消息。
- Codex执行日志中的被忽略旧配置项和exa OAuth失败仍可能出现，但这次任务成功；若需要清理应作为独立事项，不能将其误认为本次生产验收失败。
- **功能边界维持不变**：运行中强行打开同一Codex原生会话可能受到Active Writer/跨进程加载限制，生产采用完成后自动打开；ChatGPT轮次结束后没有普通MCP可持续向该轮主动追加聊天回复。本地提示卡与有界进度轮询可部分改善体验。


## 2026-10-21 临时目录ACL再发生：必须在下次生产升级中解决（最新）

- 当前生产App/Manager的Pin仍是`376a328`，运行实例记录仍为`ready`且三个端口监听，但Manager`doctor`再次返回`ACL_DENIED`，登录计划任务读到`Ready`及上次返回码1。不能把端口监听等同于健康；下一步应先恢复健康。
- 精确复核：`D:\Tong\runtime\temp`又出现两条沙盒Modify ACE，其他受保护根目录未见同样问题。因为运行时`safeEnvironment(root)`将`TEMP/TMP`设为`D:\Tong\runtime\temp`，`trustedCodexEnvironment`原样传给Codex App Server，Codex Windows沙盒执行时很可能将沙盒SID写入该TEMP的ACL。这是已确认的环境继承链，但具体写入时点仍待升级后复验。
- 开发分支修正：只有当Codex子进程原先继承了精确的`<drive>:\Tong\runtime\temp`时，才重定向`TEMP/TMP`为同盘的`<drive>:\Tong\state\codex-sandbox-temp`。该目录由Codex App Server启动前按受控固定路径创建，不包含授权/凭据，不改其他进程、Windows系统环境变量或者生产Manager所用TEMP。不在真实项目根目录制造临时文件。
- 隔离环境、原生App Server及任务回归共5组通过；`Test-TongTrustedTasks`特地在项目授权测试临时路径下重跑。**本次尚未真实部署验证沙盒ACL是否彻底停止复发**。
- 正式收尾先恢复生产runtime/temp两条ACL（需本机审批；上次修复脚本备份文件已存在，不能盲目重复运行）；随后匹配双组件Pin发布、验证doctor健康、跑一条只读Codex真实任务，立即再次检查runtime/temp是否仍干净。失败则用受控回滚，不能静默放宽ACL或覆盖授权文件。

## 2026-10-21 用户反馈与修正（历史开发更新，仍未部署）

- 用户反馈：运行中手动深链接没有看到新会话，短时Windows托盘气泡也没有看到。**不得把之前“派发成功、任务不中断”写成“Desktop运行中实时可见”。**
- 结合Codex上游已公开的跨进程新会话索引、加载状态和Active Writer问题，已撤回开发分支中“运行中自动打开Desktop”的默认触发，**继续使用经过用户截图验收的“原生任务完成、writer退出后深链接打开”**。运行中进度通过Tong `tong_agent_status.progress`与有界`tong_agent_wait`提供，不能保证在Desktop渲染。
- 改为独立的**45秒可关闭本机任务提示卡**（WinForms顶层窗口），非Windows通知中心Toast、更不是ChatGPT主动发新消息。通知进程使用受限参数异步启动，不阻塞后续Codex任务。已在本机通过Win32窗口枚举检测到`Tong 任务提醒; visible=True`，但用户视觉确认及持久化生产自动弹出均待后续验收。
- 此前短命令启动后UI未留存，与执行工具可能清理子进程有关；已经用保持命令窗口存活的实际窗口可见性检查复核。独立受限测试`Test-TongTrustedTasks`曾受生产`runtime\\temp` ACL修复影响出现EPERM；改用项目根目录作为临时测试目录后原测试通过，**未放宽生产ACL**。
- ChatGPT已结束回复后的主动消息仍没有普通MCP可调用入口，继续明确告知平台限制；不要承诺“发完任务可自动向当前ChatGPT回复”。
- 开发修改仅推送`codex/`分支，**生产仍为`376a328`**；重新升级前按既定双组件匹配候选、回滚快照和本机审批流程执行。

## 2026-10-21 下一轮开发：运行中打开与任务完成通知（历史开发阶段，尚未部署）

- 用户已经用Codex Desktop截图确认上一轮生产版本`376a328`的**完成后深链接打开**可见、标题与最终回答正确；此前“UI待确认”已完成验收。
- 新一轮运行中实验（仍使用**生产旧行为，仅从外部手动提前发深链接**）：TravelGuard只读任务`fd9a30ff-a23c-472c-9d64-9f2932e821f9`，会话`01a15a7b-7d88-7211-9bd8-c779ec432ef4`。在命令执行started与completed之间发送`codex://threads/<id>`，Codex任务仍以success结束，约50.5秒，未改变项目。这**不证明Desktop实时渲染了每个中间状态**，仍需要用户UI确认。官方Codex还存在跨进程线程索引及writer锁问题，不保证所有版本同样有效。
- 开发分支新代码：新建受信会话在**第一个真实Agent输出/命令活动**后尝试一次提前深链接；不阻塞Codex执行；新会话提前打开失败则任务完成后再重试；续聊不重复抢桌面。打开日志记录during active turn与after turn的区分。
- 新增Windows完成状态通知：仅在生产默认任务管理器中开启，使用系统`NotifyIcon`，只包含受限项目ID与预定义任务状态，不回显提示词、代码和凭据；通知失败不改变任务结果。纯合成测试不弹窗；本机脚本实测正常退出，但**Windows UI是否展示弹窗由用户确认**。
- 这不是ChatGPT后台主动回复：普通MCP无法在已结束的ChatGPT回复之后自动追加消息。现有`tong_agent_wait`供**仍活跃的回复**轮询；Windows通知用于结束后的及时提醒。若追求ChatGPT本体后台通知，必须通过明确支持的计划任务/宿主通知能力，不能假装已有即时推送。
- **生产仍为`376a328`**；本轮开发改动未打包、未部署、未修改授权及生产Pin。应先做运行中UI观察/长任务竞态验收，再以新的匹配App/Manager候选和回滚流程升级。

## 2026-10-21 正式部署与真实Codex验收

- **精确版本**：App、Manager与本次运行实例均为 `376a328d429aff0a4d826b3b5278fcef7c0368b5`；runId `8a59e87a-0b0d-490d-b27c-c752f027a70d`。用户本机PowerShell 7正式升级回显 `PRODUCTION-UPGRADE-OK`。独立复验 `ready`、`doctor.healthy=true`、7676/7677/18765监听、登录计划任务Running、AgentDock已认证MCP及网关未认证拒绝。
- **发布材料**：`D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-release-376a328`，同级 `quick-trust-candidate-376a328`。275个源码、23个原生文件及DevSpace三补丁校验通过，SQLite native加载通过。App和Manager版本、PIN需始终一致。
- **正式回滚快照**：`D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-full-cutover-20261020173137481-54c213ae`。切换前对旧版App/Manager各270项源码、旧补丁/Pin/Profile/Runner完成验证。出故障先核实快照阶段、受控停止状态及对应登录恢复授权；切勿直接覆盖运行中的生产文件。
- **ACL阻塞解决**：用户通过本机交互确认精确移除 `D:\Tong\runtime\temp` 中两条额外Modify ACE。旧ACL SDDL备份为 `D:\Tong\state\p27-autonomy-candidate-20261017\runtime-temp-acl-before-376a328.sddl`。全部正式状态目录ACL检查通过。
- **现有授权**：TravelGuard仍保留`git.commit`和`git.push`；`D:\作业`整体的gitPush仍为false。本轮未修改或推送业务文件。
- **生产原生会话E2E**：任务 `60fc5bdb-af84-44e0-8642-a83c4a102a72`，新thread `01a15a73-50e9-7141-9351-abbe4d957d43`，状态success，执行约20.75秒，检查Git分支 `hsh/backend`、HEAD `1a61ae9b65a49894295ca77a0c9dde7f71ac2921`；changedFiles=[]、Git干净。
- **新增功能实测**：原生会话标题成功设置为以`travelguard · 生产验收...`开头（目前标题仍偏长）；`tong_agent_status.progress`实际记录Agent回复、commandExecution事件与终态。日志出现`Codex Desktop session deep link dispatched.`；**等待用户亲自确认Desktop是否即时显示窗口及内容**，不可把派发成功说成UI已验收。
- **工具可用性界限**：`tong_agent_wait`与`tong_project_prepare`已加入正式DevSpace与Gateway白名单；本聊天的现有连接尚未直接调用`tong_agent_wait`，客户端工具列表可能需刷新。ChatGPT轮次结束后主动发送消息仍未实现。
- **开发工作树保护**：原本2项已修改tracked文档和16项未跟踪文件原地保留，未进入发布提交。旧版代码历史结论仅供参考。



## 2026-10-21 后续研发更新：进度、标题、Git Push

- TravelGuard 任务 `a4291235-9394-4be4-8ac7-6f5217e8a833` 已核实为 `success`，真实耗时约17分钟；原生会话ID `01a159e3-a760-7252-9d30-68121a365a58`。功能验收仍要在业务仓库单独检查。
- Codex App Server在 **新建** 原生会话时调用官方 `thread/name/set`，用项目ID和任务首行生成简短标题；继续既有会话不改原有标题。标题调用失败不应破坏开发任务。
- `tong_agent_status` 现在返回 `progress`（阶段、最近Agent输出、最近命令/文件变更事件、活动时间、终结状态）。`tong_agent_wait` 是有界只读等待更新的MCP接口（1～15秒），供ChatGPT回复仍在进行时重复查询；同时加入Gateway验证和DevSpace工具白名单补丁。**已经结束的ChatGPT聊天轮次不会因为Tong后台任务推进而自行发送新回复**，主动通知仍需真实宿主机制。
- Codex Desktop会话**任务完成后**深链接自动打开功能由上一提交 `1434fbe`提供，本次没有改成运行中自动打开。原因是Codex的单写入者锁；在首轮任务执行时主动让Desktop加载同一线程可能阻碍后续Tong继续。用户此前验证的是“已完成会话的深链接立即可见”，并不是“运行中实时可接管”。
- 修复 `TongTrustedPolicy.authorizeDevelopment`：对于从 `D:\作业`继承的TravelGuard授权，单独追加 `git.push`时保留 `originTrustGrantId`，随后撤销父目录信任仍可撤销该项目授权；不提高其他项目的推送权限。新的单项目Git Push授权必须在**本机交互式确认**后由CLI写入，聊天指令不能绕过；生产策略仍未修改。
- 合成回归涵盖原生启动/恢复与标题、项目权限提升及撤销、任务进度返回、Gateway参数边界及桌面完成后打开。正式验证仍需新版本生产候选、匹配Manager/Pin和用户明确批准部署，不能把开发测试当生产验收。
- 当前Tong开发工作区原有2个修改文件和16个未跟踪文件属于用户现状，禁止混入此次提交。生产App/Manager版本仍以现场验证为准（上次为 `37dc649`），勿用Git HEAD推断已部署。


## 目标与用户实际体验

用户在 ChatGPT 网页版说“让 Codex 在某项目开发”后，Tong 自动使用已授权的项目创建或继续 **真正的 Codex 原生会话**，用户能够在 Codex Desktop 查到、打开、接管、继续会话。用户无需复制提示词或重复授权；正在执行的任务应有可查询的结构化进度，结束后 ChatGPT 能得到验收结果。不得把会话创建、模型实际生效、ChatGPT 主动推送消息混为一谈。

## 已核实的事实

1. 生产 Tong 的 App、Manager 在 2026-10-20 完整升级到 `37dc649`，此前通过 `ready` / `healthy=true`；本阶段 **未再部署**。
2. `D:\作业` 已持久信任，TravelGuard 项目授权含 read/write/command.execute/dependency.install/codex.session/git.commit，不含 git.push；勿重做该授权。
3. TravelGuard 项目 `D:\作业\26ict\TravelGuard`，原检查分支 `hsh/backend`，基线提交 `f793e77`。多人项目不得动其他成员分支或 main。
4. Tong 原生 Codex 通过独立 `codex app-server --listen stdio://`、`thread/start`、`turn/start` 工作；`tong_agent_sessions` 可发现创建的会话，即使 Desktop 尚未自动刷新。
5. 用户已实际确认：在 Windows、Codex Desktop 正运行时，`Start-Process 'codex://threads/<UUID>'` 能 **立即打开已经完成的那条原生会话**，无需重启应用。这是手动深链接实测，不等于后台自动触发已部署。
6. 代码分支 `codex/codex-desktop-deeplink-20261021`，提交 `1434fbe` 已推送 GitHub。改动含 `scripts/TongCodexDesktopLink.mjs` 及任务管理器调用，测试通过；**未部署到生产**。当前实现只在**新会话的首个任务结束后**打开；继续既有会话不抢焦点；链接失败不令成功任务失败。
7. 2026-10-21 用户又在另一个 ChatGPT 对话中启动 TravelGuard 真实开发任务：任务ID `a4291235-9394-4be4-8ac7-6f5217e8a833`、Codex会话ID `01a159e3-a760-7252-9d30-68121a365a58`。本次交接检查时 `running`，未完成验收，**不得先报完成或打断运行**。目标是 SQLite 旅行状态、异常记录、重规划草案失效和正式版本控制。可用 `tong_agent_status`、`tong_agent_logs`、`tong_agent_result` 跟进。
8. Codex Desktop当前版本先前实测为 `26.1013.3656.0`。用户截图中 TravelGuard 下会话标题均为冗长的 `Work only in the authorized project...`，可考虑按项目/任务设置可辨识标题，但须检验官方 `thread/name/set` 及权限边界。
9. Codex 的模型和推理强度仅写进任务提示词**并不能保证实际使用**；现有 Tong `tong_agent_start` 接口没有 model/effort 字段。应做受支持的配置与实际元数据验证，不允许把文字要求当成生效证据。
10. Codex App Server日志曾出现无效的 exa OAuth refresh 和被忽略的 computer_use 设置；目前不能据此推断 TravelGuard 任务失败。

## 两个不同问题（不可合并判断）

### A. 会话可见性

- 外部 App Server 创建后，Codex Desktop 侧栏可能不实时发现该会话。OpenAI Codex 仓库相关已公开反馈：#36363、#30895、#30916。
- 已验证“**任务完成后直接打开对应 `codex://threads/<id>`**”对当前 Windows 实例有效。
- 新代码未部署，所以用户目前看不到自动跳转，是符合现状的；不要误判为新代码的生产故障。
- 用户希望“任务**开始后**就出现”，但在外部 App Server 正持有 native writer 时，过早打开 Desktop 可能发生 writer ownership 冲突或 UI 不完整。**优先等当前长任务完成，先做只读核对与可回滚的合成验证，不要在正在执行的业务任务中试抢会话。**
- 安全方案可先坚持“完成后自动打开”，再验证能否在后台任务运行时安全只读显示；若不能，不以牺牲真实任务稳定性换取实时弹窗。
- 侧栏自然刷新与深链接主动打开是不同的验收项。深链接成功不证明侧栏能及时索引新会话。

### B. ChatGPT进度回报

- 当前 `tong_agent_start` 异步返回任务ID，`tong_agent_status`/`tong_agent_logs` 供客户端轮询；ChatGPT一轮回复结束后，普通 MCP 不能自行向已结束的对话追加一条 ChatGPT 回复。
- 用户截图中的另一产品执行中持续展示步骤，不能等同于当前ChatGPT网页会话原生支持这种推送。勿承诺“自动发送进度”除非平台真的提供了主动消息或订阅能力。
- 可以增加**结构化状态**（阶段、当前动作、最近事件、最后更新时间、运行时长、Git改动、测试概况、待审批），以及**有界的长轮询/订阅式查询**供ChatGPT保持活动的轮次持续显示；但它只解决活跃对话的查询体验。
- “用户离开后自动通知”需要实际支持通知/自动化的宿主能力和适当频率，不可伪装为 Tong 已拥有的推送能力；有定时任务也需明确频率与权限。
- 不要为每个 token 生成新进度条，考虑最近事件归并、阶段切换和完成汇报，避免刷屏、状态重复和机密信息外泄。

## 后续执行顺序与完成标准

1. **等正在运行的 TravelGuard 开发任务结束**，通过上述任务ID检查真实最终状态、日志、Git diff和测试；原项目工作树不能擅自改动。
2. 阅读并维护 `scripts/TongAgentTasks.mjs`、`TongCodexAppServer.mjs`、`TongCodexDesktopLink.mjs`、`TongMcpTools.mjs` 的现有实现；先查是否已有进度订阅、推送或状态整理机制，避免重复开发。
3. 聚焦一条最小可实现闭环：可靠获取进度（至少状态/阶段/最新有效日志）、首个任务结束后自动打开、失败不破坏任务、复用旧会话不抢焦点。验证是否能安全前置打开，不得在 writer 冲突风险尚不清楚时强推。
4. 如平台不具备聊天主动推送能力，准确提示用户限制，优先实现ChatGPT轮次内的有界等待和最终总结；不要宣称后台进度能自动出现在原聊天。
5. 验证新建、继续、失败、取消、超时、Desktop未安装、无图形登录会话、权限撤销、误重复触发；测试强度匹配改动，不能通过假装“可见”验收代替用户实际看到。
6. 新代码在独立 `codex/` 分支实施并按规则提交；用户现有未提交/未跟踪文件绝不能覆盖。生产 `37dc649`、Manager、发布Pin、恢复授权、回滚快照、ngrok、系统设置保持不变。
7. **生产部署需额外授权**，且App/Manager与Pin必须使用匹配候选并验证回滚。未部署前只报告“开发分支通过验证”，不要报告“生产已修好”。
8. Codex模型要求若纳入下一阶段，应以真实原生参数或元数据确认生效，不依赖提示词写“请使用模型”。

## 状态记录（实时状态可能变化）

- 2026-10-21：当前工作重点是TravelGuard长任务等待验收、Codex Desktop自动显示时机、ChatGPT进度反馈机制。
- 深链接：用户手动实测成功；开发分支实现+合成测试通过；生产未部署。
- 自动进度/主动消息：尚无实现和可验证的宿主推送能力。
- TravelGuard任务：交接检查时仍 `running`，之后必须重新查询。

## 相关资料

- https://github.com/openai/codex/issues/36363
- https://github.com/openai/codex/issues/30895
- https://github.com/openai/codex/issues/30916
- https://github.com/user1578/tong-desktop-control/tree/codex/codex-desktop-deeplink-20261021
