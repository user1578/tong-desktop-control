param(
  [Parameter(Mandatory)][ValidatePattern('^[a-z][a-z0-9-]{1,39}$')][string]$ProjectId,
  [Parameter(Mandatory)][ValidateSet('success','failed','cancelled','waiting_user_action')][string]$TaskStatus
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$messages=@{
  success='Codex 已完成任务，请打开 Codex Desktop 查看结果。'
  failed='Codex 任务失败，请返回 ChatGPT 查看日志。'
  cancelled='Codex 任务已取消。'
  waiting_user_action='Codex 需要你处理，请返回 ChatGPT 查看状态。'
}
$icon=[System.Windows.Forms.NotifyIcon]::new()
try {
  $icon.Icon=[System.Drawing.SystemIcons]::Information
  $icon.Visible=$true
  $icon.BalloonTipTitle=('Tong · '+$ProjectId)
  $icon.BalloonTipText=$messages[$TaskStatus]
  $icon.BalloonTipIcon=[System.Windows.Forms.ToolTipIcon]::Info
  $icon.ShowBalloonTip(5000)
  Start-Sleep -Seconds 5
} finally {
  $icon.Visible=$false
  $icon.Dispose()
}
