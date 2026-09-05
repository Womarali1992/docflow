# Shared helpers for the DocFlow Windows operations scripts. Dot-source this file.
# Written for Windows PowerShell 5.1 (no &&, no ternary, no ??).

Set-StrictMode -Version 2.0

function Write-Log {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Message)
}

function Get-RepoRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

# Folder that holds pg_dump.exe / pg_restore.exe: $env:PG_BIN, or the newest
# PostgreSQL major under Program Files. The client tools are not on PATH on a
# stock Windows install.
function Get-PgBin {
    param([string]$Preferred = '')
    if ($Preferred) {
        if (Test-Path (Join-Path $Preferred 'pg_dump.exe')) { return (Resolve-Path $Preferred).Path }
        throw "pg_dump.exe not found in PG_BIN '$Preferred'"
    }
    $roots = @("$env:ProgramFiles\PostgreSQL", "${env:ProgramFiles(x86)}\PostgreSQL")
    $candidates = @()
    foreach ($root in $roots) {
        if (Test-Path $root) {
            $candidates += Get-ChildItem $root -Directory | Where-Object { $_.Name -match '^\d+(\.\d+)?$' }
        }
    }
    $best = $candidates |
        Where-Object { Test-Path (Join-Path $_.FullName 'bin\pg_dump.exe') } |
        Sort-Object { [double]$_.Name } -Descending |
        Select-Object -First 1
    if (-not $best) { throw 'No PostgreSQL client tools found. Set PG_BIN to the folder containing pg_dump.exe.' }
    return (Join-Path $best.FullName 'bin')
}

# KEY=VALUE lines from a .env file (comments and blank lines ignored, simple quotes stripped).
function Get-DotEnv {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path $Path)) { throw ".env not found at $Path" }
    $vars = @{}
    foreach ($line in Get-Content $Path) {
        $t = $line.Trim()
        if ($t -eq '' -or $t.StartsWith('#')) { continue }
        $i = $t.IndexOf('=')
        if ($i -lt 1) { continue }
        $k = $t.Substring(0, $i).Trim()
        $v = $t.Substring($i + 1).Trim()
        if ($v.Length -ge 2) {
            if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
                $v = $v.Substring(1, $v.Length - 2)
            }
        }
        $vars[$k] = $v
    }
    return $vars
}

# Split postgres://user:pass@host:port/db into its parts.
function ConvertFrom-DatabaseUrl {
    param([Parameter(Mandatory = $true)][string]$Url)
    $uri = [System.Uri]$Url
    $userInfo = $uri.UserInfo -split ':', 2
    $password = ''
    if ($userInfo.Length -gt 1) { $password = [System.Uri]::UnescapeDataString($userInfo[1]) }
    $port = 5432
    if ($uri.Port -gt 0) { $port = $uri.Port }
    return [pscustomobject]@{
        Url      = $Url
        Host     = $uri.Host
        Port     = $port
        User     = [System.Uri]::UnescapeDataString($userInfo[0])
        Password = $password
        Database = $uri.AbsolutePath.TrimStart('/')
    }
}

# Same connection string pointing at another database name.
function Set-DatabaseName {
    param([Parameter(Mandatory = $true)][string]$Url, [Parameter(Mandatory = $true)][string]$Name)
    $b = New-Object System.UriBuilder($Url)
    $b.Path = "/$Name"
    return $b.Uri.AbsoluteUri
}

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

# Run a Node script (absolute path) with optional extra environment variables.
# Returns stdout lines. Throws on a non-zero exit unless -IgnoreExitCode.
function Invoke-Node {
    param(
        [Parameter(Mandatory = $true)][string]$Script,
        [string[]]$Arguments = @(),
        [hashtable]$EnvVars = @{},
        [switch]$IgnoreExitCode
    )
    $saved = @{}
    foreach ($k in $EnvVars.Keys) {
        $saved[$k] = [Environment]::GetEnvironmentVariable($k, 'Process')
        [Environment]::SetEnvironmentVariable($k, $EnvVars[$k], 'Process')
    }
    try {
        $out = & node $Script @Arguments
        $code = $LASTEXITCODE
        if ($code -ne 0 -and -not $IgnoreExitCode) { throw "node $(Split-Path $Script -Leaf) exited with $code" }
        return @($out)
    } finally {
        foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k], 'Process') }
    }
}

function Invoke-NodeJson {
    param(
        [Parameter(Mandatory = $true)][string]$Script,
        [string[]]$Arguments = @(),
        [hashtable]$EnvVars = @{},
        [switch]$IgnoreExitCode
    )
    $lines = Invoke-Node -Script $Script -Arguments $Arguments -EnvVars $EnvVars -IgnoreExitCode:$IgnoreExitCode
    $text = ($lines -join "`n").Trim()
    if (-not $text) { throw "node $(Split-Path $Script -Leaf) printed nothing" }
    return ($text | ConvertFrom-Json)
}

function Format-Bytes {
    param([long]$Bytes)
    if ($Bytes -ge 1GB) { return ('{0:N2} GB' -f ($Bytes / 1GB)) }
    if ($Bytes -ge 1MB) { return ('{0:N1} MB' -f ($Bytes / 1MB)) }
    if ($Bytes -ge 1KB) { return ('{0:N1} KB' -f ($Bytes / 1KB)) }
    return "$Bytes B"
}
