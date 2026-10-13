# Tong 第二批旧测试目录核验结论 — 2026-10-13

来源：ChatGPT 通过 Tong MCP 读取本机 Tong-b23-switch-second-review.txt / .csv，以及此前的磁盘空间审查结果。本报告为只读核验总结，不表示已经清理或获得删除授权。

## 本次已核实
- 检查 Windows 运行进程 383 条、系统服务 321 条及现有 Tong JSON 配置 6 份。进程和服务没有报告命中本次候选路径。当前 Tong release-pin.json 的 $.releaseRoot 仍包含 D:\agentdock-poc-20261010 的路径、$.sourceRepository 仍包含 C:\Users\Rune\.codex\worktrees 的路径；具体配置值未导出，不能确认所有子目录已脱离引用。
- D:\agentdock-poc-20261010\isolated\state\b23-switch-c104fcca2aa9 是旧 PoC 中的独立目录；D:\Tong\state\b23-switch-c104fcca2aa9 是其迁移树中的同名目录。两者顶层不是 reparse point。
- 两个同名测试目录抽检 7 份对应文件，7 份 SHA256 均相同；但这不等于完整目录一致。两个抽检文件的 hardlink list 各报告 1 条路径，没有发现指向 D:\Tong\state 的第二条硬链接。全目录实际可回收空间尚未确认。
- 当前进程、系统服务和检索范围内的配置未报告直接引用两个 b23-switch 目录或旧 D:\tong-agentdock-local，但不能据此认定它们在所有恢复/回滚流程中无用。

## 精确清理建议
**优先候选（须单独最终批准，且执行前只读复核）：**
D:\agentdock-poc-20261010\isolated\state\b23-switch-c104fcca2aa9

历史扫描逻辑容量约 3.542 GiB，不保证删除后可释放相同物理空间。

**暂时保留：**
1. D:\agentdock-poc-20261010 这个根目录及其其他内容；生产 release pin 仍引用该根目录下的 releaseRoot。
2. D:\Tong\state\b23-switch-c104fcca2aa9：暂作保留副本。
3. D:\Tong\runtime、生产发布、密钥、审批记录、状态备份与恢复资料。
4. D:\tong-agentdock-local：涉及历史备份、DPAPI/回滚材料，暂缓。
5. C:\Users\Rune\.codex\worktrees 和所有有未提交修改的 Git 工作区。

## 正式删除前的执行要求
- 明确用户批准上述唯一完整路径（不扩大为整个 old PoC 或 D:\Tong\state）。
- 只读确认 Tong 生产健康、正在运行的可执行文件/参数以及当前配置仍未精确引用该候选子目录；重新核对路径规范化和 reparse point。
- 确认恢复依赖不需要该目录、保留的副本已经存在。
- 删除后核对目录不存在、Tong 仍可访问、D 盘实际空闲变化；若有异常立即停止，不清理第二个副本。
- 追加实际操作和验证结果到 Git 审查记录；不自动 push、不混入旧有未提交改动。

当前没有执行第二批删除。