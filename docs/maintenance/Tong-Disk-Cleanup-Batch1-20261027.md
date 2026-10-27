# Tong 第一批磁盘清理记录（2026-10-27）

**结果：仅指定的两处npm缓存已删除，合计378,061,153字节（360.55 MiB）逻辑文件长度。两次删除命令退出码均为0；删除后两个精确路径均不存在，两个父目录仍存在。没有制作完整备份或向GitHub上传缓存。**

## 授权、工作区与执行边界

用户于本轮直接授权：重新核查后递归删除下面两个精确缓存根，免完整备份；只更新docs/maintenance清理记录并提交、推送当前codex/024-maintenance-adapter-20261024分支。没有授权删除父目录、迁移其他内容或修改生产服务、配置、权限、任务、恢复预算。此前原任务书/独立复核的“未授权清理”状态由本轮针对这两个路径的新授权取代；其他路径仍按原保护边界处理。

实际工作树：D:\Tong\development\tong-024-startup-recovery；起始HEAD为3b0768af1dd777a3c780dadb14797d5bd683da7b。开始时暂存区为空，已有用户修改：docs/maintenance/Tong-Five-Root-Consolidation-ChatGPT-Review-20261027.md。本轮没有改写或暂存该用户文件，单独新增本记录。

使用已安装PowerShell 7.6.6和Python 3.11执行本地正常用户权限操作。没有通过Tong MCP申请state可写工作区，也未改变连接器权限或绕过其先前在其他会话报告的访问限制；本次为用户明确授权的本地Codex执行。实际删除未遇访问拒绝、挑战或policy block；如遇此类限制应停止对应项，不换工具绕过。

## 删除前实测

第一次无跟随元数据扫描：2026-10-27 19:31:27 JST；删除前复查：19:33:40 JST。两次所有文件的相对路径、长度、mtime、inode和nlink列表一致。未读缓存日志正文、npm缓存index正文或下载包正文，未重建/验证缓存、未调用npm CLI，以免产生新日志/环境。

| 精确删除路径 | 逻辑字节 | MiB | 文件 / 子目录 | 重解析点 / 硬链接 / 异常 |
| --- | --- | --- | --- | --- |
| D:\Tong\state\p27-autonomy-candidate-20261017\npm-cache | 189146265 | 180.38 | 688 / 1044 | 0 / 0 / 0 |
| D:\Tong\state\p26-release-preparation-67ffa0da\npm-cache | 188914888 | 180.16 | 683 / 1044 | 0 / 0 / 0 |

目录数不含缓存根自身：合计1371个文件、2088个子目录，再加2个缓存根。两根及D:\、D:\Tong、D:\Tong\state、对应父根均已单独核对，不是reparse/junction/symlink；实际规范化路径与授权路径一致。无只读/隐藏/系统属性文件、无意外文件类型或枚举拒绝。没有跟随链接进行删除。

内容结构：

| 缓存根 | _cacache字节 / 文件数 | _logs字节 / 文件数 | 其他 |
| --- | --- | --- | --- |
| D:\Tong\state\p27-autonomy-candidate-20261017\npm-cache | 188436280 / 676 | 709985 / 11 | 仅0字节_update-notifier-last-checked |
| D:\Tong\state\p26-release-preparation-67ffa0da\npm-cache | 188436280 / 676 | 478608 / 6 | 仅0字节_update-notifier-last-checked |

两处_cacache均由content-v2、index-v5及空tmp组成，属于历史npm下载/索引缓存，并非安装中的node_modules或发布源码。p27缓存最后普通文件修改为2026-10-22 16:51:31 UTC，p26为2026-10-13 14:49:02 UTC。与独立复核先前给出的378,061,153字节一致；此前360.54MiB为近似值，本轮按二进制MiB四舍五入记360.55。

## 当前引用与生产基线

删除前19:32:33 JST和删除后19:34:14 JST分别检查：

- 遍历Windows任务的Execute、WorkingDirectory及Arguments，而不只按任务名称判断；27个相关任务，26 Disabled、TongLoginRuntime为Ready。全部任务均未命中这两个精确缓存路径。服务PathName亦无命中。
- 对可读的进程ExecutablePath/CommandLine搜索规范化后的精确路径，排除本次检查进程及其祖先进程，未发现命中；不转存完整命令行。ngrok进程命令行不可读，未提权，服务image仍为D:\Tong\tools\ngrok\ngrok.exe。
- Process/User/Machine三个作用域的npm_config_cache均未设置。此项不等于读取了每个既有进程的环境；没有安装handle工具或穷举全系统打开句柄。结合文件元数据稳定、无可见调用及Windows实际允许删除作出本批判断。
- runtime/profile保持root=D:\Tong\runtime、codeRoot=D:\Tong\app、managerRoot=D:\Tong\runtime\releases\manager、stageRoot=D:\Tong\runtime\releases\candidate。双pin均为b9fe80150f9cdea47130e8952e85e39503187677，releaseRoot仍为D:\Tong\state\b23-login-70f1b7d66215458c8ffa0d822348de0f\startup-recovery-3bdc9693e71f49e2bafc7e5372b5bb20\release，不在本批缓存根中。
- 只读检查app/manager/当前开发scripts及当前tests中的npm-cache、npmCacheRoot、npm_config_cache和两个父根路径。正式登录恢复/启动代码未把这两个缓存绑定为当前依赖；通用restoreRelease要求调用者指定npmCacheRoot，并使用--offline；不据此假设所有历史恢复都不需要缓存。
- p26父根Prepare-Release.mjs:41–45、Prepare-Rollback.mjs:13确曾使用其npm-cache。这是保留在原位的历史准备/重建脚本，删除缓存后如再次复现该旧环境，需要重新准备下载缓存；不能声称历史离线重跑完全不受影响。用户本轮已明确允许免备份清理可重建缓存，未改这些脚本或保留的release/candidate。
- p27父根仍被正式包中部分历史升级脚本和当前开发的旧测试引用，例如app/scripts/Invoke-TongQuickTrustFullProduction.ps1:12和开发scripts/TongStable1Offline.ps1:15/219。因此仅删除授权的npm-cache，不能由此放行整个p27父根或quick-trust候选/回退证据。

**删除前即存在的生产问题：**19:32:33 JST时runtime/run/runtime.json.phase已是abnormal_exit，7676/7677/18765均未监听；TongLoginRuntime为Ready，未见正式TongLoginHost/AgentDock运行进程。ngrok服务仍Running/Auto。删除后上述可观察状态相同，sourceCommit和managerCommit仍是b9fe801...；本轮没有启动、停止、修复生产，也没有重置恢复预算。此问题需作为独立生产排查/恢复事项处理，不能把本轮缓存清理当作生产健康验收。

## 删除动作与结果

删除前复查通过后，分别以两个独立、精确LiteralPath命令执行，未使用通配符、Force、包装删除循环或其他删除工具：

```powershell
Remove-Item -LiteralPath 'D:\Tong\state\p27-autonomy-candidate-20261017\npm-cache' -Recurse -ErrorAction Stop
Remove-Item -LiteralPath 'D:\Tong\state\p26-release-preparation-67ffa0da\npm-cache' -Recurse -ErrorAction Stop
```

| 精确路径 | 退出码 | 删除后Test-Path / lstat | 父目录 | 跳过或失败原因 |
| --- | --- | --- | --- | --- |
| D:\Tong\state\p27-autonomy-candidate-20261017\npm-cache | 0 | False / ENOENT | 存在、普通目录 | 无，实际删除成功 |
| D:\Tong\state\p26-release-preparation-67ffa0da\npm-cache | 0 | False / ENOENT | 存在、普通目录 | 无，实际删除成功 |

删除与结果核验窗口：2026-10-27 19:33:40–19:34:14 JST（UTC 10:33:40–10:34:14）。已删除逻辑长度378,061,153字节，剩余目标目录逻辑长度为0（目录不存在）。没有独占整盘或在清理前后采集可归因的NTFS空闲空间快照，因此不把上述值声称为精确的物理簇释放量。

本轮没有为缓存生成任何完整备份、复制、压缩包、替代环境、node_modules或上传内容。唯一新增交付物为本记录。其他目录与父根均不在删除命令中。

## 删除后边界核验

- 两个精确路径分别经Test-Path和lstat确认不存在；两个父根仍存在。
- 删除前后相关任务所选名称/状态/Execute/工作目录/参数中的state根元数据相同；ngrok服务状态/启动方式/image相同；profile和双pin的已选路径/commit字段相同。
- 对8个生产边界文件只比较本地SHA-256：runtime/profile、双pin、login-recovery-budget、production-root、TongLoginRuntime.ps1、app/config/tong.config.json、state/ngrok-service.yml，前后均未变化；不输出其私有内容或凭据。
- 原有用户修改文件SHA-256仍为52f8d54e08431b04b6d075d5c4ea7ba351b18ace6acbb19b893cbfbe8a192d79，未改写或混入提交。本轮Git仅暂存本记录；实际commit/push SHA及upstream同步结果以交付聊天的真实回执为准，记录不能自引用自己的commit。
- 可选的全量缓存元数据摘要传送因工具返回“JavaScript execution exceeds the 64000-byte strict auto-review limit”而未执行。已停止该可选项，未分段重试或改工具规避；不影响此前已完成的无跟随扫描、元数据两次一致性比较和实际删除结果。删除本身没有安全/权限拒绝，无删除项跳过。
- 未运行应用测试、npm安装、冷启动、生产doctor或恢复演练；不报告tests passed。文档差异与git diff --cached --check按实际回执验证。

## 下一批只读核查（未再删除）

本轮第一批结束后，额外检查b23-release-fgKPTn下一个缓存和两个候选副本。仅元数据遍历和针对发布清单列明源码的SHA-256比对，没有重新复制、安装依赖或制作备份；未触碰其他state根。19:37:44 JST的任务、服务及可读进程参数未命中下列三个精确路径，但这不是无损删除的全部条件。

| 精确候选 | 逻辑字节 / MiB | 核查证据 | 下一批判定 |
| --- | --- | --- | --- |
| D:\Tong\state\b23-release-fgKPTn\npm-cache | 188785956 / 180.04 | 681文件/1044子目录，标准npm缓存；无reparse/hardlink/枚举异常 | 暂保留：当前Test-TongProductionSwitch.mjs:24/47默认使用该离线缓存，不能无说明直接删除 |
| D:\Tong\state\b23-release-fgKPTn\candidate-58786f6 | 603120383 / 575.18 | 源码与保留release清单SHA匹配62/62；无reparse/hardlink/枚举异常；temp仍有531文件 | 未放行整个candidate：node_modules/native/临时文件尚未逐项完成可重建或重复性证明 |
| D:\Tong\state\b23-release-fgKPTn\candidate-9589698 | 603448013 / 575.49 | 源码与保留release清单SHA匹配95/95；无reparse/hardlink/枚举异常；temp仍有531文件 | 未放行整个candidate：node_modules/native/临时文件尚未逐项完成可重建或重复性证明 |

两个candidate的保留release-manifest分别对应58786f601ceb8c7f3842225697adfb5e4034a73f与9589698864e70a61299e839c34ab5ab1b8677bf9；仅源码匹配不能推导整根可删。每个node_modules约601MB，两处temp分别1,319,916和1,319,948字节；本轮未读取这些临时文件正文。现行回归夹具缓存188,785,956字节也未删除。

下一批可以继续优先核查这两个candidate的native清单、依赖版本/补丁、temp来源和受管恢复引用；只有逐项证明后才可列入精确删除批次。本轮**没有新增已完整核实可直接删除的大型发布根**，不把尚缺证据的目录包装成已放行清单。b23-login-68009...、当前pin所指release、共享开发依赖、所有gate/秘密/恢复预算继续保留；不对整个state或父根作批量删除。

剩余事项：独立处理删除前已存在的Tong abnormal_exit；继续精确核查大型重复候选；保留既有复核文件的未提交修改。用户后续如授权下一批，再对当时路径/引用/体积复核，不能沿用过期进程PID或本轮授权扩大删除范围。
