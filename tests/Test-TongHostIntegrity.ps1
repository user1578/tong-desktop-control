# Reproduce the production chmod failure with the same DACL, medium state and
# a low-integrity Host. Change only the synthetic Host's mandatory label.
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
if($PSVersionTable.PSVersion.Major -ne 7){throw 'PS7_REQUIRED'}
$root='D:\Tong\state\comm-chmod-'+[guid]::NewGuid().ToString('N')
$null=[IO.Directory]::CreateDirectory($root)
$state=Join-Path $root 'state';$bridge=Join-Path $root 'login-management'
foreach($p in @($state,$bridge)){$null=[IO.Directory]::CreateDirectory($p);Set-Acl -LiteralPath $p -AclObject (Get-Acl -LiteralPath 'C:\Users\Rune\.local\share\devspace')}
. (Join-Path $PSScriptRoot 'fixtures\TongWindowsAccessSnapshot.ps1') -StateDirectory $state|Out-Null
$hostSource='D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a\monitor-88ca27ee-e599-4482-b849-7c96923272fb\TongLoginHost.exe'
$hostPath=Join-Path $bridge 'TongLoginHost.exe'
if((Get-FileHash -LiteralPath $hostSource).Hash.ToLowerInvariant() -cne '28d5db5e41d7ea079550d04377f383dc858dd126f57ce9a1b1f51cea00d33718'){throw 'HOST_CHANGED'}
[IO.File]::Copy($hostSource,$hostPath,$false)
& icacls.exe $state /setintegritylevel '(OI)(CI)M' | Out-Null
if($LASTEXITCODE -ne 0){throw 'TEST_STATE_LABEL_FAILED'}
& icacls.exe $hostPath /setintegritylevel L | Out-Null
if($LASTEXITCODE -ne 0){throw 'TEST_HOST_LOW_LABEL_FAILED'}
$hash=(Get-FileHash -LiteralPath $hostPath).Hash
$dacl=(Get-Acl -LiteralPath $hostPath).Sddl
$nodeCode=@'
import {writeFile,readFile,access} from 'node:fs/promises';
import {join} from 'node:path';import {setTimeout as delay} from 'node:timers/promises';
const [state,root,phase]=process.argv.slice(2);
await writeFile(join(root,'pid-'+phase+'.json'),JSON.stringify({pid:process.pid}));
const deadline=Date.now()+10000;
while(true){try{await access(join(root,'go-'+phase));break;}catch(e){if(e.code!=='ENOENT')throw e;if(Date.now()>deadline)throw Error('OBSERVER_TIMEOUT');await delay(50);}}
const {openDatabase}=await import('file:///D:/Tong/app/node_modules/@waishnav/devspace/dist/db/client.js');
let result;
try{const db=openDatabase(state);try{db.sqlite.exec('CREATE TABLE IF NOT EXISTS probe(value TEXT)');db.sqlite.prepare('INSERT INTO probe(value) VALUES(?)').run('synthetic');result={ok:true,rows:db.sqlite.prepare('SELECT COUNT(*) AS n FROM probe').get().n,wal:db.sqlite.pragma('journal_mode',{simple:true})};}finally{db.close();}}
catch(e){result={ok:false,code:e.code,syscall:e.syscall,stack:e.stack};process.exitCode=1;}
await writeFile(join(root,'result-'+phase+'.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
'@
[IO.File]::WriteAllText((Join-Path $root 'worker.mjs'),$nodeCode)
$runner=@'
param($Mode)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
$phase=([IO.File]::ReadAllText((Join-Path $root 'phase.json'))|ConvertFrom-Json).phase
& D:\node\node.exe (Join-Path $root 'worker.mjs') (Join-Path $root 'state') $root $phase
exit $LASTEXITCODE
'@
[IO.File]::WriteAllText((Join-Path $bridge 'TongLoginRuntime.ps1'),$runner)
$results=@()
foreach($phase in @('low','medium-first','medium-second')){
 if($phase -eq 'medium-first'){
  $beforeLabel=[TongAccessSnapshot]::Label($hostPath)
  $denied=$false
  try{& (Join-Path $PSScriptRoot '..\scripts\Set-TongLoginHostIntegrity.ps1') -Path $hostPath -ExpectedSha256 ('0'*64)|Out-Null}catch{if($_.Exception.Message -notmatch 'HOST_HASH_MISMATCH'){throw};$denied=$true}
  if(-not $denied -or [TongAccessSnapshot]::Label($hostPath) -cne $beforeLabel){throw 'WRONG_HASH_NOT_REFUSED'}
  & (Join-Path $PSScriptRoot '..\scripts\Set-TongLoginHostIntegrity.ps1') -Path $hostPath -ExpectedSha256 $hash.ToLowerInvariant() | Out-Null
  & (Join-Path $PSScriptRoot '..\scripts\Set-TongLoginHostIntegrity.ps1') -Path $hostPath -ExpectedSha256 $hash.ToLowerInvariant() -VerifyOnly | Out-Null
 }
 [IO.File]::WriteAllText((Join-Path $root 'phase.json'),(@{phase=$phase}|ConvertTo-Json))
 # Task Scheduler launches the executable directly. Use that same process
 # creation mode; a shell launch involves unrelated Explorer/COM behavior.
 $process=[Diagnostics.Process]::new();$process.StartInfo.FileName=$hostPath
 $process.StartInfo.UseShellExecute=$false;$process.StartInfo.CreateNoWindow=$true
 if(-not $process.Start()){throw 'HOST_START_FAILED'}
 $null=$process.Handle
 $deadline=[DateTime]::UtcNow.AddSeconds(8);$pidFile=Join-Path $root ('pid-'+$phase+'.json')
 while(-not (Test-Path -LiteralPath $pidFile) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 50}
 if(-not (Test-Path -LiteralPath $pidFile)){throw 'NODE_NOT_OBSERVED'}
 $nodePid=([IO.File]::ReadAllText($pidFile)|ConvertFrom-Json).pid
 $token=[TongAccessSnapshot]::Process($nodePid)
 [IO.File]::WriteAllText((Join-Path $root ('token-'+$phase+'.json')),($token|ConvertTo-Json))
 [IO.File]::WriteAllText((Join-Path $root ('go-'+$phase)),'continue')
 if(-not $process.WaitForExit(15000)){throw 'HOST_EXIT_TIMEOUT'}
 $result=Get-Content -LiteralPath (Join-Path $root ('result-'+$phase+'.json')) -Raw|ConvertFrom-Json
 if($phase -eq 'low'){
  if($token.integritySid -cne 'S-1-16-4096' -or $result.ok -or $result.code -cne 'EPERM' -or $result.syscall -cne 'chmod' -or $process.ExitCode -ne 1){throw 'LOW_FAILURE_NOT_REPRODUCED'}
  if(Test-Path -LiteralPath (Join-Path $state 'devspace.sqlite')){throw 'DATABASE_OPENED_BEFORE_FAILURE'}
 }else{
  $expected=if($phase -eq 'medium-first'){1}else{2}
  if($token.integritySid -cne 'S-1-16-8192' -or -not $result.ok -or $result.rows -ne $expected -or $result.wal -cne 'wal' -or $process.ExitCode -ne 0){throw 'MEDIUM_FIX_FAILED'}
 }
 $results+=@{phase=$phase;integrity=$token.integritySid;exitCode=$process.ExitCode;result=$result}
}
if((Get-FileHash -LiteralPath $hostPath).Hash -cne $hash -or (Get-Acl -LiteralPath $hostPath).Sddl -cne $dacl){throw 'HOST_BYTES_OR_DACL_CHANGED'}
$copyDir=Join-Path $root 'copy-target';$null=[IO.Directory]::CreateDirectory($copyDir)
$copy=Join-Path $copyDir 'TongLoginHost.exe';[IO.File]::Copy($hostPath,$copy,$false)
$denied=$false
try{& (Join-Path $PSScriptRoot '..\scripts\Set-TongLoginHostIntegrity.ps1') -Path $copy -ExpectedSha256 $hash -VerifyOnly | Out-Null}catch{if($_.Exception.Message -notmatch 'HOST_MEDIUM_INTEGRITY_REQUIRED'){throw};$denied=$true}
if(-not $denied){throw 'DESTINATION_LOW_INHERITANCE_NOT_DETECTED'}
& (Join-Path $PSScriptRoot '..\scripts\Set-TongLoginHostIntegrity.ps1') -Path $copy -ExpectedSha256 $hash | Out-Null
$links=Join-Path $root 'hardlinks';$null=[IO.Directory]::CreateDirectory($links)
$hard=Join-Path $links 'TongLoginHost.exe';$null=New-Item -ItemType HardLink -Path $hard -Target $copy
$denied=$false
try{& (Join-Path $PSScriptRoot '..\scripts\Set-TongLoginHostIntegrity.ps1') -Path $hard -ExpectedSha256 $hash | Out-Null}catch{if($_.Exception.Message -notmatch 'REGULAR_SINGLE_LINK_HOST_REQUIRED'){throw};$denied=$true}
if(-not $denied){throw 'HARDLINK_NOT_REFUSED'}
$junction=Join-Path $root 'bridge-junction';$null=New-Item -ItemType Junction -Path $junction -Target $bridge
$denied=$false
try{& (Join-Path $PSScriptRoot '..\scripts\Set-TongLoginHostIntegrity.ps1') -Path (Join-Path $junction 'TongLoginHost.exe') -ExpectedSha256 $hash | Out-Null}catch{if($_.Exception.Message -notmatch 'REPARSE_DENIED'){throw};$denied=$true}
if(-not $denied){throw 'JUNCTION_NOT_REFUSED'}
# Interrupted installation must restore the original low label by restoring
# that physical file, rather than modifying the original's security metadata.
$rollbackDir=Join-Path $root 'rollback';$null=[IO.Directory]::CreateDirectory($rollbackDir)
$rollbackHost=Join-Path $rollbackDir 'TongLoginHost.exe';[IO.File]::Copy($hostPath,$rollbackHost,$false)
$oldLabel=[TongAccessSnapshot]::Label($rollbackHost)
$oldDacl=(Get-Acl -LiteralPath $rollbackHost).Sddl
$oldId=& D:\node\node.exe -e "console.log(require('node:fs').statSync(process.argv[1],{bigint:true}).ino.toString())" $rollbackHost
if($LASTEXITCODE -ne 0 -or $oldLabel -notmatch ';;;LW\)'){throw 'ROLLBACK_ORIGINAL_NOT_LOW'}
$physicalOriginal=Join-Path $rollbackDir 'original-host.exe';[IO.File]::Move($rollbackHost,$physicalOriginal)
[IO.File]::Copy($hostPath,$rollbackHost,$false)
& (Join-Path $PSScriptRoot '..\scripts\Set-TongLoginHostIntegrity.ps1') -Path $rollbackHost -ExpectedSha256 $hash | Out-Null
[IO.File]::Move($rollbackHost,(Join-Path $rollbackDir 'failed-install-host.exe'))
[IO.File]::Move($physicalOriginal,$rollbackHost)
$restoredId=& D:\node\node.exe -e "console.log(require('node:fs').statSync(process.argv[1],{bigint:true}).ino.toString())" $rollbackHost
if($LASTEXITCODE -ne 0 -or $oldId -cne $restoredId -or [TongAccessSnapshot]::Label($rollbackHost) -cne $oldLabel -or (Get-Acl -LiteralPath $rollbackHost).Sddl -cne $oldDacl -or (Get-FileHash -LiteralPath $rollbackHost).Hash -cne $hash){throw 'HOST_PHYSICAL_ROLLBACK_FAILED'}
$outcome=@{passed=$true;root=$root;stateLabel=[TongAccessSnapshot]::Label($state);hostLabel=[TongAccessSnapshot]::Label($hostPath);hostBytesAndDaclUnchanged=$true;wrongHashRejected=$true;hardlinkAndJunctionRejected=$true;destinationInheritanceChecked=$true;physicalRollbackPreservesOriginalLabel=$true;results=$results;productionChanged=$false}
[IO.File]::WriteAllText((Join-Path $root 'host-integrity-outcome.json'),($outcome|ConvertTo-Json -Depth 8))
$outcome|ConvertTo-Json -Depth 8 -Compress
