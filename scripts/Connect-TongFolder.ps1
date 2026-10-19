param(
  [string]$Folder = 'D:\\作业',
  [switch]$ChooseFolder,
  [switch]$AllowGitPush,
  [switch]$Revoke
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){throw 'Tong folder onboarding requires Windows'}
if($ChooseFolder){
  Add-Type -AssemblyName System.Windows.Forms
  $dialog=[System.Windows.Forms.FolderBrowserDialog]::new()
  $dialog.Description='选择以后可由ChatGPT通过Tong直接开发的项目文件夹'
  $dialog.SelectedPath=$Folder
  if($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK){
    Write-Host '未作更改';return
  }
  $Folder=$dialog.SelectedPath
}
if(!(Test-Path -LiteralPath $Folder -PathType Container)){throw '请选择已有文件夹'}
$full=[IO.Path]::GetFullPath($Folder)
$script=Join-Path $PSScriptRoot 'TongTrustedControl.mjs'
$state='D:\Tong\app\runtime'
$node='D:\node\node.exe'
if(!(Test-Path -LiteralPath $script -PathType Leaf) -or
   !(Test-Path -LiteralPath $node -PathType Leaf) -or
   !(Test-Path -LiteralPath (Join-Path $state 'trusted-codex.json') -PathType Leaf)){
  throw 'Tong受信项目管理器尚未安装或未就绪，请先完成Tong升级'
}
Write-Host ''
Write-Host ('目标文件夹：'+$full)
Write-Host '只需首次本机确认；以后这个文件夹内的普通开发由ChatGPT和Tong自动调度。'
Write-Host '生产部署、系统配置和重要数据删除不包含在此授权内。'
$commandArgs=@($script,'--state-dir',$state)
if($Revoke){$commandArgs+=@('untrust-folder',$full)}
else {
  $commandArgs+=@('trust-folder',$full,'--git-commit')
  if($AllowGitPush){$commandArgs+='--git-push'}
}
& $node @commandArgs
if($LASTEXITCODE -ne 0){throw '没有建立或撤销文件夹信任；原状态保持不变'}
Write-Host '已处理本次文件夹授权；以后直接告诉ChatGPT项目路径和任务即可。'
