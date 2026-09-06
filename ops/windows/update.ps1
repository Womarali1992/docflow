<#
.SYNOPSIS
    Updates the DocFlow installation to the current main branch (C5.3).

.DESCRIPTION
    The only way code reaches the firm PC. There is no deployment pipeline and
    no automatic update: someone decides, runs this, and watches it verify.

    Order matters and is the whole point:

      1. Back up FIRST. If a migration goes wrong, the last good copy is
         minutes old, not last night.
      2. git pull (refuses if anything local has been edited - a hand-fixed
         file on the firm PC is a problem to resolve deliberately, not to
         silently overwrite).
      3. npm ci + build, both halves, BEFORE stopping anything. A build that
         fails leaves the running services untouched.
      4. Stop, migrate, start. The window where the portal is down is the
         migration and two service restarts.
      5. verify.ps1. If it fails, the runbook's rollback is one restore away.

.PARAMETER HostName
    Public hostname, passed to verify.ps1 so the check covers TLS too.
.PARAMETER BackupDest
    Where the pre-update backup goes (default: the nightly destination).
.PARAMETER SkipBackup
    Don't. Only for a machine where the backup has already been taken this hour.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File ops\windows\update.ps1 -HostName docs.firm.com
#>
[CmdletBinding()]
param(
    [string]$HostName = '',
    [string]$BackupDest = '',
    [switch]$SkipBackup
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$repo = Get-RepoRoot
$serverDir = Join-Path $repo 'server'
$startedAt = Get-Date

Write-Log "Updating DocFlow at $repo"

# --- 1. Backup first --------------------------------------------------------
if ($SkipBackup) {
    Write-Log 'Skipping the pre-update backup (-SkipBackup). The last good copy is whatever the nightly task left.'
} else {
    Write-Log 'Backing up before touching anything'
    $backupArgs = @()
    if ($BackupDest) { $backupArgs += @('-Dest', $BackupDest) }
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'backup.ps1') @backupArgs
    if ($LASTEXITCODE -ne 0) { throw 'Pre-update backup FAILED. Not updating: fix the backup first.' }
}

# --- 2. Code ----------------------------------------------------------------
Push-Location $repo
try {
    $dirty = & git status --porcelain
    if ($dirty) {
        Write-Log 'Local changes on this machine:'
        foreach ($line in $dirty) { Write-Log "  $line" }
        throw 'The working tree is not clean. Resolve those changes deliberately, then run this again.'
    }

    $before = (& git rev-parse --short HEAD).Trim()
    & git pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) { throw 'git pull failed (not a fast-forward? check the branch)' }
    $after = (& git rev-parse --short HEAD).Trim()

    if ($before -eq $after) {
        Write-Log "Already up to date at $after"
    } else {
        Write-Log "Updating $before -> $after"
        & git --no-pager log --oneline "$before..$after"
    }
} finally { Pop-Location }

# --- 3. Build both halves BEFORE stopping anything --------------------------
Write-Log 'Installing and building (the portal is still up while this runs)'
Push-Location $repo
try {
    & npm ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed at the repository root' }
    & npm run build; if ($LASTEXITCODE -ne 0) { throw 'frontend build failed - nothing has been changed on the running system' }
} finally { Pop-Location }
Push-Location $serverDir
try {
    & npm ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed in server' }
    & npm run build; if ($LASTEXITCODE -ne 0) { throw 'server build failed - nothing has been changed on the running system' }
} finally { Pop-Location }

# --- 4. The short window ----------------------------------------------------
Write-Log 'Stopping services'
foreach ($svc in 'docflow-worker', 'docflow-api') {
    $s = Get-Service -Name $svc -ErrorAction SilentlyContinue
    if ($s -and $s.Status -eq 'Running') { Stop-Service -Name $svc; Write-Log "  stopped $svc" }
}

Write-Log 'Running database migrations'
Push-Location $serverDir
try {
    & npm run db:migrate
    if ($LASTEXITCODE -ne 0) {
        Write-Log 'MIGRATION FAILED. The services are stopped and the pre-update backup is minutes old.'
        Write-Log 'See docs\PILOT-RUNBOOK.md -> "If an update goes wrong".'
        throw 'db:migrate failed'
    }
} finally { Pop-Location }

Write-Log 'Starting services'
foreach ($svc in 'docflow-api', 'docflow-worker') {
    Start-Service -Name $svc
    Write-Log "  started $svc"
}
# Caddy serves the built files straight from disk; it does not need a restart
# for a frontend change, and restarting it would drop live connections.

# --- 5. Prove it ------------------------------------------------------------
Start-Sleep -Seconds 3
$verifyArgs = @()
if ($HostName) { $verifyArgs += @('-HostName', $HostName) }
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'verify.ps1') @verifyArgs
$verifyExit = $LASTEXITCODE

$elapsed = (Get-Date) - $startedAt
if ($verifyExit -ne 0) {
    Write-Log ("UPDATE FINISHED BUT VERIFICATION FAILED  elapsed={0:N1}s" -f $elapsed.TotalSeconds)
    Write-Log 'The new code is running. Read the failures above; the runbook has the rollback.'
    exit 1
}
Write-Log ("UPDATE OK  elapsed={0:N1}s" -f $elapsed.TotalSeconds)
