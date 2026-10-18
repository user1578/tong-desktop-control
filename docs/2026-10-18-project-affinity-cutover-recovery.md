# Codex 项目归属升级：恢复脚本 v3 (2026-10-18)

生产稳定基线：cc9c04dc6b0731f0d199c09372acfab83e0a2c11
升级目标：a1b56b3666651c3648327f05e0ea4154284645c3
上次失败回滚快照：D:\Tong\state\native-codex-acceptance-20261018\project-affinity-candidate\production-cutover-20261018085453751-22e4c3d4
原快照已处于 rolled-back-old-code。不要删除。

本次候选根：D:\Tong\state\native-codex-acceptance-20261018\project-affinity-candidate
release-manifest.json SHA256：44379a1fdbf6fbcbc7817b42390f900a42157878e7d9bfe47db82f01bfc57140。保留目标提交 a1b56b3，升级旁路脚本不包含在原发行源码中。

## 失败证据与本轮修复

上一次旧版在 08:55:22Z 完成 Guardian 退出，新版登录监控 08:56:43Z 收到 Manager 的 CLEANUP_REQUIRED，未进入 ready。自动回滚又因登录监控已退出而拒绝，提示 Expected exactly one live login monitor instance。

真实导致 CLEANUP_REQUIRED 的细分条件（旧 PID 复用、Job 仍存活等）当时未留有可独立核对的数据，不能臆断，也不能忽略安全检查。

v3 脚本修复如下：
1. 监控任务退出且存在受限 Manager 错误码时尽快报告 CLEANUP_REQUIRED 等错误，避免只有 doctor 等待超时。
2. 自动回滚时如监控任务已结束、调度器无运行实例、同命令 runner 和预期 Host 都不存在，则可安全禁用任务并恢复原源码；任务 Running、实例多个或有存活疑似进程一律拒绝。
3. 在旧版停止后且新代码安装前，严格核验 Guardian、Job、此前的 PID 和三端口清理状态。未完成即拒绝安装，不删除锁、不终止任何未知进程。
4. 生产审批仍由本机交互控制台完成；新旧版登录恢复授权分别绑定版本和哈希。

## 版本固定的旁路脚本

目录：D:\Tong\state\native-codex-acceptance-20261018\project-affinity-candidate

- Invoke-TongCutover-cc9c04d-to-a1b56b3-v3.ps1 SHA256: 0eb4e9efd00d634df2caf71b8907008df7a84d0e9930dde6ca23e5e76068834d
- TongCutover-cc9c04d-to-a1b56b3.mjs SHA256: 5cda6497ba4dbf692c923f5d02d21b4d26dcacf614a116aa19e922d3d886c537
- TongCutoverStoppedRunProbe.mjs SHA256: 8ee6bccd0e38d0a7ee331072b23fd694418536c4b3326534e293d1c0145f6c5e

旧 v1/v2 升级脚本不得再用于 Deploy。

## 已执行的隔离测试

- v3 PowerShell 语法、真实生产只读 Preflight 验证通过。
- tests/Test-TongCutoverMonitorRecovery.ps1 合成验证缺失监控恢复、运行中/重复实例拒绝、早期错误可见、清理守卫安装顺序。
- tests/Test-TongCutoverStoppedRunProbe.mjs 验证完整清理通过，正在运行的 Job、复用 PID、错误 Guardian 身份、端口占用被拒绝。
- 真实生产当前处于 ready、healthy=true，版本 cc9c04d，登录监控 Running。
- 旧版登录管理回归通过，文件级完整安装/中断后回滚演练之前通过。
- 历史长时运行时对账测试在合并测试中执行到 90 秒被中止，不能宣称该项通过；未改变底层 Manager 清理策略。

最终需要生产 ready、doctor healthy、监控 Running、工具连接，以及 Tong 新建原生 Codex 会话自动归入 Desktop 111 项目，方可宣布升级成功。失败则保留证据并走版本精确回滚，不重复试错。
