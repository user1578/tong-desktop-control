param(
  [Parameter(Mandatory)][ValidatePattern('^[a-z][a-z0-9-]{1,39}$')][string]$ProjectId,
  [Parameter(Mandatory)][ValidateSet('success','failed','cancelled','waiting_user_action')][string]$TaskStatus
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Self-contained local completion card. This is a Windows desktop overlay,
# not a notification-center toast and not a new ChatGPT message.
if (-not [Environment]::UserInteractive) { throw 'No interactive desktop session' }

$messages = @{
  success = 'Codex 任务完成，可以查看结果。'
  failed = 'Codex 任务失败，请在 ChatGPT 查看日志。'
  cancelled = 'Codex 任务已取消。'
  waiting_user_action = 'Codex 等待操作，请在 ChatGPT 查看详情。'
}
$form = [System.Windows.Forms.Form]::new()
$timer = [System.Windows.Forms.Timer]::new()
try {
  $form.Text = 'Tong 任务提醒'
  $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow
  $form.ShowInTaskbar = $false
  $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
  $form.TopMost = $true
  $form.ClientSize = [System.Drawing.Size]::new(370, 90)
  $form.BackColor = [System.Drawing.Color]::FromArgb(35, 39, 46)
  $form.ForeColor = [System.Drawing.Color]::White
  $area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $form.Location = [System.Drawing.Point]::new($area.Right - $form.Width - 20, $area.Bottom - $form.Height - 20)

  $label = [System.Windows.Forms.Label]::new()
  $label.AutoSize = $false
  $label.Location = [System.Drawing.Point]::new(15, 10)
  $label.Size = [System.Drawing.Size]::new(345, 25)
  $label.Font = [System.Drawing.Font]::new('Microsoft YaHei UI', 10, [System.Drawing.FontStyle]::Bold)
  $label.ForeColor = [System.Drawing.Color]::White
  $label.Text = 'Tong · ' + $ProjectId

  $detail = [System.Windows.Forms.Label]::new()
  $detail.AutoSize = $false
  $detail.Location = [System.Drawing.Point]::new(15, 43)
  $detail.Size = [System.Drawing.Size]::new(345, 35)
  $detail.Font = [System.Drawing.Font]::new('Microsoft YaHei UI', 9)
  $detail.ForeColor = [System.Drawing.Color]::Gainsboro
  $detail.Text = $messages[$TaskStatus]
  $form.Controls.Add($label)
  $form.Controls.Add($detail)
  $form.Add_Click({ $form.Close() })
  $label.Add_Click({ $form.Close() })
  $detail.Add_Click({ $form.Close() })

  $timer.Interval = 45000
  $timer.Add_Tick({ $timer.Stop(); $form.Close() })
  $form.Add_Shown({ $timer.Start() })
  [void]$form.ShowDialog()
} finally {
  $timer.Stop()
  $timer.Dispose()
  $form.Dispose()
}
