# 七文件候选：单次生产恢复操作单（仅供复审，本轮未执行）

**READY FOR PRODUCTION REVIEW。不是生产执行授权，也不是生产已恢复。** 本轮只操作开发分支、新合成环境，以及用户单独批准复用的既有隔离 Task。正式 Task、ngrok、生产源码、原锁和真实凭据均未写入。

## 已闭合的准备条件

- 以原版2号完整源码和既有依赖/备份为基础，实际构建284源码/23原生文件的版本绑定；只新增共享协议并修改其余六个启动文件。原版其余277源码和23原生文件的包内 SHA256 与生产 pin 完全相同。生产 App/Manager 共612项源码/原生文件已只读核对匹配旧 pin。
- 既有隔离 Task 原生启动 Host→PS7 runner→Manager→Launcher→Guardian→Supervisor，新运行 `06c00e3b-dee2-43b7-b68c-595ced0b7f97` READY、doctor健康、定期doctor原生退出0。Launcher/Guardian均实际执行生产专用 preflight-login，分别8.554/8.477秒，退出0。正常停止、精确身份消失、四类Job为0、Task返回0并恢复Disabled。
- 旧运行74cd、旧失败bee3/d348、最新失败be3分别检查。复用 LegacyRecovery 事务，保留8项关键控制的物理原件，完成归档→回退到原物理身份→再次归档；be3原始request/abort哈希及无回执事实不变，四组共16项Job观察为0。没有补旧回执、containment或phase。
- 停机环境中 App半安装、Manager半安装、错pin均拒绝；14个测试源码物理原件恢复，双组件重新匹配同一版本。未运行新恢复平台或生产安装器。

隔离 Task 的账户解析到当前同一SID，InteractiveToken/LUA/IgnoreNew与正式语义相符。测试使用其既有5分钟执行上限和手动Run入口，没有验证真实登录触发、正式Task本体、真实用户配置/授权/业务数据、外网ChatGPT连接或Windows重启。两次早期监控断言失败来自测试观察器：CIM微秒精度与原生100ns精度差异，以及未拥有的Process对象ExitCode为null。已独立用非Tong子进程复现，最终复用已有原生句柄观察器验证；不能把这些测试错误写成生产根因。

## 固定交付物与字节绑定

| 对象 | 固定值 |
|---|---|
| 复审起点 | `69aba15451e1c2374291fdfe6af1e53037e43819` |
| 原版2号 | `024d5b0920d9ad8f1a2baf2e55640a5666ad4739` |
| 本地精确七文件候选对象 | `3740082b3c11ca4403d1abdceed75d539878a161` |
| 仅固定根重定位的测试对象 | `61dbb317b3cba84ed4499fb9d3435d717f46c175` |
| 精确候选source.tar SHA256 | `fc03213b58a9b050ba84502fe990b98b3d54866fdf603930113eb3f0ca16dea3` |
| 精确release-manifest SHA256 | `ebd4f21fe831bc4e4cd8ff2db553a22cfd7c09341e94d0ce33427db977dfd750` |

本地发布物：`D:\Tong\state\b23-login-70f1b7d66215458c8ffa0d822348de0f\seven-file-release`。本地候选Git对象没有另建/推送分支；不能把该SHA当作GitHub可直接访问的提交。GitHub复审使用本分支交付的清单、69aba七文件补丁和本次证据；完整源码归档及受保护的完整发布物留在本地。

七文件规范化代码与69aba完全相同。Git archive按本仓库设置输出CRLF；**实际安装必须比较 INSTALL-MANIFEST.json 的 packagedSha256，不能用69aba的LF摘要冒充实际字节摘要。** exact候选的源文件与归档已由既有verifyRelease实际校验一致。测试发布物与精确发布物的源码差异仅为Launcher/Guardian内正式根/Supervisor的固定路径重定位；其余282项源码及全部23原生文件逐字节相同。新生产profile仅改sourceDigest/releaseDigest，私有准备文件位于该隔离根的`review-production-profile.json`，未写入生产、未签发生产权限。

## 未来窗口必须先取得的批准

之前状态恢复窗口仅覆盖原版2号状态和外部Host，不能自动扩大为本次代码安装。未来需在Codex聊天中明确批准一次精确候选窗口，再由本人在可见本机控制台完成原生挑战：

1. 允许安装上述七文件到App和Manager、重绑定profile/双pin、受控退役旧活动控制记录、切换已验证PS7外部Host、启用唯一正式Task及失败回退。
2. 影响范围仅为下述精确源码、绑定、外部Host和恢复授权；不安装1号或开发分支，不覆盖业务库/用户配置/OAuth数据，不改Task定义、ngrok配置或系统安全设置。
3. 这是新批准的生产安装范围；本轮准备和旧窗口均不构成它的授权。
4. 最坏情况为启动失败并保持停机。先证明新树清理完成，再恢复旧代码/绑定和事故原件；未知身份、非空Job、竞态或证明不完整时保持Task关闭，不强制放行。
5. 写入授权限单次窗口。既有原生approve-login-recovery入口签发的是与该版本绑定、持续到撤销或版本改变的恢复权限，必须由本人另外阅读并输入挑战；它不授予部署、Shell、任务修改或其他项目权限。

不要后台提权或依赖不可见弹窗。若管理员只读库存确需管理员令牌，先在聊天给出准确动作，让本人在已打开的管理员PS7执行；本轮不执行。

## A. 静止现场和回退材料

在原Windows、原用户、一个可见PS7控制台中操作。正式Task必须Disabled/0实例；若情况不同，先识别并正常停止精确运行，不进入安装。使用既有SID生命周期mutex `Local\TongLoginRuntime-<当前SID>`，持续持有至最终交给正式Task。旧物理gate仍在原位置，并以share-read句柄持有。使用[旧操作单](../../TongCurrentWindowsRecovery.md)已审查的单链接/reparse/ACL/FileKey检查，不更改ACL。

旧物理gate预期 `3025126315:89915392:3025673`、空文件。当前旧控制以新鲜清单为准，必须与上次失败收尾已恢复的16项原件逐项匹配；`control-originals.json`和旧失败窗口索引仅作锚点，不代替新鲜观察。

已有完整2号备份继续作为保障：

```text
D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\offline-9850e1a\production-6ac61ad1-c9e5-4d21-8142-af1c4aa59956
seal.json:      db00d0725d89b0141ae31d972b9d96800a2c53d7c2dd9d2876a467c71a273e8f
payload.aes:    7f5a5bb2ec8d757af19834f5797777303cba0ffd3aecc4a58bdfa872af381208
manifest.dpapi: 495bec397f7143d91c635e379d26614b29b241a87ab23b82b2d8f64f369934f1
```

本轮只重新核对上述三项密文/封存哈希，没有解密、重做77,485项备份或重复完整回写。未来窗口另保留小型新鲜增量：六个旧源码×两组件、两个pin、profile、原始控制、外部Host及将被替换的恢复授权密文原件。全部记录SHA256、大小和物理FileKey，放在同卷受保护窗口目录；不显示密文内容，不上传。源文件、控制和旧gate物理原件同卷移动保留；不将业务库或全日志目录纳入自动回退。

## B. 四组运行的独立停止证明

必须在安装前、退役前、放行Task前实际重核：

```text
74cd4ad3-f21b-40ec-96f5-3f9015649e5d  旧完成运行
bee3d9d4-1dd9-4ed6-80d1-07a2b7e11bdd  第一次失败
d348ae39-27cf-4167-8e35-58de75421309   当前恢复后的活动旧request
be3f5c49-d824-4edd-b8fc-7ee70d7f9a00  最新无回执失败，独立failed-attempt目录
```

旧Guardian的runId/nodePid/finishedAt/jobAssigned/jobName/killOnClose/active0与旧Supervisor一致；所有记录中的身份逐个按PID+exe+creation ticks证明原身份消失。允许已证明的PID重用，不允许UNKNOWN当GONE。全部四组owner/Launcher预检/Guardian预检/Runtime Job为0。

用既有只读审计和runtimeProcessInventory核对正式root、App、Manager、Host/runner/Launcher/Guardian/Supervisor/不带runId的旧preflight入口；库存必须complete、matching=0，无监听7676/7677/18765、无监控和其他启动入口。Task仍Disabled/0，控制文件无变化，mutex仍归当前窗口。观察应新鲜，任何超时/不可读/漂移均停止，不用本轮隔离结果填充生产布尔值。

be3原件固定在旧失败窗口`failed-attempt`，request/abort属于同一be3且时间有序；缺失Launcher/Guardian终态回执继续记录为缺失。四组Job空和完整当前库存只支持**受控退役旧活动槽位**，不证明历史上未创建Guardian，也不生成否定创建回执。此目录及事故物理gate原件不参与版本覆盖。

ngrok若Running且管理员已证明完整身份/库存，保持运行。仅确有必要且本窗口获批时通过正常Stop-Service停止；无论成功失败均正常Start-Service恢复并重新证明身份。不可读、服务自行重现或库存仍不完整时停止；不得用kill替代服务控制。本轮未操作ngrok。

## C. 七文件安装与版本重绑定

先校验本地包、INSTALL-MANIFEST、Node/ABI和23原生资产。严格拒绝额外源码差异或两个Protocol目标已存在。本轮已观察二者均不存在，但未来需重新查。

安装只从发布物`code\source\scripts`取清单中的七个文件，目标仅为：

```text
D:\Tong\app\scripts
D:\Tong\runtime\releases\manager\scripts
```

原有六文件逐项核对`oldProductionSha256`、普通单链接/私有路径后，将物理原件移动到本窗口`original\app|manager\scripts`；放回等字节工作副本，再用同目录临时文件原子替换。Protocol原本不存在，只允许新增，不覆盖未知文件。每一步记录完成情况，验证packagedSha256；中途失败按已完成项反向恢复，旧gate始终不离开原位置。不使用整棵源码覆盖、git checkout、安装开发分支或动态生成未经绑定的代码。

六文件更新加一个新增的精确名称如下，App/Manager两份都要完成：

```text
TongAgentDockRuntime.mjs     TongRuntimeLaunch.ps1
TongRuntimeGuardian.ps1     TongStartupProtocol.ps1
TongRuntimeSecurity.mjs     TongRuntimeSecurity.ps1
TongLoginRecovery.mjs
```

保留profile/双pin原物理件和等字节工作副本，再原子安装上述精确release-manifest到两个pin。安装私有准备的新profile前重新验证它除两个digest之外与现有profile相同、源/发布/文件/原生摘要正确，并核对INSTALL-MANIFEST的profile文件SHA和两个profileDigest。

外部Host由原`0d516b…0c3b`切换到已验证`28d5db…3718`；先同卷保留旧Host物理原件，再复制已验证源。正式runner不修改，SHA256保持`2a32d46a7307f088a827e06dbe81d85ee35ab2153e19cc85f3f69778c642684b`。Task定义、账户、触发器、重试及SDDL不改。

## D. 本人完成新版本恢复授权

七文件、双pin、profile、原生资产全部匹配，Task关闭、旧gate仍保持时，保留当前恢复密文原件及其ACL/哈希，再在本人可见控制台调用既有原生入口。不要重用合成授权或旧版本挑战，不重定向输入输出，不由Agent代填。

```powershell
# 仅在新窗口已获批且C阶段实际通过后，由本人在可见窗口执行。
& 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
  -NoLogo -NoProfile -ExecutionPolicy Bypass `
  -File 'D:\Tong\runtime\releases\manager\scripts\TongProductionApproval.ps1' `
  -Mode approve-login-recovery
```

这是既有helper使用的单进程启动参数，不修改机器执行策略/UAC；若本机策略拒绝则停止，不改安全设置。本人核对新runtime/manager发布摘要、范围和持续期限，手动输入实际显示的挑战。随后用已安装正式Manager执行只读`preflight-login --root D:\Tong\runtime --error-json`，退出0且descriptor/runner/双组件版本一致。旧恢复授权不能证明新版本；原生授权失败保持gate、Task关闭并回退。

## E. 退役旧活动槽位，然后只让正式Task启动

与原版状态恢复操作单的关键差别：新协议不能保留旧runtime/guardian/request工作副本在活动槽位后直接启动。必须在B的完整新鲜证明、Task关闭、原gate和mutex保护下，受控归档这些旧控制物理原件及所有相关reconciliation/stop记录；记录逐项名称、SHA256和FileKey。原始内容不改，历史目录不清理。旧恢复budget原件同样封存，但活动位置保留等字节budget工作副本，不能借交接清零恢复次数。双pin不按事故控制退役。

be3原始失败目录原地不动并再次核对SHA。活动槽位不补写not_started/stopped/runtime.json，不补旧Guardian字段，不造旧Launcher回执；新运行记录只能由候选正常入口创建。

代码/绑定/授权及所有停止证明再次通过，最后释放gate只读句柄，把同一个旧物理gate移到窗口`original\backup.freeze`并核对FileKey。再次检查没有新文件/新运行竞态，再释放SID mutex。此处沿用原操作单已明确的**受控入口关闭→正式Task**交接，不声称跨进程连续持有同一kernel gate。

```powershell
# 前面全部门槛已实际通过，且仍无竞态后，唯一一次放行。
$task = $scheduler.GetFolder('\').GetTask('TongLoginRuntime')
$task.Enabled = $true
$instance = $task.Run($null)
```

不要手动start后再让Task接管。180秒内观察同一新runId的Task EnginePID→Host→PS7 runner→Manager→Launcher→Guardian→Supervisor身份与时间，284源码/23原生、App/Manager同一精确候选、原子containment、ready、doctor.healthy及至少一次定期doctor原生退出0。保留Launcher/Guardian预检阶段、时长、退出码、stderr有限脱敏及startupFailure；不把窗口ID当运行ID。RUNTIME_BUSY/CLEANUP_REQUIRED/未知身份均停止，不再次移锁或无限重试。正常Manager的120秒总启动预算不增大。

成功后仅报告本地生产READY/doctor/监控的实际结果。真实ChatGPT连接、真实登录触发和Windows重启验收仍是独立待验事项，本轮没有执行。

## F. 失败回退：先证明新树停止，再恢复旧版本

1. 禁用正式Task以阻止新调度，不用Task.Stop、kill所有node或删除锁来充当运行清理。若已有本次精确Supervisor运行，通过当前已授权Manager正常`stop-run --run-id <本次真实ID> --login-recovery`；先停止再撤销/替换权限。无可信身份/无回执/清理失败时保留新事故、gate和关闭的Task，停止危险恢复操作。
2. 确认Task正常退出0实例、完整原生库存无匹配、精确新身份消失、四类Job=0及端口空闲；取得SID mutex。保留本次控制、预检/Guardian/Launcher回执、日志、Host临时目录和新gate物理件，不覆盖旧事故原件。
3. 在排除替代运行后，先把同一个旧物理gate恢复到活动位置；按完成清单恢复旧六文件×两组件的物理原件、旧profile/双pin、外部Host和恢复授权原件。新增Protocol仅在哈希和创建归属与本窗口一致时移动到失败证据目录保留，不删除未知文件。验证旧2号源码/原生、旧pin/profile/runner/Host和原件FileKey。
4. 恢复旧runtime/guardian/request/abort/stop/reconciliation等原件，**当前恢复budget继续保留新增尝试，不回写旧budget或清零**；旧budget物理原件保留在封存目录。授权审计保留追加记录，不恢复旧日志覆盖它们。若旧授权已撤销或不能匹配旧版本，在可见窗口重新走正常旧版原生授权，不能伪造密文。
5. 保持正式Task Disabled/0、旧事故gate存在，恢复必要的ngrok原服务状态。回退终点是安全保留的旧2号事故状态，不能承诺其READY；不回写旧业务数据库、OAuth状态或用户配置，不自动再试。完整2号备份仅在真实数据损坏且另获具体批准时使用。

安装、原生生产授权、旧生产活动槽位退役、正式Task启动及生产回退均尚未执行。上述操作单是准备阶段的交付物；本仓库没有把仅允许隔离的LegacyRecovery改成生产可运行，也没有新增自动生产移锁器。
