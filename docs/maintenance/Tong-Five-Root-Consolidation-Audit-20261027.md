# Tong及D盘四处遗留工程整理：Codex只读盘点交接（2026-10-27）

状态：**等待 Codex Desktop 实际盘点；未授权执行删除、迁移或生产变更。** 本文是扫描任务书与 ChatGPT 初步只读元数据记录，不是 Codex 结果，不能作为删除许可。

## 一、范围与目标

最终目标：将与 Tong 有关的历史工程/独立联调项目逐步统一纳入 \`D:\Tong\` 下管理，去掉经过核实确无用途的测试、脚本、构建缓存及重复资料，并保留已有功能成果、Git 提交、必要事故证据及生产可恢复性。

以下五处属于此次必须分别审查的根：
- \`D:\Tong\`：其中 \`app\`、\`runtime\` 是已经成功运行过的正式生产布局；\`development\` 含多个不同年代的源码仓库；\`state\` 含大量测试及恢复记录；\`tools\` 包含 ngrok。
- \`D:\agentdock-poc-20261010\`
- \`D:\tong-agentdock-local\`
- \`D:\tong-codex-acceptance-20261010\`
- \`D:\tong-desktop-control\`

**不能擅自移动/删除/改名这些根下的内容，不能碰 \`D:\Tong\app\`、\`D:\Tong\runtime\`、运行中的 Task/服务、认证、备份/gate、DPAPI/SQLite/OAuth/WAL/SHM、现有恢复预算。**

## 二、ChatGPT 已获得的初步只读元数据（不是最终调查）

工具：Tong 的 \`tong_scan_directory\` / \`tong_list_projects\`。主要结果：
- \`D:\Tong\development\` 当前可见五个一级目录：\`test-temp\`、\`tong-024-startup-recovery\`、\`tong-desktop-control\`、\`tong-launcher-startup-recovery\`、\`tong-startup-hotfix\`。
- \`D:\Tong\runtime\` 当前可见 \`run\`、\`login-management\`、\`secrets\`、\`releases\`、\`logs\`、\`state-backups\`、\`state-restores\` 等；全部先视为生产依赖候选，不列入删除清单。
- \`D:\Tong\state\` 一级汇总约1609个目录、13个文件；返回结果有分页。未完成每个状态根的内部依赖核验或体积统计，不能一概按旧缓存处理。
- \`D:\agentdock-poc-20261010\` 有 AgentDock 源码、ZIP及SHA256、Python MCP 测试脚本、隔离测试根和历史报告。
- \`D:\tong-agentdock-local\` 有 \`backend-state\`、\`run\`、\`secrets\`、\`profile.json\`、\`releases\`、\`logs\` 等历史运行态元素。**这些不能按普通缓存删除或上传到公开GitHub。**
- \`D:\tong-codex-acceptance-20261010\` 有 \`calculator.py\`、测试、\`.venv\`、\`__pycache__\`、\`.pytest_cache\`；它还是 Tong 已登记的 metadata-only 项目，移动前须分析项目注册路径与 Codex 会话关联。
- \`D:\tong-desktop-control\` 有早期完整 Tong 源码、\`docs\`、\`scripts\`、\`tests\`、\`node_modules\`、\`runtime\`、\`backups\`、\`logs\`；不能假定与新工程逐字节重复。
- Tong 当前项目注册表还登记了 \`tong-archive-agentdock-poc\`、\`tong-archive-agentdock-local\`、\`tong-archive-desktop\`，以及 \`tong-calc-accept-20261010\`。搬迁前必须处理“旧绝对路径”引用，但现阶段不能改注册记录。
- 以上外置目录计数/大小均仅是有界深度扫描的结果，不等于完整递归占用，不能据此计算可回收空间。

ChatGPT 在网页端发起过两次 Codex 原生调度：一次跨目录只读盘点、一次限授权项目只读盘点，均只返回 \`Agent task request failed\`。随后的 task list 没出现新任务 ID；**因此 Codex 尚未实际开始这次扫描**。不应伪称后台已启动，亦不应尝试绕过原生授权。

## 三、给 Codex Desktop 的实际任务

**目标**：执行五处根目录的先行只读调查，提供用于 ChatGPT 二次独立判断的可核实报告。现在仅调查，禁止清理、迁移或生成发布包。

**工作要求**：

1. 先读取本文件、项目 \`AGENTS.md\`，确认当前Git状态及授权边界；只使用正常的用户权限，遇访问拒绝直接记录，跳过 junction/symlink/reparse、私有密钥和真实用户内容，不为扫描做管理员提权。
2. 对五处根按目录/用途/体积/最新修改时间分组统计。体积统计应标明“可达目录、跳过项、是否为硬链接或共享依赖”等限制；优先使用有界扫描，不对 D 全盘跑哈希或复制文件。
3. 只读核验每个源码仓库的 Git 工作树、branch、HEAD、remote、是否有未提交的文件、是否有独有改动，以及与当前 \`D:\Tong\development\` 的重复/继承关系。不要清理 Git、切分支、重置或自动提交。
4. 只读搜索**非敏感配置和脚本**中的绝对路径、任务名、启动引用，分析正式生产、登录后恢复、ngrok、AgentDock、DevSpace、已有 Codex 原生会话和已登记 Tong 项目是否可能仍引用四个旧根或 \`state\` 下特定根；禁止读取、打印、转存真实凭据和私有日志正文。
5. 按“生产必留/当前开发必留/证据或备份保留/建议迁移/疑似可删（仍需核实）/未知”分类。细分 scripts、tests、旧构建产物、.venv、node_modules、测试根、日志、重复发布物；不得按文件名直接判删。对每组提供至少一个支持证据及删除后可能损失。
6. 提出 \`D:\Tong\` 内统一布局的候选结构，例如 \`app\` / \`runtime\` / \`development\` / \`tools\` / \`archives\`（仅作为方案，不实际建目录）。说明四个旧根迁移后的绝对路径、Codex会话可续接性、旧注册记录、服务配置、权限完整性、Git引用如何维护，明确必要的迁移/回退验收。
7. 写出**分批迁移与清理操作清单**，每一步包含源/目标、大小估计、是否可撤销、需要的停机条件、原始备份/哈希证据、改动前后验证、用户确认项。只出方案，不执行操作。优先建议归档而非立即删除独有历史材料。
8. 为避免重复膨胀，报告集中在一份 \`docs/maintenance/Tong-Five-Root-Consolidation-Codex-Report-20261027.md\`（如果当前项目写入授权允许）；不要生成大量附属JSON或完整拷贝，不在公开报告中出现凭据/私人内容。若因权限不能写文件，直接在 Codex 聊天中回复完整报告。
9. 报告真实完成范围、跳过范围、异常、哪些结论尚不能证明。完成后交给 ChatGPT 做二次复核，**等待用户确认才可迁移或删除。**

**验收**：能看到五处根的独立盘点与相互关系、真正可压缩的重复/缓存类别、必留依赖、可执行并可回退的迁移方案；生产与Git工作树保持原状，未执行任何删除。

## 四、ChatGPT 后续二次复核规则

只在拿到 Codex 的实际日志/清单后进行二次独立核对；优先重新核验“建议删除”的候选，确认是否受运行服务引用、是否有独有文件/未提交记录、能否先归档，确认后才给用户明确的批次执行建议。不将“看起来是测试文件/脚本”自动等于“已经没用”。
