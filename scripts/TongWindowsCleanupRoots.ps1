$ErrorActionPreference='Stop'
$local=[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
if(-not [IO.Path]::IsPathFullyQualified($local)){throw 'Windows cache roots unavailable'}
@(
    @{kind='temporary';path=(Join-Path $local 'Temp')}
    @{kind='npm';path=(Join-Path $local 'npm-cache')}
    @{kind='pip';path=(Join-Path $local 'pip\Cache')}
)|ConvertTo-Json -Compress
