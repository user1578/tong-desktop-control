# Tong 登录静默启动

`TongLoginHost.cs` 编译为 Windows GUI 程序。它以当前交互式身份使用
`UseShellExecute=false`、`CreateNoWindow=true` 启动原有 PowerShell 5.1 runner，
持续等待并转交退出码，异步排空 stdout/stderr。任务仍由计划任务管理，
保留登录触发、无限执行时长、三次故障重试、IgnoreNew 和独立 Guardian。
保留 PS5.1 是为了复用正式版本已固定哈希的入口，不影响开发脚本使用 PS7。

## 验证和切换

在 PS7 执行 `tests/Test-TongLoginHost.ps1`，检查真实子进程没有控制台窗口、
身份相同、父进程等待、退出码 37 和启动失败码 1，以及输出日志。

将测试生成的 exe 传给 `scripts/Set-TongSilentLogin.ps1 -Mode prepare
-EvidenceRoot <受保护的新目录> -VerifiedHost <测试生成的 exe>`。
prepare 检查正式状态和任务身份，保留原 XML、入口和哈希。apply 使用同一个
任务的短暂 Parallel 策略启动新监控，立即恢复 IgnoreNew；确认新 runner 的
健康事件及原 Supervisor 运行身份后才停止仍存活的旧任务实例。
原 runner 的生命周期互斥锁可能使竞争中的旧监控提前非零退出；Guardian
不归旧监控所有，继续运行。切换失败时保留证据、恢复原定义，不终止生产组件。

## 回滚

`Set-TongSilentLogin.ps1 -Mode rollback -EvidenceRoot <原备份目录>` 只恢复
原任务定义，当前健康监控保持运行；下次启动恢复原入口。无需重新部署正式代码，
不会改动 pin、OAuth、ngrok、PIN 或业务数据。入口和日志均保留。

2026-10-17 的正式备份位于
`D:\Tong\runtime\login-management\rollback-20261017`。原运行 ID
`550dc0cf-13f3-4ed9-bbe7-3da6dd052cd0`、Supervisor 15476、Guardian 2948
保持不变；正式 app 和 manager 仍是 `3442cbb`。真实重启登录测试由用户完成。

## 2026-10-17 冷启动超时修复（开发验证，待生产确认）

失败运行 `f217b3d7-d180-4af6-81c6-a75b65c391cd` 在 DevSpace 第 29.596 秒进入
`server_import_begin`，约 16 秒后触发旧的 45 秒上限，尚无 import complete。
最近成功就绪耗时为 23.606、38.285、44.269 秒；历史导入最长约 18.93 秒。
这些证据表明固定总限与正常冷启动发生重叠，不能据此认定导入死锁。

保留启动总上限 120 秒，从写入启动请求起计算，包含 launcher 和 Supervisor
初始化，超时后仍须完成 Guardian 清理核验（沿用最多 300 轮、每轮间隔 100ms，
身份/Job 查询时间另计，不能解释为严格 30 秒墙钟上限）。DevSpace 总限为 75 秒，
Gateway 为 35 秒，synthetic 原有 20 秒不变。每个子进程按下表约束无进展时间：

| 当前阶段 | DevSpace | Gateway |
| --- | ---: | ---: |
| spawned，等待 settings_received | 30 秒 | 30 秒 |
| settings_received，等待 approval_verified | 15 秒 | 15 秒 |
| approval_verified，等待 candidate_verified | 20 秒 | 20 秒 |
| candidate_verified | 10 秒 | 15 秒 |
| config_loaded / log_protection_ready | 各 10 秒 | — |
| server_import_begin | 30 秒 | — |
| server_import_complete，等待 ready | 10 秒 | — |

仅已知且向前推进的阶段可开始下一段预算；重复、倒退及未知事件不续期。
任意阶段仍受子进程和启动总限约束。超过原 45 秒记录一次 `readiness_slow`。
阶段卡死为 `CHILD_STAGE_TIMEOUT`，子进程总限为 `CHILD_READINESS_TIMEOUT`，
全过程总限为 `START_TIMEOUT`，提前退出为 `CHILD_EXIT`。日志保存 role、stage、
阶段/累计耗时、timeoutKind 及可用的退出码；runtime 记录保存 startupFailure。
导入完成事件另记录实际 import 时间、CPU user/system 时间和 RSS，不记录业务内容。

登录监控仅在 run 模式、manager start 返回 START_FAILED/START_TIMEOUT、且状态
已终止时使用原有预算重试。每 30 分钟最多 3 次，每次至少间隔 60 秒，跨 wrapper
和任务重启保留；不清空预算、不延长窗口。授权拒绝、清理未完成、身份未解决及
明确 stop 均停止重试。连续失败耗尽预算后非零退出，保留证据，需人工诊断或后续
登录触发；不会无限重试。单次偶发超时现在可在同一 runner 中恢复，不依赖任务重启。

`doctor: REFUSED` 是独立待查项：2026-10-17 03:59:15 UTC（12:59:15 JST）
发生在运行 `550dc0cf-13f3-4ed9-bbe7-3da6dd052cd0` 已就绪数小时后。
旧 wrapper 仅在非零退出且无法解析错误 JSON 时使用 REFUSED，不能证明授权拒绝。
现有 host.stderr、login-management.log/jsonl 均无原始 doctor 退出码，对应时段
未查到 Application Error/WER 记录，无法确认根因。其后 05:30:54、09:15:20 UTC
Supervisor 的 SECURITY_UNAVAILABLE 属于另有时间证据的故障，不作同源推断。
新增 manager_command_failed 只保存 action、nativeExitCode、exitHex、outputKind，
供下次区分原生退出、错误输出和明确授权拒绝。

### 受控恢复方案

生产切换尚未授权。已停止的正式运行、任务、授权和 pin 保持原状；以下仅供最后确认：

1. 使用 Rune 的原交互身份、Limited 任务和固定 `D:\node\node.exe`。核对 DPAPI
   CurrentUser 身份、原任务 XML/GUI host、当前 app/manager pin 和授权 descriptor。
   新 manager 与新 runner 的哈希必须获得原有生产授权流程批准，不能复用旧哈希授权。
2. 确认旧运行 Guardian finishedAt 存在、jobActiveAfterCleanup=0、精确进程身份消失，
   7676/7677/18765 无监听。保持 ngrok 独立；不更改 OAuth、PIN、真实业务数据。
3. 使用独立候选目录及完整 release manifest；保留旧 manager、runner、pin、授权和
   任务定义的恢复材料。仅在维护窗口停止登录入口，待运行确已停止，再按现有受控
   安装流程切换 manager/runner，不覆盖运行中的文件。正式 app 仍可保留 3442cbb，
   无须更改 DevSpace 业务功能或重新安装依赖。
4. 新 manager/runner/grant 绑定一致后启动原静默入口，观察三个组件 ready、doctor、
   未认证 MCP 被拒绝、Guardian private Job、阶段耗时及恢复计数。真实 Windows
   重启登录验收安排在用户确认的维护窗口；开发模拟不能替代这一步。
5. 任一 pin/身份/授权不符、超时后 Job 非零、端口残留、认证检查异常或三次恢复耗尽，
   立即停止切换。先通过 manager/Guardian 清理精确新 run，确认 Job 为零，再恢复
   保留的 manager/runner/pin/descriptor 与任务定义；不回滚或覆盖业务状态、OAuth。
   如旧 grant 已撤销，必须按原有交互流程重新批准旧 descriptor，不能恢复被撤销的授权。

既有候选和回滚材料均保留于 `D:\Tong\state\p26-release-preparation-67ffa0da`
及 `D:\Tong\runtime\login-management\rollback-20261017`，另有 runtime/releases
和 state-backups 历史材料。候选准备不等于生产批准。生产批准应仅覆盖一次约定维护
窗口内的 manager/runner 切换、原有范围的授权重绑定、启动验收及必要回滚；不延伸到
权限扩大、业务迁移或后续部署。

本轮验证后的 release 归档候选保存在
`D:\Tong\state\p26-startup-readiness-20261017\release`，含提交绑定的 source.tar、
源文件哈希、固定版本及原生模块；不复制完整依赖树、不安装到生产。旧候选、原入口
和回滚材料继续原位保留。
