Tong 磁盘空间只读审查（2026-10-13）
数据来源：本机扫描输出 Tong-disk-audit-summary.csv 与 Tong-disk-audit-buckets.csv，经 ChatGPT 通过 Tong 实际读取。
状态：主体扫描已完成；末尾导出 issues.csv 时 PowerShell 5.1 类型兼容性错误。summary.csv / buckets.csv 已生成且可读。
警告：以下为文件逻辑字节数（GiB），不是磁盘实际占用或删除可回收容量。硬链接、压缩、文件系统簇大小等可能导致差异。重解析点未跟随。部分目录有扫描错误。禁止按此表直接批量删除。

顶层扫描结果：
D:\Tong                             8.773 GiB | 547002 文件 | 0 错误 | 正在使用，保留
D:\agentdock-poc-20261010          5.338 GiB | 320052 文件 | 2 错误 | 旧 PoC，优先核对
C:\Users\Rune\AppData\Local\npm-cache 4.506 GiB | 131552 文件 | 0 错误 | npm 缓存，候选
D:\tong-agentdock-local            2.502 GiB | 153173 文件 | 0 错误 | 旧生产路径，需确认迁移完成
C:\Users\Rune\.cache                2.398 GiB | 23063 文件 | 0 错误 | 含 Codex runtime/Puppeteer，先查依赖
C:\Users\Rune\.codex\worktrees     1.684 GiB | 114992 文件 | 0 错误 | 保留有工作树/未提交改动的目录
C:\Users\Rune\AppData\Local\Temp 0.880 GiB | 2268 文件 | 46 错误 | 部分无法访问、可能被占用
C:\Users\Rune\.codex\sessions      0.761 GiB | 432 文件 | 0 错误 | 会话恢复记录，保留
C:\Users\Rune\AppData\Local\pip\Cache 0.751 GiB | 882 文件 | 0 错误 | pip 缓存，候选
D:\tong-desktop-control             0.568 GiB | 39012 文件 | 0 错误 | 旧 checkout，核对分支/提交
C:\Users\Rune\AppData\Local\uv\cache 0.060 GiB | 2434 文件 | 0 错误 | 低优先级

已观察到的较大子目录：
D:\Tong\state                           5.062 GiB
D:\Tong\state\b23-switch-c104fcca2aa9   3.542 GiB
D:\agentdock-poc-20261010\isolated\state\b23-switch-c104fcca2aa9 3.542 GiB
D:\agentdock-poc-20261010\isolated\state 5.018 GiB
D:\Tong\runtime                         2.581 GiB
D:\Tong\runtime\state-backups           0.777 GiB — 保留生产备份
D:\Tong\runtime\state-restores          0.602 GiB — 保留恢复证据
C:\Users\Rune\AppData\Local\npm-cache\_cacache 2.736 GiB
C:\Users\Rune\AppData\Local\npm-cache\_npx 1.769 GiB
C:\Users\Rune\.cache\codex-runtimes    1.709 GiB — 核对正在使用的运行时
C:\Users\Rune\.cache\puppeteer         0.689 GiB
D:\Tong\app\node_modules              0.560 GiB — 生产依赖，不删
D:\Tong\development\tong-desktop-control\node_modules 0.560 GiB — 开发依赖，不直接删

审查顺序：
1. 只读确认当前生产配置、服务 PID、实际路径及备份恢复计划；核对旧 PoC 和旧 tong-agentdock-local 的原始作用与依赖。
2. 对疑似重复目录检查重解析点、硬链接及复制关系，再估计删除后的真实可回收空间。
3. 对 Codex worktree 做 git worktree list、状态及未提交改动审查。删除工作树应使用 Git 正式维护方式，不能裸删。
4. 对 npm/pip 缓存评估可再下载及网络依赖；不要误删 .cache 内仍运行的 Codex runtime。
5. 形成逐个路径、用途、实际空间、是否在用、是否可恢复的候选清单，用户审核批准之后再清理。

当前没有删除或移动任何目录，没有改变系统 PowerShell、权限、服务、ngrok。
PowerShell 5.1 报错原因是 issueRows 的泛型集合在 Export-Csv 管道中引发参数类型不匹配。扫描脚本已将该行修复为 issueRows.ToArray()，供以后扫描使用；不需要为本次重新扫描全部目录。
注意：本次 issues.csv 未生成，具体错误路径未被导出。summary.csv 已标记两个 PARTIAL_ERRORS 根目录，不能当作完全统计。
