$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
Import-Module (Join-Path $PSScriptRoot '..\scripts\TongControl.psm1') -Force
$settings = Get-TongConfiguration

# Diagnostic-only improvements. No auth, gateway, DevSpace, OAuth, or host validation changes.
# Read-only on the server side: this script only issues HTTP requests.

function ConvertTo-TongRedactedBody {
    param([AllowEmptyString()][string]$Body)
    if ([string]::IsNullOrEmpty($Body)) { return $Body }
    $text = $Body
    # Mask bearer/access tokens whether bare or inside a JSON string value.
    $text = [regex]::Replace($text, '(Bearer\s+)[A-Za-z0-9._~+/=-]+', '$1***')
    $text = [regex]::Replace($text, '("(?:access_token|refresh_token|id_token|client_secret|code|token)"\s*:\s*")[^"]*(")', '$1***$2')
    return $text
}

function Get-TongUtcTimestamp {
    # ISO-8601 with milliseconds; comparable to the "ts" field in gateway/devspace JSON logs.
    return [DateTime]::UtcNow.ToString('o')
}

function Send-TongHttpRequest {
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter(Mandatory)][string]$Path,
        [string]$Method = 'GET',
        [string]$Body,
        [string]$HostHeader,
        [string]$Authorization,
        [string]$ContentType = 'application/json'
    )
    $hasBody = $PSBoundParameters.ContainsKey('Body')
    # Windows PowerShell 5.1/.NET Framework reports public ngrok 401 responses as 200
    # on this host. curl.exe preserves the wire status; keep the local HttpClient path.
    if ($BaseUrl.StartsWith('https://')) {
        $headerFile = [IO.Path]::GetTempFileName()
        $bodyFile = [IO.Path]::GetTempFileName()
        $inputFile = $null
        $sentAtUtc = ''
        try {
            $arguments = @('--http1.1', '--silent', '--show-error',
                '--max-time', '12', '--dump-header', $headerFile, '--output', $bodyFile,
                '--write-out', '%{http_code}', '--request', $Method,
                '--header', 'ngrok-skip-browser-warning: true')
            if ($Path -eq '/mcp') { $arguments += @('--header', 'Accept: application/json, text/event-stream') }
            if ($Authorization) { $arguments += @('--header', "Authorization: $Authorization") }
            if ($hasBody) {
                $inputFile = [IO.Path]::GetTempFileName()
                [IO.File]::WriteAllText($inputFile, $Body, [Text.UTF8Encoding]::new($false))
                $arguments += @('--header', "Content-Type: $ContentType", '--data-binary', "@$inputFile")
            }
            $arguments += ($BaseUrl + $Path)
            # First try the direct route, then the existing process proxy if direct TLS fails.
            # Neither route changes machine or user proxy settings.
            for ($attempt = 1; $attempt -le 4; $attempt++) {
                $sentAtUtc = Get-TongUtcTimestamp
                $attemptArguments = if ($attempt -eq 1 -or $attempt -eq 4) {
                    @('--noproxy', '*') + $arguments
                } else { $arguments }
                $statusText = & curl.exe @attemptArguments
                if ($LASTEXITCODE -eq 0) { break }
                Start-Sleep -Milliseconds 750
            }
            if ($LASTEXITCODE -ne 0 -or $statusText -notmatch '^\d{3}$') {
                throw "curl.exe failed for $Method $Path (exit $LASTEXITCODE, HTTP $statusText)."
            }
            $headers = [IO.File]::ReadAllLines($headerFile)
            $wwwAuth = @($headers | Where-Object { $_ -match '^WWW-Authenticate:\s*(.*)$' } |
                ForEach-Object { $_ -replace '^WWW-Authenticate:\s*', '' }) -join '; '
            $location = @($headers | Where-Object { $_ -match '^Location:\s*(.*)$' } |
                ForEach-Object { $_ -replace '^Location:\s*', '' } | Select-Object -Last 1) -join ''
            $mediaType = @($headers | Where-Object { $_ -match '^Content-Type:\s*(.*)$' } |
                ForEach-Object { ($_ -replace '^Content-Type:\s*', '').Split(';')[0].Trim() } |
                Select-Object -Last 1) -join ''
            return [pscustomobject]@{
                SentAtUtc = $sentAtUtc; Status = [int]$statusText; ContentType = $mediaType
                HasWwwAuthenticate = ($wwwAuth.Length -gt 0); WwwAuthenticate = $wwwAuth
                Location = $location; Body = [IO.File]::ReadAllText($bodyFile)
            }
        }
        finally {
            Remove-Item -LiteralPath $headerFile, $bodyFile -Force -ErrorAction SilentlyContinue
            if ($inputFile) { Remove-Item -LiteralPath $inputFile -Force -ErrorAction SilentlyContinue }
        }
    }
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.UseProxy = $false
    $handler.UseCookies = $false
    # (1) Never follow redirects: surface the real status (e.g. an ngrok/OAuth 3xx), not the final hop.
    $handler.AllowAutoRedirect = $false
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(12)
    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($Method), ($BaseUrl + $Path))
    if ($BaseUrl.StartsWith('https://')) { $request.Headers.Add('ngrok-skip-browser-warning', 'true') }
    if ($HostHeader) { $request.Headers.Host = $HostHeader }
    if ($Path -eq '/mcp') {
        $request.Headers.Accept.ParseAdd('application/json')
        $request.Headers.Accept.ParseAdd('text/event-stream')
    }
    if ($Authorization) { $request.Headers.TryAddWithoutValidation('Authorization', $Authorization) | Out-Null }
    if ($hasBody) { $request.Content = [System.Net.Http.StringContent]::new($Body, [Text.Encoding]::UTF8, $ContentType) }
    # (2) Capture the wall-clock time so the operator can align with gateway/devspace logs.
    $sentAtUtc = Get-TongUtcTimestamp
    try {
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        $content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        $wwwAuth = if ($response.Headers.WwwAuthenticate.Count -gt 0) {
            ($response.Headers.WwwAuthenticate | ForEach-Object { $_.ToString() }) -join '; '
        } else { '' }
        $location = if ($response.Headers.Location) { $response.Headers.Location.ToString() } else { '' }
        [pscustomobject]@{
            SentAtUtc          = $sentAtUtc
            Status             = [int]$response.StatusCode
            ContentType        = if ($response.Content.Headers.ContentType) { $response.Content.Headers.ContentType.MediaType } else { '' }
            HasWwwAuthenticate = ($response.Headers.WwwAuthenticate.Count -gt 0)
            WwwAuthenticate    = $wwwAuth
            Location           = $location
            # Raw body is kept for assertions; redaction happens only at display time.
            Body               = $content
        }
        $response.Dispose()
    }
    catch {
        $causes = @()
        $errorCause = $_.Exception
        while ($errorCause) {
            $causes += ('{0}: {1}' -f $errorCause.GetType().FullName, $errorCause.Message)
            $errorCause = $errorCause.InnerException
        }
        throw ("HTTP request failed for {0} {1}: {2}" -f $Method, $Path, ($causes -join ' -> '))
    }
    finally {
        $request.Dispose()
        $client.Dispose()
        $handler.Dispose()
    }
}

function Write-TongRequestResult {
    param(
        [Parameter(Mandatory)][string]$TargetLabel,   # LOCAL or PUBLIC
        [Parameter(Mandatory)][string]$Description,
        [Parameter(Mandatory)]$Result
    )
    $wwwAuth = if ($Result.HasWwwAuthenticate) { 'present' } else { 'absent' }
    $location = if ($Result.Location) { 'present' } else { '-' }
    Write-Output ("[{0}] {1}: HTTP {2} {3} | WWW-Authenticate={4} | Location={5} | sentAtUtc={6}" -f `
        $TargetLabel, $Description, $Result.Status, $Result.ContentType, $wwwAuth, $location, $Result.SentAtUtc)
    Write-Output ("  redacted body: {0}" -f (ConvertTo-TongRedactedBody -Body $Result.Body))
}

# Correlation note: the gateway assigns its own requestId (a UUID) per HTTP request and writes it
# to logs\gateway-*.stdout.log (fields: requestId, method, path, mcpMethods, upstream_response.status,
# request_finish.status, authOutcome). That UUID is NOT the JSON-RPC "id" below and is NOT returned to
# the client. Match logs by sentAtUtc + method + path, then link gateway records by its requestId.
# DevSpace writes devspace_http_request_start/finish with its own requestId (PID-rN) to
# logs\devspace-*.stdout.log.

$jsonRpcId = 1   # JSON-RPC id only; do NOT treat this as the HTTP log request id.
foreach ($baseUrl in @("http://127.0.0.1:$($settings.Port)", $settings.PublicOrigin)) {
    # (3) Label each target explicitly so local (127.0.0.1:7676) and public HTTPS results are never conflated.
    $targetLabel = if ($baseUrl -like 'http://127.0.0.1*' -or $baseUrl -like 'http://localhost*') { 'LOCAL' } else { 'PUBLIC' }

    $resource = Send-TongHttpRequest -BaseUrl $baseUrl -Path '/.well-known/oauth-protected-resource/mcp'
    Write-TongRequestResult -TargetLabel $targetLabel -Description 'oauth-protected-resource' -Result $resource
    if ($resource.Status -ne 200 -or $resource.ContentType -ne 'application/json') {
        throw "Protected-resource metadata failed at $baseUrl (HTTP $($resource.Status))."
    }
    $resourceMetadata = $resource.Body | ConvertFrom-Json
    $authorizationServers = @($resourceMetadata.authorization_servers | ForEach-Object {
        ([uri]$_).GetLeftPart([System.UriPartial]::Authority).TrimEnd('/')
    })
    if ($resourceMetadata.resource -ne $settings.PublicMcpUrl -or
        $authorizationServers -notcontains $settings.PublicOrigin) {
        throw "Protected-resource metadata at $baseUrl does not advertise the configured public MCP origin."
    }

    $authorization = Send-TongHttpRequest -BaseUrl $baseUrl -Path '/.well-known/oauth-authorization-server'
    Write-TongRequestResult -TargetLabel $targetLabel -Description 'oauth-authorization-server' -Result $authorization
    if ($authorization.Status -ne 200 -or $authorization.ContentType -ne 'application/json') {
        throw "Authorization-server metadata failed at $baseUrl (HTTP $($authorization.Status))."
    }
    $authorizationMetadata = $authorization.Body | ConvertFrom-Json
    $expectedHost = ([uri]$settings.PublicOrigin).Host
    foreach ($field in @('authorization_endpoint', 'token_endpoint', 'registration_endpoint')) {
        if ([string]::IsNullOrWhiteSpace([string]$authorizationMetadata.$field) -or
            ([uri]$authorizationMetadata.$field).Scheme -ne 'https' -or
            ([uri]$authorizationMetadata.$field).Host -ne $expectedHost) {
            throw "OAuth metadata field $field advertises an unexpected host."
        }
    }

    $unauthorized = Send-TongHttpRequest -BaseUrl $baseUrl -Path '/mcp' -Method 'POST' `
        -Body ('{"jsonrpc":"2.0","id":' + $jsonRpcId + ',"method":"tools/list","params":{}}')
    Write-TongRequestResult -TargetLabel $targetLabel -Description 'tools/list unauthenticated' -Result $unauthorized
    if ($unauthorized.Status -ne 401 -or -not $unauthorized.HasWwwAuthenticate) {
        throw "Unauthenticated MCP tools/list was not rejected with an OAuth challenge at $baseUrl (HTTP $($unauthorized.Status))."
    }
    $jsonRpcId++
    Write-Output "PASS: OAuth metadata and unauthenticated MCP denial at [$targetLabel] $baseUrl."

    $unauthorizedShell = Send-TongHttpRequest -BaseUrl $baseUrl -Path '/mcp' -Method 'POST' `
        -Body ('{"jsonrpc":"2.0","id":' + $jsonRpcId + ',"method":"tools/call","params":{"name":"bash","arguments":{"workspaceId":"test-only","command":"echo blocked-shell-canary"}}}')
    Write-TongRequestResult -TargetLabel $targetLabel -Description 'tools/call bash unauthenticated' -Result $unauthorizedShell
    if ($unauthorizedShell.Status -ne 401 -or -not $unauthorizedShell.HasWwwAuthenticate) {
        throw "Unauthenticated hidden-shell call was not rejected by OAuth at $baseUrl (HTTP $($unauthorizedShell.Status))."
    }
    $jsonRpcId++
    Write-Output "PASS: unauthenticated Bash call is rejected before gateway policy at [$targetLabel] $baseUrl."

    $unauthorizedScan = Send-TongHttpRequest -BaseUrl $baseUrl -Path '/mcp' -Method 'POST' `
        -Body ('{"jsonrpc":"2.0","id":' + $jsonRpcId + ',"method":"tools/call","params":{"name":"tong_scan_directory","arguments":{"path":"C:\\"}}}')
    Write-TongRequestResult -TargetLabel $targetLabel -Description 'tools/call tong_scan_directory unauthenticated' -Result $unauthorizedScan
    if ($unauthorizedScan.Status -ne 401 -or -not $unauthorizedScan.HasWwwAuthenticate) {
        throw "Unauthenticated metadata scan was not rejected by OAuth at $baseUrl (HTTP $($unauthorizedScan.Status))."
    }
    $jsonRpcId++
    Write-Output "PASS: unauthenticated metadata scan is rejected at [$targetLabel] $baseUrl."

    $requestBody = '{"jsonrpc":"2.0","id":91,"method":"tools/list","params":{}}'
    $fakeToken = Send-TongHttpRequest -BaseUrl $baseUrl -Path '/mcp' -Method 'POST' `
        -Body $requestBody -Authorization 'Bearer tong-intentionally-invalid-token'
    Write-TongRequestResult -TargetLabel $targetLabel -Description 'tools/list forged token' -Result $fakeToken
    if ($fakeToken.Status -ne 401 -or -not $fakeToken.HasWwwAuthenticate -or
        ($fakeToken.Body | ConvertFrom-Json).error -ne 'invalid_token') {
        throw "Forged token was not rejected by OAuth at $baseUrl."
    }

    foreach ($case in @(
        @{ Name = 'invalid JSON'; Body = '{'; ContentType = 'application/json'; Status = 400 },
        @{ Name = 'oversized JSON'; Body = (' ' * (101 * 1024)); ContentType = 'application/json'; Status = 413 },
        @{ Name = 'invalid Content-Type'; Body = $requestBody; ContentType = 'text/plain'; Status = 415 }
    )) {
        $result = Send-TongHttpRequest -BaseUrl $baseUrl -Path '/mcp' -Method 'POST' `
            -Body $case.Body -ContentType $case.ContentType
        Write-TongRequestResult -TargetLabel $targetLabel -Description $case.Name -Result $result
        if ($result.Status -ne $case.Status) {
            throw "$($case.Name) returned HTTP $($result.Status) at $baseUrl; expected $($case.Status)."
        }
    }

    foreach ($invalidPath in @('/MCP', '/mcp/')) {
        $result = Send-TongHttpRequest -BaseUrl $baseUrl -Path $invalidPath -Method 'POST' -Body $requestBody
        Write-TongRequestResult -TargetLabel $targetLabel -Description "noncanonical $invalidPath" -Result $result
        if ($result.Status -ne 404) { throw "Noncanonical MCP path $invalidPath returned HTTP $($result.Status) at $baseUrl." }
    }
    Write-Output "PASS: forged token, malformed and oversized requests, content type, and MCP path checks at [$targetLabel] $baseUrl."
}

$badHost = Send-TongHttpRequest -BaseUrl "http://127.0.0.1:$($settings.Port)" `
    -Path '/.well-known/oauth-authorization-server' -HostHeader 'untrusted.example'
Write-TongRequestResult -TargetLabel 'LOCAL' -Description 'bad Host header' -Result $badHost
if ($badHost.Status -ne 403) { throw "Unexpected Host header was not rejected (HTTP $($badHost.Status))." }
Write-Output 'PASS: unexpected Host header is rejected.'

$authorizationRoute = Send-TongHttpRequest -BaseUrl $settings.PublicOrigin -Path '/authorize'
Write-TongRequestResult -TargetLabel 'PUBLIC' -Description 'authorize route (no params)' -Result $authorizationRoute
if ($authorizationRoute.Status -ne 400) { throw "OAuth authorization route returned HTTP $($authorizationRoute.Status) without parameters." }
Write-Output 'PASS: public OAuth authorization route is reachable.'

Write-Output ''
Write-Output 'Read-only log correlation (do NOT use the JSON-RPC id as the HTTP log request id):'
Write-Output '  logs\gateway-*.stdout.log  -> link request_start -> upstream_response(status) -> request_finish(status, authOutcome) by requestId (UUID)'
Write-Output '  logs\devspace-*.stdout.log -> devspace_http_request_finish.status'
Write-Output 'Match by sentAtUtc + method + path within the same time window.'
