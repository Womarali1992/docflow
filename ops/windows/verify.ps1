<#
.SYNOPSIS
    Checks that a DocFlow installation is actually working (C5.3).

.DESCRIPTION
    Run after install.ps1, after update.ps1, and any morning something feels
    wrong. Every check prints PASS, WARN or FAIL and the script exits 1 if
    anything FAILed, so it can be the last line of another script.

    What it checks, and why each one is here:

      services      A stopped worker is invisible from the app — uploads and
                    reviews keep working while nothing is scanned or chased.
      API health    Proves the API is up AND can reach the database.
      through Caddy Proves TLS and the proxy, which is what a client actually
                    touches. Skipped when -Host is not given.
      certificate   Expiry, because a certificate that fails to renew takes the
                    portal down completely and silently until someone visits.
      clamd         PING and signature age.
      disk          Free space on the data volume: the failure that takes
                    everything else with it.
      backup        The last recorded run, from backup_runs.

.PARAMETER HostName
    The public hostname to test end-to-end (e.g. docs.firm.com). Optional.
.PARAMETER ApiUrl
    The local API base (default http://127.0.0.1:4000).
.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File ops\windows\verify.ps1 -HostName docs.firm.com
#>
[CmdletBinding()]
param(
    [string]$HostName = '',
    [string]$ApiUrl = 'http://127.0.0.1:4000'
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'common.ps1')

$script:failures = 0
$script:warnings = 0

function Check {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][ValidateSet('PASS', 'WARN', 'FAIL', 'SKIP')][string]$Result,
        [string]$Detail = ''
    )
    if ($Result -eq 'FAIL') { $script:failures++ }
    if ($Result -eq 'WARN') { $script:warnings++ }
    Write-Host ("  {0,-4}  {1,-22} {2}" -f $Result, $Name, $Detail)
}

Write-Log 'DocFlow verification'

# --- Services ---------------------------------------------------------------
foreach ($name in 'docflow-api', 'docflow-worker', 'caddy', 'postgresql-x64-17') {
    $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
    if (-not $svc) { Check $name 'WARN' 'not installed on this machine' }
    elseif ($svc.Status -eq 'Running') { Check $name 'PASS' 'running' }
    else { Check $name 'FAIL' "status is $($svc.Status)" }
}

# --- API health (proves it can reach the database) --------------------------
try {
    $health = Invoke-RestMethod -Uri "$ApiUrl/api/health" -TimeoutSec 10
    if ($health.ok) { Check 'api health' 'PASS' "$ApiUrl" }
    else { Check 'api health' 'FAIL' 'answered, but not ok' }
} catch {
    Check 'api health' 'FAIL' "no answer from $ApiUrl ($($_.Exception.Message))"
}

# --- End to end, the way a client reaches it --------------------------------
if ($HostName) {
    try {
        $res = Invoke-WebRequest -Uri "https://$HostName/api/health" -TimeoutSec 15 -UseBasicParsing
        if ($res.StatusCode -eq 200) { Check 'through Caddy' 'PASS' "https://$HostName" }
        else { Check 'through Caddy' 'FAIL' "HTTP $($res.StatusCode)" }
    } catch {
        Check 'through Caddy' 'FAIL' $_.Exception.Message
    }

    # --- Certificate expiry --------------------------------------------------
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient($HostName, 443)
        $ssl = New-Object System.Net.Security.SslStream($tcp.GetStream(), $false, ({ $true }))
        $ssl.AuthenticateAsClient($HostName)
        $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($ssl.RemoteCertificate)
        $days = [int]([datetime]$cert.NotAfter - (Get-Date)).TotalDays
        $ssl.Dispose(); $tcp.Close()
        if ($days -lt 0) { Check 'certificate' 'FAIL' "EXPIRED $([math]::Abs($days)) day(s) ago" }
        elseif ($days -lt 14) { Check 'certificate' 'WARN' "$days day(s) left - renewal should have happened by now" }
        else { Check 'certificate' 'PASS' "$days day(s) left, issued by $($cert.Issuer)" }
    } catch {
        Check 'certificate' 'FAIL' $_.Exception.Message
    }
} else {
    Check 'through Caddy' 'SKIP' 'pass -HostName to test the public path'
    Check 'certificate' 'SKIP' 'pass -HostName to check expiry'
}

# --- Everything the app itself can see --------------------------------------
# /api/ops/status needs an advisor session, so the same facts are read straight
# from the database instead. A verification script must not need a password.
$repo = Get-RepoRoot
$serverDir = Join-Path $repo 'server'
$envFile = Join-Path $serverDir '.env'
$dotenv = Get-DotEnv $envFile

if ($dotenv.ContainsKey('DATA_ROOT') -and $dotenv['DATA_ROOT']) {
    $dataRoot = [System.IO.Path]::GetFullPath((Join-Path $serverDir $dotenv['DATA_ROOT']))
} else {
    $dataRoot = Join-Path $serverDir '.data'
}

# --- clamd -------------------------------------------------------------------
$clamHost = '127.0.0.1'
$clamPort = 3310
if ($dotenv.ContainsKey('CLAMD_HOST') -and $dotenv['CLAMD_HOST']) { $clamHost = $dotenv['CLAMD_HOST'] }
if ($dotenv.ContainsKey('CLAMD_PORT') -and $dotenv['CLAMD_PORT']) { $clamPort = [int]$dotenv['CLAMD_PORT'] }
try {
    $client = New-Object System.Net.Sockets.TcpClient
    $connect = $client.BeginConnect($clamHost, $clamPort, $null, $null)
    if (-not $connect.AsyncWaitHandle.WaitOne(3000)) { throw 'timed out' }
    $client.EndConnect($connect)
    $stream = $client.GetStream()
    $ping = [System.Text.Encoding]::ASCII.GetBytes("zVERSION`0")
    $stream.Write($ping, 0, $ping.Length)
    $buffer = New-Object byte[] 256
    $read = $stream.Read($buffer, 0, $buffer.Length)
    $reply = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $read).Trim([char]0, ' ')
    $client.Close()

    $parts = $reply -split '/'
    if ($parts.Count -ge 3) {
        $built = [datetime]::Parse(($parts[2..($parts.Count - 1)] -join '/'))
        $age = [int]((Get-Date) - $built).TotalDays
        if ($age -gt 7) { Check 'clamd' 'WARN' "$reply - signatures are $age days old (freshclam?)" }
        else { Check 'clamd' 'PASS' "$reply" }
    } else {
        Check 'clamd' 'PASS' $reply
    }
} catch {
    Check 'clamd' 'FAIL' "no answer on ${clamHost}:${clamPort} - uploads will be stored but stay unreadable"
}

# --- Disk --------------------------------------------------------------------
try {
    $drive = (Get-Item $dataRoot).PSDrive
    $freeGb = [math]::Round($drive.Free / 1GB, 1)
    $totalGb = [math]::Round(($drive.Free + $drive.Used) / 1GB, 1)
    $pct = if ($totalGb -gt 0) { [math]::Round(100 * $drive.Free / ($drive.Free + $drive.Used)) } else { 0 }
    if ($pct -lt 10) { Check 'disk' 'FAIL' "$freeGb GB free of $totalGb GB ($pct%) on $($drive.Name): - clear space now" }
    elseif ($pct -lt 20) { Check 'disk' 'WARN' "$freeGb GB free of $totalGb GB ($pct%)" }
    else { Check 'disk' 'PASS' "$freeGb GB free of $totalGb GB ($pct%) on $($drive.Name):" }
} catch {
    Check 'disk' 'FAIL' "could not read $dataRoot"
}

# --- Last backup -------------------------------------------------------------
try {
    $lastBackup = Invoke-NodeJson -Script (Join-Path $serverDir 'scripts\last-backup.mjs') -IgnoreExitCode
    if (-not $lastBackup.lastGoodAt) {
        Check 'backup' 'FAIL' 'no successful backup has ever been recorded'
    } else {
        $hours = [int]((Get-Date).ToUniversalTime() - [datetime]::Parse($lastBackup.lastGoodAt).ToUniversalTime()).TotalHours
        if ($hours -gt 36) { Check 'backup' 'FAIL' "last good backup was $hours hours ago - check the scheduled task" }
        elseif ($lastBackup.lastRunOk -eq $false) { Check 'backup' 'WARN' "the most recent attempt FAILED; last good was $hours hours ago" }
        else { Check 'backup' 'PASS' "$hours hours ago, $($lastBackup.lastGoodFiles) file(s)" }
    }
} catch {
    Check 'backup' 'FAIL' "could not read backup_runs ($($_.Exception.Message))"
}

Write-Host ''
if ($script:failures -gt 0) {
    Write-Log ("VERIFY FAILED  {0} failure(s), {1} warning(s)" -f $script:failures, $script:warnings)
    exit 1
}
Write-Log ("VERIFY OK  {0} warning(s)" -f $script:warnings)
exit 0
