<#
.SYNOPSIS
    Installs DocFlow on the firm PC: service account, folders, ACLs, services,
    firewall and scheduled backup (C5.3).

.DESCRIPTION
    Run ONCE, elevated, on the machine that will host the pilot. It is
    idempotent — running it again repairs what has drifted rather than
    duplicating anything.

    What it does NOT do, on purpose, because each needs a human decision:
      * install PostgreSQL, Node, ClamAV or Caddy (see the runbook's
        prerequisites - versions and licences are not this script's business)
      * create the database or run migrations (update.ps1 does that, with the
        code in front of it)
      * turn on BitLocker (it needs the recovery key handled by a person)
      * point DNS or forward ports on the router

    The shape it builds:

      C:\docflow\app        the git checkout, read-only to the service account
      C:\docflow\services   WinSW exes, service xml, rolling logs
      C:\docflow\caddy      Caddyfile, certificates, access log
      <DataRoot>            documents and staging - on the encrypted volume,
                            writable by the service account and nobody else

    The account: docflow-svc, a local non-administrator. Everything that faces
    the network runs as it, and it can write to exactly two places.

.PARAMETER DataRoot
    Where documents live. Should be on the BitLocker-encrypted data volume.
.PARAMETER BackupDest
    Where nightly backups are written (drive A).
.PARAMETER ServiceUser
    Local account name to create/use (default docflow-svc).
.PARAMETER SkipServices
    Prepare everything but do not install the Windows services (useful for a dry run).

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File ops\windows\install.ps1 -DataRoot D:\docflow-data -BackupDest E:\docflow-backups
#>
[CmdletBinding()]
param(
    [string]$DataRoot = 'D:\docflow-data',
    [string]$BackupDest = 'E:\docflow-backups',
    [string]$ServiceUser = 'docflow-svc',
    [switch]$SkipServices
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'Run this from an elevated PowerShell.' }

$repo = Get-RepoRoot
$serverDir = Join-Path $repo 'server'
$appRoot = 'C:\docflow'
$servicesDir = Join-Path $appRoot 'services'
$caddyDir = Join-Path $appRoot 'caddy'
$logsDir = Join-Path $servicesDir 'logs'

Write-Log "Installing DocFlow from $repo"

# --- 1. Prerequisites we only check for ------------------------------------
foreach ($tool in @(
    @{ Name = 'node'; Hint = 'Install Node 22 LTS (nodejs.org)' },
    @{ Name = 'npm'; Hint = 'Ships with Node' }
)) {
    $found = Get-Command $tool.Name -ErrorAction SilentlyContinue
    if (-not $found) { throw "$($tool.Name) is not on PATH. $($tool.Hint)" }
    Write-Log "  $($tool.Name) $((& $tool.Name --version) -join '')"
}
$pgBin = Get-PgBin
Write-Log "  PostgreSQL client tools at $pgBin"

$edition = (Get-CimInstance Win32_OperatingSystem).Caption
Write-Log "  $edition"
if ($edition -notmatch 'Pro|Enterprise|Education|Server') {
    Write-Log '  WARNING: BitLocker needs Windows Pro or better. On Home, the data volume cannot be encrypted - see the runbook.'
}

# --- 2. The service account -------------------------------------------------
$existing = Get-LocalUser -Name $ServiceUser -ErrorAction SilentlyContinue
if (-not $existing) {
    # A password nobody types: the account is only ever used by the service
    # manager, and it is not a member of any group that can log in.
    Add-Type -AssemblyName System.Web
    $password = [System.Web.Security.Membership]::GeneratePassword(32, 8)
    $secure = ConvertTo-SecureString $password -AsPlainText -Force
    New-LocalUser -Name $ServiceUser -Password $secure -FullName 'DocFlow service account' `
        -Description 'Runs docflow-api, docflow-worker and caddy. Not an administrator.' `
        -PasswordNeverExpires -UserMayNotChangePassword | Out-Null
    Write-Log "Created local account '$ServiceUser'"
    Write-Log "  Its password is set and immediately forgotten. WinSW is configured to run as this"
    Write-Log "  account with 'Log on as a service'; if a service ever needs re-registering, reset"
    Write-Log "  the password from Computer Management rather than trying to recover this one."
    $script:generatedPassword = $password
} else {
    Write-Log "Local account '$ServiceUser' already exists"
}

# --- 3. Folders and ACLs ----------------------------------------------------
foreach ($dir in @($appRoot, $servicesDir, $caddyDir, $logsDir, $DataRoot, (Join-Path $DataRoot 'files'), (Join-Path $DataRoot 'staging'), $BackupDest)) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Write-Log "Created $dir"
    }
}

function Grant-Access {
    param([string]$Path, [string]$Rights)
    # /grant:r replaces this identity's entry rather than adding a second one,
    # so running the installer twice cannot accumulate permissions.
    & icacls $Path /grant:r "${ServiceUser}:(OI)(CI)$Rights" /T /C /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "icacls failed on $Path" }
    Write-Log "  $Rights on $Path"
}

Write-Log "Permissions for $ServiceUser"
Grant-Access -Path $DataRoot -Rights 'M'      # documents: read and write
Grant-Access -Path $caddyDir -Rights 'M'      # certificates: Caddy writes here
Grant-Access -Path $logsDir -Rights 'M'       # service logs
Grant-Access -Path $repo -Rights 'RX'         # the code: read and execute only
Write-Log "  (the backup destination stays administrator-only: the scheduled task runs elevated)"

# --- 4. The app itself ------------------------------------------------------
Write-Log 'Building the app (npm ci + build, root and server)'
Push-Location $repo
try {
    & npm ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed at the repository root' }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'frontend build failed' }
} finally { Pop-Location }
Push-Location $serverDir
try {
    & npm ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed in server' }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'server build failed' }
} finally { Pop-Location }

$envFile = Join-Path $serverDir '.env'
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $serverDir '.env.example') $envFile
    Write-Log "Created $envFile from the example - EDIT IT before starting the services:"
    Write-Log '  DATABASE_URL, SESSION_SECRET, APP_ENCRYPTION_KEY, DATA_ROOT, FIRM_TIMEZONE, TRUST_PROXY=1'
    Write-Log '  (SMTP_URL and MAIL_FROM are optional; without them invitations are copy-link only)'
} else {
    Write-Log "$envFile already exists - left alone"
}

# --- 5. Services ------------------------------------------------------------
if ($SkipServices) {
    Write-Log 'Skipping service installation (-SkipServices)'
} else {
    $winsw = Join-Path $servicesDir 'WinSW.NET461.exe'
    if (-not (Test-Path $winsw)) {
        throw "WinSW not found at $winsw. Download WinSW.NET461.exe from github.com/winsw/winsw/releases and put it there (see the runbook)."
    }
    foreach ($svc in 'docflow-api', 'docflow-worker', 'caddy') {
        $exe = Join-Path $servicesDir "$svc.exe"
        Copy-Item $winsw $exe -Force
        Copy-Item (Join-Path $PSScriptRoot "$svc.xml") (Join-Path $servicesDir "$svc.xml") -Force
        $installed = Get-Service -Name $svc -ErrorAction SilentlyContinue
        if ($installed) {
            Write-Log "Service '$svc' already installed - refreshing its definition"
            & $exe stop | Out-Null
            & $exe uninstall | Out-Null
            Start-Sleep -Seconds 2
        }
        & $exe install
        if ($LASTEXITCODE -ne 0) { throw "WinSW install failed for $svc" }
        Write-Log "Installed service '$svc'"
    }
    Write-Log 'Services installed but NOT started: check server\.env and the Caddyfile first, then:'
    Write-Log '  Start-Service docflow-api, docflow-worker, caddy'
}

# --- 6. Firewall ------------------------------------------------------------
& (Join-Path $PSScriptRoot 'firewall.ps1')

# --- 7. Nightly backup ------------------------------------------------------
$taskName = 'DocFlow nightly backup'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"{0}`" -Dest `"{1}`"" -f (Join-Path $PSScriptRoot 'backup.ps1'), $BackupDest)
$trigger = New-ScheduledTaskTrigger -Daily -At 2:00am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -RunLevel Highest -User 'SYSTEM' -Force | Out-Null
Write-Log "Scheduled '$taskName' daily at 02:00 (runs whether anyone is logged on or not)"

# --- 8. Clock ---------------------------------------------------------------
$w32 = Get-Service -Name w32time -ErrorAction SilentlyContinue
if ($w32 -and $w32.Status -eq 'Running') {
    Write-Log 'Time service is running'
} else {
    Write-Log 'WARNING: the Windows Time service is not running. Two-step verification codes fail on a wrong clock:'
    Write-Log '  Set-Service w32time -StartupType Automatic; Start-Service w32time; w32tm /resync'
}

Write-Log ''
Write-Log 'Installed. Next, in order (see docs\PILOT-RUNBOOK.md):'
Write-Log '  1. Edit server\.env (database, secrets, DATA_ROOT, TRUST_PROXY=1, FIRM_TIMEZONE)'
Write-Log '  2. Create the database and run migrations:  cd server; npm run db:migrate'
Write-Log '  3. Copy Caddyfile.example to C:\docflow\caddy\Caddyfile and put the real hostname in it'
Write-Log '  4. Start-Service docflow-api, docflow-worker, caddy'
Write-Log '  5. ops\windows\verify.ps1 -HostName docs.<firm>.com'
Write-Log '  6. Create the first advisor:  cd server; npm run admin -- create-advisor --email ... --name "..."'
if ($script:generatedPassword) {
    Write-Log ''
    Write-Log "The service account password was generated and not stored anywhere. If WinSW asks for it,"
    Write-Log "reset it in Computer Management instead of looking for it."
}
