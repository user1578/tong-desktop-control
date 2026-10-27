# Tong — 新ChatGPT对话零长交接与故障修复入口

项目GitHub：`https://github.com/user1578/tong-desktop-control`
当前历史开发入口：`codex/024-maintenance-adapter-20261024` 与 `codex/codex-desktop-deeplink-20261021`；这些是2026-10-27的分支，不代表永久最新版本。正式产品需要以后提供release与稳定文档入口。

## 新对话的最短指令

“检查并修复我的Tong项目。GitHub是`user1578/tong-desktop-control`。请按仓库AGENTS.md和全项目任务书读最新状态；有本机Tong连接就查真实日志/版本/进程再做有界修复，不能连接就先查GitHub并给出准确恢复步骤。保护原有未提交文件，普通改动走codex分支，生产升级需明确授权。”

通常用户甚至可以只说“Tong这里出问题了，帮我查一下”；ChatGPT如保有项目上下文即可定位上述仓库。但在新账号/记忆不可用时，提供一次仓库名或连接器授权即可，不需要贴长篇历史记录。

## 新对话助手必须做

1. 使用可用GitHub连接器查当前仓库、README、AGENTS.md、总任务书、当前状态和故障记录；若本机Tong能连，读实际git status/生产pin/运行健康和最短相关日志，区分新旧事故。
2. 定位问题属于本机MCP连接、登录恢复、Codex原生会话、Goal supervisor、Agent provider、磁盘/权限、安装或更新中的哪一模块。先复现/用证据诊断，不套用旧故障结论。
3. 仅在既有权限下做合法可逆修复和针对性测试；有原生Codex要求时实际派发到真实Desktop原生会话，并在目标级监督、完整通过后再汇报。执行工具失败要如实报告原始错误，不伪称任务已下发。
4. 保护当前Git脏工作树和敏感运行态，不改main或强推。正式生产更新、权限、系统服务、重要数据删除仍需真实门禁。
5. 给出完成/未完成、真实验证、准确commit、剩余风险和下一动作；只更新少数权威文档与索引，不堆积完整恢复副本。

## 按需启动与连接器掉线

Tong新版本拟提供BAT/PowerShell setup/start/status/doctor/stop命令。目前原仓库不保证上述新命令均存在；必须根据实际正式release与现有脚本核对后执行。Tong掉线时，ChatGPT无从直接使用故障的Tong修复自己：需受支持的独立恢复入口、用户本机Codex Desktop执行或其他独立授权工具。不得通过权限绕过、重复启动或手动删除锁尝试“快修”。

## 用户个性化简短指针（可选）

我的长期项目是Tong Desktop Control，GitHub仓库`user1578/tong-desktop-control`。ChatGPT为主Agent、Tong是Windows本机统一MCP及多Agent中心；默认ChatGPT直接操作，指定Codex等再委派。涉及Tong故障或开发时，优先读仓库AGENTS.md、Tong全项目总任务书和最新状态，结合本机实时证据排查；保护Git未提交内容，不修改main，不擅自部署生产。长任务按整个Goal验收后统一汇报。

个性化只是定位索引：不包含实际API密钥，不建立新账号权限，也不能保证完全陌生会话在没有仓库访问的条件下获得实时状态。
