# Tong P3 — Claude Code 原生会话实测验收收尾（2026-10-19）

状态：**开发环境真实验收通过；生产集成未授权、未部署**。

## 1. 证据与结论

用户在自己的交互式 PowerShell 7 中两次明确输入大写 `Y`。两次均通过已安装的 Claude Code 2.1.236 CLI 发起真实文本调用，并使用用户原有的自定义 API 地址、模型选择器及其本机 `ANTHROPIC_AUTH_TOKEN`，没有给 Tong 生产环境导入这些配置。

| 项目 | 新建 | 恢复 |
| --- | --- | --- |
| 实际结果 | `status: passed` | `status: passed` |
| 固定文本验证 | `markerConfirmed: true` | `markerConfirmed: true` |
| Session ID | `d9d4c771-572a-457b-ba07-4410f8798e44` | 同一 ID |
| 调用耗时 | 2558 ms | 4197 ms |
| 报告时间（UTC） | 2026-10-19 13:31:45.594 | 2026-10-19 13:53:03.569 |
| 报告位置 | `C:\Users\Rune\AppData\Local\Temp\tong-p3-local-acceptance-AnPLiz\acceptance-result.json` | `C:\Users\Rune\AppData\Local\Temp\tong-p3-local-acceptance-x6KsOd\acceptance-result.json` |

两份结果报告已经通过只读工具独立验证：`provider=claude`、`passed`、准确 Session ID、`markerConfirmed`、CLI 哈希一致。SHA-256：`647e736f20c9ff0553c754624cbf8a6dcac196e8595509d8f63dce8bbe818757`。

用户本机的 `~/.claude/projects/` 下只读检查找到**一个**同 ID 的 JSONL 会话文件，大小 8631 字节，最后修改时间 `2026-10-19T13:53:03.0200065Z`，与恢复完成时间吻合；**未读取会话内容**，没有修改或合并 Claude 私有会话库。

## 2. 为什么这次可以认定恢复成功

- 首次请求使用 `--session-id` 创建原生对话，CLI 正确返回固定标记 `TONG_P3_CLAUDE_TEXT_OK`。
- 恢复请求使用 `--resume` 和**完全相同**的 ID。
- 脚本核实第一份成功报告、CLI 版本与文件哈希、报告目录和原工作目录，随后用第一次的 `empty-workdir` 作为 `cwd`；没有切换到新项目作用域。
- 第二轮提示词**没有包含固定标记**，只要求“完整复述本会话上一条助手消息”；返回固定标记且仍为相同 Session ID。这是历史上下文延续的有力实测证据，不是仅凭相同 ID 推断。

## 3. 精确边界

已经证明：在用户当前 Windows 交互式会话和当前自定义 API/模型配置下，Claude CLI 可新建、恢复原生会话，并在第二轮访问前轮上下文。

**没有证明**：

- Tong 的生产 Manager/Gateway 已支持运行 Claude。生产仍为 `phase=ready`，`sourceCommit=a1b56b3666651c3648327f05e0ea4154284645c3`，未改变。
- 此本机验收脚本有 OS 级隔离或 Windows Job Object；当前仍为 `NOT_OS_SANDBOXED`。
- `oauth_token / firstParty` 认证字段证明自定义 `ANTHROPIC_BASE_URL` 实际指向 Anthropic，或证明计费方式。自定义服务可能按自身规则计费。
- Claude Desktop 可见/可恢复此 CLI 对话（本机只安装 Claude Code CLI），也不代表 DSH Desktop 的会话兼容。

## 4. 下一阶段的必要门槛

1. 另建生产级 Claude 可信 Windows Runner：固定可执行文件、账户/SID/授权与 Session ID 的项目归属、Job Object 进程树控制、受控工作目录、有限的允许环境变量和输出脱敏；不得直接把现有 Codex 专属 Broker 换成 Claude。
2. 延用 Tong 的项目和任务授权摘要，在**每一次**模型调用前重新验权，避免隐式重复计费；用户授权的本机测试不能自动升级为生产许可。
3. DSH Desktop 独立验收，优先检查随桌面版附带的 CLI 和 SDK 提供的权限限制、会话 API 与外部可续聊能力，不能假设 Headless 运行等同桌面原生可见对话。详见 `docs/P3-DSH-Next-Safe-Execution-Handoff.md`。

完成标准：**Claude 本机新建/恢复阶段关单**；生产级 Claude 与 DSH 均仍未完成，须分别安全验收。
