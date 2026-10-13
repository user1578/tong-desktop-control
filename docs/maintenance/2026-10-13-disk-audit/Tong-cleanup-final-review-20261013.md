# Tong 磁盘清理候选最终审查（只读）
日期：2026-10-13（日本时间）
来源：Tong-disk-audit-summary.csv、Tong-disk-audit-buckets.csv、Tong-cleanup-dependency-review.csv/.txt；ChatGPT 通过 Tong MCP 实际读取。
状态：只读核验，未删除文件，未修改生产配置、Git 或系统环境。

## 结论
**现在不建议一键删除旧 Tong/AgentDock 目录。** 原因：
1. 活跃目录 D:\Tong\runtime\run\release-pin.json 仍文本引用 D:\agentdock-poc-20261010 与 C:\Users\Rune\.codex\worktrees；不确定是当前执行依赖还是历史/回滚引用。零运行进程匹配不足以证明全部无依赖。
2. 旧 PoC 与 D:\Tong\state 中 b23-switch-c104fcca2aa9 目录各约 3.542 GiB（逻辑大小），抽样 7 个文件内容哈希相同；此证据不等于整个目录完全相同、亦不能证明没有硬链接。
3. 旧 D:\tong-agentdock-local 没有发现运行进程、服务和选定活跃配置的直接引用，但包含 releases/state-backups/state-restores/secrets 等，应核实迁移、回滚和 DPAPI 恢复后再删。
4. 三个 Tong Git 工作区有未提交/未跟踪内容，不能直接删除。

## 清理候选和处理优先级
| 级别 | 目录 | 逻辑大小（GiB） | 清理判断 |
| --- | --- | ---: | --- |
| 高 | C:\Users\Rune\AppData\Local\npm-cache\_cacache | 2.736 | 缓存，优先；清理前检查 npm 正在安装/拉取，保留必要下载能力 |
| 中 | D:\agentdock-poc-20261010\isolated\state\b23-switch-c104fcca2aa9 | 3.542 | 旧合成切换演练候选；先核对 pin 语义、备份/回滚证据、硬链接/真实占用 |
| 中 | D:\tong-agentdock-local | 2.502 | 旧部署候选；确认引用、回滚/恢复材料已经保留且可用 |
| 低 | D:\Tong\state\b23-switch-c104fcca2aa9 | 3.542 | 现有生产树里的历史测试副本，暂缓；两份不能重复计算预计释放容量 |
| 暂缓 | C:\Users\Rune\AppData\Local\npm-cache\_npx | 1.769 | 某些 MCP/npx 启动可能依赖，先核对启动来源 |
| 暂缓 | C:\Users\Rune\.cache\codex-runtimes | 1.709 | Codex 运行时目录，不能按普通缓存删除 |
| 暂缓 | C:\Users\Rune\.codex\worktrees | 1.684 | Git worktrees，必须先核对 worktree 注册、未提交修改 |
| 暂缓 | D:\tong-desktop-control | 0.568 | Git 项目有未提交/未跟踪内容，不可直接删 |
| 保留 | C:\Users\Rune\.codex\sessions | 0.761 | 原生会话历史；未来 Tong 会话管理需要 |
| 保留 | D:\Tong\runtime\state-backups | 0.777 | 生产恢复备份 |
| 保留 | D:\Tong\runtime\state-restores | 0.602 | 恢复/验证材料 |

**所有大小是逻辑字节数换算的 GiB，并非实际可释放磁盘量；父子目录嵌套、跨目录硬链接、簇分配都会造成差异。不应合计所有行作为空间回收承诺。**

## 运行配置与目录对照
实际本机只读报告发现：
- `old-poc`：`runtime\run\release-pin.json` 有文本引用
- `codex-worktrees`：同一 pin 文件有文本引用
- `old-poc-b23-switch`：本次查无直接命中
- `tong-state-b23-switch`：本次查无直接命中
- `old-tong-local`：本次查无直接命中
- 其他标为 0 的目录仅指特定进程/服务/配置范围内未检出，不等于已经证明完全不在用。

两份 b23-switch 抽样一致的相对文件：`profile.json`、`production-root.json`、`run\runtime.json`、`run\release-pin.json`、`tong\package-lock.json`、`tong\README.md`、`tong\package.json`。另 2 个样本路径缺失，没有做整个目录的完整比较。

## Git 审查
- `D:\tong-desktop-control`：63 条修改/未跟踪条目，保留
- `D:\Tong\development\tong-desktop-control`：20 条，保留
- `C:\Users\Rune\.codex\worktrees\p24-agentdock-client\tong-desktop-control`：8 条，保留
- `p2-agent-orchestration`、`p23-trusted-agent`：各 0 条，仍需确认 worktree 关联与回溯用途，不能裸删
- `git worktree list` 已列出 `D:/Tong/development/tong-desktop-control`，其他工作树需复核各自 Git 关联状态。

## 下一次可实施的最小清理流程（执行前需明确批准）
1. 优先考虑 npm `_cacache`：核对有效 npm cache 路径与是否有依赖下载安装，再决定是否清除。预计候选逻辑容量上限约 2.736 GiB，不承诺实际回收量。
2. 只读检查生产 pin 中旧 PoC/worktrees 的引用语义；核对当前进程实际路径、备份完整性、回滚需求和目录 hardlink/reparse 状态，形成精确旧测试副本删除候选。
3. 对旧部署 `D:\tong-agentdock-local` 单独核对恢复材料后再决定是否可删除。
4. 经过用户确认的删除清单，只清理逐项确定的目标，之后核对 Tong 健康与 C/D 盘剩余空间；不修改系统环境、不全盘自动清理。

## 本轮未授权且未执行
未删除、移动或重命名任何目录；未清理缓存；未改生产 pin、ACL、DPAPI、Git、服务或 ngrok。
