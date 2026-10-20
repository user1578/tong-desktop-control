# Tong × Codex Desktop 会话可见性与进度回报交接（2026-10-21）

> 本文是当前阶段的持续交接记录，不代表功能已发布到生产。更新前应重新核对任务状态和 Git 版本。

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
