import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Invoke the real storage functions with synthetic paths, without executing the
// helper's production minting modes or bypassing its interactive console gate.
const root=join('D:\\Tong\\state\\p26-cold-start-20261014','permission-bootstrap-'+randomUUID());
const helper=fileURLToPath(new URL('../scripts/TongProductionApproval.ps1',import.meta.url));
const encoded=value=>Buffer.from(value).toString('base64');
const script=`$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$helper=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded(helper)}'))
$ast=[Management.Automation.Language.Parser]::ParseFile($helper,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Helper parse failed'}
foreach($fn in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$false)){. ([scriptblock]::Create($fn.Extent.Text))}
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowedSids=@($sid,'S-1-5-18','S-1-5-32-544')
$productionRoot=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded(root)}'))
$productionStore=Join-Path $productionRoot 'secrets\\runtime-permissions'
$simulationStore='D:\\Tong\\state\\b23-simulation-approvals'
$stateRoot='D:\\Tong\\state'
Select-Store $productionRoot
$refused=$false;try{Ensure-Store}catch{$refused=$true}
if(-not $refused -or (Test-Path -LiteralPath $productionRoot)){throw 'Ordinary signing must not create runtime parents'}
Ensure-Store $true
if(-not (Test-Path -LiteralPath $productionStore)){throw 'Typed init bootstrap did not create the store'}
$marker=Join-Path $productionRoot 'production-root.json'
$known=Get-Content -LiteralPath $marker -Raw|ConvertFrom-Json
if($known.mode -cne 'production' -or $known.root -cne $productionRoot){throw 'Bootstrap marker scope changed'}
$markerHash=(Get-FileHash -LiteralPath $marker).Hash
$originalAcl=(Get-Acl -LiteralPath $productionRoot).Sddl
Ensure-Store $true
if((Get-FileHash -LiteralPath $marker).Hash -cne $markerHash -or (Get-Acl -LiteralPath $productionRoot).Sddl -cne $originalAcl){throw 'Existing root or marker was overwritten'}
$unknownRoot=$productionRoot+'-unknown'
New-ProtectedRoot $unknownRoot
[IO.File]::WriteAllText((Join-Path $unknownRoot 'retain.txt'),'retain')
$productionRoot=$unknownRoot;$productionStore=Join-Path $productionRoot 'secrets\\runtime-permissions';Select-Store $productionRoot
$refused=$false;try{Ensure-Store $true}catch{$refused=$true}
if(-not $refused -or (Test-Path -LiteralPath (Join-Path $unknownRoot 'secrets'))){throw 'Unknown nonempty root must not be initialized'}
if([IO.File]::ReadAllText((Join-Path $unknownRoot 'retain.txt')) -cne 'retain'){throw 'Unknown file changed'}
[pscustomobject]@{passed=$true;newRootBootstrap=$true;ordinarySigningReadonly=$true;existingAclAndMarkerPreserved=$true;unknownRootRejected=$true;root='${root.replaceAll("'","''")}'}|ConvertTo-Json -Compress
`;
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toUpperCase()!=='PSMODULEPATH'));
const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{env,encoding:'utf8',windowsHide:true,timeout:10000});
assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
console.log(result.stdout.trim());
