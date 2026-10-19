# Tong P3 · DSH-S1-B1A 受限令牌ACL与模拟授权验收（2026-10-20）

**状态：只读/合成验证通过；DSH受限进程启动仍阻塞，生产集成与真实模型均未启用。**

## 与S1-B0的关联

上阶段在Windows通过真实Job Object四项固定模拟进程回收检查（正常、取消、超时、子进程树）。它能终止进程，但不限制进程运行期间能够读取的文件或网络。本阶段独立验证受限访问令牌和Windows ACL的交互，并构建一份只对模拟任务有效的DSH专属授权信封；**没有把现有Codex Supervisor授权转换成DSH授权**。

## 1. 真实Windows令牌/ACL测试

新增 `tests/TongDshS1B1TokenCanary.cs` 和 `tests/Test-TongDshS1B1TokenCanary.ps1`，使用Windows Framework64现有C#编译器，编译产物和带ACL的测试文件放在独立、随机命名临时目录，结束即清理。

测试程序直接调用Win32：
- `OpenProcessToken` 和 `CreateRestrictedToken` 创建Windows受限令牌；
- `DuplicateToken` 得到所需的模拟身份；
- `AccessCheck` 对刚创建的两个测试文件DACL进行实际Windows授权判定。

测试**限制SID是BUILTIN\\Users（S-1-5-32-545）**，而非每任务独立的生产SID。此SID只用于验证“主令牌与限制SID必须同时满足DACL”的机制。

本机实际通过的断言：
1. 原普通令牌能访问只授予用户/System/管理员读取权限的私有文件。
2. 受限令牌不能通过上述私有文件的ACL访问检查。
3. 受限令牌能通过明确向测试用Users SID授予读取权限的文件访问检查。
4. 临时私有文件再添加Users读取ACE后，受限令牌也重新具备访问权。

**第四项尤其重要：Users限制SID不能提供跨用户文件隔离；大量现有文件已经允许Users读取。此测试只证明Windows双重ACL机制，不证明生产隐私防护。**

### 已知未解决问题

在本机尝试通过 `CreateProcessAsUser` / 受限令牌启动临时.NET模拟EXE时，子进程加载阶段即返回 `0xC0000022`，没有进入测试入口。先后尝试了Restricted Code SID和内置Users SID，结果一致。因此停止受限进程启动尝试，**没有修改Windows、.NET Framework、系统可执行文件或现有用户目录ACL**。修正了测试代码误读SACL引起的`PrivilegeNotHeldException`后，独立`AccessCheck`测试才通过。

尚需设计针对DSH真实依赖链的受限进程启动（包括DLL读取/身份、工作区ACL），并在Windows隔离模拟环境验证；不能把当前AccessCheck结果与上阶段Job Object结果相加，宣称生产沙箱已经完成。

## 2. DSH专属模拟授权签名

新增 `scripts/TongDshS1B1SyntheticGrant.mjs` 和 `tests/Test-TongDshS1B1SyntheticGrant.mjs`。

- 使用HMAC-SHA256和显式注入的随机密钥（测试使用固定假密钥），签名用途固定 `tong-dsh-s1b1-mock-task-v1`。
- 绑定 `projectId`、`taskId`、Windows项目根、Scope、Prompt、Session模式/ID与超时。
- 最长60秒有效、禁止未来签发时间、提供同进程一次性Nonce消费与重放拒绝、错误仅返回固定类别。
- 篡改、换项目、换会话、超时不一致、签名错误、过期、重放均触发拒绝。
- **明确 `syntheticOnly:true`、`mayStartDsh:false`、`mayCallModel:false`**。不读取登录凭据、不签发Tong生产授权、不调用SDK。

注意：`consumedNonces`是测试中注入的内存集合，**不是跨进程或重启持久化的反重放机制**。真正的授权签发需受信Signer、不可修改的文件身份/进程SID、持久消费状态和跨实例锁。

## 3. 验收与安全边界

本地：PowerShell受限令牌ACL canary通过；HMAC范围及篡改测试通过；现有Job Object canary与其它回归保持独立。Github Windows Runner继续运行固定本地原生测试，Windows/Ubuntu执行Node模拟测试。

以下**未完成，不得假称通过**：

- 受限Windows令牌驱动的真实子进程启动、完整依赖加载、Windows用户文件读写隔离；
- 真实网络隔离、端点白名单及身份认证；
- Windows Job Object和受限令牌组合为同一个真实DSH执行器；
- 独立DSH_HOME的SDK服务实际启动与JSON-RPC会话恢复；
- 生产Manager授权及受信审批、持久Nonce、远程取消IPC、崩溃恢复；
- DSH模型调用、费用确认、Desktop窗口可见及可续聊。

**下一步S1-B1B门槛**：为DSH建立受信的独立原生测试启动器（Windows受限身份或AppContainer、固定可执行Hash、完整进程树Job Object及私有目录ACL），通过最小可执行程序真实访问拒绝测试；确认网络权限与进程依赖后才考虑无模型SDK启动预检。当前生产Tong保持在 `a1b56b3666651c3648327f05e0ea4154284645c3`。
