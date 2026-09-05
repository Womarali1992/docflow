<#
.SYNOPSIS
    DocFlow restore drill, v1: rebuild a backup set into a scratch database and verify it.

.DESCRIPTION
    1. Verifies the backup set against its manifest (sha256 of the dump and every file).
    2. Drops and recreates the target database (name must start with docflow_restore - this
       script never restores over the live database; see docs\PILOT-RUNBOOK.md for promotion).
    3. pg_restore of db.dump, then mirrors uploads\ into -UploadsTo.
    4. Compares row counts with the manifest and runs scripts\integrity.mjs (every document's
       file exists with the manifest's sha256 and the database's size).
    Prints PASS or FAIL and exits 0 / 1.

    Needs node on PATH, the PostgreSQL client tools, and - because the app role usually lacks
    CREATEDB - PG_ADMIN_URL (or -AdminUrl) pointing at a superuser connection.

.PARAMETER From
    A backup set folder (…\docflow-backups\2026-09-05).
.PARAMETER Target
    Scratch database name (default docflow_restore).
.PARAMETER UploadsTo
    Folder that receives the restored files (default %USERPROFILE%\docflow-restore\uploads). Mirrored.
.PARAMETER PgBin
    Folder containing pg_restore.exe (default: $env:PG_BIN or auto-detected).
.PARAMETER AdminUrl
    Superuser connection string used to recreate the target (default: $env:PG_ADMIN_URL).

.EXAMPLE
    $env:PG_ADMIN_URL = 'postgres://postgres@localhost:5432/postgres'
    powershell -NoProfile -ExecutionPolicy Bypass -File ops\windows\restore.ps1 -From C:\Users\me\docflow-backups\2026-09-05
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$From,
    [string]$Target = 'docflow_restore',
    [string]$UploadsTo = '',
    [string]$PgBin = '',
    [string]$AdminUrl = ''
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

if (-not $UploadsTo) { $UploadsTo = Join-Path $env:USERPROFILE 'docflow-restore\uploads' }
if (-not $PgBin) { $PgBin = $env:PG_BIN }
if (-not $AdminUrl) { $AdminUrl = $env:PG_ADMIN_URL }
if ($Target -notmatch '^docflow_restore[a-z0-9_]*$') {
    throw "Target must be docflow_restore or docflow_restore_<suffix>. This script never restores over the live database."
}

$repo = Get-RepoRoot
$serverDir = Join-Path $repo 'server'
$uploadsFull = [System.IO.Path]::GetFullPath($UploadsTo)
if ($uploadsFull.StartsWith($repo, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "UploadsTo must be outside the repository (it is mirrored, and server\uploads is the live store)"
}

$startedAt = Get-Date
$set = (Resolve-Path $From).Path
$manifestPath = Join-Path $set 'manifest.json'
if (-not (Test-Path $manifestPath)) { throw "No manifest.json in $set" }
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$manifestUploads = @($manifest.uploads)

$failures = @()

# 1. Verify the backup set.
Write-Log "Verifying backup set $set"
Write-Log "  created $($manifest.createdAt) on $($manifest.host), database '$($manifest.database)', $($manifest.pgDumpVersion)"
$dumpPath = Join-Path $set $manifest.dump.file
if (-not (Test-Path $dumpPath)) { throw "Dump file missing: $dumpPath" }
if ((Get-Sha256 $dumpPath) -ne $manifest.dump.sha256) { throw 'db.dump sha256 does not match the manifest - the backup set is damaged' }
$bad = 0
foreach ($u in $manifestUploads) {
    $p = Join-Path (Join-Path $set 'uploads') ($u.path -replace '/', '\')
    if (-not (Test-Path $p)) { Write-Log "  MISSING upload $($u.path)"; $bad++; continue }
    if ((Get-Sha256 $p) -ne $u.sha256) { Write-Log "  DAMAGED upload $($u.path)"; $bad++ }
}
if ($bad -gt 0) { throw "$bad upload file(s) in the backup set are missing or damaged" }
Write-Log "  dump OK ($(Format-Bytes $manifest.dump.bytes)); $($manifestUploads.Count) upload file(s) OK"

# 2. Recreate the target database.
$dotenv = Get-DotEnv (Join-Path $serverDir '.env')
$conn = ConvertFrom-DatabaseUrl $dotenv['DATABASE_URL']
$restoreUrl = Set-DatabaseName -Url $conn.Url -Name $Target
$envVars = @{}
if ($AdminUrl) { $envVars['PG_ADMIN_URL'] = $AdminUrl }
Write-Log "Recreating database '$Target' (owner $($conn.User))"
$createOut = Invoke-Node -Script (Join-Path $serverDir 'scripts\create-db.mjs') -Arguments @('--name', $Target, '--owner', $conn.User, '--drop') -EnvVars $envVars
foreach ($l in $createOut) { Write-Log "  $l" }

# 3. pg_restore.
$pgBinPath = Get-PgBin -Preferred $PgBin
$pgRestore = Join-Path $pgBinPath 'pg_restore.exe'
Write-Log "pg_restore into '$Target' on $($conn.Host):$($conn.Port)"
$env:PGPASSWORD = $conn.Password
try {
    & $pgRestore -h $conn.Host -p $conn.Port -U $conn.User -d $Target --no-owner --no-privileges --single-transaction --exit-on-error $dumpPath
    if ($LASTEXITCODE -ne 0) { throw "pg_restore exited with $LASTEXITCODE" }
} finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

# 4. Files.
Write-Log "Mirroring uploads to $uploadsFull"
New-Item -ItemType Directory -Force -Path $uploadsFull | Out-Null
& robocopy (Join-Path $set 'uploads') $uploadsFull /MIR /R:2 /W:5 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy exited with $LASTEXITCODE" }

# 5. Row counts vs manifest.
Write-Log 'Comparing row counts with the manifest'
$restored = Invoke-NodeJson -Script (Join-Path $serverDir 'scripts\count.mjs') -Arguments @('--url', $restoreUrl)
$rows = @()
foreach ($p in $manifest.counts.tables.PSObject.Properties) {
    $got = $restored.tables.($p.Name)
    $ok = ($got -eq $p.Value)
    if (-not $ok) { $failures += "table $($p.Name): manifest $($p.Value), restored $got" }
    $rows += [pscustomobject]@{ item = $p.Name; manifest = $p.Value; restored = $got; ok = $ok }
}
$rows += [pscustomobject]@{ item = 'documents with file'; manifest = $manifest.counts.documentsWithFile; restored = $restored.documentsWithFile; ok = ($restored.documentsWithFile -eq $manifest.counts.documentsWithFile) }
$rows += [pscustomobject]@{ item = 'migrations'; manifest = $manifest.counts.migrations; restored = $restored.migrations; ok = ($restored.migrations -eq $manifest.counts.migrations) }
if ($restored.documentsWithFile -ne $manifest.counts.documentsWithFile) { $failures += 'documents with file differ' }
if ($restored.migrations -ne $manifest.counts.migrations) { $failures += 'migration count differs' }

# 6. File integrity against the restored database and the manifest.
Write-Log 'Checking every stored file against the restored database and the manifest'
$integrity = Invoke-NodeJson -Script (Join-Path $serverDir 'scripts\integrity.mjs') -Arguments @('--url', $restoreUrl, '--uploads', $uploadsFull, '--manifest', $manifestPath) -IgnoreExitCode
$rows += [pscustomobject]@{ item = 'files verified'; manifest = $manifestUploads.Count; restored = $integrity.checked; ok = [bool]$integrity.ok }
if (-not $integrity.ok) {
    foreach ($m in @($integrity.missing)) { $failures += "missing file $($m.path) (document $($m.id))" }
    foreach ($m in @($integrity.mismatched)) { $failures += "$($m.path): $($m.reason)" }
}

$rows | Format-Table -AutoSize | Out-String -Width 120 | Write-Host
$elapsed = (Get-Date) - $startedAt
if ($failures.Count -eq 0) {
    Write-Log ("RESTORE DRILL PASS  database={0}  files={1}  elapsed={2:N1}s" -f $Target, $uploadsFull, $elapsed.TotalSeconds)
    exit 0
}
foreach ($f in $failures) { Write-Log "  FAIL: $f" }
Write-Log ("RESTORE DRILL FAIL  ({0} problem(s))  elapsed={1:N1}s" -f $failures.Count, $elapsed.TotalSeconds)
exit 1
