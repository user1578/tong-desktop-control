$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
Import-Module (Join-Path $PSScriptRoot '..\scripts\TongControl.psm1') -Force
$settings = Get-TongConfiguration

function Send-TongHttpRequest {
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter(Mandatory)][string]$Path,
        [string]$Method = 'GET',
        [string]$Body,
        [string]$HostHeader
    )
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.UseProxy = $false
    $handler.UseCookies = $false
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(12)
    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($Method), ($BaseUrl + $Path))
    if ($BaseUrl.StartsWith('https://')) { $request.Headers.Add('ngrok-skip-browser-warning', 'true') }
    if ($HostHeader) { $request.Headers.Host = $HostHeader }
    if ($Path -eq '/mcp') {
        $request.Headers.Accept.ParseAdd('application/json')
        $request.Headers.Accept.ParseAdd('text/event-stream')
    }
    if ($Body) { $request.Content = [System.Net.Http.StringContent]::new($Body, [Text.Encoding]::UTF8, 'application/json') }
    try {
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        $content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        [pscustomobject]@{
            Status = [int]$response.StatusCode
            ContentType = if ($response.Content.Headers.ContentType) { $response.Content.Headers.ContentType.MediaType } else { '' }
            HasWwwAuthenticate = ($response.Headers.WwwAuthenticate.Count -gt 0)
            Body = $content
        }
        $response.Dispose()
    }
    finally {
        $request.Dispose()
        $client.Dispose()
        $handler.Dispose()
    }
}

$requestId = 1
    foreach ($baseUrl in @("http://127.0.0.1:$($settings.Port)", $settings.PublicOrigin)) {
        $resource = Send-TongHttpRequest -BaseUrl $baseUrl -Path '/.well-known/oauth-protected-resource/mcp'
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
            -Body ('{"jsonrpc":"2.0","id":' + $requestId + ',"method":"tools/list","params":{}}')
        if ($unauthorized.Status -ne 401 -or -not $unauthorized.HasWwwAuthenticate) {
            throw "Unauthenticated MCP tools/list was not rejected with an OAuth challenge at $baseUrl (HTTP $($unauthorized.Status))."
        }
        $requestId++
        Write-Output "PASS: OAuth metadata and unauthenticated MCP denial at $baseUrl."

        $unauthorizedShell = Send-TongHttpRequest -BaseUrl $baseUrl -Path '/mcp' -Method 'POST' `
            -Body ('{"jsonrpc":"2.0","id":' + $requestId + ',"method":"tools/call","params":{"name":"bash","arguments":{"workspaceId":"test-only","command":"echo blocked-shell-canary"}}}')
        if ($unauthorizedShell.Status -ne 401 -or -not $unauthorizedShell.HasWwwAuthenticate) {
            throw "Unauthenticated hidden-shell call was not rejected by OAuth at $baseUrl (HTTP $($unauthorizedShell.Status))."
        }
        $requestId++
        Write-Output "PASS: unauthenticated Bash call is rejected before gateway policy at $baseUrl."

        $unauthorizedScan = Send-TongHttpRequest -BaseUrl $baseUrl -Path '/mcp' -Method 'POST' `
            -Body ('{"jsonrpc":"2.0","id":' + $requestId + ',"method":"tools/call","params":{"name":"tong_scan_directory","arguments":{"path":"C:\\"}}}')
        if ($unauthorizedScan.Status -ne 401 -or -not $unauthorizedScan.HasWwwAuthenticate) {
            throw "Unauthenticated metadata scan was not rejected by OAuth at $baseUrl (HTTP $($unauthorizedScan.Status))."
        }
        $requestId++
        Write-Output "PASS: unauthenticated metadata scan is rejected at $baseUrl."
    }

    $badHost = Send-TongHttpRequest -BaseUrl "http://127.0.0.1:$($settings.Port)" `
        -Path '/.well-known/oauth-authorization-server' -HostHeader 'untrusted.example'
    if ($badHost.Status -ne 403) { throw "Unexpected Host header was not rejected (HTTP $($badHost.Status))." }
    Write-Output 'PASS: unexpected Host header is rejected.'

    $authorizationRoute = Send-TongHttpRequest -BaseUrl $settings.PublicOrigin -Path '/authorize'
    if ($authorizationRoute.Status -ne 400) { throw "OAuth authorization route returned HTTP $($authorizationRoute.Status) without parameters." }
Write-Output 'PASS: public OAuth authorization route is reachable.'
