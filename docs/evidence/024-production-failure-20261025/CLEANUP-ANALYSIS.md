# CLEANUP_REQUIRED：精确分支分析

## 代码依据

分析使用精确2号 `024d5b0920d9ad8f1a2baf2e55640a5666ad4739` 的生产字节，先与 pin 摘要核对，再与 Git blob 按换行归一化核对。以下行号对应公开 `.txt` 源码和该版本 Git 源码，均未插入头部说明。

- [TongAgentDockRuntime.mjs](source/original-v2/TongAgentDockRuntime.mjs.txt)：`oldRuntimeGone` 162–181；`guardianComplete` 227–235；`startRuntime` 236–307。
- [TongRuntimeLaunch.ps1](source/original-v2/TongRuntimeLaunch.ps1.txt)：生产预检、独立 Guardian 创建和负回执。
- [TongRuntimeGuardian.ps1](source/original-v2/TongRuntimeGuardian.ps1.txt)：生产预检、`guardian_started`、Job、Supervisor、记录发布。
- [TongLoginRecovery.mjs](source/original-v2/TongLoginRecovery.mjs.txt)：预检/授权验证调用链与 `denied` 标签。
- [TongRuntimeSecurity.mjs](source/original-v2/TongRuntimeSecurity.mjs.txt)：`safeEnvironment` 和原生安全帮助进程。

## 1. 最终错误来自哪一处

`startRuntime()` 有两处显式 `CLEANUP_REQUIRED`：

| 分支 | 条件 | 到达此处分支后是否会创建本次 request |
| --- | --- | --- |
| 第249行：旧运行检查 | `status.runId && !await guardianComplete(root,status.runId)` | 否；直接进入 catch，此时还没有新 runId/child |
| 第302行：本次启动异常收尾 | 已有 `child.pid`，未收到可信 `guardianCreated=false`；轮询后 `complete` 仍为 false | 是；第256行已经写 request，第293行写 abort |

本次现场存在新 request `be3f...` 和同 ID 的新 `START_ABORT`；request 的创建时间落在唯一正式 Task 启动之后，恢复审计也确认本次 Manager 已进入 `start`。在已核对的原版源码中，这只能在第249行旧门槛通过后到达。**因此不能把本次最终错误归为旧 Guardian 字段、旧 Supervisor、旧子进程、旧 Job 或旧端口检查失败。**

第175行的旧 Job 检查也可能抛出 `CLEANUP_REQUIRED`，但在 `guardianComplete()` 内会被转成 false，并使第249行失败；仍不可能继续写第256行的新 request。本次证据排除了这个早期路径。

## 2. 旧运行检查的实际条件

旧 ID 为 `74cd4ad3-f21b-40ec-96f5-3f9015649e5d`。保存的 [Guardian](public/window/failed-attempt/run/guardian.json)、[runtime](public/window/failed-attempt/run/runtime.json) 和交接前/替换后审计相互支持：

| 检查 | 原版规则 | 保存的事实/推导 |
| --- | --- | --- |
| Guardian 归属 | Guardian runId 等于旧 runId | 相等 |
| Guardian 完成 | finishedAt 有效；jobAssigned=true；jobActiveAfterCleanup=0 | 均满足，finishedAt 为2026-10-23T01:51:05.3563237Z |
| Supervisor 关联 | Guardian nodePid 等于 runtime.supervisor.pid | 均为45836 |
| 命名 Job | `Local\TongRuntime-<旧ID>` 且 killOnJobClose=true | 保存的 Guardian 满足；审计相关 Job 全0 |
| 原始进程身份 | 完成的命名 Job 路径下，原始 Guardian/Supervisor/children/descendants 不再存活；PID重用不能冒充原身份 | 审计10项身份均为 GONE |
| 端口 | agentdock/gateway/upstream 相关端口空闲 | 保存审计7676/7677/18765无监听 |
| 当次函数返回 | 第249行必须通过才会写第256行 | 新 request 证明旧检查在当次执行已通过；不是本轮重新执行函数得出的结果 |

这些是已有证据的分析。本轮没有执行 `guardianComplete`、`oldRuntimeGone` 或其他生产模块，未用“今天进程已不在”代替失败瞬间的状态。

## 3. 新运行的异常收尾为何不能完成

源码第291–302行的逻辑为：

```text
if child.pid exists AND no trusted negative guardian-creation acknowledgement:
    save START_ABORT for the new runId
    repeat up to 300 times:
        if guardianComplete(newRunId): complete = true
        else if launchedIdentity exists AND Guardian record is not the new run
             AND that exact launched identity is gone: complete = true
        else wait 100ms
    if not complete:
        release = false
        throw CLEANUP_REQUIRED
```

**已确认的最终条件是 `complete=false`。** 因而正常 release/unlink 路径未执行，Manager 关闭句柄但保留新 gate。事后保存的新 gate 为0字节，FileKey=`3025126315:2031616:3364962`；原事故 gate 的 FileKey=`3025126315:89915392:3025673`，二者不能混淆。

在保存的失败状态上，`guardianComplete(root,'be3f...')` 会在第229行因 Guardian 仍属旧 `74cd...` 而直接返回 false。它不会走到新运行的 `oldRuntimeGone()`，也不会走到第234行的 catch。

精确身份备用分支只使用第269行创建的 `launchedIdentity`。源码在 `await Launcher close`、JSON 解析成功后才赋这个值。spawn 对象的 Launcher PID **不等于**回执中准备交接的 Guardian 身份，也不能互相替代。

持久化证据没有保存 `launchedIdentity` 变量、Launcher stdout 或逐轮状态。可推导备用分支最终没有成功，但仍不能完全区分“变量未赋值”与“已赋值但该精确身份在最后检查时未被证明消失”。约15秒的初始失败时差和没有新 Guardian 事件使前者更符合现有记录，仍应标为推断。

回退前保存的 [新运行原生检查](public/window/failed-run.native-proof.json) 显示四类 Job=0、Host/runner不存在；[完整失败后审计](public/window/audit.failed-start.json) 匹配进程0、无端口/监控。这些检查为**回退安全性**提供依据，不是原版 Manager 在启动收尾时已拿到的终态证明。

## 4. 被隐藏的异常到底有哪些

有两个不同的隐藏点，不能混为一谈：

1. `guardianComplete` 第234行的 `catch{return false;}` 会隐藏 `oldRuntimeGone` 的具体异常，例如 `RECONCILIATION_DENIED`、Job 查询/进程身份查询异常、`CLEANUP_REQUIRED` 或端口占用错误。它没有保留 exception/stack。**本次没有证据证明旧运行在此 catch 中失败；新 request 反而证明旧调用返回 true。** 保存的新运行 Guardian ID 不匹配也会在 catch 之前返回。
2. `startRuntime` 第283行收到的**最初启动异常**可能被第302行收尾抛出的 `CLEANUP_REQUIRED` 覆盖。最终 CLI 只输出该错误名；第260行 `child.stderr.resume()` 消费但不保存 Launcher stderr，第269行之前也没有持久化 `launchOutput`。因此丢失的是最初启动失败的具体上下文，不能冒充已经找到了一个被 `guardianComplete` 隐藏的旧运行异常。

此外，`withLoginRecovery` 在任意操作异常时写 `denied`。本次先有 `authorized/start/PID27384`，后有 `denied/start/同PID`，两者不矛盾；后者不能直接证明审批或密文损坏。Launcher 自己的额外预检仍需单独证据。

## 5. 15秒与生产/隔离差异

- request 为15:25:19.820Z，abort 为15:25:34.835Z，间隔15015毫秒；源码 Launcher 等待器为15000毫秒。这与等待器触发高度一致，但同一时段的其他子进程退出/输出/身份错误没有保存，**暂不能把超时写为已确认初始错误**。
- request 的总启动 deadline 是15:27:19.819Z；最终错误在15:26:08.9355619Z，早于 deadline。因此不能把这次笼统解释为120秒 Supervisor/业务 ready 总预算耗尽。
- Launcher 只在精确生产根下执行 `preflight-login`/`preflight-production`，之后才调用 CreateProcess 创建 Guardian。`D:\Tong\state\...` 的 simulation 分支跳过这一段。Guardian 自身也在首条 `guardian_started` 日志前执行生产预检。
- 外部 Host 确实用 PS7 启动原 runner；原版 Manager 第257行仍启动 PS5.1 Launcher，Launcher 再启动 PS5.1 Guardian。`safeEnvironment(root)` 将内层 TEMP/TMP 改为 runtime 下的 temp；不能认为外部 Host 的相邻 TEMP 自动覆盖了整个进程链。
- 已有隔离 ready/doctor 成功没有证明上述固定生产预检路径、耗时或环境完全等价。既不能据此认定原版安全门槛错误，也不能无证据认定需要更换 PowerShell、放宽 ACL 或重做授权。

## 6. 最小处理建议（未实施）

优先补足可观测性，保留现有拒绝语义：在隔离副本记录有界的 Launcher 阶段、原始错误码、子进程创建身份/终态、受控 stderr 元数据，以及独立的 cleanup 结果。对于 stderr 必须先做脱敏和容量限制，不能记录授权凭据或任意环境变量。

隔离用例应覆盖“真实生产分支会执行的授权预检”与“最初错误被 cleanup 失败覆盖”两个缺口；不能再用跳过该预检的 fixture 作为完全覆盖。是否修改原版源码、是否需要新的受控运行测量，应由复审后另行决定。

目前不能给出已经验证可恢复生产的配置修复。禁止以清空状态、补造缺失 Guardian、把旧 Guardian 改成新 runId、仅凭事后 Job=0放行、盲目延长超时或再次移锁代替修复。**能明确定位的是最终拒绝条件，最初 Launcher/预检失败根因仍为 UNKNOWN。**
