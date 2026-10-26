# Tong 五根目录只读盘点报告（2026-10-27）

状态：Codex 实际只读盘点已完成，待 ChatGPT 第二次独立复核。所有迁移、清理、任务/服务及生产变更均未执行，需后续单独授权。

## 1. 结论与范围

本轮唯一业务文件写入是本报告；随后仅对本报告执行已授权的 Git 提交与正常推送。任务书和所有原有源码、配置、日志、备份、注册、运行任务均未由本轮修改。未安装依赖、重建环境、运行历史测试、打包或启动/停止服务。生产进程自身可能继续更新日志和状态，不能将只读观察等同于全盘静态快照。

五根可达普通文件合计 **46,839,084,421 字节（43.622 GiB）**、**2,579,388 文件**、**203,709 子目录**。扫描期间为 2026-10-27 02:23:58–02:24:41 JST（UTC 时间见附录 A），不含本报告生成后的增量。state 的 **1609 个一级目录**已逐项列入附录 B。元数据遍历没有访问拒绝；**131 个重解析点跳过，绝不跟随**。这满足可达元数据盘点，不能据此宣称每份运行态、日志、数据库或历史源码已获得删除许可。

主要判断：

- 正式 app/runtime、ngrok 服务、共享开发依赖以及被生产 pin/策略引用的 state 内容必须保留。
- 四个旧根适合先归档和登记映射；旧源码有 50 个修改和 13 个未跟踪条目，计算器源码/测试也未跟踪，不能直接当重复副本清理。
- 体积集中在重复部署的 node_modules 和恢复/发布副本；五根路径分类中 node_modules 共约 35.117 GiB，但其中包括正在使用、离线恢复必需和备份内的依赖，**不是可回收空间**。
- 发现 27 个相关 Windows 任务，其中 26 个 Disabled、1 个 Running；21 个 Disabled 任务仍引用 state，需先决定是否保留复现能力。Disabled 不等于已脱离引用。
- 三个开发工作树的 node_modules 是指向开发主仓库的 junction。当前工作树只有约 9.44 MiB 可达实体文件，不能误认为它自带全部依赖。
- ngrok 服务实际使用 D:\Tong\tools\ngrok\ngrok.exe；app 配置却仍指向已不存在的 D:\小红书\ngrok.exe。另有 Disabled 的 TongNgrokRestore 指向已不存在的临时脚本。这是后续维护风险，本轮未修复。

| 根目录 | 递归逻辑体积 | 文件 / 子目录 | 用途及本轮分类 |
| --- | --- | --- | --- |
| D:\Tong | 41577437894 / 38.722 GiB | 2295864 / 178341 | 正式生产 + 多代开发 + 测试/恢复证据；混合保留 |
| D:\agentdock-poc-20261010 | 1927931535 / 1.796 GiB | 88815 / 11483 | AgentDock PoC 源码、分发包、隔离测试；建议归档 |
| D:\tong-agentdock-local | 2686702162 / 2.502 GiB | 153173 / 10681 | 历史生产运行态及恢复副本；受保护归档候选 |
| D:\tong-codex-acceptance-20261010 | 36962262 / 0.034 GiB | 2524 / 254 | 原生验收 Git 项目；源码保留，缓存待核 |
| D:\tong-desktop-control | 610050568 / 0.568 GiB | 39012 / 2950 | 早期 Tong 独立仓库；脏工作树完整归档 |

## 2. 方法、证据与限制

依据任务书 docs/maintenance/Tong-Five-Root-Consolidation-Audit-20261027.md、当前项目 AGENTS.md，以及 app/manager 的同类约定执行。初始目录 D:\Tong 不是报告所在 Git 工作树；经文件定位后固定在 D:\Tong\development\tong-024-startup-recovery 工作。四个外置根未发现自己的 AGENTS.md。所有命令使用正常用户权限，PowerShell 7.6.6。

证据编号：

- **M1**：Python 3.11 os.scandir + stat(follow_symlinks=False) 逐目录读取名称/长度/时间；先判断 Windows FILE_ATTRIBUTE_REPARSE_POINT，跳过其目标。完整可达统计、131 个跳过路径和大文件样本集中在附录 A/B。目录逻辑长度不与其子目录重复相加。
- **G1**：对发现的全部 39 个 .git 标记分别执行只读 git --no-optional-locks status / rev-parse / branch / remote / ls-files；37 个可识别、2 个不可识别。7 个主要源码/验收仓库及32个嵌套标记的结果见第4节与附录 C。Git 状态检查不修复、不刷新索引锁、不执行 fetch、切分支或清理。
- **H1**：限定到7组 Tong 安全源码树中的 scripts/tests/native 和4个顶层源码文件，排除 node_modules/.git/bin/obj/evidence，仅 SHA-256 比较实际工作树字节；共读取约14.2 MB源码。另核验一个29.2 MB分发ZIP及两个21.9 MB AgentDock二进制。不是全D盘哈希，也未读真实工作区内容和私有日志正文。
- **R1**：白名单选择 runtime/profile、run/runtime、manager-pin/release-pin、production-root、app/config 的路径、版本和状态字段；不输出认证字段。项目注册以本轮 Tong tong_list_projects 的实时返回为准，公开报告不复制授权 grant、challenge 或令牌。
- **W1**：Get-ScheduledTask / Win32_Service / Win32_Process / Get-NetTCPConnection 的元数据；任务只保留名称、状态、可执行路径、工作目录及脚本路径，不转存完整参数或任务XML。
- **S1**：对安全脚本逐行搜索并归一化 JSON/JS 双反斜线与斜杠，记录旧绝对路径的文件和行号；生产脚本、当前开发 tests、旧源码脚本均覆盖，未搜索凭据目录、数据库或私有日志。

首轮工具内长扫描未形成可用结果（一次工具超时，异步调用也未返回完成证据），已改用可等待命令会话得到 M1；未将失败调用当成证据，未生成临时报告/JSON/源码副本。最终扫描约43秒，唯一持久交付物为本文件。

限制：体积为普通文件逻辑长度，不是NTFS实际占用；未测稀疏/压缩、分配簇或根外共享内容。stat 未发现 nlink>1 的文件，仍不排除未遍历目标或根外硬链接。junction 的大小一律不计入；开发共享目标本身在开发主仓库内统计一次。活动文件没有冻结，因此各时点可有轻微变化。只进行了静态/元数据核验，未执行 HTTP、OAuth、生产 doctor、冷启动、原生会话恢复或离线还原；没有声称这些验证通过。

## 3. 五处根目录的独立判断

### 3.1 D:\Tong：生产与开发的共同边界

- **app：613,321,610 字节**。已部署源码与依赖，实际 runtime/profile.codeRoot 指向这里；安全源码中有14个文件与当前开发工作树不同。部署副本与开发分支不是可互相替换的重复目录，全部生产必留。
- **runtime：3,020,414,634 字节**。其中 releases 1,207,685,974、state-backups 833,896,780、state-restores 645,974,516、logs 242,741,844 字节；secrets/run/login-management/home/workspace/tong-policy 全部按生产依赖保留。日志只能在制定留存/轮转和事故证据策略后考虑分批归档，不能整根删除。
- **development：713,241,544 字节**。主仓库610,369,080字节含真实依赖及共同 .git；当前报告工作树9,901,235字节、launcher工作树90,793,009字节、hotfix工作树2,049,071字节，后三者的依赖链接均指向主仓库。test-temp为129,149字节/15文件/23目录，存在故意构造的redirect链接，暂列未知测试证据，不能仅凭temp名称删除。
- **state：37,197,184,309 字节，2,059,407文件**。既有历史测试，也有当前 pin 所指发布根、策略所指Python运行时、服务配置以及Windows任务引用；它不是缓存总目录。下表仅按路径前缀进行盘点归组，不代表用途已逐份证明。完整1609项见附录B。
- **tools：33,274,696字节**。唯一可达普通文件为ngrok/ngrok.exe；ngrok Windows服务Running/Auto，明确依赖此路径，生产必留。根部acl-record-20261013.json属于权限证据，execpolicy-smoke.txt属于小型验收记录，保留成本很低，先随证据归档。

| state 前缀组（仅统计标签） | 一级目录数 | 字节 / GiB | 初步处置 |
| --- | --- | --- | --- |
| b23-login-* | 189 | 15977156440 / 14.880 GiB | 恢复/发布/会话证据候选，先保留 |
| p27-* | 1 | 7741071264 / 7.209 GiB | 恢复/发布/会话证据候选，先保留 |
| 其他 b23-* | 65 | 5348564140 / 4.981 GiB | 引用关系未逐根证明，保留/未知 |
| native-codex-* | 1 | 3083883082 / 2.872 GiB | 恢复/发布/会话证据候选，先保留 |
| p26-* | 12 | 2096801677 / 1.953 GiB | 恢复/发布/会话证据候选，先保留 |
| b23-maint-* | 873 | 1894756347 / 1.765 GiB | 引用关系未逐根证明，保留/未知 |
| synthetic-test-* | 30 | 770612588 / 0.718 GiB | 复核夹具及引用后才可归档或清理 |
| 其他 | 415 | 245187041 / 0.228 GiB | 引用关系未逐根证明，保留/未知 |
| b24-* | 18 | 39099200 / 0.036 GiB | 引用关系未逐根证明，保留/未知 |
| b23-host-policy-* | 5 | 35501 / 0.000 GiB | 引用关系未逐根证明，保留/未知 |

### 3.2 D:\agentdock-poc-20261010：上游源码、原始分发与PoC现场

总计1,927,931,535字节。agentdock子目录为上游Git源码（16,224,149字节），clean detached HEAD，925个跟踪文件；不是Tong分支，也不能由Tong源码仓库替代。isolated为1,586,084,207字节，含历史运行态/工作区/大量复制依赖和21个嵌套Git标记，不能当普通构建缓存。npm-cache为189,059,645字节，可能支持离线恢复，需核验保留候选依赖覆盖后才能删。

runtime目录83,823,438字节；其中agentdock.exe与当前生产同名文件SHA-256相同，但目录其余内容未逐字节比对。29,230,453字节的ZIP与旁边SHA256文件校验一致，建议保留为原始分发/供应来源证据。p243-live-*六个小目录合计仅331字节，p243-tests可达为空；节省极小，还可能属于会话验收证据。四个Python客户端/验收脚本及Run-P243ClientSmoke.ps1未在本轮当前/旧Tong scripts/tests有限静态语料中找到名称引用，但手动调用、旧文档或外部调度仍未知；优先连同PoC报告归档，而非立即删除。日志和历史结果JSON只读元数据，未核对正文或重新跑测试。

### 3.3 D:\tong-agentdock-local：历史正式运行态，不能公开入库

总计2,686,702,162字节。profile.root仍为旧根，codeRoot/originalTongRoot为D:\tong-desktop-control，originalStateRoot为其runtime；manager和candidate也使用旧绝对路径。releases为1,204,761,974字节；state-backups为833,896,780、state-restores为645,974,516字节。后二者与当前runtime同类目录长度相同，只能作为重复调查线索，**未证明内容一致或可互相替代**。

run中仍有runtime、stop、stale-reconciliation、deployment-install、pin等记录，未读取私有日志正文，也未执行状态恢复。secrets、home、backend-state、tong-policy、workspace及所有gate/DPAPI/数据库伴随文件一并按受保护状态保留。workspace/b23-acceptance有独立Git历史且calculator.py被修改，没有remote。应作为受限历史运行态整组归档；不能把其中secrets和工作区提交到报告仓库，也不能只搬代码留下恢复依赖。

### 3.4 D:\tong-codex-acceptance-20261010：小型原生验收项目

总计36,962,262字节，其中.venv占36,925,257字节（约99.9%）；.pytest_cache 1,519字节、根__pycache__638字节。Git分支main只是这个独立验收仓库的现状，本轮未改它；HEAD b822e7aee6a78f1f1f6f9b1a89e3e33fa8efb360，仅.gitignore和README.md两个跟踪文件，无remote/upstream。calculator.py及tests/test_calculator.py均未跟踪，不能依靠Git提交恢复。

Tong注册tong-calc-accept-20261010仍绑定旧根，仅project.metadata能力。迁移前必须保存未跟踪源码、确认原生会话和cwd关联、通过支持的注册/授权流程变更根。Python虚拟环境移动后不保证可用；本轮不重建、不运行它。缓存可列低风险复核候选，源码和.git保留。

### 3.5 D:\tong-desktop-control：有独有现场的早期Tong仓库

总计610,050,568字节，其中node_modules 601,062,479、logs 5,858,012、.git 1,506,375、scripts 463,194、tests 415,964、backups 179,510字节。HEAD虽是当前报告分支的祖先，但工作树有**50个已跟踪修改、13个未跟踪条目**。安全源码有限比较101个文件：60个字节一致，41个字节不同；不能把整根认作已合并的重复副本。

必须保留.git（含Codex检查点/分支引用）、dirty工作树、未跟踪材料、docs、native、runtime和backups。旧脚本中的旧根边界仍绑定PoC与历史运行态；直接改路径会影响受限执行和恢复校验。建议先作为完整历史仓库归档，后续再审查依赖缓存及重复测试副本。

## 4. Git关系与未提交工作

当前报告分支起始HEAD为3a791ec9a01f8fdb4f5104f6ff06dcd20d28a60c，分支codex/024-maintenance-adapter-20261024，现有upstream为origin同名分支；初始工作树及暂存区均干净。AGENTS中“2修改+16未跟踪”是历史提醒，实际主开发仓库为2修改+17未跟踪，以本次G1为准。本报告不会混入那些文件。

下表upstream的0/0仅指本地已有remote-tracking ref比较，未额外fetch其他分支；本次报告的实际push和远端核对结果在交付聊天中给出。项目未发现refs/heads/main及refs/remotes/origin/main，也没有origin/HEAD符号引用；本轮不创建或修改这些引用。其他独立夹具中已有main/master只读保留。

| 源码/验收仓库 | branch / HEAD | 修改 / 未跟踪 / 暂存 | remote / upstream |
| --- | --- | --- | --- |
| D:\Tong\development\tong-desktop-control | codex/codex-desktop-deeplink-20261021 / 5362210c5831bd6bdcc706a43254c20ade145b06 | 2 / 17 / 0 | origin	git@github.com:user1578/tong-desktop-control.git；0 / 0 |
| D:\Tong\development\tong-024-startup-recovery | codex/024-maintenance-adapter-20261024 / 3a791ec9a01f8fdb4f5104f6ff06dcd20d28a60c | 0 / 0 / 0 | origin	git@github.com:user1578/tong-desktop-control.git；0 / 0 |
| D:\Tong\development\tong-launcher-startup-recovery | codex/wip-launcher-startup-recovery-20261024 / b77a418ff085d2be6ef57e9c45479d45d8514a7a | 0 / 0 / 0 | origin	git@github.com:user1578/tong-desktop-control.git；无upstream |
| D:\Tong\development\tong-startup-hotfix | codex/startup-reliability-production / 1eac7502a9cf89be7daf63d59843ad9f49b61877 | 0 / 0 / 0 | origin	git@github.com:user1578/tong-desktop-control.git；0 / 0 |
| D:\tong-desktop-control | codex/p244-production / cb5bd95245bc33d47b9aa660df3670c6baf9ade9 | 50 / 13 / 0 | origin	git@github.com:user1578/tong-desktop-control.git；无upstream |
| D:\tong-codex-acceptance-20261010 | main / b822e7aee6a78f1f1f6f9b1a89e3e33fa8efb360 | 0 / 2 / 0 | 无remote；无upstream |
| D:\agentdock-poc-20261010\agentdock | DETACHED / 255000078e399be2fdff986ae65d4c24290425b9 | 0 / 0 / 0 | origin	https://github.com/uvwt/agentdock.git；无upstream |

开发主仓库.git由4个worktree共享，不能单独归档或删除主仓库再期待其他工作树可用。以当前报告起始HEAD为右侧比较：

| 左侧仓库HEAD | 仅左侧提交 / 仅当前报告起始分支提交 | merge-base | 意义 |
| --- | --- | --- | --- |
| D:\Tong\development\tong-desktop-control | 2 / 37 | 024d5b0920d9ad8f1a2baf2e55640a5666ad4739 | 分叉且有侧支提交；不得按重复分支删除 |
| D:\Tong\development\tong-launcher-startup-recovery | 4 / 37 | 024d5b0920d9ad8f1a2baf2e55640a5666ad4739 | 分叉且有侧支提交；不得按重复分支删除 |
| D:\Tong\development\tong-startup-hotfix | 1 / 102 | 3442cbb938dea887a55bf13a72a5213ae4c5dbe5 | 分叉且有侧支提交；不得按重复分支删除 |
| D:\tong-desktop-control | 0 / 121 | cb5bd95245bc33d47b9aa660df3670c6baf9ade9 | 旧HEAD为祖先；仍须保存未提交现场 |

D:\tong-desktop-control的44个ref所指对象（commit或tree）在当前共同对象库均可读取；43个ref的名称和hash一致，codex/p25-tong-migration在旧仓库为bcd813c04dcb1fd0df6c1cc34491fbc7fe552ba9，当前为3442cbb938dea887a55bf13a72a5213ae4c5dbe5，旧侧/当前侧提交差0/12。因此旧HEAD对象已继承，但旧分支指针和reflog/检查点语义仍须保存；未做全对象可达性或reflog穷举，不能证明删除旧.git无损。

### 4.1 初始脏工作树清单（不读取文件正文）

**D:\Tong\development\tong-desktop-control**

```text
## codex/codex-desktop-deeplink-20261021...origin/codex/codex-desktop-deeplink-20261021
 M docs/P2.4.4-B2.4-Closeout-Report.md
 M docs/P2.4.4-B2.4-Production-Deployment.md
?? docs/P2.4.4-B2-Production-Preflight.md
?? docs/P2.6-Handoff.md
?? scripts/Apply-B24-Increment.mjs
?? scripts/Approve-B24-Current.ps1
?? scripts/Approve-B24-RecoveryWindow.ps1
?? scripts/Approve-B25-Migration.ps1
?? scripts/Approve-TongD02.ps1
?? scripts/Check-B24-ProductionMcp.mjs
?? scripts/Check-B25-MigrationMcp.mjs
?? scripts/Inspect-TongD02Approval.mjs
?? scripts/Install-B24-ManagerRecovery.mjs
?? scripts/Install-B25-Migration.mjs
?? scripts/Make-TongRepositoryIndependent.ps1
?? scripts/Prepare-TongD02Approval.mjs
?? scripts/Repair-TongMigratedRegistration.mjs
?? tests/Temporary-NativeCodexLiveAcceptance.mjs
?? tests/Test-TongApprovalPersistence.ps1
```

**D:\tong-desktop-control**

```text
## codex/p244-production
 M .gitignore
 M README.md
 M config/tong.config.example.json
 M docs/P2.2-Worker-Isolation-B0.2.md
 M docs/P2.2-Worker-Isolation-StageB.md
 M docs/evidence/B0.2-native-file-stderr.txt
 M native/TongWorkerSupervisor/AclJournal.cs
 M native/TongWorkerSupervisor/Native.cs
 M native/TongWorkerSupervisor/Program.cs
 M native/TongWorkerSupervisor/RestrictedProcess.cs
 M scripts/Build-TongWorkerSupervisor.ps1
 M scripts/Get-TongDesktopControlStatus.ps1
 M scripts/Plan-TongWorkerIsolation.ps1
 M scripts/Plan-TongWorkerIsolationRollback.ps1
 M scripts/Restart-TongDesktopControl.ps1
 M scripts/Start-TongDesktopControl.ps1
 M scripts/Stop-TongDesktopControl.ps1
 M scripts/TongAgentDockClient.mjs
 M scripts/TongAgentDockExecution.mjs
 M scripts/TongAgentDockOperations.mjs
 M scripts/TongAgentDockTools.mjs
 M scripts/TongCodexAppServer.mjs
 M scripts/TongCodexWorker.mjs
 M scripts/TongCodexWorkerMain.mjs
 M scripts/TongControl.psm1
 M scripts/TongDevSpaceHttpDiagnostics.mjs
 M scripts/TongMcpTools.mjs
 M scripts/TongNativeWorkerSupervisor.mjs
 M scripts/TongSafeFilePath.mjs
 M scripts/TongWorkerBroker.mjs
 M scripts/TongWorkerProtocol.mjs
 M scripts/TongWorkerStdio.mjs
 M tests/Run-TongNativeWorkerSupervisor.mjs
 M tests/Test-TongAgentDock.mjs
 M tests/Test-TongAgentDockExecution.mjs
 M tests/Test-TongAgentDockExecutionLive.mjs
 M tests/Test-TongCodexAppServer.mjs
 M tests/Test-TongConfiguration.ps1
 M tests/Test-TongEndpoints.ps1
 M tests/Test-TongMcpMetadataTools.mjs
 M tests/Test-TongNativeWorkerSupervisor.ps1
 M tests/Test-TongPortListenerArray.ps1
 M tests/Test-TongPredeploymentLive.mjs
 M tests/Test-TongToolBoundaries.mjs
 M tests/Test-TongWorkerCanaries.ps1
 M tests/Test-TongWorkerIsolation.mjs
 M tests/fixtures/TongNativeMockWorker.mjs
 M tests/fixtures/TongPredeploymentServer.mjs
 M tests/fixtures/TongProductionSwitchSupport.mjs
 M tests/fixtures/TongWorkerCanary.mjs
?? demo-workspace/chatgpt-continuity-20261009.txt
?? demo-workspace/chatgpt-p1-acceptance-20261009.txt
?? demo-workspace/chatgpt-p21-acceptance-20261009.txt
?? demo-workspace/chatgpt-p231-acceptance-20261010.txt
?? demo-workspace/chatgpt-security-acceptance-20261009.txt
?? demo-workspace/tong-p1-smoke-1791541197614-657s94d.txt
?? docs/P2.4.4-B2.3-Production-Candidate.md
?? scripts/TongAgentDockSessions.mjs
?? tests/Run-TongB24Regression.mjs
?? tests/Test-TongAgentDockDirectoryMapping.mjs
?? tests/Test-TongAgentDockSessionCoordination.mjs
?? tests/Test-TongAgentDockSessionOwnership.mjs
?? tests/Test-TongB24CloseoutLive.mjs
```

**D:\tong-codex-acceptance-20261010**

```text
## main
?? calculator.py
?? tests/test_calculator.py
```

## 5. 生产、启动与旧路径依赖

### 5.1 已证明的保留链

| 对象 | 本轮证据 | 保留原因 / 迁移后失效风险 |
| --- | --- | --- |
| 正式Tong | runtime/profile：root=D:\Tong\runtime；codeRoot=D:\Tong\app；managerRoot=runtime\releases\manager；runtime.json.phase=ready | W1同时看见7676/7677/18765监听及TongLoginHost/AgentDock进程；仅此不等于端到端健康验证。保留app、runtime及其依赖 |
| 当前pin来源 | manager-pin和release-pin commit均为b9fe80150f9cdea47130e8952e85e39503187677；sourceRepository=D:\Tong\development\tong-desktop-control | 当前报告分支不是实际部署版本；生产副本不能按当前开发内容去重或覆盖 |
| pin所指state | D:\Tong\state\b23-login-70f1b7d66215458c8ffa0d822348de0f\startup-recovery-3bdc9693e71f49e2bafc7e5372b5bb20\release | releaseRoot为现有pin的持久来源；所属state根238,859,545字节，生产证据/恢复必留。不能只留下app而丢掉release-manifest及来源 |
| 开发主仓库路径 | app/scripts/TongRuntimeRelease.mjs:14、111、140、154将codeRoot/sourceRepository绑定开发主仓库 | 改名/移动会触发CODE_ROOT_DENIED或MANIFEST_INVALID；主仓库.git又被3个worktree共用，当前不应纳入迁移 |
| 策略Python运行时 | runtime/tong-policy/agentdock-access.json中b23-acceptance的commands.python.path=D:\Tong\state\p244-python-runtime\Scripts\python.exe；该文件存在 | 所属state根36,443,104字节，当前依赖，不是普通测试venv；整根保留 |
| ngrok | Windows服务ngrok：Running/Auto，image=D:\Tong\tools\ngrok\ngrok.exe；配置路径含用户ngrok.yml及D:\Tong\state\ngrok-service.yml | state顶层ngrok-service.yml和tools/ngrok都进入生产保留集合；不读取两个配置正文 |
| 登录与任务 | TongLoginRuntime Running，执行runtime\login-management\TongLoginHost.exe；TongLoginRuntime.ps1:6选取runtime内manager脚本 | 保留登录宿主、manager、pin、run/budget/锁状态；不能为了搬目录重置恢复预算 |
| 历史任务场景 | 21个Disabled任务仍引用state，详见附录D；其中多个位于b23-login-68009...根（2,420,534,176字节） | 相关根保留事故和复现价值，先判定任务是否退役，再按正式批准流程处理路径与任务；不能自动删除 |
| DevSpace配置与OAuth | app/scripts/TongProductionProfile.mjs:22外部configDir与oauthStateDir；TongRuntimeServer.mjs:42/48校验原配置 | 位于用户目录，属于跨根依赖。本轮只读源码中的路径，不读其认证文件；迁移验收需原账户/DPAPI和权限完整 |
| 原生Codex cwd | app/scripts/TongCodexWorker.mjs:60：cwd取request.projectRoot；TongProjectAccess.mjs:18及140以后读取并验证注册路径 | 改根不是简单改名；项目ID、root绑定授权、旧会话cwd和续接所有权均须通过受支持的受管入口核验 |

当前观察到ngrok进程PID40764的ExecutablePath未由系统返回，未提权追问；服务image可读。AgentDock PID40584对应D:\Tong\runtime\agentdock\agentdock.exe，TongLoginHost PID54372对应正式登录宿主；监听18765/7677/7676分别归40584/56432/12152，均为127.0.0.1。PID仅是本次快照，迁移时必须重核身份和启动时间，不能据旧PID终止进程。未做全系统句柄/进程命令行穷举，因此不能声称四个旧根绝无活动文件句柄。

### 5.2 项目注册和会话限制

本轮tong_list_projects确认以下登记仍enabled且available；这里不复制授权ID或挑战。

| projectId | 当前root | 能力现状 | 后续处理 |
| --- | --- | --- | --- |
| tong-archive-agentdock-poc | D:\agentdock-poc-20261010 | metadata/read/write；无agent.execute授权 | 保留ID；受管变更根及有效能力，不能手改授权文件 |
| tong-archive-agentdock-local | D:\tong-agentdock-local | metadata/read/write；无agent.execute授权 | 历史运行态须受限归档；不可沿用生产授权推断 |
| tong-archive-desktop | D:\tong-desktop-control | metadata/read/write；无agent.execute授权 | 保留旧Git/dirty文件；路径变更需重新验证 |
| tong-calc-accept-20261010 | D:\tong-codex-acceptance-20261010 | 仅metadata | 迁移后如需读取/续接，必须由正式流程批准相应能力 |
| tong-development | D:\Tong\development\tong-desktop-control | read/write/agent.execute（既有开发授权） | 主仓库和共享依赖当前保留原路径，不挪动 |
| tong-development-root | D:\Tong\development | read/write/agent.execute（本轮工具返回） | 广义开发登记不等于可绕过旧项目的逐项目会话门禁 |

tong_agent_sessions工具明确要求project.read、agent.execute和trusted project grant。四个旧注册不能满足，因此未调用该工具探查旧会话，也未改用直读Codex会话数据库/rollout正文绕过；旧原生会话数量、是否仍持有writer、迁移后能否沿同一会话继续均标为 **UNKNOWN**。本轮任务的本地只读授权不改变Tong连接器的能力门禁。后续只有在正式授权/能力到位后，才能先获取必要的会话ID与cwd元数据，再验证迁移后的同一会话续接；不得通过创建新会话冒充续接。

### 5.3 需要维护的旧绝对路径

当前生产scripts和manager脚本的本轮S1语料未命中四个旧根，但所携带的历史tests仍命中；这不代表旧根无人手动调用。当前开发tests与旧脚本也有硬编码，关键命中如下；完整行号索引见附录E。

| 位置（相对当前开发工作树，另有说明除外） | 行号 | 风险 |
| --- | --- | --- |
| tests/Run-TongAgentDockExecutionLive.ps1 | 1 | 默认PoC根仍是D:\agentdock-poc-20261010 |
| tests/fixtures/TongProductionSwitchSupport.mjs | 11 | fixture以旧PoC隔离根构造路径 |
| tests/Run-TongB24Regression.mjs | 8 | 回归入口仍使用旧PoC路径 |
| tests/Test-TongRuntimeAcl.ps1 | 2,52 | 固定ACL/隔离根；复制目录未必复制低完整性/继承/DACL语义 |
| tests/Test-TongRuntimeRelease.mjs | 10,15,23,26,34 | 同时引用旧PoC、旧源码和旧运行态；不能只迁一个根后假定测试可用 |
| tests/Test-TongB24CloseoutLive.mjs | 16,24,50,99 | 旧隔离根与旧历史生产根仍可触发现场操作；本轮没有运行 |
| D:\tong-desktop-control\scripts\TongRuntimeLaunch.ps1 | 8–15 | 旧生产root和supervisor路径必须精确匹配，不能任意替换 |
| D:\tong-desktop-control\scripts\TongRuntimeGuardian.ps1 | 9–15 | 旧根/隔离边界受固定校验 |
| D:\tong-desktop-control\scripts\TongProductionApproval.ps1 | 10 | 原PoC隔离state根绑定，不能迁移后直接沿用旧审批语义 |

另外，app/config/tong.config.json.ngrokExecutable仍为不存在的D:\小红书\ngrok.exe；现有ngrok服务路径已经是D:\Tong\tools。Disabled的TongNgrokRestore使用powershell.exe并指向不存在的C:\Users\Rune\AppData\Local\Temp\tong-ngrok-restart.ps1。它们可能导致旧入口/恢复任务未来失败，本轮没有启动任务验证，也未修配置。服务正在运行不证明上述旧入口可用。

## 6. 保留、迁移与疑似清理候选

以下是供ChatGPT复核的分类，不构成任何删除/移动指令。类别可以覆盖同一父根内不同子项；大小不能跨父子重复累计。

| 组 / 分类 | 路径或对象 | 证据及逻辑大小 | 删除可能损失 / 仍需证明 |
| --- | --- | --- | --- |
| P1 生产必留 | D:\Tong\app、runtime、tools\ngrok | R1/W1和第5.1节；分别613.3MB、3.020GB、33.3MB | 正在运行功能、认证/授权、恢复预算、pin、离线回退能力 |
| D1 当前开发必留 | development主仓库、三个worktree、真实node_modules目标 | G1共同.git、分叉提交；三个junction目标均为主仓库node_modules | 分支侧支、dirty工作、所有工作树依赖；不因工作树实体很小就删除共同目标 |
| P2 生产/证据必留 | pin所指b23-login-70...、p244-python-runtime、state\ngrok-service.yml | R1/W1直接路径引用；238.9MB、36.4MB和150字节 | pin验证/恢复、已登记命令Python、ngrok服务配置 |
| E1 证据或备份保留 | runtime与旧local的state-backups/state-restores；p27/p26/native-codex；各gate/加密payload | M1体积及运行态结构；最大payload.aes 286,155,104字节仅查元数据 | 恢复链、密钥gate配对、事故证据；同大小不等于冗余，无还原演练不能清空 |
| M1 建议迁移 | 四个旧根，保留各自Git/未提交/注册/历史运行态边界 | 合计5,261,646,527字节（4.900 GiB）；详见第7/8节 | 四者之间及现有tests有路径耦合，必须成组验证；迁移本身不释放空间 |
| C1 疑似可删，低收益 | 计算器.pytest_cache、根与tests下__pycache__；PoC根__pycache__ | pytest自带README说明其来自cache插件；根pycache为calculator.cpython-311.pyc且源码仍在；根两项合计2,157字节 | 丢失last-failed/cache fixture信息和编译缓存；需确认无事故取证要求并保留源码，不能删tests源码 |
| C2 疑似可删，需环境验收 | 计算器.venv；PoC synthetic-project下.venv | M1分别36,925,257和23,412,845字节；计算器pyvenv.cfg确认Python3.11.9及原绝对创建路径 | 可能失去当年精确依赖/控制台入口；尚无可验证依赖锁及复现证据，不能认定可立即重建；当前不动 |
| C3 疑似可删，须先解决离线恢复 | 旧源码node_modules；已退役PoC/发布根中的重复依赖；PoC npm-cache | 旧源码601,062,479字节，PoC npm-cache189,059,645字节；五根node_modules逻辑共35.117GiB | DevSpace补丁、native SQLite/ABI与离线包可能只存在于旧副本；必须逐目录证明无引用并保留恢复所需版本。35.117GiB绝不是承诺释放量 |
| C4 疑似可删，针对旧副本 | 第6.1节同字节旧tests/scripts，保留当前开发和历史归档 | H1：旧安全语料60一致/41不同；给出具体SHA256 | 可能失去旧版本配套入口/dirty工作；先完整归档，修好迁移后调用关系，不能删除当前版本的相同实现 |
| C5 疑似可退役脚本，证据不足 | PoC mcp_acceptance.py/mcp_client.py/mcp_followup.py/verify_acceptance.py/Run-P243ClientSmoke.ps1 | M1有体积时间；本轮限定语料没有名称调用命中 | 它们可能仅供手动验收或历史文档，未证明被替代；建议先归档，等使用者确认再考虑删除 |
| C6 日志/测试根待核 | runtime/logs及state/b23-maint-*、synthetic-test-*、p243-live-* | 日志242,741,844字节；state分组表/1609项索引；21任务仍有state引用 | 日志正文/敏感性未读；事故证据、任务复现、未提交夹具可能独有。只建议制定留存/归档，不给整组删除许可 |
| U1 未知 | 131个重解析目标、2个不可识别.git、会话所有权/续接、未穷举外部句柄 | 明确跳过/门禁/静态范围，附录有路径 | 未证明无依赖或可恢复，保留 |

### 6.1 已逐字节核对的旧源码副本样例

下表源均为D:\tong-desktop-control，相对目标均为D:\Tong\development\tong-024-startup-recovery；两边SHA-256相同。只能考虑旧归档副本的后续精简，不能据此删除当前仓库tests或业务脚本。旧副本中同字节测试共34个；完整同字节测试列表见附录F。

| 相对文件 | 字节 | 两端共同SHA-256 |
| --- | --- | --- |
| scripts/Build-TongWorkerSupervisor.ps1 | 1171 | 7c797d2d9d2a1faf53c9bfa5dc2864a116b68479dfb67a2de104b773ff66f5fd |
| scripts/TongAgentDockClient.mjs | 12154 | b5ff332c270ae967b17a9787a26e58941d1d8082f1873580f543b91764ab02b6 |
| scripts/TongAgentDockOperations.mjs | 3165 | 4fa4d713ab919bc058c56b236787cfedb81f0b760dc6209481cad159e18294fd |
| tests/Run-TongB24Regression.mjs | 2917 | 5dfd2ed62a034e509dc91c971627f20447dc2c7d4cbee6d0de2c8d306ea2d6d8 |
| tests/Test-TongAgentDockDirectoryMapping.mjs | 4265 | 1e28074359c4598415285ef26e8c9d2aab39ff450ce3266fb3edabf6e7837fa4 |
| tests/Test-TongAgentDockSessionOwnership.mjs | 11423 | 7a4649ed5cda190713fb81c47af50667fd8bc3e0188ac1df08ac3d62b5829d1e |
| tests/Test-TongWorkerIsolation.mjs | 16058 | 642144e68288c90dd1430b796ae41c59ec6a875f08a18802a152353295015bbe |

分发/二进制核对：

| 路径 | 字节 | SHA-256 |
| --- | --- | --- |
| D:\agentdock-poc-20261010\agentdock_windows_amd64.zip | 29230453 | 2938e38c9eede531c00b991e435ce6d5032b266adbd1e0b455e6beb4d5b22119 |
| D:\agentdock-poc-20261010\runtime\agentdock.exe | 21929064 | bc1a7a35f1985e9f7827142577fc31bd4ca536e27252b08fc28c5ed636cf5e8d |
| D:\Tong\runtime\agentdock\agentdock.exe | 21929064 | bc1a7a35f1985e9f7827142577fc31bd4ca536e27252b08fc28c5ed636cf5e8d |

ZIP期望值来自相邻.sha256文件，本轮匹配。两个agentdock.exe相同只证明这个文件相同，不证明插件、配置、运行态或整个runtime目录重复。所有备份/日志/凭据仍保留。

## 7. 统一布局候选（仅方案，未创建目录）

保持现有生产布局及开发主仓库绝对路径：

```text
D:\Tong\
  app\                             正式部署副本，保留原路径
  runtime\                         正式状态、manager、pin、secrets、日志与恢复
  development\                     现有主仓库及worktree，保留共同.git关系
    acceptance\tong-codex-acceptance-20261010\   计算器验收候选目标
  tools\ngrok\                     现有服务依赖，保留原路径
  state\                           仍被生产/策略/任务引用的原状态，先不移动
  archives\                        后续单独批准后才创建；不纳入源码Git
    legacy-agentdock-poc-20261010\  PoC源码、分发、原始报告、隔离证据
    legacy-agentdock-local-20261010\ 受限历史运行态，保留ACL/DPAPI/gate
    legacy-tong-desktop-control-20261012\ 完整旧Git、dirty源码及历史备份
    state-evidence\                仅容纳以后逐根证明脱离引用的冷证据
```

| 原根 | 候选新绝对根 | 逻辑大小 | 迁移约束 |
| --- | --- | --- | --- |
| D:\agentdock-poc-20261010 | D:\Tong\archives\legacy-agentdock-poc-20261010 | 1927931535 / 1.796 GiB | 保留上游.git、ZIP/SHA、隔离state；先处理当前tests默认旧根和原项目登记 |
| D:\tong-agentdock-local | D:\Tong\archives\legacy-agentdock-local-20261010 | 2686702162 / 2.502 GiB | 保留受限ACL、原始profile/pin/gate；将旧路径视为归档证据，禁止把归档profile直接启动或批量替换 |
| D:\tong-codex-acceptance-20261010 | D:\Tong\development\acceptance\tong-codex-acceptance-20261010 | 36962262 / 0.034 GiB | 未跟踪源码必须备份；.venv非可移植承诺；项目ID/root及原生会话由受管流程核验 |
| D:\tong-desktop-control | D:\Tong\archives\legacy-tong-desktop-control-20261012 | 610050568 / 0.568 GiB | 独立.git完整保留；50修改+13未跟踪和旧分支指针不丢失；不得合并覆盖当前仓库 |

归档应保留证据原貌；如果要让归档内旧脚本在新路径再次执行，应另建受控工作副本并评审固定边界、重新签发/确认授权及受支持的发布流程，不能修改原始证据伪造它当时已适配新根。不要用新junction继续冒充旧注册root：路径真实化/ACL/授权校验可能拒绝它，而且会掩盖遗漏引用。

Git维护：四个旧根中有独立仓库、上游detached源码和嵌套夹具；保留.git、全部ref（含tree检查点）及未跟踪文件，不能只clone HEAD。当前4个开发worktree不在本轮候选迁移中；若将来确需移动，须另行批准使用受支持worktree管理/repair并验证common-dir与反向gitdir、所有分支和dirty状态。不能先移动主.git再修猜测路径。

会话/登记：保留原projectId及源→目标映射，迁移前后比对权限能力且不得扩大。通过正式管理入口变更root及重核授权，保留原会话ID、writer所有权、cwd和会话历史，真实验证续接；本轮由于旧注册缺少会话工具授权，无法预先承诺续接成功。若平台不支持安全迁移，保持旧根可用并停止该批次，不以新会话替代原会话交差。

权限/数据：迁移运行态必须在原Windows账户和受支持受管流程下保持DACL/继承、所有者、完整性级别、DPAPI作用域、锁和gate依赖，不能普通拷贝后假定一致。只在未来批准的停机/快照窗口内取得SQLite一致性备份；数据库与WAL/SHM不能拆散复制，OAuth、tokens、private logs、profile中的认证信息不进入报告Git。当前报告只有元数据，没有验证这些恢复材料能否解密或还原。

资源：四旧根合计约4.900GiB。完整额外副本会新增至少约4.900GiB逻辑数据，超过项目1GB阈值；任何此类复制/打包须另行说明并获得明确资源授权，不能现在预先生成。优先复用现有可靠备份，并评估同卷受管rename所需的引用停机窗口；“同卷几乎不新增数据”也不能代替迁移授权。日志/目录项/Git对象增长需要额外余量；本轮未测归档压缩比，不能按假设比例承诺空间收益。

## 8. 分批迁移与清理清单（均未执行）

所有批次先经ChatGPT独立复核，再由用户对具体路径/大小/风险确认。下表的“备份/哈希”是后续执行前的前置条件，除第6.1节已给出的有限H1外，均未在本轮生成；不能写成已有完整备份。每一批失败只回退本批，不重置生产预算、不覆盖原始证据、不修改main。

| 批次 / 源→目标 / 大小 | 停机条件与可撤销性 | 原始备份与哈希前置 | 变更前后验证 | 用户需确认的范围 |
| --- | --- | --- | --- | --- |
| 0 冻结保留集合；五根→本报告中的路径映射；无复制 | 只读确认不需停机；没有目录变更 | 复用本报告M1/G1/H1，另记迁移窗口的最新状态；不重跑大打包 | 重核任务/进程/服务、pin、注册、Git状态；把UNKNOWN逐项关闭 | ChatGPT完成独立复核，确认哪些运行态/会话/事故证据仍需保留 |
| 1 验收缓存；计算器.pytest_cache与两个__pycache__→经批准的小型缓存备份或删除；目前根两项2,157字节，tests缓存另核 | 相关Python/pytest无占用；有副本可回退，无副本删除不能严格撤销 | 保存源码/未跟踪测试；记录精确文件列表及SHA，确认证据留存不需要缓存内容 | 前后Git源码字节/状态相同；后续正常验收才允许再生成缓存，本轮不跑 | 精确缓存路径、tests缓存大小、失去last-failed等信息；不含.venv或源码 |
| 2 旧Tong仓库；D:\tong-desktop-control→archives\legacy-tong-desktop-control-20261012；610,050,568字节 | 关闭对旧根的编辑/会话/进程占用，主生产保持不动；原根保留或完整归档可回退 | 受限完整文件/ACL清单与SHA；44ref、HEAD、dirty50、untracked13、独立.git备份；不得用clean clone替代 | 新旧refs及工作树哈希一致、remote保留；受管注册迁移、旧tests路径验证；原入口失败即回到旧root和原登记 | 归档目标、dirty材料保留、是否复制及资源；不含提交旧源码或删除依赖 |
| 3 计算器验收；旧根→development\acceptance\tong-codex-acceptance-20261010；36,962,262字节 | 结束该项目writer/运行进程后受管变更；原根与注册有备份才可回退 | 保存未跟踪calculator.py/tests、.git与权限；记录.venv/pyvenv.cfg及依赖证据；完整SHA和旧会话元数据 | 原projectId能力不扩大；真实同一会话续接、cwd/文件/Git验证；若venv需重建另批批准后才执行 | 会话门禁、注册支持能力、是否保留/重建venv；该仓库main仅保留不开发 |
| 4 PoC；D:\agentdock-poc-20261010→archives\legacy-agentdock-poc-20261010；1,927,931,535字节 | 所有PoC/旧根联调和关联任务停用窗口（需单独批准）；正式生产无需默认停 | 复用ZIP/SHA证据；补齐21嵌套标记/dirty夹具、isolated权限、原始报告哈希；额外复制>1GB须批准 | 上游HEAD/remote与dirty夹具一致；当前Run/TongRuntimeAcl/Release测试的路径适配需另批代码评审及隔离验证；旧根仍可回退 | 资源增量、PoC是否彻底退役、离线npm-cache留存；不授权运行旧live测试 |
| 5 历史运行态；D:\tong-agentdock-local→archives\legacy-agentdock-local-20261010；2,686,702,162字节 | 先证明无进程/句柄/任务/会话使用旧根；若发现任何活动写入，停止依赖该批并申请正式维护窗 | 受管一致性快照，保留secrets/gate/DPAPI/ACL、SQLite及WAL/SHM、两类恢复副本；完整哈希和对应回退根 | 只验证归档完整性；如需还原演练必须另批隔离授权；生产pin/新runtime不变；失败恢复原根/旧注册 | 高占用复制、敏感归档位置和访问控制；不能发布或以chat文字替代原生挑战 |
| 6 冷state与Disabled测试任务；逐根→archives\state-evidence\原名；按附录B逐项估算 | 先用W1/R1/S1剔除pin根、Python、服务yml、21任务引用、会话根；被引用者先保留。任务退役是独立系统变更 | 保留至少所选事故/回退代表与manifest/哈希/授权gate；不得先删加密payload或配对gate | 运行关系与恢复链无回指，任务配置/权限验证；任何误判回迁精确根并恢复已批准的登记/任务配置 | 精确根名、必要任务退役、证据留存期限和回退演练；无整组通配删除授权 |
| 7 重复依赖/发布物/旧源码副本；逐个C3/C4候选→保留集或删除；收益待闭环 | 相关源码/离线恢复/旧版本执行已退出；只有备份完整且还原验证通过才可删 | 同字节候选完整哈希、版本锁、DevSpace补丁/SQLite-native证据、保留的离线包；删除本身不可逆，须可恢复副本 | 保留版本能在受控隔离环境恢复并验证关键功能；保持主worktree共享依赖、生产app/manager及pin不变 | 明确旧副本范围、预计NTFS实际释放量与风险；不得根据35.117GiB总类别批量删除 |
| 8 日志和唯一PoC脚本；逐文件→受限证据归档或删除；按M1后续更新 | 日志轮转/写入停止需受管窗口；手动脚本使用者确认停用后处理 | 事故时间窗、正文敏感性由有权人员审查；保存必要日志与唯一脚本原件SHA；无依据不得删 | 没有运行/任务/文档必要引用；事故和回退所需证据完整；失败恢复原档 | 留存期限、外传边界、唯一脚本是否有替代；不承诺当前可删 |

每批审批说明应使用简洁中文明确：具体允许的动作、涉及的项目/文件/服务、是否属于已批准范围、最坏损失及恢复办法、授权有效窗口及是否包含后续操作。生产变更、数据删除、权限扩大和本机安全挑战继续保留人工确认；不可复用过期challenge或代填。审批前应已有可核验清单，不把通用方案视为执行授权。

## 9. 本轮异常、未知项和交付核验

- 元数据枚举：五根全部可达，无AccessDenied；跳过重解析点123+8，完整路径见附录A。未扫描D盘其他目录，只对任务相关外部配置/服务路径做存在性观察，不读取其凭据正文。
- 系统信息：ngrok进程ExecutablePath为空，未提权；未穷举所有句柄、启动注册表或外部服务配置，因此旧根是否绝无任何隐藏消费者为UNKNOWN。已观察到的Windows任务、服务和端口证据完整列出。
- Git异常：2个b22-final-regression同名嵌套.git标记返回“not a git repository”，原错误见附录C；未修复或更改safe.directory。其他无upstream/detached/无main-ref为实测状态，不误报同步成功。
- 会话/权限：历史项目不满足会话工具的文档前置能力，未尝试或绕过；没有读取rollout正文、真实工作区用户内容、密钥、令牌、Cookie、OAuth/SQLite正文或私有日志正文。数据库文件名模式在指定backend-state/home/secrets小范围元数据搜索未发现，不代表不存在其他格式或嵌在备份中的数据库；所有运行态整体保留。
- 重复性：仅H1有字节证据。大文件同大小、相同commit、相同目录名都不能证明整个目录重复；未验证目录ACL、root外硬链接、所有Git不可达对象/reflog、可重建依赖、gate配对或恢复成功。
- 复核优先级：ChatGPT先独立重核C1–C5的最小候选，查看引用、未提交/独有材料和恢复前提，再核C3的大体积依赖与C6的任务引用。不要依赖本报告作者的静态判断代替第二次独立复核。
- Git交付：仅本报告进入当前codex/024-maintenance-adapter-20261024分支的提交；提交SHA、push结果及远端同步状态以最终聊天/实际Git回执为准（文件不能自引用自己的commit SHA）。其他仓库及共享工作树既有改动保持原样；未进行main修改、force push、merge、打tag、发布或部署。

后续仍需用户决定：事故/原生会话证据的保留范围和期限；旧手动入口是否退役；四个候选目标是否接受；敏感历史运行态是否完整保留；会话工具/受管注册变更能力如何取得；是否允许超过1GB的复制以及具体维护窗口。此次授权只覆盖只读盘点、指定报告和当前开发分支的正常提交/推送，不包含上述任何执行步骤。

### 9.1 提交前实际核验结果

- 报告结构/计数核对通过：五根齐全、附录A–G齐全、state索引1609行且无重复；总字节/文件数与M1汇总一致，无草稿占位。
- H1覆盖的7组安全源码树重新比较SHA-256后无变化；其他38个Git标记的status结果与初始快照一致（包括2个原始不可识别错误），当前工作树只新增本报告，暂存区原本为空。所有原有branch ref在提交前保持一致。
- 10个稳定配置/启动文件的SHA-256与本轮先前快照相同；runtime/run/runtime.json由活动运行态自行更新，其最终phase仍为ready，sourceCommit/managerCommit仍为b9fe80150f9cdea47130e8952e85e39503187677。没有将活动状态文件哈希变化误报为本轮编辑，也没有用它证明全服务健康。
- 27个任务的已选名称/状态/路径元数据前后相同。报告的常见凭据格式检查未发现有效命中；初版宽松规则在task-*路径中产生substring误报，核对后使用带边界的规则排除，未读取或复制实际令牌正文。
- 未运行任何历史测试、构建、环境安装或恢复演练；本次属于报告、只读Git/元数据及有界源码哈希核验，不报告tests passed。git diff --cached --check、只提交本报告和push的结果另按实际回执完成交付。

## 附录 A：本次完整可达元数据统计

开始 UTC：2026-10-26T17:23:58.661550+00:00；结束 UTC：2026-10-26T17:24:41.645874+00:00。

字节为可达普通文件逻辑长度，不含目录项、被拒绝内容与重解析目标；只读元数据包含敏感文件的长度，不读取其正文。最新修改时间为可达普通文件的最大 LastWriteTime UTC，非目录自身时间。分类按路径中首先出现的类别，互斥但不穷尽。目录汇总为递归总数，不能与父目录相加。扫描期间运行态可能自行变化。

| 根 | 逻辑字节 | 文件数 | 子目录数 | 硬链接文件数 | 硬链接逻辑字节 | 异常数 | 跳过重解析点数 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D:\Tong | 41577437894 | 2295864 | 178341 | 0 | 0 | 0 | 123 |
| D:\agentdock-poc-20261010 | 1927931535 | 88815 | 11483 | 0 | 0 | 0 | 8 |
| D:\tong-agentdock-local | 2686702162 | 153173 | 10681 | 0 | 0 | 0 | 0 |
| D:\tong-codex-acceptance-20261010 | 36962262 | 2524 | 254 | 0 | 0 | 0 | 0 |
| D:\tong-desktop-control | 610050568 | 39012 | 2950 | 0 | 0 | 0 | 0 |

跨五根观察到的重复硬链接逻辑字节：0；这不是删除可释放空间，外部链接、压缩、稀疏文件、NTFS 分配簇未核验。

### A.1 D:\Tong

| 相对目录 | 递归字节 | 文件数 | 子目录数 | 最新修改 UTC |
| --- | --- | --- | --- | --- |
| app | 613321610 | 38609 | 2661 | 2026-10-26T16:28:41.313596+00:00 |
| development | 713241544 | 43073 | 3254 | 2026-10-26T17:09:15.469196+00:00 |
| development\test-temp | 129149 | 15 | 23 | 2026-10-23T14:17:30.845137+00:00 |
| development\tong-024-startup-recovery | 9901235 | 1136 | 203 | 2026-10-26T17:08:06.017728+00:00 |
| development\tong-desktop-control | 610369080 | 40659 | 2992 | 2026-10-26T17:09:15.469196+00:00 |
| development\tong-launcher-startup-recovery | 90793009 | 1100 | 20 | 2026-10-24T05:17:29.947923+00:00 |
| development\tong-startup-hotfix | 2049071 | 163 | 11 | 2026-10-17T11:03:11.637829+00:00 |
| runtime | 3020414634 | 154772 | 10737 | 2026-10-26T17:24:00.453718+00:00 |
| runtime\agentdock | 83823438 | 61 | 8 | 2026-10-06T15:22:34+00:00 |
| runtime\backend-state | 65 | 1 | 26 | 2026-10-11T23:40:50.092254+00:00 |
| runtime\home | 62088 | 3 | 7 | 2026-10-26T16:26:56.873527+00:00 |
| runtime\login-management | 40797 | 10 | 2 | 2026-10-26T13:58:19.384474+00:00 |
| runtime\logs | 242741844 | 282 | 2 | 2026-10-26T17:23:48.188077+00:00 |
| runtime\releases | 1207685974 | 76862 | 5316 | 2026-10-26T14:58:13.806272+00:00 |
| runtime\run | 229117 | 8 | 0 | 2026-10-26T17:24:00.453718+00:00 |
| runtime\secrets | 141691 | 63 | 1 | 2026-10-26T16:23:15.993484+00:00 |
| runtime\state-backups | 833896780 | 38195 | 2644 | 2026-10-11T18:32:22.705407+00:00 |
| runtime\state-restores | 645974516 | 38269 | 2662 | 2026-10-11T18:33:50.386420+00:00 |
| runtime\temp | 5805226 | 989 | 36 | 2026-10-18T15:53:34.942142+00:00 |
| runtime\tong-policy | 10366 | 13 | 1 | 2026-10-13T07:08:35.313089+00:00 |
| runtime\workspace | 1747 | 14 | 19 | 2026-10-13T07:07:29.381260+00:00 |
| state | 37197184309 | 2059407 | 161683 | 2026-10-26T16:34:15.672559+00:00 |
| tools | 33274696 | 1 | 1 | 2026-08-12T21:49:14+00:00 |
| tools\ngrok | 33274696 | 1 | 0 | 2026-08-12T21:49:14+00:00 |

| 互斥类别 | 文件数 | 逻辑字节 |
| --- | --- | --- |
| .git | 2384 | 6417860 |
| __pycache__ | 1180 | 17896309 |
| backups | 8 | 359020 |
| logs | 3760 | 507552898 |
| node_modules | 2010686 | 34618013204 |
| secrets | 895 | 1330095 |
| state-backups | 38458 | 839327487 |
| state-restores | 38293 | 646177189 |

大文件样本（元数据，最多 30 项；不得据大小直接删除）：

| 字节 | 路径 |
| --- | --- |
| 286155104 | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\offline-9850e1a\production-6ac61ad1-c9e5-4d21-8142-af1c4aa59956\payload.aes |
| 256155808 | D:\Tong\state\b23-switch-c104fcca2aa9\releases\candidate\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\state\b23-release-fgKPTn\candidate-9589698\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\state\b23-release-fgKPTn\candidate-58786f6\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\state\b23-login-fad160054f3a427083cdd8158133f62e\tong\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\state\b23-login-fad160054f3a427083cdd8158133f62e\releases\manager\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\state\b23-login-e9d0f48b0b8f492ca1d64d564334099a\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\state\b23-login-c8402fe04ce74c0d854c7b49bcb266eb\tong\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\state\b23-login-c8402fe04ce74c0d854c7b49bcb266eb\releases\manager\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\state\b23-login-c76617ef8b854278918607363200222d\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\state\b23-login-c47a39096a3448f58e66df1ff69529ea\tong\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\state\b23-login-c47a39096a3448f58e66df1ff69529ea\releases\manager\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\state\b23-login-81b0f2eacdef4468a2df33a40b27ec32\tong\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\state\b23-login-81b0f2eacdef4468a2df33a40b27ec32\releases\manager\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\state\b23-login-79aa4fb377bf4dbcaa4ff5a420fc801a\tong\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\state\b23-login-79aa4fb377bf4dbcaa4ff5a420fc801a\releases\manager\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\state\b23-login-73dd6b45a9d24d108944887667041a80\tong\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\state\b23-login-73dd6b45a9d24d108944887667041a80\releases\manager\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\offline-9850e1a\production-shadow\manager\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\offline-9850e1a\production-shadow\app\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\state\b23-login-0fd1055fb07845b6920432e3ebb02ae4\tong\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\state\b23-login-0fd1055fb07845b6920432e3ebb02ae4\releases\manager\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\state\b23-login-0ed80812a8be4a0388a9372035e86c6b\tong\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\state\b23-login-0ed80812a8be4a0388a9372035e86c6b\releases\manager\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\runtime\state-restores\20261012-b24-initial-extras\production\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\runtime\state-backups\20261012-b24-retained-old-dependencies\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\runtime\releases\manager\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\runtime\releases\candidate\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\development\tong-desktop-control\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\Tong\app\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |

Git 标记（包括测试夹具；标记本身不等于独立真实开发仓库）：

- `D:\Tong\development\tong-024-startup-recovery\.git`
- `D:\Tong\development\tong-desktop-control\.git`
- `D:\Tong\development\tong-launcher-startup-recovery\.git`
- `D:\Tong\development\tong-startup-hotfix\.git`
- `D:\Tong\runtime\workspace\b23-acceptance\.git`
- `D:\Tong\state\b22-final-regression-1a1e4a54fecf\tong-dock-execution-jt7cHg\project\.git`
- `D:\Tong\state\b23-switch-c104fcca2aa9\workspace\project\.git`
- `D:\Tong\state\b24-closeout-20261012-9a87f321\live-workspace\project\.git`
- `D:\Tong\state\b24-closeout-20261012-9a87f321-live2\live-workspace\project\.git`
- `D:\Tong\state\b24-closeout-20261012-9a87f321-live3\live-workspace\project\.git`
- `D:\Tong\state\b24-closeout-20261012-live4\live-workspace\project\.git`
- `D:\Tong\state\b24-closeout-20261012-live5\live-workspace\project\.git`
- `D:\Tong\state\b24-closeout-20261012-live6-candidate\live-workspace\project\.git`

异常（不提权、不绕过）：

无枚举/元数据异常。


重解析点（不跟随目标）：

- `D:\Tong\development\test-temp\tong-desktop-control\tong-p0-Vut22K\read-only\redirect`
- `D:\Tong\development\tong-024-startup-recovery\node_modules`
- `D:\Tong\development\tong-launcher-startup-recovery\node_modules`
- `D:\Tong\development\tong-startup-hotfix\node_modules`
- `D:\Tong\state\b22-backup-GRWlVO\junction-snapshot\runtime\workspace\junction`
- `D:\Tong\state\b23-login-0bef070049554f829ed6386059d39fd1\node_modules`
- `D:\Tong\state\b23-login-0d24d63134d945da851847a7724ab383\node_modules`
- `D:\Tong\state\b23-login-0d49a875258b4d8e8580e983ee73bbf0\node_modules`
- `D:\Tong\state\b23-login-0d65026b15164611ba0607167c47365c\node_modules`
- `D:\Tong\state\b23-login-10bec88eec884c1f9bd4e52e2dd76570\node_modules`
- `D:\Tong\state\b23-login-1a7a49f52aea4eb6b65991fca3ad5290\node_modules`
- `D:\Tong\state\b23-login-1db692fcb5c143699e1dc8677bd9848f\node_modules`
- `D:\Tong\state\b23-login-1e9c1caed8f947b5832a4b06412169e4\node_modules`
- `D:\Tong\state\b23-login-265c3ffeafc34618b5880bfdace77247\node_modules`
- `D:\Tong\state\b23-login-27e3a3ea09844f42b660d09e2107efc2\node_modules`
- `D:\Tong\state\b23-login-2e39873b27474c0fb147296b0773cafb\node_modules`
- `D:\Tong\state\b23-login-2e573d5ae30143d79fbb64270d397955\024-handoff`
- `D:\Tong\state\b23-login-323b803d67ba4c3dabfb11009175fab7\node_modules`
- `D:\Tong\state\b23-login-3f01af7688dd41f8bd7f94bc5bd2f2eb\node_modules`
- `D:\Tong\state\b23-login-418d7372f08d4e2e8a8559300f1c38a0\node_modules`
- `D:\Tong\state\b23-login-441c2bed0dd0463faeab92dd43c19a8f\node_modules`
- `D:\Tong\state\b23-login-545d5f2ee2554067a7925a5d23f41533\node_modules`
- `D:\Tong\state\b23-login-5ac1158aaed44d87bb280b4a63878583\node_modules`
- `D:\Tong\state\b23-login-5b7bc475924e49dbbf5f6e26ec32752e\node_modules`
- `D:\Tong\state\b23-login-5d8c56109d3e48cead09f3f77f5e5b5b\node_modules`
- `D:\Tong\state\b23-login-62bbe80fa92a44e4a0ab3674df29505a\node_modules`
- `D:\Tong\state\b23-login-66c841c5c97d452885fd3378d42d3dcb\node_modules`
- `D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\node_modules`
- `D:\Tong\state\b23-login-6807a9f430eb47c5bd5208001f10af13\node_modules`
- `D:\Tong\state\b23-login-70f1b7d66215458c8ffa0d822348de0f\node_modules`
- `D:\Tong\state\b23-login-70f1b7d66215458c8ffa0d822348de0f\tong\demo-workspace\task-originals-06a83195afdd44088584396fcc0ed62c-junction`
- `D:\Tong\state\b23-login-70f1b7d66215458c8ffa0d822348de0f\tong\demo-workspace\task-originals-0730b7a698ed448f93bcd23a79488de7-junction`
- `D:\Tong\state\b23-login-70f1b7d66215458c8ffa0d822348de0f\tong\demo-workspace\task-originals-1ce272f4d1dd4e15b180d75c1d7c54d7-recovered-junction`
- `D:\Tong\state\b23-login-70f1b7d66215458c8ffa0d822348de0f\tong\demo-workspace\task-originals-4b8b5a4833894958a1662d711da85a71-junction`
- `D:\Tong\state\b23-login-70f1b7d66215458c8ffa0d822348de0f\tong\demo-workspace\task-originals-764e133745724ce8a96d62fc5f27a538-junction`
- `D:\Tong\state\b23-login-70f1b7d66215458c8ffa0d822348de0f\tong\demo-workspace\task-originals-95b078158ea64fb5b38a1fd9c6b176c8-junction`
- `D:\Tong\state\b23-login-70f1b7d66215458c8ffa0d822348de0f\tong\demo-workspace\task-originals-ede2a2f8b1664b7793b293a94ec863d6-recovered-junction`
- `D:\Tong\state\b23-login-7144ec3881c647c2a828fe32594ed95e\node_modules`
- `D:\Tong\state\b23-login-76ac3ffb620749e48d5f9b580355c8da\node_modules`
- `D:\Tong\state\b23-login-7d15d8468b4243e68c950149d283b4c9\node_modules`
- `D:\Tong\state\b23-login-8042d30a8a704fd5a1fdd15609daeb28\node_modules`
- `D:\Tong\state\b23-login-8326653867004f8a8a5154246d51dd5f\node_modules`
- `D:\Tong\state\b23-login-8531908df0964817a9607fc53de99134\node_modules`
- `D:\Tong\state\b23-login-880a9179c44e47cc879ec8647a3a7069\node_modules`
- `D:\Tong\state\b23-login-8b714d5785e449359e5080e5934a48c4\node_modules`
- `D:\Tong\state\b23-login-8d6797f9f775488ab6e2fd926beea110\node_modules`
- `D:\Tong\state\b23-login-8e32da332608430bb4971bc668ef4ace\node_modules`
- `D:\Tong\state\b23-login-8fe476c895004ce6b9a6619319321933\node_modules`
- `D:\Tong\state\b23-login-94b114de92074a2688c4012911fbeb48\node_modules`
- `D:\Tong\state\b23-login-9673e077810a427e92c15e75f3f64387\node_modules`
- `D:\Tong\state\b23-login-97bb5883a2f14906a4263957896c58cb\node_modules`
- `D:\Tong\state\b23-login-9f249bbdf85d4a998471195c4e9230ee\node_modules`
- `D:\Tong\state\b23-login-a3cac9aa457e44b59cc729d0f27d11de\node_modules`
- `D:\Tong\state\b23-login-a58341e88f0d413999226fcae1111a6c\node_modules`
- `D:\Tong\state\b23-login-a7b160223e374943aa0472d998edf9cf\node_modules`
- `D:\Tong\state\b23-login-aea84ef140a443feae723fff055316ef\node_modules`
- `D:\Tong\state\b23-login-aeaf8771eb534d7eb9233ca6b2479f8c\node_modules`
- `D:\Tong\state\b23-login-b630e8a13f1c46319b6380a4ffdffe7a\node_modules`
- `D:\Tong\state\b23-login-b7ebc6db0ba04085b2ebd8f73f6475d6\node_modules`
- `D:\Tong\state\b23-login-b9cced3b74374514a14cedecf2e006bf\node_modules`
- `D:\Tong\state\b23-login-bbd2ec203e484afaac4a6f623e1dc1ee\node_modules`
- `D:\Tong\state\b23-login-bec438cce2fc44bcb183be01a344d109\node_modules`
- `D:\Tong\state\b23-login-bf99e21514af4789b441251ecd80111e\node_modules`
- `D:\Tong\state\b23-login-c25c50fc43c948b4a5c9c1abd45c8173\node_modules`
- `D:\Tong\state\b23-login-c2db39cf150c44d584691538559dce3d\node_modules`
- `D:\Tong\state\b23-login-c2db39cf150c44d584691538559dce3d\tong\demo-workspace\task-originals-ac981ec2e1e84fc586596a5b25d68599-recovered-junction`
- `D:\Tong\state\b23-login-c2db39cf150c44d584691538559dce3d\tong\demo-workspace\task-originals-dc7b27aa9a5741a8aa26dc8486c120af-junction`
- `D:\Tong\state\b23-login-c2db39cf150c44d584691538559dce3d\tong\demo-workspace\task-originals-e1437313add449f199740eb871c2e232-recovered-junction`
- `D:\Tong\state\b23-login-c2db39cf150c44d584691538559dce3d\tong\demo-workspace\task-originals-f45ffd4aefa947268233b4064aae3243-junction`
- `D:\Tong\state\b23-login-c6817ad801074fdbb458f543b3ee3749\node_modules`
- `D:\Tong\state\b23-login-cfda1f22bf7e4718a99b35edcb28d35b\node_modules`
- `D:\Tong\state\b23-login-d0bf1375f841438abb20d3ae7ad50ca2\node_modules`
- `D:\Tong\state\b23-login-d12ae22d7fa348ad8766ad03321e67c0\node_modules`
- `D:\Tong\state\b23-login-daf14840b8ca400990162e06934a626b\node_modules`
- `D:\Tong\state\b23-login-e14363181d8947b3b5e60d4e81e3b0ac\node_modules`
- `D:\Tong\state\b23-login-e4a3902cc7f94877b4e7232ace4bcc91\node_modules`
- `D:\Tong\state\b23-login-e5280946272f43bdb7bcb66cd423ca42\node_modules`
- `D:\Tong\state\b23-login-e63f3c0dfb1248bbb29efa3160e76232\node_modules`
- `D:\Tong\state\b23-login-ebaae071dfd54cbea5380d4cf27fe34a\node_modules`
- `D:\Tong\state\b23-login-ef7b0357716c4775b34784932aa0a4f8\node_modules`
- `D:\Tong\state\b23-login-f0672e63172a4b39988458a4cd81fa4f\node_modules`
- `D:\Tong\state\b23-login-f408bf5bbbc14e818fb83a73d7fd2b92\node_modules`
- `D:\Tong\state\b23-login-feccea46c7964cafa14bde4b811f5ffb\node_modules`
- `D:\Tong\state\b23-maint-22VfBb\tong`
- `D:\Tong\state\b23-maint-4ixJdP\tong`
- `D:\Tong\state\b23-maint-aoZN7h\tong`
- `D:\Tong\state\b23-maint-Bg35j4\tong`
- `D:\Tong\state\b23-maint-cEo1pJ\tong`
- `D:\Tong\state\b23-maint-ivQ9Rd\tong`
- `D:\Tong\state\b23-maint-lS9jTg\tong`
- `D:\Tong\state\b23-maint-native-9b317b949460486f92ac4c2002304bf5\node_modules`
- `D:\Tong\state\b23-maint-native-ab2ecf441a184dcaa798023010f3e70f\node_modules`
- `D:\Tong\state\b23-maint-native-bd23505c410c4569be6bd5285a87e8ef\node_modules`
- `D:\Tong\state\b23-maint-NqfeF6\tong`
- `D:\Tong\state\b23-maint-vfqcut\tong`
- `D:\Tong\state\b23-maint-xY1Wzw\tong`
- `D:\Tong\state\b23-maint-YJ7Gx0\tong`
- `D:\Tong\state\b23-path-link-2653040f-53d2-42ee-8dd4-16c3af552c66`
- `D:\Tong\state\b23-path-link-b5fbe92f-543f-48de-92fc-a6fe7d2a7689`
- `D:\Tong\state\b23-profile-1f744ba843e9da-nested\run\linked`
- `D:\Tong\state\b23-profile-96c5ec7a0dfd7e-nested\run\linked`
- `D:\Tong\state\b23-profile-ab6bf39799f790-nested\run\linked`
- `D:\Tong\state\b23-profile-c4cd824d9a68d7-nested\run\linked`
- `D:\Tong\state\b23-simulation-approvals\simulation-11e93671e5b7fbea7d3953f372212b5a43dc65ce617b78a481e383052207829c.restore.current.dpapi.json`
- `D:\Tong\state\b23-simulation-approvals\simulation-baf51642b36c0ba40e270b064efebf5036cc45d7e39094d5e6ebf7f14e1b9e69.restore.current.dpapi.json`
- `D:\Tong\state\b23-simulation-approvals\simulation-e27f8c54434d7d24eeb6252358ef3e8ad6254e15c7d133489255a8c604dddacd.restore.current.dpapi.json`
- `D:\Tong\state\comm-chmod-a8223c56366a45a0a2ec87f6ba4608f9\bridge-junction`
- `D:\Tong\state\comm-chmod-aa9f9c50305c46be8795065eff275c77\bridge-junction`
- `D:\Tong\state\legacy-024-9uQr3e\junction-retired\legacy-evidence-01841897-a193-4c9d-8368-98797d21d1af\retired`
- `D:\Tong\state\legacy-024-9uQr3e\junction-run\run`
- `D:\Tong\state\legacy-024-cQCtPq\junction-retired\legacy-evidence-207dae52-0414-41b3-ae58-28b6e5a7af20\retired`
- `D:\Tong\state\legacy-024-cQCtPq\junction-run\run`
- `D:\Tong\state\legacy-024-D5ReJv\junction-retired\legacy-evidence-4d530648-9f81-411b-bb58-9efed22a0628\retired`
- `D:\Tong\state\legacy-024-D5ReJv\junction-run\run`
- `D:\Tong\state\legacy-024-L4JOrR\junction-retired\legacy-evidence-4acbcec9-04ea-4b7e-abdb-10775d2c3130\retired`
- `D:\Tong\state\legacy-024-L4JOrR\junction-run\run`
- `D:\Tong\state\legacy-024-U7PMk7\junction-retired\legacy-evidence-12442f4d-ca38-426e-9daf-4ed37d7926bf\retired`
- `D:\Tong\state\legacy-024-U7PMk7\junction-run\run`
- `D:\Tong\state\synthetic-test-9yIMC9\recovery-files-fb5Dzh\retained-refused-junction`
- `D:\Tong\state\synthetic-test-DhL7cJ\recovery-files-yIfqKJ\retained-refused-junction`
- `D:\Tong\state\synthetic-test-E6z5Fz\recovery-files-9bndoD\retained-refused-junction`
- `D:\Tong\state\synthetic-test-lyJayr\recovery-files-xGS0C1\retained-refused-junction`
- `D:\Tong\state\synthetic-test-rMHMZV\recovery-files-qoHg6I\app\foreign-junction`

### A.2 D:\agentdock-poc-20261010

| 相对目录 | 递归字节 | 文件数 | 子目录数 | 最新修改 UTC |
| --- | --- | --- | --- | --- |
| __pycache__ | 6130 | 1 | 0 | 2026-10-10T13:55:33.054263+00:00 |
| agentdock | 16224149 | 953 | 133 | 2026-10-10T13:37:23.768972+00:00 |
| isolated | 1586084207 | 85551 | 10062 | 2026-10-24T04:44:39.522209+00:00 |
| npm-cache | 189059645 | 683 | 1049 | 2026-10-10T14:29:32.981703+00:00 |
| p243-live-2f3REJ | 58 | 3 | 3 | 2026-10-10T16:46:33.808172+00:00 |
| p243-live-9p3vnH | 58 | 3 | 3 | 2026-10-10T16:39:19.576643+00:00 |
| p243-live-GSsgZc | 58 | 3 | 3 | 2026-10-10T14:42:33.745205+00:00 |
| p243-live-UdcyF6 | 58 | 3 | 3 | 2026-10-10T18:49:03.236746+00:00 |
| p243-live-p8eLyl | 41 | 2 | 2 | 2026-10-10T14:34:51.447399+00:00 |
| p243-live-xP3nID | 58 | 3 | 3 | 2026-10-10T16:49:00.997912+00:00 |
| p243-tests | 0 | 0 | 0 | - |
| runtime | 83823438 | 61 | 8 | 2026-10-06T15:22:34+00:00 |
| synthetic-project | 23443130 | 1534 | 201 | 2026-10-10T13:56:15.191994+00:00 |

| 互斥类别 | 文件数 | 逻辑字节 |
| --- | --- | --- |
| .git | 601 | 9373234 |
| .pytest_cache | 4 | 578 |
| .venv | 1497 | 23412845 |
| __pycache__ | 1183 | 17904572 |
| logs | 325 | 625744 |
| node_modules | 77835 | 1285452159 |
| secrets | 84 | 32070 |
| state-backups | 6 | 26312 |
| state-restores | 5 | 7829 |

大文件样本（元数据，最多 30 项；不得据大小直接删除）：

| 字节 | 路径 |
| --- | --- |
| 256155808 | D:\agentdock-poc-20261010\isolated\state\b23-release-fgKPTn\candidate-9589698\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\agentdock-poc-20261010\isolated\state\b23-release-fgKPTn\candidate-58786f6\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 115935984 | D:\agentdock-poc-20261010\npm-cache\_cacache\content-v2\sha512\49\56\880c7b690b0334af49bd8f3b9ed54ef292d219d5e2614753b77b45021d84c996e6885edcb99ba0f3aa11b8ae39c4a0d944025f6b40ba8f8a04bf479f8889 |
| 115935984 | D:\agentdock-poc-20261010\isolated\state\b23-release-fgKPTn\npm-cache\_cacache\content-v2\sha512\49\56\880c7b690b0334af49bd8f3b9ed54ef292d219d5e2614753b77b45021d84c996e6885edcb99ba0f3aa11b8ae39c4a0d944025f6b40ba8f8a04bf479f8889 |
| 29230453 | D:\agentdock-poc-20261010\agentdock_windows_amd64.zip |
| 24877600 | D:\agentdock-poc-20261010\runtime\control-panel\Microsoft.Windows.SDK.NET.dll |
| 23598826 | D:\agentdock-poc-20261010\isolated\state\b23-b24-production-prep-20261012\acl-before.json |
| 21929064 | D:\agentdock-poc-20261010\runtime\agentdock.exe |
| 18752276 | D:\agentdock-poc-20261010\isolated\state\b23-b24-production-prep-20261012\acl-after.json |
| 15468777 | D:\agentdock-poc-20261010\npm-cache\_cacache\content-v2\sha512\db\42\6ab6eb58e893d74d49cbd228f5b9a77b41ed5b693e3a972a25876b1210d0dde2c4f3299e279801647800110cac2694b8cfc7a5ca465c11531c233b2fa552 |
| 15468777 | D:\agentdock-poc-20261010\isolated\state\b23-release-fgKPTn\npm-cache\_cacache\content-v2\sha512\db\42\6ab6eb58e893d74d49cbd228f5b9a77b41ed5b693e3a972a25876b1210d0dde2c4f3299e279801647800110cac2694b8cfc7a5ca465c11531c233b2fa552 |
| 9507980 | D:\agentdock-poc-20261010\isolated\state\b23-release-fgKPTn\candidate-9589698\node_modules\better-sqlite3\deps\sqlite3\sqlite3.c |
| 9507980 | D:\agentdock-poc-20261010\isolated\state\b23-release-fgKPTn\candidate-58786f6\node_modules\better-sqlite3\deps\sqlite3\sqlite3.c |
| 8242819 | D:\agentdock-poc-20261010\agentdock\.git\objects\pack\pack-5b8e1c9472ebfb3b7ca164a64e88ea58b0a3cff2.pack |
| 7807584 | D:\agentdock-poc-20261010\runtime\agentdock-arbiter.exe |
| 7328568 | D:\agentdock-poc-20261010\runtime\control-panel\Microsoft.WinUI.dll |
| 6467584 | D:\agentdock-poc-20261010\isolated\state\b23-release-fgKPTn\candidate-9589698\node_modules\node-pty\prebuilds\win32-x64\conpty.pdb |
| 6467584 | D:\agentdock-poc-20261010\isolated\state\b23-release-fgKPTn\candidate-58786f6\node_modules\node-pty\prebuilds\win32-x64\conpty.pdb |
| 6279168 | D:\agentdock-poc-20261010\isolated\state\b23-release-fgKPTn\candidate-9589698\node_modules\node-pty\prebuilds\win32-x64\pty.pdb |
| 6279168 | D:\agentdock-poc-20261010\isolated\state\b23-release-fgKPTn\candidate-58786f6\node_modules\node-pty\prebuilds\win32-x64\pty.pdb |
| 6090752 | D:\agentdock-poc-20261010\isolated\state\b23-release-fgKPTn\candidate-9589698\node_modules\node-pty\prebuilds\win32-x64\winpty-agent.pdb |
| 6090752 | D:\agentdock-poc-20261010\isolated\state\b23-release-fgKPTn\candidate-58786f6\node_modules\node-pty\prebuilds\win32-x64\winpty-agent.pdb |
| 6066176 | D:\agentdock-poc-20261010\isolated\state\b23-release-fgKPTn\candidate-9589698\node_modules\node-pty\prebuilds\win32-arm64\conpty.pdb |
| 6066176 | D:\agentdock-poc-20261010\isolated\state\b23-release-fgKPTn\candidate-58786f6\node_modules\node-pty\prebuilds\win32-arm64\conpty.pdb |
| 5902336 | D:\agentdock-poc-20261010\isolated\state\b23-release-fgKPTn\candidate-9589698\node_modules\node-pty\prebuilds\win32-arm64\pty.pdb |
| 5902336 | D:\agentdock-poc-20261010\isolated\state\b23-release-fgKPTn\candidate-58786f6\node_modules\node-pty\prebuilds\win32-arm64\pty.pdb |
| 5648384 | D:\agentdock-poc-20261010\isolated\state\b23-release-fgKPTn\candidate-9589698\node_modules\node-pty\prebuilds\win32-arm64\winpty-agent.pdb |
| 5648384 | D:\agentdock-poc-20261010\isolated\state\b23-release-fgKPTn\candidate-58786f6\node_modules\node-pty\prebuilds\win32-arm64\winpty-agent.pdb |
| 5369856 | D:\agentdock-poc-20261010\isolated\state\b23-release-fgKPTn\candidate-9589698\node_modules\node-pty\prebuilds\win32-x64\winpty.pdb |
| 5369856 | D:\agentdock-poc-20261010\isolated\state\b23-release-fgKPTn\candidate-58786f6\node_modules\node-pty\prebuilds\win32-x64\winpty.pdb |

Git 标记（包括测试夹具；标记本身不等于独立真实开发仓库）：

- `D:\agentdock-poc-20261010\agentdock\.git`
- `D:\agentdock-poc-20261010\isolated\state\b22-final-regression-1a1e4a54fecf\tong-dock-execution-jt7cHg\project\.git`
- `D:\agentdock-poc-20261010\isolated\state\b24-closeout-20261012-9a87f321\live-workspace\project\.git`
- `D:\agentdock-poc-20261010\isolated\state\b24-closeout-20261012-9a87f321-live2\live-workspace\project\.git`
- `D:\agentdock-poc-20261010\isolated\state\b24-closeout-20261012-9a87f321-live3\live-workspace\project\.git`
- `D:\agentdock-poc-20261010\isolated\state\b24-closeout-20261012-live4\live-workspace\project\.git`
- `D:\agentdock-poc-20261010\isolated\state\b24-closeout-20261012-live5\live-workspace\project\.git`
- `D:\agentdock-poc-20261010\isolated\state\b24-closeout-20261012-live6-candidate\live-workspace\project\.git`
- `D:\agentdock-poc-20261010\isolated\workspace\b1-project-auyRBB\project\.git`
- `D:\agentdock-poc-20261010\isolated\workspace\b1-project-b530tu\project\.git`
- `D:\agentdock-poc-20261010\isolated\workspace\b1-project-eCJEwj\project\.git`
- `D:\agentdock-poc-20261010\isolated\workspace\b1-project-hicCjs\project\.git`
- `D:\agentdock-poc-20261010\isolated\workspace\b1-project-V62iB2\project\.git`
- `D:\agentdock-poc-20261010\isolated\workspace\p244-synthetic-0GapOL\project\.git`
- `D:\agentdock-poc-20261010\isolated\workspace\p244-synthetic-7FoL0W\project\.git`
- `D:\agentdock-poc-20261010\isolated\workspace\p244-synthetic-aLBjYf\project\.git`
- `D:\agentdock-poc-20261010\isolated\workspace\p244-synthetic-d0J7cS\project\.git`
- `D:\agentdock-poc-20261010\isolated\workspace\p244-synthetic-emt5QS\project\.git`
- `D:\agentdock-poc-20261010\isolated\workspace\p244-synthetic-V7pzuv\project\.git`
- `D:\agentdock-poc-20261010\isolated\workspace\p244-synthetic-WryMt7\project\.git`
- `D:\agentdock-poc-20261010\isolated\workspace\p244-synthetic-WWQpJD\project\.git`
- `D:\agentdock-poc-20261010\isolated\workspace\p244-synthetic-xz3TOs\project\.git`
- `D:\agentdock-poc-20261010\synthetic-project\.git`

异常（不提权、不绕过）：

无枚举/元数据异常。


重解析点（不跟随目标）：

- `D:\agentdock-poc-20261010\isolated\state\b23-profile-07690de8d49f87-nested\run\linked`
- `D:\agentdock-poc-20261010\isolated\state\b23-profile-32e366070aef5a-nested\run\linked`
- `D:\agentdock-poc-20261010\isolated\state\b23-profile-5abcb99e98aa68-nested\run\linked`
- `D:\agentdock-poc-20261010\isolated\state\b23-profile-6b6440915bef47-nested\run\linked`
- `D:\agentdock-poc-20261010\isolated\state\b23-profile-743c6d584ff8d7-nested\run\linked`
- `D:\agentdock-poc-20261010\isolated\state\b23-profile-87d27751761d5c-nested\run\linked`
- `D:\agentdock-poc-20261010\isolated\state\b23-profile-95955d97af55df-nested\run\linked`
- `D:\agentdock-poc-20261010\isolated\state\b23-profile-b7b31777e421ad-nested\run\linked`

### A.3 D:\tong-agentdock-local

| 相对目录 | 递归字节 | 文件数 | 子目录数 | 最新修改 UTC |
| --- | --- | --- | --- | --- |
| backend-state | 65 | 1 | 26 | 2026-10-11T23:40:50.092254+00:00 |
| home | 62088 | 3 | 7 | 2026-10-12T19:24:12.014687+00:00 |
| logs | 1814744 | 43 | 0 | 2026-10-12T19:58:49.743737+00:00 |
| releases | 1204761974 | 76578 | 5302 | 2026-10-12T16:31:54.170903+00:00 |
| run | 182278 | 60 | 9 | 2026-10-12T19:58:49.733041+00:00 |
| secrets | 531 | 1 | 0 | 2026-10-11T17:56:07.649165+00:00 |
| state-backups | 833896780 | 38195 | 2644 | 2026-10-11T18:32:22.705407+00:00 |
| state-restores | 645974516 | 38269 | 2662 | 2026-10-11T18:33:50.386420+00:00 |
| temp | 485 | 1 | 0 | 2026-10-12T19:15:57.750544+00:00 |
| tong-policy | 5906 | 6 | 1 | 2026-10-12T17:31:55.104338+00:00 |
| workspace | 1727 | 14 | 19 | 2026-10-12T04:16:40.916098+00:00 |

| 互斥类别 | 文件数 | 逻辑字节 |
| --- | --- | --- |
| .git | 12 | 1507 |
| logs | 43 | 1814744 |
| node_modules | 76350 | 1202124958 |
| secrets | 2 | 596 |
| state-backups | 38195 | 833896780 |
| state-restores | 38269 | 645974516 |

大文件样本（元数据，最多 30 项；不得据大小直接删除）：

| 字节 | 路径 |
| --- | --- |
| 256155808 | D:\tong-agentdock-local\state-restores\20261012-b24-initial-extras\production\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\tong-agentdock-local\state-backups\20261012-b24-retained-old-dependencies\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\tong-agentdock-local\releases\manager\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 256155808 | D:\tong-agentdock-local\releases\candidate\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 217198070 | D:\tong-agentdock-local\state-backups\20261012-b24-initial-extras\extras.dpapi.bin |
| 23598826 | D:\tong-agentdock-local\state-restores\20261012-b24-initial-extras\metadata\acl-before.json |
| 18752276 | D:\tong-agentdock-local\state-restores\20261012-b24-initial-extras\metadata\acl-after.json |
| 14126047 | D:\tong-agentdock-local\state-backups\20261012-b24-initial-extras\extras-manifest.json |
| 9507980 | D:\tong-agentdock-local\state-restores\20261012-b24-initial-extras\production\node_modules\better-sqlite3\deps\sqlite3\sqlite3.c |
| 9507980 | D:\tong-agentdock-local\state-backups\20261012-b24-retained-old-dependencies\node_modules\better-sqlite3\deps\sqlite3\sqlite3.c |
| 9507980 | D:\tong-agentdock-local\releases\manager\node_modules\better-sqlite3\deps\sqlite3\sqlite3.c |
| 9507980 | D:\tong-agentdock-local\releases\candidate\node_modules\better-sqlite3\deps\sqlite3\sqlite3.c |
| 6467584 | D:\tong-agentdock-local\state-restores\20261012-b24-initial-extras\production\node_modules\node-pty\prebuilds\win32-x64\conpty.pdb |
| 6467584 | D:\tong-agentdock-local\state-backups\20261012-b24-retained-old-dependencies\node_modules\node-pty\prebuilds\win32-x64\conpty.pdb |
| 6467584 | D:\tong-agentdock-local\releases\manager\node_modules\node-pty\prebuilds\win32-x64\conpty.pdb |
| 6467584 | D:\tong-agentdock-local\releases\candidate\node_modules\node-pty\prebuilds\win32-x64\conpty.pdb |
| 6279168 | D:\tong-agentdock-local\state-restores\20261012-b24-initial-extras\production\node_modules\node-pty\prebuilds\win32-x64\pty.pdb |
| 6279168 | D:\tong-agentdock-local\state-backups\20261012-b24-retained-old-dependencies\node_modules\node-pty\prebuilds\win32-x64\pty.pdb |
| 6279168 | D:\tong-agentdock-local\releases\manager\node_modules\node-pty\prebuilds\win32-x64\pty.pdb |
| 6279168 | D:\tong-agentdock-local\releases\candidate\node_modules\node-pty\prebuilds\win32-x64\pty.pdb |
| 6090752 | D:\tong-agentdock-local\state-restores\20261012-b24-initial-extras\production\node_modules\node-pty\prebuilds\win32-x64\winpty-agent.pdb |
| 6090752 | D:\tong-agentdock-local\state-backups\20261012-b24-retained-old-dependencies\node_modules\node-pty\prebuilds\win32-x64\winpty-agent.pdb |
| 6090752 | D:\tong-agentdock-local\releases\manager\node_modules\node-pty\prebuilds\win32-x64\winpty-agent.pdb |
| 6090752 | D:\tong-agentdock-local\releases\candidate\node_modules\node-pty\prebuilds\win32-x64\winpty-agent.pdb |
| 6066176 | D:\tong-agentdock-local\state-restores\20261012-b24-initial-extras\production\node_modules\node-pty\prebuilds\win32-arm64\conpty.pdb |
| 6066176 | D:\tong-agentdock-local\state-backups\20261012-b24-retained-old-dependencies\node_modules\node-pty\prebuilds\win32-arm64\conpty.pdb |
| 6066176 | D:\tong-agentdock-local\releases\manager\node_modules\node-pty\prebuilds\win32-arm64\conpty.pdb |
| 6066176 | D:\tong-agentdock-local\releases\candidate\node_modules\node-pty\prebuilds\win32-arm64\conpty.pdb |
| 5902336 | D:\tong-agentdock-local\state-restores\20261012-b24-initial-extras\production\node_modules\node-pty\prebuilds\win32-arm64\pty.pdb |
| 5902336 | D:\tong-agentdock-local\state-backups\20261012-b24-retained-old-dependencies\node_modules\node-pty\prebuilds\win32-arm64\pty.pdb |

Git 标记（包括测试夹具；标记本身不等于独立真实开发仓库）：

- `D:\tong-agentdock-local\workspace\b23-acceptance\.git`

异常（不提权、不绕过）：

无枚举/元数据异常。


重解析点（不跟随目标）：

无。


### A.4 D:\tong-codex-acceptance-20261010

| 相对目录 | 递归字节 | 文件数 | 子目录数 | 最新修改 UTC |
| --- | --- | --- | --- | --- |
| .git | 27307 | 27 | 15 | 2026-10-10T05:04:17.706841+00:00 |
| .pytest_cache | 1519 | 4 | 2 | 2026-10-10T05:37:13.622905+00:00 |
| .venv | 36925257 | 2487 | 231 | 2026-10-10T05:37:13.603100+00:00 |
| __pycache__ | 638 | 1 | 0 | 2026-10-10T05:37:13.609001+00:00 |
| tests | 7323 | 2 | 1 | 2026-10-10T05:37:13.609001+00:00 |

| 互斥类别 | 文件数 | 逻辑字节 |
| --- | --- | --- |
| .git | 27 | 27307 |
| .pytest_cache | 4 | 1519 |
| .venv | 2487 | 36925257 |
| __pycache__ | 2 | 6832 |

大文件样本（元数据，最多 30 项；不得据大小直接删除）：

| 字节 | 路径 |
| --- | --- |
| 295439 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\pip\_vendor\pyparsing\__pycache__\core.cpython-311.pyc |
| 281617 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\pip\_vendor\certifi\cacert.pem |
| 277645 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\pkg_resources\_vendor\pyparsing\__pycache__\core.cpython-311.pyc |
| 277642 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\setuptools\_vendor\pyparsing\__pycache__\core.cpython-311.pyc |
| 274712 | D:\tong-codex-acceptance-20261010\.venv\Scripts\python.exe |
| 269900 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\setuptools\config\_validate_pyproject\fastjsonschema_validations.py |
| 263448 | D:\tong-codex-acceptance-20261010\.venv\Scripts\pythonw.exe |
| 224445 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\pip\_vendor\pyparsing\core.py |
| 213310 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\setuptools\_vendor\pyparsing\core.py |
| 213310 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\pkg_resources\_vendor\pyparsing\core.py |
| 208522 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\pip\_vendor\rich\__pycache__\_emoji_codes.cpython-311.pyc |
| 206539 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\pip\_vendor\idna\uts46data.py |
| 192643 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\setuptools\config\_validate_pyproject\__pycache__\fastjsonschema_validations.cpython-311.pyc |
| 182784 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\pip\_vendor\distlib\t64-arm.exe |
| 168448 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\pip\_vendor\distlib\w64-arm.exe |
| 167962 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\pkg_resources\_vendor\more_itertools\__pycache__\more.cpython-311.pyc |
| 163197 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\pip\_vendor\idna\__pycache__\uts46data.cpython-311.pyc |
| 160142 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\pip\_vendor\pkg_resources\__pycache__\__init__.cpython-311.pyc |
| 159572 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\pkg_resources\__pycache__\__init__.cpython-311.pyc |
| 157900 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\pygments\lexers\lisp.py |
| 149184 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\setuptools\_vendor\more_itertools\__pycache__\more.cpython-311.pyc |
| 140235 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\pip\_vendor\rich\_emoji_codes.py |
| 137728 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\setuptools\gui-arm64.exe |
| 137216 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\setuptools\cli-arm64.exe |
| 134513 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\pygments\lexers\_lasso_builtins.py |
| 132992 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\pygments\lexers\matlab.py |
| 132569 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\pkg_resources\_vendor\more_itertools\more.py |
| 131583 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\pip\_vendor\__pycache__\typing_extensions.cpython-311.pyc |
| 128035 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\pip\_vendor\chardet\langrussianmodel.py |
| 123741 | D:\tong-codex-acceptance-20261010\.venv\Lib\site-packages\pip\_vendor\rich\__pycache__\console.cpython-311.pyc |

Git 标记（包括测试夹具；标记本身不等于独立真实开发仓库）：

- `D:\tong-codex-acceptance-20261010\.git`

异常（不提权、不绕过）：

无枚举/元数据异常。


重解析点（不跟随目标）：

无。


### A.5 D:\tong-desktop-control

| 相对目录 | 递归字节 | 文件数 | 子目录数 | 最新修改 UTC |
| --- | --- | --- | --- | --- |
| .git | 1506375 | 596 | 292 | 2026-10-12T19:51:56.826190+00:00 |
| artifacts | 67072 | 1 | 1 | 2026-10-09T17:02:50.421958+00:00 |
| backups | 179510 | 4 | 1 | 2026-10-08T17:54:11.816657+00:00 |
| config | 556 | 2 | 0 | 2026-10-11T15:25:37.650741+00:00 |
| demo-workspace | 752 | 8 | 0 | 2026-10-11T15:25:37.650741+00:00 |
| docs | 143221 | 12 | 1 | 2026-10-12T09:50:25.721630+00:00 |
| logs | 5858012 | 102 | 0 | 2026-10-10T06:01:42.872602+00:00 |
| native | 87911 | 5 | 1 | 2026-10-11T15:25:37.656229+00:00 |
| node_modules | 601062479 | 38175 | 2640 | 2026-10-11T15:25:53.112674+00:00 |
| runtime | 55630 | 10 | 1 | 2026-10-12T17:13:02.392194+00:00 |
| scripts | 463194 | 45 | 0 | 2026-10-12T09:50:25.733137+00:00 |
| tests | 415964 | 47 | 1 | 2026-10-12T09:50:25.752402+00:00 |

| 互斥类别 | 文件数 | 逻辑字节 |
| --- | --- | --- |
| .git | 596 | 1506375 |
| backups | 4 | 179510 |
| logs | 102 | 5858012 |
| node_modules | 38175 | 601062479 |

大文件样本（元数据，最多 30 项；不得据大小直接删除）：

| 字节 | 路径 |
| --- | --- |
| 256155808 | D:\tong-desktop-control\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe |
| 9507980 | D:\tong-desktop-control\node_modules\better-sqlite3\deps\sqlite3\sqlite3.c |
| 6467584 | D:\tong-desktop-control\node_modules\node-pty\prebuilds\win32-x64\conpty.pdb |
| 6279168 | D:\tong-desktop-control\node_modules\node-pty\prebuilds\win32-x64\pty.pdb |
| 6090752 | D:\tong-desktop-control\node_modules\node-pty\prebuilds\win32-x64\winpty-agent.pdb |
| 6066176 | D:\tong-desktop-control\node_modules\node-pty\prebuilds\win32-arm64\conpty.pdb |
| 5902336 | D:\tong-desktop-control\node_modules\node-pty\prebuilds\win32-arm64\pty.pdb |
| 5648384 | D:\tong-desktop-control\node_modules\node-pty\prebuilds\win32-arm64\winpty-agent.pdb |
| 5369856 | D:\tong-desktop-control\node_modules\node-pty\prebuilds\win32-x64\winpty.pdb |
| 4952064 | D:\tong-desktop-control\node_modules\node-pty\prebuilds\win32-arm64\winpty.pdb |
| 4412959 | D:\tong-desktop-control\node_modules\lucide\dist\umd\lucide.js.map |
| 4331798 | D:\tong-desktop-control\node_modules\lucide\dist\cjs\lucide.js.map |
| 4313088 | D:\tong-desktop-control\node_modules\node-pty\prebuilds\win32-x64\conpty_console_list.pdb |
| 4231168 | D:\tong-desktop-control\node_modules\node-pty\prebuilds\win32-arm64\conpty_console_list.pdb |
| 4182631 | D:\tong-desktop-control\node_modules\lucide\dist\umd\lucide.min.js.map |
| 3038208 | D:\tong-desktop-control\node_modules\@anthropic-ai\sandbox-runtime\vendor\srt-win\x64\srt-win.exe |
| 2954768 | D:\tong-desktop-control\node_modules\@earendil-works\pi-coding-agent\node_modules\@mariozechner\clipboard-darwin-universal\clipboard.darwin-universal.node |
| 2703360 | D:\tong-desktop-control\node_modules\@anthropic-ai\sandbox-runtime\vendor\srt-win\arm64\srt-win.exe |
| 1924473 | D:\tong-desktop-control\node_modules\@earendil-works\pi-coding-agent\node_modules\@google\genai\dist\node\index.mjs.map |
| 1919488 | D:\tong-desktop-control\node_modules\better-sqlite3\build\Release\better_sqlite3.node |
| 1895028 | D:\tong-desktop-control\node_modules\lucide\dist\lucide.d.ts |
| 1890805 | D:\tong-desktop-control\node_modules\@earendil-works\pi-coding-agent\node_modules\@google\genai\dist\web\index.mjs.map |
| 1889527 | D:\tong-desktop-control\node_modules\@earendil-works\pi-coding-agent\node_modules\@google\genai\dist\index.mjs.map |
| 1881634 | D:\tong-desktop-control\node_modules\@earendil-works\pi-coding-agent\node_modules\@silvia-odwyer\photon-node\photon_rs_bg.wasm |
| 1526691 | D:\tong-desktop-control\node_modules\@earendil-works\pi-coding-agent\node_modules\jiti\dist\babel.cjs |
| 1510779 | D:\tong-desktop-control\node_modules\@earendil-works\pi-coding-agent\docs\images\exy.png |
| 1493568 | D:\tong-desktop-control\node_modules\@earendil-works\pi-coding-agent\node_modules\@mariozechner\clipboard-darwin-x64\clipboard.darwin-x64.node |
| 1447440 | D:\tong-desktop-control\node_modules\@earendil-works\pi-coding-agent\node_modules\@mariozechner\clipboard-darwin-arm64\clipboard.darwin-arm64.node |
| 1411823 | D:\tong-desktop-control\node_modules\@anthropic-ai\claude-agent-sdk\browser-sdk.js |
| 1396796 | D:\tong-desktop-control\node_modules\@agentclientprotocol\sdk\dist\v2\schema\zod.gen.d.ts |

Git 标记（包括测试夹具；标记本身不等于独立真实开发仓库）：

- `D:\tong-desktop-control\.git`

异常（不提权、不绕过）：

无枚举/元数据异常。


重解析点（不跟随目标）：

无。


## 附录 B：state 一级目录完整索引

以下逐根给出可达递归大小，均尚未取得删除许可；仅靠名称不能推断用途或是否脱离生产。分类和保留依据见报告分析部分。

| state 相对目录 | 递归字节 | 文件数 | 子目录数 | 最新修改 UTC |
| --- | --- | --- | --- | --- |
| state\aclprobe-405JAw | 0 | 0 | 1 | - |
| state\atomic-job-14814637b8b548cea8c43e33c3716c1f | 57781 | 16 | 9 | 2026-10-24T05:55:37.855869+00:00 |
| state\atomic-job-186dc2e4b5734f5eae6532bcf11bff53 | 54723 | 16 | 9 | 2026-10-23T18:01:09.363785+00:00 |
| state\atomic-job-2b78666d151a48119c68967864db042f | 44339 | 17 | 9 | 2026-10-23T14:20:27.984410+00:00 |
| state\atomic-job-56e9245c12234569a205489f99745d7b | 57786 | 16 | 9 | 2026-10-24T05:07:35.524829+00:00 |
| state\atomic-job-6705389de8994e2db0c6781b09f40d6c | 47613 | 16 | 9 | 2026-10-23T17:34:32.032471+00:00 |
| state\atomic-job-87e0356d80714613b9c55ca6e5ed2adc | 57784 | 16 | 9 | 2026-10-23T19:02:51.431665+00:00 |
| state\atomic-job-952e581490fd4b898e0cbd8a7137e100 | 62096 | 16 | 9 | 2026-10-25T16:40:16.086234+00:00 |
| state\atomic-job-a0791d48076c48aca634ee3647b3e960 | 57786 | 16 | 9 | 2026-10-24T04:11:26.529896+00:00 |
| state\atomic-job-b3806f6e98094b339e34bf4221d1a4bf | 51021 | 16 | 9 | 2026-10-23T17:35:29.605313+00:00 |
| state\atomic-job-b56624334aca4fbd9dddfebc91096e67 | 57381 | 16 | 9 | 2026-10-23T18:48:20.290079+00:00 |
| state\atomic-job-cc02b64f23c64ab888da81671e9a3d78 | 44026 | 17 | 9 | 2026-10-23T17:30:43.916193+00:00 |
| state\b1-tong-K6IaCq | 136051 | 11 | 10 | 2026-10-10T18:42:55.721191+00:00 |
| state\b1-tong-O450Ti | 134847 | 10 | 10 | 2026-10-10T18:40:59.348036+00:00 |
| state\b1-tong-b1ydOK | 137595 | 12 | 10 | 2026-10-10T18:59:15.890814+00:00 |
| state\b1-tong-mIT4tP | 137593 | 12 | 10 | 2026-10-10T18:46:14.641653+00:00 |
| state\b1-tong-wkAINr | 125789 | 5 | 9 | 2026-10-10T18:39:03.468573+00:00 |
| state\b22-acl-bd08c56b46b0 | 1263 | 4 | 1 | 2026-10-11T04:13:35.451218+00:00 |
| state\b22-audit-1lX1rO | 97 | 1 | 1 | 2026-10-11T04:24:43.509716+00:00 |
| state\b22-audit-6S7q3e | 97 | 1 | 1 | 2026-10-12T05:04:43.028201+00:00 |
| state\b22-audit-QMsOo2 | 97 | 1 | 1 | 2026-10-11T03:45:47.565243+00:00 |
| state\b22-audit-WATbij | 97 | 1 | 1 | 2026-10-12T09:38:38.855207+00:00 |
| state\b22-audit-yzrWEW | 97 | 1 | 1 | 2026-10-11T04:37:41.586482+00:00 |
| state\b22-backup-GRWlVO | 106642544 | 431 | 320 | 2026-10-17T10:32:13.400767+00:00 |
| state\b22-backup-ykEpx1 | 1867 | 11 | 13 | 2026-10-17T10:29:28.598449+00:00 |
| state\b22-child-env-5NCqnN | 175732 | 20 | 39 | 2026-10-11T04:23:31.679284+00:00 |
| state\b22-child-env-C0ZvSp | 142454 | 23 | 43 | 2026-10-11T04:40:23.474351+00:00 |
| state\b22-child-env-getWEs | 141901 | 23 | 43 | 2026-10-11T04:34:27.071515+00:00 |
| state\b22-child-env-hvl7rH | 143244 | 23 | 43 | 2026-10-11T15:40:31.342242+00:00 |
| state\b22-child-env-m4mOHQ | 141906 | 23 | 43 | 2026-10-11T04:26:17.557517+00:00 |
| state\b22-child-env-vB0xxA | 131751 | 18 | 39 | 2026-10-11T04:38:12.565747+00:00 |
| state\b22-child-env-yuLj3B | 143252 | 23 | 43 | 2026-10-12T12:23:26.884948+00:00 |
| state\b22-final-abort-zZyoMZ | 2764 | 10 | 12 | 2026-10-11T04:35:25.581841+00:00 |
| state\b22-final-regression-1a1e4a54fecf | 14603 | 64 | 6 | 2026-10-11T04:26:33.461294+00:00 |
| state\b22-runtime-3vmltt | 170888 | 32 | 39 | 2026-10-11T04:20:00.319703+00:00 |
| state\b22-runtime-AVD7nd | 220813 | 42 | 39 | 2026-10-12T12:22:38.210974+00:00 |
| state\b22-runtime-BclZns | 215709 | 40 | 39 | 2026-10-11T04:29:10.500932+00:00 |
| state\b22-runtime-HqcRMy | 139800 | 20 | 39 | 2026-10-11T04:05:24.534403+00:00 |
| state\b22-runtime-IkCmpY | 156398 | 19 | 39 | 2026-10-11T03:59:35.818978+00:00 |
| state\b22-runtime-Iv1x7O | 132595 | 17 | 39 | 2026-10-12T16:25:19.425252+00:00 |
| state\b22-runtime-JnTJec | 0 | 0 | 0 | - |
| state\b22-runtime-RTtYHC | 0 | 0 | 5 | - |
| state\b22-runtime-Sdk0sp | 217835 | 40 | 39 | 2026-10-11T04:43:17.409555+00:00 |
| state\b22-runtime-WLZpVc | 192023 | 27 | 39 | 2026-10-11T04:07:38.250472+00:00 |
| state\b22-runtime-bT8GHH | 220704 | 40 | 39 | 2026-10-12T16:29:27.798092+00:00 |
| state\b22-runtime-oE45xk | 215760 | 40 | 39 | 2026-10-11T04:22:27.019980+00:00 |
| state\b22-runtime-qbwIcn | 217887 | 40 | 39 | 2026-10-11T05:11:33.087872+00:00 |
| state\b22-runtime-sCDT9k | 220654 | 40 | 39 | 2026-10-11T15:39:51.599975+00:00 |
| state\b22-runtime-w2ujoB | 152030 | 18 | 45 | 2026-10-11T03:51:13.733865+00:00 |
| state\b22-security-47uRl4 | 2311 | 2 | 9 | 2026-10-11T03:45:47.368972+00:00 |
| state\b22-security-YIeMA6 | 2287 | 2 | 9 | 2026-10-11T03:46:40.828857+00:00 |
| state\b22-security-ncDFr6 | 531 | 1 | 1 | 2026-10-11T04:24:48.313418+00:00 |
| state\b22-security-rPjFXI | 531 | 1 | 1 | 2026-10-12T05:13:08.236793+00:00 |
| state\b22-security-tqpzrK | 531 | 1 | 1 | 2026-10-12T09:48:51.707075+00:00 |
| state\b23-b24-production-prep-20261012 | 42450498 | 21 | 0 | 2026-10-11T23:41:18.921208+00:00 |
| state\b23-final-35848132234f | 40691590 | 402 | 99 | 2026-10-11T15:40:07.084350+00:00 |
| state\b23-guardian-flow-0a47f81045924c9f92b8387f58728218 | 13786 | 4 | 2 | 2026-10-26T14:51:31.261424+00:00 |
| state\b23-guardian-flow-65366544d3fa4608817d631656639e83 | 14472 | 6 | 2 | 2026-10-26T14:52:05.023510+00:00 |
| state\b23-guardian-flow-9542253ac15140729e9015d48d660b2c | 14459 | 6 | 2 | 2026-10-26T14:52:42.074870+00:00 |
| state\b23-host-policy-15cc3737-9c3d-4de2-a0b3-4881cedc0207 | 7191 | 4 | 1 | 2026-10-26T12:31:03.908079+00:00 |
| state\b23-host-policy-52deb3ac-c06b-45f4-baf7-eb97c5ef861d | 7191 | 4 | 0 | 2026-10-25T06:02:16.415143+00:00 |
| state\b23-host-policy-6d4ad074-2383-4855-85c3-d4e66e799cb2 | 7191 | 4 | 1 | 2026-10-25T07:00:36.222149+00:00 |
| state\b23-host-policy-e73515a8-7b32-48af-b3af-ced1ed5a342d | 6737 | 2 | 0 | 2026-10-25T05:59:03.622339+00:00 |
| state\b23-host-policy-f6291ee4-01b8-40c8-a617-bf5339ec5ca5 | 7191 | 4 | 0 | 2026-10-25T06:03:00.668972+00:00 |
| state\b23-login-08662615a7824b7e9b6298f267d2830d | 2011866 | 217 | 27 | 2026-10-24T06:00:24.200757+00:00 |
| state\b23-login-0881ee36a191456289b57983d1810e08 | 2160634 | 205 | 27 | 2026-10-24T04:22:58.345949+00:00 |
| state\b23-login-0897398265434b64999468031b182597 | 2152057 | 198 | 27 | 2026-10-24T04:07:31.594433+00:00 |
| state\b23-login-0bef070049554f829ed6386059d39fd1 | 26545783 | 1000 | 52 | 2026-10-24T14:35:56.178222+00:00 |
| state\b23-login-0c63814bf3c44f53bafeb1314b101c4c | 2076930 | 202 | 27 | 2026-10-23T12:50:40.091186+00:00 |
| state\b23-login-0cfdaf1a7993413f9670f545c9f243ce | 1192415 | 109 | 27 | 2026-10-13T14:03:27.542968+00:00 |
| state\b23-login-0d24d63134d945da851847a7724ab383 | 1994020 | 197 | 28 | 2026-10-25T16:34:43.703930+00:00 |
| state\b23-login-0d49a875258b4d8e8580e983ee73bbf0 | 2067052 | 200 | 28 | 2026-10-25T16:38:25.900295+00:00 |
| state\b23-login-0d65026b15164611ba0607167c47365c | 26393025 | 984 | 49 | 2026-10-23T19:14:42.227614+00:00 |
| state\b23-login-0d67017bf44b4e118a78b5375d9785cc | 28346819 | 642 | 92 | 2026-10-23T13:21:33.693296+00:00 |
| state\b23-login-0dd7d32d36034c9d9d6ea6c40c74a310 | 1194110 | 109 | 27 | 2026-10-13T14:48:41.236788+00:00 |
| state\b23-login-0ed80812a8be4a0388a9372035e86c6b | 1203302514 | 76472 | 5335 | 2026-10-13T16:32:58.491757+00:00 |
| state\b23-login-0fa6593dd10548f0a20cec505e8ceebc | 0 | 0 | 16 | - |
| state\b23-login-0fd1055fb07845b6920432e3ebb02ae4 | 1203310042 | 76478 | 5335 | 2026-10-13T12:48:29.349348+00:00 |
| state\b23-login-100152a1662941bdb7d5fd7ac5be5597 | 2154693 | 204 | 27 | 2026-10-23T19:14:06.569401+00:00 |
| state\b23-login-10bec88eec884c1f9bd4e52e2dd76570 | 26541386 | 992 | 49 | 2026-10-24T14:35:12.492144+00:00 |
| state\b23-login-13a8f1e9796742119d558996c2087a8e | 2103087 | 202 | 27 | 2026-10-23T17:38:00.422904+00:00 |
| state\b23-login-143da5cb8d3b41cd8ed6bdf4d4e45232 | 0 | 0 | 0 | - |
| state\b23-login-157223e053d84f00b8d0d29029a58434 | 2305849 | 216 | 29 | 2026-10-24T17:13:14.578565+00:00 |
| state\b23-login-19b3a7d201b6408091a28b958d786600 | 24104791 | 244 | 65 | 2026-10-23T18:02:56.987306+00:00 |
| state\b23-login-1a7a49f52aea4eb6b65991fca3ad5290 | 26390590 | 984 | 49 | 2026-10-23T19:04:05.052480+00:00 |
| state\b23-login-1c966c6481fc4a87aeb1961fef5e55d7 | 1226648 | 117 | 27 | 2026-10-16T13:10:06.095357+00:00 |
| state\b23-login-1db692fcb5c143699e1dc8677bd9848f | 26314233 | 983 | 49 | 2026-10-23T13:39:46.362028+00:00 |
| state\b23-login-1e1231712edb4f3686cbb66f2770694c | 1978421 | 215 | 27 | 2026-10-23T13:45:30.657906+00:00 |
| state\b23-login-1e9c1caed8f947b5832a4b06412169e4 | 26553599 | 1007 | 82 | 2026-10-23T17:54:37.922748+00:00 |
| state\b23-login-21b11feb1d5d46ddb5c20f55f066369a | 24089635 | 244 | 65 | 2026-10-24T06:01:10.801789+00:00 |
| state\b23-login-22b7d2141b604931a2bc4331c21c9ef6 | 1193324 | 109 | 27 | 2026-10-13T14:05:24.338983+00:00 |
| state\b23-login-265c3ffeafc34618b5880bfdace77247 | 26541386 | 992 | 49 | 2026-10-24T14:23:38.443784+00:00 |
| state\b23-login-26994988032447d29092f6e96bd47149 | 2157873 | 204 | 27 | 2026-10-24T04:09:29.134461+00:00 |
| state\b23-login-27e3a3ea09844f42b660d09e2107efc2 | 26397178 | 984 | 49 | 2026-10-24T04:16:48.918947+00:00 |
| state\b23-login-2993c79bb37d425cb910c235d3cdf75a | 0 | 0 | 0 | - |
| state\b23-login-2a503881e22144b190f8794cbcc25119 | 1291242 | 112 | 27 | 2026-10-16T12:52:03.293072+00:00 |
| state\b23-login-2b169bcbb54f4fac80272c2f6815a14c | 2324139 | 219 | 30 | 2026-10-24T17:39:36.837563+00:00 |
| state\b23-login-2ce019deec594b678051079958a7f5a4 | 2303071 | 219 | 30 | 2026-10-24T16:54:11.767436+00:00 |
| state\b23-login-2e39873b27474c0fb147296b0773cafb | 26541386 | 992 | 49 | 2026-10-24T14:18:49.217232+00:00 |
| state\b23-login-2e573d5ae30143d79fbb64270d397955 | 2373697 | 211 | 28 | 2026-10-24T17:40:11.317745+00:00 |
| state\b23-login-2f57a010047449efa3f1b9110a2256ad | 1471737 | 134 | 27 | 2026-10-18T09:38:33.233765+00:00 |
| state\b23-login-323b803d67ba4c3dabfb11009175fab7 | 26602984 | 1030 | 82 | 2026-10-23T18:13:41.543380+00:00 |
| state\b23-login-336f1582e55343efb39c088be2d791d7 | 2137956 | 202 | 27 | 2026-10-23T17:49:51.240237+00:00 |
| state\b23-login-3766b1fc941f457d90da32d927cffd93 | 1231276 | 118 | 27 | 2026-10-16T13:19:38.132344+00:00 |
| state\b23-login-3c43c43634184c2c974844808c986d0e | 2161570 | 205 | 27 | 2026-10-24T05:05:56.586563+00:00 |
| state\b23-login-3c7c40c746a6454f9f178eac27a2c00d | 1220491 | 117 | 27 | 2026-10-16T13:04:13.389967+00:00 |
| state\b23-login-3f01af7688dd41f8bd7f94bc5bd2f2eb | 26546459 | 1028 | 82 | 2026-10-23T13:55:44.189739+00:00 |
| state\b23-login-3f662ffd6bba4a3c8ac3c45c54e7f482 | 1186481 | 106 | 27 | 2026-10-13T12:52:22.978930+00:00 |
| state\b23-login-418d7372f08d4e2e8a8559300f1c38a0 | 2067067 | 200 | 28 | 2026-10-25T16:41:18.392827+00:00 |
| state\b23-login-42945523eff144ce8554eb7d07aff231 | 1179335 | 106 | 27 | 2026-10-13T12:34:26.599911+00:00 |
| state\b23-login-441c2bed0dd0463faeab92dd43c19a8f | 52864734 | 1450 | 114 | 2026-10-24T14:56:34.143405+00:00 |
| state\b23-login-4432a5dcdbde45a697c74d64f536b5b8 | 1327687 | 114 | 27 | 2026-10-17T11:06:00.406279+00:00 |
| state\b23-login-493e775dcc5641a3b0c2ce2275504b38 | 1228662 | 117 | 27 | 2026-10-16T13:23:05.420841+00:00 |
| state\b23-login-4a2f458f98ff4ea0add128315dedb9b4 | 2318064 | 219 | 30 | 2026-10-24T17:24:41.596654+00:00 |
| state\b23-login-4b90fd1871f841cca773ffafe679c3ed | 1193324 | 109 | 27 | 2026-10-13T14:04:45.489278+00:00 |
| state\b23-login-4c8b386bd050448cbd7b994fb86b91a0 | 24131957 | 244 | 65 | 2026-10-23T19:04:17.822450+00:00 |
| state\b23-login-50dff62d14584de5a74901d2cec7adc8 | 1993996 | 196 | 28 | 2026-10-25T16:31:27.528447+00:00 |
| state\b23-login-545d5f2ee2554067a7925a5d23f41533 | 2155245 | 200 | 27 | 2026-10-24T04:09:46.112820+00:00 |
| state\b23-login-55ba43ba165a486e8b38df9f41d7586e | 1184589 | 106 | 27 | 2026-10-13T12:39:07.375535+00:00 |
| state\b23-login-578924b66f4948b89784e6b3026a1efa | 2323851 | 219 | 30 | 2026-10-24T17:29:21.602731+00:00 |
| state\b23-login-5ac1158aaed44d87bb280b4a63878583 | 2539332 | 232 | 28 | 2026-10-25T16:34:58.932652+00:00 |
| state\b23-login-5b7bc475924e49dbbf5f6e26ec32752e | 26742948 | 1028 | 82 | 2026-10-24T09:39:10.043729+00:00 |
| state\b23-login-5c924f91bc8946a0942602ddcb994ef0 | 2301311 | 215 | 29 | 2026-10-24T16:51:25.958502+00:00 |
| state\b23-login-5d8c56109d3e48cead09f3f77f5e5b5b | 26505302 | 1005 | 82 | 2026-10-23T13:39:27.491004+00:00 |
| state\b23-login-62bbe80fa92a44e4a0ab3674df29505a | 26539650 | 987 | 49 | 2026-10-24T15:25:55.145710+00:00 |
| state\b23-login-66c841c5c97d452885fd3378d42d3dcb | 26542787 | 996 | 52 | 2026-10-24T14:35:22.539602+00:00 |
| state\b23-login-68009b23f4794f16a6a9e03b1510f65a | 2420534176 | 88492 | 6476 | 2026-10-26T16:34:15.672559+00:00 |
| state\b23-login-6807a9f430eb47c5bd5208001f10af13 | 26545785 | 1000 | 52 | 2026-10-24T14:25:56.219915+00:00 |
| state\b23-login-687a5bd30ee64185b0c52da0f6e15041 | 2059241 | 217 | 27 | 2026-10-23T19:18:22.819206+00:00 |
| state\b23-login-68f0da1f079945dcb6470c0feca02a85 | 2302541 | 219 | 30 | 2026-10-24T16:51:12.950239+00:00 |
| state\b23-login-69ac63e66fa24270b75c9872cba07124 | 2089805 | 202 | 27 | 2026-10-23T14:12:33.460001+00:00 |
| state\b23-login-6a881a065dcd4dba8655f911bbd1e460 | 2323851 | 219 | 30 | 2026-10-24T17:30:34.544482+00:00 |
| state\b23-login-6babe2c6e70f4adab8fb166f2a534610 | 2078131 | 205 | 27 | 2026-10-23T13:36:08.207337+00:00 |
| state\b23-login-6bd15827c6a045f8b263871b036ada73 | 2158843 | 204 | 27 | 2026-10-24T04:15:48.594781+00:00 |
| state\b23-login-6cd561687f6442c5b16d802f0bfd2ac5 | 1987691 | 212 | 27 | 2026-10-23T12:25:01.553980+00:00 |
| state\b23-login-70f1b7d66215458c8ffa0d822348de0f | 238859545 | 4383 | 389 | 2026-10-26T15:32:23.402311+00:00 |
| state\b23-login-7144ec3881c647c2a828fe32594ed95e | 2169404 | 219 | 27 | 2026-10-24T04:50:46.762764+00:00 |
| state\b23-login-73dd6b45a9d24d108944887667041a80 | 1203313038 | 76478 | 5335 | 2026-10-13T13:14:22.283213+00:00 |
| state\b23-login-76ac3ffb620749e48d5f9b580355c8da | 2156181 | 200 | 27 | 2026-10-24T04:58:33.459424+00:00 |
| state\b23-login-77b6ae9ba4d54aaaa4798bccd64e7bfc | 2071682 | 199 | 27 | 2026-10-23T12:27:20.625155+00:00 |
| state\b23-login-79060e851cdb42ac94d53ff95417b699 | 2107875 | 204 | 27 | 2026-10-24T05:56:14.992143+00:00 |
| state\b23-login-7921fc95454e41b293e942b38fa0d178 | 2080392 | 203 | 27 | 2026-10-23T13:11:09.069413+00:00 |
| state\b23-login-79aa4fb377bf4dbcaa4ff5a420fc801a | 1203136760 | 76456 | 5302 | 2026-10-13T16:11:14.252766+00:00 |
| state\b23-login-7af6ac6d147d41aaaca38b4b02f8b936 | 2200760 | 225 | 27 | 2026-10-24T11:23:19.420728+00:00 |
| state\b23-login-7b8151caae83464381e449bc9dc61e14 | 1993996 | 196 | 28 | 2026-10-25T16:33:04.620406+00:00 |
| state\b23-login-7b843c7f1ced433f820e959f57118298 | 1187511 | 106 | 27 | 2026-10-13T13:06:24.555503+00:00 |
| state\b23-login-7d15d8468b4243e68c950149d283b4c9 | 26314235 | 983 | 49 | 2026-10-23T14:08:27.796376+00:00 |
| state\b23-login-8042d30a8a704fd5a1fdd15609daeb28 | 26546086 | 1028 | 82 | 2026-10-23T12:49:22.093109+00:00 |
| state\b23-login-81b0f2eacdef4468a2df33a40b27ec32 | 1203311913 | 76478 | 5335 | 2026-10-13T13:00:27.529604+00:00 |
| state\b23-login-8326653867004f8a8a5154246d51dd5f | 26361350 | 984 | 49 | 2026-10-23T17:46:56.677549+00:00 |
| state\b23-login-8531908df0964817a9607fc53de99134 | 26542778 | 996 | 52 | 2026-10-24T15:26:56.622837+00:00 |
| state\b23-login-85a1097f92a74466bad67b3d1de33969 | 1978253 | 215 | 27 | 2026-10-23T12:43:11.609225+00:00 |
| state\b23-login-85d5420ef14e4e2f911d62d28f04b2c6 | 2155971 | 204 | 27 | 2026-10-24T04:07:28.973412+00:00 |
| state\b23-login-880a9179c44e47cc879ec8647a3a7069 | 26611425 | 1017 | 82 | 2026-10-23T17:48:52.043203+00:00 |
| state\b23-login-8a64e100c57949ed9fb06826c017526b | 2080392 | 203 | 27 | 2026-10-23T13:08:17.339081+00:00 |
| state\b23-login-8b714d5785e449359e5080e5934a48c4 | 195880550 | 3495 | 278 | 2026-10-24T15:24:29.145207+00:00 |
| state\b23-login-8bc84b77d76542d0b941c6dee8797daa | 2077008 | 203 | 27 | 2026-10-23T12:31:24.135123+00:00 |
| state\b23-login-8d6797f9f775488ab6e2fd926beea110 | 195880473 | 3495 | 278 | 2026-10-24T15:00:33.064951+00:00 |
| state\b23-login-8e32da332608430bb4971bc668ef4ace | 294916609 | 5546 | 509 | 2026-10-24T17:42:01.589221+00:00 |
| state\b23-login-8eecdc1f0a974d24861421ff73f8e599 | 1305844 | 114 | 27 | 2026-10-16T13:01:48.474148+00:00 |
| state\b23-login-8f3fce896c274b7fa3c1d584b3cf4720 | 24206231 | 246 | 65 | 2026-10-24T09:44:19.505447+00:00 |
| state\b23-login-8fe476c895004ce6b9a6619319321933 | 26666848 | 1038 | 82 | 2026-10-23T12:52:13.889941+00:00 |
| state\b23-login-91fa5cc895e54bb48390c7ae111dca71 | 2013662 | 217 | 27 | 2026-10-24T06:12:57.070760+00:00 |
| state\b23-login-921b63f2e89a42c1977f067f190d2f6e | 2317398 | 218 | 29 | 2026-10-24T17:25:06.416488+00:00 |
| state\b23-login-944f9447a3844603a48e0592784d636a | 2063793 | 217 | 27 | 2026-10-24T05:03:17.941130+00:00 |
| state\b23-login-94b114de92074a2688c4012911fbeb48 | 2068289 | 200 | 28 | 2026-10-26T11:50:33.546069+00:00 |
| state\b23-login-9502caa86d3e4d5ea0e76d401cc196b7 | 1193283 | 109 | 27 | 2026-10-13T14:06:59.947885+00:00 |
| state\b23-login-9673e077810a427e92c15e75f3f64387 | 2067357 | 200 | 28 | 2026-10-25T16:53:17.897926+00:00 |
| state\b23-login-96a17b87e7f846918327620f9efec7bd | 2323273 | 218 | 29 | 2026-10-24T17:31:03.661808+00:00 |
| state\b23-login-97bb5883a2f14906a4263957896c58cb | 26610289 | 1020 | 82 | 2026-10-23T17:58:37.378951+00:00 |
| state\b23-login-989f0b87e8de4ce099614165a636fe3e | 24135383 | 244 | 65 | 2026-10-23T19:35:25.301713+00:00 |
| state\b23-login-98b09599379f4db1b2703054fd5065e8 | 2122331 | 204 | 27 | 2026-10-23T17:43:15.049798+00:00 |
| state\b23-login-990a3775405d4c28b0b7f61f9bfc4dbb | 1179329 | 106 | 27 | 2026-10-13T12:33:43.568725+00:00 |
| state\b23-login-9a97d2b3f02b49d1aaeaa366130aa886 | 1988714 | 214 | 27 | 2026-10-23T12:38:21.851284+00:00 |
| state\b23-login-9f249bbdf85d4a998471195c4e9230ee | 25782844 | 931 | 82 | 2026-10-17T11:16:27.669680+00:00 |
| state\b23-login-9f445a09507842d1ac03a2a050ca2905 | 0 | 0 | 0 | - |
| state\b23-login-9fbe2f6acf4e4d04bc95fd964bbafcbb | 1978428 | 215 | 27 | 2026-10-23T12:48:53.424593+00:00 |
| state\b23-login-a0bda5d1914841feab7c2cb0d730fe14 | 0 | 0 | 0 | - |
| state\b23-login-a3cac9aa457e44b59cc729d0f27d11de | 26756454 | 1040 | 82 | 2026-10-24T04:35:43.126247+00:00 |
| state\b23-login-a4d4267c515c47f7933af6250963912a | 0 | 0 | 0 | - |
| state\b23-login-a547eb2004ef4fca81d418ff05d8548f | 1193427 | 109 | 27 | 2026-10-13T14:09:15.821308+00:00 |
| state\b23-login-a58341e88f0d413999226fcae1111a6c | 2067321 | 201 | 28 | 2026-10-25T16:41:04.702905+00:00 |
| state\b23-login-a790c919f43c48ae852f2bb3a98f17da | 0 | 0 | 0 | - |
| state\b23-login-a7b160223e374943aa0472d998edf9cf | 26505408 | 1005 | 82 | 2026-10-23T12:49:41.095404+00:00 |
| state\b23-login-a7d61d620e51482ebcf4c1da5918b2bb | 0 | 0 | 0 | - |
| state\b23-login-a9360898acaf4f23afb3bc2e1bf3c1f9 | 2030031 | 217 | 27 | 2026-10-23T18:00:57.548396+00:00 |
| state\b23-login-ab1be3d6559d4175a8a2ca71e941268a | 2127170 | 205 | 27 | 2026-10-23T18:03:32.782357+00:00 |
| state\b23-login-ab40638f4aa14bb89870b87a1f9fcb26 | 2307112 | 219 | 30 | 2026-10-24T17:12:55.615524+00:00 |
| state\b23-login-ad724cfe86534195beedafee9ce69791 | 1187511 | 106 | 27 | 2026-10-13T13:07:20.974350+00:00 |
| state\b23-login-aea84ef140a443feae723fff055316ef | 26328061 | 982 | 49 | 2026-10-23T14:15:18.468530+00:00 |
| state\b23-login-aeaf8771eb534d7eb9233ca6b2479f8c | 26398114 | 984 | 49 | 2026-10-24T04:59:21.246306+00:00 |
| state\b23-login-b00108b1335f4f7a89aced111989e3f4 | 2152407 | 204 | 27 | 2026-10-23T19:03:29.293046+00:00 |
| state\b23-login-b1bd992b3cca447e891aeb3ca8b090b1 | 1185833 | 106 | 27 | 2026-10-13T12:47:37.409910+00:00 |
| state\b23-login-b33fe60923c94668b5a98a2194bc54c5 | 1270490 | 113 | 27 | 2026-10-16T12:48:01.426754+00:00 |
| state\b23-login-b3b8603242154711a8c0c15c9a1539bd | 2159779 | 204 | 27 | 2026-10-24T04:58:16.599538+00:00 |
| state\b23-login-b547e28feb8b4a85bcbb029a005aa228 | 2301849 | 216 | 29 | 2026-10-24T16:54:27.094037+00:00 |
| state\b23-login-b6065f74d6fd4beabe7804772a5b19b0 | 24139191 | 244 | 65 | 2026-10-24T05:07:30.068312+00:00 |
| state\b23-login-b630e8a13f1c46319b6380a4ffdffe7a | 2171777 | 222 | 33 | 2026-10-24T04:54:15.415724+00:00 |
| state\b23-login-b7ebc6db0ba04085b2ebd8f73f6475d6 | 26363426 | 984 | 49 | 2026-10-23T18:02:44.047968+00:00 |
| state\b23-login-b8f67ddaf05b41cbb8cc4b3c3d1d1166 | 2088964 | 200 | 27 | 2026-10-23T12:24:55.572160+00:00 |
| state\b23-login-b9cced3b74374514a14cedecf2e006bf | 2068273 | 200 | 28 | 2026-10-25T16:54:33.230619+00:00 |
| state\b23-login-bbd2ec203e484afaac4a6f623e1dc1ee | 26666095 | 1038 | 82 | 2026-10-23T13:34:04.848392+00:00 |
| state\b23-login-bec438cce2fc44bcb183be01a344d109 | 2068337 | 200 | 28 | 2026-10-26T11:50:18.266354+00:00 |
| state\b23-login-bf99e21514af4789b441251ecd80111e | 26541386 | 992 | 49 | 2026-10-24T14:25:29.765018+00:00 |
| state\b23-login-c24914b48e5e4633ac4878dcf1f107f2 | 2323561 | 218 | 29 | 2026-10-24T17:40:07.359919+00:00 |
| state\b23-login-c25c50fc43c948b4a5c9c1abd45c8173 | 2108746 | 205 | 27 | 2026-10-24T06:09:05.330189+00:00 |
| state\b23-login-c2db39cf150c44d584691538559dce3d | 203804500 | 3620 | 306 | 2026-10-26T15:18:08.421275+00:00 |
| state\b23-login-c47a39096a3448f58e66df1ff69529ea | 1203329423 | 76485 | 5335 | 2026-10-13T15:03:35.256088+00:00 |
| state\b23-login-c48b79e2968e42d4870c88b470917ba7 | 2076930 | 202 | 27 | 2026-10-23T13:23:16.804326+00:00 |
| state\b23-login-c6817ad801074fdbb458f543b3ee3749 | 26348546 | 984 | 49 | 2026-10-24T06:00:58.338214+00:00 |
| state\b23-login-c76617ef8b854278918607363200222d | 637444227 | 40199 | 2758 | 2026-10-20T10:00:03.008701+00:00 |
| state\b23-login-c8402fe04ce74c0d854c7b49bcb266eb | 1203134809 | 76450 | 5301 | 2026-10-13T16:19:03.214668+00:00 |
| state\b23-login-c890a0d95a014cfba8cb1f9abb0cd877 | 1878290 | 193 | 27 | 2026-10-20T09:37:57.262454+00:00 |
| state\b23-login-c984051e5d7c4c88acedad502c4a940e | 2323273 | 218 | 29 | 2026-10-24T17:29:49.971561+00:00 |
| state\b23-login-cb276a7244974a4997fc42e7700a1939 | 1193427 | 109 | 27 | 2026-10-13T14:09:16.747578+00:00 |
| state\b23-login-ccffe1cb77f94e00b94dee13633b07af | 2092423 | 203 | 27 | 2026-10-23T14:14:44.849539+00:00 |
| state\b23-login-cda69ee9cafd4ef38c68c50a67da60a4 | 1405162 | 128 | 27 | 2026-10-17T10:36:52.232010+00:00 |
| state\b23-login-cfda1f22bf7e4718a99b35edcb28d35b | 2542089 | 232 | 28 | 2026-10-25T16:37:00.589794+00:00 |
| state\b23-login-d07b633fcbe948b889ca47c40ed80baa | 2075735 | 199 | 27 | 2026-10-23T13:21:01.129591+00:00 |
| state\b23-login-d0bf1375f841438abb20d3ae7ad50ca2 | 2155245 | 200 | 27 | 2026-10-24T04:16:04.972399+00:00 |
| state\b23-login-d12ae22d7fa348ad8766ad03321e67c0 | 2067115 | 200 | 28 | 2026-10-25T16:38:37.976777+00:00 |
| state\b23-login-d27dc95d107a454885b8eb2fe7d5ad95 | 1300749 | 113 | 27 | 2026-10-16T13:12:24.588781+00:00 |
| state\b23-login-d2e6fef7a6f64437910a2779fb9ef22a | 1202805 | 109 | 27 | 2026-10-13T17:52:10.404476+00:00 |
| state\b23-login-d56d9ee6e4d34f6f8183e6dff806edf2 | 2063395 | 217 | 27 | 2026-10-24T04:20:25.791708+00:00 |
| state\b23-login-daf14840b8ca400990162e06934a626b | 29136575 | 1294 | 86 | 2026-10-24T11:28:17.617942+00:00 |
| state\b23-login-db26464a66474becb56cf2aee54d00fc | 2093068 | 200 | 27 | 2026-10-23T13:35:00.870823+00:00 |
| state\b23-login-e14363181d8947b3b5e60d4e81e3b0ac | 26504646 | 1005 | 82 | 2026-10-23T12:42:52.000340+00:00 |
| state\b23-login-e2dfa2f4a531481a8a6983ac6ca0dc35 | 1270485 | 113 | 27 | 2026-10-16T12:48:50.752593+00:00 |
| state\b23-login-e4a3902cc7f94877b4e7232ace4bcc91 | 26363414 | 984 | 49 | 2026-10-23T18:14:16.454475+00:00 |
| state\b23-login-e4ccb205bc0244f0b6fd32329eb51b61 | 1193381 | 109 | 27 | 2026-10-13T14:07:03.466896+00:00 |
| state\b23-login-e5280946272f43bdb7bcb66cd423ca42 | 2067366 | 201 | 28 | 2026-10-25T16:38:49.275264+00:00 |
| state\b23-login-e63f3c0dfb1248bbb29efa3160e76232 | 1994020 | 197 | 28 | 2026-10-25T16:36:38.357725+00:00 |
| state\b23-login-e7cf686380194f0c9ec5c8e0ecf4fc15 | 1221776 | 117 | 27 | 2026-10-16T13:06:23.882243+00:00 |
| state\b23-login-e8232880f6964ad6897f69b0af63c1c4 | 0 | 0 | 0 | - |
| state\b23-login-e85bf3c44ff94fd69f825b3cb1a5b65c | 2292608 | 214 | 29 | 2026-10-24T16:46:19.299555+00:00 |
| state\b23-login-e87889eee9f0469caa2241c11d7c1b8b | 24134105 | 244 | 65 | 2026-10-23T19:18:32.842974+00:00 |
| state\b23-login-e925a354652c4ab1b047ce1d65c567bb | 2125241 | 204 | 27 | 2026-10-23T18:02:07.159988+00:00 |
| state\b23-login-e9d0f48b0b8f492ca1d64d564334099a | 663596607 | 41181 | 2882 | 2026-10-20T10:16:57.558467+00:00 |
| state\b23-login-ea5e024c11c94978bba66df7015a3a5e | 24098755 | 244 | 65 | 2026-10-23T17:40:41.880054+00:00 |
| state\b23-login-eba92d934dce4003ac942d1d54b42ac4 | 2080392 | 203 | 27 | 2026-10-23T13:05:36.991627+00:00 |
| state\b23-login-ebaae071dfd54cbea5380d4cf27fe34a | 2104279 | 200 | 27 | 2026-10-24T05:56:32.007141+00:00 |
| state\b23-login-ee89df49387144f4a50585b15cd9cb9f | 0 | 0 | 0 | - |
| state\b23-login-ef7b0357716c4775b34784932aa0a4f8 | 2542027 | 232 | 28 | 2026-10-25T16:36:53.007709+00:00 |
| state\b23-login-f0672e63172a4b39988458a4cd81fa4f | 26610147 | 1023 | 82 | 2026-10-24T04:44:09.932548+00:00 |
| state\b23-login-f3ba97b381fd42f88af864b0f8ba5f0b | 2076930 | 202 | 27 | 2026-10-23T13:23:48.683152+00:00 |
| state\b23-login-f408bf5bbbc14e818fb83a73d7fd2b92 | 26724238 | 1040 | 82 | 2026-10-23T18:59:57.874170+00:00 |
| state\b23-login-f8b2e20c417f45a7a02fffee5eac0159 | 1184589 | 106 | 27 | 2026-10-13T12:36:33.037027+00:00 |
| state\b23-login-fad160054f3a427083cdd8158133f62e | 1203302503 | 76472 | 5335 | 2026-10-13T16:27:26.844058+00:00 |
| state\b23-login-fadb41fab56440a2bc32ced30871b2e8 | 1791351 | 193 | 27 | 2026-10-20T09:38:07.773387+00:00 |
| state\b23-login-fb7cd96d653e44e593d0d3b33948bce4 | 1187511 | 106 | 27 | 2026-10-13T12:59:04.125945+00:00 |
| state\b23-login-feccea46c7964cafa14bde4b811f5ffb | 26543081 | 1028 | 82 | 2026-10-23T12:37:05.516011+00:00 |
| state\b23-login-fed5d9757fc446f89860da44e55a7c36 | 1304088 | 117 | 27 | 2026-10-16T13:16:54.063382+00:00 |
| state\b23-login-fffbadff422e4941a617b834867befa2 | 1294554 | 116 | 27 | 2026-10-16T12:55:10.836287+00:00 |
| state\b23-maint-0FIphs | 5315 | 15 | 5 | 2026-10-24T09:26:46.039276+00:00 |
| state\b23-maint-0R8Hnb | 4016 | 25 | 4 | 2026-10-24T10:56:49.852775+00:00 |
| state\b23-maint-0THLO7 | 2871 | 7 | 2 | 2026-10-24T09:33:26.828258+00:00 |
| state\b23-maint-0VaWb6 | 765 | 7 | 4 | 2026-10-24T12:43:33.259607+00:00 |
| state\b23-maint-0Yf1mS | 754 | 6 | 1 | 2026-10-24T09:26:45.970300+00:00 |
| state\b23-maint-0iQWgF | 4386 | 28 | 4 | 2026-10-24T08:39:24.322997+00:00 |
| state\b23-maint-0pReVI | 2512 | 15 | 4 | 2026-10-24T11:42:51.325227+00:00 |
| state\b23-maint-0uc1v6 | 5326 | 15 | 5 | 2026-10-24T11:02:55.131023+00:00 |
| state\b23-maint-0xkF16 | 5537 | 15 | 5 | 2026-10-24T09:35:05.750769+00:00 |
| state\b23-maint-0ydDfT | 754 | 6 | 1 | 2026-10-24T09:05:05.347422+00:00 |
| state\b23-maint-0z1U6i | 765 | 7 | 4 | 2026-10-24T09:35:06.142179+00:00 |
| state\b23-maint-12gdc4 | 754 | 6 | 1 | 2026-10-24T11:32:40.693617+00:00 |
| state\b23-maint-13neKF | 3262 | 7 | 2 | 2026-10-24T09:29:43.496602+00:00 |
| state\b23-maint-16hJsm | 804 | 10 | 14 | 2026-10-24T11:56:46.179792+00:00 |
| state\b23-maint-18sMqu | 754 | 6 | 1 | 2026-10-24T09:09:08.098932+00:00 |
| state\b23-maint-194W7G | 6231 | 18 | 5 | 2026-10-24T12:43:33.038519+00:00 |
| state\b23-maint-1DG3iU | 2592 | 15 | 4 | 2026-10-24T11:42:51.063624+00:00 |
| state\b23-maint-1DKXah | 754 | 6 | 1 | 2026-10-24T10:56:49.775614+00:00 |
| state\b23-maint-1EYGa6 | 754 | 6 | 1 | 2026-10-24T11:32:40.873515+00:00 |
| state\b23-maint-1InKdc | 754 | 6 | 1 | 2026-10-24T11:56:46.066587+00:00 |
| state\b23-maint-1JPUBH | 754 | 6 | 1 | 2026-10-24T09:35:05.690795+00:00 |
| state\b23-maint-1WYTw6 | 754 | 6 | 1 | 2026-10-24T09:38:38.565835+00:00 |
| state\b23-maint-1X9agY | 754 | 6 | 1 | 2026-10-24T11:42:51.017555+00:00 |
| state\b23-maint-1iwgWA | 754 | 6 | 1 | 2026-10-24T10:56:49.696815+00:00 |
| state\b23-maint-1jeudo | 2871 | 7 | 2 | 2026-10-24T09:23:42.136953+00:00 |
| state\b23-maint-1mo57Q | 754 | 6 | 1 | 2026-10-24T09:38:38.552373+00:00 |
| state\b23-maint-1nxVOB | 754 | 6 | 1 | 2026-10-24T15:58:38.687920+00:00 |
| state\b23-maint-1oyMkB | 3128 | 7 | 2 | 2026-10-24T09:09:09.068992+00:00 |
| state\b23-maint-1pnYwT | 2592 | 15 | 4 | 2026-10-24T09:07:57.279659+00:00 |
| state\b23-maint-1rnLlG | 1115 | 13 | 4 | 2026-10-24T09:35:06.126549+00:00 |
| state\b23-maint-1yFRPj | 754 | 6 | 1 | 2026-10-24T09:30:24.150357+00:00 |
| state\b23-maint-2225Rb | 5473 | 15 | 5 | 2026-10-24T11:32:41.268559+00:00 |
| state\b23-maint-22VfBb | 763 | 7 | 4 | 2026-10-24T12:43:33.268061+00:00 |
| state\b23-maint-2DBVm9 | 5603 | 15 | 5 | 2026-10-24T09:26:46.063689+00:00 |
| state\b23-maint-2IDtto | 3259 | 7 | 2 | 2026-10-24T09:38:38.685120+00:00 |
| state\b23-maint-2Ianyb | 2592 | 15 | 4 | 2026-10-24T09:09:06.226715+00:00 |
| state\b23-maint-2LuQBw | 2592 | 15 | 4 | 2026-10-24T09:05:06.113333+00:00 |
| state\b23-maint-2OiAfm | 4386 | 28 | 4 | 2026-10-24T09:01:32.822792+00:00 |
| state\b23-maint-2Rd9nw | 758 | 7 | 2 | 2026-10-24T11:32:40.897552+00:00 |
| state\b23-maint-2VEKaM | 4016 | 25 | 4 | 2026-10-24T08:02:46.033976+00:00 |
| state\b23-maint-2WJkZt | 5315 | 15 | 5 | 2026-10-24T11:02:55.224099+00:00 |
| state\b23-maint-2cU8R0 | 754 | 6 | 1 | 2026-10-24T11:02:55.080723+00:00 |
| state\b23-maint-2idZkq | 2938 | 17 | 4 | 2026-10-24T08:39:25.040540+00:00 |
| state\b23-maint-2ikX3M | 2871 | 7 | 2 | 2026-10-24T12:43:32.880934+00:00 |
| state\b23-maint-2m9SXE | 754 | 6 | 1 | 2026-10-24T11:32:41.013205+00:00 |
| state\b23-maint-2rBrt7 | 758 | 7 | 2 | 2026-10-24T12:43:32.864552+00:00 |
| state\b23-maint-36lZiO | 754 | 6 | 1 | 2026-10-24T11:27:25.212941+00:00 |
| state\b23-maint-3DN8QV | 5326 | 15 | 5 | 2026-10-24T11:42:51.071046+00:00 |
| state\b23-maint-3GqFkN | 5334 | 15 | 5 | 2026-10-24T09:23:42.084330+00:00 |
| state\b23-maint-3KSizH | 765 | 7 | 4 | 2026-10-24T09:29:43.839300+00:00 |
| state\b23-maint-3NXXBB | 754 | 6 | 1 | 2026-10-24T09:07:59.147676+00:00 |
| state\b23-maint-3QNAa7 | 754 | 6 | 1 | 2026-10-24T12:43:32.721706+00:00 |
| state\b23-maint-3S5PPA | 2512 | 15 | 4 | 2026-10-24T07:55:05.354381+00:00 |
| state\b23-maint-3TnujI | 754 | 6 | 1 | 2026-10-24T09:35:05.613868+00:00 |
| state\b23-maint-3WJgXH | 4016 | 25 | 4 | 2026-10-24T11:42:51.205986+00:00 |
| state\b23-maint-3bLk6p | 3259 | 7 | 2 | 2026-10-24T11:42:51.109646+00:00 |
| state\b23-maint-3mFRb5 | 4016 | 25 | 4 | 2026-10-24T11:02:55.273143+00:00 |
| state\b23-maint-3vNB9R | 4386 | 28 | 4 | 2026-10-24T07:55:05.546432+00:00 |
| state\b23-maint-3yjCeR | 5330 | 15 | 5 | 2026-10-24T11:56:46.258923+00:00 |
| state\b23-maint-40mLCE | 754 | 6 | 1 | 2026-10-24T09:01:31.844459+00:00 |
| state\b23-maint-45aW3C | 3815 | 22 | 4 | 2026-10-24T11:56:46.098739+00:00 |
| state\b23-maint-4AUFgo | 754 | 6 | 1 | 2026-10-24T11:27:25.520037+00:00 |
| state\b23-maint-4BjyEd | 5330 | 15 | 5 | 2026-10-24T09:30:24.279970+00:00 |
| state\b23-maint-4DJe9x | 756 | 7 | 1 | 2026-10-24T11:42:51.053341+00:00 |
| state\b23-maint-4K8MI2 | 754 | 6 | 1 | 2026-10-24T09:07:59.199805+00:00 |
| state\b23-maint-4LCbAm | 754 | 6 | 1 | 2026-10-24T11:56:45.844034+00:00 |
| state\b23-maint-4SDvz9 | 3262 | 7 | 2 | 2026-10-24T09:30:24.081027+00:00 |
| state\b23-maint-4XauHt | 737 | 6 | 1 | 2026-10-24T15:58:38.569701+00:00 |
| state\b23-maint-4Z28mL | 754 | 6 | 1 | 2026-10-24T09:01:34.283362+00:00 |
| state\b23-maint-4cW2fh | 4016 | 25 | 4 | 2026-10-24T09:26:46.103044+00:00 |
| state\b23-maint-4dNv5o | 5537 | 15 | 5 | 2026-10-24T09:23:42.104414+00:00 |
| state\b23-maint-4ixJdP | 763 | 7 | 4 | 2026-10-24T10:56:50.180526+00:00 |
| state\b23-maint-4jcPcM | 1115 | 13 | 4 | 2026-10-24T12:43:33.240030+00:00 |
| state\b23-maint-4oHs3d | 754 | 6 | 1 | 2026-10-24T08:39:16.845441+00:00 |
| state\b23-maint-4p2pY9 | 754 | 6 | 1 | 2026-10-24T11:27:25.197314+00:00 |
| state\b23-maint-4xjXRz | 754 | 6 | 1 | 2026-10-24T11:27:25.250724+00:00 |
| state\b23-maint-4ySLpz | 754 | 6 | 1 | 2026-10-24T10:56:49.871522+00:00 |
| state\b23-maint-50cTWv | 2512 | 15 | 4 | 2026-10-24T08:35:25.848096+00:00 |
| state\b23-maint-56QCIa | 754 | 6 | 1 | 2026-10-24T09:34:33.408228+00:00 |
| state\b23-maint-56wYws | 804 | 10 | 14 | 2026-10-24T09:08:44.291428+00:00 |
| state\b23-maint-5GQLsy | 2592 | 15 | 4 | 2026-10-24T08:02:45.928447+00:00 |
| state\b23-maint-5IWBy0 | 760 | 7 | 1 | 2026-10-24T11:27:25.918755+00:00 |
| state\b23-maint-5KfRoh | 754 | 6 | 1 | 2026-10-24T07:51:40.721089+00:00 |
| state\b23-maint-5YoLQ7 | 804 | 10 | 14 | 2026-10-24T12:43:33.072210+00:00 |
| state\b23-maint-5iTQM3 | 5545 | 16 | 5 | 2026-10-24T11:42:51.238700+00:00 |
| state\b23-maint-5lbSHs | 754 | 6 | 1 | 2026-10-24T11:27:25.177758+00:00 |
| state\b23-maint-5s0B6y | 3128 | 7 | 2 | 2026-10-24T09:07:28.496904+00:00 |
| state\b23-maint-5s5LHv | 5246 | 16 | 5 | 2026-10-24T09:20:42.780386+00:00 |
| state\b23-maint-5tGie8 | 5772 | 18 | 5 | 2026-10-24T09:20:42.620552+00:00 |
| state\b23-maint-5yElFa | 3259 | 7 | 2 | 2026-10-24T10:56:49.745400+00:00 |
| state\b23-maint-62Xhp2 | 2592 | 15 | 4 | 2026-10-24T09:38:38.665774+00:00 |
| state\b23-maint-66Elca | 754 | 6 | 1 | 2026-10-24T09:05:08.009753+00:00 |
| state\b23-maint-69kv8G | 2592 | 15 | 4 | 2026-10-24T09:38:38.626197+00:00 |
| state\b23-maint-6CFBDv | 754 | 6 | 1 | 2026-10-24T11:02:55.348108+00:00 |
| state\b23-maint-6G0lnP | 765 | 7 | 4 | 2026-10-24T11:56:46.422498+00:00 |
| state\b23-maint-6IciZ0 | 743 | 6 | 1 | 2026-10-24T08:35:24.986531+00:00 |
| state\b23-maint-6J7FTw | 754 | 6 | 1 | 2026-10-24T11:02:55.122025+00:00 |
| state\b23-maint-6Jyyy6 | 4386 | 28 | 4 | 2026-10-24T08:07:43.546397+00:00 |
| state\b23-maint-6TpM9X | 754 | 6 | 1 | 2026-10-24T09:34:33.428372+00:00 |
| state\b23-maint-6Ua8WB | 3259 | 7 | 2 | 2026-10-24T09:26:46.009453+00:00 |
| state\b23-maint-6eMrh9 | 754 | 6 | 1 | 2026-10-24T09:01:34.265356+00:00 |
| state\b23-maint-6n4drg | 754 | 6 | 1 | 2026-10-24T10:56:49.908593+00:00 |
| state\b23-maint-6s0wTr | 756 | 7 | 1 | 2026-10-24T08:35:27.409758+00:00 |
| state\b23-maint-70ZLri | 4386 | 28 | 4 | 2026-10-24T08:29:03.674609+00:00 |
| state\b23-maint-72YKm9 | 754 | 6 | 1 | 2026-10-24T15:58:38.663610+00:00 |
| state\b23-maint-73ROwr | 754 | 6 | 1 | 2026-10-24T11:02:55.358126+00:00 |
| state\b23-maint-76JIWM | 6308 | 18 | 5 | 2026-10-24T09:35:05.864014+00:00 |
| state\b23-maint-78hGqS | 2938 | 17 | 4 | 2026-10-24T11:42:51.101925+00:00 |
| state\b23-maint-7QtvX2 | 2512 | 15 | 4 | 2026-10-24T07:55:05.473058+00:00 |
| state\b23-maint-7U8ArH | 756 | 7 | 1 | 2026-10-24T08:28:23.340322+00:00 |
| state\b23-maint-7V1D0M | 5439 | 7 | 1 | 2026-10-24T12:43:32.735677+00:00 |
| state\b23-maint-7hb54N | 754 | 6 | 1 | 2026-10-24T11:32:41.003671+00:00 |
| state\b23-maint-7krFjf | 2512 | 15 | 4 | 2026-10-24T09:38:38.898194+00:00 |
| state\b23-maint-7mfXzQ | 2512 | 15 | 4 | 2026-10-24T08:02:46.096756+00:00 |
| state\b23-maint-7ug8bA | 2592 | 15 | 4 | 2026-10-24T11:56:45.806149+00:00 |
| state\b23-maint-8Eeu3i | 754 | 6 | 1 | 2026-10-24T09:23:42.175945+00:00 |
| state\b23-maint-8H1M21 | 756 | 7 | 1 | 2026-10-24T09:35:05.677873+00:00 |
| state\b23-maint-8I1KI2 | 754 | 6 | 1 | 2026-10-24T09:29:43.595595+00:00 |
| state\b23-maint-8JecTe | 2871 | 7 | 2 | 2026-10-24T11:27:25.443354+00:00 |
| state\b23-maint-8LkeT3 | 754 | 6 | 1 | 2026-10-24T09:33:26.895242+00:00 |
| state\b23-maint-8MAhBZ | 5545 | 16 | 5 | 2026-10-24T11:27:25.495791+00:00 |
| state\b23-maint-8RXCRQ | 6617 | 23 | 5 | 2026-10-24T09:08:44.208378+00:00 |
| state\b23-maint-8d7JMc | 2592 | 15 | 4 | 2026-10-24T07:53:45.083522+00:00 |
| state\b23-maint-8g6kC4 | 5819 | 18 | 5 | 2026-10-24T09:08:00.141048+00:00 |
| state\b23-maint-8hzCnM | 5545 | 16 | 5 | 2026-10-24T09:35:05.834282+00:00 |
| state\b23-maint-8lxL9U | 760 | 7 | 1 | 2026-10-24T12:43:33.268061+00:00 |
| state\b23-maint-8qA9OQ | 754 | 6 | 1 | 2026-10-24T09:35:05.875180+00:00 |
| state\b23-maint-8u0qXx | 5439 | 7 | 1 | 2026-10-24T11:31:48.226650+00:00 |
| state\b23-maint-8y08Kn | 5334 | 15 | 5 | 2026-10-24T10:56:49.730278+00:00 |
| state\b23-maint-91co73 | 5171 | 15 | 5 | 2026-10-24T09:07:12.345431+00:00 |
| state\b23-maint-924iov | 3815 | 22 | 4 | 2026-10-24T09:01:32.732157+00:00 |
| state\b23-maint-92x7wm | 4386 | 28 | 4 | 2026-10-24T11:27:25.711343+00:00 |
| state\b23-maint-98l03D | 2592 | 15 | 4 | 2026-10-24T11:56:45.875011+00:00 |
| state\b23-maint-9AmRKj | 5191 | 15 | 5 | 2026-10-24T09:07:43.928326+00:00 |
| state\b23-maint-9MH1xR | 2592 | 15 | 4 | 2026-10-24T09:35:05.658279+00:00 |
| state\b23-maint-9ahN29 | 5537 | 15 | 5 | 2026-10-24T09:34:33.299885+00:00 |
| state\b23-maint-9fWqpR | 5191 | 15 | 5 | 2026-10-24T09:08:00.204586+00:00 |
| state\b23-maint-9i4fWs | 754 | 6 | 1 | 2026-10-24T15:58:38.441923+00:00 |
| state\b23-maint-9qgbqa | 4386 | 28 | 4 | 2026-10-24T09:05:06.393565+00:00 |
| state\b23-maint-9uIHyB | 754 | 6 | 1 | 2026-10-24T09:38:38.871366+00:00 |
| state\b23-maint-9vqVHF | 5191 | 15 | 5 | 2026-10-24T09:07:28.553380+00:00 |
| state\b23-maint-A56RnW | 5326 | 15 | 5 | 2026-10-24T11:27:25.290568+00:00 |
| state\b23-maint-AEOUlr | 6231 | 18 | 5 | 2026-10-24T11:02:55.411029+00:00 |
| state\b23-maint-AceEng | 754 | 6 | 1 | 2026-10-24T09:08:44.211646+00:00 |
| state\b23-maint-Airf6F | 2512 | 15 | 4 | 2026-10-24T15:58:38.745208+00:00 |
| state\b23-maint-AivjvC | 4016 | 25 | 4 | 2026-10-24T09:35:05.838371+00:00 |
| state\b23-maint-AoHAKx | 754 | 6 | 1 | 2026-10-24T11:02:55.349687+00:00 |
| state\b23-maint-Arrfjk | 754 | 6 | 1 | 2026-10-24T08:28:23.311929+00:00 |
| state\b23-maint-Auc0Ea | 756 | 7 | 1 | 2026-10-24T09:07:59.190787+00:00 |
| state\b23-maint-AxEXkq | 756 | 7 | 1 | 2026-10-24T08:39:25.832600+00:00 |
| state\b23-maint-B01265 | 754 | 6 | 1 | 2026-10-24T11:56:45.745082+00:00 |
| state\b23-maint-B1p1qK | 4016 | 25 | 4 | 2026-10-24T07:53:46.101932+00:00 |
| state\b23-maint-B39UqG | 2938 | 17 | 4 | 2026-10-24T08:40:03.984671+00:00 |
| state\b23-maint-B8DbVs | 754 | 6 | 1 | 2026-10-24T09:30:24.165666+00:00 |
| state\b23-maint-BC0XYd | 4016 | 25 | 4 | 2026-10-24T08:07:43.383140+00:00 |
| state\b23-maint-BCTyBa | 754 | 6 | 1 | 2026-10-24T09:23:42.187996+00:00 |
| state\b23-maint-BFmwrf | 5473 | 15 | 5 | 2026-10-24T09:33:27.147455+00:00 |
| state\b23-maint-BGZJAP | 6617 | 23 | 5 | 2026-10-24T09:08:00.274023+00:00 |
| state\b23-maint-BKHlhv | 754 | 6 | 1 | 2026-10-24T11:56:46.074150+00:00 |
| state\b23-maint-BSGFmm | 6231 | 18 | 5 | 2026-10-24T09:26:45.997277+00:00 |
| state\b23-maint-BTGzXD | 2592 | 15 | 4 | 2026-10-24T09:09:06.248133+00:00 |
| state\b23-maint-BY2PRA | 754 | 6 | 1 | 2026-10-24T09:29:43.562956+00:00 |
| state\b23-maint-BZat9f | 6231 | 18 | 5 | 2026-10-24T11:32:40.814383+00:00 |
| state\b23-maint-BaZTl9 | 754 | 6 | 1 | 2026-10-24T09:05:33.759503+00:00 |
| state\b23-maint-BchwL7 | 760 | 7 | 1 | 2026-10-24T11:42:51.589121+00:00 |
| state\b23-maint-BeHA0G | 5334 | 15 | 5 | 2026-10-24T09:38:38.675685+00:00 |
| state\b23-maint-Bg35j4 | 763 | 7 | 4 | 2026-10-24T11:32:41.322876+00:00 |
| state\b23-maint-BvkYYA | 754 | 6 | 1 | 2026-10-24T11:27:25.266335+00:00 |
| state\b23-maint-BxqcTb | 754 | 6 | 1 | 2026-10-24T12:43:32.966206+00:00 |
| state\b23-maint-C2IKT7 | 754 | 6 | 1 | 2026-10-24T09:38:38.593007+00:00 |
| state\b23-maint-C3NO81 | 6231 | 18 | 5 | 2026-10-24T10:56:49.962948+00:00 |
| state\b23-maint-C3Sp4k | 756 | 7 | 1 | 2026-10-24T10:56:49.685363+00:00 |
| state\b23-maint-C4wnoI | 754 | 6 | 1 | 2026-10-24T09:26:46.145313+00:00 |
| state\b23-maint-CIJXBJ | 743 | 6 | 1 | 2026-10-24T09:26:45.910284+00:00 |
| state\b23-maint-COAnvs | 4016 | 25 | 4 | 2026-10-24T10:56:49.834327+00:00 |
| state\b23-maint-CPTWVh | 737 | 6 | 1 | 2026-10-24T12:43:32.847095+00:00 |
| state\b23-maint-CQTiCw | 5330 | 15 | 5 | 2026-10-24T11:27:25.740918+00:00 |
| state\b23-maint-CUaLJ1 | 5334 | 15 | 5 | 2026-10-24T15:58:38.522136+00:00 |
| state\b23-maint-Cacfv4 | 743 | 6 | 1 | 2026-10-24T09:05:05.353840+00:00 |
| state\b23-maint-CbI4kJ | 754 | 6 | 1 | 2026-10-24T09:35:05.687116+00:00 |
| state\b23-maint-CjUCv9 | 754 | 6 | 1 | 2026-10-24T11:56:45.773388+00:00 |
| state\b23-maint-D2IY1T | 754 | 6 | 1 | 2026-10-24T11:56:46.100197+00:00 |
| state\b23-maint-D5oVko | 754 | 6 | 1 | 2026-10-24T10:56:49.867523+00:00 |
| state\b23-maint-D69nxS | 3815 | 22 | 4 | 2026-10-24T09:09:06.419501+00:00 |
| state\b23-maint-DIbMZm | 765 | 7 | 4 | 2026-10-24T11:02:55.614070+00:00 |
| state\b23-maint-DJZYcR | 754 | 6 | 1 | 2026-10-24T08:40:04.773159+00:00 |
| state\b23-maint-DKUWX6 | 754 | 6 | 1 | 2026-10-24T08:35:27.389023+00:00 |
| state\b23-maint-DMMlwb | 3259 | 7 | 2 | 2026-10-24T11:27:25.328940+00:00 |
| state\b23-maint-DY8HYm | 5334 | 15 | 5 | 2026-10-24T11:02:55.166088+00:00 |
| state\b23-maint-DlOMNj | 5184 | 15 | 5 | 2026-10-24T09:08:44.114014+00:00 |
| state\b23-maint-DzEiQr | 754 | 6 | 1 | 2026-10-24T09:26:45.973755+00:00 |
| state\b23-maint-E02OLP | 2592 | 15 | 4 | 2026-10-24T09:35:05.688374+00:00 |
| state\b23-maint-E0U59B | 754 | 6 | 1 | 2026-10-24T08:35:27.368762+00:00 |
| state\b23-maint-E0V7vk | 754 | 6 | 1 | 2026-10-24T11:02:55.127023+00:00 |
| state\b23-maint-E4H9DH | 6231 | 18 | 5 | 2026-10-24T11:27:25.307671+00:00 |
| state\b23-maint-E4KCrP | 754 | 6 | 1 | 2026-10-24T08:39:16.821992+00:00 |
| state\b23-maint-E4d7fy | 5326 | 15 | 5 | 2026-10-24T11:56:45.852547+00:00 |
| state\b23-maint-EAmFb1 | 754 | 6 | 1 | 2026-10-24T08:40:04.810240+00:00 |
| state\b23-maint-EDxvQr | 5224 | 15 | 5 | 2026-10-24T09:20:42.559314+00:00 |
| state\b23-maint-EF6LaY | 754 | 6 | 1 | 2026-10-24T09:07:59.159657+00:00 |
| state\b23-maint-ELCcvw | 743 | 6 | 1 | 2026-10-24T12:43:32.696909+00:00 |
| state\b23-maint-EOAx2D | 5819 | 18 | 5 | 2026-10-24T09:08:44.075431+00:00 |
| state\b23-maint-EYFIG7 | 754 | 6 | 1 | 2026-10-24T07:55:04.608455+00:00 |
| state\b23-maint-EYe4g6 | 754 | 6 | 1 | 2026-10-24T09:26:45.924299+00:00 |
| state\b23-maint-EefxzL | 4016 | 25 | 4 | 2026-10-24T08:39:25.105027+00:00 |
| state\b23-maint-Eg3n47 | 5545 | 16 | 5 | 2026-10-24T09:33:26.860931+00:00 |
| state\b23-maint-EgSC4K | 5819 | 18 | 5 | 2026-10-24T09:07:43.862801+00:00 |
| state\b23-maint-EmGHYe | 754 | 6 | 1 | 2026-10-24T11:02:55.331704+00:00 |
| state\b23-maint-EmrSvU | 765 | 7 | 4 | 2026-10-24T15:58:38.992125+00:00 |
| state\b23-maint-EnjTad | 754 | 6 | 1 | 2026-10-24T09:29:43.576042+00:00 |
| state\b23-maint-EnoqkV | 754 | 6 | 1 | 2026-10-24T08:40:04.807212+00:00 |
| state\b23-maint-EyHVo7 | 756 | 7 | 1 | 2026-10-24T11:32:40.762104+00:00 |
| state\b23-maint-F20nbj | 6308 | 18 | 5 | 2026-10-24T12:43:32.953649+00:00 |
| state\b23-maint-F3LwsU | 743 | 6 | 1 | 2026-10-24T08:07:42.456635+00:00 |
| state\b23-maint-F3SB0n | 754 | 6 | 1 | 2026-10-24T08:29:05.144342+00:00 |
| state\b23-maint-F5fWoa | 765 | 7 | 4 | 2026-10-24T09:30:24.408168+00:00 |
| state\b23-maint-F6F5HO | 3262 | 7 | 2 | 2026-10-24T09:33:26.808253+00:00 |
| state\b23-maint-F6iSVk | 3262 | 7 | 2 | 2026-10-24T09:38:19.638691+00:00 |
| state\b23-maint-F7Gilg | 5537 | 15 | 5 | 2026-10-24T11:02:55.200106+00:00 |
| state\b23-maint-F97GuG | 2512 | 15 | 4 | 2026-10-24T09:07:57.478943+00:00 |
| state\b23-maint-FCysH6 | 756 | 7 | 1 | 2026-10-24T09:01:34.293313+00:00 |
| state\b23-maint-FHJi5a | 1115 | 13 | 4 | 2026-10-24T11:02:55.597635+00:00 |
| state\b23-maint-FHZJBL | 754 | 6 | 1 | 2026-10-24T09:26:46.142806+00:00 |
| state\b23-maint-FPbSHp | 754 | 6 | 1 | 2026-10-24T09:35:05.885196+00:00 |
| state\b23-maint-Fm5NrM | 2871 | 7 | 2 | 2026-10-24T11:42:51.195884+00:00 |
| state\b23-maint-FsBphI | 5184 | 15 | 5 | 2026-10-24T09:07:43.905200+00:00 |
| state\b23-maint-FtU0aj | 5334 | 15 | 5 | 2026-10-24T12:43:32.797378+00:00 |
| state\b23-maint-FxGMmU | 754 | 6 | 1 | 2026-10-24T09:01:34.256315+00:00 |
| state\b23-maint-G9GnFV | 754 | 6 | 1 | 2026-10-24T11:27:25.386983+00:00 |
| state\b23-maint-G9LB6l | 5545 | 16 | 5 | 2026-10-24T11:32:40.959897+00:00 |
| state\b23-maint-GFODNq | 754 | 6 | 1 | 2026-10-24T08:29:05.152921+00:00 |
| state\b23-maint-GHHVqX | 5439 | 7 | 1 | 2026-10-24T11:42:51.041340+00:00 |
| state\b23-maint-GTjHCS | 754 | 6 | 1 | 2026-10-24T09:35:05.623044+00:00 |
| state\b23-maint-GTxkZA | 5315 | 15 | 5 | 2026-10-24T11:42:51.147778+00:00 |
| state\b23-maint-GWYxH9 | 754 | 6 | 1 | 2026-10-24T09:30:24.075022+00:00 |
| state\b23-maint-GYe75S | 5473 | 15 | 5 | 2026-10-24T11:02:55.581524+00:00 |
| state\b23-maint-GZ6WuV | 2592 | 15 | 4 | 2026-10-24T08:29:03.454812+00:00 |
| state\b23-maint-Gb9Ps0 | 754 | 6 | 1 | 2026-10-24T11:32:40.993368+00:00 |
| state\b23-maint-GgfLG5 | 2592 | 15 | 4 | 2026-10-24T07:55:05.296935+00:00 |
| state\b23-maint-Gxnjua | 2871 | 7 | 2 | 2026-10-24T09:34:33.356543+00:00 |
| state\b23-maint-H95o1m | 754 | 6 | 1 | 2026-10-24T09:29:43.606787+00:00 |
| state\b23-maint-HATgIG | 2871 | 7 | 2 | 2026-10-24T11:02:55.258273+00:00 |
| state\b23-maint-HJzeWc | 5603 | 15 | 5 | 2026-10-24T10:56:49.807832+00:00 |
| state\b23-maint-HKZwQa | 6231 | 18 | 5 | 2026-10-24T09:38:38.666769+00:00 |
| state\b23-maint-HNt8RZ | 754 | 6 | 1 | 2026-10-24T11:27:25.546212+00:00 |
| state\b23-maint-HQqOWk | 754 | 6 | 1 | 2026-10-24T08:40:02.193872+00:00 |
| state\b23-maint-HRQpYr | 6308 | 18 | 5 | 2026-10-24T09:26:46.131773+00:00 |
| state\b23-maint-HhYwVU | 754 | 6 | 1 | 2026-10-24T12:43:32.969223+00:00 |
| state\b23-maint-HnCOqb | 6231 | 18 | 5 | 2026-10-24T12:43:32.798379+00:00 |
| state\b23-maint-Hnl6Mo | 3128 | 7 | 2 | 2026-10-24T09:08:00.153217+00:00 |
| state\b23-maint-HpRn0N | 754 | 6 | 1 | 2026-10-24T09:38:38.847424+00:00 |
| state\b23-maint-Hrn9kF | 754 | 6 | 1 | 2026-10-24T11:56:45.756169+00:00 |
| state\b23-maint-HsJduX | 754 | 6 | 1 | 2026-10-24T10:56:49.671661+00:00 |
| state\b23-maint-HuNbZE | 754 | 6 | 1 | 2026-10-24T09:09:09.194398+00:00 |
| state\b23-maint-Hx1edo | 2512 | 15 | 4 | 2026-10-24T09:35:05.922655+00:00 |
| state\b23-maint-HylnE8 | 4016 | 25 | 4 | 2026-10-24T11:56:46.005395+00:00 |
| state\b23-maint-IF47Ak | 2592 | 15 | 4 | 2026-10-24T09:26:45.938040+00:00 |
| state\b23-maint-IHDs4v | 754 | 6 | 1 | 2026-10-24T09:38:38.823504+00:00 |
| state\b23-maint-IJArNX | 804 | 10 | 14 | 2026-10-24T09:09:09.267793+00:00 |
| state\b23-maint-IJAt0E | 5537 | 15 | 5 | 2026-10-24T09:30:24.065019+00:00 |
| state\b23-maint-IP0T7P | 5330 | 15 | 5 | 2026-10-24T12:43:33.113762+00:00 |
| state\b23-maint-IPx7ga | 2512 | 15 | 4 | 2026-10-24T08:29:03.596336+00:00 |
| state\b23-maint-IQcZTt | 5545 | 16 | 5 | 2026-10-24T10:56:49.855158+00:00 |
| state\b23-maint-ITZZRR | 5537 | 15 | 5 | 2026-10-24T11:56:45.935490+00:00 |
| state\b23-maint-IYuo8B | 6231 | 18 | 5 | 2026-10-24T11:42:51.093589+00:00 |
| state\b23-maint-Iih5TU | 3166 | 7 | 2 | 2026-10-24T09:20:42.744394+00:00 |
| state\b23-maint-Ijy5ik | 2592 | 15 | 4 | 2026-10-24T08:02:45.907818+00:00 |
| state\b23-maint-IqFkxO | 2512 | 15 | 4 | 2026-10-24T11:42:51.131320+00:00 |
| state\b23-maint-J1nx6w | 754 | 6 | 1 | 2026-10-24T12:43:32.688173+00:00 |
| state\b23-maint-J39Dxb | 2592 | 15 | 4 | 2026-10-24T08:29:03.436822+00:00 |
| state\b23-maint-J8HCcn | 5603 | 15 | 5 | 2026-10-24T09:35:05.792032+00:00 |
| state\b23-maint-JHaCbz | 754 | 6 | 1 | 2026-10-24T15:58:38.678415+00:00 |
| state\b23-maint-JJ9fwJ | 754 | 6 | 1 | 2026-10-24T08:35:27.399671+00:00 |
| state\b23-maint-JLsvsx | 4016 | 25 | 4 | 2026-10-24T08:02:46.968907+00:00 |
| state\b23-maint-JRhNnn | 5545 | 16 | 5 | 2026-10-24T09:34:33.386662+00:00 |
| state\b23-maint-JUCfIh | 756 | 7 | 1 | 2026-10-24T11:27:25.236891+00:00 |
| state\b23-maint-JWgVTZ | 754 | 6 | 1 | 2026-10-24T08:40:04.761317+00:00 |
| state\b23-maint-JaveRP | 3815 | 22 | 4 | 2026-10-24T10:56:49.916592+00:00 |
| state\b23-maint-JbAyOI | 3815 | 22 | 4 | 2026-10-24T08:07:43.436607+00:00 |
| state\b23-maint-JbLrN3 | 754 | 6 | 1 | 2026-10-24T09:38:38.629709+00:00 |
| state\b23-maint-JcaD21 | 765 | 7 | 4 | 2026-10-24T09:38:39.151405+00:00 |
| state\b23-maint-JizWoS | 2512 | 15 | 4 | 2026-10-24T11:27:25.333942+00:00 |
| state\b23-maint-JrHPZW | 2512 | 15 | 4 | 2026-10-24T08:07:43.457270+00:00 |
| state\b23-maint-Js928c | 6231 | 18 | 5 | 2026-10-24T11:32:41.078034+00:00 |
| state\b23-maint-Jsgpnj | 756 | 7 | 1 | 2026-10-24T08:29:05.161971+00:00 |
| state\b23-maint-JtXLNY | 5545 | 16 | 5 | 2026-10-24T09:29:43.552450+00:00 |
| state\b23-maint-JuWZhW | 754 | 6 | 1 | 2026-10-24T09:26:45.938040+00:00 |
| state\b23-maint-JxonET | 754 | 6 | 1 | 2026-10-24T11:42:51.257454+00:00 |
| state\b23-maint-JzS7uK | 737 | 6 | 1 | 2026-10-24T10:56:49.781238+00:00 |
| state\b23-maint-K7k3jL | 754 | 6 | 1 | 2026-10-24T09:35:05.846152+00:00 |
| state\b23-maint-K8XxvW | 737 | 6 | 1 | 2026-10-24T11:27:25.392689+00:00 |
| state\b23-maint-K9wtE5 | 3815 | 22 | 4 | 2026-10-24T08:35:25.833127+00:00 |
| state\b23-maint-KCjtmK | 1115 | 13 | 4 | 2026-10-24T11:27:25.891969+00:00 |
| state\b23-maint-KDHY5D | 737 | 6 | 1 | 2026-10-24T11:56:45.954219+00:00 |
| state\b23-maint-KFNwKR | 4016 | 25 | 4 | 2026-10-24T09:09:06.365376+00:00 |
| state\b23-maint-KGvnod | 754 | 6 | 1 | 2026-10-24T11:32:40.731092+00:00 |
| state\b23-maint-KIvXDy | 5603 | 15 | 5 | 2026-10-24T11:42:51.177582+00:00 |
| state\b23-maint-KJbmUl | 4016 | 25 | 4 | 2026-10-24T09:38:38.801610+00:00 |
| state\b23-maint-KLcC2o | 5819 | 18 | 5 | 2026-10-24T09:07:44.059982+00:00 |
| state\b23-maint-KPpLMn | 754 | 6 | 1 | 2026-10-24T07:52:05.405232+00:00 |
| state\b23-maint-KTjvMz | 3815 | 22 | 4 | 2026-10-24T09:38:38.876067+00:00 |
| state\b23-maint-KUAcO4 | 2592 | 15 | 4 | 2026-10-24T09:38:38.584839+00:00 |
| state\b23-maint-KV4unP | 754 | 6 | 1 | 2026-10-24T09:09:05.493473+00:00 |
| state\b23-maint-KbETll | 754 | 6 | 1 | 2026-10-24T11:02:55.317250+00:00 |
| state\b23-maint-KfiGFW | 5326 | 15 | 5 | 2026-10-24T10:56:49.699536+00:00 |
| state\b23-maint-KpEfqI | 3815 | 22 | 4 | 2026-10-24T12:43:32.998557+00:00 |
| state\b23-maint-KpFHhD | 5537 | 15 | 5 | 2026-10-24T09:33:26.791613+00:00 |
| state\b23-maint-LBX9ow | 2512 | 15 | 4 | 2026-10-24T09:26:46.182754+00:00 |
| state\b23-maint-LGrKJZ | 2938 | 17 | 4 | 2026-10-24T09:09:07.292457+00:00 |
| state\b23-maint-LgNxX6 | 2938 | 17 | 4 | 2026-10-24T11:02:55.165086+00:00 |
| state\b23-maint-LiFxXk | 754 | 6 | 1 | 2026-10-24T11:32:40.745606+00:00 |
| state\b23-maint-Lk1RlM | 4016 | 25 | 4 | 2026-10-24T07:55:05.411201+00:00 |
| state\b23-maint-LlCEQE | 6231 | 18 | 5 | 2026-10-24T09:26:46.204898+00:00 |
| state\b23-maint-Lpt2cN | 754 | 6 | 1 | 2026-10-24T10:56:49.890573+00:00 |
| state\b23-maint-LuPjlj | 2592 | 15 | 4 | 2026-10-24T12:43:32.795378+00:00 |
| state\b23-maint-M1b4ya | 5819 | 18 | 5 | 2026-10-24T09:09:09.058992+00:00 |
| state\b23-maint-M1rj0i | 743 | 6 | 1 | 2026-10-24T09:38:38.555378+00:00 |
| state\b23-maint-M976wL | 5334 | 15 | 5 | 2026-10-24T09:33:26.763892+00:00 |
| state\b23-maint-MTiZDI | 4386 | 28 | 4 | 2026-10-24T09:35:06.018186+00:00 |
| state\b23-maint-MTyR8W | 2592 | 15 | 4 | 2026-10-24T07:53:45.105523+00:00 |
| state\b23-maint-MYZkvT | 1115 | 13 | 4 | 2026-10-24T10:56:50.154078+00:00 |
| state\b23-maint-MgZ6vU | 2512 | 15 | 4 | 2026-10-24T09:07:57.331033+00:00 |
| state\b23-maint-MiCj41 | 2938 | 17 | 4 | 2026-10-24T11:27:25.332944+00:00 |
| state\b23-maint-MmliES | 3815 | 22 | 4 | 2026-10-24T11:02:55.367812+00:00 |
| state\b23-maint-Mp2pcy | 5326 | 15 | 5 | 2026-10-24T11:32:40.786117+00:00 |
| state\b23-maint-MsYPGN | 5330 | 15 | 5 | 2026-10-24T10:56:50.035927+00:00 |
| state\b23-maint-MtSe5y | 2938 | 17 | 4 | 2026-10-24T10:56:49.732298+00:00 |
| state\b23-maint-MyMnmg | 743 | 6 | 1 | 2026-10-24T11:02:55.057633+00:00 |
| state\b23-maint-MyOL0D | 754 | 6 | 1 | 2026-10-24T09:26:45.901865+00:00 |
| state\b23-maint-N0XjK6 | 754 | 6 | 1 | 2026-10-24T09:09:08.088652+00:00 |
| state\b23-maint-N5Rsj7 | 765 | 7 | 4 | 2026-10-24T09:33:27.178238+00:00 |
| state\b23-maint-NIF2Je | 754 | 6 | 1 | 2026-10-24T12:43:32.842412+00:00 |
| state\b23-maint-NLANIZ | 2512 | 15 | 4 | 2026-10-24T10:56:49.755030+00:00 |
| state\b23-maint-NMAmnm | 2512 | 15 | 4 | 2026-10-24T09:09:06.436709+00:00 |
| state\b23-maint-NaUsRG | 754 | 6 | 1 | 2026-10-24T10:46:16.285148+00:00 |
| state\b23-maint-NiHi4p | 1115 | 13 | 4 | 2026-10-24T11:56:46.403790+00:00 |
| state\b23-maint-NmzVIn | 2512 | 15 | 4 | 2026-10-24T15:58:38.556818+00:00 |
| state\b23-maint-NqNT8a | 4016 | 25 | 4 | 2026-10-24T12:43:32.903453+00:00 |
| state\b23-maint-NqfeF6 | 763 | 7 | 4 | 2026-10-24T11:27:25.918755+00:00 |
| state\b23-maint-NsgerP | 743 | 6 | 1 | 2026-10-24T09:35:05.622043+00:00 |
| state\b23-maint-NvlWGd | 756 | 7 | 1 | 2026-10-24T11:02:55.107294+00:00 |
| state\b23-maint-NySly7 | 5603 | 15 | 5 | 2026-10-24T11:27:25.406045+00:00 |
| state\b23-maint-O4Ajqp | 743 | 6 | 1 | 2026-10-24T08:02:45.183381+00:00 |
| state\b23-maint-OAbiSL | 754 | 6 | 1 | 2026-10-24T09:05:07.990166+00:00 |
| state\b23-maint-OCdsUo | 5537 | 15 | 5 | 2026-10-24T15:58:38.552540+00:00 |
| state\b23-maint-OKM2lM | 5184 | 15 | 5 | 2026-10-24T09:07:28.530700+00:00 |
| state\b23-maint-OMDz1A | 4016 | 25 | 4 | 2026-10-24T09:01:32.688226+00:00 |
| state\b23-maint-OMrfDK | 1115 | 13 | 4 | 2026-10-24T09:30:24.392586+00:00 |
| state\b23-maint-ONMn7b | 760 | 7 | 1 | 2026-10-24T09:38:39.159796+00:00 |
| state\b23-maint-OXQCsx | 754 | 6 | 1 | 2026-10-24T11:27:25.534407+00:00 |
| state\b23-maint-OYFxvO | 754 | 6 | 1 | 2026-10-24T08:39:25.819368+00:00 |
| state\b23-maint-ObJ0je | 3815 | 22 | 4 | 2026-10-24T11:32:41.035690+00:00 |
| state\b23-maint-OdEkNR | 754 | 6 | 1 | 2026-10-24T09:08:44.215693+00:00 |
| state\b23-maint-Og146y | 5545 | 16 | 5 | 2026-10-24T15:58:38.649953+00:00 |
| state\b23-maint-OlIEkB | 4016 | 25 | 4 | 2026-10-24T09:05:06.231938+00:00 |
| state\b23-maint-OpYAPg | 754 | 6 | 1 | 2026-10-24T12:43:32.694528+00:00 |
| state\b23-maint-Oq2kAH | 2512 | 15 | 4 | 2026-10-24T09:38:38.698138+00:00 |
| state\b23-maint-OqgVus | 765 | 7 | 4 | 2026-10-24T11:42:51.580683+00:00 |
| state\b23-maint-OuVwVO | 6308 | 18 | 5 | 2026-10-24T11:27:25.509014+00:00 |
| state\b23-maint-Ovt6oY | 754 | 6 | 1 | 2026-10-24T15:58:38.700641+00:00 |
| state\b23-maint-P9rzXO | 2592 | 15 | 4 | 2026-10-24T10:56:49.725908+00:00 |
| state\b23-maint-PChFij | 754 | 6 | 1 | 2026-10-24T07:52:06.085208+00:00 |
| state\b23-maint-PE8f6y | 3815 | 22 | 4 | 2026-10-24T08:40:03.120116+00:00 |
| state\b23-maint-PFyKSK | 754 | 6 | 1 | 2026-10-24T08:40:04.788783+00:00 |
| state\b23-maint-PLSI08 | 754 | 6 | 1 | 2026-10-24T10:56:49.880043+00:00 |
| state\b23-maint-PRFUpJ | 4016 | 25 | 4 | 2026-10-24T11:32:40.960895+00:00 |
| state\b23-maint-PTb3QR | 4016 | 25 | 4 | 2026-10-24T08:39:24.188066+00:00 |
| state\b23-maint-PURZRD | 3262 | 7 | 2 | 2026-10-24T09:34:33.335389+00:00 |
| state\b23-maint-PrPJhZ | 756 | 7 | 1 | 2026-10-24T08:28:53.251859+00:00 |
| state\b23-maint-Psog2c | 2938 | 17 | 4 | 2026-10-24T09:26:45.994912+00:00 |
| state\b23-maint-PtEQxV | 5537 | 15 | 5 | 2026-10-24T10:56:49.763443+00:00 |
| state\b23-maint-Q3BMpZ | 754 | 6 | 1 | 2026-10-24T11:27:25.559335+00:00 |
| state\b23-maint-Q7fPxB | 2512 | 15 | 4 | 2026-10-24T09:35:05.745107+00:00 |
| state\b23-maint-QIOns2 | 3259 | 7 | 2 | 2026-10-24T11:02:55.186826+00:00 |
| state\b23-maint-QKU5Kw | 5473 | 15 | 5 | 2026-10-24T09:34:33.654054+00:00 |
| state\b23-maint-QhuvLP | 754 | 6 | 1 | 2026-10-24T09:07:56.523220+00:00 |
| state\b23-maint-QhxR5m | 5896 | 18 | 5 | 2026-10-24T09:07:28.614320+00:00 |
| state\b23-maint-QjE8KO | 2592 | 15 | 4 | 2026-10-24T08:02:45.949781+00:00 |
| state\b23-maint-QkVNQk | 5315 | 15 | 5 | 2026-10-24T11:32:40.871510+00:00 |
| state\b23-maint-Qqypy6 | 754 | 6 | 1 | 2026-10-24T07:52:04.705055+00:00 |
| state\b23-maint-Qt44BF | 754 | 6 | 1 | 2026-10-24T08:39:25.844852+00:00 |
| state\b23-maint-R34yy0 | 756 | 7 | 1 | 2026-10-24T12:43:32.749940+00:00 |
| state\b23-maint-R43xgM | 2592 | 15 | 4 | 2026-10-24T08:35:25.695107+00:00 |
| state\b23-maint-R6h2XB | 754 | 6 | 1 | 2026-10-24T09:01:34.300835+00:00 |
| state\b23-maint-RM3SjM | 5330 | 15 | 5 | 2026-10-24T09:35:06.009406+00:00 |
| state\b23-maint-RNBkAl | 2592 | 15 | 4 | 2026-10-24T08:39:24.109463+00:00 |
| state\b23-maint-ROJrzh | 754 | 6 | 1 | 2026-10-24T09:38:38.859783+00:00 |
| state\b23-maint-ROk623 | 5326 | 15 | 5 | 2026-10-24T09:34:33.252715+00:00 |
| state\b23-maint-RP3FG1 | 2592 | 15 | 4 | 2026-10-24T11:42:51.098666+00:00 |
| state\b23-maint-RSMqVd | 5473 | 15 | 5 | 2026-10-24T11:42:51.549711+00:00 |
| state\b23-maint-RUuU99 | 5473 | 15 | 5 | 2026-10-24T09:35:06.108544+00:00 |
| state\b23-maint-RXdvix | 754 | 6 | 1 | 2026-10-24T15:58:38.565489+00:00 |
| state\b23-maint-RcQyiD | 743 | 6 | 1 | 2026-10-24T08:29:02.713511+00:00 |
| state\b23-maint-RftI4d | 2512 | 15 | 4 | 2026-10-24T08:40:03.138909+00:00 |
| state\b23-maint-RlEjjF | 5334 | 15 | 5 | 2026-10-24T11:32:40.821593+00:00 |
| state\b23-maint-Rn4RZd | 4016 | 25 | 4 | 2026-10-24T09:26:46.082088+00:00 |
| state\b23-maint-RqWRsF | 5603 | 15 | 5 | 2026-10-24T11:02:55.254272+00:00 |
| state\b23-maint-RrUaN7 | 754 | 6 | 1 | 2026-10-24T08:39:25.841337+00:00 |
| state\b23-maint-RwVhok | 5603 | 15 | 5 | 2026-10-24T11:32:40.903843+00:00 |
| state\b23-maint-S0M2Zh | 5326 | 15 | 5 | 2026-10-24T09:23:42.063568+00:00 |
| state\b23-maint-S3RVpS | 754 | 6 | 1 | 2026-10-24T12:43:32.974228+00:00 |
| state\b23-maint-S5A7Fl | 5473 | 15 | 5 | 2026-10-24T15:58:38.949106+00:00 |
| state\b23-maint-S5fKcB | 754 | 6 | 1 | 2026-10-24T09:35:05.761141+00:00 |
| state\b23-maint-SGxrAD | 754 | 6 | 1 | 2026-10-24T09:23:42.179103+00:00 |
| state\b23-maint-SPKn61 | 5334 | 15 | 5 | 2026-10-24T09:29:43.459400+00:00 |
| state\b23-maint-SRhBAW | 5315 | 15 | 5 | 2026-10-24T09:38:38.724357+00:00 |
| state\b23-maint-STvx47 | 2512 | 15 | 4 | 2026-10-24T08:35:25.733503+00:00 |
| state\b23-maint-SYDbRg | 3262 | 7 | 2 | 2026-10-24T09:35:05.772858+00:00 |
| state\b23-maint-Sh23nV | 4386 | 28 | 4 | 2026-10-24T08:35:25.923878+00:00 |
| state\b23-maint-ShWF9I | 804 | 10 | 14 | 2026-10-24T11:02:55.436690+00:00 |
| state\b23-maint-Sl0Z2h | 4016 | 25 | 4 | 2026-10-24T09:05:07.223551+00:00 |
| state\b23-maint-SveARo | 5545 | 16 | 5 | 2026-10-24T09:23:42.165473+00:00 |
| state\b23-maint-Sy2QSY | 754 | 6 | 1 | 2026-10-24T11:27:25.572175+00:00 |
| state\b23-maint-T0VfKP | 3257 | 7 | 2 | 2026-10-24T09:34:33.321449+00:00 |
| state\b23-maint-T1uBwz | 754 | 6 | 1 | 2026-10-24T09:01:34.303584+00:00 |
| state\b23-maint-T77zCQ | 754 | 6 | 1 | 2026-10-24T09:08:00.278022+00:00 |
| state\b23-maint-THpHAM | 754 | 6 | 1 | 2026-10-24T11:56:45.950081+00:00 |
| state\b23-maint-THuvD6 | 754 | 6 | 1 | 2026-10-24T09:07:44.004953+00:00 |
| state\b23-maint-TIroXq | 5191 | 15 | 5 | 2026-10-24T09:08:44.135261+00:00 |
| state\b23-maint-TNKbLI | 2592 | 15 | 4 | 2026-10-24T11:27:25.244508+00:00 |
| state\b23-maint-TZi7bh | 4386 | 28 | 4 | 2026-10-24T11:42:51.434438+00:00 |
| state\b23-maint-TcOBxa | 754 | 6 | 1 | 2026-10-24T08:29:05.135264+00:00 |
| state\b23-maint-TdEjp8 | 754 | 6 | 1 | 2026-10-24T11:32:40.779426+00:00 |
| state\b23-maint-TdudCP | 754 | 6 | 1 | 2026-10-24T09:35:05.877181+00:00 |
| state\b23-maint-TjPbm2 | 754 | 6 | 1 | 2026-10-24T08:39:16.830031+00:00 |
| state\b23-maint-Tji7Ng | 754 | 6 | 1 | 2026-10-24T09:08:00.280888+00:00 |
| state\b23-maint-TwXZw2 | 3259 | 7 | 2 | 2026-10-24T09:35:05.732858+00:00 |
| state\b23-maint-U2kkY3 | 2938 | 17 | 4 | 2026-10-24T08:29:04.398690+00:00 |
| state\b23-maint-UDc5on | 5184 | 15 | 5 | 2026-10-24T09:09:09.098850+00:00 |
| state\b23-maint-UHA5uT | 754 | 6 | 1 | 2026-10-24T12:43:32.963806+00:00 |
| state\b23-maint-UN7Ywt | 754 | 6 | 1 | 2026-10-24T11:42:51.271116+00:00 |
| state\b23-maint-UOvwjW | 754 | 6 | 1 | 2026-10-24T11:32:40.702620+00:00 |
| state\b23-maint-UUNes0 | 3815 | 22 | 4 | 2026-10-24T07:53:45.234844+00:00 |
| state\b23-maint-UWc6D0 | 1115 | 13 | 4 | 2026-10-24T11:42:51.567219+00:00 |
| state\b23-maint-UXzR5R | 6308 | 18 | 5 | 2026-10-24T11:56:46.054903+00:00 |
| state\b23-maint-UYEQ9F | 4016 | 25 | 4 | 2026-10-24T08:29:03.536867+00:00 |
| state\b23-maint-UiQF98 | 4386 | 28 | 4 | 2026-10-24T11:02:55.480340+00:00 |
| state\b23-maint-Uyt7FM | 754 | 6 | 1 | 2026-10-24T12:43:32.763914+00:00 |
| state\b23-maint-V2XoWc | 754 | 6 | 1 | 2026-10-24T11:42:50.986732+00:00 |
| state\b23-maint-V60VSp | 754 | 6 | 1 | 2026-10-24T09:35:05.663765+00:00 |
| state\b23-maint-V9IU1T | 754 | 6 | 1 | 2026-10-24T09:29:43.736899+00:00 |
| state\b23-maint-VKaLv3 | 4016 | 25 | 4 | 2026-10-24T11:56:46.019170+00:00 |
| state\b23-maint-VNkORS | 2512 | 15 | 4 | 2026-10-24T11:02:55.386900+00:00 |
| state\b23-maint-VNp6jo | 6231 | 18 | 5 | 2026-10-24T11:02:55.170256+00:00 |
| state\b23-maint-VPLkKK | 804 | 10 | 14 | 2026-10-24T10:56:49.989495+00:00 |
| state\b23-maint-VYaX6u | 754 | 6 | 1 | 2026-10-24T11:42:51.275243+00:00 |
| state\b23-maint-VcZO06 | 4016 | 25 | 4 | 2026-10-24T08:29:04.458753+00:00 |
| state\b23-maint-Vm9nX2 | 754 | 6 | 1 | 2026-10-24T08:39:16.801704+00:00 |
| state\b23-maint-VqcavT | 2592 | 15 | 4 | 2026-10-24T10:56:49.695815+00:00 |
| state\b23-maint-VsfNZn | 2512 | 15 | 4 | 2026-10-24T11:02:55.195880+00:00 |
| state\b23-maint-Vv55YY | 2592 | 15 | 4 | 2026-10-24T08:39:24.067279+00:00 |
| state\b23-maint-VxYGTs | 754 | 6 | 1 | 2026-10-24T09:26:45.945810+00:00 |
| state\b23-maint-W0S4xs | 5537 | 15 | 5 | 2026-10-24T09:38:38.712821+00:00 |
| state\b23-maint-W4yDs5 | 754 | 6 | 1 | 2026-10-24T11:56:46.078504+00:00 |
| state\b23-maint-W8YgJC | 5330 | 15 | 5 | 2026-10-24T09:34:33.549873+00:00 |
| state\b23-maint-WAwjyj | 754 | 6 | 1 | 2026-10-24T09:30:24.141008+00:00 |
| state\b23-maint-WEz3lE | 5326 | 15 | 5 | 2026-10-24T12:43:32.767728+00:00 |
| state\b23-maint-WHf7Ua | 2512 | 15 | 4 | 2026-10-24T11:32:40.849969+00:00 |
| state\b23-maint-WOYiSZ | 743 | 6 | 1 | 2026-10-24T08:40:02.197403+00:00 |
| state\b23-maint-WObZDF | 754 | 6 | 1 | 2026-10-24T09:05:07.958430+00:00 |
| state\b23-maint-WQLPJQ | 3259 | 7 | 2 | 2026-10-24T11:56:45.896190+00:00 |
| state\b23-maint-WQsL2c | 2592 | 15 | 4 | 2026-10-24T15:58:38.529046+00:00 |
| state\b23-maint-WXYQEm | 754 | 6 | 1 | 2026-10-24T10:56:49.658977+00:00 |
| state\b23-maint-WbKGGP | 754 | 6 | 1 | 2026-10-24T10:56:49.900090+00:00 |
| state\b23-maint-WbbiEq | 754 | 6 | 1 | 2026-10-24T09:33:26.904804+00:00 |
| state\b23-maint-Wd4nZv | 765 | 7 | 4 | 2026-10-24T11:27:25.909604+00:00 |
| state\b23-maint-Wl7RWx | 4016 | 25 | 4 | 2026-10-24T09:09:07.364351+00:00 |
| state\b23-maint-WrsDyW | 6231 | 18 | 5 | 2026-10-24T11:56:45.879345+00:00 |
| state\b23-maint-WvShD4 | 743 | 6 | 1 | 2026-10-24T11:42:50.988542+00:00 |
| state\b23-maint-WxsH1X | 2512 | 15 | 4 | 2026-10-24T09:01:32.747170+00:00 |
| state\b23-maint-WzzD46 | 754 | 6 | 1 | 2026-10-24T12:43:32.940084+00:00 |
| state\b23-maint-X1rg6l | 2512 | 15 | 4 | 2026-10-24T10:56:49.936831+00:00 |
| state\b23-maint-X3EfGX | 3815 | 22 | 4 | 2026-10-24T08:29:03.581970+00:00 |
| state\b23-maint-X3WU3N | 4386 | 28 | 4 | 2026-10-24T09:09:06.527792+00:00 |
| state\b23-maint-X3nZZU | 1115 | 13 | 4 | 2026-10-24T09:33:27.162931+00:00 |
| state\b23-maint-X5rfd4 | 2592 | 15 | 4 | 2026-10-24T08:07:43.238326+00:00 |
| state\b23-maint-XBDTze | 754 | 6 | 1 | 2026-10-24T09:30:24.174318+00:00 |
| state\b23-maint-XPJYEd | 5473 | 15 | 5 | 2026-10-24T12:43:33.220514+00:00 |
| state\b23-maint-XUDOwC | 4386 | 28 | 4 | 2026-10-24T09:07:57.569305+00:00 |
| state\b23-maint-XUNkUs | 743 | 6 | 1 | 2026-10-24T08:39:23.384502+00:00 |
| state\b23-maint-XW9fqO | 754 | 6 | 1 | 2026-10-24T09:34:33.309558+00:00 |
| state\b23-maint-XbmZOJ | 754 | 6 | 1 | 2026-10-24T08:07:42.449852+00:00 |
| state\b23-maint-XhVSDV | 3815 | 22 | 4 | 2026-10-24T08:39:24.232762+00:00 |
| state\b23-maint-Xml57l | 754 | 6 | 1 | 2026-10-24T11:02:55.053633+00:00 |
| state\b23-maint-XnqVCy | 804 | 10 | 14 | 2026-10-24T09:38:38.957599+00:00 |
| state\b23-maint-XxLX8F | 754 | 6 | 1 | 2026-10-24T09:05:33.762997+00:00 |
| state\b23-maint-Y9tEwp | 2938 | 17 | 4 | 2026-10-24T07:55:06.255639+00:00 |
| state\b23-maint-YJ7Gx0 | 763 | 7 | 4 | 2026-10-24T09:38:39.159796+00:00 |
| state\b23-maint-YMMesa | 743 | 6 | 1 | 2026-10-24T11:56:45.765175+00:00 |
| state\b23-maint-YP7Nc9 | 754 | 6 | 1 | 2026-10-24T10:56:49.700543+00:00 |
| state\b23-maint-YavHJa | 737 | 6 | 1 | 2026-10-24T09:38:38.733777+00:00 |
| state\b23-maint-YfVVkp | 754 | 6 | 1 | 2026-10-24T09:38:38.827854+00:00 |
| state\b23-maint-Yh162H | 4016 | 25 | 4 | 2026-10-24T08:40:03.071534+00:00 |
| state\b23-maint-YoLx4E | 743 | 6 | 1 | 2026-10-24T10:56:49.629440+00:00 |
| state\b23-maint-YpOxOs | 754 | 6 | 1 | 2026-10-24T12:43:32.944096+00:00 |
| state\b23-maint-Z44u6J | 754 | 6 | 1 | 2026-10-24T09:05:33.721282+00:00 |
| state\b23-maint-Z8al7C | 754 | 6 | 1 | 2026-10-24T11:32:40.718650+00:00 |
| state\b23-maint-ZPL95L | 5330 | 15 | 5 | 2026-10-24T09:33:27.041683+00:00 |
| state\b23-maint-ZRDVIX | 754 | 6 | 1 | 2026-10-24T12:43:32.709411+00:00 |
| state\b23-maint-ZW3Yt1 | 4016 | 25 | 4 | 2026-10-24T08:35:25.790474+00:00 |
| state\b23-maint-ZZbpQv | 754 | 6 | 1 | 2026-10-24T09:05:33.743946+00:00 |
| state\b23-maint-ZbiWuK | 2592 | 15 | 4 | 2026-10-24T09:05:06.085018+00:00 |
| state\b23-maint-ZcvD87 | 2592 | 15 | 4 | 2026-10-24T15:58:38.497553+00:00 |
| state\b23-maint-ZhUwO7 | 754 | 6 | 1 | 2026-10-24T09:35:05.637277+00:00 |
| state\b23-maint-Znoa0G | 4016 | 25 | 4 | 2026-10-24T12:43:32.927083+00:00 |
| state\b23-maint-ZxOvUz | 4386 | 28 | 4 | 2026-10-24T07:53:45.328701+00:00 |
| state\b23-maint-a8Qr7U | 754 | 6 | 1 | 2026-10-24T09:26:45.910284+00:00 |
| state\b23-maint-a8hrG6 | 754 | 6 | 1 | 2026-10-24T10:56:49.900090+00:00 |
| state\b23-maint-aBxLRI | 2592 | 15 | 4 | 2026-10-24T11:02:55.160542+00:00 |
| state\b23-maint-aJXGY0 | 5819 | 18 | 5 | 2026-10-24T09:07:28.483256+00:00 |
| state\b23-maint-aO4UKB | 754 | 6 | 1 | 2026-10-24T09:05:08.007408+00:00 |
| state\b23-maint-aSAxm6 | 754 | 6 | 1 | 2026-10-24T11:56:46.113420+00:00 |
| state\b23-maint-aY09rG | 754 | 6 | 1 | 2026-10-24T09:38:38.633814+00:00 |
| state\b23-maint-abPWmB | 754 | 6 | 1 | 2026-10-24T09:38:38.579838+00:00 |
| state\b23-maint-adaWQ1 | 2512 | 15 | 4 | 2026-10-24T08:29:03.475681+00:00 |
| state\b23-maint-aeaauD | 760 | 7 | 1 | 2026-10-24T11:56:46.432619+00:00 |
| state\b23-maint-aiYhax | 2592 | 15 | 4 | 2026-10-24T09:01:32.553496+00:00 |
| state\b23-maint-aoZN7h | 763 | 7 | 4 | 2026-10-24T09:35:06.150177+00:00 |
| state\b23-maint-apGuO7 | 754 | 6 | 1 | 2026-10-24T08:28:53.261196+00:00 |
| state\b23-maint-asRtlN | 754 | 6 | 1 | 2026-10-24T11:02:55.350689+00:00 |
| state\b23-maint-bFS8JI | 743 | 6 | 1 | 2026-10-24T09:07:56.530468+00:00 |
| state\b23-maint-bGnlsU | 754 | 6 | 1 | 2026-10-24T15:58:38.709737+00:00 |
| state\b23-maint-bWJ1Q9 | 4016 | 25 | 4 | 2026-10-24T09:38:38.783448+00:00 |
| state\b23-maint-bYExbS | 754 | 6 | 1 | 2026-10-24T11:56:46.078504+00:00 |
| state\b23-maint-bdCAJs | 754 | 6 | 1 | 2026-10-24T09:35:05.649098+00:00 |
| state\b23-maint-bgcfAG | 754 | 6 | 1 | 2026-10-24T11:02:55.069481+00:00 |
| state\b23-maint-bmn730 | 2592 | 15 | 4 | 2026-10-24T09:01:32.579136+00:00 |
| state\b23-maint-bsRVmB | 765 | 7 | 4 | 2026-10-24T10:56:50.172082+00:00 |
| state\b23-maint-bsuugL | 2512 | 15 | 4 | 2026-10-24T08:40:03.002917+00:00 |
| state\b23-maint-bwEnb0 | 5473 | 15 | 5 | 2026-10-24T09:38:39.118162+00:00 |
| state\b23-maint-bzM5M6 | 756 | 7 | 1 | 2026-10-24T09:09:08.126283+00:00 |
| state\b23-maint-c2c8fo | 754 | 6 | 1 | 2026-10-24T11:27:25.147202+00:00 |
| state\b23-maint-c3hp0t | 787 | 9 | 5 | 2026-10-24T09:20:42.845494+00:00 |
| state\b23-maint-c4AM3X | 5191 | 15 | 5 | 2026-10-24T09:09:09.119563+00:00 |
| state\b23-maint-cC2z6r | 754 | 6 | 1 | 2026-10-24T08:40:04.779213+00:00 |
| state\b23-maint-cEo1pJ | 772 | 8 | 6 | 2026-10-24T09:34:33.696512+00:00 |
| state\b23-maint-cL63Kf | 2871 | 7 | 2 | 2026-10-24T09:30:24.101838+00:00 |
| state\b23-maint-cSBEfC | 754 | 6 | 1 | 2026-10-24T15:58:38.468325+00:00 |
| state\b23-maint-cUFe69 | 5545 | 16 | 5 | 2026-10-24T09:38:38.810211+00:00 |
| state\b23-maint-cXGq8M | 2512 | 15 | 4 | 2026-10-24T09:26:46.019854+00:00 |
| state\b23-maint-cgl6b0 | 754 | 6 | 1 | 2026-10-24T09:33:26.804256+00:00 |
| state\b23-maint-cjbYpi | 737 | 6 | 1 | 2026-10-24T09:35:05.766346+00:00 |
| state\b23-maint-cuNKHd | 5779 | 18 | 5 | 2026-10-24T09:20:42.707467+00:00 |
| state\b23-maint-cykoK4 | 754 | 6 | 1 | 2026-10-24T09:34:33.395590+00:00 |
| state\b23-maint-d7K5B3 | 5326 | 15 | 5 | 2026-10-24T09:33:26.738446+00:00 |
| state\b23-maint-d7TDM4 | 760 | 7 | 1 | 2026-10-24T15:58:39.001770+00:00 |
| state\b23-maint-dAjFpz | 3259 | 7 | 2 | 2026-10-24T11:32:40.829091+00:00 |
| state\b23-maint-dDcnns | 754 | 6 | 1 | 2026-10-24T09:05:33.709232+00:00 |
| state\b23-maint-dH0cVT | 6308 | 18 | 5 | 2026-10-24T11:42:51.257454+00:00 |
| state\b23-maint-dHSKop | 6231 | 18 | 5 | 2026-10-24T09:35:05.718471+00:00 |
| state\b23-maint-dIm95L | 754 | 6 | 1 | 2026-10-24T09:09:08.109232+00:00 |
| state\b23-maint-dIuI46 | 4386 | 28 | 4 | 2026-10-24T12:43:33.128020+00:00 |
| state\b23-maint-df1fdQ | 6231 | 18 | 5 | 2026-10-24T11:42:51.340306+00:00 |
| state\b23-maint-dg80Y8 | 758 | 7 | 2 | 2026-10-24T15:58:38.592552+00:00 |
| state\b23-maint-dmxYJ0 | 754 | 6 | 1 | 2026-10-24T10:56:49.647621+00:00 |
| state\b23-maint-doIpAw | 754 | 6 | 1 | 2026-10-24T09:20:42.799451+00:00 |
| state\b23-maint-dq7wCR | 754 | 6 | 1 | 2026-10-24T08:28:23.329892+00:00 |
| state\b23-maint-dqI5fg | 6231 | 18 | 5 | 2026-10-24T09:35:05.941121+00:00 |
| state\b23-maint-du3Vua | 754 | 6 | 1 | 2026-10-24T09:29:43.491601+00:00 |
| state\b23-maint-e8LqtF | 754 | 6 | 1 | 2026-10-24T09:35:05.868016+00:00 |
| state\b23-maint-eBkWe4 | 4386 | 28 | 4 | 2026-10-24T11:56:46.241755+00:00 |
| state\b23-maint-eJzlMn | 2592 | 15 | 4 | 2026-10-24T11:27:25.287329+00:00 |
| state\b23-maint-eRlWrg | 2938 | 17 | 4 | 2026-10-24T09:07:58.335917+00:00 |
| state\b23-maint-edeE97 | 4016 | 25 | 4 | 2026-10-24T09:07:58.415768+00:00 |
| state\b23-maint-eeDMEH | 758 | 7 | 2 | 2026-10-24T11:56:45.982302+00:00 |
| state\b23-maint-egHMjC | 3815 | 22 | 4 | 2026-10-24T09:35:05.900709+00:00 |
| state\b23-maint-emzQVZ | 5326 | 15 | 5 | 2026-10-24T09:29:43.434773+00:00 |
| state\b23-maint-erXPiz | 754 | 6 | 1 | 2026-10-24T09:07:59.180847+00:00 |
| state\b23-maint-ereI8O | 6308 | 18 | 5 | 2026-10-24T11:02:55.335093+00:00 |
| state\b23-maint-etQ2vv | 2938 | 17 | 4 | 2026-10-24T11:56:45.890785+00:00 |
| state\b23-maint-ex5oSr | 754 | 6 | 1 | 2026-10-24T08:28:53.209949+00:00 |
| state\b23-maint-f8uF7c | 5819 | 18 | 5 | 2026-10-24T09:08:44.265084+00:00 |
| state\b23-maint-fDmqsT | 2592 | 15 | 4 | 2026-10-24T11:32:40.815594+00:00 |
| state\b23-maint-fGoaWC | 754 | 6 | 1 | 2026-10-24T11:42:51.268666+00:00 |
| state\b23-maint-fI6nIp | 2512 | 15 | 4 | 2026-10-24T08:02:45.970779+00:00 |
| state\b23-maint-fKfS05 | 2592 | 15 | 4 | 2026-10-24T11:02:55.087137+00:00 |
| state\b23-maint-fN1xlO | 3815 | 22 | 4 | 2026-10-24T15:58:38.723440+00:00 |
| state\b23-maint-fQYSSu | 737 | 6 | 1 | 2026-10-24T11:32:40.879167+00:00 |
| state\b23-maint-fe9zNv | 754 | 6 | 1 | 2026-10-24T09:35:05.859013+00:00 |
| state\b23-maint-feCjd9 | 2512 | 15 | 4 | 2026-10-24T08:07:43.311905+00:00 |
| state\b23-maint-fhkCTN | 754 | 6 | 1 | 2026-10-24T09:38:38.848462+00:00 |
| state\b23-maint-fqe8k4 | 5330 | 15 | 5 | 2026-10-24T11:02:55.479340+00:00 |
| state\b23-maint-fuijry | 2938 | 17 | 4 | 2026-10-24T09:35:05.726857+00:00 |
| state\b23-maint-g11RQP | 754 | 6 | 1 | 2026-10-24T09:34:33.436753+00:00 |
| state\b23-maint-g7BqZT | 754 | 6 | 1 | 2026-10-24T12:43:32.983670+00:00 |
| state\b23-maint-g83ZiG | 754 | 6 | 1 | 2026-10-24T08:35:27.380546+00:00 |
| state\b23-maint-g9CZ6c | 2871 | 7 | 2 | 2026-10-24T15:58:38.610324+00:00 |
| state\b23-maint-gAj5s6 | 754 | 6 | 1 | 2026-10-24T09:38:38.837633+00:00 |
| state\b23-maint-gGmIQP | 754 | 6 | 1 | 2026-10-24T15:58:38.667611+00:00 |
| state\b23-maint-gJBrnO | 754 | 6 | 1 | 2026-10-24T11:42:51.063624+00:00 |
| state\b23-maint-gSPP7w | 754 | 6 | 1 | 2026-10-24T08:28:23.302283+00:00 |
| state\b23-maint-gaMMKb | 754 | 6 | 1 | 2026-10-24T09:20:42.808461+00:00 |
| state\b23-maint-gb3CEa | 2592 | 15 | 4 | 2026-10-24T10:56:49.665343+00:00 |
| state\b23-maint-geMrcr | 754 | 6 | 1 | 2026-10-24T09:09:08.135097+00:00 |
| state\b23-maint-gewMyC | 754 | 6 | 1 | 2026-10-24T10:56:49.897089+00:00 |
| state\b23-maint-gfpNsN | 4386 | 28 | 4 | 2026-10-24T11:32:41.170495+00:00 |
| state\b23-maint-guup71 | 754 | 6 | 1 | 2026-10-24T09:35:05.849584+00:00 |
| state\b23-maint-h1TpgC | 5537 | 15 | 5 | 2026-10-24T11:32:40.858106+00:00 |
| state\b23-maint-h1eo28 | 4016 | 25 | 4 | 2026-10-24T07:53:45.188514+00:00 |
| state\b23-maint-h3JclP | 5473 | 15 | 5 | 2026-10-24T10:56:50.136519+00:00 |
| state\b23-maint-h4azxD | 754 | 6 | 1 | 2026-10-24T08:39:16.847548+00:00 |
| state\b23-maint-h8rdaY | 754 | 6 | 1 | 2026-10-24T11:02:55.121017+00:00 |
| state\b23-maint-hB7PSt | 2938 | 17 | 4 | 2026-10-24T08:07:44.310223+00:00 |
| state\b23-maint-hPCBr5 | 5334 | 15 | 5 | 2026-10-24T11:27:25.335942+00:00 |
| state\b23-maint-hVAeRQ | 754 | 6 | 1 | 2026-10-24T11:02:55.046853+00:00 |
| state\b23-maint-hb9wl9 | 737 | 6 | 1 | 2026-10-24T11:42:51.161978+00:00 |
| state\b23-maint-hokBlP | 754 | 6 | 1 | 2026-10-24T09:23:42.114892+00:00 |
| state\b23-maint-hoxaOw | 2512 | 15 | 4 | 2026-10-24T09:05:06.304237+00:00 |
| state\b23-maint-hq52TB | 6308 | 18 | 5 | 2026-10-24T11:32:40.992027+00:00 |
| state\b23-maint-hrJT2c | 5334 | 15 | 5 | 2026-10-24T11:42:51.106013+00:00 |
| state\b23-maint-hsmA3g | 2592 | 15 | 4 | 2026-10-24T11:56:45.844034+00:00 |
| state\b23-maint-hxjqS8 | 2512 | 15 | 4 | 2026-10-24T12:43:32.826637+00:00 |
| state\b23-maint-iFmioV | 3128 | 7 | 2 | 2026-10-24T09:08:44.085524+00:00 |
| state\b23-maint-iH10Ly | 754 | 6 | 1 | 2026-10-24T11:27:25.526043+00:00 |
| state\b23-maint-iNEP6W | 1115 | 13 | 4 | 2026-10-24T09:34:33.669564+00:00 |
| state\b23-maint-iWelQz | 4016 | 25 | 4 | 2026-10-24T09:35:05.821746+00:00 |
| state\b23-maint-iYGiMl | 743 | 6 | 1 | 2026-10-24T07:53:44.371935+00:00 |
| state\b23-maint-im5FsH | 3815 | 22 | 4 | 2026-10-24T09:07:57.462574+00:00 |
| state\b23-maint-iq7pYl | 4016 | 25 | 4 | 2026-10-24T07:55:06.316589+00:00 |
| state\b23-maint-irDB7B | 754 | 6 | 1 | 2026-10-24T15:58:38.495552+00:00 |
| state\b23-maint-ivQ9Rd | 763 | 7 | 4 | 2026-10-24T11:42:51.589121+00:00 |
| state\b23-maint-iwXa36 | 754 | 6 | 1 | 2026-10-24T08:02:45.176219+00:00 |
| state\b23-maint-iwsVp9 | 754 | 6 | 1 | 2026-10-24T12:43:32.734200+00:00 |
| state\b23-maint-iwyqSe | 2592 | 15 | 4 | 2026-10-24T08:07:43.290877+00:00 |
| state\b23-maint-j3hJyZ | 4016 | 25 | 4 | 2026-10-24T11:32:40.924586+00:00 |
| state\b23-maint-j7qTFD | 754 | 6 | 1 | 2026-10-24T11:42:51.301478+00:00 |
| state\b23-maint-j7sRsK | 754 | 6 | 1 | 2026-10-24T08:29:05.169283+00:00 |
| state\b23-maint-jCxqaP | 4386 | 28 | 4 | 2026-10-24T10:56:50.033568+00:00 |
| state\b23-maint-jDxZUk | 754 | 6 | 1 | 2026-10-24T10:56:49.621510+00:00 |
| state\b23-maint-jFv5Xu | 4016 | 25 | 4 | 2026-10-24T09:01:33.593941+00:00 |
| state\b23-maint-jHMRNu | 743 | 6 | 1 | 2026-10-24T11:32:40.701619+00:00 |
| state\b23-maint-jJ8nta | 754 | 6 | 1 | 2026-10-24T11:32:41.023782+00:00 |
| state\b23-maint-jKpNj3 | 6308 | 18 | 5 | 2026-10-24T09:38:38.833122+00:00 |
| state\b23-maint-jLa00a | 2938 | 17 | 4 | 2026-10-24T09:05:07.149814+00:00 |
| state\b23-maint-jQt9JA | 4386 | 28 | 4 | 2026-10-24T15:58:38.853247+00:00 |
| state\b23-maint-jVLT7G | 4016 | 25 | 4 | 2026-10-24T08:07:44.381106+00:00 |
| state\b23-maint-jYbPOh | 3815 | 22 | 4 | 2026-10-24T09:05:06.288718+00:00 |
| state\b23-maint-jlStHn | 5439 | 7 | 1 | 2026-10-24T11:56:45.816018+00:00 |
| state\b23-maint-jn64xR | 5315 | 15 | 5 | 2026-10-24T12:43:32.844674+00:00 |
| state\b23-maint-jzEPMo | 754 | 6 | 1 | 2026-10-24T11:02:55.342108+00:00 |
| state\b23-maint-k15fXS | 754 | 6 | 1 | 2026-10-24T09:33:26.875144+00:00 |
| state\b23-maint-k2W3wf | 5334 | 15 | 5 | 2026-10-24T09:34:33.276903+00:00 |
| state\b23-maint-k2wY2M | 5315 | 15 | 5 | 2026-10-24T10:56:49.781238+00:00 |
| state\b23-maint-kDDhEm | 756 | 7 | 1 | 2026-10-24T11:56:45.825025+00:00 |
| state\b23-maint-kHt8Zc | 754 | 6 | 1 | 2026-10-24T08:39:25.802989+00:00 |
| state\b23-maint-kJzfyH | 5819 | 18 | 5 | 2026-10-24T09:09:09.244137+00:00 |
| state\b23-maint-kNPUlK | 5537 | 15 | 5 | 2026-10-24T11:42:51.141383+00:00 |
| state\b23-maint-kQ36yA | 754 | 6 | 1 | 2026-10-24T09:05:33.731003+00:00 |
| state\b23-maint-kfIsLO | 2512 | 15 | 4 | 2026-10-24T07:53:45.127534+00:00 |
| state\b23-maint-kkixlU | 754 | 6 | 1 | 2026-10-24T09:38:38.727884+00:00 |
| state\b23-maint-kmokU1 | 2512 | 15 | 4 | 2026-10-24T09:05:06.161872+00:00 |
| state\b23-maint-kxLzW4 | 754 | 6 | 1 | 2026-10-24T11:02:55.321793+00:00 |
| state\b23-maint-ky39XM | 1115 | 13 | 4 | 2026-10-24T09:38:39.134903+00:00 |
| state\b23-maint-l3C6qk | 765 | 7 | 4 | 2026-10-24T09:34:33.683000+00:00 |
| state\b23-maint-l41XZk | 754 | 6 | 1 | 2026-10-24T08:39:25.826497+00:00 |
| state\b23-maint-l5p4kb | 2592 | 15 | 4 | 2026-10-24T09:07:57.255652+00:00 |
| state\b23-maint-l6fiPa | 754 | 6 | 1 | 2026-10-24T11:42:51.252342+00:00 |
| state\b23-maint-l8Whje | 754 | 6 | 1 | 2026-10-24T10:56:49.633439+00:00 |
| state\b23-maint-lEN18U | 3815 | 22 | 4 | 2026-10-24T11:27:25.543028+00:00 |
| state\b23-maint-lI0dFr | 2512 | 15 | 4 | 2026-10-24T11:56:46.123126+00:00 |
| state\b23-maint-lS9jTg | 763 | 7 | 4 | 2026-10-24T11:56:46.431587+00:00 |
| state\b23-maint-lV1Sw0 | 3262 | 7 | 2 | 2026-10-24T09:23:42.118594+00:00 |
| state\b23-maint-la4DBb | 754 | 6 | 1 | 2026-10-24T11:56:46.061836+00:00 |
| state\b23-maint-leEzWY | 754 | 6 | 1 | 2026-10-24T11:27:25.529377+00:00 |
| state\b23-maint-lh0SdA | 754 | 6 | 1 | 2026-10-24T08:39:23.379001+00:00 |
| state\b23-maint-lm3ZpQ | 1115 | 13 | 4 | 2026-10-24T15:58:38.971667+00:00 |
| state\b23-maint-lnVkJX | 4016 | 25 | 4 | 2026-10-24T11:27:25.454598+00:00 |
| state\b23-maint-lo0ayO | 737 | 6 | 1 | 2026-10-24T11:02:55.217548+00:00 |
| state\b23-maint-lspLWb | 2592 | 15 | 4 | 2026-10-24T09:01:32.603124+00:00 |
| state\b23-maint-ltGjwp | 2592 | 15 | 4 | 2026-10-24T07:55:05.315872+00:00 |
| state\b23-maint-lusR4v | 760 | 7 | 1 | 2026-10-24T11:02:55.621285+00:00 |
| state\b23-maint-lyu0X0 | 754 | 6 | 1 | 2026-10-24T11:32:41.002501+00:00 |
| state\b23-maint-m53Sf8 | 756 | 7 | 1 | 2026-10-24T09:26:45.959892+00:00 |
| state\b23-maint-m6oGUV | 2592 | 15 | 4 | 2026-10-24T08:40:02.939940+00:00 |
| state\b23-maint-mCjFfd | 2592 | 15 | 4 | 2026-10-24T11:42:51.024969+00:00 |
| state\b23-maint-mQ1r40 | 754 | 6 | 1 | 2026-10-24T09:33:26.915385+00:00 |
| state\b23-maint-mR8cYP | 2592 | 15 | 4 | 2026-10-24T11:27:25.197314+00:00 |
| state\b23-maint-mYJYqP | 754 | 6 | 1 | 2026-10-24T09:34:33.417566+00:00 |
| state\b23-maint-mZ4Xg9 | 754 | 6 | 1 | 2026-10-24T08:29:05.125266+00:00 |
| state\b23-maint-mgtdOn | 2592 | 15 | 4 | 2026-10-24T12:43:32.766673+00:00 |
| state\b23-maint-ml1Ivy | 804 | 10 | 14 | 2026-10-24T09:35:05.973218+00:00 |
| state\b23-maint-mlpMBT | 5603 | 15 | 5 | 2026-10-24T09:38:38.753195+00:00 |
| state\b23-maint-mqqjU9 | 754 | 6 | 1 | 2026-10-24T09:29:43.585876+00:00 |
| state\b23-maint-mw4ygX | 754 | 6 | 1 | 2026-10-24T15:58:38.454546+00:00 |
| state\b23-maint-n2IAfg | 754 | 6 | 1 | 2026-10-24T09:38:38.546624+00:00 |
| state\b23-maint-n3H3SI | 5545 | 16 | 5 | 2026-10-24T09:30:24.130137+00:00 |
| state\b23-maint-nDb3fy | 754 | 6 | 1 | 2026-10-24T09:09:08.116365+00:00 |
| state\b23-maint-nEQ88v | 5315 | 15 | 5 | 2026-10-24T11:56:45.939264+00:00 |
| state\b23-maint-nI14v1 | 754 | 6 | 1 | 2026-10-24T09:07:44.008658+00:00 |
| state\b23-maint-nRxiss | 754 | 6 | 1 | 2026-10-24T11:27:25.157296+00:00 |
| state\b23-maint-nTnV0i | 3175 | 7 | 2 | 2026-10-24T09:20:42.720942+00:00 |
| state\b23-maint-nUhuMR | 754 | 6 | 1 | 2026-10-24T09:30:24.158696+00:00 |
| state\b23-maint-nX8mWS | 2592 | 15 | 4 | 2026-10-24T09:26:45.991605+00:00 |
| state\b23-maint-nXsaZr | 754 | 6 | 1 | 2026-10-24T11:02:55.094150+00:00 |
| state\b23-maint-nYH4oG | 756 | 7 | 1 | 2026-10-24T08:40:04.799598+00:00 |
| state\b23-maint-nYdlkD | 2592 | 15 | 4 | 2026-10-24T09:26:45.967651+00:00 |
| state\b23-maint-native-8afcd69ca46e4e7bb611ef0e7b92d02f | 169 | 1 | 8 | 2026-10-24T11:09:32.735977+00:00 |
| state\b23-maint-native-9b317b949460486f92ac4c2002304bf5 | 583936722 | 12429 | 368 | 2026-10-25T07:03:58.069524+00:00 |
| state\b23-maint-native-ab2ecf441a184dcaa798023010f3e70f | 761661881 | 16492 | 499 | 2026-10-24T12:34:45.211243+00:00 |
| state\b23-maint-native-bd23505c410c4569be6bd5285a87e8ef | 547005886 | 11636 | 362 | 2026-10-24T11:35:59.950078+00:00 |
| state\b23-maint-ncObyi | 6617 | 23 | 5 | 2026-10-24T09:09:09.186677+00:00 |
| state\b23-maint-njXQRk | 5537 | 15 | 5 | 2026-10-24T09:29:43.481090+00:00 |
| state\b23-maint-nkEPY1 | 754 | 6 | 1 | 2026-10-24T08:28:53.243125+00:00 |
| state\b23-maint-nkQw9Z | 5330 | 15 | 5 | 2026-10-24T09:29:43.723265+00:00 |
| state\b23-maint-nmvcnt | 2938 | 17 | 4 | 2026-10-24T07:53:46.040392+00:00 |
| state\b23-maint-ntiZdX | 758 | 7 | 2 | 2026-10-24T09:38:38.753195+00:00 |
| state\b23-maint-ntoCg8 | 6231 | 18 | 5 | 2026-10-24T10:56:49.727909+00:00 |
| state\b23-maint-nz9AMf | 4016 | 25 | 4 | 2026-10-24T11:27:25.453598+00:00 |
| state\b23-maint-oAQL8h | 756 | 7 | 1 | 2026-10-24T09:05:07.998724+00:00 |
| state\b23-maint-oD5bQT | 2871 | 7 | 2 | 2026-10-24T09:38:38.770983+00:00 |
| state\b23-maint-oI7ZbM | 2938 | 17 | 4 | 2026-10-24T08:35:26.637603+00:00 |
| state\b23-maint-oIZ9ST | 754 | 6 | 1 | 2026-10-24T09:05:07.980961+00:00 |
| state\b23-maint-oJdhKD | 754 | 6 | 1 | 2026-10-24T09:09:08.132640+00:00 |
| state\b23-maint-oToaem | 5537 | 15 | 5 | 2026-10-24T11:27:25.372958+00:00 |
| state\b23-maint-obiScf | 804 | 10 | 14 | 2026-10-24T11:42:51.368063+00:00 |
| state\b23-maint-ojfmV7 | 4386 | 28 | 4 | 2026-10-24T09:26:46.278716+00:00 |
| state\b23-maint-okBzxU | 2938 | 17 | 4 | 2026-10-24T12:43:32.800621+00:00 |
| state\b23-maint-okvva5 | 754 | 6 | 1 | 2026-10-24T11:32:41.007693+00:00 |
| state\b23-maint-oposZW | 2871 | 7 | 2 | 2026-10-24T09:35:05.799037+00:00 |
| state\b23-maint-p0o871 | 754 | 6 | 1 | 2026-10-24T11:42:51.068630+00:00 |
| state\b23-maint-p0yzht | 754 | 6 | 1 | 2026-10-24T11:27:25.256950+00:00 |
| state\b23-maint-p6Upwh | 754 | 6 | 1 | 2026-10-24T11:32:40.775429+00:00 |
| state\b23-maint-pCKtex | 2512 | 15 | 4 | 2026-10-24T11:27:25.568964+00:00 |
| state\b23-maint-pCbpaP | 6231 | 18 | 5 | 2026-10-24T09:38:38.923903+00:00 |
| state\b23-maint-pHp0vZ | 763 | 7 | 1 | 2026-10-24T09:34:33.694513+00:00 |
| state\b23-maint-pZWTzv | 765 | 7 | 4 | 2026-10-24T09:23:42.213411+00:00 |
| state\b23-maint-pdVzPJ | 754 | 6 | 1 | 2026-10-24T09:35:05.879183+00:00 |
| state\b23-maint-peVSok | 5545 | 16 | 5 | 2026-10-24T11:56:46.045495+00:00 |
| state\b23-maint-ph2ete | 6308 | 18 | 5 | 2026-10-24T10:56:49.884814+00:00 |
| state\b23-maint-piJF4i | 754 | 6 | 1 | 2026-10-24T11:32:40.975032+00:00 |
| state\b23-maint-pj2tre | 754 | 6 | 1 | 2026-10-24T07:53:44.365926+00:00 |
| state\b23-maint-pjNG2a | 754 | 6 | 1 | 2026-10-24T11:32:40.980103+00:00 |
| state\b23-maint-ppHMzi | 2512 | 15 | 4 | 2026-10-24T08:39:24.130300+00:00 |
| state\b23-maint-pq7KCv | 754 | 6 | 1 | 2026-10-24T08:28:53.220765+00:00 |
| state\b23-maint-pv1j9d | 5330 | 15 | 5 | 2026-10-24T11:32:41.156979+00:00 |
| state\b23-maint-pvsy1b | 754 | 6 | 1 | 2026-10-24T09:05:07.970022+00:00 |
| state\b23-maint-pyd5Dx | 5545 | 16 | 5 | 2026-10-24T12:43:32.923066+00:00 |
| state\b23-maint-qEk0l3 | 5326 | 15 | 5 | 2026-10-24T09:38:38.633814+00:00 |
| state\b23-maint-qEuC21 | 754 | 6 | 1 | 2026-10-24T09:34:33.399717+00:00 |
| state\b23-maint-qFpnG1 | 2592 | 15 | 4 | 2026-10-24T09:05:06.136643+00:00 |
| state\b23-maint-qFvZ3N | 754 | 6 | 1 | 2026-10-24T11:42:51.035825+00:00 |
| state\b23-maint-qG8xcG | 5334 | 15 | 5 | 2026-10-24T09:30:24.043065+00:00 |
| state\b23-maint-qLzbwR | 2512 | 15 | 4 | 2026-10-24T12:43:33.018470+00:00 |
| state\b23-maint-qMW94p | 754 | 6 | 1 | 2026-10-24T11:27:25.514713+00:00 |
| state\b23-maint-qRPjY4 | 2592 | 15 | 4 | 2026-10-24T09:35:05.718471+00:00 |
| state\b23-maint-qXu8Gn | 1115 | 13 | 4 | 2026-10-24T09:23:42.199833+00:00 |
| state\b23-maint-qYDSYA | 2592 | 15 | 4 | 2026-10-24T07:55:05.333845+00:00 |
| state\b23-maint-qbivWY | 743 | 6 | 1 | 2026-10-24T07:55:04.615292+00:00 |
| state\b23-maint-qjFon1 | 4016 | 25 | 4 | 2026-10-24T09:07:57.405557+00:00 |
| state\b23-maint-qqf8Lf | 2871 | 7 | 2 | 2026-10-24T10:56:49.814342+00:00 |
| state\b23-maint-qtbz9G | 754 | 6 | 1 | 2026-10-24T11:42:51.156318+00:00 |
| state\b23-maint-qywyEl | 5326 | 15 | 5 | 2026-10-24T09:30:24.021684+00:00 |
| state\b23-maint-r0seeE | 2592 | 15 | 4 | 2026-10-24T11:32:40.780428+00:00 |
| state\b23-maint-r29JU8 | 5473 | 15 | 5 | 2026-10-24T09:30:24.375979+00:00 |
| state\b23-maint-r6E5Bq | 765 | 7 | 4 | 2026-10-24T11:32:41.316015+00:00 |
| state\b23-maint-rBsMZJ | 3128 | 7 | 2 | 2026-10-24T09:07:43.872180+00:00 |
| state\b23-maint-rGzdDg | 2592 | 15 | 4 | 2026-10-24T08:35:25.714110+00:00 |
| state\b23-maint-rHEnqa | 2592 | 15 | 4 | 2026-10-24T08:40:02.984116+00:00 |
| state\b23-maint-rL81BT | 754 | 6 | 1 | 2026-10-24T12:43:32.759692+00:00 |
| state\b23-maint-rLXEJt | 5233 | 15 | 5 | 2026-10-24T09:20:42.643117+00:00 |
| state\b23-maint-rORk64 | 2512 | 15 | 4 | 2026-10-24T07:53:45.250515+00:00 |
| state\b23-maint-rR3pE0 | 754 | 6 | 1 | 2026-10-24T09:33:26.886651+00:00 |
| state\b23-maint-rV0K7k | 743 | 6 | 1 | 2026-10-24T09:01:31.855419+00:00 |
| state\b23-maint-rV0WtU | 5473 | 15 | 5 | 2026-10-24T11:56:46.383975+00:00 |
| state\b23-maint-rVEr3L | 754 | 6 | 1 | 2026-10-24T11:42:51.289957+00:00 |
| state\b23-maint-rVPVjW | 754 | 6 | 1 | 2026-10-24T09:20:42.791896+00:00 |
| state\b23-maint-rjJv9O | 2592 | 15 | 4 | 2026-10-24T08:29:03.415134+00:00 |
| state\b23-maint-s06kba | 754 | 6 | 1 | 2026-10-24T15:58:38.490669+00:00 |
| state\b23-maint-sIRzuA | 2871 | 7 | 2 | 2026-10-24T11:56:45.999390+00:00 |
| state\b23-maint-sVPVi8 | 4016 | 25 | 4 | 2026-10-24T15:58:38.655432+00:00 |
| state\b23-maint-so95lf | 754 | 6 | 1 | 2026-10-24T08:35:27.415923+00:00 |
| state\b23-maint-swUBCm | 758 | 7 | 2 | 2026-10-24T11:27:25.423963+00:00 |
| state\b23-maint-sy99VC | 754 | 6 | 1 | 2026-10-24T15:58:38.426721+00:00 |
| state\b23-maint-tCiGFP | 5603 | 15 | 5 | 2026-10-24T12:43:32.874558+00:00 |
| state\b23-maint-tDZeKD | 754 | 6 | 1 | 2026-10-24T09:09:09.191399+00:00 |
| state\b23-maint-tED4n7 | 2938 | 17 | 4 | 2026-10-24T09:38:38.673074+00:00 |
| state\b23-maint-tGiV1H | 754 | 6 | 1 | 2026-10-24T11:56:45.788413+00:00 |
| state\b23-maint-tNF1lG | 804 | 10 | 14 | 2026-10-24T11:32:41.106049+00:00 |
| state\b23-maint-tRe21k | 2512 | 15 | 4 | 2026-10-24T11:32:41.057172+00:00 |
| state\b23-maint-tRgNW8 | 2938 | 17 | 4 | 2026-10-24T08:02:46.908474+00:00 |
| state\b23-maint-tTYUfu | 2592 | 15 | 4 | 2026-10-24T11:32:40.739604+00:00 |
| state\b23-maint-tUkAhZ | 754 | 6 | 1 | 2026-10-24T08:28:53.231298+00:00 |
| state\b23-maint-tXlULL | 2871 | 7 | 2 | 2026-10-24T11:32:40.914540+00:00 |
| state\b23-maint-tYvJm9 | 2592 | 15 | 4 | 2026-10-24T08:40:02.963409+00:00 |
| state\b23-maint-tbA0NJ | 6231 | 18 | 5 | 2026-10-24T11:56:46.149739+00:00 |
| state\b23-maint-tj1WTM | 4016 | 25 | 4 | 2026-10-24T08:40:04.052903+00:00 |
| state\b23-maint-tk1aHS | 5545 | 16 | 5 | 2026-10-24T11:02:55.301841+00:00 |
| state\b23-maint-tk2xpr | 5330 | 15 | 5 | 2026-10-24T09:38:39.007182+00:00 |
| state\b23-maint-tlE5Kt | 754 | 6 | 1 | 2026-10-24T09:38:38.844301+00:00 |
| state\b23-maint-tt9WAp | 754 | 6 | 1 | 2026-10-24T11:42:51.280244+00:00 |
| state\b23-maint-u6QeUx | 2938 | 17 | 4 | 2026-10-24T11:32:40.815594+00:00 |
| state\b23-maint-u7eH28 | 743 | 6 | 1 | 2026-10-24T09:09:05.500103+00:00 |
| state\b23-maint-u8bkWW | 2592 | 15 | 4 | 2026-10-24T12:43:32.729544+00:00 |
| state\b23-maint-uGOdi9 | 754 | 6 | 1 | 2026-10-24T12:43:32.954648+00:00 |
| state\b23-maint-uIAhy5 | 2592 | 15 | 4 | 2026-10-24T08:35:25.672261+00:00 |
| state\b23-maint-uOZxOJ | 754 | 6 | 1 | 2026-10-24T11:56:45.837901+00:00 |
| state\b23-maint-uQ2NGv | 4016 | 25 | 4 | 2026-10-24T08:35:26.696697+00:00 |
| state\b23-maint-uQM6jx | 754 | 6 | 1 | 2026-10-24T11:56:45.805150+00:00 |
| state\b23-maint-uQgXJa | 5315 | 15 | 5 | 2026-10-24T11:27:25.372958+00:00 |
| state\b23-maint-uUsM66 | 2512 | 15 | 4 | 2026-10-24T08:39:24.247477+00:00 |
| state\b23-maint-ubTON5 | 754 | 6 | 1 | 2026-10-24T09:07:59.169137+00:00 |
| state\b23-maint-udLccM | 754 | 6 | 1 | 2026-10-24T08:29:02.705876+00:00 |
| state\b23-maint-um7KKS | 754 | 6 | 1 | 2026-10-24T08:39:25.811423+00:00 |
| state\b23-maint-upgLZ5 | 2512 | 15 | 4 | 2026-10-24T09:01:32.624136+00:00 |
| state\b23-maint-urb3oC | 3815 | 22 | 4 | 2026-10-24T09:26:46.163110+00:00 |
| state\b23-maint-uuVDqo | 5603 | 15 | 5 | 2026-10-24T11:56:45.972300+00:00 |
| state\b23-maint-uwjO8f | 754 | 6 | 1 | 2026-10-24T08:28:23.320547+00:00 |
| state\b23-maint-uyzjxc | 2592 | 15 | 4 | 2026-10-24T08:39:24.087100+00:00 |
| state\b23-maint-v0Egju | 760 | 7 | 1 | 2026-10-24T09:35:06.150177+00:00 |
| state\b23-maint-v3OKwF | 754 | 6 | 1 | 2026-10-24T11:56:46.089875+00:00 |
| state\b23-maint-v53lhd | 6617 | 23 | 5 | 2026-10-24T09:07:44.001438+00:00 |
| state\b23-maint-vEKIs0 | 5473 | 15 | 5 | 2026-10-24T11:27:25.870455+00:00 |
| state\b23-maint-vF0b10 | 5326 | 15 | 5 | 2026-10-24T09:35:05.693619+00:00 |
| state\b23-maint-vMfNRz | 2592 | 15 | 4 | 2026-10-24T11:02:55.127023+00:00 |
| state\b23-maint-vUAliz | 756 | 7 | 1 | 2026-10-24T09:05:33.753058+00:00 |
| state\b23-maint-vfqcut | 763 | 7 | 4 | 2026-10-24T15:58:39.001144+00:00 |
| state\b23-maint-viSXM1 | 3259 | 7 | 2 | 2026-10-24T12:43:32.812447+00:00 |
| state\b23-maint-viUCh2 | 2592 | 15 | 4 | 2026-10-24T08:07:43.269223+00:00 |
| state\b23-maint-vv8Dyg | 5326 | 15 | 5 | 2026-10-24T15:58:38.486800+00:00 |
| state\b23-maint-vvfLxY | 4016 | 25 | 4 | 2026-10-24T11:42:51.234192+00:00 |
| state\b23-maint-wGQi6Y | 5315 | 15 | 5 | 2026-10-24T09:35:05.764162+00:00 |
| state\b23-maint-wIpeqR | 760 | 7 | 1 | 2026-10-24T10:56:50.180526+00:00 |
| state\b23-maint-wQVrzt | 760 | 7 | 1 | 2026-10-24T11:32:41.323876+00:00 |
| state\b23-maint-wd3vfX | 758 | 7 | 2 | 2026-10-24T10:56:49.799283+00:00 |
| state\b23-maint-wfJOXM | 756 | 7 | 1 | 2026-10-24T15:58:38.480291+00:00 |
| state\b23-maint-wgNqAt | 743 | 6 | 1 | 2026-10-24T11:27:25.157296+00:00 |
| state\b23-maint-woEG3r | 754 | 6 | 1 | 2026-10-24T09:01:34.275363+00:00 |
| state\b23-maint-woxDZ3 | 758 | 7 | 2 | 2026-10-24T11:42:51.180582+00:00 |
| state\b23-maint-wrLM01 | 5537 | 15 | 5 | 2026-10-24T12:43:32.830116+00:00 |
| state\b23-maint-wzC6zA | 754 | 6 | 1 | 2026-10-24T09:06:58.151884+00:00 |
| state\b23-maint-x6ZBo3 | 2938 | 17 | 4 | 2026-10-24T09:01:33.531988+00:00 |
| state\b23-maint-x7VxmC | 754 | 6 | 1 | 2026-10-24T09:07:59.203805+00:00 |
| state\b23-maint-xMTcLN | 5819 | 18 | 5 | 2026-10-24T09:08:00.335355+00:00 |
| state\b23-maint-xQYdjx | 4386 | 28 | 4 | 2026-10-24T08:40:03.224196+00:00 |
| state\b23-maint-xTaWaw | 5330 | 15 | 5 | 2026-10-24T11:42:51.435436+00:00 |
| state\b23-maint-xY1Wzw | 763 | 7 | 4 | 2026-10-24T11:02:55.621285+00:00 |
| state\b23-maint-xZ946J | 754 | 6 | 1 | 2026-10-24T11:42:51.004509+00:00 |
| state\b23-maint-xajazR | 5439 | 7 | 1 | 2026-10-24T12:09:51.010168+00:00 |
| state\b23-maint-xe2U15 | 754 | 6 | 1 | 2026-10-24T11:02:55.213533+00:00 |
| state\b23-maint-xfHf47 | 4386 | 28 | 4 | 2026-10-24T09:38:39.018291+00:00 |
| state\b23-maint-xkLwxI | 743 | 6 | 1 | 2026-10-24T07:52:04.713650+00:00 |
| state\b23-maint-xkd6pe | 754 | 6 | 1 | 2026-10-24T08:39:16.812079+00:00 |
| state\b23-maint-y3jEa7 | 2592 | 15 | 4 | 2026-10-24T07:53:45.060663+00:00 |
| state\b23-maint-y62EmH | 2512 | 15 | 4 | 2026-10-24T09:09:06.295978+00:00 |
| state\b23-maint-y7O6XN | 754 | 6 | 1 | 2026-10-24T09:30:24.143372+00:00 |
| state\b23-maint-y8tDM7 | 2871 | 7 | 2 | 2026-10-24T09:29:43.519281+00:00 |
| state\b23-maint-yB2pz7 | 754 | 6 | 1 | 2026-10-24T08:35:24.978659+00:00 |
| state\b23-maint-yE4IzN | 756 | 7 | 1 | 2026-10-24T09:38:38.611805+00:00 |
| state\b23-maint-yIDZ6G | 3815 | 22 | 4 | 2026-10-24T11:42:51.305594+00:00 |
| state\b23-maint-yN62zX | 804 | 10 | 14 | 2026-10-24T11:27:25.657451+00:00 |
| state\b23-maint-yOSnrD | 754 | 6 | 1 | 2026-10-24T11:42:50.979198+00:00 |
| state\b23-maint-ySS4y5 | 5330 | 15 | 5 | 2026-10-24T15:58:38.838502+00:00 |
| state\b23-maint-ySoFTw | 5439 | 7 | 1 | 2026-10-24T11:32:40.751790+00:00 |
| state\b23-maint-yWiiHU | 3815 | 22 | 4 | 2026-10-24T08:02:46.080398+00:00 |
| state\b23-maint-yY4yIh | 1115 | 13 | 4 | 2026-10-24T11:32:41.300519+00:00 |
| state\b23-maint-yaGKlL | 754 | 6 | 1 | 2026-10-24T09:33:26.872137+00:00 |
| state\b23-maint-yeTaHM | 1115 | 13 | 4 | 2026-10-24T09:29:43.824842+00:00 |
| state\b23-maint-yfhhH5 | 4386 | 28 | 4 | 2026-10-24T08:02:46.176361+00:00 |
| state\b23-maint-ygKS99 | 2592 | 15 | 4 | 2026-10-24T15:58:38.464547+00:00 |
| state\b23-maint-yugXPj | 2512 | 15 | 4 | 2026-10-24T11:56:45.912400+00:00 |
| state\b23-maint-yyaCyS | 1128 | 14 | 4 | 2026-10-24T09:20:42.831128+00:00 |
| state\b23-maint-z3c4PZ | 5334 | 15 | 5 | 2026-10-24T09:35:05.721594+00:00 |
| state\b23-maint-z4Cdhm | 754 | 6 | 1 | 2026-10-24T09:29:43.565461+00:00 |
| state\b23-maint-z9Af3X | 758 | 7 | 2 | 2026-10-24T11:02:55.241271+00:00 |
| state\b23-maint-zDfxYK | 756 | 7 | 1 | 2026-10-24T08:39:16.839275+00:00 |
| state\b23-maint-zSRkaw | 2592 | 15 | 4 | 2026-10-24T09:07:57.305859+00:00 |
| state\b23-maint-zT4dnk | 3815 | 22 | 4 | 2026-10-24T07:55:05.458839+00:00 |
| state\b23-maint-zbS5V4 | 5184 | 15 | 5 | 2026-10-24T09:08:00.183076+00:00 |
| state\b23-maint-zipNNT | 804 | 10 | 14 | 2026-10-24T09:26:46.228929+00:00 |
| state\b23-maint-zm0XGw | 4016 | 25 | 4 | 2026-10-24T11:02:55.299003+00:00 |
| state\b23-maint-zo3oZc | 6231 | 18 | 5 | 2026-10-24T11:27:25.612996+00:00 |
| state\b23-maint-zroerw | 2592 | 15 | 4 | 2026-10-24T09:09:06.271546+00:00 |
| state\b23-maint-zsZY7I | 5334 | 15 | 5 | 2026-10-24T11:56:45.895092+00:00 |
| state\b23-p26-manager-67ffa0da | 37961494 | 470 | 110 | 2026-10-13T14:51:21.375321+00:00 |
| state\b23-planb-handoff-338e5205-42bc-4b80-bc5c-680ba4800f31 | 1205 | 7 | 2 | 2026-10-24T16:09:57.814265+00:00 |
| state\b23-planb-handoff-4fdc9bee-b38b-4914-b935-79e2d618b2bd | 1205 | 6 | 2 | 2026-10-24T15:51:45.669678+00:00 |
| state\b23-planb-handoff-7fe6fdbf-703c-4e70-a087-f4c359543581 | 1205 | 7 | 2 | 2026-10-24T15:52:02.946427+00:00 |
| state\b23-planb-handoff-ac8a837d-daa7-4978-a7fd-c3987d9c082c | 1205 | 7 | 2 | 2026-10-24T16:02:33.877322+00:00 |
| state\b23-preserved-0lquHc | 162 | 4 | 2 | 2026-10-11T05:27:14.762503+00:00 |
| state\b23-preserved-Dm0ouI | 162 | 4 | 2 | 2026-10-11T15:28:08.523164+00:00 |
| state\b23-preserved-QPeWIv | 162 | 4 | 2 | 2026-10-12T05:10:29.603428+00:00 |
| state\b23-preserved-XIQ4Jg | 162 | 4 | 2 | 2026-10-12T09:46:20.703411+00:00 |
| state\b23-preserved-na7toD | 162 | 4 | 2 | 2026-10-11T04:58:56.942406+00:00 |
| state\b23-preserved-uTbb5P | 162 | 4 | 2 | 2026-10-11T05:20:24.372121+00:00 |
| state\b23-production-approvals | 981593 | 318 | 0 | 2026-10-13T15:03:31.953902+00:00 |
| state\b23-profile-07690de8d49f87 | 205 | 3 | 8 | 2026-10-11T05:03:33.126600+00:00 |
| state\b23-profile-07690de8d49f87-nested | 181 | 1 | 9 | 2026-10-11T05:03:36.199718+00:00 |
| state\b23-profile-1f744ba843e9da | 177 | 3 | 8 | 2026-10-24T04:13:37.470080+00:00 |
| state\b23-profile-1f744ba843e9da-nested | 153 | 1 | 8 | 2026-10-24T04:13:39.958812+00:00 |
| state\b23-profile-32e366070aef5a | 205 | 3 | 8 | 2026-10-12T09:46:43.259319+00:00 |
| state\b23-profile-32e366070aef5a-nested | 181 | 1 | 9 | 2026-10-12T09:46:46.582662+00:00 |
| state\b23-profile-45ce4b7bf6c421 | 180 | 2 | 8 | 2026-10-11T04:58:29.811914+00:00 |
| state\b23-profile-5abcb99e98aa68 | 205 | 3 | 8 | 2026-10-12T05:10:51.356393+00:00 |
| state\b23-profile-5abcb99e98aa68-nested | 181 | 1 | 9 | 2026-10-12T05:10:54.676723+00:00 |
| state\b23-profile-6b6440915bef47 | 205 | 3 | 8 | 2026-10-11T05:04:38.800369+00:00 |
| state\b23-profile-6b6440915bef47-nested | 181 | 1 | 9 | 2026-10-11T05:04:41.930796+00:00 |
| state\b23-profile-6ede73369b5f60 | 180 | 2 | 8 | 2026-10-11T04:59:23.285738+00:00 |
| state\b23-profile-743c6d584ff8d7 | 205 | 3 | 8 | 2026-10-11T05:21:24.142493+00:00 |
| state\b23-profile-743c6d584ff8d7-nested | 181 | 1 | 9 | 2026-10-11T05:21:27.444091+00:00 |
| state\b23-profile-87d27751761d5c | 205 | 3 | 8 | 2026-10-11T05:20:46.481240+00:00 |
| state\b23-profile-87d27751761d5c-nested | 181 | 1 | 9 | 2026-10-11T05:20:49.606696+00:00 |
| state\b23-profile-95955d97af55df | 205 | 3 | 8 | 2026-10-11T05:02:41.200737+00:00 |
| state\b23-profile-95955d97af55df-nested | 181 | 1 | 9 | 2026-10-11T05:02:44.348365+00:00 |
| state\b23-profile-96c5ec7a0dfd7e | 177 | 3 | 8 | 2026-10-23T17:55:20.287040+00:00 |
| state\b23-profile-96c5ec7a0dfd7e-nested | 153 | 1 | 8 | 2026-10-23T17:55:22.960196+00:00 |
| state\b23-profile-ab6bf39799f790 | 177 | 3 | 8 | 2026-10-23T13:40:07.513879+00:00 |
| state\b23-profile-ab6bf39799f790-nested | 153 | 1 | 8 | 2026-10-23T13:40:10.069201+00:00 |
| state\b23-profile-b7b31777e421ad | 205 | 3 | 8 | 2026-10-11T14:56:29.384739+00:00 |
| state\b23-profile-b7b31777e421ad-nested | 181 | 1 | 9 | 2026-10-11T14:56:32.747185+00:00 |
| state\b23-profile-c4cd824d9a68d7 | 177 | 3 | 8 | 2026-10-13T17:59:33.243883+00:00 |
| state\b23-profile-c4cd824d9a68d7-nested | 153 | 1 | 8 | 2026-10-13T17:59:35.311210+00:00 |
| state\b23-profile-cb09bb1d6dbbba | 3220 | 3 | 8 | 2026-10-11T05:00:57.630625+00:00 |
| state\b23-profile-f5fd0ca97d4dfe | 205 | 3 | 8 | 2026-10-11T05:02:00.076163+00:00 |
| state\b23-regression-a4c3e42ee69d | 8460 | 37 | 0 | 2026-10-11T05:27:15.004053+00:00 |
| state\b23-regression-final-6df54469e8 | 7922 | 37 | 0 | 2026-10-11T15:28:08.790942+00:00 |
| state\b23-release-1cSw2v | 21 | 2 | 8 | 2026-10-24T09:38:38.960040+00:00 |
| state\b23-release-7raM3O | 21 | 2 | 8 | 2026-10-24T11:56:46.181946+00:00 |
| state\b23-release-AcdRiW | 21 | 2 | 8 | 2026-10-24T11:32:41.108049+00:00 |
| state\b23-release-Axfyku | 21 | 2 | 8 | 2026-10-24T10:56:49.992551+00:00 |
| state\b23-release-FvudKx | 21 | 2 | 8 | 2026-10-24T11:27:25.660101+00:00 |
| state\b23-release-GMxS2z | 21 | 2 | 8 | 2026-10-24T09:09:09.270439+00:00 |
| state\b23-release-HLlyhk | 21 | 2 | 8 | 2026-10-24T09:26:46.231033+00:00 |
| state\b23-release-HiSwoE | 21 | 2 | 8 | 2026-10-24T11:02:55.439697+00:00 |
| state\b23-release-Mq3Ifj | 21 | 2 | 8 | 2026-10-24T09:08:44.293556+00:00 |
| state\b23-release-PRaP0h | 21 | 2 | 8 | 2026-10-24T09:35:05.975245+00:00 |
| state\b23-release-ZoE0WB | 21 | 2 | 8 | 2026-10-24T11:42:51.371063+00:00 |
| state\b23-release-fgKPTn | 1421146484 | 78460 | 6420 | 2026-10-11T05:02:05.201509+00:00 |
| state\b23-release-vXJRLj | 21 | 2 | 8 | 2026-10-24T12:43:33.074211+00:00 |
| state\b23-simulation-approvals | 1910991 | 461 | 0 | 2026-10-26T15:32:23.377537+00:00 |
| state\b23-switch-c104fcca2aa9 | 3803333255 | 231300 | 17017 | 2026-10-11T15:36:32.323841+00:00 |
| state\b23-task-host-59cce095-cce9-42fd-9bcc-a182575eca04 | 7520 | 5 | 0 | 2026-10-25T02:41:24.852428+00:00 |
| state\b23-task-host-6b319410-07b4-46d0-b811-0ffe2a8173d7 | 7007 | 6 | 0 | 2026-10-25T05:54:58.255392+00:00 |
| state\b23-task-policy-d156b335-674b-4396-b34a-73f99cfb789d | 372 | 1 | 0 | 2026-10-25T02:54:16.817983+00:00 |
| state\b24-cleanup-evidence-20261013 | 8557187 | 1736 | 1279 | 2026-10-12T18:14:57.436435+00:00 |
| state\b24-closeout-20261012-9a87f321 | 326060 | 96 | 59 | 2026-10-12T10:04:08.714978+00:00 |
| state\b24-closeout-20261012-9a87f321-live2 | 224911 | 41 | 59 | 2026-10-12T05:09:40.816617+00:00 |
| state\b24-closeout-20261012-9a87f321-live3 | 446186 | 53 | 61 | 2026-10-12T05:13:27.610499+00:00 |
| state\b24-closeout-20261012-candidate-release | 13763374 | 140 | 32 | 2026-10-12T09:50:27.689691+00:00 |
| state\b24-closeout-20261012-live4 | 154455 | 39 | 53 | 2026-10-12T09:38:39.087838+00:00 |
| state\b24-closeout-20261012-live5 | 496479 | 56 | 61 | 2026-10-12T09:44:53.604028+00:00 |
| state\b24-closeout-20261012-live6-candidate | 496336 | 56 | 61 | 2026-10-12T10:01:58.270346+00:00 |
| state\b24-closeout-20261012-resumed-regression | 11175 | 32 | 0 | 2026-10-12T09:48:54.980217+00:00 |
| state\b24-final-web-approval-535002731504 | 25566 | 6 | 0 | 2026-10-13T07:01:51.138129+00:00 |
| state\b24-increment-evidence-2535e1f | 48914 | 2 | 0 | 2026-10-11T23:40:18.345195+00:00 |
| state\b24-maintenance-20261012-nFtl5J | 326758 | 53 | 6 | 2026-10-12T19:14:09.209519+00:00 |
| state\b24-manager-recovery-e3808ba | 13983233 | 143 | 32 | 2026-10-12T16:31:58.337355+00:00 |
| state\b24-manager-recovery-evidence-e3808ba | 227266 | 16 | 4 | 2026-10-12T16:52:59.422373+00:00 |
| state\b24-recovery-evidence-20261013 | 4307 | 3 | 0 | 2026-10-12T18:09:32.904744+00:00 |
| state\b24-stale-recovery-6zbXYv | 2331 | 8 | 12 | 2026-10-12T16:23:09.508702+00:00 |
| state\b24-stale-recovery-W0Y94G | 2331 | 8 | 12 | 2026-10-12T16:24:17.238967+00:00 |
| state\b24-stale-recovery-kKySqa | 2331 | 8 | 12 | 2026-10-12T16:26:49.070743+00:00 |
| state\b25-install-evidence | 146913 | 13 | 2 | 2026-10-12T20:12:58.303255+00:00 |
| state\b25-migration-manager-bcd813c0 | 13982735 | 143 | 32 | 2026-10-12T19:52:08.745240+00:00 |
| state\codex-sandbox-temp | 0 | 0 | 32 | - |
| state\comm-chmod-095d18ceeb554dd1ad215bbfcdb98452 | 768663 | 13 | 12 | 2026-10-26T11:57:18.962074+00:00 |
| state\comm-chmod-1acb04d29d644115b9b6951f1d54e496 | 767626 | 11 | 12 | 2026-10-26T11:48:00.868576+00:00 |
| state\comm-chmod-336b8eec29414408be5b16e300f4bb8f | 891541 | 14 | 13 | 2026-10-26T12:16:38.760866+00:00 |
| state\comm-chmod-48b0a3a55b9844679ea6ad23ab0b63d5 | 8092 | 4 | 2 | 2026-10-26T12:19:14.295614+00:00 |
| state\comm-chmod-547a1eebc99e48e791931b2b4f494be6 | 138189 | 20 | 3 | 2026-10-26T12:22:00.243130+00:00 |
| state\comm-chmod-65cb595e9a264326b153b08c44c0ad8b | 9209 | 10 | 3 | 2026-10-26T12:25:37.966251+00:00 |
| state\comm-chmod-6ce6bd05024d41dabb2e86f9e36a41b5 | 0 | 0 | 4 | - |
| state\comm-chmod-GZ2uuq | 126992 | 2 | 2 | 2026-10-26T09:38:14.485693+00:00 |
| state\comm-chmod-a8223c56366a45a0a2ec87f6ba4608f9 | 164976 | 24 | 6 | 2026-10-26T12:50:26.711325+00:00 |
| state\comm-chmod-aa9f9c50305c46be8795065eff275c77 | 151611 | 22 | 5 | 2026-10-26T12:32:33.736167+00:00 |
| state\comm-chmod-acf8005518d4466db31dde0d1a2af1f8 | 767242 | 11 | 12 | 2026-10-26T09:41:56.029704+00:00 |
| state\comm-chmod-b229c74cbf924bb38cdd396757fb6e1c | 0 | 0 | 4 | - |
| state\comm-chmod-b85050c4cc2f4fcd9f61945767cbac16 | 138189 | 20 | 3 | 2026-10-26T12:26:18.416502+00:00 |
| state\comm-chmod-fc652b3a62b64939963603bedb5f2541 | 138189 | 20 | 3 | 2026-10-26T12:31:06.430074+00:00 |
| state\data | 0 | 0 | 2 | - |
| state\development-auth-54trxf | 2985 | 5 | 4 | 2026-10-23T13:20:26.294832+00:00 |
| state\development-auth-HAmzLA | 2374 | 5 | 3 | 2026-10-16T17:17:52.536344+00:00 |
| state\development-auth-HadM0P | 2985 | 5 | 4 | 2026-10-19T17:09:59.828136+00:00 |
| state\development-auth-ILA2sN | 2985 | 5 | 4 | 2026-10-17T15:09:55.163565+00:00 |
| state\development-auth-L0JAgy | 2423 | 5 | 3 | 2026-10-16T17:33:54.788553+00:00 |
| state\development-auth-UYAbK1 | 2985 | 5 | 4 | 2026-10-17T11:31:45.984309+00:00 |
| state\development-auth-VDf4mq | 2985 | 5 | 4 | 2026-10-23T17:42:34.048871+00:00 |
| state\development-auth-bkfUI5 | 2985 | 5 | 4 | 2026-10-18T05:46:28.327720+00:00 |
| state\development-auth-bs7f2K | 2985 | 5 | 4 | 2026-10-24T04:11:31.235806+00:00 |
| state\development-auth-fuwoKL | 2423 | 5 | 3 | 2026-10-16T17:30:51.676396+00:00 |
| state\development-auth-jFE1QR | 2985 | 5 | 4 | 2026-10-19T17:13:52.126081+00:00 |
| state\development-auth-nooO7Q | 2985 | 5 | 4 | 2026-10-19T17:10:35.450992+00:00 |
| state\development-auth-o4YWva | 2374 | 5 | 3 | 2026-10-16T17:19:52.817890+00:00 |
| state\development-auth-rVLcQX | 2985 | 5 | 4 | 2026-10-17T15:20:26.997623+00:00 |
| state\development-auth-u1F2on | 733 | 5 | 2 | 2026-10-16T17:17:03.271687+00:00 |
| state\development-auth-uZ226J | 2985 | 5 | 4 | 2026-10-20T08:36:47.577845+00:00 |
| state\development-auth-xcgrQw | 2985 | 5 | 4 | 2026-10-16T17:34:53.623039+00:00 |
| state\development-auth-yzQBqo | 2985 | 5 | 4 | 2026-10-17T12:17:02.905128+00:00 |
| state\development-tasks-0aBK6R | 16936 | 8 | 3 | 2026-10-23T13:20:29.954512+00:00 |
| state\development-tasks-4LXHbG | 16361 | 8 | 3 | 2026-10-17T15:21:30.295207+00:00 |
| state\development-tasks-5GmtEl | 10736 | 8 | 3 | 2026-10-16T17:33:57.744387+00:00 |
| state\development-tasks-9KxmNi | 10736 | 8 | 3 | 2026-10-16T17:38:46.051948+00:00 |
| state\development-tasks-EJo24L | 10736 | 8 | 3 | 2026-10-17T12:28:44.893780+00:00 |
| state\development-tasks-FfmERT | 10736 | 8 | 3 | 2026-10-16T17:35:48.352023+00:00 |
| state\development-tasks-He5FBD | 13553 | 8 | 3 | 2026-10-17T15:19:04.668784+00:00 |
| state\development-tasks-HkiF69 | 16361 | 8 | 3 | 2026-10-17T15:19:59.873410+00:00 |
| state\development-tasks-JnZSJ6 | 16242 | 7 | 3 | 2026-10-24T04:11:32.366002+00:00 |
| state\development-tasks-KbAH2R | 13553 | 8 | 3 | 2026-10-17T15:10:05.043097+00:00 |
| state\development-tasks-MdL3jY | 16361 | 8 | 3 | 2026-10-18T05:42:44.754042+00:00 |
| state\development-tasks-RjDucN | 10736 | 8 | 3 | 2026-10-16T17:29:40.448243+00:00 |
| state\development-tasks-U9T3VP | 10736 | 8 | 3 | 2026-10-17T15:06:52.229501+00:00 |
| state\development-tasks-W8HFXV | 16361 | 8 | 3 | 2026-10-17T15:44:51.138597+00:00 |
| state\development-tasks-ZIR3R7 | 16361 | 8 | 3 | 2026-10-18T05:44:48.459032+00:00 |
| state\development-tasks-ZWfdiY | 6476 | 7 | 3 | 2026-10-16T17:25:02.083117+00:00 |
| state\development-tasks-ak6BZS | 13553 | 8 | 3 | 2026-10-17T15:09:20.124977+00:00 |
| state\development-tasks-igJ8CN | 10736 | 8 | 3 | 2026-10-17T11:31:55.980714+00:00 |
| state\development-tasks-mwrjYr | 16361 | 8 | 3 | 2026-10-17T15:43:17.152374+00:00 |
| state\development-tasks-yUaLLD | 16936 | 8 | 3 | 2026-10-23T17:42:37.678719+00:00 |
| state\development-tasks-zRmNie | 6983 | 8 | 3 | 2026-10-16T17:25:19.817728+00:00 |
| state\dock-development-7NL0NV | 1519 | 4 | 2 | 2026-10-24T04:11:19.741735+00:00 |
| state\dock-development-PsfoEk | 1917 | 6 | 3 | 2026-10-16T17:32:36.258580+00:00 |
| state\dock-development-Tfq8u5 | 1917 | 6 | 3 | 2026-10-23T17:31:13.805559+00:00 |
| state\dock-development-Z1Iqbb | 290 | 1 | 2 | 2026-10-16T17:22:09.726892+00:00 |
| state\dock-development-frryLk | 1917 | 6 | 3 | 2026-10-23T13:09:56.121237+00:00 |
| state\dock-development-hSXAfc | 2024 | 6 | 3 | 2026-10-24T04:44:47.697378+00:00 |
| state\dock-development-uzwFd7 | 290 | 1 | 2 | 2026-10-16T17:22:08.729736+00:00 |
| state\dock-development-vpTMHi | 1412 | 4 | 2 | 2026-10-16T17:29:36.453831+00:00 |
| state\dock-development-vwyhog | 290 | 1 | 2 | 2026-10-16T17:27:30.469871+00:00 |
| state\dock-development-w7KOjm | 1917 | 6 | 3 | 2026-10-17T11:32:20.981190+00:00 |
| state\dsh-nocrt-d34e99e0dbc5443eb787b78cb5365810 | 19456 | 2 | 0 | 2026-10-23T19:10:03.959701+00:00 |
| state\env | 0 | 0 | 3 | - |
| state\goal-supervisor-live-acceptance-20261021 | 8669 | 3 | 2 | 2026-10-21T13:48:11.270082+00:00 |
| state\goal-supervisor-live-acceptance-20261021-r2 | 23828 | 4 | 2 | 2026-10-21T13:52:39.116442+00:00 |
| state\guardian-ownership-3vNGg7 | 35537 | 6 | 3 | 2026-10-23T17:48:59.408681+00:00 |
| state\guardian-ownership-EJshlu | 22762 | 5 | 3 | 2026-10-23T17:48:57.501929+00:00 |
| state\guardian-ownership-H9tkdB | 24438 | 5 | 3 | 2026-10-24T04:12:05.661191+00:00 |
| state\guardian-ownership-TDsA1J | 22302 | 5 | 3 | 2026-10-23T17:36:35.659783+00:00 |
| state\guardian-ownership-V4GxcZ | 25821 | 5 | 3 | 2026-10-25T16:40:48.655141+00:00 |
| state\guardian-ownership-cIwXN1 | 36189 | 6 | 3 | 2026-10-23T18:01:33.580778+00:00 |
| state\guardian-ownership-fAFxzM | 38441 | 6 | 3 | 2026-10-25T16:40:50.574597+00:00 |
| state\guardian-ownership-ffQuTj | 24438 | 5 | 3 | 2026-10-23T19:02:52.992047+00:00 |
| state\guardian-ownership-ipeLP7 | 35130 | 6 | 3 | 2026-10-23T17:36:37.617882+00:00 |
| state\guardian-ownership-kGXaf8 | 23063 | 4 | 3 | 2026-10-24T11:19:17.382948+00:00 |
| state\guardian-ownership-qEhlKv | 37210 | 6 | 3 | 2026-10-24T05:55:41.101120+00:00 |
| state\guardian-ownership-qx8UIt | 37209 | 6 | 3 | 2026-10-24T04:57:43.687909+00:00 |
| state\guardian-ownership-ufo2Jw | 24436 | 5 | 3 | 2026-10-24T05:55:39.231499+00:00 |
| state\guardian-ownership-vktnUg | 24438 | 5 | 3 | 2026-10-24T04:57:41.692684+00:00 |
| state\guardian-ownership-wYyrwo | 37210 | 6 | 3 | 2026-10-24T04:12:07.496305+00:00 |
| state\guardian-ownership-wigMsW | 37209 | 6 | 3 | 2026-10-23T19:02:54.776666+00:00 |
| state\guardian-ownership-xEx1Fi | 23417 | 5 | 3 | 2026-10-23T18:01:31.676064+00:00 |
| state\guardian-test-0UyNzH | 3894 | 7 | 2 | 2026-10-23T13:41:36.104328+00:00 |
| state\guardian-test-2IiYcP | 6297 | 7 | 2 | 2026-10-16T13:15:42.139504+00:00 |
| state\guardian-test-64OAmI | 6305 | 7 | 2 | 2026-10-17T10:36:46.835969+00:00 |
| state\guardian-test-6hTXPu | 7032 | 9 | 2 | 2026-10-23T12:30:45.459795+00:00 |
| state\guardian-test-7FNysq | 1409 | 5 | 2 | 2026-10-13T12:06:58.742658+00:00 |
| state\guardian-test-8X8NCg | 3269 | 6 | 2 | 2026-10-16T13:15:33.822054+00:00 |
| state\guardian-test-AZipfy | 577 | 2 | 2 | 2026-10-24T04:14:06.562243+00:00 |
| state\guardian-test-Ak9F5n | 3173 | 3 | 2 | 2026-10-16T13:18:44.432461+00:00 |
| state\guardian-test-E46ERC | 436 | 2 | 2 | 2026-10-13T11:56:28.145358+00:00 |
| state\guardian-test-Ebyhfz | 7032 | 9 | 2 | 2026-10-23T12:21:19.022624+00:00 |
| state\guardian-test-EvWf3E | 3173 | 3 | 2 | 2026-10-17T10:36:47.814275+00:00 |
| state\guardian-test-GDvZ9a | 3698 | 6 | 2 | 2026-10-16T13:18:28.416341+00:00 |
| state\guardian-test-GanQAU | 3690 | 6 | 2 | 2026-10-17T10:36:39.152208+00:00 |
| state\guardian-test-H3zAU7 | 3595 | 4 | 2 | 2026-10-23T12:30:47.514531+00:00 |
| state\guardian-test-H7vRUq | 4989 | 6 | 2 | 2026-10-16T12:55:41.212246+00:00 |
| state\guardian-test-IbRbgY | 1408 | 5 | 2 | 2026-10-13T12:04:41.916525+00:00 |
| state\guardian-test-K986Kf | 3699 | 6 | 2 | 2026-10-17T10:36:32.210759+00:00 |
| state\guardian-test-L24ovN | 4414 | 7 | 2 | 2026-10-23T17:56:54.903597+00:00 |
| state\guardian-test-LXfsox | 3699 | 6 | 2 | 2026-10-16T13:12:38.717256+00:00 |
| state\guardian-test-MmSvKk | 3595 | 4 | 2 | 2026-10-23T13:41:46.384211+00:00 |
| state\guardian-test-NLrNvW | 3683 | 6 | 2 | 2026-10-16T13:18:35.667839+00:00 |
| state\guardian-test-OTm5k8 | 1414 | 5 | 2 | 2026-10-13T12:04:49.965383+00:00 |
| state\guardian-test-QO3CFk | 4416 | 8 | 2 | 2026-10-23T12:21:03.645241+00:00 |
| state\guardian-test-VxYGXO | 6296 | 7 | 2 | 2026-10-16T13:18:43.401778+00:00 |
| state\guardian-test-X4soSj | 3896 | 7 | 2 | 2026-10-23T12:30:37.177120+00:00 |
| state\guardian-test-b29Aw8 | 4416 | 8 | 2 | 2026-10-23T12:30:29.899920+00:00 |
| state\guardian-test-b2cOeX | 4994 | 6 | 2 | 2026-10-16T12:58:21.269958+00:00 |
| state\guardian-test-cB7xIR | 2388 | 5 | 2 | 2026-10-16T12:55:25.850739+00:00 |
| state\guardian-test-cip6LM | 1409 | 5 | 2 | 2026-10-13T12:59:45.700734+00:00 |
| state\guardian-test-cmyTsf | 3896 | 7 | 2 | 2026-10-23T12:21:10.840183+00:00 |
| state\guardian-test-dCfrL5 | 3595 | 4 | 2 | 2026-10-23T12:21:21.010650+00:00 |
| state\guardian-test-dE1r1T | 6304 | 7 | 2 | 2026-10-16T13:12:53.393177+00:00 |
| state\guardian-test-dSt0RZ | 5247 | 8 | 2 | 2026-10-23T17:56:47.291702+00:00 |
| state\guardian-test-e4at26 | 7024 | 9 | 2 | 2026-10-23T13:41:44.332036+00:00 |
| state\guardian-test-fhwrRI | 3691 | 6 | 2 | 2026-10-16T13:15:25.882648+00:00 |
| state\guardian-test-g4Z3MF | 2323 | 5 | 2 | 2026-10-16T12:55:33.272574+00:00 |
| state\guardian-test-gg3ZJw | 2388 | 5 | 2 | 2026-10-16T12:58:13.618171+00:00 |
| state\guardian-test-gyD56i | 3698 | 6 | 2 | 2026-10-16T13:12:45.787374+00:00 |
| state\guardian-test-iWMhNG | 1414 | 5 | 2 | 2026-10-13T12:47:15.278001+00:00 |
| state\guardian-test-j0m0r6 | 6289 | 7 | 2 | 2026-10-16T13:21:46.140067+00:00 |
| state\guardian-test-j8zZ7p | 1178 | 5 | 2 | 2026-10-13T12:00:59.182642+00:00 |
| state\guardian-test-jOB2Tw | 7995 | 9 | 2 | 2026-10-23T17:57:03.507902+00:00 |
| state\guardian-test-oQHYsz | 3699 | 6 | 2 | 2026-10-16T13:21:29.990538+00:00 |
| state\guardian-test-owlCeG | 1407 | 5 | 2 | 2026-10-13T12:59:38.260416+00:00 |
| state\guardian-test-tYDTBU | 1178 | 5 | 2 | 2026-10-13T12:01:26.094412+00:00 |
| state\guardian-test-uU8QGz | 4416 | 8 | 2 | 2026-10-23T13:41:28.804845+00:00 |
| state\guardian-test-usJK6Q | 3173 | 3 | 2 | 2026-10-16T13:21:47.189456+00:00 |
| state\guardian-test-vPe54B | 1409 | 5 | 2 | 2026-10-13T12:07:05.971379+00:00 |
| state\guardian-test-viz4qr | 4307 | 4 | 2 | 2026-10-23T17:57:05.543765+00:00 |
| state\guardian-test-wd0rie | 3261 | 6 | 2 | 2026-10-16T13:21:37.943606+00:00 |
| state\guardian-test-wtuyot | 1409 | 5 | 2 | 2026-10-13T12:47:07.331930+00:00 |
| state\guardian-test-y4sedg | 2388 | 5 | 2 | 2026-10-16T12:58:06.435825+00:00 |
| state\home | 0 | 0 | 3 | - |
| state\launcher-race-test-1Cf8Uh | 25914 | 8 | 3 | 2026-10-23T12:42:34.832594+00:00 |
| state\launcher-race-test-2D34gc | 25770 | 8 | 3 | 2026-10-23T12:24:17.963842+00:00 |
| state\launcher-race-test-34Wwmp | 28575 | 10 | 3 | 2026-10-23T12:24:20.790941+00:00 |
| state\launcher-race-test-3onQae | 28636 | 10 | 3 | 2026-10-23T12:34:07.983571+00:00 |
| state\launcher-race-test-44h0VN | 25829 | 8 | 3 | 2026-10-23T12:34:05.335516+00:00 |
| state\launcher-race-test-4DxTZB | 40479 | 10 | 3 | 2026-10-24T04:57:52.726054+00:00 |
| state\launcher-race-test-4OXcSb | 37886 | 8 | 3 | 2026-10-23T19:03:02.914639+00:00 |
| state\launcher-race-test-5A5u66 | 38722 | 10 | 3 | 2026-10-23T17:37:36.092532+00:00 |
| state\launcher-race-test-70DrdU | 37039 | 7 | 3 | 2026-10-24T04:07:00.888715+00:00 |
| state\launcher-race-test-8M1ZNp | 25529 | 7 | 3 | 2026-10-23T13:20:37.865511+00:00 |
| state\launcher-race-test-Aa2ify | 30919 | 7 | 3 | 2026-10-23T14:12:03.480705+00:00 |
| state\launcher-race-test-C95NWw | 28720 | 10 | 3 | 2026-10-23T13:22:51.781024+00:00 |
| state\launcher-race-test-CQ1UqH | 37886 | 8 | 3 | 2026-10-24T04:57:49.444353+00:00 |
| state\launcher-race-test-Dz2v6C | 40468 | 10 | 3 | 2026-10-24T04:09:05.746798+00:00 |
| state\launcher-race-test-FBeg9K | 37886 | 8 | 3 | 2026-10-24T04:11:12.162906+00:00 |
| state\launcher-race-test-G84YtD | 25529 | 7 | 3 | 2026-10-23T12:50:11.084698+00:00 |
| state\launcher-race-test-GRAznF | 28720 | 10 | 3 | 2026-10-23T12:50:15.710466+00:00 |
| state\launcher-race-test-GjogGh | 25529 | 7 | 3 | 2026-10-23T12:42:32.360731+00:00 |
| state\launcher-race-test-H5zCnW | 25914 | 8 | 3 | 2026-10-23T12:50:13.002621+00:00 |
| state\launcher-race-test-HYtrIV | 39458 | 10 | 3 | 2026-10-23T18:01:42.987843+00:00 |
| state\launcher-race-test-JX7IRP | 37039 | 7 | 3 | 2026-10-24T04:57:47.116411+00:00 |
| state\launcher-race-test-Kr9bEq | 28713 | 10 | 3 | 2026-10-23T12:42:38.257495+00:00 |
| state\launcher-race-test-KvtJUH | 25529 | 7 | 3 | 2026-10-23T13:22:46.965466+00:00 |
| state\launcher-race-test-L2h4Mz | 19513 | 4 | 3 | 2026-10-23T12:23:55.142746+00:00 |
| state\launcher-race-test-Mzt2XA | 37886 | 8 | 3 | 2026-10-24T04:09:02.721892+00:00 |
| state\launcher-race-test-NK5zMI | 25444 | 7 | 3 | 2026-10-23T12:34:03.455359+00:00 |
| state\launcher-race-test-NvziC5 | 37039 | 7 | 3 | 2026-10-24T04:11:10.029018+00:00 |
| state\launcher-race-test-OxtFRD | 37039 | 7 | 3 | 2026-10-24T04:15:20.676781+00:00 |
| state\launcher-race-test-PqjHrR | 40479 | 10 | 3 | 2026-10-23T19:13:43.222193+00:00 |
| state\launcher-race-test-QDMfzk | 25385 | 7 | 3 | 2026-10-23T12:24:15.913320+00:00 |
| state\launcher-race-test-QPeIJO | 40479 | 10 | 3 | 2026-10-24T04:15:25.928392+00:00 |
| state\launcher-race-test-RK0Wnu | 35330 | 7 | 3 | 2026-10-23T17:42:45.682071+00:00 |
| state\launcher-race-test-RLRqMD | 37039 | 7 | 3 | 2026-10-24T04:09:00.628853+00:00 |
| state\launcher-race-test-Rx39ID | 25914 | 8 | 3 | 2026-10-23T13:22:48.941164+00:00 |
| state\launcher-race-test-ZO1yZB | 25914 | 8 | 3 | 2026-10-23T13:23:21.778962+00:00 |
| state\launcher-race-test-a83g0X | 31594 | 8 | 3 | 2026-10-23T14:12:05.749870+00:00 |
| state\launcher-race-test-aupjJe | 37039 | 7 | 3 | 2026-10-24T05:55:45.602475+00:00 |
| state\launcher-race-test-eMnlLs | 28720 | 10 | 3 | 2026-10-23T13:23:24.592979+00:00 |
| state\launcher-race-test-fz9mXb | 25529 | 7 | 3 | 2026-10-23T13:23:19.824380+00:00 |
| state\launcher-race-test-jKvY9Y | 34311 | 10 | 3 | 2026-10-23T14:12:09.102592+00:00 |
| state\launcher-race-test-kftqUn | 40468 | 10 | 3 | 2026-10-23T19:03:06.008912+00:00 |
| state\launcher-race-test-kmMdgv | 36018 | 7 | 3 | 2026-10-23T18:01:37.620025+00:00 |
| state\launcher-race-test-lZV2m6 | 37882 | 8 | 3 | 2026-10-24T05:55:47.793324+00:00 |
| state\launcher-race-test-mNAtFt | 40479 | 10 | 3 | 2026-10-24T04:07:06.125799+00:00 |
| state\launcher-race-test-nSggxm | 40455 | 10 | 3 | 2026-10-24T05:55:50.954801+00:00 |
| state\launcher-race-test-nYTjcm | 37882 | 8 | 3 | 2026-10-24T04:15:22.847901+00:00 |
| state\launcher-race-test-olicON | 36177 | 8 | 3 | 2026-10-23T17:37:32.941439+00:00 |
| state\launcher-race-test-p9THML | 36865 | 8 | 3 | 2026-10-23T18:01:39.880232+00:00 |
| state\launcher-race-test-pqxAYh | 37886 | 8 | 3 | 2026-10-23T19:13:40.115757+00:00 |
| state\launcher-race-test-rMH9fi | 28720 | 10 | 3 | 2026-10-23T13:20:42.570211+00:00 |
| state\launcher-race-test-sd0eYp | 37039 | 7 | 3 | 2026-10-23T19:13:37.925746+00:00 |
| state\launcher-race-test-thX6VD | 37039 | 7 | 3 | 2026-10-23T19:03:00.713350+00:00 |
| state\launcher-race-test-u0VueG | 40479 | 10 | 3 | 2026-10-24T04:11:15.292520+00:00 |
| state\launcher-race-test-uJnBsp | 38712 | 10 | 3 | 2026-10-23T17:42:50.895483+00:00 |
| state\launcher-race-test-vOUzuB | 37884 | 8 | 3 | 2026-10-24T04:07:03.050987+00:00 |
| state\launcher-race-test-xL3DKH | 35330 | 7 | 3 | 2026-10-23T17:37:30.704632+00:00 |
| state\launcher-race-test-yCX14B | 25914 | 8 | 3 | 2026-10-23T13:20:39.817158+00:00 |
| state\launcher-race-test-zyzc84 | 36177 | 8 | 3 | 2026-10-23T17:42:47.933203+00:00 |
| state\legacy-024-0hTpzd | 22278 | 95 | 25 | 2026-10-24T05:54:45.108085+00:00 |
| state\legacy-024-9uQr3e | 79248 | 322 | 91 | 2026-10-24T14:39:33.736754+00:00 |
| state\legacy-024-D5ReJv | 79248 | 322 | 91 | 2026-10-24T06:05:57.573458+00:00 |
| state\legacy-024-L4JOrR | 79248 | 322 | 91 | 2026-10-24T09:32:12.796177+00:00 |
| state\legacy-024-U7PMk7 | 75220 | 306 | 86 | 2026-10-24T06:00:50.121361+00:00 |
| state\legacy-024-VHjk6N | 54883 | 227 | 60 | 2026-10-24T05:59:18.999223+00:00 |
| state\legacy-024-WvNDa1 | 14289 | 61 | 15 | 2026-10-24T05:56:41.412143+00:00 |
| state\legacy-024-aX2qUp | 54206 | 227 | 60 | 2026-10-24T05:56:58.607977+00:00 |
| state\legacy-024-cQCtPq | 79248 | 322 | 91 | 2026-10-24T06:04:36.931219+00:00 |
| state\locks | 0 | 0 | 2 | - |
| state\login-test-2EyWlE | 279152 | 138 | 121 | 2026-10-16T13:00:12.249677+00:00 |
| state\login-test-2RJrP7 | 425418 | 193 | 157 | 2026-10-17T10:28:41.216587+00:00 |
| state\login-test-427SGk | 632208 | 209 | 169 | 2026-10-23T17:49:19.426165+00:00 |
| state\login-test-5VsRy2 | 150190 | 84 | 65 | 2026-10-16T12:52:52.804928+00:00 |
| state\login-test-6FeDSn | 464496 | 209 | 169 | 2026-10-17T10:34:51.130142+00:00 |
| state\login-test-71NZf5 | 632254 | 209 | 169 | 2026-10-23T13:34:30.996825+00:00 |
| state\login-test-778KK7 | 129621 | 100 | 87 | 2026-10-13T12:08:15.452086+00:00 |
| state\login-test-7khKkr | 211701 | 115 | 96 | 2026-10-17T10:27:44.894108+00:00 |
| state\login-test-8SzLHA | 144367 | 107 | 92 | 2026-10-13T12:16:43.335425+00:00 |
| state\login-test-AKaYIG | 632258 | 209 | 169 | 2026-10-23T12:40:04.339934+00:00 |
| state\login-test-C002Z5 | 122933 | 93 | 82 | 2026-10-13T12:03:25.339198+00:00 |
| state\login-test-CApaib | 144363 | 107 | 92 | 2026-10-13T12:14:02.542285+00:00 |
| state\login-test-HbbHbj | 298803 | 153 | 127 | 2026-10-16T17:11:50.472404+00:00 |
| state\login-test-KPdiEQ | 89825 | 67 | 61 | 2026-10-13T12:02:03.725898+00:00 |
| state\login-test-LLIjnE | 183130 | 91 | 84 | 2026-10-16T12:57:49.189000+00:00 |
| state\login-test-Q2ib3i | 298631 | 153 | 127 | 2026-10-16T13:19:48.335650+00:00 |
| state\login-test-RIHQRg | 144108 | 107 | 92 | 2026-10-13T12:13:01.003452+00:00 |
| state\login-test-RoVNBV | 279319 | 138 | 121 | 2026-10-16T13:01:22.489021+00:00 |
| state\login-test-S98fZb | 95301 | 70 | 62 | 2026-10-13T12:02:26.549764+00:00 |
| state\login-test-Vu9RpY | 88392 | 67 | 63 | 2026-10-13T12:01:29.075063+00:00 |
| state\login-test-XA6Exi | 250151 | 131 | 119 | 2026-10-16T12:58:12.189710+00:00 |
| state\login-test-YxDkFa | 147510 | 107 | 92 | 2026-10-13T12:38:51.267884+00:00 |
| state\login-test-Zojcfs | 35213 | 26 | 25 | 2026-10-13T14:02:46.509858+00:00 |
| state\login-test-az4SHE | 155519 | 107 | 92 | 2026-10-13T14:04:52.780326+00:00 |
| state\login-test-bGk6e5 | 465631 | 209 | 169 | 2026-10-18T09:37:28.039889+00:00 |
| state\login-test-bgzvlt | 469707 | 209 | 169 | 2026-10-17T11:04:09.804643+00:00 |
| state\login-test-eszzdz | 9022 | 5 | 5 | 2026-10-13T11:56:27.999754+00:00 |
| state\login-test-h1H6i2 | 0 | 0 | 0 | - |
| state\login-test-i7lbef | 148141 | 107 | 92 | 2026-10-13T13:07:56.560620+00:00 |
| state\login-test-i9mynY | 129366 | 100 | 87 | 2026-10-13T12:06:52.248680+00:00 |
| state\login-test-iNy7by | 144112 | 107 | 92 | 2026-10-13T12:15:54.859560+00:00 |
| state\login-test-isIFDj | 148141 | 107 | 92 | 2026-10-13T12:48:11.291431+00:00 |
| state\login-test-jnbxxh | 426308 | 193 | 157 | 2026-10-17T10:29:36.338765+00:00 |
| state\login-test-nxeKO6 | 53034 | 43 | 40 | 2026-10-13T12:11:01.606881+00:00 |
| state\login-test-oEE13v | 322890 | 156 | 126 | 2026-10-17T10:33:39.456027+00:00 |
| state\login-test-p5oHm6 | 81754 | 64 | 60 | 2026-10-13T12:01:00.955834+00:00 |
| state\login-test-r4wV5C | 154021 | 85 | 78 | 2026-10-16T12:54:19.542591+00:00 |
| state\login-test-rUHxJ9 | 157090 | 107 | 92 | 2026-10-13T14:47:06.219931+00:00 |
| state\login-test-rtElkf | 147886 | 107 | 92 | 2026-10-13T12:59:31.542484+00:00 |
| state\login-test-rxSNtZ | 470840 | 209 | 169 | 2026-10-17T11:04:13.115440+00:00 |
| state\login-test-sQqoJw | 6113 | 5 | 5 | 2026-10-13T12:01:27.900107+00:00 |
| state\login-test-sU143T | 155264 | 107 | 92 | 2026-10-13T14:04:10.015353+00:00 |
| state\login-test-sVdBzi | 295547 | 144 | 127 | 2026-10-16T13:10:05.275233+00:00 |
| state\login-test-tJHdTS | 295706 | 144 | 127 | 2026-10-16T13:10:04.517742+00:00 |
| state\login-test-vP3lm7 | 465632 | 209 | 169 | 2026-10-17T10:34:54.267450+00:00 |
| state\login-test-vaXPJP | 632222 | 209 | 169 | 2026-10-23T12:25:55.867215+00:00 |
| state\login-test-w9vJlU | 298806 | 153 | 127 | 2026-10-16T13:29:05.023537+00:00 |
| state\login-test-wO2xWE | 9041 | 5 | 5 | 2026-10-13T11:56:43.359933+00:00 |
| state\mcp | 0 | 0 | 0 | - |
| state\native-codex-acceptance-20261018 | 3083883082 | 196287 | 13486 | 2026-10-18T09:45:46.804227+00:00 |
| state\observer-inventory-8TrcIC | 12736 | 1 | 0 | 2026-10-24T11:02:55.108802+00:00 |
| state\observer-inventory-Hzxev3 | 13112 | 1 | 0 | 2026-10-24T12:43:32.734200+00:00 |
| state\observer-inventory-P5DcDX | 13112 | 1 | 0 | 2026-10-24T11:42:51.033061+00:00 |
| state\observer-inventory-UE5jML | 12736 | 1 | 0 | 2026-10-24T10:58:35.130470+00:00 |
| state\observer-inventory-kEgN8G | 13112 | 1 | 0 | 2026-10-24T11:32:40.747742+00:00 |
| state\observer-inventory-mscvTZ | 13112 | 1 | 0 | 2026-10-24T11:27:25.256950+00:00 |
| state\observer-inventory-umMcr1 | 13112 | 1 | 0 | 2026-10-24T11:56:45.809438+00:00 |
| state\observer-inventory-yBgNZC | 12132 | 1 | 0 | 2026-10-24T10:58:17.314472+00:00 |
| state\p0-deploy-27a07c9 | 15880796 | 240 | 52 | 2026-10-16T05:06:37.466855+00:00 |
| state\p1-deploy-2de48ea | 15975104 | 239 | 53 | 2026-10-16T11:35:10.835528+00:00 |
| state\p243-client-4xXvbM | 534 | 2 | 0 | 2026-10-10T14:42:33.745205+00:00 |
| state\p243-client-DOGLMZ | 534 | 2 | 0 | 2026-10-10T16:49:01.002462+00:00 |
| state\p243-client-Dab4ZO | 534 | 2 | 0 | 2026-10-10T16:46:33.815172+00:00 |
| state\p243-client-nnKjyv | 534 | 2 | 0 | 2026-10-10T18:49:03.240932+00:00 |
| state\p243-client-pRdc24 | 534 | 2 | 0 | 2026-10-10T16:39:19.582856+00:00 |
| state\p243-client-rYBsjT | 534 | 2 | 0 | 2026-10-10T14:34:51.452924+00:00 |
| state\p244-policy-5gLx2i | 1355 | 1 | 0 | 2026-10-10T16:34:52.124532+00:00 |
| state\p244-policy-Een21O | 4832 | 13 | 1 | 2026-10-10T18:48:59.142829+00:00 |
| state\p244-policy-EtPqE9 | 1282 | 1 | 0 | 2026-10-10T16:32:33.968069+00:00 |
| state\p244-policy-J3FxgG | 1718 | 2 | 0 | 2026-10-10T16:47:55.922776+00:00 |
| state\p244-policy-ht0wfF | 1355 | 1 | 0 | 2026-10-10T16:45:29.597822+00:00 |
| state\p244-policy-pn51D3 | 1120 | 1 | 0 | 2026-10-10T16:24:46.912728+00:00 |
| state\p244-policy-q1H7ra | 1355 | 1 | 0 | 2026-10-10T16:38:27.085890+00:00 |
| state\p244-policy-rvJAtK | 1187 | 1 | 0 | 2026-10-10T16:26:38.636009+00:00 |
| state\p244-policy-tQOUZj | 1355 | 1 | 0 | 2026-10-10T16:33:41.316622+00:00 |
| state\p244-python-runtime | 36443104 | 2466 | 231 | 2026-10-10T16:31:17.607923+00:00 |
| state\p26-approval-compat-b55709e2c0fb | 12551 | 36 | 4 | 2026-10-13T04:36:44.732306+00:00 |
| state\p26-cold-start-20261014 | 604781675 | 39001 | 2680 | 2026-10-23T17:42:11.624204+00:00 |
| state\p26-d02-approval-b55709e2c0fb | 19158 | 6 | 0 | 2026-10-13T06:36:34.248936+00:00 |
| state\p26-git-independence | 27039 | 10 | 3 | 2026-10-12T20:32:19.827744+00:00 |
| state\p26-login-preparation | 33293837 | 8 | 0 | 2026-10-12T20:40:13.256728+00:00 |
| state\p26-login-preparation-v2 | 9336 | 3 | 0 | 2026-10-13T12:14:53.108340+00:00 |
| state\p26-login-preparation-v3 | 9388 | 3 | 0 | 2026-10-13T13:01:28.226705+00:00 |
| state\p26-login-preparation-v4 | 10458 | 3 | 0 | 2026-10-13T14:46:18.972858+00:00 |
| state\p26-path-repair | 5867 | 3 | 0 | 2026-10-12T20:34:27.894249+00:00 |
| state\p26-release-preparation-67ffa0da | 1426000354 | 78699 | 6424 | 2026-10-13T15:05:16.916073+00:00 |
| state\p26-startup-readiness-20261017 | 15459598 | 202 | 35 | 2026-10-17T10:53:45.315134+00:00 |
| state\p26-switch-preparation-10f45f7 | 17172416 | 194 | 36 | 2026-10-14T13:47:08.990638+00:00 |
| state\p27-autonomy-candidate-20261017 | 7741071264 | 479762 | 34027 | 2026-10-22T16:53:46.785868+00:00 |
| state\plainprobe-1986ba58c21842e48e3fe759f0d2797a | 3 | 1 | 0 | 2026-10-24T07:45:44.963005+00:00 |
| state\plugins | 0 | 0 | 0 | - |
| state\pre-init-hold | 0 | 0 | 1 | - |
| state\protprobe-a1ddcf7828ba47e48f3ba811bdc9aeb0 | 3 | 1 | 0 | 2026-10-24T07:45:45.125010+00:00 |
| state\public-artifacts | 0 | 0 | 0 | - |
| state\receipt-atomic-0G3Zqy | 7704 | 3 | 0 | 2026-10-23T18:46:10.303537+00:00 |
| state\receipt-atomic-5BFLH1 | 10668 | 3 | 0 | 2026-10-23T17:56:03.371437+00:00 |
| state\receipt-atomic-6oTfPb | 10666 | 3 | 0 | 2026-10-23T17:53:15.338850+00:00 |
| state\receipt-atomic-AYZIYD | 7704 | 3 | 0 | 2026-10-24T04:11:17.251436+00:00 |
| state\receipt-atomic-Cag3cE | 7694 | 3 | 0 | 2026-10-24T05:55:44.361210+00:00 |
| state\receipt-atomic-Fgmcwn | 7704 | 3 | 0 | 2026-10-23T19:02:58.553386+00:00 |
| state\receipt-atomic-LQ4N7O | 5403 | 3 | 0 | 2026-10-23T17:52:45.540987+00:00 |
| state\receipt-atomic-N2PxtK | 2051 | 1 | 0 | 2026-10-24T11:23:20.884404+00:00 |
| state\receipt-atomic-RYds82 | 2080 | 3 | 0 | 2026-10-23T18:45:48.466273+00:00 |
| state\receipt-atomic-b40XRV | 7704 | 3 | 0 | 2026-10-24T04:57:39.176653+00:00 |
| state\receipt-atomic-b7RcJ9 | 10668 | 3 | 0 | 2026-10-23T17:53:54.103935+00:00 |
| state\receipt-atomic-sKQ3JM | 7704 | 3 | 0 | 2026-10-24T04:20:26.917059+00:00 |
| state\receipt-atomic-wbBUD8 | 5318 | 2 | 0 | 2026-10-23T17:50:25.043097+00:00 |
| state\recovery-offline-AT3pA6 | 2035 | 9 | 8 | 2026-10-24T04:57:37.294796+00:00 |
| state\recovery-offline-Gkizkk | 2035 | 9 | 8 | 2026-10-24T04:11:08.692332+00:00 |
| state\recovery-offline-K8JQMX | 2035 | 9 | 8 | 2026-10-24T04:14:18.192195+00:00 |
| state\recovery-offline-R5WXR7 | 2035 | 9 | 8 | 2026-10-23T18:55:09.512671+00:00 |
| state\recovery-offline-UfvGHL | 2035 | 9 | 8 | 2026-10-23T17:41:33.389024+00:00 |
| state\recovery-offline-YiqWLb | 2035 | 9 | 8 | 2026-10-23T17:42:30.122712+00:00 |
| state\recovery-offline-aWMvPm | 1172 | 9 | 8 | 2026-10-23T17:28:37.911276+00:00 |
| state\recovery-offline-lvWaZa | 2035 | 9 | 8 | 2026-10-24T04:47:17.633549+00:00 |
| state\recovery-offline-tiIWPO | 2035 | 9 | 8 | 2026-10-23T19:12:46.951122+00:00 |
| state\recovery-offline-x4eEuE | 2035 | 9 | 8 | 2026-10-23T17:38:54.853046+00:00 |
| state\replace-sharing-6efbb3f80eac4e85982957be7197f63b | 252 | 21 | 0 | 2026-10-23T18:44:53.051692+00:00 |
| state\replace-sharing-86d5e8d7650247a2b1cb88572f1495b9 | 180 | 15 | 0 | 2026-10-23T18:44:05.628927+00:00 |
| state\run | 0 | 0 | 1 | - |
| state\runtime-recovery-3442cbb-20261016 | 15670365 | 243 | 50 | 2026-10-16T16:12:48.022238+00:00 |
| state\secrets | 65 | 1 | 0 | 2026-10-10T13:52:52.417252+00:00 |
| state\silent-host-test-0b0af8cb025f4d91b0b316e8b9a0ec20 | 7635 | 7 | 0 | 2026-10-23T13:15:03.973127+00:00 |
| state\silent-host-test-16dd33e95c604ee6b3b381222cf241b0 | 7636 | 7 | 0 | 2026-10-24T04:12:28.544894+00:00 |
| state\silent-host-test-188873445a32415db00343ce075ab26b | 7627 | 7 | 0 | 2026-10-16T17:12:22.950125+00:00 |
| state\silent-host-test-d0f1b3e674ef495f87274653f4db18d2 | 7554 | 6 | 0 | 2026-10-16T17:08:15.903250+00:00 |
| state\silent-host-test-e5866b95c89847658433592e310528e1 | 0 | 0 | 0 | - |
| state\silent-host-test-f8d53d617fde45bc8661be1b0bb9a776 | 7636 | 7 | 0 | 2026-10-23T17:30:53.146674+00:00 |
| state\skills | 0 | 0 | 0 | - |
| state\stale-recovery-KN4n0H | 0 | 0 | 0 | - |
| state\startup-candidate-review-2F2NOR | 479164 | 28 | 7 | 2026-10-25T16:55:11.282801+00:00 |
| state\startup-final-acceptance-fa97905-20261023 | 147601 | 261 | 8 | 2026-10-23T13:55:52.961723+00:00 |
| state\startup-observation-Um4LKr | 7667 | 5 | 0 | 2026-10-24T06:05:18.570857+00:00 |
| state\startup-observation-e6OH64 | 7974 | 5 | 0 | 2026-10-24T11:23:19.818801+00:00 |
| state\startup-observation-uke0yT | 7850 | 5 | 0 | 2026-10-24T06:05:55.688729+00:00 |
| state\startup-only-production-20261017 | 15510405 | 209 | 40 | 2026-10-17T11:25:14.173546+00:00 |
| state\startup-protocol-032f3867472d40ce910e56f606aa63b8 | 5368 | 18 | 10 | 2026-10-23T18:01:30.414638+00:00 |
| state\startup-protocol-10133a97670f451cbecf3a99612c021e | 3832 | 18 | 10 | 2026-10-23T12:41:35.880377+00:00 |
| state\startup-protocol-2883071e69e34a33bfe98598903e565a | 5370 | 18 | 10 | 2026-10-24T05:07:56.603254+00:00 |
| state\startup-protocol-471041ff565e4ba793122accfec57fc9 | 5362 | 18 | 10 | 2026-10-23T19:02:48.861918+00:00 |
| state\startup-protocol-481cfa00c4c04ff8b5141568273cd444 | 1831 | 8 | 4 | 2026-10-23T12:20:16.970349+00:00 |
| state\startup-protocol-53d6e961d5224e9aab207369a5e2244e | 3823 | 18 | 10 | 2026-10-23T12:42:30.928360+00:00 |
| state\startup-protocol-5f5e14ca9b40408c9f4f99465f147bda | 5365 | 18 | 10 | 2026-10-24T05:55:35.298914+00:00 |
| state\startup-protocol-93ebf4b577224f86b0808f11a6e0387f | 3419 | 16 | 8 | 2026-10-23T12:22:21.758521+00:00 |
| state\startup-protocol-d097e2af5f7948bbac5c1bf33579fdea | 5370 | 18 | 10 | 2026-10-23T17:31:34.490149+00:00 |
| state\startup-protocol-e9799da3231b4ece8094dc7a57e78e44 | 5347 | 18 | 10 | 2026-10-23T14:11:15.801032+00:00 |
| state\startup-protocol-eeaa3e79fa1d49f5acdb22a19eab469f | 6744 | 18 | 10 | 2026-10-25T16:40:24.063279+00:00 |
| state\startup-protocol-fcff9770d405427c8c87a3f6e8da5141 | 3822 | 18 | 10 | 2026-10-23T13:15:43.633143+00:00 |
| state\state | 0 | 0 | 4 | - |
| state\state-read-7w5JaA | 1777 | 7 | 0 | 2026-10-23T18:59:36.296561+00:00 |
| state\state-read-ZAb4ee | 1777 | 7 | 0 | 2026-10-24T04:57:40.389169+00:00 |
| state\state-read-etBIL9 | 892 | 3 | 0 | 2026-10-23T18:59:05.673194+00:00 |
| state\state-read-qCmcYF | 1777 | 7 | 0 | 2026-10-24T04:11:18.261459+00:00 |
| state\state-read-uO3dL4 | 1777 | 7 | 0 | 2026-10-23T19:02:59.546535+00:00 |
| state\state-read-vUartQ | 1777 | 7 | 0 | 2026-10-24T04:20:27.950596+00:00 |
| state\state-read-vVegrc | 1777 | 7 | 0 | 2026-10-23T19:05:10.659659+00:00 |
| state\stop-identity-test-NIZcZ0 | 1070 | 4 | 12 | 2026-10-13T12:13:44.355100+00:00 |
| state\stop-identity-test-OrA84M | 417 | 3 | 12 | 2026-10-13T12:10:57.918450+00:00 |
| state\stop-identity-test-aLkHv2 | 417 | 3 | 12 | 2026-10-13T12:12:46.889550+00:00 |
| state\stop-identity-test-o5Qr8c | 1069 | 4 | 12 | 2026-10-13T12:16:44.169842+00:00 |
| state\stop-identity-test-oCHGAk | 1070 | 4 | 12 | 2026-10-23T12:25:26.782573+00:00 |
| state\stop-identity-test-sEJc4H | 1070 | 4 | 12 | 2026-10-13T14:56:01.470918+00:00 |
| state\stop-identity-test-zBnGZe | 1070 | 4 | 12 | 2026-10-13T12:38:52.236454+00:00 |
| state\synthetic-test-0xmSfl | 71076911 | 1681 | 224 | 2026-10-23T19:13:34.282641+00:00 |
| state\synthetic-test-47tL42 | 1116 | 4 | 13 | 2026-10-23T18:00:59.140265+00:00 |
| state\synthetic-test-9yIMC9 | 71248272 | 1710 | 238 | 2026-10-24T04:15:17.442273+00:00 |
| state\synthetic-test-AKPymy | 1116 | 4 | 13 | 2026-10-23T13:45:32.324343+00:00 |
| state\synthetic-test-DhL7cJ | 71255581 | 1710 | 238 | 2026-10-24T05:07:16.413551+00:00 |
| state\synthetic-test-E6z5Fz | 71209379 | 1704 | 233 | 2026-10-23T19:34:19.711375+00:00 |
| state\synthetic-test-K2vfFl | 70611992 | 1601 | 207 | 2026-10-24T04:09:41.021972+00:00 |
| state\synthetic-test-LpBW9s | 70607065 | 1592 | 202 | 2026-10-24T04:08:10.941460+00:00 |
| state\synthetic-test-MqaMqy | 2691 | 9 | 13 | 2026-10-23T12:28:14.496864+00:00 |
| state\synthetic-test-OaoSep | 12460501 | 1158 | 73 | 2026-10-23T18:17:30.176357+00:00 |
| state\synthetic-test-PPeM5y | 1116 | 4 | 13 | 2026-10-23T12:39:26.710870+00:00 |
| state\synthetic-test-S4LbCw | 0 | 0 | 0 | - |
| state\synthetic-test-Std8DR | 29569191 | 1466 | 110 | 2026-10-23T17:43:14.569673+00:00 |
| state\synthetic-test-Vc8vdV | 17274354 | 314 | 38 | 2026-10-23T13:20:26.288099+00:00 |
| state\synthetic-test-WXHSat | 0 | 0 | 1 | - |
| state\synthetic-test-YGrsjE | 1115 | 4 | 13 | 2026-10-23T12:27:53.263254+00:00 |
| state\synthetic-test-ZbGelr | 0 | 0 | 0 | - |
| state\synthetic-test-ZcqUuV | 0 | 0 | 1 | - |
| state\synthetic-test-aEmbLn | 145328 | 26 | 44 | 2026-10-23T12:47:04.335887+00:00 |
| state\synthetic-test-an40p5 | 229422 | 50 | 40 | 2026-10-23T13:17:47.318097+00:00 |
| state\synthetic-test-hj6xcr | 146945 | 26 | 44 | 2026-10-23T17:56:37.290046+00:00 |
| state\synthetic-test-i31ZQh | 71046757 | 1676 | 224 | 2026-10-23T18:56:42.850207+00:00 |
| state\synthetic-test-jDbZPW | 229509 | 50 | 40 | 2026-10-23T12:43:33.252504+00:00 |
| state\synthetic-test-lETBjx | 0 | 0 | 0 | - |
| state\synthetic-test-lyJayr | 71248272 | 1710 | 238 | 2026-10-24T04:11:07.776468+00:00 |
| state\synthetic-test-mIt7Oc | 70608159 | 1592 | 203 | 2026-10-24T04:08:53.257842+00:00 |
| state\synthetic-test-n5HkhB | 0 | 0 | 0 | - |
| state\synthetic-test-rMHMZV | 71254407 | 1702 | 229 | 2026-10-23T19:32:46.102039+00:00 |
| state\synthetic-test-syl8lW | 238047 | 50 | 40 | 2026-10-23T17:38:53.998685+00:00 |
| state\synthetic-test-zDLvBt | 145342 | 26 | 44 | 2026-10-23T13:41:19.278734+00:00 |
| state\tasks | 0 | 0 | 0 | - |
| state\temp | 0 | 0 | 0 | - |
| state\tmp | 0 | 0 | 2 | - |

## 附录 C：所有嵌套Git标记的只读结果

共32个嵌套标记，30个可识别、2个不可识别；可识别的22个工作树有改动。全部remote为空（没有推送目的地），不代表不含独有提交。表中M/?为工作树修改/未跟踪条目数；生产workspace同样保留。未跟踪venv逐文件条目只汇总数量，未把环境包名列表当作源码差异。

| 根 | branch / HEAD | 跟踪文件数 | status摘要 / 原错误 |
| --- | --- | --- | --- |
| D:\Tong\runtime\workspace\b23-acceptance | codex/b24-acceptance / 7447688f807b9375639ff3bbc936294a456d670d | 2 | M=1；?=0； M calculator.py |
| D:\Tong\state\b22-final-regression-1a1e4a54fecf\tong-dock-execution-jt7cHg\project | UNKNOWN / UNKNOWN | UNKNOWN | fatal: not a git repository (or any of the parent directories): .git |
| D:\Tong\state\b23-switch-c104fcca2aa9\workspace\project | master / aa92ebf686010c9f7e666d4bef2f1ab15caf1208 | 2 | M=1；?=0； M calculator.py |
| D:\Tong\state\b24-closeout-20261012-9a87f321\live-workspace\project | master / 46c2c15fb7c99de03ad9fa86716766a635ab8532 | 2 | M=0；?=0； |
| D:\Tong\state\b24-closeout-20261012-9a87f321-live2\live-workspace\project | master / 43239d4b5cc4d808ab01390b414376f69354f4df | 2 | M=0；?=0； |
| D:\Tong\state\b24-closeout-20261012-9a87f321-live3\live-workspace\project | master / 4c0a7c49cc9775a240245008bdc63e0c96792170 | 2 | M=2；?=0； M calculator.py； M tests/test_calculator.py |
| D:\Tong\state\b24-closeout-20261012-live4\live-workspace\project | master / 3fe8d34ca7159bdfded61cd81939b547d6c37f83 | 2 | M=0；?=0； |
| D:\Tong\state\b24-closeout-20261012-live5\live-workspace\project | master / c716aa2ec5509d98dc44e8c7213067c8cee7af4d | 2 | M=1；?=0； M calculator.py |
| D:\Tong\state\b24-closeout-20261012-live6-candidate\live-workspace\project | master / 836c0c2ab575c0a1d983e7cc84cc9bb5c6c40729 | 2 | M=1；?=0； M calculator.py |
| D:\agentdock-poc-20261010\isolated\state\b22-final-regression-1a1e4a54fecf\tong-dock-execution-jt7cHg\project | UNKNOWN / UNKNOWN | UNKNOWN | fatal: not a git repository (or any of the parent directories): .git |
| D:\agentdock-poc-20261010\isolated\state\b24-closeout-20261012-9a87f321\live-workspace\project | master / 46c2c15fb7c99de03ad9fa86716766a635ab8532 | 2 | M=0；?=0； |
| D:\agentdock-poc-20261010\isolated\state\b24-closeout-20261012-9a87f321-live2\live-workspace\project | master / 43239d4b5cc4d808ab01390b414376f69354f4df | 2 | M=0；?=0； |
| D:\agentdock-poc-20261010\isolated\state\b24-closeout-20261012-9a87f321-live3\live-workspace\project | master / 4c0a7c49cc9775a240245008bdc63e0c96792170 | 2 | M=2；?=0； M calculator.py； M tests/test_calculator.py |
| D:\agentdock-poc-20261010\isolated\state\b24-closeout-20261012-live4\live-workspace\project | master / 3fe8d34ca7159bdfded61cd81939b547d6c37f83 | 2 | M=0；?=0； |
| D:\agentdock-poc-20261010\isolated\state\b24-closeout-20261012-live5\live-workspace\project | master / c716aa2ec5509d98dc44e8c7213067c8cee7af4d | 2 | M=1；?=0； M calculator.py |
| D:\agentdock-poc-20261010\isolated\state\b24-closeout-20261012-live6-candidate\live-workspace\project | master / 836c0c2ab575c0a1d983e7cc84cc9bb5c6c40729 | 2 | M=1；?=0； M calculator.py |
| D:\agentdock-poc-20261010\isolated\workspace\b1-project-auyRBB\project | master / bd7c4dfc8cbd5187beceae7554adbc8b98ed59c5 | 2 | M=0；?=0； |
| D:\agentdock-poc-20261010\isolated\workspace\b1-project-b530tu\project | master / 5b1a892b35d3ebb83670cfa2cba81b0ec0a1b63e | 2 | M=1；?=1； M calculator.py；?? new_module.py |
| D:\agentdock-poc-20261010\isolated\workspace\b1-project-eCJEwj\project | master / 9863434472e0267e74c751b2e40a12931ba6094d | 2 | M=1；?=1； M calculator.py；?? new_module.py |
| D:\agentdock-poc-20261010\isolated\workspace\b1-project-hicCjs\project | master / 80de8fcd8621885cdd4e822a482efa6f7f131a90 | 2 | M=1；?=1； M calculator.py；?? new_module.py |
| D:\agentdock-poc-20261010\isolated\workspace\b1-project-V62iB2\project | master / 883f903d0c134da53c7793f50a7348b69a7a775e | 2 | M=1；?=1； M calculator.py；?? new_module.py |
| D:\agentdock-poc-20261010\isolated\workspace\p244-synthetic-0GapOL\project | master / 5a584b1c26ceb0b8f0b77ac9a95b882dfc8f240a | 2 | M=2；?=3； M hello.txt； M test_sample.py；?? "nested/\344\270\255\346\226\207.txt"；?? new.txt；?? patched.txt |
| D:\agentdock-poc-20261010\isolated\workspace\p244-synthetic-7FoL0W\project | main / 9177eeedea0dd86fb2a4f53b1e64b34ec407087c | 2 | M=1；?=3； M hello.txt；?? "nested/\344\270\255\346\226\207.txt"；?? new.txt；?? patched.txt |
| D:\agentdock-poc-20261010\isolated\workspace\p244-synthetic-aLBjYf\project | master / 5258e61eca9148fb5d85e2937e00dff8e990a30a | 2 | M=2；?=3； M hello.txt； M test_sample.py；?? "nested/\344\270\255\346\226\207.txt"；?? new.txt；?? patched.txt |
| D:\agentdock-poc-20261010\isolated\workspace\p244-synthetic-d0J7cS\project | master / 5015667a30e006373da0fad78a064522a76388f8 | 2 | M=1；?=3； M hello.txt；?? "nested/\344\270\255\346\226\207.txt"；?? new.txt；?? patched.txt |
| D:\agentdock-poc-20261010\isolated\workspace\p244-synthetic-emt5QS\project | master / e9a22c5499e200776fc60c911965f2a27a7a5d9e | 2 | M=2；?=3； M hello.txt； M test_sample.py；?? "nested/\344\270\255\346\226\207.txt"；?? new.txt；?? patched.txt |
| D:\agentdock-poc-20261010\isolated\workspace\p244-synthetic-V7pzuv\project | master / 4b94a50ce5b52136f0777167ed287446bec9b275 | 2 | M=2；?=3； M hello.txt； M test_sample.py；?? "nested/\344\270\255\346\226\207.txt"；?? new.txt；?? patched.txt |
| D:\agentdock-poc-20261010\isolated\workspace\p244-synthetic-WryMt7\project | master / f636a0bf5f94bcfccc464873b254bd0c0c603e5b | 2 | M=1；?=3； M hello.txt；?? "nested/\344\270\255\346\226\207.txt"；?? new.txt；?? patched.txt |
| D:\agentdock-poc-20261010\isolated\workspace\p244-synthetic-WWQpJD\project | master / aeddae329e3283a940e6450532c83c5bb3efd84f | 2 | M=0；?=0； |
| D:\agentdock-poc-20261010\isolated\workspace\p244-synthetic-xz3TOs\project | master / d8db53e856b76417015a9fa87ebf74df344b7817 | 2 | M=2；?=3； M hello.txt； M test_sample.py；?? "nested/\344\270\255\346\226\207.txt"；?? new.txt；?? patched.txt |
| D:\agentdock-poc-20261010\synthetic-project | main / 40da52034a8da26a13df7a3b64dd21c5198473a7 | 2 | M=1；?=1501； M calculator.py；?? ".venv/Lib/site-packages/setuptools/command/launcher manifest.xml"；?? ".venv/Lib/site-packages/setuptools/script (dev).tmpl"；?? __pycache__/calculator.cpython-311.pyc；?? __pycache__/test_calculator.cpython-311-pytest-8.4.2.pyc；?? mcp_sample.py |
| D:\tong-agentdock-local\workspace\b23-acceptance | codex/b24-acceptance / 7447688f807b9375639ff3bbc936294a456d670d | 2 | M=1；?=0； M calculator.py |

两个不可识别标记均位于b22-final-regression-1a1e4a54fecf\tong-dock-execution-jt7cHg\project：一个在D:\Tong\state，另一个在旧PoC的isolated\state。这里只记录Git返回结果，未认定它们必然损坏或必然是无用夹具；保留原状。

## 附录 D：Windows任务路径快照

状态为本轮W1观察；均未运行、禁用、删除或改配置。共有27个相关任务，26 Disabled，TongLoginRuntime为Running。Disabled任务的引用仍需在后续退役评审中处理。

| TaskName | State | Execute | WorkingDirectory / script路径 |
| --- | --- | --- | --- |
| Tong024Acceptance-0eb42487-b35a-4f69-b347-289d9f14c612 | Disabled | D:\Tong\state\b23-host-policy-15cc3737-9c3d-4de2-a0b3-4881cedc0207\TongLoginHost.exe | D:\Tong\state\b23-host-policy-15cc3737-9c3d-4de2-a0b3-4881cedc0207 |
| Tong024Acceptance-26fa6cba-eb42-4058-9b3b-ec4d29e25c24 | Disabled | D:\Tong\state\b23-host-policy-52deb3ac-c06b-45f4-baf7-eb97c5ef861d\TongLoginHost.exe | D:\Tong\state\b23-host-policy-52deb3ac-c06b-45f4-baf7-eb97c5ef861d |
| Tong024Acceptance-2a4677a1-d9f0-40bf-abd9-74246cecc582 | Disabled | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\monitor-2a4677a1-d9f0-40bf-abd9-74246cecc582\TongLoginHost.exe | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a |
| Tong024Acceptance-36edd458-3b4b-4221-88a4-99a45630fa1f | Disabled | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\task-diagnostic-ba416ba3-4ee0-41bd-a786-9ccd9a9cb476\TongLoginHost.exe | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\task-diagnostic-ba416ba3-4ee0-41bd-a786-9ccd9a9cb476 |
| Tong024Acceptance-4f7c4df1-6203-45ea-8ea0-62eb93553e47 | Disabled | D:\Tong\state\b23-host-policy-f6291ee4-01b8-40c8-a617-bf5339ec5ca5\TongLoginHost.exe | D:\Tong\state\b23-host-policy-f6291ee4-01b8-40c8-a617-bf5339ec5ca5 |
| Tong024Acceptance-59cce095-cce9-42fd-9bcc-a182575eca04 | Disabled | D:\Tong\state\b23-task-host-59cce095-cce9-42fd-9bcc-a182575eca04\TongLoginHost.exe | D:\Tong\state\b23-task-host-59cce095-cce9-42fd-9bcc-a182575eca04 |
| Tong024Acceptance-63f79c84-c406-4f5d-8aa5-fda606ac9f32 | Disabled | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\monitor-63f79c84-c406-4f5d-8aa5-fda606ac9f32\TongLoginHost.exe | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a |
| Tong024Acceptance-684f4450-884b-4b20-8b57-efd5f3ea12be | Disabled | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\monitor-684f4450-884b-4b20-8b57-efd5f3ea12be\TongLoginHost.exe | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a |
| Tong024Acceptance-6a3d156b-8850-49d0-8b4c-0dea762370b7 | Disabled | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\monitor-6a3d156b-8850-49d0-8b4c-0dea762370b7\TongLoginHost.exe | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a |
| Tong024Acceptance-6b319410-07b4-46d0-b811-0ffe2a8173d7 | Disabled | D:\Tong\state\b23-task-host-6b319410-07b4-46d0-b811-0ffe2a8173d7\TongLoginHost.exe | D:\Tong\state\b23-task-host-6b319410-07b4-46d0-b811-0ffe2a8173d7 |
| Tong024Acceptance-703596ef-c548-4a69-a7e4-5664549c63e7 | Disabled | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\monitor-703596ef-c548-4a69-a7e4-5664549c63e7\TongLoginHost.exe | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a |
| Tong024Acceptance-827449a1-3609-49a4-a06d-633109304aa0 | Disabled | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\task-diagnostic-290813c2-6ccc-4ef5-b659-48819069ef60\TongLoginHost.exe | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\task-diagnostic-290813c2-6ccc-4ef5-b659-48819069ef60 |
| Tong024Acceptance-88ca27ee-e599-4482-b849-7c96923272fb | Disabled | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\monitor-88ca27ee-e599-4482-b849-7c96923272fb\TongLoginHost.exe | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a |
| Tong024Acceptance-89b84737-ae64-4fbd-b06f-dc6495101ed6 | Disabled | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\task-diagnostic-6dc6948c-1148-494a-bad1-feefa7dd325c\TongLoginHost.exe | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\task-diagnostic-6dc6948c-1148-494a-bad1-feefa7dd325c |
| Tong024Acceptance-ca45a917-5ecd-499a-b935-4d6cb7cbe4be | Disabled | D:\Tong\state\b23-host-policy-6d4ad074-2383-4855-85c3-d4e66e799cb2\TongLoginHost.exe | D:\Tong\state\b23-host-policy-6d4ad074-2383-4855-85c3-d4e66e799cb2 |
| Tong024Acceptance-d156b335-674b-4396-b34a-73f99cfb789d | Disabled | C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe | D:\Tong\state\b23-task-policy-d156b335-674b-4396-b34a-73f99cfb789d |
| Tong024Acceptance-daeee3cc-c99e-4f73-b134-7fb8826f4750 | Disabled | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\task-diagnostic-82c7eead-e97a-47e8-9ae9-e083c8025c6c\TongLoginHost.exe | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\task-diagnostic-82c7eead-e97a-47e8-9ae9-e083c8025c6c |
| Tong024StateRepair-5dc9bd7a-3318-43dd-800c-ff0fab62f8ac | Disabled | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\login-management\TongLoginHost.exe | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a |
| Tong024StateRepair-8f88beaf-3e3a-4778-a5fb-e432be394c8b | Disabled | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\login-management\TongLoginHost.exe | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a |
| TongCommProbe-092257f4d10841259644c81b5abfb776 | Disabled | C:\Program Files\PowerShell\7\pwsh.exe | D:\Tong\development\tong-024-startup-recovery；D:\Tong\development\tong-024-startup-recovery\tests\Test-TongDevSpaceWindows.ps1 |
| TongCommProbe-1ebb1630aa71463588e4514c61c04e6a | Disabled | C:\Program Files\PowerShell\7\pwsh.exe | D:\Tong\development\tong-024-startup-recovery；D:\Tong\development\tong-024-startup-recovery\tests\Test-TongDevSpaceWindows.ps1 |
| TongCommProbe-29cc2516036744f6a977a742b5c1b0d3 | Disabled | C:\Program Files\PowerShell\7\pwsh.exe | D:\Tong\development\tong-024-startup-recovery；D:\Tong\development\tong-024-startup-recovery\tests\Test-TongDevSpaceWindows.ps1 |
| TongCommProbe-7758c803fd29465f930960eab1280311 | Disabled | C:\Program Files\PowerShell\7\pwsh.exe | D:\Tong\development\tong-024-startup-recovery；D:\Tong\development\tong-024-startup-recovery\tests\Test-TongDevSpaceWindows.ps1 |
| TongCommRecovery-590f89ef9d19433795543ec10de68085 | Disabled | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\login-management\TongLoginHost.exe | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a |
| TongLoginRuntime | Running | D:\Tong\runtime\login-management\TongLoginHost.exe | D:\Tong\runtime |
| TongNgrokRestore | Disabled | powershell.exe | C:\Users\Rune\AppData\Local\Temp\tong-ngrok-restart.ps1 |
| TongStable1Offline-b1ad6a9b-e098-4bdf-90d5-73655153c109 | Disabled | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\login-management\TongLoginHost.exe | D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a |

服务ngrok：Running/Auto，image=D:\Tong\tools\ngrok\ngrok.exe；服务配置引用C:\Users\Rune\AppData\Local\ngrok\ngrok.yml及D:\Tong\state\ngrok-service.yml。只读提取路径，未读取配置正文。现有服务本身不证明旧TongNgrokRestore任务有效。

## 附录 E：旧绝对路径的限定静态搜索命中

仅列安全scripts/tests语料中的根引用与行号；路径采用当前文件的一基行号。JS/JSON中的双反斜线已归一化，未通过搜索凭据、私有日志或原生会话正文增加覆盖。没有静态命中不能排除手动/外部消费者。

| 文件 | 行号 | 引用的旧根 |
| --- | --- | --- |
| D:\Tong\development\tong-024-startup-recovery\tests\fixtures\TongProductionSwitchSupport.mjs | 11 | D:\agentdock-poc-20261010 |
| D:\Tong\development\tong-024-startup-recovery\tests\Run-TongAgentDockExecutionLive.ps1 | 1 | D:\agentdock-poc-20261010 |
| D:\Tong\development\tong-024-startup-recovery\tests\Run-TongB24Regression.mjs | 8 | D:\agentdock-poc-20261010 |
| D:\Tong\development\tong-024-startup-recovery\tests\Test-TongAgentDockAuditPath.mjs | 5 | D:\agentdock-poc-20261010 |
| D:\Tong\development\tong-024-startup-recovery\tests\Test-TongAgentDockRuntime.mjs | 10 | D:\agentdock-poc-20261010 |
| D:\Tong\development\tong-024-startup-recovery\tests\Test-TongAgentDockRuntime.mjs | 12 | D:\tong-agentdock-local |
| D:\Tong\development\tong-024-startup-recovery\tests\Test-TongB24CloseoutLive.mjs | 16 | D:\agentdock-poc-20261010 |
| D:\Tong\development\tong-024-startup-recovery\tests\Test-TongB24CloseoutLive.mjs | 24 | D:\agentdock-poc-20261010 |
| D:\Tong\development\tong-024-startup-recovery\tests\Test-TongB24CloseoutLive.mjs | 50 | D:\agentdock-poc-20261010 |
| D:\Tong\development\tong-024-startup-recovery\tests\Test-TongB24CloseoutLive.mjs | 99 | D:\tong-agentdock-local |
| D:\Tong\development\tong-024-startup-recovery\tests\Test-TongPreservedRuntimeState.mjs | 6 | D:\agentdock-poc-20261010 |
| D:\Tong\development\tong-024-startup-recovery\tests\Test-TongProductionProfile.mjs | 22 | D:\tong-agentdock-local |
| D:\Tong\development\tong-024-startup-recovery\tests\Test-TongRuntimeAcl.ps1 | 2 | D:\agentdock-poc-20261010 |
| D:\Tong\development\tong-024-startup-recovery\tests\Test-TongRuntimeAcl.ps1 | 52 | D:\agentdock-poc-20261010 |
| D:\Tong\development\tong-024-startup-recovery\tests\Test-TongRuntimeChildEnvironment.mjs | 10 | D:\agentdock-poc-20261010 |
| D:\Tong\development\tong-024-startup-recovery\tests\Test-TongRuntimeRelease.mjs | 10 | D:\agentdock-poc-20261010 |
| D:\Tong\development\tong-024-startup-recovery\tests\Test-TongRuntimeRelease.mjs | 15 | D:\agentdock-poc-20261010 |
| D:\Tong\development\tong-024-startup-recovery\tests\Test-TongRuntimeRelease.mjs | 23 | D:\tong-desktop-control |
| D:\Tong\development\tong-024-startup-recovery\tests\Test-TongRuntimeRelease.mjs | 26 | D:\tong-agentdock-local |
| D:\Tong\development\tong-024-startup-recovery\tests\Test-TongRuntimeRelease.mjs | 34 | D:\tong-desktop-control |
| D:\Tong\development\tong-024-startup-recovery\tests\Test-TongRuntimeSecurity.mjs | 6 | D:\agentdock-poc-20261010 |
| D:\Tong\development\tong-024-startup-recovery\tests\Test-TongRuntimeSecurity.mjs | 10 | D:\agentdock-poc-20261010 |
| D:\Tong\app\tests\fixtures\TongProductionSwitchSupport.mjs | 11 | D:\agentdock-poc-20261010 |
| D:\Tong\app\tests\Run-TongAgentDockExecutionLive.ps1 | 1 | D:\agentdock-poc-20261010 |
| D:\Tong\app\tests\Run-TongB24Regression.mjs | 8 | D:\agentdock-poc-20261010 |
| D:\Tong\app\tests\Test-TongAgentDockAuditPath.mjs | 5 | D:\agentdock-poc-20261010 |
| D:\Tong\app\tests\Test-TongAgentDockRuntime.mjs | 10 | D:\agentdock-poc-20261010 |
| D:\Tong\app\tests\Test-TongAgentDockRuntime.mjs | 12 | D:\tong-agentdock-local |
| D:\Tong\app\tests\Test-TongB24CloseoutLive.mjs | 16 | D:\agentdock-poc-20261010 |
| D:\Tong\app\tests\Test-TongB24CloseoutLive.mjs | 24 | D:\agentdock-poc-20261010 |
| D:\Tong\app\tests\Test-TongB24CloseoutLive.mjs | 50 | D:\agentdock-poc-20261010 |
| D:\Tong\app\tests\Test-TongB24CloseoutLive.mjs | 99 | D:\tong-agentdock-local |
| D:\Tong\app\tests\Test-TongPreservedRuntimeState.mjs | 6 | D:\agentdock-poc-20261010 |
| D:\Tong\app\tests\Test-TongProductionProfile.mjs | 22 | D:\tong-agentdock-local |
| D:\Tong\app\tests\Test-TongRuntimeAcl.ps1 | 2 | D:\agentdock-poc-20261010 |
| D:\Tong\app\tests\Test-TongRuntimeAcl.ps1 | 52 | D:\agentdock-poc-20261010 |
| D:\Tong\app\tests\Test-TongRuntimeChildEnvironment.mjs | 10 | D:\agentdock-poc-20261010 |
| D:\Tong\app\tests\Test-TongRuntimeRelease.mjs | 10 | D:\agentdock-poc-20261010 |
| D:\Tong\app\tests\Test-TongRuntimeRelease.mjs | 15 | D:\agentdock-poc-20261010 |
| D:\Tong\app\tests\Test-TongRuntimeRelease.mjs | 23 | D:\tong-desktop-control |
| D:\Tong\app\tests\Test-TongRuntimeRelease.mjs | 26 | D:\tong-agentdock-local |
| D:\Tong\app\tests\Test-TongRuntimeRelease.mjs | 34 | D:\tong-desktop-control |
| D:\Tong\app\tests\Test-TongRuntimeSecurity.mjs | 6 | D:\agentdock-poc-20261010 |
| D:\Tong\app\tests\Test-TongRuntimeSecurity.mjs | 10 | D:\agentdock-poc-20261010 |
| D:\Tong\runtime\releases\manager\tests\fixtures\TongProductionSwitchSupport.mjs | 11 | D:\agentdock-poc-20261010 |
| D:\Tong\runtime\releases\manager\tests\Run-TongAgentDockExecutionLive.ps1 | 1 | D:\agentdock-poc-20261010 |
| D:\Tong\runtime\releases\manager\tests\Run-TongB24Regression.mjs | 8 | D:\agentdock-poc-20261010 |
| D:\Tong\runtime\releases\manager\tests\Test-TongAgentDockAuditPath.mjs | 5 | D:\agentdock-poc-20261010 |
| D:\Tong\runtime\releases\manager\tests\Test-TongAgentDockRuntime.mjs | 10 | D:\agentdock-poc-20261010 |
| D:\Tong\runtime\releases\manager\tests\Test-TongAgentDockRuntime.mjs | 12 | D:\tong-agentdock-local |
| D:\Tong\runtime\releases\manager\tests\Test-TongB24CloseoutLive.mjs | 16 | D:\agentdock-poc-20261010 |
| D:\Tong\runtime\releases\manager\tests\Test-TongB24CloseoutLive.mjs | 24 | D:\agentdock-poc-20261010 |
| D:\Tong\runtime\releases\manager\tests\Test-TongB24CloseoutLive.mjs | 50 | D:\agentdock-poc-20261010 |
| D:\Tong\runtime\releases\manager\tests\Test-TongB24CloseoutLive.mjs | 99 | D:\tong-agentdock-local |
| D:\Tong\runtime\releases\manager\tests\Test-TongPreservedRuntimeState.mjs | 6 | D:\agentdock-poc-20261010 |
| D:\Tong\runtime\releases\manager\tests\Test-TongProductionProfile.mjs | 22 | D:\tong-agentdock-local |
| D:\Tong\runtime\releases\manager\tests\Test-TongRuntimeAcl.ps1 | 2 | D:\agentdock-poc-20261010 |
| D:\Tong\runtime\releases\manager\tests\Test-TongRuntimeAcl.ps1 | 52 | D:\agentdock-poc-20261010 |
| D:\Tong\runtime\releases\manager\tests\Test-TongRuntimeChildEnvironment.mjs | 10 | D:\agentdock-poc-20261010 |
| D:\Tong\runtime\releases\manager\tests\Test-TongRuntimeRelease.mjs | 10 | D:\agentdock-poc-20261010 |
| D:\Tong\runtime\releases\manager\tests\Test-TongRuntimeRelease.mjs | 15 | D:\agentdock-poc-20261010 |
| D:\Tong\runtime\releases\manager\tests\Test-TongRuntimeRelease.mjs | 23 | D:\tong-desktop-control |
| D:\Tong\runtime\releases\manager\tests\Test-TongRuntimeRelease.mjs | 26 | D:\tong-agentdock-local |
| D:\Tong\runtime\releases\manager\tests\Test-TongRuntimeRelease.mjs | 34 | D:\tong-desktop-control |
| D:\Tong\runtime\releases\manager\tests\Test-TongRuntimeSecurity.mjs | 6 | D:\agentdock-poc-20261010 |
| D:\Tong\runtime\releases\manager\tests\Test-TongRuntimeSecurity.mjs | 10 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\scripts\TongAgentDockRuntime.mjs | 15 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\scripts\TongAgentDockRuntime.mjs | 23 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\scripts\TongAgentDockRuntime.mjs | 30 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\scripts\TongProductionApproval.ps1 | 10 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\scripts\TongProductionProfile.mjs | 8 | D:\tong-agentdock-local |
| D:\tong-desktop-control\scripts\TongProductionProfile.mjs | 9 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\scripts\TongProductionProfile.mjs | 16 | D:\tong-desktop-control |
| D:\tong-desktop-control\scripts\TongProductionProfile.mjs | 17 | D:\tong-desktop-control |
| D:\tong-desktop-control\scripts\TongProductionState.mjs | 12 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\scripts\TongProductionState.ps1 | 59 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\scripts\TongProductionState.ps1 | 73 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\scripts\TongRuntimeBackup.mjs | 8 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\scripts\TongRuntimeGuardian.ps1 | 9 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\scripts\TongRuntimeGuardian.ps1 | 11 | D:\tong-agentdock-local |
| D:\tong-desktop-control\scripts\TongRuntimeGuardian.ps1 | 12 | D:\tong-agentdock-local |
| D:\tong-desktop-control\scripts\TongRuntimeGuardian.ps1 | 15 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\scripts\TongRuntimeLaunch.ps1 | 8 | D:\tong-agentdock-local |
| D:\tong-desktop-control\scripts\TongRuntimeLaunch.ps1 | 9 | D:\tong-agentdock-local |
| D:\tong-desktop-control\scripts\TongRuntimeLaunch.ps1 | 12 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\scripts\TongRuntimeRelease.mjs | 15 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\tests\fixtures\TongProductionSwitchSupport.mjs | 11 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\tests\Run-TongAgentDockExecutionLive.ps1 | 1 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\tests\Run-TongB24Regression.mjs | 8 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\tests\Test-TongAgentDockAuditPath.mjs | 5 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\tests\Test-TongAgentDockRuntime.mjs | 10 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\tests\Test-TongAgentDockRuntime.mjs | 12 | D:\tong-agentdock-local |
| D:\tong-desktop-control\tests\Test-TongB24CloseoutLive.mjs | 16 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\tests\Test-TongB24CloseoutLive.mjs | 24 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\tests\Test-TongB24CloseoutLive.mjs | 50 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\tests\Test-TongB24CloseoutLive.mjs | 99 | D:\tong-agentdock-local |
| D:\tong-desktop-control\tests\Test-TongPreservedRuntimeState.mjs | 6 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\tests\Test-TongProductionProfile.mjs | 13 | D:\tong-agentdock-local |
| D:\tong-desktop-control\tests\Test-TongProductionProfile.mjs | 14 | D:\tong-agentdock-local |
| D:\tong-desktop-control\tests\Test-TongProductionProfile.mjs | 15 | D:\tong-desktop-control |
| D:\tong-desktop-control\tests\Test-TongProductionProfile.mjs | 16 | D:\tong-desktop-control |
| D:\tong-desktop-control\tests\Test-TongProductionProfile.mjs | 22 | D:\tong-agentdock-local |
| D:\tong-desktop-control\tests\Test-TongProductionProfile.mjs | 29 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\tests\Test-TongRuntimeAcl.ps1 | 2 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\tests\Test-TongRuntimeAcl.ps1 | 52 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\tests\Test-TongRuntimeBackup.mjs | 17 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\tests\Test-TongRuntimeChildEnvironment.mjs | 10 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\tests\Test-TongRuntimeRelease.mjs | 10 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\tests\Test-TongRuntimeRelease.mjs | 15 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\tests\Test-TongRuntimeRelease.mjs | 23 | D:\tong-desktop-control |
| D:\tong-desktop-control\tests\Test-TongRuntimeRelease.mjs | 26 | D:\tong-agentdock-local |
| D:\tong-desktop-control\tests\Test-TongRuntimeRelease.mjs | 34 | D:\tong-desktop-control |
| D:\tong-desktop-control\tests\Test-TongRuntimeSecurity.mjs | 6 | D:\agentdock-poc-20261010 |
| D:\tong-desktop-control\tests\Test-TongRuntimeSecurity.mjs | 10 | D:\agentdock-poc-20261010 |

## 附录 F：源码字节比较与候选证据

目标基准固定为D:\Tong\development\tong-024-startup-recovery的初始实际工作树（起始HEAD 3a791ec...，clean）。比较仅涵盖安全scripts/tests/native及package.json、package-lock.json、.gitignore、README.md，排除docs/evidence、配置、node_modules和原始用户文件；因此“源独有0”不表示目录其他材料没有独有内容。

| 源根 | 比较文件数 | 相同 | 不同 | 仅源侧存在 |
| --- | --- | --- | --- | --- |
| D:\tong-desktop-control | 101 | 60 | 41 | 0 |
| D:\Tong\development\tong-desktop-control | 237 | 95 | 125 | 17 |
| D:\Tong\development\tong-launcher-startup-recovery | 237 | 201 | 29 | 7 |
| D:\Tong\development\tong-startup-hotfix | 129 | 96 | 33 | 0 |
| D:\Tong\app | 221 | 207 | 14 | 0 |
| D:\Tong\runtime\releases\manager | 221 | 207 | 14 | 0 |

开发主仓库与launcher的源侧独有安全文件（属于保留材料，不是删除名单）：

**D:\Tong\development\tong-desktop-control**

- `scripts/Apply-B24-Increment.mjs`
- `scripts/Approve-B24-Current.ps1`
- `scripts/Approve-B24-RecoveryWindow.ps1`
- `scripts/Approve-B25-Migration.ps1`
- `scripts/Approve-TongD02.ps1`
- `scripts/Check-B24-ProductionMcp.mjs`
- `scripts/Check-B25-MigrationMcp.mjs`
- `scripts/Inspect-TongD02Approval.mjs`
- `scripts/Install-B24-ManagerRecovery.mjs`
- `scripts/Install-B25-Migration.mjs`
- `scripts/Make-TongRepositoryIndependent.ps1`
- `scripts/Prepare-TongD02Approval.mjs`
- `scripts/Repair-TongMigratedRegistration.mjs`
- `tests/Temporary-NativeCodexLiveAcceptance.mjs`
- `tests/Test-TongApprovalPersistence.ps1`
- `tests/Test-TongCutoverReadiness.ps1`
- `tests/Test-TongLoginManagerProcess.ps1`

**D:\Tong\development\tong-launcher-startup-recovery**

- `scripts/TongControlledRecovery.mjs`
- `tests/Test-TongChildLifecycle.mjs`
- `tests/Test-TongControlledRecovery.mjs`
- `tests/Test-TongControlledRecoveryFiles.mjs`
- `tests/Test-TongCutoverReadiness.ps1`
- `tests/Test-TongLoginManagerProcess.ps1`
- `tests/Test-TongStartupStateRead.mjs`

旧D:\tong-desktop-control与目标在相同相对路径上字节不同的41项：

| 相对文件 | 旧侧SHA-256 | 目标SHA-256 |
| --- | --- | --- |
| scripts/Apply-TongDevSpacePatch.mjs | a4ae6cab4d7d0f3582aaf61cdce3d7d35f16f6f10c58db6390b3133a58dac64b | 7b810c8fbfefb56074f3a827520123b49ff8ae6edbedb0c0713759cb14585691 |
| scripts/TongAgentDockExecution.mjs | 3d0fa98e2a9b3f459e8c21c0f5d0cdd97eb13afa41511cf50a681e4be8d89f4c | 4fbe25fcb00f48c17cd784352cd8838a69318f93a7ff7730d305f934eee00143 |
| scripts/TongAgentDockPolicy.mjs | ec6460f9a239f9fdaa622bd039b8f9f4a9d7f93823a8946467845e51e5aba396 | d00d852e03ef4d4a41541c6ac168d61e74f55a18b2d67fb68f89fd8c874aaa10 |
| scripts/TongAgentDockRuntime.mjs | 3fd0ca37b511968956d20498637a6b41722fc8fbec6d52e6ebd1a0f8e20937d6 | 3025b37c2db5e489f6d606ae26cc4034094908b1156f1a389ed8a66d898a9b90 |
| scripts/TongAgentDockTools.mjs | 4933e5e431c64e1b729c08c574862c01784ab65e55530a03477ff447648398ca | 1b6d580fa7fe748365287e41a8d576a61262d45019192bfc4841a7a5005a1653 |
| scripts/TongAgentTasks.mjs | a5c10648141f03f1f621d37e0acc1dd7a866c0ad1256ba1570edb3aaa5dc27a5 | 9788d5ce267b9a91b11c003a6ed4bde267afd87e45c5389edaeeb6f5a0e2c4aa |
| scripts/TongCodexAppServer.mjs | f3ff729e6751b5e118ace1c18608a72d443d24dd4d370e63bcfb8921dce8f9c2 | 5a5e98c3f3a748d84a44f4e77c53dc291aa945a3802995bc8c14c50bf9c6490a |
| scripts/TongControl.psm1 | eb57d0972a95360d224f0aefde919c50137c288f18341515e948a41201c66b19 | 4b883d79bad33f136990181e66fbe1d01a77533cba8395691ea8547f456f20ca |
| scripts/TongMcpGateway.mjs | b05895ee9021bab9a871e6190ce30371d14353b73e93a6feed227d571fc810a7 | 8eb770493e1e784ee872bc3b3bc868e156bfcb69cf679f5f6ef45e95f5cf413e |
| scripts/TongMcpTools.mjs | d10e2aa520806e9151a1ff63775d4a644761b7d855530b10b394db954e8305cb | 0f5da03c3414a2768dc555718c253a95134b4370f5a7a94485cd9807aa1a70b8 |
| scripts/TongProductionApproval.ps1 | 91b4fb6dd9641784bb47643b073ee702e82b0bae4c07f8ae14354462544aaed8 | edfa756547910362eb3c5041d48373c68cee08ab4d033e00b60a9063770a4c98 |
| scripts/TongProductionProfile.mjs | ed3b758fe171473d4b0ea5e164f0a4280d5bcbbaafc1b3b6463800dd25f64cfb | f1488670258fa3a713c095ec53ac823e933de6321e75a9cc26b5b440c952abb4 |
| scripts/TongProductionState.mjs | c7c782340bb32c489b3fb885964f0bc3bc9be8e4914167255f8ee07433533f7d | 004409a50b10f4ebe1557fa37d827337b2c90b1e1fea1120f5b0582208df2a9a |
| scripts/TongProductionState.ps1 | a282935fa7b98cd38c00648191bd0925446f63d30b960d61605b479b35fec6d6 | 7280eff57cfe7c9ab256f2a7d893c19a000af4df45aee48a89015675c3831860 |
| scripts/TongProjectAccess.mjs | 3a5d66009edecf124f4d3400f000a9fb47f755f2b36ad29e54281979307f67fe | 94e50e6459229413dd5f4b1b166fa964bd5852c2af68f3972d5dc253572cf35a |
| scripts/TongProjects.mjs | 8533d7a7a080381bf52933082cef1403fdd42b22120512ceb3545abb05a4c0bb | e1974c5756cd77feeb8c4c5d64841a1297192a6e6cc899d5e639bb95bf5f46df |
| scripts/TongRuntimeBackup.mjs | dd91394be6dbdc552eb555f0da6584c47af1ec0693fc7850c86c617ddd3277c8 | 330f5e020041d15aca96485420ff1f4bf8d9a126f08a35c47ec85f96fccb6070 |
| scripts/TongRuntimeCandidate.mjs | 11bb2f5fda4a2d24e541c7515a140c86f20e83109691cf25f30ea5626c5b36d7 | b1f420078f76206bb1cd532d5737eeaf8349e49caed41fd331dfb3a65d39b5de |
| scripts/TongRuntimeGuardian.ps1 | b247c0167eef59dc761b8bb14969a6e218f917c3b50e6ceafaccdac844327612 | 03b42832aeb3abaed108cfe4e9e0ef18582d55f62080165b99891c0a5e38e729 |
| scripts/TongRuntimeLaunch.ps1 | 808ff35fa1443a6bc4c3ca47fa8de051e6c6d8dfc8ad65ee62a6907c169a5974 | ce4b8601a0971340156bec99c5727052075108701a0339d4572e1ec2ad39d7b5 |
| scripts/TongRuntimeRelease.mjs | cf6af6bd2bb13e9a3e79800f815198f349566df41f4187495f687debf54dabdc | de1008f0fdf8683dbdad578aba53ced053709f38a9c12d9d711568c8116b0da8 |
| scripts/TongRuntimeSecurity.mjs | 91fa1d475b440e294ece63bde1924c5b4bc51259a8fb531715b6f67a1adb2e8b | b95e4b1e9ebdbecce037ae37da57c2141ae7966202698156980a50e33c425056 |
| scripts/TongRuntimeSecurity.ps1 | b4a0d35020b3f2b02ff0306b1d8aaf2dfdbae10d37784e0e4f1c3d7239fb5194 | ece153f6f04ea4181df6e729fff469e0001ead69f9ea2c9e194ad87ee37c75ee |
| scripts/TongRuntimeServer.mjs | 610c20970d6c4d4524f1b8a77ffaf8f27e8c0361e21308fd3e17634b3c468e99 | 0ba3b5345809ba764f9a061ceac0bd8851dfdfea97f066779401e57295592bc0 |
| scripts/TongSafeFilePath.mjs | 27c556890c76db8340775854d9f1594b37ef8a754f87c43837c0b5d548be5a24 | 9a081c2f879b06de671d59deea6837de5cac0c722b2211093c3d13a1675f43be |
| scripts/TongTrustedCodexBroker.mjs | 75448b8b7a5fa59a93d04052ed131183a8715319d524ccae2ae4771c81adc044 | d9e05fe203ea846fc956863e8d27f38d7a6cde1d8dcdbac6a98ce4be409db159 |
| scripts/TongTrustedControl.mjs | 57ecf8a92d51272982cf4fa800ad334e0597253f1015e4763edebe657ae954b9 | 98c8b20198a5f78a9e0f1c43e110f94b543cf1e3de220f0316b9ac028e80ad3b |
| tests/fixtures/TongProductionSwitchSupport.mjs | 06a9a579db201351f268ce482a2e7baa1e85088066f4bba27988a4f039562ab1 | bf56bda4a0723dbbc9aa6fdd049bd0286dc1a30f97de58af13cc3b07b387049c |
| tests/Test-TongAgentTasks.mjs | 9f5083e3ce531d230a0a706af2ef89ed47d4f741f2073528ec129a8026431484 | 5180dbf508afaaac13def414f790e8eaaf3fd3b0e4e8b335d756294ed32495fa |
| tests/Test-TongB24CloseoutLive.mjs | 02036b1aa7fe55240f78354b125a2a54e090acb4a8d2ed969f4ac89c5af8d7e1 | 34d9d11b85ec764e69a701a49117818d6a617b0af78f53c4ff48f596904d9c06 |
| tests/Test-TongCodexAppServer.mjs | d7d883c8f56236eaf28d13f9ba574ae0db60fd87f35411b3780e6c5c5661cc31 | f21a341155b4c8d311b40c5e3639efab5e0b5dda8cf9bf47593977abc39535c9 |
| tests/Test-TongDevSpaceRegistration.mjs | 30c711902540331fec87993e2e10c04e11b969f229f4d4017ef95c8754c47afd | 980713d4d574a43a84ecc45b9c447fc18c5b9cc4ee98ace56e72cc9cffda3914 |
| tests/Test-TongLocalState.mjs | d31e05990354dee17bdd48bdff5f7437a3ab6de4de47486e1b5e42c78cb3fbf9 | 4fba061364ae659aeddf75b5747135716bbdb6c02d47330a1c85344873b05cf6 |
| tests/Test-TongMcpGateway.mjs | 182702f281ac0ecec8abac7ed00d86eb088b8298155aeb446fe39457a6ac1ddb | 3969ffa918833a327900d22fff98eb65867f29b905fc6114db0e8b95581bce1d |
| tests/Test-TongMcpMetadataTools.mjs | 6f34c4647c86844c3349332ef85419985f92a82e81d683d1ad3b7c7fc97c2c46 | e5207812696f77332e86938b182e4ca1947814ba2912c7b6b0c95cd3a3e2f2b0 |
| tests/Test-TongPredeploymentLive.mjs | 4d7f0035f0c70d6a5c4c5554b2867f02fe699bd57159f7c65975fce29672c72d | a3b21d98ab198cd40ead6b8acbfd088bb0ec62c847d4cf5c5a0feaa16a6f2074 |
| tests/Test-TongProductionProfile.mjs | ac29b6e166b8c9a891a316ca9a21daa8f2390389d6e6d9ba066a2b7403b3c6f5 | 7b37fdc2e7c8bfef4bfd0bb39185119fd32b897808888d5d9574244608090f72 |
| tests/Test-TongProjectAccess.mjs | e5660cdc0eafbc69409e32b915552f982b65d893ac9e464192939d44f213ac82 | 6bfec41ec47ed89acb73c945345d58ba62169ea4dfff8db1619b54299088d467 |
| tests/Test-TongRuntimeBackup.mjs | 1d9ca2661532177eb140d6e69feaf0e69a4dbcc6676111b00d3f4ca1f2b4e88a | 66aec1815680289c18bb11775890b96cf5661be0fb3ec185c372eeba738f4756 |
| tests/Test-TongTrustedTasks.mjs | 9034d0fbdcb699e9f60d613f76c4db3b3f4f05e5b577803cdca60127462f6bbd | 5db69d1b65334d5e4804449c3788732192683dbf924d17a2ff051152ade83213 |
| README.md | d8ee933064133fd7c574c0b573bc47c20ef65ccc17d797904305502d206a001a | fb5ce8052685776d501dd6be2b930016af79cfc40507c09f959892137d9cb5ea |

旧侧与目标相同的34个测试/夹具：

| 相对tests文件 | 字节 | 共同SHA-256 |
| --- | --- | --- |
| tests/fixtures/TongNativeMockWorker.mjs | 8817 | d36e101368581101299a2f51d43cdc82a406d75d05f074dc090790916404b342 |
| tests/fixtures/TongPredeploymentServer.mjs | 2760 | 688490b876df6d72b729db694887b5e2f0d4a49cde07b52c0e1c78a67683f239 |
| tests/fixtures/TongWorkerCanary.mjs | 2565 | 641d1d92669d099dfe438131e74bf486f01007c0bfd73da7ab4dc44e6f57662a |
| tests/Run-TongAgentDockExecutionLive.ps1 | 4103 | 1e6f65646b15f8613317e8e7236a3cc0b728a79db748ab769be699f8ff924165 |
| tests/Run-TongB24Regression.mjs | 2917 | 5dfd2ed62a034e509dc91c971627f20447dc2c7d4cbee6d0de2c8d306ea2d6d8 |
| tests/Run-TongNativeWorkerSupervisor.mjs | 8690 | 112b8adcf27ad4359ca2a4d4cdebe777195c400cf85bf9f91079d57d321dbced |
| tests/Test-TongAgentDock.mjs | 15144 | d8482d0e2caf4d1d0d24d6b4649cadbcacfb75e0f9529d1bbadda0ea222c12dd |
| tests/Test-TongAgentDockAuditPath.mjs | 1065 | 8e94dec8f3484d05c01ed871aaa0ed2a8a0fd5cdd33b018d7cc8888944e33612 |
| tests/Test-TongAgentDockDirectoryMapping.mjs | 4265 | 1e28074359c4598415285ef26e8c9d2aab39ff450ce3266fb3edabf6e7837fa4 |
| tests/Test-TongAgentDockExecution.mjs | 22111 | ac721ebda8f0a7906cc7f200eec92f263323979f3ed7487ba77a87bebbb202b4 |
| tests/Test-TongAgentDockExecutionLive.mjs | 10283 | 867dc89a250a9a88cf23750b961edbbf7998b9a3d0d79bca625663e0440f0664 |
| tests/Test-TongAgentDockLifecycle.mjs | 4479 | d34023a6c8bb0fbe360c24c27e152e7593ff3b66e85eb553062e8bec4a1dd8ab |
| tests/Test-TongAgentDockLive.mjs | 6030 | 7a429f6800d02b4950c0aef35138587cad12967b47419fc7f05d55cb5350382e |
| tests/Test-TongAgentDockReplay.mjs | 4145 | e49e54b534882b8c980c0c3fbeec540509ffc0c0e8617cf68c19dddd013ea710 |
| tests/Test-TongAgentDockRuntime.mjs | 6294 | b14030d4bf65b8ef7ef3f7d6ead79a55c4a14bca6f56c81730d7f949968f817d |
| tests/Test-TongAgentDockSessionCoordination.mjs | 10474 | 072e58ab517831f3e90a7dbf2c381a024266a58ac23814c045caef63c09ab290 |
| tests/Test-TongAgentDockSessionOwnership.mjs | 11423 | 7a4649ed5cda190713fb81c47af50667fd8bc3e0188ac1df08ac3d62b5829d1e |
| tests/Test-TongConfiguration.ps1 | 2666 | 52d163684c6b89cc2b753302816f94dc5567f61dc347025167dcf400fc35a5ad |
| tests/Test-TongEndpoints.ps1 | 16323 | 7f2d207744562959adfbd4580a770a294a259c9e1d551a7d7ed63f280d30060f |
| tests/Test-TongMcpSessionContinuity.mjs | 19716 | 0d696203e266cd3946100ae88b37f6bd9f717e1a706a998af48bff9f79dc5bbe |
| tests/Test-TongNativeWorkerSupervisor.ps1 | 15341 | 1656edcef7c682dfa1a3bff6d5b308fa5d81ec440ee7b16c75fb15bce5b66e37 |
| tests/Test-TongPortListenerArray.ps1 | 776 | 5442835edfbc0c871f3c5b842a6b6138e5de3dec5c345ef94c078de2ea02b8ef |
| tests/Test-TongPreservedRuntimeState.mjs | 2008 | c1339f0c250f5ebbb6a310756cc0b40a537b79d866ac66587c309d35e48d9e62 |
| tests/Test-TongProductionRuntimeGate.mjs | 1573 | 78bbfac0a01793e4efb01424417b879dbbff09f26f4173e0a2fd41529acf21c7 |
| tests/Test-TongProductionSwitch.mjs | 25620 | 3dc591f1f1fef6bb5d26e16f8a78d4a55ca4f9be9bb43004995e752ea3d03beb |
| tests/Test-TongRuntimeAcl.ps1 | 5331 | 18e7dc9bc939f72fcc5f427cd23b90ae021ba7dab12a1dfe3c13bb25520e5fcd |
| tests/Test-TongRuntimeChildEnvironment.mjs | 3322 | 31a89cb63ff31a3c004c56efe6baa87a69f16c40606db13ca0eec5f19322d2fe |
| tests/Test-TongRuntimeChildPreflight.mjs | 1972 | ee57694ae75144e7387262c6e15695e44dbb40e54b4f24a3c9dee2c5c4b9a5c8 |
| tests/Test-TongRuntimeRelease.mjs | 6835 | c90319ad1575ba6baaa66f670ad244ed1820ffe38334ba689278a7b17c936b39 |
| tests/Test-TongRuntimeSecurity.mjs | 2504 | 90652ffbf0941f20d60497ba8c446634152afcedcffebffd2a49e16244dfa90e |
| tests/Test-TongToolBoundaries.mjs | 5171 | 46ad54e5c540c6fe80125582af9aa4356f104bd5bf35a572421e19475a7b6eef |
| tests/Test-TongTrustedCodex.mjs | 6449 | 636b5921062574bfb555f51f585ede8669f1dd1aecdc1ab737676f79460c7a5f |
| tests/Test-TongWorkerCanaries.ps1 | 22490 | ab8def0f21463c6f0ce14c6e1acfed9f3f8b18efc52c7e01e90c4da98a13c0d7 |
| tests/Test-TongWorkerIsolation.mjs | 16058 | 642144e68288c90dd1430b796ae41c59ec6a875f08a18802a152353295015bbe |

相同的源码副本可以在完整旧仓库归档、旧路径引用解决、相应版本可恢复且用户批准后考虑减少；当前工作树里的测试本身并未被判定废弃。

## 附录 G：五根顶层散文件元数据

仅文件名/长度/UTC时间，无正文；生产/授权/ACL记录等原始材料均未修改。

| 根 | 文件 | 字节 | LastWriteTime UTC |
| --- | --- | --- | --- |
| D:\Tong | acl-record-20261013.json | 1083 | 2026-10-12T19:28:13.680Z |
| D:\Tong | execpolicy-smoke.txt | 18 | 2026-10-12T16:06:33.174Z |
| D:\agentdock-poc-20261010 | agentdock_windows_amd64.zip | 29230453 | 2026-10-10T13:33:59.040Z |
| D:\agentdock-poc-20261010 | agentdock_windows_amd64.zip.sha256 | 94 | 2026-10-10T13:33:35.756Z |
| D:\agentdock-poc-20261010 | mcp_acceptance.py | 6523 | 2026-10-10T13:55:28.900Z |
| D:\agentdock-poc-20261010 | mcp_client.py | 3487 | 2026-10-10T13:56:49.722Z |
| D:\agentdock-poc-20261010 | mcp_followup.py | 1677 | 2026-10-10T13:56:11.393Z |
| D:\agentdock-poc-20261010 | P2.4-agentdock-poc-report.md | 28353 | 2026-10-10T14:00:00.832Z |
| D:\agentdock-poc-20261010 | p243-baseline.json | 3789 | 2026-10-10T14:24:25.262Z |
| D:\agentdock-poc-20261010 | p243-regression.json | 4143 | 2026-10-10T14:38:23.795Z |
| D:\agentdock-poc-20261010 | p244-baseline.json | 890 | 2026-10-10T16:15:09.103Z |
| D:\agentdock-poc-20261010 | p244-continuity-diagnostic.stderr.log | 0 | 2026-10-10T16:50:47.258Z |
| D:\agentdock-poc-20261010 | p244-continuity-diagnostic.stdout.log | 864 | 2026-10-10T16:51:13.615Z |
| D:\agentdock-poc-20261010 | p244-regression-native-failure.json | 978 | 2026-10-10T16:50:03.255Z |
| D:\agentdock-poc-20261010 | p244-regression.json | 968 | 2026-10-10T16:54:38.911Z |
| D:\agentdock-poc-20261010 | Run-P243ClientSmoke.ps1 | 3396 | 2026-10-10T14:42:30.034Z |
| D:\agentdock-poc-20261010 | verify_acceptance.py | 4890 | 2026-10-10T13:57:43.814Z |
| D:\tong-agentdock-local | production-root.json | 116 | 2026-10-11T17:56:02.304Z |
| D:\tong-agentdock-local | profile.json | 952 | 2026-10-12T17:00:00.425Z |
| D:\tong-codex-acceptance-20261010 | .gitignore | 38 | 2026-10-10T05:02:37.683Z |
| D:\tong-codex-acceptance-20261010 | calculator.py | 147 | 2026-10-10T05:36:47.863Z |
| D:\tong-codex-acceptance-20261010 | README.md | 33 | 2026-10-10T05:02:37.668Z |
| D:\tong-desktop-control | .gitignore | 722 | 2026-10-11T15:25:37.649Z |
| D:\tong-desktop-control | package-lock.json | 183596 | 2026-10-11T15:25:37.656Z |
| D:\tong-desktop-control | package.json | 340 | 2026-10-11T15:25:37.657Z |
| D:\tong-desktop-control | README.md | 16420 | 2026-10-11T15:25:37.651Z |
| D:\tong-desktop-control | Tong_Desktop_Control_HANDOVER.md | 8814 | 2026-10-08T16:43:07.477Z |
