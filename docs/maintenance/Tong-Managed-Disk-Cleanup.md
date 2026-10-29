# Tong 受管磁盘清理与容量治理

> 2026-10-28最新入口：[最终清理与目录归并交接](Tong-Final-Cleanup-and-Directory-Order-20261028.md)。已增加独立、可撤销的持久清理许可，普通project.write不再隐含递归删除。下文“可写项目”的旧开发合同已被新许可分离规则取代；生产部署/许可/小缓存MCP删除仍须分别以真实回执为准。

2026-10-29 11:46 JST：正式App/Manager为9850cc4，受保护策略目录的持久许可已启用并复用。正式Gateway MCP已实际Plan→Execute删除1文件69字节缓存，planId `7be98004-b089-409f-9ce9-b4f75567f0cc`；目标目录消失、父目录保留、审计完整，删除后同run健康。用户批准的受保护SYSTEM任务未知实现仅记审计警告，已知引用和其他unknown仍拒绝；Plan的`referenceWarnings`及Execute重查审计均已实测。中途登录Runner原生doctor崩溃后已接回监测，根因未修复。大候选未删除，准确状态以交接页最新记录为准。

## 问题来源

此前五处项目根目录统计逻辑容量43.622GiB，约35.117GiB归类为node_modules及其在发布候选、历史恢复/测试副本中的依赖。约37,197,184,309字节（34.64GiB）集中在state，不能把逻辑大小直接当成NTFS的独立物理占用或全量可回收容量。多份历史候选各自带约600MB完整依赖，反复测试/打包放大体积。正常生产运行环境没有必要保留几十份，但精简后的正式部署目标1–2GB仍需实际构建测量，不能作为未经验证的承诺。

第一批实际删除两个npm缓存378,061,153字节；第二批用户在PowerShell单次执行并经Tong元数据再次独立验证，两份历史candidate共删除1,206,568,396字节。因此截至本记录按逻辑文件长度累计1,584,629,549字节（约1.476GiB），并不代表只能清理这些。两份历史release归档及b23测试使用的npm-cache继续保留，当前pin仍指向b9fe801...另一处releaseRoot。

## 接口

- `tong_disk_cleanup_plan({projectId,path})`：在**已注册且拥有独立有效清理许可的项目范围**里对单个缓存/历史候选产生5分钟有效的只读计划，包括精确目录、类别、文件/目录数和逻辑大小。
- `tong_disk_cleanup_execute({projectId,planId})`：仅对同一项目的有效一次性计划执行，删除前重新核对项目授权、目录路径、文件摘要、生产pin和历史release完整性；缺少任何证据即拒绝，结果写到本地`disk-cleanup-audit.jsonl`。不会从聊天文本临时扩权。
- 第一阶段允许对象：`npm-cache`、`.npm-cache`、`node-compile-cache`、`.pytest_cache`、`__pycache__`、项目内部`.cache`，以及确有匹配、可验证release归档的`b23-release-*/candidate-<commit前缀>`和`p27-autonomy-candidate-20261017/quick-trust-candidate-<7位提交前缀>`；不允许指定任意目录、普通源码目录或共享`node_modules`本身。
- 系统目录、凭据、Git仓库管理目录、正式Tong app/runtime/tools、state-backups和state-restores被拒；禁止符号链接、junction、硬链接、不一致的归档；单次计划最多12万文件、4GiB，避免大范围删除误操作。
- 预检先记录审计后删除；不会自动重启Tong、修改pin、改任务、修改授权或跨目录搬迁；回收数报告逻辑大小，不伪称实际NTFS空闲增量。

## 授权边界

普通项目read/write和`tong_scan_directory`不隐含state递归删除权限。正式本机入口已为`D:\Tong\state`颁发独立可撤销的持久清理许可，projectId `tong-state-cleanup`，仅cache/historical-candidate/quick-trust-candidate类别，revision `c4da4b91-5d4a-42ff-9877-70eadadc8629`，持续至本人撤销。ChatGPT每次仍须通过短时只读Plan核对精确对象，再Execute；MCP不能自行颁发或扩大许可。正式升级使用另外的版本绑定本机挑战。首次授权及新版本挑战不能由聊天文字替代，也不自动授权新的真实删除对象。

## 验证

- `tests/Test-TongManagedCleanup.mjs`在独立夹具中已覆盖：计划不删除、实际缓存删除、审计记录、重放拒绝、普通源码拒绝、未授权项目拒绝、计划过期拒绝、文件改变拒绝、共享依赖拒绝。
- `tests/Test-TongMcpMetadataTools.mjs`MCP联调验证新工具注册、缓存Plan/Execute真实返回、重复执行拒绝；Gateway原有测试通过。该联调使用独立合成目录而非D:\Tong\state。没有测试真实生产批量删除、跨重启长寿命计划或公开网络端到端。
- 2026-10-28补充针对10套Quick Trust恢复候选的精确核验：[第三批候选只读审查](Tong-Disk-Cleanup-Batch3-QuickTrust-Review-20261028.md)，合计6,051,846,951字节（5.636GiB），累计核对2,765个源码文件和250个归档文件SHA。配套`Test-TongQuickTrustCleanup.mjs`在独立夹具中通过增量独有源码拒删、损坏native拒删、清理成功并保留release及审计的模拟测试。**此批未实施实际state删除。**
- 下一步：重点验证超大候选、断电/中断时的审计与清理恢复、更多权限组合/符号链接竞态、Gateway压力与错误返回格式；完成代码评审、独立生产版本门禁和必要的长期监控后方可正式发布。实际35GB容量治理采用已有清单按root/子目录重复性逐批审核，拒绝未经核实的整state通配删除。

## 后续空间治理建议

不重复扫描2.58百万文件，从上次盘点占比最大的历史根开始：p27-autonomy-candidate（7.209GiB）、b23-switch（3.542GiB）、native-codex-acceptance（2.872GiB）等，先分出重复node_modules、保留release/native/manifest、唯一Git和测试状态。证明完全重复、恢复可用且无引用后，以精确子目录分批删除。建立“最多保留少数可回滚发布候选、构建复用共享依赖、测试结束清除可重建缓存”的长期规则，防止再次增至几十GB。
