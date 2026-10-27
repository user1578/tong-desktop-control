# Tong Desktop Control 项目工作约定

- **控制磁盘占用**：测试、构建、依赖安装、打包或创建隔离环境前，先检查并优先复用现有资源。单个任务累计预计新增超过 1GB 时，先报告用途、预计增量和轻量替代方案；未经用户明确允许不得执行，也不得拆分操作规避限制。
- **禁止无意义重复**：不得为相同目的反复生成完整项目副本、`node_modules`、release 包或测试实例。相关代码、环境和前提未变化时，复用已有有效证据。
- **按需测试**：先静态检查和针对性测试，再按具体风险进行必要的集成测试。不得无原因重复完整测试矩阵、构建或冷启动；不得通过随意加大超时、降低断言或跳过验证掩盖问题。
- **控制产物**：优先复用已有诊断目录和发布候选；新增文件必须有明确用途。简单结论直接写在最终回复中，不为每个步骤创建 JSON、Markdown 或日志汇总文件。
- **按精确范围整理、减少备份**：用户要求清掉已证明无用的测试、可重建缓存和重复发布副本，不再为这些内容追加整目录备份。先核对正式pin、Windows任务/进程、脚本/授权引用、原生会话、Git独有源码及恢复依赖；当前无引用、可重建的精确目录可按用户授权直接删除，记录路径/大小/回执。不得通配清空state、跟随junction或删除共享node_modules目标。独有非敏感代码与文档优先存GitHub；严禁上传凭据、OAuth/DPAPI、数据库、私有日志。重要数据和生产改动仍需正式授权。
- **Git 必须收尾**：实际修改源码、测试或规则后，检查 diff、完成相关验证，只暂存本任务文件，在当前已授权的 `codex/` 开发分支创建本地 commit，并正常 push 至现有 upstream。禁止修改 main、force push 或提交无关文件；无实际修改则报告无需提交。报告分支、SHA、push 和 upstream 状态。
- **保护真实工作区**：每轮先核对git status，保护当下已修改、未跟踪文件、分支ref和共享.git；不以旧记录的固定文件数作为当前状态。不要为整理覆盖、暂存或删除既有用户改动。当前维护工作树的独立复核文档有用户未提交修改，保持原样。
- **减少重复工作**：优先引用已有设计、审核和验证结果，不重复编写计划、重做架构、重新打包或开发已有能力。
- **生产边界与故障诊断**：当前生产运行时的源码pin、授权、服务、Windows任务、恢复预算和用户数据不因整理/文档自动变化。2026-10-27仅恢复了READY与网页MCP通信，native doctor fast-fail及MONITOR_FAILED底层根因尚未根治。新故障先核查本次证据，不能凭旧EPERM/超时猜测。部署、提权、ACL/身份/认证、重置预算和重要数据删除按实际工具门禁取得明确授权。

## 项目总入口与Codex任务约定

- **先读全项目总任务书**：[docs/Tong-Master-Project-Taskbook.md](docs/Tong-Master-Project-Taskbook.md)、[用户确认的22项最终需求](docs/Tong-GrillMe-Final-Decisions-20261027.md)和[新对话修复入口](docs/Tong-New-Chat-Repair-Guide.md) → [docs/Tong-Project-Plan-and-Handoff.md](docs/Tong-Project-Plan-and-Handoff.md) → 当前专项子任务书（如 [Codex进度与原生会话](docs/Tong-Codex-Goal-Supervision-Taskbook.md)）。总任务书覆盖Tong统一MCP、所有Agent Provider、Windows磁盘/RAM/PC维护、全局编排、项目治理、稳定性与交付；后两份不是整个项目的替代品。若当前Git worktree缺文档，从已授权的`codex/024-maintenance-adapter-20261024`分支读取，不强制切分支、覆盖dirty文件。旧报告是历史证据，不冒充实时状态。
- **谁操作**：用户没指定Agent时ChatGPT优先使用Tong直接操作。用户指定Codex时须实际调用Tong创建/继续**Codex Desktop原生会话**；不能假冒CLI/非原生会话。默认优先同项目最新适用会话，用户指定准确会话时按其选择。writer冲突不清锁、不强杀桌面App、不静默换新Session。
- **一个任务一个Goal**：预计多轮的任务优先走`tong_goal_start`并保持goalId/projectId/nativeSessionId/child Turn；ChatGPT监督、查询、核验并在同一目标中继续，通常2–4个必要回合，不凑回合。**单轮Turn成功不等于业务完成；不能每轮给用户最终汇报。** 整项目标通过业务验收后统一总结；只有需要用户真正决定/操作的阻塞提前报告。
- **本机资源管理是长期工作**：用户可随时要求扫C/D盘、RAM/CPU/进程和帮助清理存储。先走Tong只读受管观测，找出实际大文件/缓存/重复依赖，按精确路径执行获准清理并核实空间变化。磁盘文件逻辑大小不是实际NTFS释放量，RAM与磁盘不要混淆。不默认扫描私人文件正文或擅自关闭系统进程。
- **多Agent统一入口**：Tong最终是ChatGPT调度Codex、DeepSeek Harness、Zcode/Zode、Claude Code、Work Buddy等的单一MCP平台；新增Agent做内部Provider适配器，声明实际支持的会话、Desktop可见性、权限和工具能力，统一Goal/状态接口，不把CLI会话当作桌面原生会话，未真实验收不得标上线。
- **真实进度与跨端体验**：用真实已部署`tong_goal_status`及可用的有界wait，展示当前步骤、实际活动、完成证据、更新时间和阻塞。技术检查与业务完成分开；不能凭Codex自述success打完成勾。ChatGPT回复结束后**普通MCP不能继续自动刷新同一个聊天面板**，持续面板需宿主支持或另设经认证看板。Codex Desktop新会话需退出重开才出现的问题尚未彻底修复，必须做用户目视验收，不得将deep-link派发成功当作可见性证明。
- **交付收尾**：保留当前用户文件，最小必要测试和独立审核后只提交自己的改动到授权codex分支；报告原生Session、Goal、最终业务验收、Git commit/upstream和必要后续。不得用数十份新的报告重复同一事实。
