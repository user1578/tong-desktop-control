# Tong 专用生产升级预备审查：bb234ec → cc9c04d

日期：2026-10-18。**本阶段不包含实际生产部署**。用户授权先制作与演练，真正的停机/替换/启用Codex子进程代理留到最终明确确认后。

## 基线与候选

- 当前生产App、Manager pin：`bb234ec794c1d8180586781c92601f2eae95e750`；各177项源码、23项native。最后一次生产只读状态：`ready`，Supervisor/Guardian存活，runId `2e6410ad-8914-4c96-86d4-20d8ae90748b`（未来部署前必须重新读取，不能用旧runId停机）。
- 候选：`cc9c04dc6b0731f0d199c09372acfab83e0a2c11`，189项源码、23项native。候选release已通过App/Manager独立离线恢复、补丁/native SQLite/跨组件验收。
- release-manifest SHA256：`cd1022211debdad38f8c99df51700a20bca1a33f10db54c38c5c7eeb7037bfb2`。
- `source.tar` SHA256：`e6870120b80d61e807efcd57b7b567dbafadfa6babb198f4edaa3ba5b50e6654`。
- 候选根：`D:\Tong\state\native-codex-acceptance-20261018\persistent-proxy-candidate`。

## 本阶段专用脚本

在上述候选根下创建，均来自上次已验证过的升级代码，仅更新基线、候选、保护路径和被钉住的Helper SHA：

1. `TongCutover-bb234ec-to-cc9c04d.mjs`，SHA256 `0741bb72ec475ffe5889b715e91fb2e850f530581fe66612815d3c23cc0c4e7e`。实现旧版与候选精确文件验证、快照、停止态校验、切换、安装检查、回滚。
2. `Invoke-TongCutover-bb234ec-to-cc9c04d.ps1`，SHA256 `d25ca0941ea1469c442b53c157ab1ec36a4e4d872453d7491f7df3dc897a227d`。提供 `-Mode Preflight` 只读检查，和 `-Mode Deploy` 人工确认的生产切换入口。

新脚本内未发现旧路径 `p27-autonomy-candidate-20261017`，亦没有旧版原提交 `3442cbb` / `1eac750` 和旧helper哈希残留。

## 已完成真实检查（不会写入生产）

- `node --check` 检查helper通过；PowerShell 7 Parser分析wrapper无语法错误。
- 专用helper `preflight` 实测PASS：旧App/Manager为bb234ec，候选cc9c04d，189个源文件，23个原生文件，新文件与生产目录无名称冲突。
- 专用PowerShell包装器 `-Mode Preflight` 实测输出：
  `PRECHECK PASS: production 2e6410ad-8914-4c96-86d4-20d8ae90748b healthy; candidate cc9c04dc6b0731f0d199c09372acfab83e0a2c11 verified; no production change.`
- 官方预检包括Manager doctor健康、任务入口检查、受审查helper SHA及候选路径检查。
- 独立脚本 `tests/Test-TongCandidateFileRollback.mjs` 执行两个文件级演练：完整安装189项源码并回滚，以及仅复制63项源码后模拟中断并回滚。旧版源码、profile/pin及登录脚本逐一恢复并匹配原字节与SHA。完整演练从两个组件各移出12项新增文件；中断演练各移出4项。所有文件写入仅在候选根新建的临时演练目录，生产目录只读。
- 注意：这是**文件级回滚演练**，不是在生产服务中执行停机和复活；也不等同于模拟运行真实Gateway、OAuth、MCP或DPAPI身份恢复。

## 真正升级仍需独立批准

未来如要投入生产，还必须：

1. 从当前生产实时重读pin、profile、任务及运行状态，重新执行helper和PowerShell wrapper双预检，拒绝不一致、正在执行的Codex任务或新文件冲突。
2. 审查上面两个带SHA的脚本；指定停机窗口，先取得本机用户对开始、停止、Manager和AgentDock对应真实hash-bound审批，再完成完整快照，核对备份内版本和权限。
3. 升级由用户在非重定向PowerShell 7 ConsoleHost实际运行。`-Mode Deploy`将在审批、快照后停机切换；无法由聊天暗中启动。必须依靠原版的定向停止与Guardian的Job=0证据；不得杀掉不属于本次Tong的进程。
4. 如果候选启动/健康/登录恢复失败，先确认新版本停止，使用精确快照恢复全部旧版App/Manager源文件、pin/profile及登录runner并验证。必要时重新通过原程序的本机登录恢复审批。
5. 候选健康后，单独通过本机交互配置Codex-only本地代理`http://127.0.0.1:7897`，检查持久化字段，并测试Codex原生会话创建/继续及公网MCP；不改Windows全局代理。如果端口不可用，执行本机 `proxy off` 恢复默认。

当前明确：**尚未执行`-Mode Deploy`，尚未签署发布/停止审批、没有修改生产代理配置，不得宣称生产升级完成。**
