# Tong P3 — DSH-S1-A 受限配置与模拟调度收尾（2026-10-19）

## 结论

**S1-A 已完成：固定SDK Profile基线、生成受限Overlay、独立临时Home真实合成校验、模拟Session/审批/取消测试。S1-B Windows Job级可信执行器未完成，不允许启动DSH Agent或进行真实模型调用。**

本阶段仅开发代码和运行 `--dump-default-config` / `--dump-config`；没有启动 `dsh --profile sdk` 服务，没有执行Headless文本任务，没有调用模型，也未访问或修改Desktop专属Profile。

## 本机环境与静态权限验收

已安装DeepSeek Harness Desktop的Bundled CLI版本为 `0.2.0-rc.2`。本地 SDK 默认Profile含**98个插件条目**，按真实 `dsh --profile sdk --dump-default-config` 读取并固定：

- 默认SDK基线SHA-256：`5441f27ee462033224dda7aa8f2ff304c0b879aae6928ea1f8aab12e2e57fb8c`。本机运行两次得到一致结果。除了条目ID，插件名、默认Patch语义及组合配置发生变化也能通过哈希不匹配而拒绝。
- S1生成受限Overlay SHA-256：`34a8b5cc3805e158196c85b261dbec24453ce9d4e67ce8b6eab7d9824d454943`。
- 独立临时 `DSH_HOME` + 空工作目录 + 指定 `--patch` 完成真实合成：98个条目存在，**46个入口明确 `disabled: true`**，`sandbox-policy.mode=read-only`，`approval.policy=ask`；本机两次检查均通过。
- 禁用入口包括 `tool-pwsh`、`tool-bash`、`tool-jobs`、`tool-fs`、`tool-web`、`tool-workflow`、`tool-subagent`、`mcp-resources`，以及 `subprocess`、`skill`、`web`、`plugin-manager`等其他观察到的高风险插件。对98个条目采取审计过的允许/拒绝规则，未知条目或危险入口复活直接拒绝。
- **单独说明**：46是配置条目数量，不是46个已经在运行时隔离验证的工具；`read-only`与 `approval: ask` 同样只是最终配置证据。禁用核心插件可能导致SDK真实启动失败，启动成功也不能代替沙箱安全证明。
- 每次检查的临时目录用 `finally` 删除。Patch/DSH_HOME仅保存在独立临时路径；没有修改Desktop Profile或现有Session。仅输出配置摘要和SHA，无用户令牌值、代理地址及模型请求。

本地验证命令（只读CLI配置合成，临时目录产生后删除）：

```powershell
& 'D:\node\node.exe' .\scripts\Inspect-TongDshS1Config.mjs
```

不向脚本开放任意DSH命令和模型Prompt参数；Windows `pwsh`只执行固定的CLI `--dump-*` 参数。失败会清理临时目录并退出非零。

## 模拟调度合同

`scripts/TongDshS1SyntheticRunner.mjs`是**纯合成**执行器：

- 只接受注入的模拟事件后端，**不调用DSH、不提供模型执行入口、不产生Windows Job安全声明**；
- 检查任务/项目路径、Scope摘要、模拟授权是否有效及过期；模拟后端返回后再次检查；
- 凭完全相同的 `sessionId`及项目归属来模拟新建/恢复；禁止跨项目串用Session；
- 不允许同项目并发模拟任务；
- `session/prompt`“入队回执”不能算成功，必须校验同Session的有序`session-open`、`message-enqueued`、`session-completed`；
- 覆盖取消、超时和模型回执不匹配的失败结果。**模拟取消不证明能终止真实进程树**，仍需Windows受信Job Object实现。

`tests/Test-TongDshS1Policy.mjs` 与 `tests/Test-TongDshS1SyntheticRunner.mjs`使用虚构配置/回执，不执行任何模型或系统Shell操作。变更后应在Windows及Ubuntu CI复验。

## 尚未完成（S1-B）

1. **Windows可信Runner**：固定CLI完整路径及SHA、受控SID/权限、固定可执行子进程、Job Object管理进程树、资源上限、超时及取消后可靠回收；必须新建独立DSH通道，不能复用Codex独占Broker授权。
2. **启动权限验证**：在可信隔离后合成测试SDK初始化及“禁止调用文件/PowerShell/Web/MCP/子Agent”，不能只依靠静态Patch。若禁用核心组件导致SDK无法初始化，应明确失败并按最小能力重新设计。
3. **SDK协议合同**：固定本地`rc.2`接口与JSON-RPC语义，分别验证 `initialize`、`session/prompt`、`session/wait`、`session/resume`，不会把入队回执误判为完成。
4. **会话状态**：独立 `DSH_HOME`，项目作用域与持久状态的安全保存/恢复，不复用Desktop真实数据库或私有Profile。
5. **外部审批**：用户明确授予模型/费用/项目Scope后，才能考虑S2真实文本验收；CLI自己的 `ask` 不能替代Tong的任务授权。
6. **Desktop可见性**：CLI/SDK Session是否出现在Desktop仍未证明，不作虚假保证。

## 交付与验证

- `scripts/TongDshS1Policy.mjs`：98项默认SDK固定ID与配置哈希校验、受限Patch生成、最终配置fail-closed检查。
- `scripts/Inspect-TongDshS1Config.mjs`：本机独立临时DSH_HOME真实配置合成检查（不启动SDK）。
- `scripts/TongDshS1SyntheticRunner.mjs`：模拟Session/权限/任务状态机。
- `tests/Test-TongDshS1Policy.mjs`、`tests/Test-TongDshS1SyntheticRunner.mjs`：合成回归。
- CI：`.github/workflows/p3-dsh-desktop-runtime.yml`为Windows/Ubuntu执行这些纯合成测试。

**S1-A通过不等于S1-B通过，不允许以本提交启动、代理或授权真实DSH模型任务。生产Tong未修改。**
