# 生产升级、最终清理与目录归并交接（2026-10-28）

本轮由 Codex Desktop 执行；不开发其他Provider、不改Codex调度、不搬外部项目、不删除十套大型候选。以下开发、测试、生产和删除状态分别记录。

## 1. 当前生产与升级通道

### CLI单JSON协议故障续修（2026-10-28，最新）

2fcea75这次正式升级已经失败并自动回退，不能继续使用上一节历史的“等待授权”作为当前状态。快照`quick-trust-full-cutover-20261028042414441-0da1d9af`于13:38:20 JST进入`rolled-back-old-code`；13:42:41登录日志记录旧版run `9cdb151b-8250-4b65-bf41-02e306878b0b`健康。`native-window-result.json`仍记`native-window-failed-or-cancelled`，表示升级未成功，与回退成功不矛盾。失败快照、授权审计和已释放门禁的`upgrade-gate.json`回执全部保留。

17:22 JST直接只读核对：App/Manager双pin均`b9fe80150f9cdea47130e8952e85e39503187677`；两套各284源码逐文件、3份补丁、实际Runner与profile/pin digest匹配。当前run为`1c07a229-806c-4795-b418-b401c847cfbf`、READY，Task Running、唯一Host PID36492、7676/7677/18765均监听，`backup.freeze`不存在。本轮没有停止Task或调整gate。旧版15:06再次启动，16:23 Gateway退出`0xC0000409/native_fast_fail`，16:27自动恢复成功；此历史稳定性问题不属于本次stdout修复，未声称根治。独立监测器当前无活动进程，最后样本为13:46 JST，不能当作当前连续健康证据。

根因与准确边界：`install-activate`在同一CLI中依次调用install、installRunner、checkInstalled，三者各写一条stdout JSON。完整调用正常退出后，包装器Native将stdout合并再ConvertFrom-Json一次，于是报`Additional text encountered after finished reading JSON content`并进入自动回退。隔离执行同一实际组合代码复现“exit=0但3条JSON”。现场未保存原始stdout，三条输出的确认来自归档代码和隔离复现；原快照最终阶段不能还原全部中间时间线。回退后的同一报错是外层重新抛出原安装解析错误，不等于回退再失败。新版释放gate路径也有同类嵌套输出，已一起覆盖。

修复：所有内部步骤返回对象；CLI只在完整动作及最后lease proof成功后输出一个成功JSON，异常只输出一个失败JSON并返回非零退出码，诊断使用stderr。Native严格要求一个JSON对象，不采用取最后一行或吞掉多条结果的兼容；错误带具体操作名，异常原文不回显。自动回退最终状态明确区分`UPGRADE_FAILED_OLD_VERSION_RECOVERED`和`UPGRADE_FAILED_ROLLBACK_FAILED`，后者同时保留原升级及恢复失败原因。

隔离测试覆盖复合安装、释放gate、最终lease proof失败、部分安装后失败、回退文件恢复失败、自动回退成功/源码恢复失败/旧版启动失败，以及多JSON、空输出、数组、stdout诊断、stderr诊断和exit=0但ok=false。使用真实小文件复制/回退与真实CLI stdout，Task/授权等外部边界保持隔离。独立审查指出原partial-install用例首个复制文件内容相同，已改为先实际写入新版payload并断言现场已改变，再断言回退还原；新版复合stdout及PS Native/自动回退测试通过，原增量回退、Runner身份/包装器、升级gate/版本绑定和控制字节绑定回归通过。

修复commit **`e0eb933cec1b3cb88a4d34b19e3257228f39541e`已推送**至当前codex分支。新发布绑定如下（均在`D:\Tong\state\p27-autonomy-candidate-20261017`）：

- release：`quick-trust-release-e0eb933`，559源码/23 native，完整build/verify通过。
- candidate：`quick-trust-candidate-e0eb933`，源码+3份已核对补丁+共享SDK；不是完整npm恢复，不重新安装依赖。
- snapshot：`quick-trust-full-cutover-20261028083606841-c7ddb8fd`，新/旧commit分别绑定e0eb933/b9fe801，App/Manager旧源码各284文件验证通过，stage=`snapshotted`。

17:36 JST从新归档包装器执行`-Mode Preflight`实际输出PRECHECK PASS；现场旧run `1c07a229-806c-4795-b418-b401c847cfbf`健康、无生产变更。归档内`Test-TongUpgradeControlBinding.mjs`通过；helper新SHA为`9379c38974dbf7aee9f6807e14f2d4a0dd6c191a7e06645a7df532b20d431749`，与Git归档实际导出字节和release清单一致，未改旧归档或停用校验。正式认证MCP项目查询成功返回12项，仍是旧版、没有cleanupScopes。新增三处产物约34MiB，仅包含必要源码/native/回退材料及少量暂存；未复制完整依赖。

新快照内`Run-Approved-Upgrade.ps1`仅已准备并通过PS7解析，**本次未打开窗口或执行Deploy**。遵守用户“本次不要直接重试生产升级”：下一次明确进入维护窗口前先恢复独立监测（由本人自己的Windows Shell启动现有入口），重新读取实时门禁，再由本人完成新哈希绑定挑战。旧快照、回执、授权材料及所有历史候选保留；小缓存与5.636GiB候选均未删除。新候选的生产运行/MCP清理/真实小缓存验收仍未完成。

### 前一轮Runner修复与发布准备（历史）

### Runner身份匹配故障续修（2026-10-28）

本机cb0355b升级窗口在`Stop-Login()`报`Unable to identify the single original monitor runner`，失败回执为`native-window-failed-or-cancelled`。原快照`quick-trust-full-cutover-20261027174339358-177eb337`仍为`snapshotted`；其候选绑定、失败回执和授权审计保留，不覆盖旧归档。现场只读确认Task唯一实例EnginePID=30820、Host真实路径为runtime/login-management/TongLoginHost.exe，唯一子Runner PID28216实际为`C:\Program Files\PowerShell\7\pwsh.exe`。旧过滤器只接受PS5.1，故匹配为零；未停止正式运行。

本次只修当前完整升级/独立回退共用的进程识别：固定PS7及系统PS5路径白名单、完整启动命令、唯一子进程、Task动作/实例GUID/EnginePID、Host路径、父子关系及创建时间；禁用Task后和调用stop-run前重新读取并逐项对比，消失、复用或身份变化均拒绝停止。预检现在也读取同一完整身份。无强杀、无按名称泛匹配。真实Host无参数命令尾部空白可以存在，额外参数仍拒绝。

同类固定PS5匹配还见于旧`Invoke-TongQuickTrustProduction.ps1`、`Set-TongSilentLogin.ps1`的一次性历史切换，当前FullProduction/FullCutover/独立Rollback不调用它们，本次不启用或迁移旧入口。当前冻结门及Host使用PS7；`TongProductionProfile.mjs`、`TongRuntimeSecurity.mjs`的固定PS5调用是原有原生安全/DPAPI助手契约，不是Runner身份过滤，本次保持不变。

新增PS7回归先在旧代码复现同一报错，再验证正常停止及18项身份/竞态拒绝；真实隔离Host/PS7正常退出通过（最终夹具`test-temp/runner-stop-12dd5acaf81548a997227da2a2bfab21`，仅Scheduler和Manager请求投递为测试适配器）。原升级包装器、实际文件增量完整/部分安装回退、生命周期gate、升级版本绑定、readiness和控制脚本绑定测试通过。只读独立审查发现外层catch会在身份拒绝后按任务名重启；已补实际外层catch的先红后绿回归，并改为只允许重新验证完整原身份和原健康run后Enable，不自动Start。以上不是生产切换成功。

修复commit **`2fcea7523d358190661fc905a23b482386f6fecd`已推送**至`codex/024-maintenance-adapter-20261024`。新release为`D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-release-2fcea75`，557源码/23 native，完整build/verify通过；新暂存为同根`quick-trust-candidate-2fcea75`，仅源码、3补丁和共享SDK。新快照为同根`quick-trust-full-cutover-20261028042414441-0da1d9af`，原App/Manager各284源码、pin/profile/Runner及补丁验证通过，新/旧commit分别绑定2fcea75/b9fe801。旧cb0355b归档与失败快照未覆盖或改绑定。

13:24 JST从新归档包装器执行正式`-Mode Preflight`实际通过，包括真实Task/Host/PS7 Runner身份；生产仍是原run、READY、三端口及独立监测healthy，未出现backup.freeze。13:25 JST新快照内`Run-Approved-Upgrade.ps1`已打开可见PS7控制台（初始PID4980），回执`awaiting-native-approvals`，待本人真实挑战。新版本需要新哈希绑定普通许可，旧许可不代替；先验证再停止、安装/激活、恢复许可、READY，之后才限定清理许可与小缓存MCP验收。独立回退使用新候选归档包装器`-Mode Rollback`及本段三个路径、完整新/旧commit。

本次三处新release/暂存/快照合计35,634,645逻辑字节（约33.98MiB，不含小型测试夹具），没有安装或复制整套依赖。没有重扫磁盘、删除小缓存或5.636GiB候选。当前仍须根据本机窗口回执与现场状态确认生产结果，不能把预检通过记为正式升级成功。

### 上一轮准备与失败现场（历史）

本轮实测双pin为 `b9fe80150f9cdea47130e8952e85e39503187677`，run `d90f5e72-dd41-4ee4-9e2a-9eb3b0f490dd` 为ready；独立HealthMonitor持续记录healthy=true、唯一Host和7676/7677/18765，正式MCP返回12个项目。`preflight-login`实际approved=true，但开发入口`getApprovedProductionProfile('manager')`实际APPROVAL_DENIED。旧版本持久恢复许可不包含新版本部署，这是权限分离，不能改密文绕过。

旧`Tong024ProductionMaintenance.mjs`仍绑定024事故并保留MAINTENANCE_NOT_READY；本轮修复既有`Invoke-TongQuickTrustFullProduction.ps1` / `TongQuickTrustFullCutover.mjs`通道：显式旧/新commit、所有控制脚本字节绑定、正常stop-run让Runner/Host退出、增量源码快照、原生生命周期门、双pin/profile/App/Manager同步激活及独立Rollback。未强杀进程或复制整套运行态；OAuth/DPAPI/真实数据库原位保留。

gate先在快照内准备并持久保存物理身份回执，再不覆盖地原子移入run；中断可以续接。最终验证与移除gate在同一原生互斥内进行。未知gate、授权到期、快照/版本不符、进程或端口不明时拒绝继续。普通本机签名必须覆盖候选start/enable-agentdock/manager及原版本restore；安装后的固定恢复许可由用户通过正式Manager入口重新确认。

代码：`f46f425`为升级/清理授权修复；`8afb610`补Windows扩展路径解包，315字符回归通过。初次构建因262字符证据路径失败，残留`quick-trust-release-f46f425`只是部分源码归档，不能当恢复release；本轮保留不删。默认Git为硬链接，发布器拒绝；改用仓库测试原本使用的单链接Git，未降低检查。

`78f302b`补齐PS5对长路径的真实ACL枚举，仍核对owner/DACL/reparse，不修改ACL或系统设置；`cb0355b`修复停止证明的过期字节指纹并增加回归。最终候选绑定`cb0355ba4de216aa0ff712252df8041bad2edc11`；`8afb610`/`78f302b`为故障定位中间产物，不是当前生产pin。本轮保留这些精确产物供后续受管整理，未以删除掩盖失败。

### 最终候选和本机维护窗口（2026-10-28 02:49 JST）

- release：`D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-release-cb0355b`，完整build/verify通过，554个源码、23个native，归档文件合计23,112,231逻辑字节。
- 暂存：`D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-cb0355b`，源码与3份补丁的增量安装源；复用前次暂存，仅更新2文件。SDK是指向现有开发依赖的junction；不是完整npm恢复环境，不伪造release-restore-evidence。
- 小型回退快照：`D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-full-cutover-20261027174339358-177eb337`；原App/Manager各284个源码及必要补丁/pin/profile/Runner验证通过。旧快照尚未使用，仅将候选绑定由78f302b原子更新为cb0355b，并保留小型原元数据，不复制第二套旧源码。
- 从归档控制脚本执行正式包装器`-Mode Preflight`实际输出`PRECHECK PASS`，正式旧run健康，最终候选验证通过，无生产变更。
- 上述快照中的`Run-Approved-Upgrade.ps1`已由PS7解析并打开本机真实控制台。`native-window-result.json`只记脱敏阶段；`awaiting-native-approvals`不代表批准或部署。必须等真实挑战完成并现场验收。窗口内升级成功才申请限定清理许可，再建立小缓存；不删除大候选。
- 若需独立回退，使用同一归档`Invoke-TongQuickTrustFullProduction.ps1 -Mode Rollback`，带本节release/candidate/snapshot和完整ExpectedCommit/ExpectedOldCommit；当前原版本为`b9fe80150f9cdea47130e8952e85e39503187677`。普通批准过期会要求本人续签，不能清gate或修改密文。

本轮6处明确发布/暂存/快照产物元数据合计90,245,564逻辑字节（86.06MiB，含前述失败/中间产物，跳过1个SDK junction，不含小型测试夹具）。没有重新安装或复制整套node_modules。维护窗口初始阶段为`awaiting-native-approvals`，随后在Runner身份检查处失败，见本节顶部最新记录；未替用户输入挑战、未正式切换、未授予state清理许可、未执行小缓存或大候选删除。

## 2. 验证与未完成项

- 10项针对性测试通过：清理授权、原清理器、Quick Trust、升级绑定、原生升级gate、增量安装/回退、原维护租约、MCP元数据、Gateway、PS升级包装器；另有长路径、readiness、脱敏诊断测试通过。
- 真实隔离`Test-TongLoginRecoveryLifecycle.mjs`通过三组件启动、重复启动拒绝、故障恢复、私有Job清理及撤销后拒启。复用开发依赖；夹具为`D:\Tong\state\b23-login-c98d197c33354b2e8a303853c6076805`，不是生产验收。
- gate测试覆盖回执落盘后中断/续接、第二控制器拒绝、释放后回退新一代gate；增量回退测试在小夹具实际执行生产函数，覆盖部分/完整安装还原与额外用户文件保留，不冒充正式任务切换。
- `Test-TongProductionProfile.mjs`、`Test-TongLoginRecoveryAuthorization.mjs`本次在Windows PowerShell 5.1脚本安全策略拒绝处失败；没有降低策略/断言，也不计为通过。
- **生产升级、新工具正式发现、持久清理许可、正式MCP小缓存删除仍待本机批准及实测**；不得根据以上测试预先记成功。

## 3. 一次性限定清理授权

部署后使用`D:\node\node.exe D:\Tong\runtime\releases\manager\scripts\TongCleanupControl.mjs grant-state`，用户在本机真实控制台确认。开发源码入口不能颁发正式许可。独立非凭据许可保存在`D:\Tong\app\runtime\disk-cleanup-grants.json`，ID=`tong-state-cleanup`；`tong_list_projects`返回cleanupScopes。`revoke-state`可撤销；revision变化/撤销后旧Plan拒绝。project.write不再隐含递归删除权，也不因此授予Shell、Agent或一般state写入权。

许可只覆盖state内规定缓存和两类有匹配保留release的历史候选。执行重验路径、链接、pin、任务/服务/进程直接引用及归档；两类候选都核验完整源码，temp须为空，node_modules逐文件与保留依赖一致，三份DevSpace补丁按历史release哈希核对。数据库、凭据、Git、独有文件拒删，无法确认引用或差异也拒绝。

本轮只建立`D:\Tong\state\cleanup-acceptance-20261028\npm-cache`微型独立缓存，通过正式认证MCP执行Plan→Execute；核实目录消失、父目录保留，审计含路径/类别/依据/文件数/逻辑字节/时间/结果，Tong READY、三端口、Host/Supervisor/Guardian与独立监测正常。此验收未完成前不能声称可从网页直接清理。

## 4. A类：下一轮逐项Plan的精确候选

沿用[第三批源码与归档审查](Tong-Disk-Cleanup-Batch3-QuickTrust-Review-20261028.md)：2,765源码文件、250归档文件已核验，实物仍在。新版依赖逐文件规则**没有冒充已对十套实物验收**；下一轮只有Plan成功且deletionAuthorized=true才Execute，拒绝项转B核查，禁止改用Shell绕过。

| 精确路径 | 历史逻辑字节 |
| --- | ---: |
| `D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-5362210` | 605,318,136 |
| `D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-d780561` | 605,293,288 |
| `D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-024d5b0` | 605,275,611 |
| `D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-1a78e48` | 605,266,938 |
| `D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-4ebdbc3` | 605,246,372 |
| `D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-7d11382` | 605,154,390 |
| `D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-376a328` | 605,135,958 |
| `D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-37dc649` | 605,101,901 |
| `D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-d9983bb` | 605,043,710 |
| `D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-candidate-0a2da3c` | 605,010,647 |
| 合计 | **6,051,846,951（5.636GiB）** |

对应`quick-trust-release-同后缀`原位保留，staged-app/staged-manager不在名单。预计升级并授权后可由Tong直接删，当前未有正式执行证据。前两批已删除1,584,629,549逻辑字节不重复计入收益；NTFS实际释放量需另按现场空闲空间记录。

## 5. 增量盘点及B/C类

2026-10-28约02:05 JST仅扫描已知缓存和根目录命名元数据，未重扫五根约258万文件或读取私人正文。以下均无普通读错误，可靠物理占用未取得，记UNKNOWN。

| 目标 | 逻辑字节/文件/子目录 | 分类与依据 |
| --- | --- | --- |
| `C:\Users\Rune\AppData\Local\npm-cache` | **1,900,919,770 / 123,774 / 11,205** | 新大头约1.770GiB，含_cacache/_logs/_npx/_prebuilds，跨项目共享。**B**：尚须活动消费者、独有内容和离线恢复审查；不是Tong重复副本，不在state授权内。 |
| `C:\Users\Rune\AppData\Local\Temp\tong-session-coordination-nLN98w` | 9,712 / 1 / 0 | **C**：会话协调残留可能仍有用途，收益极小，本轮不清会话。 |
| `D:\Tong\development\test-temp` | 131,210 / 20 / 34，跳过1个reparse | **B**：当时失败夹具快照，后续测试已增加内容，不能当最终实时总量；按精确夹具处理，不跟随junction。 |

D根目录命名匹配tong/agentdock/devspace/mcp仍只有原五根，没有发现额外大项目根。新增主要大头为C盘共享npm缓存，不能加到旧43.622GiB后声称全部可删。

**B迁移整理**：`D:\tong-desktop-control`本轮只读Git仍50项tracked修改/13项untracked；`D:\tong-codex-acceptance-20261010`在main、2项untracked；另有`D:\agentdock-poc-20261010`、`D:\tong-agentdock-local`。四根约4.90GiB是旧快照，未冒充本轮重算。独有refs/未推送commit、dirty/untracked、原生Session cwd、projectId和恢复状态未保存映射前不能删。

**C必须保留**：当前App/runtime/tools、双pin指向release、共享主仓库.git/node_modules及worktree、配对Quick Trust release、当前和上一个实测恢复版本、授权/DPAPI/OAuth/数据库/会话/事故原件。新候选和小型回退快照在升级验收前保留，不能根据Disabled/test/old名称通配清理。

## 6. 下一轮顺序与长期目录管理

1. 先完成生产升级、清理许可和小缓存正式验收。下一ChatGPT先调用`tong_list_projects`核对cleanupScopes，随后按十条路径逐个`tong_disk_cleanup_plan({projectId:'tong-state-cleanup',path})`→Execute。记录回执、目标消失和release保留，批末检查健康、C/D空闲空间；无需重新扫全盘或让用户逐批粘贴删除脚本。
2. 再定向审C共享npm缓存及npm/npx活动、各类别恢复条件。它需要独立精确本机授权与AppData支持，不能直接扩大state许可或绕过保护；本轮未删。
3. 四旧根按计算器→旧Tong源码→PoC→旧AgentDock运行态依次处理；建议目的地分别`D:\Tong\development\acceptance\tong-codex-20261010`、`D:\Tong\development\legacy\tong-desktop-control`、`D:\Tong\archives\legacy-agentdock-poc-20261010`、`D:\Tong\archives\legacy-agentdock-local`。同卷移动不释放容量，不复制新环境。
4. 每根先保护所需Git refs和未提交原创文件，检查敏感历史后才同步适当GitHub；仅推HEAD会漏dirty。OAuth/DPAPI/数据库/私有日志不上传。保持projectId的受管root更新、同原生Session迁移/续接尚无本轮已验入口，必须先闭合，writer冲突不清锁、不换会话冒充。
5. 复用旧报告引用索引，精准核对脚本默认值、Windows任务Execute/Arguments/WorkingDirectory、服务、环境变量和MCP注册。只更新该根必要引用；本机正式许可后才搬迁。迁后验收同projectId/同Session和读写/启动，失败同卷移回并恢复引用。正式App/runtime保持原位。
6. 最后按锁、ABI/native补丁和无消费者证据删除重复node_modules/venv；开发共享依赖和生产依赖保留。其他state大根沿用已有容量索引，审精确子目录。

保持development/app/runtime/state/tools分区语义；archives仅收独有小源码/文档和必要本地恢复材料，不存几十套依赖。测试优先复用隔离夹具、共享不可变依赖并单独保留少量需改DevSpace文件；锁/native变化才建独立环境。正常只保留当前、一个实测回退版本、一个待验候选，其余进入受管审查。成功测试沿用finally清本次临时目录；失败先留精确路径/小诊断，再据marker/引用/独有数据退役。自动清理应接明确测试/发布收尾，不装广泛定时删除；此自动收尾扩展尚未实施，不能声称已启用。
