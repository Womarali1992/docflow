<#
.SYNOPSIS
    DocFlow restore drill, v2: rebuild a backup set into a scratch database and verify it.

.DESCRIPTION
    1. Verifies the backup set against its manifest (sha256 of the dump and every file).
    2. Drops and recreates the target database (name must start with docflow_restore - this
       script never restores over the live database; see docs\PILOT-RUNBOOK.md for promotion).
    3. pg_restore of db.dump, then mirrors the set's files\ into -RestoreTo (the restored
       DATA_ROOT). A pre-C5.4 set also has uploads\, mirrored into -RestoreTo\uploads.
    4. Compares row counts with the manifest and runs scripts\integrity.mjs, which checks every
       document version's bytes against the database's sha256 and the manifest's.
    Prints PASS or FAIL and exits 0 / 1.

    A drill is the only thing that turns a backup into a restore. Run it monthly, and after any
    change to what is backed up.

    Needs node on PATH, the PostgreSQL client tools, and - because the app role usually lacks
    CREATEDB - PG_ADMIN_URL (or -AdminUrl) pointing at a superuser connection.

.PARAMETER From
    A backup set folder (…\docflow-backups\2026-09-05).
.PARAMETER Target
    Scratch database name (default docflow_restore).
.PARAMETER RestoreTo
    Folder that receives the restored document tree (default %USERPROFILE%\docflow-restore). Mirrored:
    <RestoreTo>\files for versions (and <RestoreTo>\uploads for a pre-C5.4 set's legacy tree).
.PARAMETER PgBin
    Folder containing pg_restore.exe (default: $env:PG_BIN or auto-detected).
.PARAMETER AdminUrl
    Superuser connection string used to recreate the target (default: $env:PG_ADMIN_URL).

.EXAMPLE
    $env:PG_ADMIN_URL = 'postgres://postgres@localhost:5432/postgres'
    powershell -NoProfile -ExecutionPolicy Bypass -File ops\windows\restore.ps1 -From C:\Users\me\docflow-backups\2026-09-07
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$From,
    [string]$Target = 'docflow_restore',
    [string]$RestoreTo = '',
    [string]$PgBin = '',
    [string]$AdminUrl = ''
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

if (-not $RestoreTo) { $RestoreTo = Join-Path $env:USERPROFILE 'docflow-restore' }
if (-not $PgBin) { $PgBin = $env:PG_BIN }
if (-not $AdminUrl) { $AdminUrl = $env:PG_ADMIN_URL }
if ($Target -notmatch '^docflow_restore[a-z0-9_]*$') {
    throw "Target must be docflow_restore or docflow_restore_<suffix>. This script never restores over the live database."
}

$repo = Get-RepoRoot
$serverDir = Join-Path $repo 'server'
# The restored DATA_ROOT. Storage keys start with "files/", so this is the root
# they hang off - exactly as DATA_ROOT is on the live system.
$restoreRoot = [System.IO.Path]::GetFullPath($RestoreTo)
$filesFull = Join-Path $restoreRoot 'files'
$uploadsFull = Join-Path $restoreRoot 'uploads'
if ($restoreRoot.StartsWith($repo, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "RestoreTo must be outside the repository (it is mirrored, and the live document store lives there)"
}

$startedAt = Get-Date
$set = (Resolve-Path $From).Path
$manifestPath = Join-Path $set 'manifest.json'
if (-not (Test-Path $manifestPath)) { throw "No manifest.json in $set" }
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
# A pre-C5.4 set also carries the legacy server\uploads tree. New sets do not,
# and under StrictMode reading a property that is not there is an error - so ask
# first. Restoring an older set has to keep working; that is what a backup is for.
$manifestUploads = @()
if ($manifest.PSObject.Properties.Name -contains 'uploads' -and $manifest.uploads) {
    $manifestUploads = @($manifest.uploads)
}

$failures = @()

# 1. Verify the backup set.
Write-Log "Verifying backup set $set"
$writtenBy = 'pg_dump version not recorded'
if ($manifest.PSObject.Properties.Name -contains 'pgDumpVersion' -and $manifest.pgDumpVersion) { $writtenBy = $manifest.pgDumpVersion }
Write-Log "  created $($manifest.createdAt) on $($manifest.host), database '$($manifest.database)', $writtenBy"
$dumpPath = Join-Path $set $manifest.dump.file
if (-not (Test-Path $dumpPath)) { throw "Dump file missing: $dumpPath" }
if ((Get-Sha256 $dumpPath) -ne $manifest.dump.sha256) { throw 'db.dump sha256 does not match the manifest - the backup set is damaged' }
$bad = 0
foreach ($u in $manifestUploads) {
    $p = Join-Path (Join-Path $set 'uploads') ($u.path -replace '/', '\')
    if (-not (Test-Path $p)) { Write-Log "  MISSING upload $($u.path)"; $bad++; continue }
    if ((Get-Sha256 $p) -ne $u.sha256) { Write-Log "  DAMAGED upload $($u.path)"; $bad++ }
}
# Manifest v2 also lists every document version. A v1 set has no files block;
# it restores as before, which is what makes an old backup still usable.
$manifestFiles = @()
if ($manifest.PSObject.Properties.Name -contains 'files' -and $manifest.files) { $manifestFiles = @($manifest.files.entries) }
foreach ($f in $manifestFiles) {
    $p = Join-Path $set ($f.path -replace '/', '\')
    if (-not (Test-Path $p)) { Write-Log "  MISSING version file $($f.path)"; $bad++; continue }
    if ((Get-Sha256 $p) -ne $f.sha256) { Write-Log "  DAMAGED version file $($f.path)"; $bad++ }
}
if ($bad -gt 0) { throw "$bad file(s) in the backup set are missing or damaged" }
Write-Log "  dump OK ($(Format-Bytes $manifest.dump.bytes)); $($manifestFiles.Count) version file(s) and $($manifestUploads.Count) legacy file(s) OK"

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

# 4. Files: versions under <RestoreTo>\files (storage keys already start with
#    "files/", so RestoreTo is the DATA_ROOT of the restored system), plus the
#    legacy tree beside it when restoring a set taken before C5.4.
Write-Log "Mirroring document versions to $filesFull"
New-Item -ItemType Directory -Force -Path $filesFull | Out-Null
& robocopy (Join-Path $set 'files') $filesFull /MIR /R:2 /W:5 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy exited with $LASTEXITCODE (files)" }

$uploadsSet = Join-Path $set 'uploads'
if (Test-Path $uploadsSet) {
    Write-Log "Mirroring legacy uploads to $uploadsFull (pre-C5.4 set)"
    New-Item -ItemType Directory -Force -Path $uploadsFull | Out-Null
    & robocopy $uploadsSet $uploadsFull /MIR /R:2 /W:5 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy exited with $LASTEXITCODE (uploads)" }
}

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
$integrity = Invoke-NodeJson -Script (Join-Path $serverDir 'scripts\integrity.mjs') `
    -Arguments @('--url', $restoreUrl, '--data-root', $restoreRoot, '--manifest', $manifestPath) -IgnoreExitCode
$rows += [pscustomobject]@{ item = 'versions verified'; manifest = $manifestFiles.Count; restored = $integrity.checkedVersions; ok = [bool]$integrity.ok }
if (-not $integrity.ok) {
    foreach ($m in @($integrity.missing)) { $failures += "missing $($m.kind) file $($m.path) ($($m.id))" }
    foreach ($m in @($integrity.mismatched)) { $failures += "$($m.path): $($m.reason)" }
}

$rows | Format-Table -AutoSize | Out-String -Width 120 | Write-Host
$elapsed = (Get-Date) - $startedAt
if ($failures.Count -eq 0) {
    Write-Log ("RESTORE DRILL PASS  database={0}  documents={1}  elapsed={2:N1}s" -f $Target, $restoreRoot, $elapsed.TotalSeconds)
    exit 0
}
foreach ($f in $failures) { Write-Log "  FAIL: $f" }
Write-Log ("RESTORE DRILL FAIL  ({0} problem(s))  elapsed={1:N1}s" -f $failures.Count, $elapsed.TotalSeconds)
exit 1
