# 方案B最小生产恢复 — 准备、隔离演练与执行计划（2026-10-24）

> 目标：确认**不依赖未完成的完整维护事务系统（`f182e55`），仅用 `34e2680` 最小启动修复**安全恢复 Tong 原有 MCP 服务。
>
> 本轮不执行生产修改、不清理生产锁、不更改生产授权、不触碰误写事务文件、不处理 `0xC0000409` 与 `5362210` 升级。所有验证均在 `D:\Tong\state` 隔离根完成。

## 0. 判定

**方案B技术机制已通过真实格式隔离演练；但生产恢复尚 NOT READY**，剩余阻塞见第 6 节。

已通过的隔离链（本轮实测）：
- 旧 024 现场被 `34e2680` 门禁**安全拒绝**（`RUNTIME_BUSY` + `CLEANUP_REQUIRED`），不伪造回执、不升级旧记录。
- 最小受控归档（seal + move + rollback）能保存证据、处理旧状态，并回滚到字节级一致。
- 归档后门禁清除，启动可继续（到达 `START_TIMEOUT`，而非 `CLEANUP_REQUIRED`）。
- 发布绑定：`024d5b0` = 283 源文件 + 23 原生 + node（生产 pin 只读核对）；`34e2680` = 299 源文件 + 23 原生（既有 `verifyRelease` 证据）。

---

## 1. 生产旧记录与 34e2680 启动门禁逐项核对

`34e2680` 的 `startRuntime()` 在**冻结之后**依次执行三道门禁（`scripts/TongAgentDockRuntime.mjs`）：

| 门禁 | 判定函数 | 关键要求 | 当前生产现场 |
|---|---|---|---|
| 1. 冻结 | `freeze()` = `open(run/backup.freeze, 'wx')` | 文件必须**不存在**（独占创建） | `backup.freeze` 为 0 字节残留 → **`RUNTIME_BUSY`** |
| 2. 旧请求 | `launchComplete(previousRequest.runId)` | 必须有 `launcher.<runId>.json`（schemaVersion 2、`preflightClean`、终态回执），否则拒绝 | `request.json` = `d348ae39`，**无 launcher 回执** → **`CLEANUP_REQUIRED`** |
| 3. 旧 Guardian | `guardianComplete(runId)` | 必须 `guardian.containment==='create_process_job_list'` 且 `finishedAt`/`jobActiveAfterCleanup===0`/`jobAssigned` 齐全 | `guardian.json`（runId `74cd4ad3`）**无 `containment` 字段** → **`CLEANUP_REQUIRED`** |

**结论（已确认）**：当前 024 现场的三项旧记录（0 字节 `backup.freeze`、无 launcher 回执的失败请求 `d348ae39`、无 `containment` 的旧 Guardian `74cd4ad3`）**均无法通过 34e2680 门禁**。`guardianComplete` 的源码注释明确：旧「assigned-Job」记录无法排除分配前创建的后代，需要**单独复核的恢复**，绝不自动升级为原子 containment 证明。`launchComplete` 同样要求旧请求的**负向终态回执**，缺失即拒绝。

因此：**单纯安装 34e2680 不能恢复**——启动仍会 `RUNTIME_BUSY`/`CLEANUP_REQUIRED`。必须先对旧控制记录做受控归档。

### 1.1 旧 Guardian 字段核对（`D:\Tong\runtime\run\guardian.json`）

- `containment`：**缺失** → 门禁直接 `false`。
- `jobName`：`Local\TongRuntime-74cd4ad3-…` → 匹配模式 ✓，但不足以通过（缺 containment）。
- `finishedAt`：`2026-10-23T01:51:05.356Z` → 有终态 ✓。
- `jobAssigned`：`true`、`jobActiveAfterCleanup`：`0` → 清理数字满足，但门禁仍被 `containment` 挡住。

### 1.2 失败请求 launcher 回执

`request.json`（`d348ae39`）在旧协议下没有对应 `launcher.d348ae39-…json`。`34e2680` 的 `launchComplete` 要求该负向终态回执；旧协议不产生它，因此**不能被伪造**，只能随旧记录一起归档。

### 1.3 原生 Job 与身份

隔离演练证明：旧记录一旦被归档，`runtimeStatus` 返回 `not_started`，启动跳过全部旧身份/Job 门禁。生产归档前必须在获批窗口内新鲜观察：旧运行三套身份（`74cd4ad3`/`bee3d9d4`/`d348ae39`）全消失、四类命名 Job 为 0、7676/7677/18765 空闲、监控受控停止。**不可读身份保留 `SECURITY_UNAVAILABLE`，不视为已清理。**

---

## 2. 最小受控旧现场归档设计

复用 `scripts/Tong024LegacyRecovery.mjs`（离线）的已验证逻辑，生产化要点：

1. **持续阻止并发启动**：归档全程持有生命周期独占（`backup.freeze` 为最后归档项，先于任何旧记录暴露前保持存在）。
2. **完整保存旧记录及哈希**：`required = runtime.json, guardian.json, request.json, abort.json, backup.freeze`；`optional = stop.json, login-recovery-budget.json, stale-reconciliation.json`。逐字节读入、计算 SHA256、写入 evidence 目录并密封 snapshot。
3. **归档顺序**：先归档非 freeze 记录，`backup.freeze` **最后**归档（保证期间普通启动仍被锁住）。
4. **失败回滚**：先恢复 `backup.freeze`，再恢复其余记录；任何第三方改动/新请求/路径替换即拒（`RECOVERY_CONFLICT`），部分归档可回滚。
5. **不伪造回执、不升级记录**：缺失的 launcher 回执记录为 `absent-legacy`，绝不生成负向回执；旧 Guardian 不加 `containment`。

本轮隔离演练（`tests/Test-Tong024PlanBRecovery.mjs`）以生产-simulation 隔离根 + 真实格式旧记录实测：`seal → move → rollback` 字节级一致，回滚后门禁再次 `RUNTIME_BUSY`。离线 `Test-Tong024LegacyRecovery.mjs` 额外覆盖：路径替换/junction 拒绝、篡改拒绝、部分归档回滚、部分恢复重试、确认重观测、`productionExecutionAllowed=false`。

> 生产执行器必须是**原生受控适配器**（新事务/授权绑定），不能直接用 simulation-only 的 `createLegacyRecoveryRehearsal` 操作生产。

---

## 3. 34e2680 发布清单核对

### 3.1 App/Manager 必须新增、替换、保留的文件（`git diff 024d5b0 34e2680`）

- 源文件数：`024d5b0` = 283；`34e2680` = **299**（283 + 16 新增）。原生 23 个不变。
- **替换（M，10 个）**：
  - `scripts/`：`TongAgentDockRuntime.mjs`、`TongLoginRecovery.mjs`、`TongRuntimeGuardian.ps1`、`TongRuntimeLaunch.ps1`、`TongRuntimeSecurity.mjs`、`TongRuntimeSecurity.ps1`
  - `tests/`：`Test-TongLoginAutoRecovery.mjs`、`Test-TongRuntimeStartupCleanup.mjs`、`Test-TongStartupRecovery.mjs`、`fixtures/TongLoginRecoveryFixture.mjs`
- **新增（A，16 个）**：
  - `scripts/`：`TongStartupProtocol.ps1`、`Tong024LegacyRecovery.mjs`
  - `docs/`：`Tong024StartupRecovery.md`
  - `tests/`：`Test-Tong024BaselineBinding.mjs`、`Test-Tong024LegacyCompatibility.mjs`、`Test-Tong024LegacyRecovery.mjs`、`Test-TongAtomicJobCreation.ps1`、`Test-TongGuardianOwnership.mjs`、`Test-TongLauncherBudget.mjs`、`Test-TongLauncherCancellation.mjs`、`Test-TongStartupArtifactBinding.mjs`、`Test-TongStartupObservationBudget.mjs`、`Test-TongStartupProtocol.ps1`、`Test-TongStartupReceiptAtomic.mjs`、`Test-TongStartupSafety.mjs`、`fixtures/ChildLifecycle.mjs`
- **保留（273 个）**：其余全部源文件、23 个原生文件、node_modules（DevSpace 三补丁 + 依赖版本）、node.exe 均不变。

### 3.2 为什么「只替换 7 个启动文件 + 切到 34e2680 完整 pin」会 CANDIDATE_DENIED

`verifyRuntimeCandidate()`（`scripts/TongRuntimeCandidate.mjs`）读取 pin（`release-manifest.json`）后，对 `manifest.sourceFiles` + `manifest.native` 的**每一个文件**按 `codeRoot`/`managerRoot` 逐文件校验 size + sha256，并校验 node 可执行文件、DevSpace 三补丁哈希、依赖版本。`34e2680` 的清单含全部 299 源文件；只替换 7 个启动文件会导致其余 19 个变更文件（10 M 中的 3 个测试修改 + 16 A 全部）哈希不符或缺失 → `CANDIDATE_DENIED`。

### 3.3 生成完整一致的 release / profile / 双 pin / 新授权

1. `buildRelease({codeRoot: D:\Tong\development\tong-desktop-control, commit: 34e2680…, releaseRoot: <state 下受保护目录>, gitExecutable, pythonExecutable})` → 产出 `release-manifest.json` + `code/source.tar` + `code/source/` + `native/`，并自验 `verifyRelease`。
2. `restoreRelease({releaseRoot, candidateRoot, …})` → 在 state 下物化完整 34e2680 树（`npm ci --ignore-scripts --offline` + 原生复制 + DevSpace 补丁 + 全哈希复验），作为生产切换源。
3. 新 `profile.json`：`sourceDigest = sha256(code/source.tar)`（确定性）、`releaseDigest = sha256(release-manifest.json)`（随本次 build 的 releaseRoot/createdAt 而定）。
4. 双 pin：`pinRuntimeRelease(profile, releaseRoot)` 与 `pinRuntimeRelease(managerProfile, managerReleaseRoot, {manager:true})`，分别把 `release-manifest.json` 写入 `release-pin.json`/`manager-pin.json`（本轮需**真正分离** manager pin，而非与 release pin 同字节——见第 6 节）。
5. 新授权：在获批窗口以本机原生挑战签发 `start`/`enable-agentdock` 回执（`verifyRuntimeApproval` + `recordApprovedEnabledState`），非 simulation 回执。

**业务状态、数据库、配置不变**：切换仅触及源码 + 原生 + profile + 双 pin + 授权材料；`backend-state`、`workspace`、`home`、OAuth 状态、`tong-policy` 等业务状态目录不动。

---

## 4. 真实格式隔离演练结果（本轮实测）

新测试 `tests/Test-Tong024PlanBRecovery.mjs`（三夹具，全部退出 0）：

| 夹具 | 结果 |
|---|---|
| 门禁拒绝 | 注入真实格式旧记录 → `startRuntime` 拒绝 `RUNTIME_BUSY`（残留 freeze）；归档 freeze 后 → `CLEANUP_REQUIRED`（旧 Guardian 无 `containment` + 旧请求无 launcher 回执）；未伪造任何回执 |
| 归档回滚 | `seal → move → rollback` 字节级一致；回滚后门禁再次 `RUNTIME_BUSY` |
| 归档后启动 | 归档后 `startRuntime` 通过门禁，到达 `START_TIMEOUT`（1ms），**不再** `CLEANUP_REQUIRED` |

配套既有测试（本轮复跑，退出 0）：
- `Test-Tong024BaselineBinding.mjs`：`024d5b0` = 283 源 + 23 原生 + node 绑定（**只读生产 pin**）、SQLite/ConPTY 原生加载。
- `Test-Tong024LegacyRecovery.mjs`：离线归档的密封/篡改/路径替换/部分回滚/重试/确认重观测全覆盖，`productionExecutionAllowed=false`。

完整 `start → ready → doctor.healthy → 安全停止` 由既有 `Test-TongStartupRecovery.mjs`（隔离合成 pin）覆盖，启动核心（Launcher/Guardian/Protocol）与 `34e2680` 字节一致。

---

## 5. 正式恢复前的执行计划

### 5.1 前置现场证明（生产操作前必须满足，全部只读 + 新鲜观察）

1. 只读复核 `D:\Tong\app`、`releases\manager` 与 `024d5b0` pin 的完整绑定（`verifyRuntimeCandidate` 只读路径），解决第 6 节绑定待复核项。
2. 三套 runId（`74cd4ad3`/`bee3d9d4`/`d348ae39`）身份全消失、四类 Job 为 0、7676/7677/18765 空闲、监控受控停止、生命周期独占成立；不可读身份保留 `SECURITY_UNAVAILABLE`。
3. 逐 PID 定位不可读的 ngrok/登录宿主身份，判断其是否在启动清理门禁必需集合内。

### 5.2 快照路径与授权范围

- 快照：当前 `024d5b0` 源码（283+23）+ profile + 双 pin + 旧控制记录 + 相关 DPAPI 授权密文 + 登录 runner/任务 XML/ACL，记录哈希。
- 授权范围：**仅**本候选 `34e2680`、本事件、本窗口；不含功能升级、系统配置、关机重启、历史清理。

### 5.3 执行步骤（获批窗口内，每步失败即停）

1. 独占生命周期并受控停止监控，复核停止证明。
2. 按第 2 节**受控归档**旧控制记录（freeze 最后归档，证据 + seal + 哈希）。
3. 用 `34e2680` 发布切换 App/Manager（第 3.3 节的 26 个变更文件 + 重绑 profile/双 pin/授权）。
4. 原生校验 `34e2680`（`verifyRuntimeCandidate` app+manager）。
5. 调用候选正常启动（完整安全预检）。
6. 验收：`ready`、`doctor.healthy=true`、Gateway MCP 认证通过 + 未认证拒绝、本机读取（`changedFiles=[]`）、写入（授权工作区内 + 校验）、7676/7677/18765 监听、登录监控 Running。

### 5.4 回滚步骤

1. 先证明候选进程树/Job 停止、端口空闲。
2. 恢复密封的 `024d5b0` 源码 + profile + 双 pin + 旧控制记录 + 授权材料；候选新增文件移入证据目录；**先恢复 freeze**。
3. 恢复后重新验证；若旧版仍不能安全启动，**明确保持停机**，不声称恢复。

### 5.5 停机条件（立即停止、不扩大重试）

- 任一步现场证明缺失/矛盾（含身份不可读、Job 非零、端口占用、第三方改动、快照篡改、路径替换）。
- `verifyRuntimeCandidate` 或授权校验失败。
- 启动验收任一项（ready/doctor/MCP/监听/监控）失败。
- 出现未归因原生异常（如 `0xC0000409`）。

---

## 6. 剩余阻塞（使生产恢复 NOT READY）

1. **未用 `34e2680` 真实 releaseDigest 做完整 start→ready→doctor→stop**：本轮归档后启动演练只到 `START_TIMEOUT`（证明门禁清除）；完整 ready 由合成 pin 的既有测试覆盖。需在 state 下用真实 `34e2680` release（含 `buildRelease`+`restoreRelease`+真实 pin）跑一次完整链。
2. **生产归档执行器未原生化**：`createLegacyRecoveryRehearsal` 是 simulation-only；生产需原生受控适配器 + 本机原生授权，尚未实现/执行。
3. **生产 ngrok 完整进程身份不可读（`SECURITY_UNAVAILABLE`）**：其对启动清理门禁的精确影响未定位（是否在必需身份集合内未证实）。
4. **双 pin 未分离**：当前生产 `manager-pin.json` 与 `release-pin.json` 字节相同；`releases\candidate` 目录陈旧。升级前必须用 pin 工具复核并真正分离。
5. **误写 `maintenance-transaction.json`**：方案B不经过事务文件，不受其阻塞；但未来走完整维护前需另获授权受控处置。

---

## 7. 结论

- **方案B的技术机制已验证**：旧 024 现场会被 `34e2680` 门禁安全拒绝；最小受控归档（不伪造、不升级、可回滚）能清除阻塞并使启动继续；发布绑定与文件增删清单已核实。
- **生产恢复 NOT READY**：还需补齐第 6 节的真实 release 完整链演练、原生归档执行器、ngrok 身份定位、双 pin 分离，并在获批窗口做现场只读绑定验证。
- 推荐下一步顺序：① 补齐第 6 节缺口（只读 + state 隔离）；② 取得生产维护窗口授权；③ 按第 5 节执行；④ 任一步失败按 5.4 回滚或 5.5 停机。
