# Tong 通用磁盘清理能力：分类目录、持久任务与验收任务书（2026-10-29）

> 状态：**正式研发任务书，不代表功能已完成、默认授权已扩大或真实缓存已删除。**
> 原则：ChatGPT 是操作入口；未指定Codex时由ChatGPT调用Tong正式受管工具执行。需要开发时可按用户指定交给Codex Desktop原生会话。当前只扩大**能力设计**，不扩大既有实际权限。

## 1. 当前事实和为什么必须重新设计

- 当前正式MCP的跨调用Plan→Execute已经修复并真实验收。10套Quick Trust历史候选的 `temp/node-compile-cache` 实际清除5,310文件、13,199,400逻辑字节（12.59MiB），十套`temp`均已只读核查为空。
- **十套完整Quick Trust候选仍为0/10删除**。最初清单逻辑6,051,846,951字节（5.636GiB），当前只删了其中可重建的小缓存。不要再次把12.59MiB描述成5.636GiB。
- 单套候选的`node_modules`实测约38,108文件、2,641目录、600,977,566逻辑字节。正式完整候选Plan超时；开发版并发文件校验的真实只读测试仍超过约118秒，改动已撤回。即使小缓存可删，目前也无法满足“帮我清理整个电脑”的产品目标。
- 当前持久许可`tong-state-cleanup`**只覆盖**`D:\Tong\state`内的cache、historical-candidate、quick-trust-candidate。**未获得C盘、其他D盘目录、Downloads、系统级清理的永久删除授权**。未来新增授权必须由本人在本机受保护控制器明确授予、可查看及撤销，不能从聊天文字推定已授权。
- 原生`0xC0000409`和长时稳定性未根治，保留事故/诊断证据。现有生产pin、release、staged、快照、Git、凭据、数据库不因新清理开发自动变化。

## 2. 缓存与临时文件分类策略（此处是可发现规则，并非声称这些目录在本机存在）

### A. 适合放入低风险自动清理候选池（仍需要根目录有效授权、对象核验）

| 类别 | 示例 | 规则及说明 |
| --- | --- | --- |
| 用户临时文件 | `%TEMP%`、`%LOCALAPPDATA%\Temp` | 推荐默认只处理超过7天且未被进程/服务引用的明确临时文件；锁定或无法证明用途的对象跳过，不能递归直接清空整个Temp根 |
| 构建与解释器缓存 | `__pycache__`、`*.pyc`（限受管项目内）、`.pytest_cache`、`.mypy_cache`、`.ruff_cache`、`node-compile-cache` | 先识别所属项目和活动构建/调试任务；仅缓存内容、按精确路径清理；不将整个工程/虚拟环境当缓存 |
| 经项目确认的临时产物 | 已完成且无引用的测试运行目录、可重建的`tmp`/特定构建缓存 | 必须用项目注册/构建记录/保留归档证明唯一源码及恢复依赖不在其中；无证据就只列为待复核 |
| 缩略图/着色器缓存 | Windows缩略图、DirectX Shader Cache | 优先使用Windows存储清理/磁盘清理提供的入口，避免直接删正在被驱动或桌面使用的文件 |
| 传递优化缓存 | Windows Delivery Optimization Files | 优先微软磁盘清理接口，系统自身已有缓存维护机制；不要直接强删系统服务文件 |

### B. 可重建但必须附加检查（不能只按文件名批量删）

| 类别 | 示例 | 规则 |
| --- | --- | --- |
| 软件包下载缓存 | npm `_cacache`、pip cache、pnpm store、Gradle/Maven缓存、Yarn缓存 | 先询问/读取真实配置路径（如`npm config get cache`、`python -m pip cache dir`、`pnpm store path`），检查是否有离线构建依赖或任务占用；优先使用官方工具，如`npm cache verify`、`pip cache info/purge`、`pnpm store prune`，而非随意递归删除整个共享仓库。npm清理通常仅在需要回收空间时做 |
| 浏览器/应用缓存 | Chrome/Edge网页磁盘缓存、应用HTTP缓存、VS Code可重建缓存 | 与登录状态、扩展数据、浏览器Profile/History/Cookies/Local Storage严格区分；运行中的浏览器先跳过或使用其提供的安全清理接口 |
| 编译产物与依赖副本 | `build`、`dist`、`target`、`node_modules`、`.venv` | 默认只盘点。只有锁文件、构建环境、独有源码、真实项目引用及重建能力均已验证、并且该目录独立获批才可删；共享`node_modules`及当前开发环境一律不默认删 |
| Windows更新与系统旧文件 | Windows Update Cleanup、`Windows.old`、组件存储 | 使用Windows存储建议/磁盘清理/DISM等受支持入口；系统回退能力受影响时必须单独审批。**禁止直接删除WinSxS、手工清空SoftwareDistribution** |
| 错误报告与转储 | `*.dmp`、WER归档、运行日志 | 先检查是否为Tong/系统近期事故证据，未归档或尚用于诊断的文件保留；不可默认全部删除 |

### C. 默认禁止作为“缓存”删除

`Downloads`、桌面/文档/图片/视频、个人笔记和安装包、同步文件或云占位数据、回收站、Git及未提交工作树、数据库及备份、凭据/密钥/OAuth/DPAPI、原生Codex Session、Tong生产/升级/快照/release/staged与事故取证、Docker卷/数据库/活跃镜像、WSL的`ext4.vhdx`或虚拟机磁盘、页面文件/休眠文件、驱动/系统目录、未验证的junction/hardlink/reparse点。需要时单独列明理由、影响和回退方式，取得有效专项批准后走专用操作，不可混入默认缓存清理。

**风险策略不是基于固定后缀绝对安全：**“可重建”“未被使用”“根目录已授权”“没有唯一内容”均须由当前证据支持。用户未来说“帮我清理缓存”默认只能执行受管低风险策略，其他内容列清单而不是悄悄删除。

## 3. 应实现的产品交互和持久授权

用户以后可直接向ChatGPT说“清理C盘和D盘缓存/清理Tong历史重复依赖”，ChatGPT经Tong获取磁盘分类概览、可回收量、任务状态，并在**已授权根目录与类别**内直接启动安全清理，不再逐目录问或让用户复制脚本。工具存在不等于权限存在：

- 受保护的本机授权中心支持**分根目录/分缓存类别/可选年龄阈值/最大单项大小与总量**的可撤销持久许可。授权只在本机确认，审计显示允许项，禁止默认全C盘、全D盘递归删除。
- UI及MCP只暴露受限能力（`scan`、`classify`、`plan_start`、`plan_status`、`plan_result`、`execute_start`、`execute_status`、`cancel`、`result`）；工具名以仓库实际API设计评审为准，保留旧Plan/Execute兼容且语义准确。ChatGPT能查询和监督，但不能在网页会话里伪造本机权限。
- 支持`dryRun`、按类别/目录筛选、仅清理低风险项、详细报告与撤销许可；输出候选具体路径、用途、年龄、逻辑大小、预计实际回收、是否锁定、风险等级和拒绝原因。
- 后台工作由**本机受管worker**持久执行、受权限和生命周期约束；不是ChatGPT承诺异步工作，也不是把Shell包装成受管删除。用户切换聊天、网页请求结束不终止worker；无需轮询的伪进度，不在没有回执前宣称成功。

## 4. 大型清理任务架构（本次主要研发目标）

1. **启动快返回：**`plan_start`同步校验项目/授权/根目录/类别后返回jobId，不在MCP HTTP调用里阻塞扫描3.8万文件。worker在本机继续只读Plan，持久记录状态/进度/检查点。RPC启动/查询应快速返回（建议每次小于10秒），长时间工作允许持续但有资源与错误预算。
2. **明确状态机：**`queued → scanning → verifying → ready_for_execute → executing → verifying_result → completed`；另有`blocked`、`cancelled`、`failed`、`needs_revalidation`。展示已检查文件/字节/目录、当前阶段、最后更新和具体受保护错误；无进度、同项异常反复发生应停止并记录，而非无穷重试。
3. **持久且不可伪造：**工作记录置于受保护状态路径，含独立jobId、精确路径、持久授权revision、生产pin/发行版哈希、快照签名、createdAt/expiresAt、worker身份、审计偏移和去重键。写入原子更新，跨进程/跨网页连接可查询；重启时明确检测异常中止并重新确认，不可绕过检查直接恢复删除。
4. **读取与删除分离：**Plan是只读，真正删除前必须重验grant、当前pin、Windows任务/服务/进程引用、归档有效性、reparse/hardlink、目标目录/文件数量/内容变化和共享依赖。复用严格但昂贵的核验结果时，必须建立可靠的增量失效/目录变动证据，不允许仅用“上次验证过”跳过安全检查。
5. **删除也是持久任务：**可逐项记录开始、已删除数量/字节和失败项；中断后先做磁盘真实状态对账，再决定继续、取消或标记部分删除。不得把半删除写成成功。对于未获授权的路径、文件变化、未知引用和不可重建数据，一律停用该对象，保留其他独立安全目标的执行能力。
6. **安全与容量：**限制单worker并发、I/O吞吐、内存、审计大小；磁盘扫描只按用户目标/已存索引定向执行，不重扫整盘2.58百万文件。处理Windows长路径、锁定文件、ACL、junction与TOCTOU竞态时保持拒绝策略，不滥用管理员权限。源代码、数据库、凭据、未提交Git、事故日志永远不因为“目录很大”而自动放宽。
7. **取消/撤销：**取消必须停止新操作、记录当前部分进度，不能静默继续；`revoke`应阻止未开始及正在执行中的后续删除阶段，在合理边界检查撤销状态；不宣称已经删除的文件可恢复。
8. **报告：**真实删除路径清单、Plan ID/jobId、受管Execute回执、保留的release、受拒目录/原因、实际后验目录状态、执行前后磁盘`freeBytes`与逻辑字节的差异、生产健康。避免把逻辑总量当NTFS实际释放。

## 5. 研发路线与验收标准（Codex执行顺序）

### 阶段一：最小正式方案与隔离测试

- 基于`codex/024-maintenance-adapter-20261024`最新HEAD，复核现有`TongManagedCleanup.mjs`、`TongCleanupAuthorization.mjs`、MCP注册与Gateway allowlist、worker/Goal机制。优先复用现有受管worker/状态能力，**禁止另建一套庞大平行框架**。
- 先只读测量单套候选中`assertNoRuntimeReferences`、`verifyHistoric`（release校验/源码哈希/依赖哈希各段）、`snapshot`的实际耗时，用可取消、限资源的独立诊断，不再跑必然超时的同步HTTP Plan。保留阶段化性能日志，确认真实瓶颈。
- 添加跨进程/跨连接、多任务去重、系统停机/重启、中途撤权、目录变化、链接替换、锁文件、失败审计、任务取消/恢复、执行过程部分失败回执等针对性测试；通过后才准备发布候选。

### 阶段二：实物只读验收与受控上线

- **必须使用既有真实候选**`D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-d780561`，完成约38k文件与约600MB依赖的持久Plan，返回可查询Plan ID和`deletionAuthorized`；不得为“通过测试”复制十套完整node_modules，也不得再次删除已不存在的`temp/node-compile-cache`。
- 保持生产旧版不变，构建hash绑定的轻量release/candidate/快照、执行真实只读preflight，按现有本机批准与自动回退契约升级。不能以用户聊天文字取代正式生产升级授权。
- 生产版网页ChatGPT经正式Gateway分别调用任务启动、查询、Plan结果、受管Execute启动和结果；先选取经真实审核通过的一套历史候选执行，验证目标消失、对应`quick-trust-release-*`保留、audit一致、Host/Task/三端口/监测健康，随后再逐套清理剩余候选。失败项保留并报告，不能跳过校验。

### 阶段三：通用缓存与C/D盘治理

- 用Windows官方入口验证系统缓存；用npm/pip/pnpm官方命令验证开发缓存；同类支持按根目录的受管分类/Plan/Execute。
- 在**另行本机批准的C/D缓存范围**里，测试至少一类Windows临时文件、一类开发缓存、一项拒绝样例（Downloads/凭据/活动文件）、一项断线可查询的大任务；没有有效授权时只能只读发现并提示需要一次性范围授权。
- 实际验收从ChatGPT只发一句“帮我清理可安全删除的缓存”开始，Tong自主发现→分类→执行授权内目标→核对磁盘→给出清理报告；用户无需复制Shell/重复逐批审批，且不会误删任何受保护数据。

**失败不算完成：**仅跑小夹具、仅开发commit、仅mock接口成功、仅执行Plan、只清几MB而没清整套候选，均不能作为本阶段完成；若仍有阻塞，应给出具体证据、停止不安全部分并保留可恢复工作进度。

## 6. 本文资料来源（官方资料，作为设计依据而非个人电脑扫描结果）

- Microsoft Storage Sense（Windows 11/10，系统盘自动清理；默认不动Downloads）：https://support.microsoft.com/en-us/windows/experience/storage-filemanagement/manage-drive-space-with-storage-sense
- Microsoft Free up drive space / Cleanup recommendations：https://support.microsoft.com/en-us/windows/experience/storage-filemanagement/free-up-drive-space-in-windows
- Microsoft Delivery Optimization cache：https://learn.microsoft.com/en-us/windows/deployment/do/waas-delivery-optimization-faq
- Microsoft WinSxS cleanup（禁止手工删WinSxS；DISM /StartComponentCleanup支持）：https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/clean-up-the-winsxs-folder?view=windows-11
- npm cache（缓存仅在需要回收空间时清理，`clean --force`，`verify`）：https://docs.npmjs.com/cli/11/commands/npm-cache/
- pip cache（`pip cache dir/info/purge`）：https://pip.pypa.io/en/stable/cli/pip_cache/
- pnpm store prune（删除未引用包，需要考虑离线切换版本）：https://pnpm.io/cli/store
