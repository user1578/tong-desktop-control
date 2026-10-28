# Read-only COM registration inspection. Never instantiate a COM handler.
function Convert-CleanupCodeBasePath([string]$Value){
    $uri=$null
    if($Value.StartsWith('file:',[StringComparison]::OrdinalIgnoreCase)){
        if(-not [Uri]::TryCreate($Value,[UriKind]::Absolute,[ref]$uri) -or -not $uri.IsFile -or $uri.Query -or $uri.Fragment){throw 'COM_CODEBASE_UNRESOLVED'}
        return [IO.Path]::GetFullPath($uri.LocalPath)
    }
    if(-not [IO.Path]::IsPathFullyQualified($Value)){throw 'COM_CODEBASE_UNRESOLVED'}
    return [IO.Path]::GetFullPath($Value)
}
function Convert-CleanupServerPath([string]$Value,[bool]$CommandLine=$false){
    if(@([regex]::Matches($Value,'%([^%]+)%')|Where-Object {$_.Groups[1].Value -notin @('SystemRoot','windir','SystemDrive','ProgramFiles','ProgramFiles(x86)','CommonProgramFiles','CommonProgramFiles(x86)')}).Count){throw 'COM_PATH_UNRESOLVED'}
    $path=[Environment]::ExpandEnvironmentVariables($Value).Trim()
    if($path -match '%[^%]+%'){throw 'COM_PATH_UNRESOLVED'}
    if($CommandLine){
        if($path.StartsWith('"')){if($path -notmatch '^"([^"]+)"(?:\s|$)'){throw 'COM_PATH_UNRESOLVED'};$path=$Matches[1]}
        else{if($path -notmatch '^(\S+\.exe)(?:\s|$)'){throw 'COM_PATH_UNRESOLVED'};$path=$Matches[1]}
    }else{
        if($path.StartsWith('"')){if($path -notmatch '^"([^"]+)"$'){throw 'COM_PATH_UNRESOLVED'};$path=$Matches[1]}
    }
    if(-not [IO.Path]::IsPathFullyQualified($path)){throw 'COM_PATH_UNRESOLVED'}
    return [IO.Path]::GetFullPath($path)
}
function Get-CleanupRegistryRecord([Microsoft.Win32.RegistryHive]$Hive,[Microsoft.Win32.RegistryView]$View,[string]$Key){
    $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($Hive,$View)
    try{
        $item=$base.OpenSubKey($Key,$false)
        if($null -eq $item){return $null}
        try{
            $values=@{}
            foreach($name in @('','AppID','LocalService','DllSurrogate','CodeBase','ServerId','Executable','Arguments','DllPath','ImagePath','ServiceDll')){
                $value=$item.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
                if($null -ne $value){$values[$name]=$value}
            }
            return [pscustomobject]@{values=$values;keys=@($item.GetSubKeyNames())}
        }finally{$item.Dispose()}
    }finally{$base.Dispose()}
}
function Get-CleanupPackageRoot([string]$Package){
    if(-not ('TongCleanupPackagePath' -as [type])){
        Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class TongCleanupPackagePath {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]
 static extern int GetStagedPackagePathByFullName(string name,ref uint length,StringBuilder path);
 public static string Read(string name) {
  uint length=0;int code=GetStagedPackagePathByFullName(name,ref length,null);
  if(code==15601 || code==1168) return null; // Package is not staged.
  if(code!=122 || length==0 || length>32768) throw new InvalidOperationException("PACKAGE_PATH_UNAVAILABLE");
  var path=new StringBuilder((int)length);code=GetStagedPackagePathByFullName(name,ref length,path);
  if(code!=0) throw new InvalidOperationException("PACKAGE_PATH_UNAVAILABLE");return path.ToString();
 }
}
'@
    }
    return [TongCleanupPackagePath]::Read($Package)
}
function Read-CleanupComRecord($Hive,$View,[string]$Key,[ref]$Unresolved){
    try{return Get-CleanupRegistryRecord $Hive $View $Key}catch{$Unresolved.Value=$true;return $null}
}
function Get-CleanupComPaths([string]$ClassId,[string[]]$Visited=@()){
    $id=([guid]::Parse($ClassId)).ToString('B')
    if($Visited -contains $id -or $Visited.Count -ge 8){throw 'COM_REDIRECT_UNRESOLVED'}
    $visitedNext=@($Visited)+$id
    $paths=[Collections.Generic.List[string]]::new();$registered=$false;$activeRegistrations=0;$missingPackages=0;$unresolved=$false;$fatal=$false
    foreach($hive in @([Microsoft.Win32.RegistryHive]::LocalMachine,[Microsoft.Win32.RegistryHive]::CurrentUser)){
        foreach($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)){
            try{
            $prefix='Software\Classes\CLSID\'+$id
            $cls=Read-CleanupComRecord $hive $view $prefix ([ref]$unresolved)
            if($null -ne $cls){
                $registered=$true;$activeRegistrations++;$serverFound=$false
                foreach($server in @('InprocServer32','InprocHandler32','LocalServer32')){
                    $record=Read-CleanupComRecord $hive $view ($prefix+'\'+$server) ([ref]$unresolved)
                    if($null -eq $record){continue}
                    if(-not $record.values.ContainsKey('') -or [string]::IsNullOrWhiteSpace([string]$record.values[''])){$unresolved=$true}
                    $paths.Add([string]$record.values[''])
                    try{$paths.Add((Convert-CleanupServerPath ([string]$record.values['']) ($server -eq 'LocalServer32')))}catch{$unresolved=$true}
                    if($server -ne 'InprocHandler32'){$serverFound=$true}
                    if($record.values.ContainsKey('CodeBase')){try{$paths.Add((Convert-CleanupCodeBasePath ([string]$record.values['CodeBase'])))}catch{$unresolved=$true}}
                    foreach($version in $record.keys){
                        $versionRecord=Read-CleanupComRecord $hive $view ($prefix+'\'+$server+'\'+$version) ([ref]$unresolved)
                        if($null -ne $versionRecord -and $versionRecord.values.ContainsKey('CodeBase')){try{$paths.Add((Convert-CleanupCodeBasePath ([string]$versionRecord.values['CodeBase'])))}catch{$unresolved=$true}}
                    }
                }
                if($cls.values.ContainsKey('AppID')){
                    try{
                    $appId=([guid]::Parse([string]$cls.values['AppID'])).ToString('B')
                    $app=Read-CleanupComRecord $hive $view ('Software\Classes\AppID\'+$appId) ([ref]$unresolved)
                    if($null -ne $app){
                        if($app.values.ContainsKey('DllSurrogate') -and [string]$app.values['DllSurrogate']){$paths.Add([string]$app.values['DllSurrogate']);try{$paths.Add((Convert-CleanupServerPath ([string]$app.values['DllSurrogate'])))}catch{$unresolved=$true}}
                        if($app.values.ContainsKey('LocalService')){
                            $service=[string]$app.values['LocalService'];if($service -notmatch '^[A-Za-z0-9_. -]{1,256}$'){throw 'COM_SERVICE_UNRESOLVED'}
                            $serviceKey='SYSTEM\CurrentControlSet\Services\'+$service
                            $image=Read-CleanupComRecord LocalMachine Registry64 $serviceKey ([ref]$unresolved)
                            if($null -eq $image -or -not $image.values.ContainsKey('ImagePath')){$unresolved=$true}else{
                                $paths.Add([string]$image.values['ImagePath']);try{$paths.Add((Convert-CleanupServerPath ([string]$image.values['ImagePath']) $true))}catch{$unresolved=$true};$serverFound=$true
                            }
                            $parameters=Read-CleanupComRecord LocalMachine Registry64 ($serviceKey+'\Parameters') ([ref]$unresolved)
                            if($null -ne $parameters -and $parameters.values.ContainsKey('ServiceDll')){$paths.Add([string]$parameters.values['ServiceDll']);try{$paths.Add((Convert-CleanupServerPath ([string]$parameters.values['ServiceDll'])))}catch{$unresolved=$true}}
                        }
                    }
                    }catch{$unresolved=$true}
                }
                if($cls.keys -contains 'TreatAs'){
                    try{
                    $redirect=Read-CleanupComRecord $hive $view ($prefix+'\TreatAs') ([ref]$unresolved)
                    if($null -eq $redirect -or -not $redirect.values.ContainsKey('')){throw 'COM_REDIRECT_UNRESOLVED'}
                    $redirected=Get-CleanupComPaths ([string]$redirect.values['']) $visitedNext
                    if(-not $redirected.registered){throw 'COM_REDIRECT_UNRESOLVED'}
                    if($redirected.unresolved){$unresolved=$true}
                    if($redirected.fatal){$fatal=$true}
                    foreach($path in $redirected.paths){$paths.Add($path)};$serverFound=$true
                    }catch{$unresolved=$true}
                }
                if(-not $serverFound){$unresolved=$true}
            }
            $index=Read-CleanupComRecord $hive $view ('Software\Classes\PackagedCom\ClassIndex\'+$id) ([ref]$unresolved)
            if($null -ne $index){
                $registered=$true;if($index.keys.Count -eq 0 -or $index.keys.Count -gt 64){$unresolved=$true;continue}
                foreach($package in $index.keys){
                    $packageRoot=$null;$knownUnstaged=$false
                    try{$packageRoot=Get-CleanupPackageRoot $package;$knownUnstaged=-not $packageRoot}catch{$unresolved=$true}
                    if($packageRoot){$activeRegistrations++}elseif($knownUnstaged){$missingPackages++}
                    $packageKey='Software\Classes\PackagedCom\Package\'+$package
                    $packaged=Read-CleanupComRecord $hive $view ($packageKey+'\Class\'+$id) ([ref]$unresolved)
                    $server=$null
                    if($null -eq $packaged -or -not $packaged.values.ContainsKey('ServerId')){if(-not $knownUnstaged){$unresolved=$true}}else{
                        $serverId=[string]$packaged.values['ServerId']
                        if($serverId -notmatch '^[A-Za-z0-9_.-]{1,128}$'){$unresolved=$true}else{$server=Read-CleanupComRecord $hive $view ($packageKey+'\Server\'+$serverId) ([ref]$unresolved)}
                    }
                    if(($null -eq $server -or -not $server.values.ContainsKey('Executable')) -and -not $knownUnstaged){$unresolved=$true}
                    foreach($record in @($packaged,$server)){
                        if($null -eq $record){continue}
                        foreach($field in @('Executable','DllPath')){if($record.values.ContainsKey($field)){
                            $path=[string]$record.values[$field];$paths.Add($path)
                            if(-not [IO.Path]::IsPathRooted($path)){if(-not $packageRoot){if(-not $knownUnstaged){$unresolved=$true};continue};$path=Join-Path $packageRoot $path}
                            try{$paths.Add((Convert-CleanupServerPath $path))}catch{$unresolved=$true}
                        }}
                        if($record.values.ContainsKey('Arguments')){$paths.Add([string]$record.values['Arguments'])}
                    }
                }
            }
            }catch{$unresolved=$true;$fatal=$true}
        }
    }
    if(-not $registered -or $activeRegistrations -eq 0 -or $paths.Count -eq 0){$unresolved=$true}
    return [pscustomobject]@{registered=$registered;paths=@($paths.ToArray()|Sort-Object -Unique);missingPackages=$missingPackages;unresolved=$unresolved;fatal=$fatal}
}
