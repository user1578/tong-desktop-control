# Tong Codex原生会话所有权调查及恢复策略（2026-10-18）

开发分支：`codex/active-writer-session-recovery`。本轮仅修改开发仓库，未部署生产。生产固定版本仍为 `bb234ec794c1d8180586781c92601f2eae95e750`。

## 本机只读事实

- 本机Windows Codex Desktop可见 `ChatGPT.exe` 作为父进程的 `codex.exe app-server`；同机还有独立的 `codex.exe app-server --listen stdio://`。
- Desktop进程未通过命令行声明供Tong使用的公开监听地址；检查的Codex进程没有TCP监听端口。
- `~/.codex/app-server-control/app-server-control.sock` 文件存在（reparse point，最后修改时间为2026-10-12），**存在不证明该Socket与当前Desktop writer是同一个服务**。本轮未连接该Socket、未改ACL、未操作锁、未结束进程。
- 生产Tong仍健康；前一阶段 `tong_agent_sessions` 的MCP请求曾返回 `Session terminated`，不能据此认定Codex会话内容损坏或writer已释放。
- 上游官方Codex仓库Windows及跨App Server讨论记录了多个active-writer冲突案例。共享App Server/daemon接口处于发展中，不能根据实验性命令或社区环境变量直接假设当前Windows Desktop支持无损共享。
  - https://github.com/openai/codex/issues/37450
  - https://github.com/openai/codex/issues/40134
  - https://github.com/openai/codex/tree/main/codex-rs/app-server-daemon

## 已落地的开发修复

1. JSON-RPC `thread/resume` 返回 `-32600 already has an active writer` 时转为 `CODEX_SESSION_ACTIVE_WRITER`，保留原threadId、任务可恢复，绝不强制抢占。
2. 只读 `thread/read` 明确报告非idle、不接受输入时转为 `CODEX_SESSION_NOT_READY`。两种情况均不调用 `thread/start`、`turn/start`；在用户允许且写入权释放后才能通过 `tong_agent_resume` 继续相同ID。
3. 默认 `sessionMode=latest` 选最新的**匹配项目会话**，不再默默跳过被占用的最近会话而切换到旧会话。返回列表另加 `writerOwnershipVerified:false`，因为另一个App Server报告的 `idle/notLoaded` 不代表当前真实writer空闲。
4. 测试覆盖被占用、当前仍在运行、原任务恢复、会话ID不变、权限及授权原有流程。

## 尚不能声称已完成

- 未取得官方稳定API用于第二客户端连接到当前Windows Desktop已启动的私有App Server，更没有证明共享同一个writer实例。
- 未对真实Codex Desktop会话发起新turn或进行writer交接；仅开展源码模拟回归和本机进程/Socket元数据只读核验。
- 旧 `thread/list` 只返回候选会话元数据，并非真实跨进程writer租约证据；不可根据 `notLoaded`、无TCP端口、闲置UI或单一锁文件自行删除、接管会话。
- 正式生产仍保留此前验收版本；此次开发修复尚未发布。

## 下阶段验收门

- 在不影响现有Desktop会话的前提下，用受支持的API确认writer所属、共享连接可用性、准确会话状态；无受支持连接时维持显式暂停/同ID重试路线，不部署任何私有管道注入。
- 先用专门的测试项目和独立的Codex原生会话执行创建→Desktop可见→继续→取消→恢复→结束；由用户确认Desktop界面确实可见。
- 如需让桌面端和Tong共用受管App Server，必须确认当前Windows构建正式支持、同一实例连接与鉴权，单独准备回滚，绝不在本轮无审批改变Desktop启动参数或版本。
- 以Tong作为调度中心为长期目标：Codex、DSH及其他Agent的适配器应独立，每个Agent真实会话与进度可追踪；不以模拟测试替代真实桌面验收。

所有旧测试材料、历史目录、生产登录设置和未提交文件继续保留，最后统一清理。
