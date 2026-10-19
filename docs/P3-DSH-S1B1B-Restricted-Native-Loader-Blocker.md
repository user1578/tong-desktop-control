# Tong P3 — DSH-S1-B1B Windows 受限原生启动诊断（2026-10-20）

**状态：受限原生进程加载未通过；S1-B1B 尚未验收，禁止真实 DSH SDK 启动或模型调用。**

## 目标与范围

在已通过的 S1-B0 Job Object 进程树清理、S1-B1A `CreateRestrictedToken + AccessCheck` ACL 断言之上，验证固定模拟子进程能否用**同一个受限 Windows token**在 Windows Job Object 内启动并实际读取/拒绝读取指定的临时文件。

**结果是受限启动失败，不能据此批准下一阶段真实SDK调用。** 本阶段没有改动生产 Tong、DSH Desktop、系统DLL或用户现有目录的ACL。

## 实际诊断与对照

新增诊断程序：
- `tests/TongDshS1B1BNativeChild.c`：MinGW GCC 编译的极小 Win32 原生程序，只读取测试目录中的 `allowed.txt`、`private.txt`，并记录三位测试布尔值至 `result.txt`。不依赖.NET、不接受任意执行命令。
- `tests/TongDshS1B1BNativeLaunch.cs`：固定启动器，使用 `CreateRestrictedToken`、`CreateProcessAsUser`（权限不足时仅尝试 `CreateProcessWithToken`，不回退普通进程）、`CREATE_SUSPENDED`、`AssignProcessToJobObject`、`ResumeThread`，并在执行前核对子进程 token 是否受限。
- `tests/Test-TongDshS1B1BNativeLaunch.ps1`：PowerShell 7 独立临时编译/诊断脚本。可选 `-UseDriveRoot` 将测试目录临时放在当前磁盘根目录下，以排除 Tong Runtime Temp 的父目录ACL差异。所有生成文件在finally清理；不操作任何现有文件ACL。

本机实际结果：

| 对照条件 | 结果 |
| --- | --- |
| 同一固定原生子进程，去掉额外限制SID（只保留权限削减） | **可正常加载并执行**；不具有文件隔离，**不是安全验收通过** |
| 附加内置 `BUILTIN\\Users` 限制SID，从`D:\Tong\runtime\temp`启动 | 子进程在入口前退出，`0xC0000022`，`result.txt=000` |
| 使用当前磁盘根目录下随机测试目录（`-UseDriveRoot`），保持相同限制SID | 仍返回 `0xC0000022`，`result.txt=000` |
| GCC 静态链接但仍依赖系统UCRT API-set | 原生受限启动仍失败 |
| 指定GCC `-mcrtdll=msvcrt`改为MSVCRT | **同样失败** |
| Windows Job Object独立模拟测试 | S1-B0已通过；本轮受限子进程没进入主函数，不能验收两者整体联合运行 |

只读核查 ACL 发现 `D:\Tong`、`D:\Tong\runtime`、`D:\Tong\runtime\temp`没有内置Users读取ACE，而磁盘根有相应读取/遍历权限。更改测试目录后仍失败，所以这一差异不是唯一根因。没有给原目录添加用户/Users权限。

**不要把本轮失败归咎于单一DLL或声明为Windows环境无法支持受限进程**：当前只能准确定位到有额外限制SID时的加载/进程初始化失败。还需Windows加载器、受限token访问系统共享资源、传入环境块、动态依赖和Win32创建语义的针对性证据。此模拟限制SID为系统内置 `BUILTIN\\Users`，即使未来能够加载，也**不能**直接作为生产级文件隔离，因为它允许读取已对Users开放的其他文件。

## 复现边界

仅在本机现有 `gcc.exe` 与 Windows .NET Framework C# 编译器可用时，手工运行：

```powershell
pwsh -NoProfile -File .\tests\Test-TongDshS1B1BNativeLaunch.ps1 -UseDriveRoot
```

**目前预期这条命令返回非零退出码**；不应该放入要求通过的CI步骤，不能把不安全的降级方案改成“通过”。

正常基线对照会打印“native child loaded; private ACL isolation is NOT proven”，而安全测试会按当前实测在受限加载失败时保持拒绝。脚本明确不启动DSH，不调用模型；其他 Windows 本机Job Object/AccessCheck测试及跨平台JS合成测试与此阻塞彼此独立。

## 下一道门槛（S1-B1C）

1. 在不修改用户和系统现有ACL的前提下，只读校验**受限token**对真实子进程映像、父目录、DLL与加载依赖的 `AccessCheck` 结果，捕获第一处失败的安全对象；不要擅自修改系统DLL DACL或增加Everyone/Users通用访问权。
2. 如现有 `CreateRestrictedToken`限制SID方案与实际DSH运行时依赖冲突，研究独立的低权限身份/AppContainer受信执行链；只在独立测试状态下验证，不能复用Codex生产Profile、SID和Manager授权。
3. 确认可信执行器能够用固定哈希映像、受限身份、完整Job Object及非用户私有测试目录联合运行，并实测**允许访问授权文件、拒绝访问其他文件**、网络访问策略和任务取消。若无法做到，继续保持DSH真实执行禁止。
4. 联合运行完成后才考虑 S1-B2 的**不调用模型的SDK初始化**与工具拒绝检查；最后才由用户在PowerShell 7明确确认可能计费的一次S2真实文本调用。

**B1B已取得明确、可复现的阻塞证据，尚未达到可启用DSH模型或生产集成的完成标准。**
