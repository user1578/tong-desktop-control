# Tong 快速信任文件夹与自动接入项目（开发分支）

目标：用户只说“让 Codex 在 D:\作业\26ict\TravelGuard 开发”，无须记项目 ID、复杂授权命令或重复发送提示词。

## 计划中的使用流程

1. 完成生产适配部署后，用户双击 scripts/Connect-TongFolder.cmd，选择 D:\作业 或其他项目父目录，第一次在本机确认一次。
2. 此后 ChatGPT 在任务开始前调用 tong_project_prepare：位于预先信任范围内的项目自动注册、补齐 agent.execute、可信Codex项目Grant和持久开发授权，并交给 tong_agent_start 启动Codex原生会话。
3. 普通开发不用再次确认；高影响操作仍单独确认。未经本机信任的其他文件夹明确返回 folder-needs-local-trust，而不是根据聊天文字静默扩权。
4. 可以继续信任新的父目录，长期复用同样的流程；不自动扫描整个盘符或批量注册项目，只处理用户明确指定的项目。

## 本轮开发产物

- TongTrustedPolicy.trustRoot/untrustRoot：受信目录记录，包含真实路径、grantId和能力。禁止直接信任盘符根及包含策略状态的目录；取消目录信任时撤销相关继承授权。
- TongQuickProject.prepareTrustedProject：已注册项目补齐权限，新项目自动注册并持久授权；重复调用不重新授权；未知目录、目录链接与授权项目不匹配时拒绝。
- tong_project_prepare MCP：仅为本机预先确认的目录自动准备项目，不提供聊天直接签发新目录信任的接口。
- TongTrustedControl trust-folder/untrust-folder/prepare-folder：目录信任必须由本机交互式用户确认，非交互方式不能伪造。
- Connect-TongFolder.cmd/Connect-TongFolder.ps1：双击选择文件夹，再进行一次本机确认；不要求手写命令、项目ID或授权码。

Git提交可在首次授权时纳入；Git推送需明确选择额外权限。已有的生产部署、系统设置、重要数据删除和越项目操作仍不在普通开发授权内。

## 边界和下一步

这是开发分支，尚未部署生产Tong。旧Manager不具备新 tong_project_prepare 工具，D:\作业 也尚未实际写入生产受信策略。
部署新Manager、将其注册到当前MCP连接、真实测试Codex Desktop会话可见/续聊之前，不得宣称已投入使用。
项目自动登记跨进程并发冲突仍需由部署阶段的持久排他锁或任务序列化处理；不能用测试通过推导完全进程安全。
本机普通用户可信执行不是对抗恶意本地代码的OS安全沙箱。大范围授权会扩大普通开发的可写范围。

合成回归：node --test tests/Test-TongQuickProject.mjs
