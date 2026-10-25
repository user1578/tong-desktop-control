# 本次真实生产恢复失败的诊断

## 结论及证据等级

**已定位最终拒绝分支，未定位最初启动错误的根因。** 原版 Manager 已为本次启动分配新 runId 并写入 request，随后写入同一 runId 的 `START_ABORT`，最后报告 `CLEANUP_REQUIRED`。这对应 `startRuntime()` 的异常收尾分支，而不是进入启动前的旧运行检查分支。

本报告区分三类内容：文件/日志直接记载的事实；与精确版本代码结合得到的控制流推导；仍需新证据验证的假设。维护控制者生成的 JSON 是操作记录，不等同于操作系统逐进程跟踪。

## 身份与版本

| 标识 | 实际含义 | 已有证明 |
| --- | --- | --- |
| `production-state2-71f18ee9-734c-48d1-b550-129af5c5fb08` | 维护证据目录/操作窗口标识 | 不是产品 runtime runId |
| `74cd4ad3-f21b-40ec-96f5-3f9015649e5d` | 旧事故的运行 ID | 失败时 `runtime.json`、`guardian.json` 仍属于此 ID |
| `be3f5c49-d824-4edd-b8fc-7ee70d7f9a00` | 本次 Manager 新分配的启动请求 runId | request 和 abort 直接记载；尚无此 ID 的 runtime/Guardian 持久化记录或 READY 事件 |
| `{8F3B53A0-D5B7-4B37-8528-5F79E4FEEA1F}` | 正式 Task 实例 GUID | 不是产品 runId；EnginePID 为37480 |

结束记录把 `be3f...` 命名为 `attemptRunId`，这不表示它仅是维护者虚构的尝试编号：原版 `startRuntime()` 第256行确实用 `randomUUID()` 创建它并写入 request。但是**创建了启动请求不等于已创建一个正常运行的 Supervisor/runtime**。

生产 App/Manager 仍绑定 `024d5b0920d9ad8f1a2baf2e55640a5666ad4739`。9个关键生产源码的原始字节 SHA256 均匹配 manager pin；与该 Git 提交的差异仅为 CRLF/LF 换行。公开源码从精确 Git blob 整理，见 [源码绑定](source/SOURCE-BINDINGS.json)。这9个文件在1号 `37dc649c46ad0e267c3471f750b97227cf106310` 和2号之间也逐字节相同，不能据此保证回退1号会修复此启动链。

## 时间线（UTC）

下表的启动阶段在日本时间为2026-10-26凌晨。所有时间取自保存的文件或日志，不用文件夹命名推断时间。

| UTC 时间 | 已记录事件 | 依据 |
| --- | --- | --- |
| 14:57:26.0124890 | 第一次维护因未完成本机 UAC 停止；旧控制原件、Host 未动，Task 已暂停 | [blocked-local-uac](public/window/blocked-local-uac.json) |
| 15:09:17.8677352 | 管理员辅助脚本误报 `NGROK_IDENTITY_DRIFT`；保存的原生身份实际可读且匹配，时间类型/精度比较随后修正 | [误拒绝记录](public/window/ngrok.InspectStop.identity-refusal.result.json)、[原生探测](public/window/ngrok.admin.identity-refusal.json)、[13项比较验证](public/window/ngrok-guard-verification.json) |
| 15:19:51.490 | 管理员完整库存匹配数0，三组旧 Job 全0，无监听/监控，App/Manager 验证通过 | [管理员审计](public/window/audit.admin.before.json) |
| 15:20:01.0283846 | ngrok 经正常服务控制停止 | [服务停止记录](public/window/ngrok.stopped.json) |
| 15:21:42.726 | 原用户持生命周期互斥，Task Disabled/0实例，完整原生门槛再次通过 | [交接前审计](public/window/audit.pre-handoff.json) |
| 15:23:08.8996178 | 13项运行控制物理原件保留，活动工作副本字节一致，原 gate 仍在活动路径 | [控制文件保留记录](public/window/control-archive.completed.json) |
| 15:23:36.0470589 | 外部 PS7 Host 安装；88项受控集合仅此 Host 摘要按清单改变，runner 未变 | [Host 安装记录](public/window/host-install.completed.json) |
| 15:23:55.007 | Host 替换后再审计：旧身份全消失、Job 全0、完整库存匹配0、无监听/监控 | [替换后审计](public/window/audit.post-host-pre-gate.json) |
| 15:24:34.9798957 | 同一原物理 gate 保留至维护目录；随后释放维护者互斥 | [gate 交接记录](public/window/gate-handoff.completed.json) |
| 15:24:34.9945558 | 唯一正式 Task 发起启动，EnginePID/Host=37480 | [Task 启动请求](public/window/task-start.requested.json) |
| 15:24:35.4437261 | PS7 runner PID36620 写入 `runner_started` | [登录运行日志](public/window/failed-attempt/log-data/login-management.jsonl) 第100行 |
| 15:24:44.6388627 | 自动恢复预算记入一次 `login_start`；其 `runId` 仍是启动前旧运行 | [本次预算](public/window/failed-attempt/run/login-recovery-budget.json) |
| 15:24:52.894 | 正式 Manager PID27384 的 `start` 已获授权 | [恢复授权审计选段](public/related/login-recovery.selected.jsonl) |
| 15:25:05.7959406 | 本次新 gate 的创建时间，物理 FileKey 不同于原事故 gate | [保存的 gate 绑定记录](public/window/failed-attempt/gate-binding.json) |
| 15:25:19.820 | 写入本次新 request：`be3f...`，startupDeadline 为15:27:19.819 | [request](public/window/failed-attempt/run/request.json) |
| 15:25:34.835 | 对同一新 runId 写入 `START_ABORT`；距 request 15015毫秒 | [abort](public/window/failed-attempt/run/abort.json) |
| 15:26:08.278 | 恢复审计写入 `denied/start`；该标签也用于已授权操作发生异常，并不能单凭它认定授权失败 | [恢复审计](public/related/login-recovery.selected.jsonl)、`TongLoginRecovery.mjs` 的 catch |
| 15:26:08.9355619 | runner 记录 `manager_command_failed/start/CLEANUP_REQUIRED`，exit=1 | [登录运行日志](public/window/failed-attempt/log-data/login-management.jsonl) 第102行 |
| 15:26:09.9562717 | Task 提前退出；控制者将 Task 禁用，未取得 healthy runId | [Task 失败记录](public/window/task-start.failure.json) |
| 15:28:02.485 | 失败后完整库存匹配0、旧身份全消失、旧 Job 全0，无监听/监控 | [失败后审计](public/window/audit.failed-start.json) |
| 回退前 | 新 runId 的四类 Job 全0，Host37480/runner36620 均已不存在 | [补充原生证明](public/window/failed-run.native-proof.json)；此文件自身未记 observedAt，不补造精确查询时间 |
| 15:30:51.8321542 | 原物理 gate、16项控制文件及旧 Host 恢复；新失败控制、Host、temp、日志另外保留 | [回退完成记录](public/window/failure-rollback.completed.json) |
| 15:32:05.6392332 | 回退后实际 doctor：phase=`abnormal_exit`、healthy=false；维护互斥已释放 | [本地收尾](public/window/local-recovery.final.json) |
| 15:38:36.7259015 | ngrok 经 Start-Service 恢复，管理员原生身份验证通过，PID40764 | [服务恢复](public/window/ngrok.Restore.result.json)、[恢复后身份](public/window/ngrok.admin.restored.json) |
| 15:41:34.9026518 | 窗口按失败流程结束，Task Disabled/0实例、READY=false、doctorHealthy=false | [最终记录](public/window/maintenance.closed.failure.json) |

## 进程与记录：能证明什么

- 正式 Task、外部 Host37480、PS7 runner36620 的身份由本窗口操作记录及 runner 日志相互支持。失败日志没有产生 `runtime_healthy`。
- 新 request 与新 abort 证明本次 Manager 走到了新运行启动与异常收尾代码；旧 `runtime.json` 和 `guardian.json` 没有被本次运行替换。
- `child?.pid` 分支才会写入新 abort，因此依据固定源码可推导 Node 的 spawn 对象曾取得 Launcher 子进程 PID。**没有保存这个具体 PID、创建时间、退出码或 Launcher stdout/stderr，不能补造进程身份。**
- 不能把“没有新的 Guardian 记录”写成“操作系统从未创建 Guardian 进程”。Guardian 在写 `guardian_started` 之前还会执行生产授权预检；此前进程可能存在但尚无记录。
- 本次 runId 在现存 `guardian.jsonl`、`supervisor.jsonl`、本窗口保存的 lifecycle 日志均没有匹配事件。现场后续 Job=0/进程消失证明回退时可安全保留文件，不是最初 Manager 当时已经取得清理证明的替代品。

## 证据缺口及下一步最小建议

1. Launcher PID、完整终态回执、最初异常码、有限 stderr，以及每轮清理轮询结果均未保留。`guardianComplete()` 没有逐项诊断输出。本包不能恢复这些不存在的记录。
2. 约15秒的 request→abort 时差与 Launcher 的15000毫秒等待器相符，**强烈支持但不能单独证明**该等待器触发；非零退出、输出/身份解析失败等仍未被日志排除。
3. 原版 Launcher 仅在生产固定根上执行额外 `preflight-login`/`preflight-production`，现有 simulation 根会跳过这一块；PS7 外部 Host 不会把内层 PS5.1 Launcher/Guardian 改成 PS7，内层还会使用 `safeEnvironment(root)` 指向的 TEMP。隔离成功不能覆盖这些生产特有路径，详见清理分析。
4. 下一步应先由复审者决定是否允许在**隔离副本**补足这条生产预检路径的观察和失败用例：记录有限阶段、子进程身份、初始错误和独立清理结果。若要求完全保持原版源码，应先取得等价路径的离线/隔离测量证据，再判断是否需要极小的可观测性修订。
5. 本轮未实施修复。不能只增加超时、接受空 Job 的事后查询、删除 gate、伪造 Guardian/Launcher 记录或改 phase 来重新放行生产。Task 保持停用；下一次恢复需独立复审后的明确操作范围。

历史旧运行曾记录 `MONITOR_FAILED`，随后 Supervisor 有 `SECURITY_UNAVAILABLE` 的 unhandled rejection；两者的时间和本次 Launcher 问题不同。不能把这个历史异常倒推成本次启动的已证实根因。
