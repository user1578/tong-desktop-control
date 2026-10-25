# 原版2号：启动协议最小候选与隔离验证

结论：已验证诊断补充和启动协议候选的有限隔离行为；**生产首因仍为 UNKNOWN，生产未启动，候选尚不可直接部署。** 本轮未修改生产 App/Manager、Task、ngrok、事故控制文件、真实业务数据或真实授权凭据。

## 已证实事实与尚未证实的假设

基于已推送的 `e909cc583c8a7be946b358d609271ba3aa0ee64d`：旧运行清理检查通过，新请求 `be3f5c49-d824-4edd-b8fc-7ee70d7f9a00` 的启动异常收尾未取得完整证明，最终返回 CLEANUP_REQUIRED。request→START_ABORT 相隔 15,015ms；启动总期限为120秒。该关联符合固定15秒 Launcher 等待被触发的假设，但历史证据没有 Launcher 精确身份、真实退出码、stderr 或首个异常，不能据此排除提前退出、输出解析或身份确认失败。

原版2号生产专用 `preflight-login` 在本轮隔离根中实际执行并通过，Launcher 实测8.400秒；此前同条件另一次有效观察为8.565秒。这没有复现自然超过15秒的生产预检，也不能排除真实生产在更大文件清单、23项原生资产、冷缓存或其他环境条件下耗时不同。隔离清单仅含 scripts，native 清单为空；没有读取或复制生产凭据和业务配置。

## 原版2号与历史34e2680的比较

| 项目 | 原版2号 `024d5b0` | `34e2680` 中复用的方案 |
|---|---|---|
| Launcher 等待 | 固定15秒，与120秒请求期限分离；超时终止 Launcher | 共用请求的有限截止时间；超时先写本次 abort，给所有者有限清理时间 |
| 生产预检 | 只在正式根调用 `preflight-login` 或 `preflight-production`；普通 simulation 跳过 | 保留该预检，放入创建时即绑定的私有 Job，持续检查请求、abort、期限 |
| 原生身份与包含关系 | Launcher 只回传 Guardian PID；Supervisor 创建后再 AssignJob | PID+exe+creation ticks；Guardian 接管所有权，Supervisor 在 CreateProcess 时进入 Job |
| 清理回执 | 缺少本次 Launcher 终态；只能等待 Guardian 或已知身份消失 | 本次角色回执、创建边界、精确身份消失、四类 Job 均空；缺失、矛盾、迟到均拒绝释放锁 |
| 异常输出 | stderr 丢弃；清理 complete=false 覆盖首个错误 | 保留 Manager 首个错误、阶段、角色和清理证明；本轮补 Launcher 时长、退出码及有限脱敏 stderr、预检时长/身份/Job 状态 |

本轮对现有开发代码只新增诊断与针对性测试，没有改变总启动上限、清理预算、原生授权或文件验证。stderr 最多在内存中保留前4096字节，公开输出只允许已有固定拒绝语句，其他内容丢弃。原生预检的 Node stderr 仍被原有协议送往 NUL，**不能声称已捕获其完整底层异常**。预检首个结构化错误在 finally 清理之前保存；后续清理异常不能替换该字段，CLEANUP_REQUIRED 仍作为安全拒绝返回。

## 本轮实际验证

生产专用分支测试使用私有 Launcher 副本，仅重定位正式根/Supervisor 固定路径，并在创建 Guardian 前强制结束。实际 Node `preflight-login`、双组件绑定、ACL、合成 DPAPI 授权校验照常执行；没有用普通 simulation 的“跳过预检”路径冒充验证。原版/精简候选的 Supervisor 源码和候选 pin 未插入绕过验证的开关。

| 精简候选用例 | Launcher 实测 | 预检结果 | 收尾 |
|---|---:|---|---|
| 有效合成授权 | 9.430秒 | exit0，通过 | 测试边界退出2，未创建 Guardian |
| 错误合成 grantId | 1.753秒 | exit1，APPROVAL_DENIED | 未创建 Guardian |
| 受控慢路径 | 18.231秒 | exit0，通过 | 同上；含**明确注入的9秒 Node loader 延迟**，不是历史生产耗时 |
| 3.5秒请求期限 | 3.666秒 | START_TIMEOUT，退出码未作为自然退出观察到 | 私有预检 Job 清理完成 |

四例均验证精确预检子进程身份已消失，owner/Launcher预检/Guardian预检/Runtime 四类 Job 为0。退出2是受控测试边界或拒绝结果，不代表服务启动成功。原始有限元数据回执见 `receipts/`，指标和证据局限见 `VALIDATION.json`。

独立只读审查发现 Guardian 同样需要优先选择其嵌套的首次预检错误。已用失败用例复现并修正，Launcher/Guardian 后续不同异常单独写入 `secondaryFailure`，清理安全门槛不变。最终 Manager 回归通过；修正后重跑一次真实预检，Launcher 为9.220秒，通过，五份公开回执中 `final-valid.json` 对应最终源码。该隔离 Manager 七项文件字节均与候选清单一致。

另实际运行：当前与精简候选的 Manager 编排回归（虚拟时钟，不能当原生耗时证据）；精简候选 PS5.1 下预检慢路径/期限/abort/所有者退出/未知清理拒绝；CreateProcess 返回边界丢失所有者的三类原子 Job 测试；Guardian 接管退出37和编译器后代句柄测试。Node语法、PS7/PS5.1解析及隔离补丁精确哈希检查通过。测试入口使用与原版固定启动入口一致的 `-ExecutionPolicy Bypass` 进程参数，没有修改系统执行策略或UAC。

## 精确补丁范围与复核方式

`candidate-vs-original-v2.patch` 以 `024d5b0920d9ad8f1a2baf2e55640a5666ad4739` 为基线，仅涉及七个启动依赖文件。`CANDIDATE-MANIFEST.json` 给出原始/候选 SHA256。组装规则在 `tests/fixtures/TongMinimalStartupCandidate.mjs`：复用 `34e26801876d8b1a2fc874dddce72b0939924e87` 的七文件闭合依赖，补本轮诊断；不带入 LegacyRecovery、Handoff、LifecycleFreeze、RuntimePort 或整个开发分支。候选已在隔离原版源码子集中实际应用并核对七项最终字节哈希。

复核应从原版2号 Git 源码副本开始，不对生产目录运行 git apply。补丁规定 UTF-8无BOM、LF；本机 Git 默认 autocrlf=true 会改变字节。隔离复核应用时使用 `git -c core.autocrlf=false apply --check <patch>`，再以同参数应用并核对清单；不得仅比较语义后忽略 pin 所绑定的实际字节。仅套用源码不会产生有效新发布 pin 或原生授权。

重现候选预检：`D:\node\node.exe tests/Test-TongProductionPreflight.mjs --minimal-candidate`。只重现指定用例可加 `--cases=minimal-slow,minimal-timeout`。它会创建新的私有测试根和合成授权，不操作正式授权。Manager 回归使用 `tests/Test-TongLauncherBudget.mjs --minimal-candidate`。本轮复用现有依赖的只读 junction，没有安装依赖、复制整套 node_modules 或重做全量备份；所有隔离现场保留。

## 剩余缺口及未来回退边界

1. 历史首因仍缺原始 Launcher 退出和预检错误证据；本轮没有追溯补造这些证据。生产15秒假设保持未证实。
2. 没有完整生产清单、真实授权及相同磁盘状态下的等价耗时，也没有端到端 READY/doctor 验证。不能把上述结果称为生产恢复。
3. 新协议严格拒绝缺失原子 containment 标记的旧 Guardian，以及没有本次终态回执的旧失败请求。不得给旧记录补写这些字段；旧现场的受控交接仍是独立事项。直接把补丁覆盖到当前生产会遇到该门禁和版本授权绑定，故本候选为审查材料，**非可直接部署版本**。
4. 最小后续工作是独立复核七文件差异、完整清单预检覆盖和旧状态交接的兼容边界。只有这些通过并另获生产窗口授权后，才能准备真实绑定的候选与受控尝试；本轮不执行。

未来获批安装的回退必须在封闭维护窗口内进行：保留精确旧 App/Manager 源码、旧双pin/profile、授权绑定及控制物理原件；候选失败后先验证本次 Launcher/Guardian/Supervisor及后代身份消失、四类 Job 为0、端口空闲，再保留候选事故原件并恢复已验证旧代码/绑定和既定旧状态。新协议文件若旧版不存在，只能按获批冲突处理清单保留隔离，不能盲删。任何未知身份或清理证明不足时保持关闭状态，不强行恢复 Task、不借旧终态证明新尝试、不覆盖数据库、不修改原始事故记录。回退本身不能保证旧版立即 READY，必须如实验收。

公开资料只包含代码补丁、元数据和合成测试回执；合成授权密文、真实授权、原始 stderr、私密配置、数据库均未上传。生产仍沿用上轮失败收尾后的状态；本轮没有重新检查 Task/ngrok/doctor 的实时状态，也没有声称其当前健康。
