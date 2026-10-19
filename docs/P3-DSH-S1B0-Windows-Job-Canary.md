# Tong P3 — DSH-S1-B0 Windows Job Object 原生模拟验收（2026-10-19）

阶段：**S1-B0 Windows真实进程树回收测试通过；生产级可信DSH Runner尚未完成。** 本阶段没有启动DSH，没有模型调用，也没有修改任何已登录的Desktop会话或生产Tong。

## 已完成的代码

- `tests/TongDshS1BJobCanary.cs`：独立的C#原生模拟执行器，只接受 `--canary normal|timeout|cancel|tree` 和仅用于内部子进程的固定测试参数，不接受目标程序路径、模型提示词、DSH运行配置等外部参数。使用 Windows Win32 API：`CreateJobObjectW`、`SetInformationJobObject`、`QueryInformationJobObject`、`CreateProcessW`、`AssignProcessToJobObject`、`ResumeThread`、`TerminateJobObject`。
- `tests/Test-TongDshS1BJobObject.ps1`：PowerShell 7固定测试脚本，通过Windows自带Framework64编译器构建**测试专用**模拟EXE到独立Temp路径。每轮执行四个固定场景并校验精确JSON结果，拒绝未知参数，最后删除测试目录。不会写入生产目录。
- CI `.github/workflows/p3-dsh-desktop-runtime.yml`：Windows GitHub Runner执行真实Job canary，Windows/Ubuntu继续执行纯合成回归。

## 真实Windows验收数据

| 场景 | 执行 | 验证 |
| --- | --- | --- |
| `normal` | 挂起创建、加入Job、恢复、等待正常退出 | `status=completed`；活动进程清零 |
| `timeout` | 固定休眠模拟任务，短时后强制终止Job | `status=timed-out`；活动进程清零 |
| `cancel` | 固定休眠模拟任务，在160ms后模拟取消并停止Job | `status=cancelled`；活动进程清零 |
| `tree` | 模拟任务启动第二层模拟进程，确认Job中至少两个活动进程后强制停止 | `status=descendants-killed`；活动进程清零 |
| 非法模式 | 传入任意用户自选执行目标 | 拒绝，不能用此入口运行DSH或任意程序 |

每个进程在执行第一条用户代码**以前**，由受控父进程在 `CREATE_SUSPENDED` 状态下 `AssignProcessToJobObject`，成功后才 `ResumeThread`。Job创建时设置 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 和 `JOB_OBJECT_LIMIT_ACTIVE_PROCESS=4`，并通过 `QueryInformationJobObject` 复核。若加入Job失败，不允许恢复进程。终止后复核 `ActiveProcesses=0`；所有句柄在 `finally` 清理。

一轮本机结果：`status=passed`，正常/超时/取消/树清理四项均返回活动进程0，未知目标拒绝。本轮用于证明**Windows原生模拟进程树回收**，并非运行安全沙箱。

## 不能误认为已经完成的能力

1. **Windows身份/权限隔离未完成。** 当前Canary使用同一Windows用户的普通进程，未启用Restricted Token、AppContainer ACL、完整文件系统和网络权限限制；即使能关停Job，也不能阻止任务在运行期间访问用户数据。回执显式为 `osPermissionSandbox=false`。
2. **未启动真实DSH SDK。** 没有验证 `dsh --profile sdk` 在46项插件禁用后是否能够初始化；也没有执行真实运行时的Shell、文件、Web、MCP拒绝用例。
3. **真实取消接口未完成。** `cancel`是固定内部定时模拟取消，不是可由Tong远程请求的经过认证的任务取消IPC。必须新增受限、绑定审批摘要的进程控制接口后再推广。
4. **进程执行约束仍待加强。** 此原生测试器自己固定了模拟程序并限制了命令行，却不是可部署的DSH通用Trusted Runner；尚需可执行文件及用户身份固定校验、密钥过滤和安全的Session目录保留、崩溃恢复等。
5. **Desktop界面连续性没有证明。** Headless/SDK与Desktop Profile仍是不同会话来源，不能宣称CLI会话可以在桌面应用中看到或继续。
6. **内存/CPU等限制**还未在此Canary上证明；只验证活动进程数量上限及Job清理。不要从这些结果推断完整资源沙箱。

## 后续S1-B1门槛

设计和测试独立于Codex专用Supervisor的DSH可信启动与控制协议：可信固定二进制与版本Hash、Windows受限身份/ACL、受控环境变量、基于Session与Scope的授权签名、Job取消及超时后清理、独立私有状态存储。先用模拟启动器完成越权拒绝、二级进程、退出码、意外关闭与损坏授权用例，方可研究SDK启动。只有受限SDK运行时真实拒绝高风险工具且用户明确授权一次模型/可能计费方后，才能进行DSH真实会话验收。

本阶段始终保持生产 `TongAgentDockRuntime` 原版本 `a1b56b3666651c3648327f05e0ea4154284645c3`。
