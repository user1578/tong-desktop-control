# 原版2号生产启动失败：公开复审资料

本包记录的是**真实生产启动失败及安全回退**，不是恢复成功证明。整理日期为 2026-10-26（Asia/Tokyo）；目录日期沿用事故的 UTC 日期 2026-10-25。

- 先读 [DIAGNOSIS.md](DIAGNOSIS.md)：事实、时间线、运行身份和回退结果。
- 再读 [CLEANUP-ANALYSIS.md](CLEANUP-ANALYSIS.md)：两个 `CLEANUP_REQUIRED` 分支及证据缺口。
- [FILE-INVENTORY.json](FILE-INVENTORY.json) / [CSV](FILE-INVENTORY.csv)：77个原始文件的路径、大小、原始 SHA256、公开副本和排除原因。其中维护窗口文件61个，补充关联文件16个。
- [REDACTION.md](REDACTION.md)：脱敏规则、未公开内容及证据限制。
- [SOURCE-BINDINGS.json](source/SOURCE-BINDINGS.json)：生产字节与双 pin、精确 Git 版本的比对。
- [维护结束记录](public/window/maintenance.closed.failure.json)、[新 request](public/window/failed-attempt/run/request.json)、[START_ABORT](public/window/failed-attempt/run/abort.json)、[登录运行日志](public/window/failed-attempt/log-data/login-management.jsonl)。

结论：旧运行检查已经通过；最终拒绝发生在**新启动异常的收尾阶段**。可确定新运行的清理证明未被 Manager 接受，尚不能确定 Launcher 最初为何失败。不得把约15秒的时间吻合写成已经证实的超时根因。

所有生产原件留在原位置。本轮只读收集原始证据，只在本项目此目录写入脱敏资料；未执行生产模块、未启动 Tong、未操作锁、Task 或 ngrok。源码 `.txt` 是复审材料，不是可执行恢复脚本。

原始摘要针对本机原始字节；公开副本已脱敏或筛选，摘要通常不同。每个副本的摘要见清单；全包文件摘要见 `SHA256SUMS.txt`。检查结果见 `PUBLISH-VERIFICATION.json`。
