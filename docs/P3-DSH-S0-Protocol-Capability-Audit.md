# Tong P3 — DSH-S0 协议与权限能力清点（2026-10-19）

状态：**S0 已完成只读调查与一次临时配置合成校验；不启动任何 Agent / LLM；S1 仍未实施。**

## 范围与证据边界

现场安装：DeepSeek Harness Desktop 随附 CLI 版本 `0.2.0-rc.2`，路径为
`%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`。
直接使用安装包的 `--help`、`--profile <name> --dump-default-config`、`--profile headless --dump-config-schema`，未修改默认用户 Profile。

此外参考官方源码库（以下为文档协议，可能比现场已安装版本更新；具体现场行为以本机输出为准）：
- [CLI 帮助](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cli-help.md)
- [CLI 参考及 Profile 层次](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md)
- [SDK 线协议](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/protocol/README.md)
- [基础Bundle/Windows Sandbox](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/base/README.md)
- [Desktop 拥有的 Profile](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md)

## 1. 现场CLI接口

| Profile | default配置条目 | 执行接口 | 默认权限策略 | 工具情况 |
| --- | ---: | --- | --- | --- |
| `headless` | 96 | 任务文本、标准输入、`--json`、`--session-id` | `DSH_PERMISSION_MODE ?? workspace-write` | 默认包含 `tool-pwsh`、`tool-fs`、`tool-web` 等；没有自带命令行工具禁用选项 |
| `sdk` | 98 | stdio JSON-RPC | `DSH_PERMISSION_MODE ?? workspace-write` | 继承基本Bundle的Shell、文件和Web工具 |
| `sdk-minimal` | 32 | stdio JSON-RPC | **`danger-full-access`** | 不挂载标准文件/Web工具，但有 `persistent-pwsh`、`persistent-bash`，**不能视为安全的纯文本执行环境** |
| `desktop` | 不对CLI开放 | Electron自身运行 | 不推断 | Desktop独占；不能使用CLI假冒桌面端原生会话 |

标准Headless的默认Patch中，`sandbox-policy`配置：
`mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'`；
`workspaceRoot: !!js process.cwd()`。
`permission`预设包含 `read-only` / `workspace-write` / `danger-full-access`；默认普通模式Approval为`ask`，危险全权限模式为`never`。这里的`ask`**不是**Tong的用户审批机制，不应据此授予系统操作。
Windows默认启用`tool-pwsh`和Windows Sandbox家族，POSIX Bash执行插件被平台门控禁用。
此外默认配置还有 `tool-jobs`、`tool-fs-search`、`tool-skill`、`tool-subagent`、`tool-workflow`、`mcp-resources`等条目。
**只禁用PowerShell、文件和Web三项，不等于禁用了所有危险能力**。

## 2. Profile/插件Patch与JSON Schema

本机顶层 `dsh --help`确认了以下只读能力：
- `--dump-default-config`：只显示产品Bundle默认合成结果；不包含用户层。
- `--dump-config-schema`：返回适用于所选Profile的JSON Schema，不挂载Plugin；Headless返回的Schema约613KB，包括 `$defs.patchList`及条目级 `disabled`/ `config` 约束。
- `--dump-config`：输出包含所选Profile、Home和命令行Patch层的合成结果；在独立的空 `DSH_HOME` 下执行，会在该独立Home初始化Profile文件，**不是严格零写入**。
- `--patch <path>`：附加最高优先级的覆盖层；覆盖同一条目的完整 `config`，不是字段级深度合并。

进行过一次受控无模型实测：在随机且独立的临时 `DSH_HOME` 写入临时Patch，仅包含：
```yaml
- id: sandbox-policy
  config:
    mode: read-only
    workspaceRoot: !!js process.cwd()
- id: tool-pwsh
  disabled: true
- id: tool-fs
  disabled: true
- id: tool-web
  disabled: true
```
随后仅执行 `dsh --profile headless --patch <temp-patch> --dump-config`。
退出码为**0**，合成结果中 `sandbox-policy.mode=read-only`，三个工具条目的 `disabled=true`，每个目标条目均恰好一次，无未命中Patch警告；执行后删除全部独立临时文件（`SCRATCH_CLEANED=True`）。

这说明**静态合成机制有效**；并没有挂载工具、创建Session或触发真实Model，也未证明某项工具在运行时不可越权。

## 3. SDK线协议（官方来源，S1需按安装版本核对）

stdio每行一条JSON-RPC 2.0消息。官方当前协议定义7项客户端请求：
`initialize`、`session/prompt`、`session/resume`、`session/wait`、
`session/working-directory/get`、`session/working-directory/set`、
`shutdown`；4类通知：
`session.event`、`session.status`、`subagent.started`、`subagent.finished`。

关键语义：
- `session/prompt`返回的是**入队消息回执**（`messageId`），不能当成Agent已完成。
- `session/wait`返回表明根Session和其可推进的受管子任务进入空闲状态，Agent错误须单独传播。
- `session/resume`要求准确的持久化Session ID和**原始存储**；不存在或占用的Session应失败，不可偷偷创建替代Session。
- 通知可能覆盖运行时的**所有Session**，消费端必须自行按Session ID过滤。
- 目前协议没有独立的`cancel`或`session/close`方法；取消需要受信进程管理器负责结束Runtime，并处理未落盘/孤儿子进程。
- 协议版本协商尚不完备；不能假设新官方文档API与本地`rc.2`绝对一致。

## 4. 风险结论与S1准入条件

1. **不能直接调用默认Headless。** 默认`workspace-write`且注册有多个模型可见工具，用户提出“只要文字”不等于这些工具没有执行能力。
2. **不能使用默认sdk-minimal代替隔离。** 本机默认就是 `danger-full-access`且具有持久Shell。
3. 仅仅把`DSH_PERMISSION_MODE=read-only`设置好仍不能证明权限不绕过；必须验证复合Patch中**所有模型可见工具、SDK子Agent/工作流、MCP等入口**的拒绝策略，外层还需OS级限制。
4. 可以用独立 `DSH_HOME` + 独立Project工作目录 + 固定CLI/配置Hash + `--patch`白名单逐级实现受控环境。任何Profile、插件表或安装版本变化，都应重新审计、拒绝未经确认的能力。
5. S1优先采用`sdk`的stdio协议并在合成配置中最小化工具，同时设计可信Windows Runtime管理器（Job Object、SID、审批摘要、进程取消、输出脱敏）；尚未证明整个工具集合已封闭时，不发模型请求。
6. **Desktop会话归属仍不成立**：`headless`/`sdk` Profile会话不自动属于`desktop`，不要读写Desktop私有数据库或伪造Desktop原生可见会话。
7. `DSH_HOME`中可能有用户密钥、Session、Profile；所有S1实验必须单独指定临时Home，不读取真实Desktop凭证。

## 5. 交付与尚未完成

- `scripts/TongDshS0Audit.mjs`：纯函数，清点配置条目和敏感插件，并对**静态合成结果**做显式拒绝校验，绝不声称运行时沙箱已通过。
- `tests/Test-TongDshS0Audit.mjs`：合成测试，覆盖默认权限拒绝、只读补丁、插件遗漏、重复条目、`sdk-minimal`危险配置和输入上限。
- 版本固定为本机`0.2.0-rc.2`的证据清单（本报告）；没有模型调用，没有会话写入。
- S1下一步：基于实际安装版本建立**安全Profile完整禁用/拒绝清单**，再在受控外层执行器下做运行时越权拒绝合成测试，之后另行申请一次真实模型验收。

**本阶段完成标准：只读接口调查与静态策略合成通过；真实DSH工具限制、生产Runner、真实会话及Desktop UI互通均未验收。**
