# Tong Desktop Control：正式生产通信恢复成功及后续交接（2026-10-27）

> **当前结论：正式生产通信和 ChatGPT 网页端本地文件读取、写入及编辑均已通过实测；长期稳定性、真实 Windows 重启后的自动恢复仍未验收。** 这是恢复成功后的交接入口，不取代原始日志、生产收尾回执或此前失败证据。文中“生产回报”与“ChatGPT 实测”分开记录；后续任何复查应先阅读本页，再按需打开对应原件，不必重做已通过的全套测试。

## 1. 当前版本、生产状态和证据

- 开发仓库：D:\Tong\development\tong-024-startup-recovery
- 开发分支：codex/024-maintenance-adapter-20261024
- 运行代码基线提交：7e42efc4a109a06fb543216b3506187bf9db4d51
- 已验收的精确启动恢复候选：b9fe80150f9cdea47130e8952e85e39503187677
- 源码归档 SHA256：c1bc5c18e5a91193a8d634c14a82cc2e56675c5db28e28de252e70c0d6593888
- release-manifest SHA256：1f3cfcfd6f12212e1c9eb82e5de93c889dd52d82a16bbeba26cde1f365551015
- 候选七文件的实际打包哈希：见 [CANDIDATE-MANIFEST.json](evidence/024-startup-budget-recovery-20261027/CANDIDATE-MANIFEST.json)，不要以开发树 LF 文件哈希代替实际安装 CRLF 哈希。
- 生产结果由用户转述本机收尾记录：正式 Task 为 Enabled、1 实例、READY；**只执行过一次正式 Task.Run**，request→READY **108.905 秒**；doctor.healthy=true，两次定期 doctor 退出 0；Gateway、DevSpace、AgentDock、ngrok 可用。版本绑定的自动恢复授权仍保留，恢复预算未重置。这里记录的是该次收尾时的状态，**不是未来每次阅读本页时的实时健康保证**。
- 本轮成功生产维护审计目录：
  D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\offline-9850e1a\production-comm-3b9a0831-648f-4345-90b6-2e1db0237778
- 生产原件（本地私有，不复制进 Git）：上述目录的 maintenance.closed.success.json 与 chatgpt-web-read.acceptance.json。后续需详细审计生产安装/权限/版本绑定/清理时，优先读这两份及其引用的本机原始回执。
- 生产 App/Manager、Task、Host、ngrok 与真实数据库的可变状态，需用新的**只读**检查确认；本文件不储存或替代实时原生证明。

## 2. 真正完成的端到端验收

**生产侧结果（用户根据本机验收回报，ChatGPT 未独立打开本机成功收尾回执）：**

- READY、首轮 doctor、两次定期 doctor 已通过。
- Gateway / DevSpace / AgentDock / ngrok 链路及认证 MCP 已通过。
- 经连接器进行新建、编辑、重读和越界拒绝检查已通过；生产服务继续运行。
- 以上不能代替 ChatGPT 网页端对新文件的实际写入测试，也不能推出重启恢复或长期可靠性。

**ChatGPT 网页端直接执行的、已独立观察到的两次 Tong 调用：**

1. open_workspace({path: "D:\\Tong\\app\\demo-workspace"}) → 成功，workspaceId = ws_1792ff02a1。
2. read({workspaceId: "ws_1792ff02a1", path: "tong-production-web-3b9a0831.txt"}) → 成功，工具实际返回：

    Tong production communication acceptance
    nonce=TONG-WEB-1793032086091-2e1beb6708fd48
    state=EDITED_AND_REREAD

工具无报错。用户随后确认网页端回传的 nonce 与本机一致。**因此可以认定 ChatGPT 网页端 → Tong MCP → Windows 本地文件的真实读取链路成功**，不是聊天上下文复述或合成模拟。该 nonce 为一次性验收值，不应用于后续连接的“重新证明”，新一轮应使用全新的测试文件和随机值。

2026-10-27 的后续工具探测还成功返回 tong_list_projects 项目登记信息，并可在获准的开发根内读 AGENTS.md/README.md；这些是后续功能可用的辅助观察，不替代上述生产验收。

**2026-10-27 ChatGPT 网页端写入/编辑补充验收（实测，授权工作区 D:\作业\111）：**

- tong_list_projects 返回 D:\作业\111 项目 p0-homework-111，具备 project.read、project.write、agent.execute 与已绑定 Codex 会话开发授权；D:\作业 的 trustedFolders 记录存在，gitCommit=true、gitPush=false。该信任不代表所有新子项目已登记，也不等于 Codex Desktop 图形界面的信任状态已被实测。
- open_workspace("D:\作业\111") → workspaceId=ws_36a9b051ba；原有项目根仅含 `你好.txt`，未修改。
- tong_run_command(pwsh) → 仅新建目录 `D:\作业\111\Tong-Web-Write-Test-20261027`，退出码 0；write → read → edit → read 全部成功。
- 最终真实文件：`D:\作业\111\Tong-Web-Write-Test-20261027\web-write-acceptance.txt`，内容：

```text
Tong Desktop Control - ChatGPT web write acceptance
scope=D:\作业\111\Tong-Web-Write-Test-20261027
marker=TONG-WEB-20261027-111-7F4C9A
state=EDITED_AND_REREAD
verifiedBy=ChatGPT_web_Tong_MCP
```

- 独立 PowerShell 7 检查：Exists=true、Edited=true、Marker=true、SHA256=`D75D541C3E2B0AAD21E51EC0723CEAA308B7832453D77737B8805A70741C8323`，退出码 0；目录重列仅有新增测试文件夹及原有 `你好.txt`。此为**真实网页端本地文件写入与编辑验收通过**，测试对象在用户已授权的作业目录，未碰运行服务、业务数据库或 OAuth。测试文件保留供本机复核。

## 3. 修复链路和不必重新核对的历史结论

1. 最初生产恢复曾因 ACL 和启动清理/证明链路失败而回退；不要把旧的 MONITOR_FAILED、CLEANUP_REQUIRED、ACL_DENIED、EPERM、START_TIMEOUT 全算作同一根因。
2. 生产 DevSpace 的 chmodSync EPERM 已被定位到 Windows MIC：继承 Low 标签的 Host 启动 Low 子进程，不能修改正常 Medium 用户状态目录。采用**单文件**最终 Host Medium 完整性标签操作；没有通过忽略 chmod 或降低用户目录保护绕过问题。有关测试、限定范围和物理回退见 [通信修复复核](evidence/024-communication-recovery-20261026/REVIEW.md)。
3. 2026-10-26 前次正式启动三轮均耗尽 120 秒；实测 request→DevSpace readiness begin 前已用约 77.7～80.0 秒，Guardian 恢复路径重复预检约 17 秒。后两轮仅给 Gateway 留下 4.728/9.839 秒，这不是 Gateway 子阶段自身异常超时的证据。
4. 最新候选取消冗余的第二次预检、保留一次完整安全检查，将正式生产总上限改为 **180 秒**，DevSpace 75 秒、Gateway 35 秒、各阶段卡死限及恢复预算保持不变，并修复 Gateway startupProgress 进度标记。隔离测试正常 READY 78.292 秒、模拟生产慢路径约 130.3 秒、同 Runner 异常恢复 130.098 秒。详见 [启动预算修复报告](evidence/024-startup-budget-recovery-20261027/REVIEW.md) 和其 TIMELINE.json / VALIDATION.json。
5. 本次生产最终 request→READY 为 **108.905 秒**，相对修复后的 180 秒预算有余量；可证明本轮成功，**不能保证每次冷启动都保持相同时间**。
6. 成功生产窗口之后无新增运行代码提交；若以后只为文档产生新的 Git 提交，**不能用文档 HEAD 取代已安装的精确发布 candidate/sourceDigest/releaseDigest**。

## 4. 已完成的补充验收与后续事项

1. **持续运行稳定性**：只读检查 Task 状态、READY、doctor、定期 doctor 退出状态、端口/ngrok 和恢复预算。区分静态收尾记录与检查当时的实时状态。出现异常才定位本次 runId 与新日志，不重新跑所有旧测试。
2. **ChatGPT 网页端写入：已通过**。2026-10-27 在此前已授权的 D:\作业\111 下实际新建文件夹并完成 write→read→edit→read，PowerShell 7 独立验证 SHA256；详见第 2 节补充记录。未在 D:\Tong\app\demo-workspace 重复写入，不影响此授权工作区的网页写入验收结论。
3. **Windows 真正重启后的恢复**：选择有明确授权和回退准备的维护时段，观察计划任务、授权、自动恢复、超时和真实网页重连。**本次未测试真实重启，不能据此承诺开机自恢复。**
4. **开发目录整理**：先只读盘点 D:\Tong 中生产目录、正式源码、实验仓库、历史归档、完整备份、测试状态、日志与大文件；去重、迁移或删除需另行明确授权。不得删除事故原件、物理备份、运行配置或仍被版本绑定引用的材料。

   2026-10-27 首轮只读元数据扫描：D:\Tong 根下主要为 `app`（正式应用）、`runtime`（正式运行/授权/状态）、`development`（开发仓库）、`state`（历史及合成事故/测试状态）、`tools`（ngrok）。`development` 一级有 `tong-024-startup-recovery`、`tong-desktop-control`、`tong-launcher-startup-recovery`、`tong-startup-hotfix`、`test-temp` 五个目录；`runtime` 一级包含 `run`、`secrets`、`login-management`、`releases`、`logs`、`state-backups`、`state-restores` 等，不作清理候选。对 `D:\Tong\state` 的 depth=0 工具摘要为 1609 个目录、13 个文件，但本次结果有分页，尚未逐一核查用途、引用关系及子目录体积；不能把其直接认作可删除缓存。**暂未移动或删除任何 Tong 文件**。关于四处 D 盘遗留工程及 Tong 全域统一整理的下一轮 Codex 只读盘点，请先参阅 [五处根目录盘点任务书](maintenance/Tong-Five-Root-Consolidation-Audit-20261027.md)，Codex 实际报告未完成前不执行迁移与清理。
5. **后续功能**：在通信稳定后，按用户优先级继续 Windows 本地操作、Codex Desktop **真实可见并可续聊的原生会话**、既有桌面端会话关联、多 Agent 调度等。用户未指定 Agent 时优先由 ChatGPT 通过 Tong 本地工具直接执行；明确指定 Codex 才调用 Codex 原生会话。开发/合成能力不能冒充已部署生产。

## 5. 后续变更边界与交接方式

- 保留本次已成功的生产版本、既有认证、版本绑定、恢复预算、任务及进程；**不要为补充文档重新部署、重启、重建 Host、重设权限、重置预算、重跑大规模隔离测试或修改 OAuth/SQLite/WAL/SHM**。
- 生产维护属于独立授权窗口。普通开发文档更新并不授权生产文件修改。真实本机授权挑战仍由用户在可见本地入口亲自输入；不得以聊天文字代替原生挑战。
- 以后新出现的故障：先记录发生时间、现象、实际 runId、doctor 与 Task 状态，读取新的诊断原件后再给最小修复；**不能依据旧事故直接认定现在又是 EPERM 或启动预算故障**。
- 每次重要生产操作结束，把精确候选、提交、运行证据位置、成功/失败、回退状态、已测与未测项目补充到本页或明确的继任文档；只提供简短索引与必要事实，不重新堆积几十篇重复报告。凭据、原始私有生产日志和真实个人文件不要提交到公开 GitHub。

**给新对话或新 Codex 会话的一句话交接：** 2026-10-27 Tong 在正式生产完成 READY / doctor / 认证 MCP，ChatGPT 网页端也已实际读取 D:\Tong\app\demo-workspace\tong-production-web-3b9a0831.txt 且 nonce 与本机一致；现已另在已授权的 D:\作业\111 完成网页端写入/编辑/重读；当前优先保持运行，补长期/重启验证，生产修改仍需新授权，源/发布绑定以本页列出的精确候选及本机 success 回执为准。
