# User-approved exception for unresolved COM implementations of protected
# SYSTEM Windows tasks. It does not suppress any known path reference.
function Get-CleanupTaskPathSecurity([string]$Path){
    $item=Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    $acl=Get-Acl -LiteralPath $Path -ErrorAction Stop
    $writeMask=[Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
    $writers=@(foreach($rule in $acl.Access){
        if($rule.AccessControlType -eq 'Allow' -and -not ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -and ($rule.FileSystemRights -band $writeMask)){
            $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
        }
    })
    $mutationMask=[Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
    $mutators=@(foreach($rule in $acl.Access){
        if($rule.AccessControlType -eq 'Allow' -and -not ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -and ($rule.FileSystemRights -band $mutationMask)){
            $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
        }
    })
    return [pscustomobject]@{ordinary=(-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint));directory=[bool]$item.PSIsContainer;owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value;writers=$writers;mutators=$mutators}
}
function Test-CleanupProtectedSystemTask($Task){
    try{
        if([string]$Task.Principal.UserId -notin @('SYSTEM','NT AUTHORITY\SYSTEM','S-1-5-18')){return $false}
        $taskPath=[string]$Task.TaskPath;$name=[string]$Task.TaskName
        if(-not $taskPath.StartsWith('\Microsoft\Windows\',[StringComparison]::OrdinalIgnoreCase) -or -not $taskPath.EndsWith('\') -or
            -not $name -or $name.IndexOfAny([char[]]'\/:*?"<>|') -ge 0 -or $name -in @('.','..')){return $false}
        if(@($taskPath.Split('\')|Where-Object {$_ -in @('.','..') -or $_.Contains(':')}).Count){return $false}
        $root=Join-Path ([Environment]::GetFolderPath('System')) 'Tasks'
        $source=[IO.Path]::GetFullPath((Join-Path $root ($taskPath.TrimStart('\')+$name)))
        if(-not $source.StartsWith((Join-Path $root 'Microsoft\Windows')+'\',[StringComparison]::OrdinalIgnoreCase)){return $false}
        $allowed=@('S-1-5-18','S-1-5-32-544')
        $path=$source;$first=$true
        while($true){
            $security=Get-CleanupTaskPathSecurity $path
            # Parent folders may permit creating separate user tasks. They must
            # not permit replacing/deleting these existing protected ancestors.
            $effectiveWriters=if($first){$security.writers}else{$security.mutators}
            if(-not $security.ordinary -or $security.owner -notin $allowed -or @($effectiveWriters|Where-Object {$_ -notin $allowed}).Count -or
                ($first -and $security.directory) -or (-not $first -and -not $security.directory)){return $false}
            if($path -ieq $root){break}
            $path=[IO.Path]::GetDirectoryName($path);$first=$false
            if(-not $path){return $false}
        }
        return $true
    }catch{return $false}
}
