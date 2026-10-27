# Tong 受管磁盘清理与容量治理 — 开发版

## 问题来源

此前五处项目根目录统计逻辑容量43.622GiB，约35.117GiB归类为node_modules及其在发布候选、历史恢复/测试副本中的依赖。约37,197,184,309字节（34.64GiB）集中在state，不能把逻辑大小直接当成NTFS的独立物理占用或全量可回收容量。多份历史候选各自带约600MB完整依赖，反复测试/打包放大体积。正常生产运行环境没有必要保留几十份，但精简后的正式部署目标1–2GB仍需实际构建测量，不能作为未经验证的承诺。

第一批实际删除两个npm缓存378,061,153字节；第二批用户在PowerShell单次执行并经Tong元数据再次独立验证，两份历史candidate共删除1,206,568,396字节。因此截至本记录按逻辑文件长度累计1,584,629,549字节（约1.476GiB），并不代表只能清理这些。两份历史release归档及b23测试使用的npm-cache继续保留，当前pin仍指向b9fe801...另一处releaseRoot。

## 开发版接口（当前生产尚未提供）

- `tong_disk_cleanup_plan({projectId,path})`：在**已注册且可写的项目**里对单个缓存/历史候选产生5分钟有效的只读计划，包括精确目录、类别、文件/目录数和逻辑大小。
- `tong_disk_cleanup_execute({projectId,planId})`：仅对同一项目的有效一次性计划执行，删除前重新核对项目授权、目录路径、文件摘要、生产pin和历史release完整性；缺少任何证据即拒绝，结果写到本地`disk-cleanup-audit.jsonl`。不会从聊天文本临时扩权。
- 第一阶段允许对象：`npm-cache`、`.npm-cache`、`node-compile-cache`、`.pytest_cache`、`__pycache__`、项目内部`.cache`，以及确有匹配、可验证release归档的`b23-release-*/candidate-<commit前缀>`；不允许指定任意目录、普通源码目录或共享`node_modules`本身。
- 系统目录、凭据、Git仓库管理目录、正式Tong app/runtime/tools、state-backups和state-restores被拒；禁止符号链接、junction、硬链接、不一致的归档；单次计划最多12万文件、4GiB，避免大范围删除误操作。
- 预检先记录审计后删除；不会自动重启Tong、修改pin、改任务、修改授权或跨目录搬迁；回收数报告逻辑大小，不伪称实际NTFS空闲增量。

## 授权边界

现有`D:\Tong\state`**不是可写的Tong登记项目**。尽管`tong_scan_directory`能在既有安全边界内读C/D元数据，`tong_disk_cleanup_execute`不会据此授予state删除权限。要实现用户期望的“首次授权，后续ChatGPT直接清理”，必须通过本机受信任的授权入口对目标管理根建立可撤销的持久写入范围，之后才能从网页端使用`plan → execute`，无须每次编写并让用户运行PowerShell删除脚本。首次本机授权本身仍是必须的，不能由聊天文字替代。正式生产升级单独管理，不借这次开发测试重启现役服务。

## 验证

- `tests/Test-TongManagedCleanup.mjs`在独立夹具中已覆盖：计划不删除、实际缓存删除、审计记录、重放拒绝、普通源码拒绝、未授权项目拒绝、计划过期拒绝、文件改变拒绝、共享依赖拒绝。
- `tests/Test-TongMcpMetadataTools.mjs`MCP联调验证新工具注册、缓存Plan/Execute真实返回、重复执行拒绝；Gateway原有测试通过。该联调使用独立合成目录而非D:\Tong\state。没有测试真实生产批量删除、跨重启长寿命计划或公开网络端到端。
- 下一步：重点验证超大候选、断电/中断时的审计与清理恢复、更多权限组合/符号链接竞态、Gateway压力与错误返回格式；完成代码评审、独立生产版本门禁和必要的长期监控后方可正式发布。实际35GB容量治理采用已有清单按root/子目录重复性逐批审核，拒绝未经核实的整state通配删除。

## 后续空间治理建议

不重复扫描2.58百万文件，从上次盘点占比最大的历史根开始：p27-autonomy-candidate（7.209GiB）、b23-switch（3.542GiB）、native-codex-acceptance（2.872GiB）等，先分出重复node_modules、保留release/native/manifest、唯一Git和测试状态。证明完全重复、恢复可用且无引用后，以精确子目录分批删除。建立“最多保留少数可回滚发布候选、构建复用共享依赖、测试结束清除可重建缓存”的长期规则，防止再次增至几十GB。
