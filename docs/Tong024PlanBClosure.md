# 方案B最后阻塞闭环（2026-10-24）

> **2026-10-25 独立复核更正：本报告的“四项闭环”、连续锁交接及 ngrok/监控因果结论撤回。** `archive()` 移走冻结后存在竞争窗口；精确 `34e2680` 无维护租约借用协议；PID 2728 是 services.exe，当前 ngrok 晚于历史故障创建。串行组件成功记录仍保留，但不是生产执行器或全量独立回滚证明。以 [独立复核及原生反例](Tong024PlanBIndependentReview.md) 为准，判定 NOT READY。

> 接手 `c001e0814e544989492a6ee2cfd9424f78568f98`，目标候选 `34e26801876d8b1a2fc874dddce72b0939924e87`。
> 不扩展 f182e55 维护架构，只关闭方案B四项生产恢复阻塞。不修改 `D:\Tong\runtime`、真实锁、事故文件、ACL、凭据、计划任务、pin。

## 判定

**独立复核后：四项阻塞未闭环；生产恢复 NOT READY。** 串行组件测试不能替代连续交接或原生全量独立回滚。

---

## 1. 生命周期锁最终交接 — 已闭环（隔离）

- 方案B（`34e2680`）的冻结是**瞬态** `open(backup.freeze,'wx')` + 成功/终态后 `releaseFreeze` 里 `unlink`。实测：`start→ready→doctor→安全停止` 后 `backup.freeze` **不存在**（`noResidualFreeze=true`），后续正常重启可重新 `open('wx')` 取得锁。
- 连续独占：旧 freeze 存在时拒绝启动；最后移走它后，其他进程即能抢占。精确 `34e2680` 直接 `open('wx')`，无后续分支的租约交接；同一编排器顺序执行不能消除窗口。
- `withMaintenanceFreeze`（f182e55 的持久句柄）会在控制进程退出后留下文件——这是 f182e55 机制的行为，**方案B不依赖它**，故方案B无残留。
- 测试：`tests/Test-Tong024PlanBOrchestrator.mjs` 覆盖成功（ready）、失败前拒绝（`RUNTIME_BUSY`）、安全停止后无残留；进程退出/监控接管的完整时序仍属生产模式（见第 5 节）。

## 2. ngrok 生产库存 — 只读诊断已定位

- **PID 40452（ngrok.exe）仍存在**，父 PID 2728，创建于 2026-10-23 12:27（对应登录恢复尝试），`ExecutablePath`/`CommandLine` **空（不可读）**，`CreationDate` 可读。
- **失败分支**：`TongRuntimeSecurity.ps1` 的 `inventory` 模式（第 80-86 行）在 `production` 模式下把 `ngrok.exe` 加入 `backendNames`，任一 `CommandLine/ExecutablePath/CreationDate` 缺失即 `throw 'backend inventory unavailable'` → `.mjs` `run()` 映射为 `SECURITY_UNAVAILABLE`。
- **与启动门禁的关系**：方案B启动路径（`guardianComplete→oldRuntimeGone` 用 `processIdentity`(单PID) + `runtimeJobState` + 端口；`runtimeStatus` 用 `processIdentity`）**不调用 `inventory` 模式**。`runtimeProcessInventory`（inventory）仅被 f182e55 的 `TongMaintenanceTransaction`/`Tong024ProductionMaintenance` 使用。故**ngrok 不阻塞方案B启动门禁**。
- **所有权更正**：当前 ngrok 由 Windows 服务托管，父 PID 2728 为 `services.exe`；不在旧 runtime 身份集合内，不能推断为登录 runner。
- **受支持方案**：inventory 对不可读 ngrok **fail-closed** 是正确的（不把未知当安全）；解决需以能读 ngrok 元数据的上下文运行库存（属环境权限），**不能**忽略 ngrok 或放宽身份校验，也**不能**擅自结束该进程。
- **MONITOR_FAILED 复现风险**：恢复 runtime 后，登录监控若仍以不可读的 ngrok 身份做健康检查，仍可能 `SECURITY_UNAVAILABLE`→`MONITOR_FAILED`。这属于监控路径，不影响启动门禁，但生产恢复前必须定位。

## 3. 方案B专用恢复编排 — 已实现并隔离验证

`tests/Test-Tong024PlanBOrchestrator.mjs` 复用已验证的归档规则、生命周期锁与原生安全组件，最小改动串联：

```
旧024记录 → RUNTIME_BUSY拒绝 → 密封快照 → 受控归档(freeze最后) → 字节级回滚 → 再归档
→ 完整34e2680安装(299源+23原生+4依赖) → profile/双pin/授权绑定 → start → ready → doctor → 安全停止
```

实测（退出 0）：`rejectBefore=RUNTIME_BUSY, rollbackRestores024=true, installed=true, ready=true, doctorHealthy=true, agentdockAuth=true, gatewayAuthBoundary=true, stopped=true, noResidualFreeze=true`，runId `5ffdaefb-42d0-4004-bfc5-4b6510f82c3c`。

- 控制记录回滚：字节级一致（`runtime/guardian/request/abort/backup.freeze`）。
- **独立进程回滚与源码/原生/profile/双pin/授权全量恢复**：控制记录已在隔离回滚；**源码+原生+profile+双pin+授权的生产模式全量独立回滚未验证**（需 024d5b0 release 的 `buildRelease`+`restoreRelease`，024d5b0 的 283+23 绑定已由 `Test-Tong024BaselineBinding` 只读核对）。

## 4. 真实发布验收证据 — 已完善

`tests/Test-Tong024PlanBRealStart.mjs` 现测试内执行 `verifyRelease`（manifest 完整性 + 归档哈希）并断言：

- `verified.commit === 34e26801876d8b1a2fc874dddce72b0939924e87`（精确）。
- 299 源文件 + 23 原生；`code/source.tar` sha = `sourceDigest=d38ee4d…`。
- 显式 `verifyRuntimeCandidate(profile)` 与 `verifyRuntimeCandidate(profile,{manager:true})` 双组件通过（App/Manager 各自绑定 commit）。
- 完整 `start→ready→doctor.healthy→安全停止`；AgentDock **认证 MCP**（`authenticatedMcp=true`，含 tools/list）与 Gateway **未认证拒绝(401)** 均断言。
- 原始 stdout/stderr/退出码经 `command()` 捕获；发布哈希与 runId 落盘于测试输出。

> 未做 Gateway 的 OAuth 认证后 `initialize`/`tools/list`（需 OAuth client-credentials 流程）；已认证 MCP 的 tools/list 由 AgentDock 认证通道覆盖。

## 5. 生产恢复仍缺少的条件（NOT READY）

1. **生产模式维护入口仍禁用**：`withMaintenanceFreeze` 对 `mode!=='production-simulation'` 抛 `MAINTENANCE_NOT_READY`；生产归档/安装/独立回滚未在生产模式跑通。
2. **全量独立回滚未验证**：源码+原生+profile+双pin+授权的生产原生恢复（024d5b0）未验证，仅控制记录字节级回滚验证。
3. **ngrok 身份不可读阻塞完整生产 inventory**：不能据此认定登录监控直接失败；历史 `MONITOR_FAILED` 精确根因仍 UNKNOWN。
4. **生产现场绑定未核对**：`D:\Tong\app`/`releases\manager` 与 024d5b0 pin 的只读完整绑定需在获批窗口核对。
5. **误写 `maintenance-transaction.json`**：方案B不经过它，不阻塞；未来完整维护仍需另获授权处置。

## 6. 精确提交 SHA（本轮交付，提交后补）

- 目标候选 `34e26801876d8b1a2fc874dddce72b0939924e87`
- 生产基线 `024d5b0920d9ad8f1a2baf2e55640a5666ad4739`
- 本轮 release `sourceDigest d38ee4d6141f430666088d08638f7d5022961e21097f153b915b990cd53b66d9` / `releaseDigest 160e33da2fbb2d9ba598e31897e83ea1d47073d2ad3844055edb962d23ef9062`
- 本轮真实启动 runId `5ffdaefb-42d0-4004-bfc5-4b6510f82c3c`（orchestrator）、`848342f1-8a79-4e8a-a7d5-3e8da1c75715`（real-start）

## 结论

原“四项闭环”结论撤回。**生产恢复 NOT READY**：精确候选无连续交接、生产执行器及全量独立回滚未实现/验证、完整库存未知、正式登录接管未验证。生产绑定后来已只读通过，详见 2026-10-25 独立复核；未执行生产恢复。
