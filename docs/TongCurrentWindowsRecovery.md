# Tong：当前 Windows 的最小恢复操作单

2026-10-25，接替 WinRE/复杂离线路线。**生产未修改；本文件供复审和下一次明确批准后的单次维护使用，不能直接当成实施授权。** 不部署开发分支、3号或5362210，不继续维护平台。

当前优先保留原版2号，只处理运行状态和外部登录 Host；若原版正常安全检查仍拒绝，停止并保留现场，再决定是否安装原版1号。不是承诺2号历史故障已修复。

| 编号 | 精确提交 | 本轮角色 |
| --- | --- | --- |
| 1号 | `37dc649c46ad0e267c3471f750b97227cf106310` | 已验收的旧稳定版，保留完整发布作后备 |
| 2号 | `024d5b0920d9ad8f1a2baf2e55640a5666ad4739` | 当前完整 App/Manager/profile/双pin；先尝试状态恢复 |
| 3号 | `24431b263ab1bc6ec17cca48f82245f72f197d4c` | 历史实验，停止开发和部署 |

## 代码结论与纠正

精确 Git 比较：1号→2号共28个文件，增加2465行、删除41行。产品改动集中于任务进度/Goal监督、Codex Desktop链接、MCP工具及Gateway集成、Windows通知；其余为测试和交接文档。

| 范围 | 精确比较结果 | 与事故的关系 |
| --- | --- | --- |
| `TongAgentDockRuntime.mjs`、Guardian、Launcher、Security（mjs/ps1） | 1号和2号逐字节相同 | 没有证据通过回退这些文件改变启动/清理规则 |
| Login Host源码、runner、LoginRecovery、ProductionProfile/Approval、RuntimeBackup | 1号和2号逐字节相同 | 两者都需处理同一个现场锁及外部PS7/TEMP问题 |
| `TongStartupProtocol.ps1` | **两个原版都不存在** | 开发分支新增文件，不能冒充原版依赖 |
| Gateway/AgentTasks/McpTools/Codex/Goal通知 | 有实际差异 | 是未来定向调查范围；未证明导致历史 MONITOR_FAILED |

原版2号 `startRuntime` 先验证授权和两套完整候选，随后独占创建 `backup.freeze`（`wx`），再检查旧运行及 `guardianComplete → oldRuntimeGone`。原版要求 finished Guardian、jobAssigned、关联的原始 Supervisor、实际旧身份消失、命名Job为空和端口空闲；**没有开发分支的 Launcher终态回执/`create_process_job_list`新增断言**。不会补造缺失回执或删除原始request/abort。

历史 `MONITOR_FAILED` 的根因仍 **UNKNOWN**。10月23日两次 `CLEANUP_REQUIRED` 是已发生的拒绝，不能无证据认定其原因就是新Goal代码，也不能认定今天原版2号仍必然拒绝。保留旧gate时的实测拒绝为 `RUNTIME_BUSY`。本轮原版2号在隔离副本受控保存旧gate后，保留旧控制记录即可实际ready、doctor健康和正常停止。

**不采用直接启动后由任务接管的路径**：本轮该演练中直接启动健康，但任务查询为stale_record并拒绝reconcile-stale；已正常停止，不能称为接管通过。最终只考虑正式 Task→Host→runner 自行启动，使用原版正常安全检查。此项与历史生产 MONITOR_FAILED 分别记录。

## 现场绑定与已有保障

- 生产 App `D:\Tong\app`、Manager `D:\Tong\runtime\releases\manager` 仍绑定2号；283源码/23原生文件。profile SHA256 `ab96bbad1d41db71451bb86f4e55f67f21dbdc1a935f4ede7d80f98bac81ca35`；双pin均为 `482906d969ad9576b3de59e68df4d988898dc10f461d673231ac650d3dd892dd`。
- 原freeze物理FileKey `3025126315:89915392:3025673`；原事故run `74cd4ad3-f21b-40ec-96f5-3f9015649e5d`，失败请求 `bee3d9d4-1dd9-4ed6-80d1-07a2b7e11bdd`、`d348ae39-27cf-4167-8e35-58de75421309`。88项受控文件集摘要仍为 `ff89b0cba58e6ce1ddffd95ebfbe0a92fb6ca2f6acb753417db3a2c4dabb2642`。
- 原版2号正式Manager只读 `preflight-login` 已实际退出0：approved、stopRunSupported、loginRecoverySupported均true。现有2号原生登录恢复授权有效；不续签、不更改密文、不使用模拟授权操作生产。
- 正式任务 `\TongLoginRuntime`：当前Enabled、0实例、LastTaskResult=1；原路径指向 `runtime\login-management\TongLoginHost.exe`，InteractiveToken、LUA、IgnoreNew，登录触发及3次/1分钟重试。无需改任务Action、账户、触发器、SDDL或重建TaskCache。
- 当前外部生产Host SHA256 `0d516bb5b26686b8ab2f0c3b1022beba7f48f8ad23e57a60e690cde9bdfc0c3b`；runner SHA256 `2a32d46a7307f088a827e06dbe81d85ee35ab2153e19cc85f3f69778c642684b`，与原版2号一致。
- 经既有真实任务验证的PS7外部Host位于下列`$hostSource`，SHA256 `28d5db5e41d7ea079550d04377f383dc858dd126f57ce9a1b1f51cea00d33718`。它用PS7 `-File` 和仅子进程相邻TEMP；产品源码不变。当前PS7 7.6.6，有效策略RemoteSigned（本轮LocalMachine=RemoteSigned、CurrentUser=Undefined），无需改策略、区域标记、ACL、证书或凭据。

既有完整生产备份继续使用：

```text
D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\offline-9850e1a\production-6ac61ad1-c9e5-4d21-8142-af1c4aa59956
seal SHA256: db00d0725d89b0141ae31d972b9d96800a2c53d7c2dd9d2876a467c71a273e8f
```

77,485项/14组包含App/Manager、原生、用户配置、OAuth/业务数据、DPAPI密文、profile/双pin、控制记录、监控及任务/服务定义。既有完整影子回写及独立文件回退已获复审，详见[既有证据](evidence/stable1-offline-20261025.json)。本轮不重做全量备份/解压/影子回写。不要激活含真实数据的`production-shadow`，也不要把只允许隔离恢复的脚本改开关用到生产。

状态恢复不覆盖业务/授权/配置文件，不用历史快照倒灌当前数据。启动自然产生的业务/令牌变化应继续保留；恢复原控制记录不是恢复业务库到旧时间点。若真实业务数据确有损坏，应停机、保存新状态，另行批准使用完整备份，不能自动回写7万项。

## 单次窗口：原Windows、原用户，先门槛后写入

以下是有顺序的操作单，**不是可无人值守粘贴的脚本**。每个门槛实际核验后才进入下一块。当前不执行这些生产写入。

1. 用户批准一次状态修复窗口，限定：暂停唯一正式任务、原事故控制原件同卷保留及等字节工作副本、旧gate物理交接、替换外部Host、正式任务启动及失败恢复。App/Manager、profile、双pin、业务库、授权密文均不安装/回写。关闭用户正在发起的Tong操作；不得同时启动另一个恢复者/手动Manager。维护期不注销、不切换用户、不重启。发现其他生产Tong触发器/会话/运行者则先列明并停止，不假定121个不透明包装入口全部安全。
2. 单独完成下节ngrok管理员窗口。当前普通令牌无法证明LocalSystem ngrok进程身份，**完整原生库存仍未闭合**。管理员身份查询及Stop/Start权限是现存最小现场条件；不用WinRE/BitLocker检查来扩大前提。
3. 保存少量当前任务状态/XML到既有私有恢复根的新目录，禁用正式任务；本事故当前0实例。若此时有运行，先核实原生身份并通过正式Manager对精确run执行`stop-run`，等待任务正常退出。未知身份/不能正常停止则停在这里，不能强杀不可读PID、盲停所有node或删锁。

```powershell
$ErrorActionPreference='Stop'
$repo='D:\Tong\development\tong-024-startup-recovery'
$runtime='D:\Tong\runtime'
$manager=Join-Path $runtime 'releases\manager\scripts\TongAgentDockRuntime.mjs'
$ops='D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\offline-9850e1a'
$window=Join-Path $ops ('production-state2-'+[guid]::NewGuid())
$hostSource='D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\monitor-88ca27ee-e599-4482-b849-7c96923272fb\TongLoginHost.exe'
$scheduler=New-Object -ComObject Schedule.Service
$scheduler.Connect()
$task=$scheduler.GetFolder('\').GetTask('TongLoginRuntime')
if(@($task.GetInstances(0)).Count){throw '先核验并正常停止现有任务，不能继续归档'}
$null=[IO.Directory]::CreateDirectory((Join-Path $window 'original'))
[IO.File]::WriteAllText((Join-Path $window 'task.before.xml'),$task.Xml)
$task.Enabled=$false
if($task.Enabled -or @($task.GetInstances(0)).Count){throw 'TASK_NOT_PAUSED'}
# 仅在发现已核验存活运行时使用；RUN_ID必须来自本次status，不能使用历史PID猜测。
# & D:\node\node.exe $manager stop-run --root $runtime --run-id RUN_ID --login-recovery --error-json
```

4. 在同一个交互式PS7进程持有正式SID生命周期互斥，设置仅本进程TEMP到本窗口私有目录；调用既有只读审计器（文件名仍含PlanB，但此入口只读，不执行方案B恢复）。必须App/Manager verified、所有旧身份GONE或已核验PID重用、三组全部Job=0、完整库存且matching count=0、无Host/runner、端口7676/7677/18765无监听、Task仍禁用无实例。当前生产审计不能作为维护时新鲜证据。若失败则恢复服务/任务的原状态前先确认不会自动启动冲突，保留事故不动。

```powershell
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$mutex=[Threading.Mutex]::new($false,('Local\TongLoginRuntime-'+$sid))
try{$held=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$held=$true}
if(-not $held){throw 'LIFECYCLE_MUTEX_BUSY'}
$null=[IO.Directory]::CreateDirectory((Join-Path $window 'temp'))
$env:TEMP=Join-Path $window 'temp';$env:TMP=$env:TEMP
$auditText=& D:\node\node.exe (Join-Path $repo 'tests\Test-Tong024PlanBProductionAudit.mjs')
if($LASTEXITCODE -ne 0){throw 'AUDIT_REFUSED'}
$audit=$auditText|ConvertFrom-Json
if(-not $audit.inventory.complete -or $audit.inventory.count -ne 0 -or
   @($audit.native.listeners).Count -or @($audit.native.monitors).Count -or
   @($audit.identities|Where-Object state -in @('UNKNOWN','ALIVE')).Count){throw 'STOP_PROOF_INCOMPLETE'}
foreach($job in $audit.jobs.PSObject.Properties){foreach($n in $job.Value.PSObject.Properties){if($n.Value -ne 0){throw 'JOB_NOT_EMPTY'}}}
if($audit.controlledFileSetSha256 -cne 'ff89b0cba58e6ce1ddffd95ebfbe0a92fb6ca2f6acb753417db3a2c4dabb2642'){throw 'INCIDENT_CHANGED'}
if($task.Enabled -or @($task.GetInstances(0)).Count){throw 'TASK_CHANGED'}
& D:\node\node.exe $manager preflight-login --root $runtime --error-json
if($LASTEXITCODE -ne 0){throw 'LOGIN_APPROVAL_REFUSED'}
```

5. 核对原gate普通文件/单链接、原FileKey、全部run文件和原Host摘要；只保留小的事故原件和Host，不复制整个项目。保持原gate存在并以share-read句柄持有；将每个run普通文件（**双pin和gate除外**）同卷移动至`$window\original`，立即在原路径创建字节相同的工作副本，逐项校验。日志/failed维护事务保持原位置，既有密封备份保留原事故全貌。此操作保护原runtime/guardian/request/abort/stop/budget/reconciliation等，不清空任何状态，不伪造证明。记录原件名称/摘要/物理FileKey，遇新文件或摘要漂移立即停止。此原件保留算法已由固定隔离测试验证，见下节；正式执行前逐项使用本窗口新鲜审计绑定。
6. 正式Task仍禁用无实例、旧身份/Job/库存/端口仍满足门槛时，将原Host移动到`$window\original\TongLoginHost.exe`，把已核验`$hostSource`复制到原Host路径；runner完全不改，SHA仍为`2a32…684b`。留存新增Host/相邻temp/log路径清单，以供失败时移出活动目录保留。**这是外部运维组件变更，不能声称2号或1号产品源码已修复。**
7. 最后释放只读gate句柄，把**同一个物理gate**移动到`$window\original\backup.freeze`并验证仍为原FileKey，记录交接时刻。该动作只在旧启动安全门槛全部已满足且维护独占成立时允许；不能单独执行`Rename-Item backup.freeze`放行。原事故控制的等字节副本留在活动run中，原版2号仍须自己通过cleanup检查。不能清空request/abort、伪造Launcher、改Guardian或把phase改stopped。

第5–7步的具体文件操作如下，必须继续在上述持锁进程中执行。先核对每条路径所有父级均无reparse point、单链接和私有目录权限沿用既有保护；不修改ACL。此代码块仅供审查，**本轮没有在生产执行**。如中途失败，不执行下面的任务启动块；保留旧gate和已移原件，按失败节处理。

```powershell
Add-Type -TypeDefinition @'
using System;using System.IO;using System.Runtime.InteropServices;
public static class TongState2File {
 [StructLayout(LayoutKind.Sequential)]struct Info{public uint a,c1,c2,t1,t2,w1,w2,v,s1,s2,links,i1,i2;}
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetFileInformationByHandle(IntPtr h,out Info f);
 public static string Key(string p){using(var s=File.Open(p,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)){Info f;if(!GetFileInformationByHandle(s.SafeFileHandle.DangerousGetHandle(),out f)||f.links!=1)throw new Exception("FILE_ID_UNAVAILABLE");return f.v+":"+f.i1+":"+f.i2;}}
}
'@
function Hash([string]$p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
$run=Join-Path $runtime 'run';$gatePath=Join-Path $run 'backup.freeze'
if([TongState2File]::Key($gatePath) -cne '3025126315:89915392:3025673'){throw 'ORIGINAL_GATE_CHANGED'}
if((Get-Item -LiteralPath $gatePath).Length -ne 0){throw 'GATE_CONTENT_CHANGED'}
$hostPath=Join-Path $runtime 'login-management\TongLoginHost.exe'
$runnerPath=Join-Path $runtime 'login-management\TongLoginRuntime.ps1'
if((Hash $hostSource) -cne '28d5db5e41d7ea079550d04377f383dc858dd126f57ce9a1b1f51cea00d33718'){throw 'NEW_HOST_CHANGED'}
if((Hash $hostPath) -cne '0d516bb5b26686b8ab2f0c3b1022beba7f48f8ad23e57a60e690cde9bdfc0c3b'){throw 'OLD_HOST_CHANGED'}
if((Hash $runnerPath) -cne '2a32d46a7307f088a827e06dbe81d85ee35ab2153e19cc85f3f69778c642684b'){throw 'RUNNER_CHANGED'}
$before=@{};foreach($f in Get-ChildItem -LiteralPath $run -File){$before[$f.Name]=@{sha256=(Hash $f.FullName);fileKey=[TongState2File]::Key($f.FullName)}}
[IO.File]::WriteAllText((Join-Path $window 'control-originals.json'),($before|ConvertTo-Json -Depth 4))
$gate=[IO.File]::Open($gatePath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
foreach($name in $before.Keys){
 if((Hash (Join-Path $run $name)) -cne $before[$name].sha256){throw 'CONTROL_CHANGED'}
 if($name -notin @('release-pin.json','manager-pin.json','backup.freeze')){
  $original=Join-Path $window ('original\'+$name)
  [IO.File]::Move((Join-Path $run $name),$original)
  [IO.File]::Copy($original,(Join-Path $run $name),$false)
  if([TongState2File]::Key($original) -cne $before[$name].fileKey){throw 'ORIGINAL_ID_CHANGED'}
 }
}
foreach($name in $before.Keys){if((Hash (Join-Path $run $name)) -cne $before[$name].sha256){throw 'WORKING_COPY_CHANGED'}}
[IO.File]::Move($hostPath,(Join-Path $window 'original\TongLoginHost.exe'))
[IO.File]::Copy($hostSource,$hostPath,$false)
if((Hash $hostPath) -cne (Hash $hostSource)){throw 'HOST_INSTALL_FAILED'}
# 再运行第4步只读审计及全部原生门槛；此时Host摘要已按清单变化，
# 不再把全体88项摘要要求为旧值。除此之外不得出现未列明变化。
# Task仍Disabled/0实例，端口空闲，身份/Jobs/完整库存均通过后：
$gate.Dispose();$gate=$null
if([TongState2File]::Key($gatePath) -cne '3025126315:89915392:3025673'){throw 'GATE_ID_CHANGED'}
[IO.File]::Move($gatePath,(Join-Path $window 'original\backup.freeze'))
if([TongState2File]::Key((Join-Path $window 'original\backup.freeze')) -cne '3025126315:89915392:3025673'){throw 'GATE_ARCHIVE_ID_CHANGED'}
```
8. 释放控制者SID互斥，由唯一正式Task的原runner取得它并自行启动原版2号；产品Manager使用原来的`wx` gate。**不宣称跨两个进程持续持有同一mutex/gate**；该窄交接依赖已暂停的入口、不进行产品/业务安装、唯一正式Task及正常Manager的互斥门禁。任何竞争者取得新gate、出现未知新run/进程或`RUNTIME_BUSY/CLEANUP_REQUIRED`就停止，不能再次移锁或自动回写原件。

```powershell
# 只有上述原件保存、Host安装及gate交接实际核验后才执行。
$mutex.ReleaseMutex();$held=$false
$task.Enabled=$true
$startedAt=[DateTime]::UtcNow
$instance=$task.Run($null)
# 180秒内观察：唯一Task EnginePID→已核验Host→PS7原版runner；
# 本窗口之后的runtime_healthy和ready属于同一新runId，双pin仍为原2号。
& D:\node\node.exe $manager status --root $runtime --error-json
& D:\node\node.exe $manager doctor --root $runtime --login-recovery --error-json
# 人工核对这两个命令退出0、同一新runId、ready/healthy，以及Task原生父子身份。
# 保存这个已核验的runId用于失败停止，不能用后来任意读取的替代运行冒充它。
```

9. 实际ready、doctor.healthy=true和唯一任务健康监控完成后，恢复ngrok并检查隧道。随后才做ChatGPT真实连接/文件读写、Codex原生调用；验证过程用专用验收文件和会话，不覆盖真实文件。三次自动恢复预算不清零，不用循环反复试启动。外部连接不通过或监控再次失败，停止并分析本次新日志，不把本地doctor等同于外部验收。

本操作单的原生FileKey检查和故障分支须由已获批的本地执行者逐项执行；**本仓库没有新建生产移锁器/自动回退器**，不能拿只作用于隔离根的测试直接指向生产。该人工交接边界供复审明确接受或拒绝；若要求覆盖未知任意直接写入者或不间断同一个kernel gate，则当前原版方案不具备，停止而不扩展框架。

## ngrok单独授权和顺序

ngrok当前Running/Auto/LocalSystem，PID40452；普通令牌不能读取完整exe/creation identity/命令行。最小人工步骤是本人在现有管理员PS7可见终端做查询/停止；不需改服务账户、启动类型、DACL或凭据。只记录身份和配置摘要，不能打印ngrok配置内容/令牌。

```powershell
# 管理员窗口；执行写操作仍须先获本次生产窗口授权。
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoLogo -NoProfile -NonInteractive -File 'D:\Tong\development\tong-024-startup-recovery\scripts\Tong024NgrokIdentity.ps1'
Stop-Service -Name ngrok -ErrorAction Stop
(Get-Service -Name ngrok).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(30))
Get-CimInstance Win32_Service -Filter "Name='ngrok'" | Select-Object Name,State,StartMode,StartName,ProcessId
# 确认原PID+创建时间身份消失；原用户窗口重新做完整库存，再进入事故交接。
# 成功或失败收尾均恢复维护前Running状态；仅当当前Stopped时执行：
Start-Service -Name ngrok -ErrorAction Stop
(Get-Service -Name ngrok).WaitForStatus('Running',[TimeSpan]::FromSeconds(30))
```

停止失败、服务重新出现、身份未知、原生库存仍不完整，**保持原事故锁，停止恢复**。恢复时先保留/恢复本地版本及控制现场，再恢复ngrok，最后恢复唯一正式Task的既定状态；失败回退到原事故时，Task保持Disabled至操作者确认安全，不能让原自动任务重试掩盖结果。不得用kill不可读PID替代服务控制。本轮未执行任何生产服务操作。

## 失败和1号后备

状态修复失败时先禁用正式Task，停止本次精确新run（正常Manager `stop-run --run-id NEW_RUN_ID --login-recovery`），等待Task正常退出。再次确认原生身份消失、相关Job=0、端口空闲并重新取得SID互斥；未知就停，不覆盖活动进程的数据或新gate。

```powershell
$task.Enabled=$false
# NEW_RUN_ID只允许填写本窗口已核验的运行；未取得精确身份时不执行。
& D:\node\node.exe $manager stop-run --root $runtime --run-id NEW_RUN_ID --login-recovery --error-json
# 35秒内Task实例归零；再执行第4步的完整原生检查并持锁。
# 此处不自动恢复文件：先核对新gate的所有者/运行，保留本次新控制文件。
```

将本次新run控制文件、Host和日志单独保留；确认不存在其他所有者的gate后，**先移回原物理gate及核对FileKey**，再把原控制原件逐项移回，移出的工作/新文件均同卷保留、无删除。恢复原Host字节并核对`0d516b…0c3b`；runner、App/Manager、双pin、profile、业务数据从未安装/回写。复核当前集合与原件清单，恢复ngrok。任务原XML留在本窗口，原定义不重建；是否重新Enabled由操作者在确认旧故障不会自动重试后决定。文件回退只表示回到原事故现场，不能称健康。原件缺失/第三方变化则停止，使用既有完整备份的独立恢复能力，不自动倒灌业务状态。

若需要1号：复用完整发布`D:\Tong\state\p27-autonomy-candidate-20261017\quick-trust-release-37dc649`，release摘要`164f740171b8094133893dc8f0cc1ca2f60eb82b191d54b3607391b1eca63ed0`（执行时以原验收清单核对，不能用旧a1b56b3快照）。只按已审清单完整替换App/Manager发布文件/原生及版本绑定，597写入/26项旧文件移出保留；不覆盖业务/OAuth/用户配置/项目授权。1号产品原样、PS7 Host外部单独绑定；原1号授权过期，必须本人重新完成绑定1号的原生挑战，不能沿用2号的持续授权。安装失败需按原已验收完整2号原像回退，不是只移回gate。本轮不授权或执行此后备安装，不重复大型矩阵。

## 证据、剩余验收及授权范围

本轮固定隔离测试：`tests/Test-Tong024StateOnlyRecovery.ps1`及Worker，只允许原受保护的production-simulation根；不接受生产目标参数，不调用生产服务。实际退出0，原版2号run `a2348f06-0cec-4ddd-86a3-181ec54ad903`达到ready/doctor健康；正式Task→Host PID26816→PS7 runner PID4400，正常停止及Task退出0；原gate物理身份和既有3625项隔离原像已恢复（只写变化项）。测试后13项事故原件摘要仍全部匹配；profile/双pin/产品未改。六个本轮案例/退役增量目录共84文件、1,118,176逻辑字节（不含Codex自身日志），没有大型树复制。实际结果及失败演练均见[本轮证据](evidence/024-state-only-recovery-20261025.json)。

最后生产只读复核 `2026-10-25T14:09:35.252Z`：App/Manager仍精确2号，10项旧身份GONE、三组四类Job全0、无监听/Host/runner，88项受控摘要未变；原freeze仍单链接、零字节且FileKey相同。ngrok仍PID40452 Running/Auto，完整库存仍SECURITY_UNAVAILABLE，**尚不能报告生产READY**。管理员ngrok窗口和新的现场门槛仍待执行；实际生产Task改动/Host替换/锁交接/启动及Windows重启均未执行。

实施批准应明确五点：允许一次上述状态/Host交接和失败恢复；影响指定run/外部Host/正式Task及单独ngrok停机；属于现有恢复目标，安装1号另作决定；最坏是持续停机并回原故障现场、未知身份时停止；仅覆盖这一次窗口，不含后续部署、业务倒灌、删除、权限/系统策略修改或Windows重启。

实际恢复成功后，再单独批准并完成真实Windows重启/原用户登录验收，记录内核启动时间变化、自动任务→PS7 Host→runner、ready/doctor以及真实ChatGPT/文件/Codex；通过后才判定恢复完成。之后列明重要删除项，再清理无用临时产物并在正式项目`docs/Tong-Recovery-Handoff.md`写事故时间线、最终版本、真实操作、验证、备份/清理结果和未解决问题。当前不清理、不提前写成恢复成功。
