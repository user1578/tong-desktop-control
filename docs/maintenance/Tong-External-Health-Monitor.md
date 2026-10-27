# Tong 独立只读健康监测器

状态：已编写、短时验证；不代表之前反复退出的根因已经修好。脚本是独立取证工具，不修改正式App/Manager、pin、恢复预算、权限、服务、计划任务或ngrok配置。

## 启动、状态和停止

- 脚本：`scripts/Watch-TongHealth.ps1`（PowerShell 7）
- 启动：从**Windows资源管理器双击** `scripts/Start-TongHealthMonitor.cmd`。不通过Tong MCP后台启动，因为它可能继承Tong的Windows Job，Tong退出后监控子进程也会退出。
- 默认每10秒采样，约每60秒检查Gateway本地OAuth发现与ngrok本地API；进程后台隐藏，无需保持启动窗口。
- 日志：`%LOCALAPPDATA%\Tong\HealthMonitor\health.jsonl`；`owner.json`只用于验证监测器自己的PID和启动时间。当前日志5MiB，历史轮转最多6份，总计约35MiB。源日志不会被删除/轮转，只轮转监控器自身的`health.jsonl`。

查询状态：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File "D:\Tong\development\tong-024-startup-recovery\scripts\Watch-TongHealth.ps1" -Mode Status
```

查看最近事件：

```powershell
Get-Content "$env:LOCALAPPDATA\Tong\HealthMonitor\health.jsonl" -Tail 50
```

停止监测（不停止Tong）：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File "D:\Tong\development\tong-024-startup-recovery\scripts\Watch-TongHealth.ps1" -Mode Stop
```

按需启动，不创建新Task或开机启动项。**重启Windows后需要再双击启动。**

## 监控内容及安全边界

1. 每次采样：正式计划任务的Running状态，TongLoginHost个数和PID，Supervisor/Guardian PID及进程存在性，`runId`与`phase`、Supervisor内存用量，7676/7677/18765端口，ngrok服务状态。
2. 每6个采样约一次：对`127.0.0.1:7676/.well-known/oauth-authorization-server`与`127.0.0.1:4040/api/tunnels`做有超时的本机HTTP检查。没有向公网发送健康检查，也不输出返回正文或token。
3. 增量读取正式`login-management.jsonl`、`lifecycle.jsonl`、`supervisor.jsonl`、`guardian.jsonl`和`production.login-recovery.audit.jsonl`的**新增行**，只记录固定字段。首次启动游标从各文件末尾开始；源文件截断会记录`source_rotated`，新日志积压超128KiB会记录`source_gap`，不无限制读入。
4. `sample`记录状态、端口、PID、探针结果；`health_transition`记录本机健康/不健康切换；`source_event`记录程序真实错误事件与阶段；`endpoint_probe`记录本地网络探针；`monitor_read_error`表示**监测器自身**读取源文件失败。`healthy=true`仅表示Tong本地进程/状态/端口一致，是否外部可访问仍需看ngrok及HTTP检查。
5. 不运行正式doctor（之前曾出现native-fast-fail/授权拒绝），不自动重启、不故障注入、不修改凭据/ACL/Task，不采集密钥、原始错误文本、栈、命令行、对话内容、私有状态文件正文；输出错误码/阶段经字符集校验，未授权字段被丢弃。监视器不可能在关机、睡眠或强制注销后继续运行。

## 发生故障后的用法

从`health.jsonl`中找到第一次`health_transition`到`TONG_UNHEALTHY`，对齐其前后`sample`与`source_event`的UTC时间；如果历史段被轮转，查看`health.jsonl.1`等。将相关文件或尾部100～200行上传到新ChatGPT对话；先按GitHub `AGENTS.md`和`docs/Tong-New-Chat-Repair-Guide.md`找到当前源码、授权和真实run，再按日志定位层级。

旧生产源码会将不同错误合并为`APPROVAL_DENIED`和`MONITOR_FAILED`。**监控脚本无法凭空恢复旧版本没有记录的底层原因**。开发分支`614aa0e`增加了脱敏阶段/错误类别，但**尚未正式升级部署**；后续需单独完成受控安装、回退及长时间验证，才可取得更精确的失败阶段。

## 真实验收范围

- PowerShell脚本语法解析通过。
- 生产只读试跑：3个正常健康快照，新增端点探针版本再次通过2个真实快照，ngrokService=Running、两个本地HTTP探针返回true。
- 隔离假runtime测试：`tests/Test-TongHealthWatcher.ps1`验证4个不健康快照、状态转换、模拟追加的授权拒绝事件被捕获，故意追加的私有secret字段未进入监控日志；测试夹具仅在该测试中创建并精确清理。
- 后台启动/状态/停止在受管会话内临时试跑成功，测试监控进程已停止。真正要在Tong退出后仍运行，必须从用户独立的Windows Shell/资源管理器启动；这项跨Tong退出的实机验收还未做。
- 没有新增生产守护层、Windows任务或全量测试环境，不声称做过24小时稳定性、系统重启、真实断线故障注入。

## 对后续清理任务的要求

监控启动后、确认`-Mode Status`显示Running和日志持续有`sample`，可以继续**下一批只读、精准目录查重及依赖核验**。实际删除仍须逐项满足生产pin、Windows任务/服务/进程引用、源码Git独有性、恢复依赖和个人数据边界；监视器不能代替清理授权。不要直接删除旧日志和能解释近期故障的证据。
