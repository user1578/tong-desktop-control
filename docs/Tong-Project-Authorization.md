# Tong 持续项目开发授权

本次开发版本未切换正式 app/manager。正式版本仍为 `3442cbb`；新能力须经过
单独的正式版本部署批准后才生效。现有项目登记能力已可接入开发仓库，无需部署。

## 权限与确认

项目登记的 `read/write`、独立 `agent.execute` 和可信 Codex 开关继续有效。
新增本机 `authorize-development` 会一次展示项目、权限、影响、恢复方式及持续时间，
由本人在交互式终端按 Y 确认。重定向输入、管道 `Y`、`APPROVE` 或聊天文字均不接受。
普通开发授权绑定项目 ID、真实根目录及 grantId，持续到撤销或调整，不因任务时长过期。
旧的逐任务授权不会自动升级为持续权限。

```powershell
node scripts/TongTrustedControl.mjs --state-dir <现有受保护状态目录> authorize-development <项目ID> --git-commit --git-push
node scripts/TongTrustedControl.mjs --state-dir <同一状态目录> preflight <项目ID>
node scripts/TongTrustedControl.mjs --state-dir <同一状态目录> revoke <项目ID>
```

Git 提交和推送可分别授权，未列出的能力在任务排队前拒绝。客户端应在长任务开始前
通过 `tong_list_projects` 检查授权，并在 `tong_agent_start.requiredCapabilities` 中
声明完整需求。文件读取、新建、修改、常规单文件清理、项目命令和依赖安装沿用
现有工作区工具；Codex 创建/继续原生会话复用持续授权，不再等待逐任务挑战。
项目依赖下载使用已批准的联网能力，Codex 文件写入仍为 workspace-write。

`workType=high-impact` 始终等待本地单次任务确认，范围绑定任务、项目根、会话、
继续消息、所需能力及超时；确认期间改变范围会使批准失效。一次确认覆盖列明的完整
执行流程，不包含下一次继续或未列出的操作。系统/服务/权限修改、生产部署、重要数据
删除及其他项目操作必须标为高影响，不能从普通开发授权推导。一次任务确认本身不扩展
操作系统权限；Codex 请求额外沙箱权限时会中断并显示需要用户决定，原生权限请求
不会被自动接受。生产管理现有的固定哈希/本机批准边界继续保留。

## MCP 客户端确认能力

已检查 SDK 1.32.1 的 `getClientCapabilities` 和 `elicitInput`。MCP elicitation
提供客户端交互和 accept/decline/cancel，但不提供不可伪造的本人签名或用户在场证明。
当前没有建立客户端人工确认的可信证明，因此不拿 elicitation 响应或普通聊天升级权限。
新 `tong_list_projects.confirmation` 会报告当前连接是否声明 elicitation，并明确
`verifiedUserPresence=false`、`chatTextCanAuthorize=false`。本机交互式控制台是当前
确认入口，没有公开的 MCP grant/approve 工具或 `approved=true` 旁路。

协议依据：[MCP elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)、
[Codex App Server 的 workspaceWrite 配置](https://learn.chatgpt.com/docs/app-server)。

这里仍沿用原系统的可信 Windows 用户模型。控制台确认可阻止通过正常 MCP 参数或
标准输入伪造批准，但不是对抗同一 Windows 用户任意代码执行的密码学或操作系统隔离。
现有 `tong_run_command` 属于可信本机执行；不能保证恶意项目脚本或插件不会访问用户
本来就有权访问的资源，也不能仅凭任务文字可靠识别任意脚本的部署/删数据副作用。
因此高影响标记和 Agent 的停止义务仍是执行契约，不能宣称为对任意代码的强制分类器。
本次不扩权、不关闭沙箱，也不将这种既有信任模型描述成更强的安全边界。

## AgentDock 与撤销

同一次确认可使用下列可选配置，将 AgentDock 固定操作一起接入：
`--agentdock-policy <现有策略文件>`，可选 `--git-exe <绝对exe>`、
`--git-diff-path <项目内文件>`（可重复）、`--python-exe <绝对exe>`、
`--pytest-entry <项目内测试文件>`。二进制仍绑定 SHA256，未配置的命令不开放。
持续项目操作可以省略 approvalId，但仍需要 taskId、写操作幂等 key、原调用方身份；
路径、链接、预览、实际写入核对和操作审计继续执行。

AgentDock grant 绑定同一 trustedPolicyPath 和 grantId。`revoke`、`disable`、
`stop` 及项目/执行权限撤销会阻止新操作；原调用方仍可取消自己已经拥有的后台会话，
取消仅返回状态。Codex 活跃任务轮询撤销并中断；AgentDock 已发出的后台命令保留
取消通道及原执行超时，不宣称能回滚已发生的副作用。恢复备份会清除持续权限、
逐任务批准和执行项目，不能从旧快照自动复活授权。

## 本次开发项目接入

正式项目表此前没有登记 `D:\Tong\development\tong-desktop-control`。
本次通过正式版本的现有 `TongProjects add / grant-agent` 和
`TongTrustedControl grant` 接入 `tong-development`，没有直接改写权限 JSON。
已通过真实 Tong MCP 打开工作区、读取 package.json、新建/读取/删除独立验证文件，
以及执行 `git rev-parse --show-toplevel`（退出码 0）。生产原生 Codex 仍沿用旧版
逐任务批准，直到新授权版本获准部署。

## 验证范围

新增测试覆盖持续任务与继续、Git 开工前检查、单次确认范围变化、实时撤销、
AgentDock 关联撤销与撤销后取消、管道无法批准，以及备份恢复权限关闭。
既有项目路径/MCP 文件边界、可信任务、原生适配器、工作区执行、AgentDock 执行/
重放/会话所有权及原状态目录保留测试另行运行。
没有操作真实生产部署，也没有用模型任务消耗来代替确定性的协议回归。
`Test-TongRuntimeBackup.mjs` 的旧固定夹具路径先于恢复逻辑被现有 PATH_DENIED
拒绝；完整备份恢复测试未通过，本次没有扩大允许路径或重建大型环境。
