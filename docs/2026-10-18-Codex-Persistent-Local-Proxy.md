# Codex 本地代理持久化与升级准备（2026-10-18）

## 实测结论

同一开发候选 32ecd291b0dfa721030c7ee64caea305db148372 下两轮真实验证：
- Baseline 无显式HTTP(S)代理：119.228s / 4次重连，121.414s / 4次重连。
- 显式本地代理 `http://127.0.0.1:7897`：9.457s / 0次重连，9.000s / 0次重连。
- 平均运行时间 120.321s vs 9.229s，节省约92.3%，样本每组2轮；不能推导未来所有网络下的表现。
- 两边都在Windows本机运行Codex App Server，远程模型推理不在本机；代理组仅改变子进程的HTTP(S)请求经本机代理端口转发，未改变系统网络配置。
- 真实取消→原生同会话恢复已成功，原生ID保持不变。

## 从环境变量到持久化授权配置

原来的 `TONG_CODEX_PROXY_URL` 只在本机交互测试入口通过进程环境设置。正式Tong有独立运行的后台进程与环境白名单，不能保证临时PowerShell环境变量进入后台，所以**不能直接视为正式部署**。

现新增 `TongTrustedPolicy.codexProxyUrl`，原有文件缺字段保持兼容。只接受显式无账号密码的loopback HTTP(S)代理（127.0.0.1、localhost、[::1]，必须明确端口）；配置值经过现有受控策略文件的原子写入/验证，下一次创建的Codex App Server子进程读取该字段并构造独立的 `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` 环境。没有将上游代理配置暴露给Codex Desktop、Windows系统或其他程序。关闭则为null，阻止继承残留的临时TONG_CODEX_PROXY_URL环境变量；缺字段时仍兼容旧隔离测试模式。

下一次正式更新并经过用户最终部署授权后，可由用户在PowerShell 7本机交互运行（需要显示本机审批）：

```powershell
& 'D:\node\node.exe' 'D:\Tong\app\scripts\TongTrustedControl.mjs' --state-dir 'D:\Tong\app\runtime' proxy set 'http://127.0.0.1:7897'
```

可用下面命令撤销（同样需要本机确认）：

```powershell
& 'D:\node\node.exe' 'D:\Tong\app\scripts\TongTrustedControl.mjs' --state-dir 'D:\Tong\app\runtime' proxy off
```

使用 `status` 验证字段 `codexProxyUrl`；如果代理程序未运行，Codex可能无法访问远程模型，应关闭代理设置或先恢复本机代理监听。新配置仅作用于新建的Codex子进程，不中断当前会话执行。

## 发布要求

上一轮候选32ecd29独立保存，保持真实验收证据。新功能必须由一个更新的精确Git提交重新打包、分别离线还原App与Manager并运行跨组件集成，不能修改旧候选原地混用哈希。

正式运行的App/Manager最后确认均为bb234ec794c1d8180586781c92601f2eae95e750，旧部署脚本绑定的是更早版本，不能复用。接下来的升级和回滚脚本必须绑定这个bb234ec旧版本和新候选的确切哈希、源码清单、现有pin/profile及新的回滚快照，先校验后停止服务。当前未部署、未修改生产权限、会话或系统代理。禁止在没有用户明确批准和完整可回滚准备前操作生产切换。
