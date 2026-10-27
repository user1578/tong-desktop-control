# Tong 第二批精准清理执行记录（2026-10-28 本机JST）

本批承接[第一批清理记录](Tong-Disk-Cleanup-Batch1-20261027.md)和[当前项目进度](../Tong-Project-Plan-and-Handoff.md)中已核对的两处B2.3历史候选。未重新遍历整个D盘。用户在个人Windows PowerShell 7终端执行开发仓库内固定脚本 `scripts/Clean-TongB23Candidates.ps1 -Mode Clean`；该脚本已在开发分支通过只读预检，且在删除前重新验证正式pin、任务/服务/进程引用、保留release档案hash、lock及native恢复材料、两个候选内部无reparse等约束。

## 实际结果（用户命令原始回执＋ChatGPT通过Tong再次核实）

| 精确路径 | 删除前逻辑字节 | 脚本回执 | 删除后Test-Path |
| --- | ---: | --- | --- |
| `D:\Tong\state\b23-release-fgKPTn\candidate-58786f6` | 603,120,383 | `deleted`，2026-10-27T15:25:43.1504160Z | False |
| `D:\Tong\state\b23-release-fgKPTn\candidate-9589698` | 603,448,013 | `deleted`，2026-10-27T15:25:51.5927533Z | False |

合计清除**1,206,568,396字节，约1.12GiB的逻辑文件长度**，共77,571个普通文件。不是NTFS精确磁盘空闲量；没有采集删除前后同盘可归因的空闲簇快照。Windows删除进度条的阶段性计数不应替代最终执行结果。

删除记录（包含路径、日期、逻辑字节和`deleted`）位于用户本机：
`C:\Users\Rune\AppData\Local\Tong\CleanupHistory\batch2-exact-candidates.jsonl`。
通过Tong只读复核，该JSONL确有两条`deleted`，两处candidate均不存在。保留以下三项均存在：
`release-58786f6`、`release-9589698`、`npm-cache`；没有删除两个保留release归档或B2.3测试默认依赖的离线npm缓存。实际运行`D:\Tong\runtime\run\runtime.json`仍是`phase=ready`、同一runId `d90f5e72-dd41-4ee4-9e2a-9eb3b0f490dd`；独立监测器用户进程PID 19096继续记录`healthy=true`的采样。本批未重启、停机、重新部署或修改授权。

## 后续流程改进（尚未实现）

用户已经长期授权在核对后清理可证明无用的历史测试/重复副本，不希望每批都手动粘贴PowerShell命令。现有已部署的`tong_delete_file`只支持已授权可写工作区内**单个普通文件**，不能递归删除目录；`tong_run_command`具有开发项目执行权限，但`D:\Tong\state`并非获得独立删除授权的开发工作区。不能将shell作为绕过MCP路径授权的手段。

后续应在Tong开发分支增加**经本机一次性信任、可收紧且可撤销的精确目录清理能力**，以明确的allowlist/目录意图为边界，检查无reparse、无生产pin/原生会话/任务/运行进程引用，展示删除前确定范围并输出审计回执；通过测试和授权部署后可由ChatGPT直接执行可恢复/明确获准清理，保留较高风险删除的本机确认门禁。未上线前不谎称拥有任意D盘递归删除权限。

本文件只记录本次实测回执；其Git推送状态以实际提交结果为准。
