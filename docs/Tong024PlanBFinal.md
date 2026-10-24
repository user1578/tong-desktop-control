# 方案B最后集成 — 真实发布绑定启动、原生归档设计与最终判定（2026-10-24）

> **2026-10-25 独立复核更正：第 2 节将维护分支租约与精确 `34e2680` 启动混为一谈，不能成立。第 5 节的 ngrok 所有权和监控因果推断也未获证实。** 当前候选无连续交接能力；原生反例及重新核对的生产观察见 [独立复核](Tong024PlanBIndependentReview.md)。历史串行启动证据不等于生产恢复可执行。

> 接手 `adc932b3a4969e7aafd38a5b13e990c738f18ce0`，目标候选 `34e26801876d8b1a2fc874dddce72b0939924e87`。
> 本轮不修改 `D:\Tong\runtime`、不操作生产锁/误写事务文件/ACL/凭据/计划任务/授权、不执行生产恢复、不处理 `0xC0000409`/`5362210`、不继续 `f182e55`。

## 判定

**方案B隔离技术链已闭合，但生产恢复仍 NOT READY。** 真实 `34e2680` release 已构建/校验并跑通完整 `start→ready→doctor.healthy→MCP认证边界→安全停止`；旧现场门禁/归档/回滚已隔离验证。**生产恢复 NOT READY 的剩余阻塞**见第 6 节。

---

## 1. 完整 34e2680 原生启动验收结果（隔离，真实 release）

用 `buildRelease`（`gitExecutable=C:\Program Files\Git\bin\git.exe`，因 `cmd\git.exe` nlink=2 被 `tool()` 拒绝；`releaseRoot` 置于受保护隔离根，因 `D:\Tong\state` 自身 DACL 含外来 ACE 被 `assertProtectedPaths` 拒绝）从真实 commit 构建并通过 `verifyRelease`：

- commit `34e26801876d8b1a2fc874dddce72b0939924e87`，**299 源文件 + 23 原生**。
- `sourceDigest`（确定性）= `d38ee4d6141f430666088d08638f7d5022961e21097f153b915b990cd53b66d9`（与既有复核记录一致）。
- `releaseDigest`（随本 build 而定）= `160e33da2fbb2d9ba598e31897e83ea1d47073d2ad3844055edb962d23ef9062`。
- `node` v24.15.0；依赖版本 `@waishnav/devspace 1.0.8`、`@modelcontextprotocol/sdk 1.32.1`、`better-sqlite3 12.11.1`、`node-pty 1.1.0`。

物化：把 `code/source`（299 源文件）与四个运行时依赖（devspace/sdk/better-sqlite3/node-pty，真实复制、非 junction，否则 `regularFile` 的 realpath 校验拒绝）装入 App/Manager，`profile.sourceDigest/releaseDigest` 用真实值，双 pin 写入真实 `release-manifest.json`，`issueSimulationLoginRecovery` 签发隔离 DPAPI 授权。

`tests/Test-Tong024PlanBRealStart.mjs` 实测（退出 0）：

```
commit=34e2680… sourceFiles=299 native=23 sourceDigest=d38ee4d… releaseDigest=160e33da…
ready=true doctorHealthy=true agentdockAuth=true gatewayAuthBoundary=true stopped=true
runId=43c4f15c-e611-4c7b-ada0-b3f2d088ca01
```

即：真实 `startRuntime` 达到 `ready`；`runtimeDoctor.healthy=true`；AgentDock **认证 MCP 通过**、Gateway **未认证拒绝（401）**；按 runId **安全停止**。

---

## 2. 持续生命周期独占与启动交接

- **独占机制**：`TongLifecycleFreeze.withMaintenanceFreeze`（PowerShell 7 helper 以 `FileAccess.ReadWrite + FileShare.Read` 持续持有 `backup.freeze` 原文件句柄，拒绝其他写入/删除/重命名/第二个维护持有者）。
- **启动交接更正**：借用仅存在于后续维护分支，不在精确 `34e2680` 中；独立 CLI 也不继承进程内租约。精确候选保持 `open('wx')`，持有原锁会拒绝候选，移走原锁则存在竞争窗口。
- **实际证明**：既有原生竞争测试（`Tong024MaintenanceClosure.md`）确认 start/stop/profile 在冻结期拒绝 `RUNTIME_BUSY`、backup 拒绝 `STATE_BUSY`、原 freeze 内容不变、竞争创建/重命名拒绝、模块副本借用、控制进程退出后重新进入。本轮真实发布启动复用同一 `acquireRuntimeFreeze` 路径。
- **关键限制**：`withMaintenanceFreeze` 对 `profile.mode !== 'production-simulation'` 抛 `MAINTENANCE_NOT_READY`。即该交接在**隔离仿真已验证**，**生产模式入口仍固定禁用**，尚未在生产模式跑通。

> 普通 `maintenance.lock` 若不被所有启动入口共同遵守则非连续独占。后续分支借用测试不能作为精确 `34e2680` 的交接证明，本节原有等价证明撤回。

---

## 3. 完整安装与独立回滚证据

- **安装**：真实 release 物化（299 源 + 23 原生 + 4 依赖）+ 双 pin + 真实 digest profile + DPAPI 授权，`verifyRuntimeCandidate`（app + manager）均通过（否则 `startRuntime` 不会到达 `ready`）。
- **回滚**：`tests/Test-Tong024PlanBRecovery.mjs`（上一轮）实测旧控制记录 `seal→move→rollback` 字节级一致、回滚后门禁再次 `RUNTIME_BUSY`；`Test-Tong024LegacyRecovery.mjs` 覆盖密封/篡改/路径替换/junction 拒绝/部分归档回滚/部分恢复重试/确认重观测。
- **独立进程回滚缺口**：安装/启动失败后“独立进程恢复 `024d5b0` 源码+profile+双 pin+授权+控制记录”的**生产模式原生验证尚未完成**（仿真 `createLegacyRecoveryRehearsal` 已覆盖，但 `productionExecutionAllowed=false`）。

---

## 4. App/Manager 双 pin 绑定结论

- 当前生产 `release-pin.json` 与 `manager-pin.json` 字节相同（SHA256 均为 `482906d9…`），均指向 `024d5b0`。
- **符合设计**：App 与 Manager 为同一提交 `34e2680`，故双 pin 本应是同一 `release-manifest.json`。真正要求是二者**分别**经 `verifyRuntimeCandidate` 校验——本轮真实启动在 `supervise` 内执行 `verifyRuntimeCandidate(profile)` 与 `verifyRuntimeCandidate(profile,{manager:true})` 均通过，且各 pin 的 `hash(pin)===profile.releaseDigest`、`source.tar sha===profile.sourceDigest` 成立。
- 无需为形式上的“分离”制造两个不同 pin；但生产 `releases\candidate` 目录陈旧仍需在切换前用 pin 工具复核。

---

## 5. ngrok 身份观察的实际限制（只读）

- **当前有 ngrok 进程**：PID `40452`，父 PID `2728`，创建于 `2026-10-23 12:27`（本机），对应 10-23 03:27 UTC 的登录恢复尝试，之后残留运行。
- **身份不可读**：`ExecutablePath` 与 `CommandLine` 均为**空**（当前权限无法读取）→ 即历史 `SECURITY_UNAVAILABLE` 的现场来源。
- **不在启动门禁必需集合内**：`runtime.json` 的 12 项身份（supervisor/children/descendants）**无 ngrok**；`guardianComplete→oldRuntimeGone` 只核对 `runtime.json` 记录的身份 + 四类 Job + 端口。**ngrok 不阻塞启动门禁。**
- **影响范围更正**：已证实的是维护 inventory 失败；登录 runner 的 status/doctor 不调用库存。`MONITOR_FAILED` 是 Supervisor 周期 promise 的通用错误，历史故障早于当前 ngrok 创建，具体根因 UNKNOWN。未修改权限、ngrok 或将未知视为消失。

---

## 6. 真实生产恢复仍缺少的条件（NOT READY 阻塞）

1. **生产模式原生维护入口未启用**：`withMaintenanceFreeze` 对 production 模式抛 `MAINTENANCE_NOT_READY`，生产归档/安装/独立回滚尚未在 production 模式跑通。
2. **独立进程原生回滚未验证**：安装中断/启动失败后，恢复 `024d5b0` 源码+profile+双 pin+授权+控制记录的生产原生链未验证。
3. **ngrok 身份不可读阻塞所需完整库存**：不能推导为登录监控直接失败；历史故障仍缺原始分支证据。
4. **生产现场绑定未核对**：`D:\Tong\app`/`releases\manager` 与 `024d5b0` pin 的完整只读绑定（`verifyRuntimeCandidate` 只读路径）需在获批窗口核对。
5. **误写 `maintenance-transaction.json`**：方案B不经过事务文件不阻塞；未来完整维护仍需另获授权处置。

---

## 7. 精确 Git 提交 SHA

| 用途 | SHA |
|---|---|
| 本轮交付（本报告 + 测试） | 见下（提交后补） |
| 目标候选 | `34e26801876d8b1a2fc874dddce72b0939924e87` |
| 生产基线 | `024d5b0920d9ad8f1a2baf2e55640a5666ad4739` |
| 本轮 release `sourceDigest` | `d38ee4d6141f430666088d08638f7d5022961e21097f153b915b990cd53b66d9` |
| 本轮 release `releaseDigest` | `160e33da2fbb2d9ba598e31897e83ea1d47073d2ad3844055edb962d23ef9062` |
| 本轮真实启动 runId | `43c4f15c-e611-4c7b-ada0-b3f2d088ca01` |

---

## 结论

- **已闭合（隔离）**：真实 34e2680 release 构建/校验、真实 digest 双 pin 双组件绑定、真实 start→ready→doctor→MCP 认证边界→安全停止、旧现场安全拒绝、受控归档与字节级回滚。
- **NOT READY（生产）**：生产模式原生维护入口仍禁用、独立进程原生回滚未验证、ngrok 身份不可读会阻塞登录监控、生产现场绑定未核对。
- 后续须先复审精确候选缺少连续交接协议的阻塞，不得仅启用生产维护租约或照旧草案执行。生产只读绑定后来已通过，其他未完成项见 2026-10-25 独立复核。
