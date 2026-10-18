# Tong 下一阶段：原生会话取消恢复与连接稳定性（2026-10-18）

开发工作区：`D:\Tong\development\tong-desktop-control`，分支 `codex/active-writer-session-recovery`。本阶段仅开发修改与本机只读诊断；正式运行Tong、Windows网络设置、Codex登录信息、生产服务、现有项目均未改动。

## 基于真实结果的事实

1. 先前在 `D:\作业\111` 的原生会话已经验证了新建、Desktop项目分组展示、Desktop退出后Tong继续同一会话、Desktop重进后看到追加回复，以及从Desktop侧边栏移除项目入口而不删除本地文件。
2. Desktop持有writer时，另一App Server调用 `thread/resume` 返回 `-32600 already has an active writer`；Desktop完全退出后同一ID续聊成功。当前不能声称实现了两个客户端同时写入。
3. 几次真实模型调用的日志都出现从 `Reconnecting... 2/5` 到 `5/5`，最终有些通过HTTPS回退完成；Exa OAuth另报 `invalid_grant`，尚无证据证明Exa导致了模型WebSocket重试。
4. 本机只读网络检查：WinINET用户系统代理已启用并指向 `127.0.0.1:7897`（TCP端口监听正常），WinHTTP为直连，当前PowerShell进程未设置 `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`。这一形态与上游Windows Codex WebSocket代理问题高度相似；不是确定的唯一根因。
5. 相关上游案例（均为供验证的外部报告，不能代替本机网络A/B）：https://github.com/openai/codex/issues/29958 、https://github.com/openai/codex/issues/24045 。

## 此阶段落地的代码

- 修复取消后的恢复：仅当可信Windows Codex任务已持久化原生 `codexSessionId`，且已进入 `cancelled` 时，`resumeAvailable` 返回真，用户可显式 `tong_agent_resume`。从未创建原生会话的取消任务仍不可恢复；独立隔离执行器保持原有行为。恢复沿用原会话，不生成新会话，重新执行授权检查并要求新的一次性本机确认。
- 增加取消后恢复的回归：模拟真实执行中取消、原生会话ID保留、状态为取消且可恢复、重新审批后继续原生ID；未审批即取消的任务不可恢复。
- 增加**可选**本地代理：可信Codex子进程的环境变量 `TONG_CODEX_PROXY_URL`（如果显式在受控的Tong启动环境设置）只接受无凭据的本机HTTP(S)代理，例如 `http://127.0.0.1:7897`。仅向Codex子进程传递 `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY`，不会修改系统代理、代理应用、全局环境、Codex配置/认证文件，亦不会自动继承远程/带凭据代理。默认**不启用**，本机既有正式生产不会自动改变网络行为。
- 回归测试覆盖本机IPv4、localhost和IPv6回环代理，以及远端代理、账号密码、非法协议、URL参数、未指定端口等拒绝场景。

## 真实验收尚未完成的项目

1. 真实Codex任务在执行过程中被Tong取消，是否及时中断且仅停止所属的Codex turn，不影响其他会话；重新授权后是否成功恢复同一个原生会话ID，并由Desktop实际看到续聊。
2. 上述可选代理在实际Codex App Server中的网络A/B比较：一轮沿用无代理环境，一轮给Codex子进程配置本机回环代理，记录重连次数、处理耗时、成功率。必须先在隔离开发候选中验证，然后独立决定是否发布、是否为生产配置本地代理。不能根据社区案例直接变更系统代理或强制使用其他模型。
3. 跨客户端的writer并发仍是Codex单writer限制。维持显式 `waiting_user_action` + 原会话ID保留的开发修复，不强制接管、删除锁或结束其他客户端进程。

## 发布边界

代码只在开发分支；若要将这些修改推到正式Tong，需要额外打包候选、审查差异、执行针对性测试，并获取明确的生产更新批准。旧的 `111` 测试会话、归档日志及尚未提交文件均保留，统一清理待最后单独确认。
