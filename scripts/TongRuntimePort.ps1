param([Parameter(Mandatory)][ValidateRange(1,65535)][int]$Port)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$probe=$null
try{
 $listeners=@(Get-NetTCPConnection -State Listen -ErrorAction Stop|Where-Object LocalPort -eq $Port)
 if($listeners.Count -ne 0){throw 'PORT_OCCUPIED'}
 $probe=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Any,$Port)
 $probe.Server.ExclusiveAddressUse=$true
 $timer=[Diagnostics.Stopwatch]::StartNew();$probe.Start();$probe.Stop()
 @{port=$Port;free=$true;method='Windows-listener-table-and-SO_EXCLUSIVEADDRUSE';bindMs=$timer.ElapsedMilliseconds}|ConvertTo-Json -Compress
}catch{$code=if($_.Exception.Message -ceq 'PORT_OCCUPIED'){'PORT_OCCUPIED'}else{'PORT_CHECK_FAILED'};@{port=$Port;error=$code}|ConvertTo-Json -Compress;exit 2}
finally{if($null -ne $probe){$probe.Stop()}}
