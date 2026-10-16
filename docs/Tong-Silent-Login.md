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
