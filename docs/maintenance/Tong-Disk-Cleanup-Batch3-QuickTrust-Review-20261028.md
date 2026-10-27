# 第三批候选审查 — p27 Quick Trust历史恢复副本（2026-10-28）

状态：**10套候选通过只读归档一致性审查，符合退役审查的关键条件；尚未执行删除**。用户已明确允许审查无用重复内容后清理，不需要重复询问普通候选的业务意图。但当前Tong生产没有部署受管递归删除接口，而且 `D:\Tong\state` 仍没有单独的受控删除授权，不允许用已有开发命令绕开写入边界。

## 上下文与容量

沿用《五根目录完整盘点》和前两批清理结果，没有重新扫描整个D盘/258万文件；仅精准复查附录B列出的3个最大state历史根，得到当前可达文件长度：

| 历史根 | 逻辑容量 | 核查性质 |
| --- | ---: | --- |
| `D:\Tong\state\p27-autonomy-candidate-20261017` | 7,551,924,999字节 / 7.033GiB | 10套Quick Trust候选、2套staged及历史release |
| `D:\Tong\state\b23-switch-c104fcca2aa9` | 3,803,333,255字节 / 3.542GiB | releases约1.998GB与旧运行态tong约1.804GB；暂保留 |
| `D:\Tong\state\native-codex-acceptance-20261018` | 3,083,883,082字节 / 2.872GiB | persistent-proxy/project-affinity/staged-app/staged-manager；暂保留 |

不把这些根整体认作可删，也不把上述逻辑字节数误认NTFS实际可释放容量。

## 精确候选名单

父路径固定为 `D:\Tong\state\p27-autonomy-candidate-20261017`。下列候选全部为普通目录、此次无被跳过的reparse，关联的保留release依次以同一后缀命名。

| candidate目录名 | 逻辑字节 | 对应必须保留的release |
| --- | ---: | --- |
| `quick-trust-candidate-5362210` | 605,318,136 | `quick-trust-release-5362210` |
| `quick-trust-candidate-d780561` | 605,293,288 | `quick-trust-release-d780561` |
| `quick-trust-candidate-024d5b0` | 605,275,611 | `quick-trust-release-024d5b0` |
| `quick-trust-candidate-1a78e48` | 605,266,938 | `quick-trust-release-1a78e48` |
| `quick-trust-candidate-4ebdbc3` | 605,246,372 | `quick-trust-release-4ebdbc3` |
| `quick-trust-candidate-7d11382` | 605,154,390 | `quick-trust-release-7d11382` |
| `quick-trust-candidate-376a328` | 605,135,958 | `quick-trust-release-376a328` |
| `quick-trust-candidate-37dc649` | 605,101,901 | `quick-trust-release-37dc649` |
| `quick-trust-candidate-d9983bb` | 605,043,710 | `quick-trust-release-d9983bb` |
| `quick-trust-candidate-0a2da3c` | 605,010,647 | `quick-trust-release-0a2da3c` |
| **候选合计** | **6,051,846,951字节 / 5.636GiB** | 10套release原位保留 |

单独保留 `staged-app`（604,513,891字节）和 `staged-manager`（604,513,855字节），不并入这次候选清理。

## 已执行的只读核验

1. 生产run原先已核验处于READY，正式双pin仍指向 `b9fe801...` 所属另一处state releaseRoot；本次未启动doctor、停止进程、修改任务、切换发布版本或更改恢复预算。
2. 精确查询Windows任务的Execute/Arguments/WorkingDirectory、服务的PathName和非当前检测进程的命令行/可执行路径：三个大历史根均没有直接命中。对于被拒读取的进程或静态引用，不能据此宣称全系统绝无句柄。
3. 在app、正式manager、两个开发源码树的scripts/tests中针对 `quick-trust-candidate-` / `quick-trust-release-` 文本静态检索720个小型安全文件；命中的是生成这类候选路径的通用Quick Trust脚本、回归/回滚测试和旧恢复脚本。未在以上实时任务/服务/进程中查到某个具体候选正运行。**如果后续手动重跑历史Quick Trust测试，必须重新恢复候选环境，不应声称离线恢复永远不受影响。**
4. 对10套候选的 `package-lock.json` SHA256一致（`2c3cb8667f929ff1a87a251f3d5d2ea0300c9846277f28f891968f431769ea01`）；各份 `release-restore-evidence.json` 的commit与对应 `quick-trust-release-<后缀>` manifest精确匹配，patchChecked=true、sqliteNativeLoaded=true、nativeRestore=exact archived hashes。
5. 对10个候选累计逐文件核对 **2,765个源码文件** 的内容SHA，以及各release里 **250个关键归档文件**（每套code/source.tar、code/source/package-lock.json、23个native文件）的内容SHA，均匹配。排除候选下 `node_modules` 与 `temp` 后，唯一超出来源清单的文件是各自的小型 `release-restore-evidence.json`（10份）。没有发现独有用户源码混在候选内。恢复验证文件的判定和哈希需记录在未来执行审计中，不能把已核对候选全量打包再次占用空间。
6. 不宣称已独立恢复演练过每个历史版本。第一批曾删除此p27根的npm-cache；因此某次旧Quick Trust离线复现可能要重新准备npm缓存；保留release档案不能等同“完全无需网络即可离线重建”。

## 受管清理实现与门禁

开发版 `scripts/TongManagedCleanup.mjs` 支持特定 `p27-autonomy-candidate-20261017/quick-trust-candidate-<7位commit>` 类别，检验对应release的source/native/lock哈希、候选中是否存在未归档源码、复原记录、根授权、短时一次性计划和最终快照稳定性。新测试 `tests/Test-TongQuickTrustCleanup.mjs` 用隔离的合成目录验证：若候选多出未归档文件则拒绝；归档native篡改则拒绝；符合规则时Plan→Execute清除且保留release与审计记录。测试不删除生产state中的候选。

目前部署的Tong不存在新 `tong_disk_cleanup_plan/execute`，也没有授予 `D:\Tong\state`受管清理写权限。用户强调今后希望ChatGPT直接删、无需每批手动粘贴脚本。**下一步应先完成单独受控的生产升级与一次性、精确允许范围的本机授权**，而非直接把整个state设为可任意写/删除的开发项目。未达到这两个条件，本批状态仍为“符合候选条件、尚未删除”。

实际执行前还要对10条精确路径重查：production pin、Windows任务/服务和进程、候选完整性、release完整性、恢复记录保全、监测器状态和本地审计；逐条确认退出码与目标目录不存在。不能因开发模拟测试通过就报告回收5.636GiB。

**截至本报告实际完成删除依旧仅为前两批：1,584,629,549逻辑字节；本批新增实际删除0字节。**
