# Tong五根目录整理：ChatGPT第二次独立复核（2026-10-27）

**结论：Codex报告可用作后续分批整理的依据；不构成清理、迁移或修改生产的放行。** 本次仅只读复核、记录结论。审查期间未删除、搬迁、重命名原目录或更改Windows任务、权限、生产pin、ngrok及服务。

依据：[Codex完整盘点](Tong-Five-Root-Consolidation-Codex-Report-20261027.md)（Git提交772fe7d49f1e09d5e6443a74fdfb1a4fe5b45931）、[原任务书](Tong-Five-Root-Consolidation-Audit-20261027.md)。报告包含43.622 GiB、2,579,388个文件、203,709个子目录、跳过131重解析点及state 1609项索引。这些是Codex以无跟随元数据遍历测得的可达逻辑大小，本次没有重复遍历全部约258万文件，**不能称为独立验证了物理磁盘占用**。

## 独立现场抽查（ChatGPT通过Tong、PS7）

- 对七个根仓库执行只读Git状态：开发主仓库 D:\Tong\development\tong-desktop-control 为2个已跟踪修改、17个未跟踪；报告仓库 D:\Tong\development\tong-024-startup-recovery 在审查前为干净且HEAD=772fe7d49f1e；launcher、hotfix两个worktree均干净；D:\tong-desktop-control 为50个已跟踪修改、13个未跟踪；D:\tong-codex-acceptance-20261010 为0个已跟踪修改、2个未跟踪；PoC中agentdock源码为detached且干净。与报告G1一致。
- 分别检查三个开发worktree的node_modules：全部是junction，目标都为 D:\Tong\development\tong-desktop-control\node_modules。**不得单独删除共享目标**。
- 只读解析正式runtime/run下的manager-pin.json和release-pin.json：commit均为 b9fe80150f9cdea47130e8952e85e39503187677；sourceRepository均为 D:\Tong\development\tong-desktop-control；releaseRoot均为 D:\Tong\state\b23-login-70f1b7d66215458c8ffa0d822348de0f\startup-recovery-3bdc9693e71f49e2bafc7e5372b5bb20\release。runtime/profile.json的root、codeRoot及managerRoot分别为 D:\Tong\runtime、D:\Tong\app、D:\Tong\runtime\releases\manager。上述全部**必须保留原位**，不因开发仓库出现新文档提交而改变安装绑定。
- 只读查询Tong注册：旧PoC、旧AgentDock运行态、旧Tong仓库和计算器验收四个projectId仍绑定D盘原路径。只有metadata或read/write能力，不存在可直接无条件续接Codex原生会话的授权。移动前必须核验同一会话的ID、原cwd、writer及受管root变更入口；不能创建新会话冒充续接。
- 只读Get-ScheduledTask：27个Tong相关任务，其中26 Disabled、TongLoginRuntime为Running。**21个任务**在Execute或WorkingDirectory直接指向D:\Tong\state，另有**4个TongCommProbe任务**只在Arguments中引用state；合计25个引用受影响路径。报告中的21是直接路径口径，不代表全部参数引用只有21。禁用任务仍可能保留事故回放价值，不意味着其目标目录可删除。
- 静态app/config的ngrokExecutable仍指向历史位置（扫描输出中文路径编码异常，报告指出D:\小红书\ngrok.exe）。TongNgrokRestore是Disabled并含旧临时脚本名；运行中的ngrok服务不等于该后备恢复入口可用。**只列为单独维护缺陷，不在目录清理时顺手改生产配置**。
- 对报告附录B的1609行重新排序，大小相加为37,197,167,280字节；与state全根37,197,184,309字节相差17,029字节，对应state根层非目录文件的本轮既有元数据汇总。这是报告内部计数一致性校验，非独立二次磁盘扫描。

## 清理/迁移判定（按实际风险）

| 类别 | 对象 | 本次复核结论 |
| --- | --- | --- |
| A 原位保留 | D:\Tong\app、runtime、tools\ngrok、development主仓库和三个共享worktree、两个pin指定releaseRoot、p244-python-runtime、ngrok-service.yml及相关gate/恢复预算 | **禁止搬迁和清理**；正在运行或有版本/策略/任务直接引用 |
| B 完整保留并审查后迁移 | D:\tong-desktop-control、D:\agentdock-poc-20261010、D:\tong-agentdock-local、D:\tong-codex-acceptance-20261010 | 可规划同卷迁入Tong的archives或development/acceptance；但必须保留旧Git/dirty/untracked/原生会话与受管授权的映射。历史运行态的凭据、ACL/DPAPI/数据库/WAL/SHM/备份须成组保护 |
| C 低风险小缓存候选 | 计算器根和tests下__pycache__、.pytest_cache、PoC根__pycache__ | 可在确认无使用者及无需缓存取证后精确删除，**收益极小**，不能为此删除.py或tests源码 |
| D 有条件可省空间 | 计算器.venv约36.9MB、PoC synthetic-project .venv约23.4MB、旧源码node_modules约601MB、PoC npm-cache约189MB，以及state内某些完整依赖副本 | 尚无无引用/完全可恢复证明，不批准现在删除。必须先确认相应环境版本、锁文件/补丁、独有数据、离线恢复材料，再精确按根计算释放量 |
| E 证据/未知 | D:\Tong\state绝大多数历史根、所有被任务和pin引用的根、生产与旧local的state-backups/state-restores、日志及131个跳过的重解析点 | 当前不能按前缀批量清理。尤其不能用“Disabled、old、test、temp”名称推断无用 |

**重要的容量区分：** 五根总逻辑量43.622GiB，报告归入node_modules约35.117GiB，但此类别包含生产、离线恢复和备份内依赖，不能等同可释放字节；四外置根合计4.900GiB，迁到相同D盘不释放容量。

### 按附录B大小优先复核、不是删除名单

- D:\Tong\state\p27-autonomy-candidate-20261017：7.209GiB。
- D:\Tong\state\b23-switch-c104fcca2aa9：3.542GiB。
- D:\Tong\state\native-codex-acceptance-20261018：2.872GiB。
- D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a：2.254GiB，含已知生产成功/故障证据、Disabled任务引用，**暂必须保留**。
- D:\Tong\state\p26-release-preparation-67ffa0da：1.328GiB。
- D:\Tong\state\b23-release-fgKPTn：1.324GiB。

除已明确保留的b23-login-68009...外，其余仅作为进一步核查是否独有、仍被引用、能否恢复的高容量候选；名字并不能证明其安全可删。

## 分批执行建议与门槛

0. **保留集合先冻结为清单**：保留现有成功的生产版本和工作目录，建立源→目标映射、任务引用清单、Git脏工作树证据、Codex原生会话元数据边界，不新建4.9GiB完整副本。允许只读再查；此项不需要停机。
1. **仅对单独确认的缓存做低风险小额清理**：必须先保存计算器未跟踪源码/测试与准确列表；不触及.git、.venv或其他项目，无法证明则跳过。小缓存即使删除也几乎不节省空间，不应成为主要目标。
2. **优先迁移独立旧工程而非生产**：先在受管系统中确认项目root与原生会话能变更且续接，按每批源目录精确记录清单/哈希/ACL和回退方法；如无法无损处理，保持旧根不动。旧Tong的50+13必须保存，不能仅clone或commit取代；PoC和历史运行态必须考虑跨目录tests硬编码与DPAPI/SQLite一致性。正式服务无需因普通归档默认停机；若发现活动引用则停止该批。
3. **集中审查state的大体积历史副本**：从前述六个大目录开始，只读核验任务、运行状态、独有Git和native依赖、成套备份及文档证据；先标记可退役，再对被引用的Disabled任务提交独立系统变更。每根审查并验收恢复后才能删或移；不能通配清理1609项。
4. **最后才清理重复依赖和日志**：计算保留版本的实际可恢复性及NTFS实际释放量，确定事故证据保留期限。生产pin、shared node_modules、gate/凭据和备份不得被简化操作破坏。
5. **另案修复ngrok旧路径/恢复任务**：当前生产健康时保持不动，计划维护窗口内核验实际服务路径、正式入口及重启恢复链，再决定是否改配置，不与大规模搬迁同时实施。

## 仍未闭环

- 未独立对全部2,579,388个文件重新扫描/哈希，未验证NTFS物理占用和所有外部句柄。
- 未得到四旧根真实原生Codex会话的迁移续接证明。
- 未得到归档后的ACL/DPAPI/SQLite一致性及发布恢复演练。
- 未核对全部131重解析点的外部消费者（按安全边界不跟随）。
- 未执行任何删除、移动、新建archives或计划任务、生产配置更改。

**综合意见：通过“盘点报告可进入精确迁移方案设计”，不通过“直接删除/迁移”。后续先制定一个可回退的单批次执行清单，再按用户授权落实。**
