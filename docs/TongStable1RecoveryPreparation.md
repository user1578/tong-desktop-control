# Tong 1号版本恢复准备（2026-10-25）

> 最新恢复路线见 [当前Windows最小操作单](TongCurrentWindowsRecovery.md)：先保留原版2号，通过原生门槛后受控保留旧锁/事故原件，正式Task自行启动；不继续WinRE/方案B。本文的1号验收证据继续有效，下文现场状态属于当时观察。

> 本文保留接手提交 `9850e1a80912ec18d80112544a7ab524d4798365` 的原始验收结论；其中“尚无新备份/中断回退验收”的状态已由 [一次性离线恢复操作单](TongStable1OfflineRecovery.md) 更新。原有原生验收未重复；生产仍为 NOT READY，未执行回退。

**NOT READY。1号原版在当前 Windows 隔离环境可运行；生产回退条件尚未具备，禁止执行生产回滚。** 本轮仅修改指定开发分支的验收测试和本文，生产只读。停止扩展方案B和3号，不部署5362210，不修改main。

## 版本和交付范围

| 编号 | 完整 Git SHA | 用途 |
| --- | --- | --- |
| 1号 | `37dc649c46ad0e267c3471f750b97227cf106310` | 本次唯一恢复目标 |
| 2号 | `024d5b0920d9ad8f1a2baf2e55640a5666ad4739` | 当前生产故障现场，失败时须完整恢复的原像 |
| 3号 | `24431b263ab1bc6ec17cca48f82245f72f197d4c` | 历史实验候选，本轮不扩展、不部署 |

接手开发提交 `8c9b4ff0afd3da57c7a3410abad3b498269a4c39`，分支 `codex/024-maintenance-adapter-20261024`，开始时工作区干净。交付提交SHA以Git和最终回复为准，不把开发HEAD当作产品发布。

本机 `D:\Tong\state\production-upgrade-37dc649-20261020.json` 的后续记录为 `upgraded-and-folder-trusted`，details绑定1号、runId `317fe367-5803-459e-8c53-24d586347888`。此前记忆只记录到待授权阶段，不能代替此后续记录；该标记本身也不能替代本轮运行验收。历史 quick-trust-full-cutover 保存的是升级前 a1b56b3 原像，不能作为1号包。

## 1号精确发布摘要

复用原始独立发布 `D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-release-37dc649`，重新执行完整release校验，并用 `git ls-tree` 与 `git hash-object` 逐项对照精确提交：**270项源码全部匹配Git blob；23项原生文件摘要全部匹配**。没有重新打包或安装依赖，没有修改1号源码。

| 绑定 | 值 |
| --- | --- |
| releaseDigest | `164f740171b8094133893dc8f0cc1ca2f60eb82b191d54b3607391b1eca63ed0` |
| source.tar SHA256 | `c6393648f73e188a0194bc7bcaa28c2ca03c1a4f7283f3b46da5864d8a179d9e` |
| Node | `D:\node\node.exe`，v24.15.0，ABI137，win32/x64 |
| Node SHA256 | `3331e1ffe19874215472217c5e94f5a0c6d8e18c4ac7111d3937aa0ad5e9b4a5` |
| 依赖版本 | DevSpace1.0.8、MCP SDK1.32.1、better-sqlite3 12.11.1、node-pty1.1.0 |
| DevSpace pi-tools.js | `d6f47e98e061217ded7e9df070a8d6db3d252eaafce258ca97e0d08071b5e13e` |
| DevSpace server.js | `3728cb946e8dc9f48bdb8d5adf4f878b537023543140df51d1aa2bc49d26f3ef` |
| DevSpace workspaces.js | `544ac1ae6bd15f6177ff269c5d5918763d2821e83421de54e435df4233ca418a` |
| AgentDock独立二进制 | `D:\Tong\runtime\agentdock\agentdock.exe`，SHA256 `bc1a7a35f1985e9f7827142577fc31bd4ca536e27252b08fc28c5ed636cf5e8d` |

原release文件合计16,629,737字节。现有候选 `quick-trust-candidate-37dc649` 仅提供精确旧补丁字节，最终安装仍按release清单和摘要验证。SQLite原生模块实际加载且内存库integrity_check=ok，node-pty模块加载成功。

## 当前 Windows 原生隔离验收

复用已保护且已停止的隔离根 `D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a`。其旧源码、补丁、profile和run原件保存在 `stable1-20261025\previous-*`；未删除旧证据、未修改ACL，未复制完整依赖树。按1号清单安装App和Manager，归档不属于1号的旧源码，分别验证双pin及完整源码/原生/补丁。

| 验收 | 实际结果 |
| --- | --- |
| App / Manager | 均逐项验证为1号，270源码/23原生 |
| 第一次实际start | 退出0，ready，runId `84a19177-7be1-4ee7-8b75-b58aa1b89f0a` |
| doctor | 退出0，healthy=true；AgentDock认证MCP成功，7个后端工具 |
| Gateway | 未认证401；真实OAuth/PKCE、initialize、tools/list成功 |
| MCP基础文件操作 | 通过Gateway实际open_workspace/write/read，并与磁盘内容核对；文件只在隔离demo-workspace，留作证据 |
| 第一次正常停止 | 退出0，stopped，remainingPids=[] |
| 正式Task→Host→runner | 真实新任务 `Tong024Acceptance-88ca27ee-e599-4482-b849-7c96923272fb`；两轮完整通过，非直接启动runner替代 |
| 两轮健康与重启 | `db23672d-7b27-4a0e-b0e4-39d3607432e4`、`a29eee9c-fe4f-44e5-8715-c756cc6f7a04`；初始healthy、IgnoreNew、周期doctor真实进程身份及退出0、另外doctor healthy、正常停止、任务退出0 |
| Codex原生会话 | 1号原版adapter真实新建并完成文本回合；同一session `01a17206-0dea-7f92-b28c-b0e1fd47483d` 续接完成，随后原生会话发现成功 |
| ChatGPT真实客户端/公网连接 | **未验收**；本轮是相同Gateway协议的本地SDK文件读写，不能称ChatGPT UI/公网连接已通过 |
| 真实Windows重启及登录恢复 | **未执行**；本轮没有整机重启授权，也没有生产回退 |

Codex测试直接调用1号原版adapter，不是Gateway→任务授权broker全链路验收。原生新会话完成文本为 `TONG_STABLE1_NATIVE_NEW_OK`，续接为 `TONG_STABLE1_NATIVE_RESUME_OK`。组合脚本首次共用120秒预算，首次新会话完成后续接被中断，退出1；随后仅对同一会话进行有独立120秒预算的定向续接，完成并退出0。保留第一次失败，没有扩大超时、替换会话或修改1号适配器。较高延迟及原生错误事件的根因未定位。

**1号工具差异必须保留**：Gateway精确契约为28工具；DevSpace注册29工具，其中 `tong_project_prepare` 被1号Gateway过滤。原3号通用测试因此退出1，新1号测试按已经核实的原版Gateway完整28工具名单逐项断言，并实际验证文件操作。旧测试未放宽，1号源码未修补；goal类工具在1号中也不存在。

### 外部运维组件单独绑定

1号产品内的Host仍是原PS5.1版本。隔离正式任务使用开发分支已有PS7 Host源码编译的**外部运维产物**，并仅给其子进程设置相邻 `temp` 的TEMP/TMP；保持 `-File`，不覆盖执行策略。产品App/Manager和pin中的Host/runner源码保持1号原字节。

- 本次外部Host：`monitor-88ca27ee-e599-4482-b849-7c96923272fb\TongLoginHost.exe`，SHA256 `28d5db5e41d7ea079550d04377f383dc858dd126f57ce9a1b1f51cea00d33718`。不可用历史11aff7b3摘要代替本次编译产物。
- 原版runner SHA256：`2a32d46a7307f088a827e06dbe81d85ee35ab2153e19cc85f3f69778c642684b`。
- 隔离runner只替换root和SID mutex名字，SHA256 `3ec77353194814c3b91f86bee4aca1853d23004d433f62a587ab1a0e87b45ab9`。正式root对应的原版runner须重新单独绑定，不能把隔离副本部署生产。
- 当前有效策略CurrentUser RemoteSigned，PS7 7.6.6。沿用既有PS5区域判断/Temp故障诊断，未重复策略负测；本轮补齐的是1号实际Task启动和重启正向验证。没有改全局策略、区域标记、证书、ACL、凭据或用户TEMP。

## 2号现场与业务兼容性（只读）

App及Manager当前均验证为2号：283源码/23原生；双pin摘要均为 `482906d969ad9576b3de59e68df4d988898dc10f461d673231ac650d3dd892dd`，profile摘要 `ab96bbad1d41db71451bb86f4e55f67f21dbdc1a935f4ede7d80f98bac81ca35`。

现场phase=abnormal_exit、Supervisor/Guardian均不存活。已记录10个进程身份消失，三个事故run的owner/launcher/guardian/runtime Job均为0，7676/7677/18765无监听。旧Guardian缺少containment，失败run缺少Launcher回执；这些原件不能补造。`backup.freeze`仍是原零字节文件；`maintenance-transaction.json`仍为failed，摘要 `76089ce806f4b12a01fe05cb435ff95e1b792475583dfb4367b84eb7edb15473`。未删除、重命名或覆盖生产freeze及事故文件。

正式 `TongLoginRuntime` Enabled/Ready，0实例，LastTaskResult=1，XML SHA256 `925671f84b50311377cdb2585eeadf3f87548e7de0124d786729321a0694a4f3`。未发现生产Host/runner。ngrok为Running/Auto，PID40452；exe/命令行不可读，完整库存仍返回SECURITY_UNAVAILABLE，不把SCM PID当作完整身份。历史MONITOR_FAILED原因保持UNKNOWN。

纠正精确提交比较：1号与2号的Runtime、Security、Guardian、Launcher、Login Host/runner、生产profile/授权/业务备份源码逐字节相同；`TongStartupProtocol.ps1` 在两个原版中均不存在，不能将“两个文件不存在”算成相同blob。原版没有开发分支新增的Launcher终态回执/containment断言。单独替换为1号仍需安全处理现场freeze，但缺失新增格式的证明不能直接判定原版无法启动。两版均使用 `open(backup.freeze,'wx')`，不能借用3号Handoff协议；本轮原版2号状态恢复的正向实测及限定交接见最新操作单。

业务只读结果：1号项目注册解析器接受当前11项注册；1号可信授权策略解析器接受当前3个development grants；29个任务满足1号任务文档谓词，当前queued/running=0。4个goal中2个blocked，1号不支持goal supervisor，应完整保留文件并停止自动续接，不删改或转换。OAuth SQLite用readonly连接检查integrity=ok，27个schema对象。前后业务文件及数据库摘要相同。**这只是读取/格式兼容性，不是当前真实业务快照在1号下的恢复执行验收。** 1号release/profile不同，生产生命周期授权必须由用户在本机重新精确绑定，不能复制模拟授权或篡改旧密文。

## 完整备份、独立回退与单次离线方案

**本轮尚未生成当前2号现场的完整密封备份，尚无验收通过的1号生产执行/独立完整回退命令。** 旧快照不能冒充新备份。现有生产备份需要原生授权、停机证明并取得freeze；当前旧freeze及不完整库存仍阻止安全进入。没有通过新脚本绕过这些前提。

固定一次维护窗口的最低备份集合如下；只做清单不能声称备份已经存在：

| 集合 | 必须密封的内容 |
| --- | --- |
| 2号产品原像 | App/Manager全部源码、23项原生、3个DevSpace补丁、包锁/版本、实际依赖恢复资源、精确Node及AgentDock文件与摘要；候选新增/移除清单 |
| 绑定与权限 | profile、production-root、双pin、runtime-permissions全部DPAPI密文及索引、登录恢复授权/撤销记录、有效期与SID绑定；不输出明文 |
| 业务状态 | app/runtime全部状态及journal、goal-supervisor、项目/可信策略、AgentDock backend-state、tong-policy、tong.config.json、用户DevSpace config/auth、OAuth DB及WAL/SHM；保持最新令牌轮换状态，不直接覆盖旧DB |
| 控制与监控 | run全部原始控制/事故记录、freeze原字节和文件身份、事故事务/历史证明、Host/runner、任务XML、恢复预算/撤销及日志、ngrok服务定义/配置的受保护备份 |

备份须在第一次产品写入前Flush、密封清单并固定摘要；由独立新进程验证全部文件、缺席项和CurrentUser DPAPI可恢复性。恢复演练须覆盖业务原路径应用/失败恢复，而不只解密到新目录；不能只恢复Git代码、profile或gate。任务预计累计新增超过1GB时需先另行说明并获得明确资源授权，不能复制多套依赖规避限制。

一次性离线执行顺序已经限定，**以下为待补齐门禁的操作说明，不是已可执行脚本**：

1. 固定工具提交、1号release/外部Host摘要、2号现场清单、新备份seal、窗口期限及允许的失败回退范围。只读前后核对全部身份、Job、端口、任务、ngrok、文件身份及摘要；未知即停止。
2. 用户在本机可见ConsoleHost亲自完成精确profile的backup/restore/manager/start/stop、AgentDock状态及登录恢复授权。聊天批准不能替代DPAPI原生挑战。生产实施及服务窗口另需明确批准。
3. 受控暂停正式触发及停止监控；持续持有已审查的原生独占。密封原始freeze/run/事故事务，不能通过删除或改名freeze来放行普通start。**原版1号不能借用现有持续gate，兼容的离线交接尚未验收；停在此处，不安装。** 不扩大建设维护平台，也不静默给1号打补丁。
4. 只有独占和独立完整回退均已通过1号专属演练，才按全部清单安装App/Manager、依赖及原生、补丁、profile/双pin和单独管理的Host/相邻temp；重新原生校验授权和摘要。
5. 安装中断、启动失败、提交状态不明、Job/进程/端口未知、seal/授权失效时保持停机与独占；独立新进程只恢复固定2号原像。恢复2号事故现场不等于恢复健康服务，禁止自动宣称ready或清除原事故。已提交健康服务不能被旧控制进程自动回滚。
6. 1号自身Manager验App/Manager、ready/doctor/AgentDock/Gateway后接唯一正式Task。再由ChatGPT实际连接完成OAuth和批准目录的文件读写，经Tong任务授权broker验证原生Codex新建/续接。完成正常停启及健康周期后，另经用户批准进行真实Windows重启和登录；重启后ready且doctor健康才叫恢复完成。

**ngrok必须单列批准**：仅一次窗口内由有服务控制权限的操作员保存原状态，`Stop-Service -Name ngrok`；30秒内证明Stopped、旧进程消失且完整库存可读，否则停止。结束时 `Start-Service -Name ngrok`，核对服务身份、隧道、OAuth和认证MCP。最坏影响是公网隧道中断；失败保留原配置/证据，恢复原服务状态。不得kill不可读PID或更改服务账户/ACL。本轮未执行这两条服务命令，不请求服务批准。

当前缺少：与原版1号兼容的持续独占交接、当前现场新密封备份、1号安装中断/原事故受控归档演练、独立新进程完整恢复2号（含真实业务状态应用）、ngrok完整库存。历史3号639项隔离回滚只能作为已有组件证据，不能冒充这些1号结果。**所以本轮不提供会修改生产的恢复命令，不开放旧恢复脚本。**

## 可复核入口、失败和收尾

本次测试入口位于本开发分支 `tests/Test-TongStable1Isolation.mjs`、`Test-TongStable1Gateway.mjs`、`Test-TongStable1FormalMonitor.ps1`、`Test-TongStable1Native.mjs`。均绑定固定隔离根；不是生产恢复器。prepare只允许无freeze且已证明静默的原fixture，使用新证据目录，不能重复覆盖旧证据。原始证据保留在 `stable1-20261025` 及上述monitor目录，摘要/结果见 [机器证据](evidence/stable1-recovery-20261025.json)。

保留的失败：旧Gateway通用清单断言退出1（多要求project_prepare）；首次正式任务探针prepare退出1（调用者命令行含隔离root被库存正确识别），改为固定路径wrapper后完整两轮退出0，没有忽略未知进程；原生组合预算中断退出1，后同会话定向续接退出0；首次最终身份检查遇元数据未知而退出1，未执行清理，随后专门诊断对全部记录身份返回null，最终独立库存/Job/源码检查通过，最初未知原因仍UNKNOWN。所有失败均未归为生产MONITOR_FAILED根因。

隔离最终任务Disabled/0实例、授权撤销；最终停止证明、Job/身份和源码复核见机器证据。生产前后88项控制文件集合摘要应始终为 `ff89b0cba58e6ce1ddffd95ebfbe0a92fb6ca2f6acb753417db3a2c4dabb2642`。

最后仅为测试入口收紧固定参数/原fixture版本断言，完成Node语法、PS7解析及参数拒绝验证；没有因此重复冷启动或原生会话。既有640项证据含保留原像约6.57MB；未新建依赖副本。此体积不是整个历史隔离目录或Codex自身日志的总量。

成功后的清理和正式 `docs/Tong-Recovery-Handoff.md` 按用户要求延期：只有生产获批恢复、真实重启验收稳定后才扫描列出临时脚本/隔离目录/失败候选/重复备份/日志，重要文件删除前单列。生产数据、有效授权、唯一回滚备份、原事故证据、Git历史不可删除。正式交接须记录事故经过、最终运行版本、实际恢复过程、所有原生结果、Git SHA、备份位置、实际清理、未解决问题和后续研发计划；不能把本准备报告当作恢复成功交接。

当前交付提交推送后停止，等待ChatGPT最终复审；不申请或执行生产回退。
