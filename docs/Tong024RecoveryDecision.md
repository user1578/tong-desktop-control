# Tong 生产服务恢复 — 只读诊断与恢复决策报告（2026-10-24）

> **历史报告，方案B建议已撤回。** 用户已停止方案B/3号/复杂离线研究；当前采用 [当前Windows最小操作单](TongCurrentWindowsRecovery.md)。下文“已确认根因”等措辞不能作为今天的归因：历史MONITOR_FAILED仍UNKNOWN，原版2号与开发分支的清理协议必须区分。原始观察继续保留。

> 结论先行：**优先采用方案 B（仅 `34e2680` 最小启动修复）恢复基础 MCP 服务，不把完成整套维护事务系统（`f182e55`）或解决 `0xC0000409` 作为前置条件。**
>
> 本轮为只读诊断与代码分析，未执行任何生产安装、启动、停止或恢复，未修改、移动、删除任何生产锁/事故文件/pin/profile/ACL/凭据/计划任务/ngrok 配置，未修改 main。

---

## 0. 摘要（七问速答）

1. **Tong 原来正常运行的最后一个可证实版本**：有完整验收记录的版本为 `376a328d429aff0a4d826b3b5278fcef7c0368b5`（生产 E2E）与 `7d11382300b9635d60b598e54a40e1d5083f7bb0`（生产 + 111 Codex 验收）；**最后部署到生产并实际“ready + 服务认证 MCP”的版本是 `024d5b0920d9ad8f1a2baf2e55640a5666ad4739`**（运行 `74cd4ad3`，约 11.5 小时后以 `abnormal_exit` 结束）。
2. **生产实际状态**：源码/Manager/profile/双 pin 均指向 `024d5b0`；服务**已停机**（无 node/agentdock 进程、7676/7677/18765 无监听、无 ngrok）；最后一次运行处于 `abnormal_exit`，后续两次自动启动被 `CLEANUP_REQUIRED` 拒绝。
3. **主要阻塞**：旧启动流程在异常退出后无法产出“清理证明”（固定等待预算 + 进程身份不可读 `SECURITY_UNAVAILABLE` + 清理证明缺失），Manager 因此拒绝 start。
4. **最适合的方案**：**B（`34e2680`）**——修改范围最小、直接命中已确认根因、隔离环境已验证 ready/doctor/安全停止/1ms 超时清理，且不依赖新维护工具与 `0xC0000409`。
5. **能否绕开 `0xC0000409` 先恢复基本 MCP**：**能（原则上）**。`0xC0000409` 只出现在 `f182e55` 完整维护系统的“组合回滚”测试，不出现在基础服务 `024d5b0` 与最小修复 `34e2680`；基础 MCP 服务本身是好的（`024d5b0` 曾 ready 并服务认证 MCP）。
6. **推荐路线步骤与回退**：见第 6 节。
7. **是否已具备申请生产恢复批准的条件**：**尚未完全具备**，缺 3 项生产现场原生证据（见第 7 节），但方案已可进入审查。

---

## 1. 故障前后版本变化还原

### 1.1 版本时间线（已确认：来自 `git log` 与 `docs/Tong-Codex-Desktop-Progress-Handoff-20261021.md`）

| 日期 | 提交 | 说明 |
|---|---|---|
| 2026-10-21 | `376a328` `test: verify newly registered production MCP tools` | 生产部署 + E2E（`fdbd699` 记录） |
| 2026-10-21 | `79e98b5 … 7d11382` | `7d11382` `fix: isolate Codex sandbox temp` 生产部署 + 111 Codex 验收（`6bafe85` 记录） |
| 2026-10-21 | `9229619 … 4ebdbc3` `edd9b01` | Codex 会话/可视化/目标监督开发；`4ebdbc3` 生产升级确认 |
| 2026-10-22 | `1a78e48` `feat: expose evidence-backed live goal progress` | Codex 进度可视化 |
| 2026-10-22 | **`024d5b0`** `fix: reject incomplete Codex turns…` | **最后生产基线（当前生产源码）** |
| 2026-10-22 | `d780561` `fix: make Tong cutover readiness…race-safe` | 升级候选（未上生产） |
| 2026-10-23 | `5362210` `fix: verify login monitor descendants…` | 升级候选（本轮不继续） |

### 1.2 关键结论

- **最后有实际成功运行证据的生产版本 = `024d5b0`**：运行 `74cd4ad3` 于 2026-10-22T14:19:03Z 达到 `ready`，gateway/agentdock 日志显示认证 `/mcp` 持续返回 `200/202` 直至 2026-10-23T01:50:34Z，随后 abnormal_exit（见 2.3）。
- **有完整书面验收记录（PRODUCTION-UPGRADE-OK + doctor.healthy + 认证 MCP + 原生会话）的版本 = `376a328`、`7d11382`**（二者均有 `PRODUCTION-UPGRADE-OK`、`doctor.healthy=true`、7676/7677/18765 监听、登录任务 Running、Codex 原生会话 E2E `success`、`changedFiles=[]`）。
- **计划升级目标**：`d780561` → `5362210`（Codex 可视化 + 登录监控竞态修复）。
- **升级实际进度**：生产只部署到 `024d5b0`；`5362210` 已构建候选（`D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-5362210`、`quick-trust-release-5362210`），但生产升级未完成——生产运行在 2026-10-23T01:51Z 异常退出后无法重启，升级被阻塞。
- **源码/Manager/profile/双 pin 一致性**（见 2.2）：三者当前都指向 `024d5b0`，**无版本冲突**；但存在“manager-pin 与 release-pin 字节一致、未独立分离”和“`releases/candidate` 目录陈旧”两个待澄清项。

---

## 2. 当前生产状态（只读诊断）

### 2.1 关键文件核对（本机实读，SHA256 实算）

| 文件 | 大小 | SHA256 | 要点 |
|---|---|---|---|
| `run/runtime.json` | 6089 | `4cdd19b4…defc557` | runId `74cd4ad3`，phase `abnormal_exit`，sourceCommit=managerCommit=`024d5b0`，supervisor node exit 1，gateway 达到 `candidate_verified`，startedAt 10-22T14:17:54Z / finishedAt 10-23T01:51:05Z |
| `run/guardian.json` | 614 | `383f7205…8500bd7` | nodeExitCode `1`（0x00000001），jobActiveBefore/AfterCleanup 均 0 |
| `run/request.json` | 194 | `b98255a0…cbfdff` | runId `d348ae39`，createdAt 10-23T10:55:13Z，recoveryGrantId `357a8a67…` |
| `run/abort.json` | 126 | `3421a255…f2660` | runId `d348ae39`，`START_ABORT`，10-23T10:55:28Z |
| `run/stop.json` | 99 | — | runId `fb292106`，10-22T09:28:01Z |
| `run/backup.freeze` | 0 | 空文件 | 残留（0 字节） |
| `run/release-pin.json` | 110871 | `482906d9…dd892dd` | `syntheticOnly=true`，commit `024d5b0`，releaseRoot=`…quick-trust-release-024d5b0` |
| `run/manager-pin.json` | 110871 | `482906d9…dd892dd` | **与 release-pin.json 字节完全相同** |
| `profile.json` | 876 | `ab96bbad…ca35` | mode production，codeRoot `D:\Tong\app`，sourceDigest `7eb48af9…`，releaseDigest `482906d9…`，agentdockEnabled true |
| `logs/maintenance-transaction.json` | 2107 | `76089ce8…db15473` | **与历史 SHA 完全一致，未改变**；phase `failed`，error `MUST_NOT_REACH`，journal 空 |

### 2.2 双 pin / profile / 源码一致性判断

- **已确认**：`release-pin.json` 与 `manager-pin.json` SHA256 均为 `482906d9…`（字节级相同），`profile.releaseDigest` 也是 `482906d9…`；`runtime.json` 的 sourceCommit=managerCommit=`024d5b0`。→ **源码、Manager、profile、双 pin 在提交 `024d5b0` 上一致，无版本冲突**。
- **待澄清（非阻塞）**：
  1. manager-pin 与 release-pin 完全同字节，即 Manager pin 未独立生成（当前 Manager 与 App 同提交、同 synthetic pin，可能符合设计，也可能是双 pin 分离的遗漏）。
  2. `D:\Tong\runtime\releases\candidate`（10-12，README 16420，无 AGENTS.md）与 `releases\manager`（10-20/22，README 31692，有 AGENTS.md）内容不一致；`D:\Tong\app` 的内容与 **manager** 快照一致（package.json 340 / README 31692 / AGENTS.md 2258，均 10-22 12:57）。`profile.stageRoot=candidate` 指向的是旧快照，需在实施前用 pin 工具复核，不能假设 candidate 与 manager 同步。

### 2.3 最后一次运行的直接失败原因（已确认 + 合理推断）

生命周期/守护/监督日志（`lifecycle.jsonl`、`guardian.jsonl`、`supervisor.jsonl`）给出的精确顺序：

1. `74cd4ad3`（`024d5b0`）2026-10-22T14:19:03Z `ready`；gateway 与 agentdock 日志显示认证 `/mcp` 持续 `200/202` 服务（最后一笔 10-23T01:50:34Z）。
2. 2026-10-23T01:51:02Z `lifecycle` 记 `shutdown`，reason=`MONITOR_FAILED`。
3. 2026-10-23T01:51:05Z `supervisor` 记 `unhandled_rejection`，reason=`SECURITY_UNAVAILABLE`（栈定位在 `D:\Tong\runtime\releases\manager\scripts\TongRuntimeSecurity.mjs`），supervisor exit code 1 → `abnormal_exit`。

**已确认事实**：最后运行不是“启动即失败”，而是 **ready + 服务 MCP 约 11.5 小时后，登录监控报 `MONITOR_FAILED` 触发停机，停机过程中的安全身份查询抛 `SECURITY_UNAVAILABLE`（未捕获）导致 supervisor 异常退出（exit 1）**。

**合理推断**：`SECURITY_UNAVAILABLE` 是“无法读取进程身份”的结果（同栈已在 10-17、10-21 的运行中出现过；且既有交付结论记录“当前权限无法读取生产 ngrok 的完整进程身份”）。`MONITOR_FAILED` 与 `SECURITY_UNAVAILABLE` 高度相关——监控健康检查与停机安全查询都依赖同一身份读取能力。

**缺失证据**：日志未逐 PID 记录 01:51 时刻“具体是哪个进程身份不可读”。不能把“ngrok 身份当前权限不可读”直接等同于“本次崩溃由该不可读身份触发”，只能作为待证假设。

### 2.4 异常退出后的启动拒绝（已确认）

`login-management.jsonl` 显示，异常退出后自动恢复被连续拒绝：

- 2026-10-23T03:29:24Z：`manager_command_failed` `CLEANUP_REQUIRED`（`runner_failed: Tong manager refused start: CLEANUP_REQUIRED`）。
- 2026-10-23T10:56:02Z：再次 `CLEANUP_REQUIRED`。

即：旧启动流程无法证明“旧运行身份/四类 Job/端口已清理”，Manager 拒绝启动。这正是任务所述“旧启动流程的固定等待预算、异常退出后的身份与清理证明等问题”。

### 2.5 当前进程 / 端口 / ngrok（本机实查）

- 监听端口 7676 / 7677 / 18765：**无监听**。
- `node` / `agentdock` 进程：**无**（仅当前 pwsh）。
- `ngrok` 进程：**无**。

→ 服务当前**停机**，且底层进程/端口/Job 实际已静止（`guardian.json` 也记录 `jobActiveAfterCleanup=0`）。这意味着“清理事实条件”当前很可能已满足，缺的是“能被旧代码正确证明”的能力。

### 2.6 误写 `maintenance-transaction.json` 现场核对（已确认）

- 精确路径 `D:\Tong\runtime\logs\maintenance-transaction.json`。
- SHA256 `76089ce806f4b12a01fe05cb435ff95e1b792475583dfb4367b84eb7edb15473`，**与历史记录完全一致，现场未改变**；大小 2107 字节。
- `transactionId 9288f925-ebbb-4768-9365-551cf0080f18`，phase `failed`，error `MUST_NOT_REACH`，journal 空，createdAt `2026-10-24T09:20:42.972Z`。
- 该文件 `plan.profile` 内为占位值（sourceDigest `aaaa…`、releaseDigest `bbbb…`、agentdockEnabled `false`），且其声明的 `backupRoot=D:\Tong\runtime\backup`、`releaseRoot=D:\Tong\state\reviewed-release`、`restoreRoot=D:\Tong\runtime\restore` 均**不存在**（已确认 NOT FOUND）。→ 这是一个“写前未做生产 I/O 门禁”的测试泄漏产物，从未进入安装/归档/pin/授权/启动。
- 影响：它占用了未来正式事务的唯一主记录路径；**方案 C（完整维护）必须先获授权处理该文件，方案 B（`34e2680`）不经过事务文件，不受其阻塞。**

---

## 3. 三种恢复路线比较

### 方案 A：回退到最后一个已知正常版本（`376a328` / `7d11382`）

| 维度 | 结论 |
|---|---|
| 技术可行性 | 源码回退可行：`D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-release-376a328` / `quick-trust-release-7d11382` 及 `quick-trust-full-cutover-*` 快照均在；但**不能解决启动阻塞** |
| 是否需改生产文件 | 需整体替换 App/Manager 源码 + profile + 双 pin + 授权（比 B 更重） |
| 是否依赖新维护执行器 | 若用旧发布/切分流程则否；若走当前唯一受控入口则需要（同 B/C 的落地问题） |
| 备份/回滚 | 需完整旧版 + 当前 `024d5b0` 现场快照，双向回滚 |
| 锁/版本/授权阻塞 | 当前 stuck 的 abnormal_exit + 误写事务文件 + `SECURITY_UNAVAILABLE` 依旧存在 |
| 风险与复杂度 | 高：回退**不修复**旧启动流程的固定等待预算/清理证明缺陷，`abnormal_exit` 后仍会 `CLEANUP_REQUIRED`；且丢失 Codex 修复，无收益 |

**结论：不推荐。** 根因不是“版本坏了”，而是“启动/清理流程坏了”，而这个流程在所有旧版里都存在。回退不能恢复服务，只会叠加一次无意义的版本迁移。

### 方案 B：仅 `34e2680` 最小启动修复（推荐）

| 维度 | 结论 |
|---|---|
| 技术可行性 | 高：`34e2680` 是 `024d5b0` 的直接子提交，仅改 7 个启动/安全脚本（+1426/-86），专门修复固定等待预算、异常退出清理证明、四类 Job 查询、可取消观察 |
| 是否需改生产文件 | 仅替换 App/Manager 中这 7 个启动相关文件（+ 相应 pin 重绑），业务源码/状态/config 不动 |
| 是否依赖新维护执行器 | **不依赖** `f182e55` 的 `Tong024ProductionMaintenance.mjs`/`TongMaintenanceTransaction.mjs`；但落地生产仍需一个受控的“停止→换文件→重绑 pin→启动”执行方式（见第 6 节） |
| 备份/回滚 | 需快照当前 `024d5b0` 的 7 个待换文件 + profile + 双 pin + 旧控制记录；失败即原样恢复 |
| 锁/版本/授权阻塞 | 不触碰事务文件；仍需在获批窗口内证明旧运行清理（这是它要修复的问题本身） |
| 风险与复杂度 | 低-中：隔离已验证 ready/doctor/安全停止/1ms 超时清理；风险是**尚未对真实 stuck 现场做原生验证**（见第 7 节缺口） |

### 方案 C：继续完成完整维护事务系统（`f182e55`）

| 维度 | 结论 |
|---|---|
| 技术可行性 | 未闭合：`0xC0000409` 两次未归因（`3221226505`，stdout/stderr 空），最终组合回滚未完成 |
| 是否需改生产文件 | 需整套事务：源码+23 原生文件+profile+双 pin+双 DPAPI 授权+控制记录，范围最大 |
| 是否依赖新维护执行器 | 是，完全依赖 |
| 备份/回滚 | 自身设计最完整，但“完整成功 + 安装后原生回滚”尚未闭环 |
| 锁/版本/授权阻塞 | 必须先获授权处理误写事务文件；生产入口仍固定禁用（`MAINTENANCE_NOT_READY`） |
| 风险与复杂度 | 最高，且是“为升级而升级”，不满足“尽快恢复基础服务”目标 |

**结论：不作为恢复基础服务的前提。** 它是更完整但尚未闭合的下一阶段工程，恢复基础 MCP 不需要等它。

### 3.1 三方案对比小结

| | A 回退旧版 | B 最小修复 `34e2680` | C 完整维护 `f182e55` |
|---|---|---|---|
| 修改范围 | 全量源码回退 | 7 个启动脚本 | 全量事务系统 |
| 是否修复根因 | 否 | 是 | 是（但未闭环） |
| 是否依赖 `0xC0000409` 修复 | 否 | 否 | 是 |
| 恢复基础服务所需复杂度 | 高 | **低** | 最高 |

---

## 4. 能否绕开新维护工具、先恢复基本 MCP

**结论：能（原则上）。** 依据：

1. `0xC0000409` 仅出现在 `f182e55` 完整维护系统的**最终组合回滚**测试（apply worker 完成 109 项安装、尚未写启动意图时，以及后续独立回滚 worker），两次异常发生在不同阶段，**不能归因于产品或环境**，也**不能认定是原 Tong 生产故障的根因**。
2. 基础服务 `024d5b0` 本身是好的：运行 `74cd4ad3` 达到 `ready` 并持续服务认证 `/mcp`（`200/202`）约 11.5 小时。
3. 最小修复 `34e2680` 的隔离验收**未出现** `0xC0000409`（ready/doctor/安全停止/1ms 超时清理均通过）。
4. 因此，恢复基础 MCP 只需要解决“启动/清理证明”问题，不需要新维护事务系统、也不需要 `0xC0000409` 修复。

**约束（不得逾越）**：不能通过删除锁、伪造终态、绕过授权或忽略进程身份检查来恢复。方案 B 的正解是**修复“正确产出清理证明”的能力**，而不是放宽门禁。

---

## 5. 待澄清 / 缺失证据（只读手段补齐）

1. **`34e2680` 对真实生产 stuck 现场未做原生验证**：隔离验证用的是干净合成现场，未验证“旧运行 `74cd4ad3` + 失败请求 `d348ae39` + 不可读 ngrok 身份”这一真实组合下，`34e2680` 的清理证明能否通过。这是方案 B 能否落地的最关键缺口。
2. **`SECURITY_UNAVAILABLE` 的精确触发进程**：01:51 崩溃时逐 PID 身份明细缺失。只读可补：在获批窗口用 `TongRuntimeSecurity` 的 identity 查询逐项打印生产 Launcher/Guardian/Supervisor/登录宿主/ngrok 的“可读/不可读”，定位具体不可读项，判断它是否在启动清理门禁的必需集合内。
3. **双 pin 是否应分离**：需用生产 pin 工具复核 `managerRoot` 与 `releaseRoot` 各自的真实绑定，确认“manager-pin == release-pin”是设计使然还是遗漏。
4. **误写事务文件处置**：方案 B 不触碰它；但若未来走方案 C，必须先另获授权，在持续持有的生命周期独占内只读复核→保存字节与元数据→原子归档，任何差异即停。

---

## 6. 推荐路线（方案 B）具体实施步骤与回退

> 以下为**准备到可审查程度**的方案，实际执行需用户逐项批准，且必须在获批维护窗口内进行。每步失败即停，不扩大重试、不改低门禁。

### 6.0 前置现场证明（生产操作前必须满足，全部只读复核 + 新鲜观察）

- 三套 runId（`74cd4ad3`、`bee3d9d4`、`d348ae39`）的原始 runtime/guardian/request/abort/freeze/stop/budget/reconciliation 各自留痕、记录哈希。
- 旧运行 `74cd4ad3` 的 Supervisor/Guardian/children/descendants 按 pid+exe+startTicks 核对**身份已消失**；四类命名 Job（owner/launcher/guardian/runtime）为 0；7676/7677/18765 空闲；登录宿主/runner/任务实例受控停止；生命周期互斥独占。
- 完整进程库存匹配生产根，排除任何未带 runId 的残留预检进程；未知归属即停，不按历史父 PID 批量杀进程。
- 只读复核 `D:\Tong\app`、`releases\manager`、`releases\candidate` 与 `024d5b0` 的 sourceDigest/releaseDigest 绑定，解决第 5 节待澄清项 2/3。

### 6.1 安装内容（精确提交与文件）

- 源码提交：`34e26801876d8b1a2fc874dddce72b0939924e87`（在 `024d5b0` 之上的最小启动修复）。
- 变更文件（App 与 Manager 同名 7 个启动文件 + 1 个新增协议文件，业务文件不动）：
  - `scripts/TongStartupProtocol.ps1`（新增）
  - `scripts/TongAgentDockRuntime.mjs`、`scripts/TongRuntimeLaunch.ps1`、`scripts/TongRuntimeGuardian.ps1`、`scripts/TongRuntimeSecurity.ps1`、`scripts/TongRuntimeSecurity.mjs`、`scripts/TongLoginRecovery.mjs`（修改）
  - `scripts/Tong024LegacyRecovery.mjs`（新增，仅离线演练，**不用于生产根**）
- 重绑：profile、双 pin（按第 5 节复核结论，必要时真正分离 manager pin）、`34e2680` 对应的 sourceDigest/releaseDigest。

### 6.2 步骤（每步在获批窗口内）

1. **快照**：快照当前 `024d5b0` 待换文件 + profile + 双 pin + 旧控制记录 + 相关授权密文，记录哈希并验证可读。
2. **独占 + 受控停止监控**：取得生命周期独占，复核本次停止证明（身份/Job/端口）。
3. **替换 + 重绑**：替换 7 个启动文件，更新 profile/pin 绑定，原生校验 `34e2680`。
4. **清理证明**：用 `34e2680` 的 `startupJobsState`/`processIdentity` 新鲜观察旧运行，产出清理证明（不再崩溃、不再固定 15 秒等待）。
5. **启动**：调用候选正常启动（完整安全预检照常）。
6. **验收**：ready、`doctor.healthy=true`、Gateway/MCP 认证通过 + 未认证拒绝、登录任务 Running、唯一登录宿主、监控首个健康结果。

### 6.3 启动后验收方法（对应“MCP 连接、本机读取、写入、服务健康”）

- MCP 连接：gateway `/.well-known/oauth-authorization-server` 200；`/mcp` 未认证 401、认证后 initialize/tools 200。
- 本机读取：通过 MCP 工具在 `D:\作业\111`（或既有受保护工作区）只读列出文件，核对 `changedFiles=[]`、目录元数据指纹不变。
- 本机写入：仅在有明确授权的工作区内做一次写入并回滚/校验，确认 `changedFiles` 记录与实际一致。
- 服务健康：`runtimeDoctor.healthy=true`、`phase=ready`、7676/7677/18765 监听、登录监控 Running、agentdock 已认证 MCP 通过。

### 6.4 失败回退

1. 先证明候选进程树/Job 已停、端口空闲。
2. 恢复密封的 `024d5b0` 文件 + profile + 双 pin + 旧控制记录；新增候选文件移入证据目录；**先恢复 freeze**。
3. 恢复后重新验证旧版；若旧版仍不能安全启动，**明确保持停机**，不声称服务已恢复，保留全部证据等待复审。

---

## 7. 是否已具备申请生产恢复批准的条件

**尚未完全具备。** 可提交审查，但在获批执行前必须补齐：

1. **`34e2680` 对真实生产 stuck 现场的原生演练**（第 5 节缺口 1）——这是唯一能证明“方案 B 清理证明可在生产通过”的证据。
2. **逐 PID 身份可读性复核**（第 5 节缺口 2）——确认不可读的 ngrok/登录宿主身份是否在启动清理门禁的必需集合内。
3. **双 pin 与 candidate/manager 目录绑定复核**（第 5 节缺口 3）。
4. **生产维护窗口授权**：本轮为只读评估，尚未获得任何生产安装/启动/停止授权。

上述缺口均可用**只读手段**补齐，不需要扩大权限或修改生产。

---

## 8. 附：精确提交 SHA

| 用途 | SHA |
|---|---|
| 当前开发分支 HEAD（NOT READY 交付） | `4e710e17257b6488927438777744bb86c2e7c866` |
| 生产基线（当前部署） | `024d5b0920d9ad8f1a2baf2e55640a5666ad4739` |
| **推荐：最小启动修复** | `34e26801876d8b1a2fc874dddce72b0939924e87` |
| 完整维护事务隔离（未闭合） | `f182e55f501930d4e062e1dea9fffc69fdef85d5` |
| 最后有完整验收记录（备选回退点） | `376a328d429aff0a4d826b3b5278fcef7c0368b5`、`7d11382300b9635d60b598e54a40e1d5083f7bb0` |
| 升级受阻目标（本轮不继续） | `d780561`、`5362210` |
| 生产误写事务文件 SHA256 | `76089ce806f4b12a01fe05cb435ff95e1b792475583dfb4367b84eb7edb15473` |

---

## 9. 尚未解决的问题（供 ChatGPT 复审）

1. `f182e55` 完整维护系统“最终组合回滚”两次 `0xC0000409` 未归因，整体未闭合——**但与本轮“恢复基础 MCP”无关**。
2. `34e2680` 尚未对真实生产 stuck 现场做原生演练，方案 B 的清理证明能否在生产通过仍是未证项。
3. 生产 ngrok 完整进程身份当前权限不可读（`SECURITY_UNAVAILABLE`），其对启动清理门禁的精确影响未定位。
4. manager-pin 与 release-pin 未分离、`releases/candidate` 目录陈旧的绑定待复核。
5. 误写 `maintenance-transaction.json` 占用正式事务路径，未来走完整维护前需另获授权受控处置。

> 本轮为只读诊断，未修改生产，未修改 main。报告将随本分支提交并推送至 `origin/codex/024-maintenance-adapter-20261024`，等待 ChatGPT 复审，不执行生产恢复。
