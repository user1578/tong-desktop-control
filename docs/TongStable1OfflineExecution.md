# Tong 1号恢复：最后实施准备

接手 `3f6dabdaf51a737d3336f37e956c7839b23b897a`，2026-10-25。唯一目标为 2号 `024d5b0920d9ad8f1a2baf2e55640a5666ad4739` → 原版1号 `37dc649c46ad0e267c3471f750b97227cf106310`。3号 `24431b263ab1bc6ec17cca48f82245f72f197d4c` 停止开发；不部署5362210。

**实施 NOT READY；本轮没有生产写入、停任务、服务操作或重启。** ChatGPT 已通过上一轮密封备份、77,485项影子回写、安装中断和独立文件回退的复审；本轮只补离线可行性与操作资料，不重做这些测试。

结论：生产 Windows 完全停止后，在独立维护系统中完成全部文件安装/回退，能够避开生产进程、Job和启动入口的竞争；这是本次优先路线。**本机还没有通过维护系统实际引导、C:/D:解锁及读写能力验收**，当前会话不能查询 BitLocker/WinRE 的必要管理员信息。不能据此发出 WinRE 复制或生产移锁命令。Windows PE 支持在 Windows 未运行时维护它，但 PowerShell、BitLocker属于需确认的能力。[Microsoft WinPE](https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/winpe-intro?view=windows-11)

## 最小阻塞与人工下一步

1. 操作员在**同一台机器、管理员可见终端**执行下面两条只读查询，确认 C:、D: 的加密/解锁情况及 WinRE 是否启用、实际位置。恢复密钥是否可用由本人本地确认；不要发到聊天、日志或Git。当前错误分别为 `manage-bde -status` 需要管理员、`reagentc /info` 返回5。未改用提权/绕过手段。
2. 获得后续维护窗口批准后，用可信的维护 Windows/介质实际启动，先只读确认磁盘、两个卷、现有影子/发布/审查包都可访问，并确认有可运行的 PS7/校验工具及既有ACL访问能力。**这次实际启动当前也未获执行授权。** 原生产Windows必须停止运行；进入普通Windows的另一个用户会话不等于离线。

```powershell
# 仅查询；不启用/禁用/解密BitLocker，不修改BCD/WinRE。
& 'C:\Windows\System32\manage-bde.exe' -status
& 'C:\Windows\System32\reagentc.exe' /info
```

若已有WinRE不能提供所需工具/驱动/ACL访问，最小替代是现成、可信且可实测的维护Windows，或由操作员把完全关机后的原盘接到另一台可信Windows进行离线维护。先验证访问，再决定是否实施；不为此现场下载不明工具、修改ACL、重建WinRE或搭建新维护平台。仅发现 Recovery 分区/ReAgent.xml 不能证明可引导；本机没有发现已连接的外部维护盘，也未发现默认ADK WinPE安装目录，是否有其他可用介质仍需本人确认。

## 已核实的磁盘及权限边界

| 项目 | 本机只读结果 |
| --- | --- |
| 系统 | Windows 11 家庭版中文版，build26200，Normal boot；PS7 7.6.6 |
| 当前令牌 | 非管理员；未要求提升、未改权限/策略 |
| 物理盘 | 仅发现磁盘0，SAMSUNG NVMe，GPT；C:/D:在同一物理盘 |
| 磁盘GPT GUID | `{b4ca51ed-af2a-4307-a968-a26e0e447d25}` |
| 原 C: | 分区3，GUID `{357c8b50-3db5-49b7-abcd-a2b1d8daf5d7}`；offset290455552，size608241524224 |
| 原 D: | 分区5，GUID `{bfd9746d-1cf8-4f5a-9332-3d38c641818d}`；offset609474314240，size383662424064 |
| 文件系统 | C:/D:均Healthy NTFS，簇4096字节 |
| BitLocker | **UNKNOWN**；正常Windows中已挂载可读不证明另一启动环境能解锁 |
| WinRE | ReAgent.xml存在并指向恢复分区；`/info`无权限，未引导验证 |

维护系统中的盘符可能改变。按GPT磁盘/分区身份、offset/size、NTFS卷身份及Tong标志文件共同确认，不按“看到D盘”判断。审查包里的绝对路径是**原生产路径**，不是已确认的维护系统盘符。C:上还有用户DevSpace配置、OAuth DB/WAL/SHM及PS7；只恢复D:不能称完整回退。[Microsoft盘符说明](https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/winpe-identify-drive-letters?view=windows-11)

维护环境先执行只读探测：`ver`、检查 `%SystemRoot%`、查询 `HKLM\SYSTEM\CurrentControlSet\Control\MiniNT`，再用其已验证的磁盘工具核对上述身份及卷挂载。MiniNT只是PE证据之一，不能单独作为文件写入许可。不得执行diskpart的clean/format/delete、assign/attributes变更或修改启动配置。工具不足、映射含糊、卷锁定或ACL拒绝时停止；不能takeown/icacls或更改BitLocker保护来继续。是否允许在可信维护介质上做一个小的文件操作自测，应在该维护窗口单列，不触及生产卷。

## CurrentUser DPAPI、1号授权与首次启动

本轮在原用户正常登录的Windows中只读解开了既有备份manifest，以及61份生命周期权限和1份登录恢复权限，失败0。只报告授权元数据，没有输出凭据/密文解密结果，也没调用会追加授权审计的运行入口。

- 3份历史1号生命周期权限全部过期，最后到期 `2026-10-20T11:01:41.773Z`（日本时间20:01:41）；当前可用1号start权限为0。
- 当前登录恢复权限可解密、enabled=true、未见撤销，但**版本描述不匹配1号**，不能沿用为1号许可。
- 用1号发布内原始profile模块验证了拟安装profile，digest/SHA256均为 `101cb3556b725b1ef115023b1160a3ee56070549f814eff483a61f6ad3a6a1a4`。这是待安装资料，未写入生产，也不是新授权。

离线维护只重放文件和不透明授权密文；它不能续期旧授权或代替原账户登录。备份的CurrentUser DPAPI解密依赖原用户/原机器；不能把WinRE/SYSTEM、另一台机器的管理员或同名新账户当成原用户。原OS、原用户配置和DPAPI密钥不在本次修改范围内；不重置密码、不导出主密钥、不移植用户。返回原Windows正常登录后再检查DPAPI并完成1号原生挑战。[Microsoft DPAPI](https://learn.microsoft.com/en-us/windows/desktop/api/Dpapi/nf-dpapi-cryptprotectdata)

## 已生成的固定审查包

```text
D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\offline-9850e1a\offline-last-3f6dabd
```

仅新增7个文件、18,329,255字节（约18.3MB），没有复制完整文件树、重新备份或导出AES密钥/IV。目录沿用既有私有ACL，没有设置ACL。含真实路径元数据，**只保留本机，不提交/上传审查包内容**。

| 文件 | 用途/摘要 |
| --- | --- |
| baseline-files.json | 原2号77,485条记录、14组原路径、内容摘要及原文件身份；不含文件数据/密钥。SHA256 `0919d91a7be189bfe974e1b363bdb56169998029f574fdc96c9edb2cc88c015f` |
| install1-order.json | 固定1号来源、目标组和摘要；597项写入、26项移出活动树保留，无删除。SHA256 `87d764207b27b0c025e2ed6006e77101afe7681b60a7bd0ec14852d19768714e` |
| profile1.json | 拟安装profile，摘要见上；原路径、端口、AgentDock开关保持原定义 |
| TongLoginRuntime.original.xml | 原正式任务XML，SHA256 `925671f84b50311377cdb2585eeadf3f87548e7de0124d786729321a0694a4f3` |
| TongLoginRuntime.disabled.xml | 任务/触发器均停用的内存派生定义，仅作恢复暂存资料 |
| TongLoginRuntime.original.sddl | 原任务owner/group/DACL，SHA256 `386b37a5c89241ce4c4632483209a8152b656cc3a5db421b2913e4e0bf7ee46d` |
| summary.json | 本轮非敏感检查结果，状态仍NOT_READY |

包没有离线写入器，`executable=false`、`actualOfflineDriveMapping=null`、`productionWriteAuthorized=false`。它固定了供复审的文件操作，不会自行解除安全门禁。原密封备份和完整影子位置继续使用 [上一轮操作单](TongStable1OfflineRecovery.md)，seal仍为 `db00d0725d89b0141ae31d972b9d96800a2c53d7c2dd9d2876a467c71a273e8f`。影子包含真实业务数据/授权密文，只作数据来源，不能直接启动。

已做轻量一致性检查：全部记录路径留在固定14组；写入目标无重复；26个移出项都对应原2号文件及摘要；新增活动路径为0；1号双pin/profile及正式runner绑定正确；91项业务/策略/授权/OAuth记录在前向清单中不变；安装清单不包含freeze写入。**这不是新增的真实离线安装/回退验收**。

## 一次性安装顺序：待现场映射、工具与批准闭合后实施

| 顺序 | 固定操作 | 已验证 / 现场要求 |
| --- | --- | --- |
| 0 | 检查交付Git SHA、包摘要、密封备份seal、原盘身份、容量、1号release和外部Host | 资料/摘要本机已核验；介质/解锁/映射待现场 |
| 1 | 原Windows中受控停止正式Task，保存当前Enabled/触发器/实例/原生身份，Task设Disabled；单列ngrok窗口 | 本轮仅查询；这些是待批准生产操作 |
| 2 | 完整关闭原Windows，进入可信维护系统；核对没有启动/恢复原Windows，两个卷可访问且无链接/ACL异常 | **待实际引导**；不以休眠/快速启动恢复或另一个登录会话替代 |
| 3 | 只读比对baseline文件集合及摘要，尤其业务/OAuth/授权/控制/监控；验证影子实际来源文件摘要 | 上轮全影子通过；正式写入前仍须现场防止快照漂移；有差异即停，不自动重备份 |
| 4 | 在原D卷保留原事故证据及新候选被移出文件；原freeze持续存在，核对原FileKey `3025126315:89915392:3025673` | 原件未动；离线归档尚未执行。不能使用影子freeze的FileKey |
| 5 | 按install1-order逐项安装App/Manager源码、原生、3个旧补丁；保留26个2号独有源码，不删除依赖/业务树 | 已有隔离中断/完整安装证据；真实离线工具/文件写入尚未验证 |
| 6 | 写1号双pin和profile1，独立安装外部PS7 Host及正式原版runner；校验全部摘要 | 资料及源字节已验证；生产写入未执行 |
| 7 | 安装全部校验成功后，在**原Windows仍停止时**受控归档原run事故控制记录及原freeze，保持同卷原文件身份；留下完整可逆清单 | 待批准的离线提交点；不能遗漏abort/request/guardian/启动证明，不能补造Launcher回执；发生异常就恢复原件并回退 |
| 8 | 保持正式Task停用，回原Windows由原用户登录；检查1号App/Manager、DPAPI、原生进程/Job/端口及Host绑定，再做本机原生批准 | 未执行；出现意外Host/runner/监听或权限错误就停止，不能重复普通start碰运气 |
| 9 | 仅启用唯一正式Task→Host→runner，ready/doctor、AgentDock、Gateway/基础MCP、真实ChatGPT读写和Codex会话验收 | 原1号隔离验收已接受；生产真实连接待执行 |
| 10 | 稳定后真实Windows重启并登录，复核Task/ready/doctor | 未执行；通过才叫恢复完成 |

离线期间没有生产Windows内的启动入口能竞争原gate，因而不再用“枚举完121个包装入口”作为文件替换独占的替代证明。该结论依赖**真正启动到维护系统且原Windows不运行**；当前未验证该前提。首次回到原Windows的授权/任务/未知进程仍需检查，不能提前称READY。

外部组件：Host SHA256 `28d5db5e41d7ea079550d04377f383dc858dd126f57ce9a1b1f51cea00d33718`；正式runner使用1号原字节 `2a32d46a7307f088a827e06dbe81d85ee35ab2153e19cc85f3f69778c642684b`，root本来就是正式路径，不用隔离runner。相邻 `login-management\temp` 由已有Host仅对子进程指定TEMP/TMP；产品内源码、RemoteSigned和全局TEMP均不改。正式部署位置运行尚未验证。

## 独立回退到2号：不依赖当前Manager

回退数据：原密封备份、已验证完整影子与 `baseline-files.json`。实际回写须在已验证的维护环境中由**独立新进程/操作员**执行；现有 `RestoreIsolation/RestoreShadow` 都绑定隔离路径，不能改参数或改源码后直接指向生产。

1. 任何写入失败、校验不符或状态不明，保持原Windows停止。不要启动Manager来“完成事务”。若已回原Windows，先按授权受控停机，再回维护系统；不能边运行边完整覆盖业务/授权库。
2. 校验审查包锚定摘要，映射两个卷，逐项核对影子恢复来源。按baseline完整恢复14组原像，包括所有App/Manager依赖、profile/双pin、授权密文、业务、用户配置及OAuth三件套、日志/控制、Node、AgentDock与监控；只恢复gate不算回退。
3. 活动树中不在baseline的候选新增文件移至同卷独立保留区。按组限定范围，binding只覆盖profile/production-root，node/ngrok只覆盖清单明确文件，不能把整个runtime、D:\node、D:\Tong\state或C:\Users用户目录当成镜像删除目标。保留本窗口新增审计和事故证据。
4. freeze单独恢复**原物理文件**：未归档则保留原件；已归档则从本次同卷归档清单移回并复核原FileKey。不能从影子/备份生成空文件冒充原件。恢复全部2号字节、完整文件集合及profile/pin，仍保留原事故状态。
5. 回原Windows的原账户，核对必要任务对象。通常原任务对象没有被改写，只需恢复原触发器/Enabled状态；原XML/SDDL用于对象丢失或损坏的例外。保持Task停用直到原像/身份核验完成。具体恢复方式见下节。
6. ngrok按原Auto/LocalSystem配置及窗口前状态恢复。2号原像仍有原freeze/事故记录，因此**回退成功只表示回到原故障现场**，不宣称服务健康。1号曾经开始产生的新业务/令牌状态先独立保留；不得未经本窗口数据回退授权丢弃，外部OAuth服务器状态也不能靠本地文件还原。

没有创建未经验证的WinRE复制器或执行型生产恢复入口。离线介质验证未闭合时，上述是精确的待执行清单，**不是可立即运行的生产复制命令**；当前不提供robocopy /MIR、注册表TaskCache修改或“删锁再start”的捷径。

## Windows任务：已验证范围与恢复命令边界

正式任务 `TongLoginRuntime`：当前Enabled/0实例，LogonType=3（InteractiveToken）、RunLevel=0、IgnoreNew=2；一个登录触发器和一个无参数Exec，路径 `D:\Tong\runtime\login-management\TongLoginHost.exe`，工作目录 `D:\Tong\runtime`。原用户已登录时运行，不需要导出/补填任务密码。[Microsoft TaskFolder.RegisterTask](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskfolder-registertask)

原始及停用版XML已调用原生 `TASK_VALIDATE_ONLY=1` 验证成功；没有注册任何任务，原XML及SDDL前后相同。该标志只验证XML，不创建/更新对象。[Microsoft TASK_CREATION](https://learn.microsoft.com/en-us/windows/win32/api/taskschd/ne-taskschd-task_creation) **真正的注册/缺失对象重建没有在本轮执行，SDDL应用权限仍需现场验证。** 不手工复制 `C:\Windows\System32\Tasks` 或修改离线注册表TaskCache。

以下仅供**批准后、原Windows/原账户**的例外任务恢复复审，不是本轮执行命令。先核对上述XML/SDDL摘要及Task已无实例；操作员需具有原任务注册和原SDDL恢复权限，不能扩大DACL。flags=`0x3e`表示原生创建/更新+停用+不新增principal ACE+忽略注册触发器。

```powershell
$caseDir='D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\offline-9850e1a\offline-last-3f6dabd'
$expectedTaskHash='925671f84b50311377cdb2585eeadf3f87548e7de0124d786729321a0694a4f3'
$expectedSddlHash='386b37a5c89241ce4c4632483209a8152b656cc3a5db421b2913e4e0bf7ee46d'
if((Get-FileHash -LiteralPath (Join-Path $caseDir 'TongLoginRuntime.original.xml')).Hash.ToLowerInvariant() -cne $expectedTaskHash){throw 'Task source changed'}
if((Get-FileHash -LiteralPath (Join-Path $caseDir 'TongLoginRuntime.original.sddl')).Hash.ToLowerInvariant() -cne $expectedSddlHash){throw 'Task security source changed'}
foreach($pinName in @('release-pin.json','manager-pin.json')){if((Get-FileHash -LiteralPath (Join-Path 'D:\Tong\runtime\run' $pinName)).Hash.ToLowerInvariant() -cne '482906d969ad9576b3de59e68df4d988898dc10f461d673231ac650d3dd892dd'){throw 'Version2 restoration not confirmed'}}
$service=New-Object -ComObject Schedule.Service
$service.Connect()
$folder=$service.GetFolder('\')
$existing=@($folder.GetTasks(1)|Where-Object Name -eq 'TongLoginRuntime')
if($existing.Count -and @($existing[0].GetInstances(0)).Count){throw 'Task still running'}
$definition=$service.NewTask(0)
$definition.XmlText=[IO.File]::ReadAllText((Join-Path $caseDir 'TongLoginRuntime.original.xml'))
$definition.Settings.Enabled=$false
for($i=1;$i -le $definition.Triggers.Count;$i++){$definition.Triggers.Item($i).Enabled=$false}
$originalSddl=[IO.File]::ReadAllText((Join-Path $caseDir 'TongLoginRuntime.original.sddl'))
$principalId=$definition.Principal.UserId
$originalSid=if($principalId -match '^S-1-'){$principalId}else{([Security.Principal.NTAccount]::new($principalId)).Translate([Security.Principal.SecurityIdentifier]).Value}
if([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -cne $originalSid){throw 'Original user required'}
$restored=$folder.RegisterTaskDefinition('TongLoginRuntime',$definition,0x3e,$originalSid,$null,3,$originalSddl)
```

此暂存任务及触发器均Disabled；核验原action、SID、InteractiveToken、RunLevel、IgnoreNew与SDDL后，恢复**原XML的登录触发器/Enabled定义**，不能只把这个停用副本设Enabled就称自动登录恢复。最终原定义注册使用原XML及同一SDDL、flags=`0x36`（无TASK_DISABLE）；或保留原任务对象时仅恢复此前记录的Enabled状态。仍需现场批准和实际验证，不能把validate-only说成注册恢复已通过。任何权限拒绝即停，不更改权限继续。

## ngrok单独窗口与首次原生启动

ngrok仍Running/Auto/LocalSystem，当前PID40452；普通令牌无法读取完整进程身份。所需是**既有管理员身份的查询/服务Stop/Start权限**及原生进程查询能力，不能修改服务账户、DACL、启动类型或凭据。

批准后的顺序：保存原服务状态/配置摘要 → 查询完整原生身份 → `Stop-Service -Name ngrok -ErrorAction Stop` → 30秒内Stopped且旧身份消失 → 关闭Windows进入维护 → 完成安装或回退 → 原Windows启动时核实Auto服务实际状态（可能已经自动Running，不能盲目再次start） → 必要时 `Start-Service -Name ngrok -ErrorAction Stop` → 核对新身份、隧道、OAuth/MCP。停止失败或身份未知则不安装；恢复失败保留配置/证据并报告，不kill不可读PID或改服务权限。

1号安装核验后，本人在原Windows可见PS7 ConsoleHost完成以下**正式已安装1号**入口的原生挑战，不重用过期凭据，不代填：

```powershell
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoLogo -NoProfile -File 'D:\Tong\runtime\releases\manager\scripts\TongProductionApproval.ps1' -Mode approve-login-recovery
& 'D:\node\node.exe' 'D:\Tong\runtime\releases\manager\scripts\TongAgentDockRuntime.mjs' preflight-login --root 'D:\Tong\runtime'
```

登录恢复挑战是原生的**持续、精确版本绑定**授权，直到本人撤销或版本改变；与一次性维护实施批准分开，原生界面会说明范围。它不授权部署、Shell/Codex项目任务或权限扩大。本轮没有触发此挑战。正式Task首次运行、正常停启、真实连接及最后Windows重启均待实施；不重新开发运行平台。

## 复核入口、证据与本轮收尾

只读重查（会在原用户内存中读取权限元数据，不写生产）：

```powershell
Set-Location -LiteralPath 'D:\Tong\development\tong-024-startup-recovery'
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoLogo -NoProfile -NonInteractive -File '.\scripts\Prepare-TongStable1OfflineReview.ps1'
& 'D:\node\node.exe' '.\tests\Test-TongStable1OfflineReview.mjs'
```

`-EmitPrivatePacket`已经执行一次，再用该开关会拒绝覆盖现有包。该包只准备资料；本轮没有实施权限。非敏感机器证据见 [本轮证据](evidence/stable1-offline-feasibility-20261025.json)。最终生产只读复核 `2026-10-25T12:25:32.459Z`：App/Manager仍2号，88项受控文件摘要仍 `ff89b0cba58e6ce1ddffd95ebfbe0a92fb6ca2f6acb753417db3a2c4dabb2642`；原freeze/事故/缺失回执均未变。

未来生产批准须明确：一次2号→1号的文件替换和失败原像回写；影响两个卷的指定Tong/用户状态、指定Task/ngrok及短时停机；属于既有恢复目标的实施；最坏是持续停机/需回原2号故障现场；只覆盖一次维护窗口。介质启动验证和任务注册/服务控制权限分别列明。登录恢复原生持续授权另外由本人确认。当前只交付审查资料、提交推送后停止；成功后再做真实连接、Windows重启验收、清理及正式交接文档，不删除事故原件。
