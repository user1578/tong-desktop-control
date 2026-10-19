# Tong P3 — DeepSeek Harness Desktop 下一阶段安全接入交接

状态：**设计与只读勘察完成；无 DSH 模型调用；无系统或生产修改**。

## 目标

在不重复安装 DSH、不影响已登录 Desktop 和既有会话的前提下，让 Tong 能按用户授权调度现有 DSH Runtime；同时准确区分 **Headless/SDK CLI 会话** 与 **Desktop UI 的原生会话**。不得把单独启动的 Headless/SDK 会话虚称为桌面版可见可续聊。

## 已核实的本机情况

- 已安装 Desktop `C:\Users\Rune\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe`。
- 随软件附带 `resources\runtime\cli\bin\dsh.cmd`，`--version` 返回 `0.2.0-rc.2`。
- 只读 `--profile headless --help` 显示 `--json`（换行分隔的运行事件），`--session-id`（采用持久化 Session ID），以及从 stdin 输入任务的支持。
- 只读 `--profile sdk --help` 表明存在**stdio JSON-RPC SDK runtime**。
- 在上述帮助内容中，未找到明确的 `--permission`、`--sandbox`、`--tools`、`--allow`、`--deny` 之类权限限制参数。**缺失帮助参数不代表无内部权限接口，但目前不能认定 Headless 模式有充分限制**。
- Desktop 使用 `desktop` 专属 profile。CLI 的 `headless`/`sdk` 启动不同 profile，不能假定它们的 Session 自动出现在桌面UI。

## 安全与授权约束

1. **先查 SDK 协议，再开模型。** 可对安装包中随附的只读文档或可公开查询的 SDK 接口开展检查；不可通过启动 Headless 默认环境来“看看模型会用什么工具”。
2. **能力最小化。** 真正调度 DSH 前，需要确认能明确禁止文件、Shell、网络插件和外部 MCP 的方式，并用合成测试证明其生效。若没有可靠限制，应设计外层隔离并在成功后才允许本机真实验收。
3. **会话隔离。** 使用单独 Tong 测试 profile/state 目录；不读写 Desktop 私有数据库，不冒用已有桌面会话，绝不覆盖用户设置。
4. **进程隔离。** 实际生产 Runner 必须另建Windows受信执行链：固定二进制校验、SID与授权摘要、可限制的工作目录、Job Object、资源和超时限制，清晰的错误回报及输出脱敏。不得直接更换现有 Codex Worker 的程序路径绕过审查。
5. **用户明确审批。** 本机模型验收须另外确认一条固定的纯文本任务、所用模型和潜在计费方；无授权不运行，更不能自动循环重试。
6. **真实可续聊验证。** 只有真实 Session 创建和恢复均有证据，才能声明 CLI 会话可恢复；只有官方支持或实际用户界面验证，才能声明 Desktop UI 可见可续聊。

## 实施阶段和完成标准

**DSH-S0：只读协议清点。** 确认 SDK JSON-RPC 方法、Headless CLI 参数、权限/插件配置机制、持久化 Session 机制及 Desktop 与 CLI 的跨 profile 边界。输出一份以实际接口为依据的能力矩阵与缺失项；不调用模型。

**DSH-S1：限制型合成 Runner。** 在隔离测试环境中实现能力白名单、独立 Profile、可信执行链与审批摘要，以 mock CLI/SDK 测试创建/恢复/超时/取消及越权拒绝；Windows 和 Ubuntu CI 跑纯合成测试。

**DSH-S2：一次交互式真实验收。** 确认限制生效、费用与供应方明确后，由用户独立在 PowerShell 输入 `Y`，只运行指定纯文本任务。保存脱敏回执，核对 native Session ID，再经第二次明确授权测试恢复和上下文。

**DSH-S3：多 Agent 接入。** 将证明合格的 DSH Runner 接入已实现的 Tong 多 Agent Orchestrator，仍逐阶段校验项目、Scope、原生会话、授权时效和任务记录；不把本机验收授权迁移到生产。

现阶段**不推进模型调用**。下一动作应优先处理 DSH-S0 的 SDK/Headless 能力与权限约束清点。
