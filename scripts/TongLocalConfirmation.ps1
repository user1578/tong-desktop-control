param([Parameter(Mandatory)][string]$DescriptorBase64)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
try {
    # Only real console input is accepted. Piped chat text/APPROVE strings and
    # redirected stdin cannot approve anything. No automatic/default accept.
    if([Console]::IsInputRedirected -or [Console]::IsOutputRedirected){throw '本人须在本地交互式终端确认；管道或重定向不能授权。'}
    $d=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($DescriptorBase64))|ConvertFrom-Json
    foreach($key in @('action','targets','scope','risk','recovery','duration')){
        if(-not $d.PSObject.Properties[$key] -or $d.$key -isnot [string] -or $d.$key.Length -gt 24000){throw 'Invalid confirmation descriptor'}
        $d.$key=[regex]::Replace($d.$key,'[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]','')
    }
    [Console]::WriteLine("`nTong 本地授权确认")
    [Console]::WriteLine('1. 允许操作：'+$d.action)
    [Console]::WriteLine('2. 影响对象：'+$d.targets)
    [Console]::WriteLine('3. 授权范围：'+$d.scope)
    [Console]::WriteLine('4. 最坏影响：'+$d.risk+'；恢复方式：'+$d.recovery)
    [Console]::WriteLine('5. 持续时间：'+$d.duration)
    [Console]::Write('本人批准请按 Y；其他按键取消：')
    $key=[Console]::ReadKey($true)
    [Console]::WriteLine()
    if($key.Key -ne [ConsoleKey]::Y){exit 2}
    exit 0
}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}
