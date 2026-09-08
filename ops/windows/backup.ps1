<#
.SYNOPSIS
    DocFlow backup, v3: pg_dump + DATA_ROOT files + manifest + backup_runs + prune.

.DESCRIPTION
    Writes one self-contained backup set per run under <Dest>\<yyyy-MM-dd>:
        db.dump          pg_dump custom-format archive of the DATABASE_URL database
        snapshot.json    the version list and row counts read from the SAME exported snapshot
        files\           copy of DATA_ROOT\files - every document version's bytes (immutable, so /XO)
        uploads\         copy of server\uploads, only while that pre-C5.4 tree still exists
        config\          server.env (contains secrets - Dest must be an encrypted volume) and the migrations journal
        manifest.json    sha256 of the dump and every file, row counts, written by npm run backup:manifest
    Then records the run in backup_runs (npm run backup:record) and removes sets older than -Keep days.

    Order is dump -> files -> manifest, so the manifest only ever describes a complete set, and the
    manifest is what makes the set checkable: it fails the run if a file the database expects is
    missing from the copy. Never writes inside the repository.

    Since H6 the dump is taken by scripts\backup-dump.mjs, which opens one REPEATABLE READ
    transaction, exports its snapshot for pg_dump to adopt, and writes the version list and row
    counts it read inside that transaction to snapshot.json. The manifest then describes exactly
    the database the dump contains rather than the database as it is a minute later - no writer is
    paused to achieve it.

    Every byte lives under DATA_ROOT as a document version; the manifest verifies each one against
    the database. C5.4 stops the application reading server\uploads, but the tree is deleted by hand
    afterwards - so this copies it whenever it is still on disk, and simply does not when it is not.
    That is deliberate: the decision is driven by what is on disk, never by which commit is checked
    out, because in between the two the rows still point at those bytes.

    Reads DATABASE_URL and DATA_ROOT from server\.env. Needs node on PATH and the PostgreSQL client
    tools ($env:PG_BIN, or the newest install under Program Files).

.PARAMETER Dest
    Backup root. Default: $env:DOCFLOW_BACKUP_DEST, else %USERPROFILE%\docflow-backups.
.PARAMETER Keep
    Days of backup sets to keep (default 30).
.PARAMETER PgBin
    Folder containing pg_dump.exe (default: $env:PG_BIN or auto-detected).

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File ops\windows\backup.ps1 -Dest E:\docflow-backups
#>
[CmdletBinding()]
param(
    [string]$Dest = '',
    [int]$Keep = 30,
    [string]$PgBin = ''
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

if (-not $Dest) {
    if ($env:DOCFLOW_BACKUP_DEST) { $Dest = $env:DOCFLOW_BACKUP_DEST } else { $Dest = Join-Path $env:USERPROFILE 'docflow-backups' }
}
if (-not $PgBin) { $PgBin = $env:PG_BIN }

$repo = Get-RepoRoot
$serverDir = Join-Path $repo 'server'
# Pre-C5.4 tree. Copied only while it exists; gone once the contraction is done.
$uploadsSrc = Join-Path $serverDir 'uploads'
$envFile = Join-Path $serverDir '.env'
$destFull = [System.IO.Path]::GetFullPath($Dest)
if ($destFull.StartsWith($repo, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Backup destination must be outside the repository ($repo)"
}

$startedAt = Get-Date
$pgBinPath = Get-PgBin -Preferred $PgBin
$pgDump = Join-Path $pgBinPath 'pg_dump.exe'
$pgDumpVersion = ((& $pgDump --version) -join ' ').Trim()
$dotenv = Get-DotEnv $envFile
if (-not $dotenv.ContainsKey('DATABASE_URL')) { throw "DATABASE_URL missing from $envFile" }
$conn = ConvertFrom-DatabaseUrl $dotenv['DATABASE_URL']

# Where document bytes actually live since C2.3. Dev defaults to server\.data.
if ($dotenv.ContainsKey('DATA_ROOT') -and $dotenv['DATA_ROOT']) {
    $dataRoot = [System.IO.Path]::GetFullPath((Join-Path $serverDir $dotenv['DATA_ROOT']))
} else {
    $dataRoot = Join-Path $serverDir '.data'
}
$filesSrc = Join-Path $dataRoot 'files'

Write-Log "DocFlow backup v3 (snapshot-consistent) -> $destFull"
Write-Log "Database '$($conn.Database)' on $($conn.Host):$($conn.Port) as $($conn.User); $pgDumpVersion"

New-Item -ItemType Directory -Force -Path $destFull | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd'
if (Test-Path (Join-Path $destFull $stamp)) { $stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss' }
$set = Join-Path $destFull $stamp
New-Item -ItemType Directory -Path $set | Out-Null

try {
    # 1. Dump and snapshot, from one instant. backup-dump.mjs exports the snapshot,
    #    hands it to pg_dump, and records the version list and row counts it read
    #    inside the same transaction - which is what makes the manifest describe
    #    the database the dump actually contains. It also proves the database is
    #    reachable, which is why the separate count that used to run first is gone.
    $dumpPath = Join-Path $set 'db.dump'
    Write-Log "pg_dump -Fc --snapshot -> $dumpPath"
    $dumpResult = Invoke-NodeJson -Script (Join-Path $serverDir 'scripts\backup-dump.mjs') `
        -Arguments @('--set', $set, '--started', $startedAt.ToUniversalTime().ToString('o'), '--pg-dump', $pgDump)
    $counts = $dumpResult.counts
    $dumpBytes = (Get-Item $dumpPath).Length
    $dumpSha = Get-Sha256 $dumpPath
    Write-Log "  dump $(Format-Bytes $dumpBytes), sha256 $($dumpSha.Substring(0, 12))..."
    Write-Log "  snapshot $($dumpResult.snapshotId): $($dumpResult.versions) version(s), $($dumpResult.legacy) legacy row(s)"

    # 2. Document bytes. Two trees while the legacy one still exists.
    #    Versions are immutable, so /XO copies only what is new - a season's
    #    worth of scans is not re-copied every night.
    $filesDest = Join-Path $set 'files'
    New-Item -ItemType Directory -Path $filesDest -Force | Out-Null
    if (Test-Path $filesSrc) {
        Write-Log "Copying document versions from $filesSrc"
        & robocopy $filesSrc $filesDest /E /XO /R:2 /W:5 /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "robocopy exited with $LASTEXITCODE (files)" }
        $fileCount = @(Get-ChildItem $filesDest -File -Recurse).Count
        Write-Log "  $fileCount version file(s) copied"
    } else {
        Write-Log "No files directory at $filesSrc yet (nothing uploaded since C2.3)"
    }

    #    The legacy tree, for as long as one is still there. C5.4 stops the app
    #    reading server\uploads, but the migration that drops the column and the
    #    hand-deletion of the directory come later - and in that window the rows
    #    still point at these bytes. A backup script that stops copying data
    #    before the data stops being referenced is a way to lose it, so this is
    #    driven by what is on disk, not by which commit is checked out. Once the
    #    tree is gone this is a no-op and the set simply has no uploads\.
    if (Test-Path $uploadsSrc) {
        $uploadsDest = Join-Path $set 'uploads'
        New-Item -ItemType Directory -Path $uploadsDest -Force | Out-Null
        Write-Log "Copying legacy uploads from $uploadsSrc (pre-contraction tree still present)"
        & robocopy $uploadsSrc $uploadsDest /E /R:2 /W:5 /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "robocopy exited with $LASTEXITCODE (uploads)" }
        Write-Log "  $(@(Get-ChildItem $uploadsDest -File -Recurse).Count) legacy file(s) copied"
    }

    # 3. Configuration.
    $configDir = Join-Path $set 'config'
    New-Item -ItemType Directory -Path $configDir | Out-Null
    Copy-Item $envFile (Join-Path $configDir 'server.env')
    $config = @('config/server.env')
    $journal = Join-Path $serverDir 'migrations\meta\_journal.json'
    if (Test-Path $journal) {
        Copy-Item $journal (Join-Path $configDir 'migrations-journal.json')
        $config += 'config/migrations-journal.json'
    }

    # 4. Manifest, written last so it only ever describes a complete set. Node
    #    builds it because it has to read snapshot.json and hash every file - and
    #    it FAILS the backup if a file the snapshot expects is not in the copy,
    #    which is the whole point of having a manifest. The only absence it
    #    forgives is a version quarantined after the snapshot was taken: those
    #    bytes were deleted on purpose, between the two steps.
    Write-Log 'Building the manifest (npm run backup:manifest)'
    $manifestResult = Invoke-NodeJson -Script (Join-Path $serverDir 'scripts\manifest.mjs') `
        -Arguments @('--set', $set, '--started', $startedAt.ToUniversalTime().ToString('o'), '--pg-dump-version', $pgDumpVersion) -IgnoreExitCode
    $manifestPath = Join-Path $set 'manifest.json'
    if (-not $manifestResult.ok) {
        throw "Manifest verification failed: $($manifestResult.fatal.Count) expected file(s) missing or altered - this set could NOT restore the system"
    }
    Write-Log "  $($manifestResult.fileCount) version file(s), $(Format-Bytes $manifestResult.fileBytes), all hashes recorded ($($manifestResult.consistency))"

    # 5. Prune old sets (by the date in the folder name).
    $cutoff = (Get-Date).Date.AddDays(-$Keep)
    $invariant = [System.Globalization.CultureInfo]::InvariantCulture
    foreach ($dir in @(Get-ChildItem $destFull -Directory)) {
        if ($dir.Name -match '^(\d{4}-\d{2}-\d{2})(_\d{6})?(_FAILED)?$') {
            $day = [datetime]::ParseExact($Matches[1], 'yyyy-MM-dd', $invariant)
            if ($day -lt $cutoff) {
                Write-Log "Pruning $($dir.Name) (older than $Keep days)"
                Remove-Item $dir.FullName -Recurse -Force
            }
        }
    }

    # 6. Record the run, so /settings/system can answer "did the backup work?"
    #    without anyone opening a drive. Bookkeeping never fails the backup.
    try {
        Invoke-NodeJson -Script (Join-Path $serverDir 'scripts\record-backup.mjs') `
            -Arguments @('--started', $startedAt.ToUniversalTime().ToString('o'), '--ok', '--manifest', $manifestPath) | Out-Null
        Write-Log 'Recorded in backup_runs'
    } catch {
        Write-Log "WARNING: could not record the run in backup_runs: $($_.Exception.Message)"
    }

    $elapsed = (Get-Date) - $startedAt
    Write-Log ("BACKUP OK  set={0}  dump={1}  files={2} ({3})  rows: {4}  elapsed={5:N1}s" -f `
        $set, (Format-Bytes $dumpBytes), $manifestResult.fileCount, (Format-Bytes $manifestResult.fileBytes),
        (($counts.tables.PSObject.Properties | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ' '),
        $elapsed.TotalSeconds)
    exit 0
} catch {
    $message = $_.Exception.Message
    Write-Log "BACKUP FAILED: $message"
    # A failure is recorded too: a backup that silently stopped happening is the
    # failure this table exists to make visible.
    try {
        Invoke-NodeJson -Script (Join-Path $serverDir 'scripts\record-backup.mjs') `
            -Arguments @('--started', $startedAt.ToUniversalTime().ToString('o'), '--error', $message) | Out-Null
    } catch {
        Write-Log 'WARNING: the failure could not be recorded in backup_runs either'
    }
    if (Test-Path $set) {
        Rename-Item -Path $set -NewName ($stamp + '_FAILED') -ErrorAction SilentlyContinue
    }
    exit 1
}
