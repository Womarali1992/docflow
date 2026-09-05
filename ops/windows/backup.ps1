<#
.SYNOPSIS
    DocFlow backup, v1 (legacy schema): pg_dump + copy of server\uploads + manifest + prune.

.DESCRIPTION
    Writes one self-contained backup set per run under <Dest>\<yyyy-MM-dd>:
        db.dump          pg_dump custom-format archive of the DATABASE_URL database
        uploads\         verified copy of server\uploads (v1: files are mutable, so a full copy per set)
        config\          server.env (contains secrets - Dest must be an encrypted volume) and the migrations journal
        manifest.json    sha256 of the dump and every file, row counts, versions
    Then removes sets older than -Keep days. Order is dump -> files -> manifest so the manifest
    describes exactly what is on disk. Never writes inside the repository.

    Reads DATABASE_URL from server\.env. Needs node on PATH and the PostgreSQL client tools
    ($env:PG_BIN, or the newest install under Program Files).

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

Write-Log "DocFlow backup v1 -> $destFull"
Write-Log "Database '$($conn.Database)' on $($conn.Host):$($conn.Port) as $($conn.User); $pgDumpVersion"

New-Item -ItemType Directory -Force -Path $destFull | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd'
if (Test-Path (Join-Path $destFull $stamp)) { $stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss' }
$set = Join-Path $destFull $stamp
New-Item -ItemType Directory -Path $set | Out-Null

try {
    # 1. Row counts first: proves the database is reachable and records what the dump should contain.
    Write-Log 'Counting rows'
    $counts = Invoke-NodeJson -Script (Join-Path $serverDir 'scripts\count.mjs')

    # 2. Dump.
    $dumpPath = Join-Path $set 'db.dump'
    Write-Log "pg_dump -Fc -> $dumpPath"
    $env:PGPASSWORD = $conn.Password
    try {
        & $pgDump -Fc -h $conn.Host -p $conn.Port -U $conn.User -d $conn.Database -f $dumpPath
        if ($LASTEXITCODE -ne 0) { throw "pg_dump exited with $LASTEXITCODE" }
    } finally {
        Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    }
    $dumpBytes = (Get-Item $dumpPath).Length
    $dumpSha = Get-Sha256 $dumpPath
    Write-Log "  dump $(Format-Bytes $dumpBytes), sha256 $($dumpSha.Substring(0, 12))..."

    # 3. Uploaded files, verified after the copy.
    $uploads = @()
    $uploadBytes = 0
    $uploadsDest = Join-Path $set 'uploads'
    if (Test-Path $uploadsSrc) {
        Write-Log "Copying uploads from $uploadsSrc"
        & robocopy $uploadsSrc $uploadsDest /E /R:2 /W:5 /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "robocopy exited with $LASTEXITCODE" }
        if (-not (Test-Path $uploadsDest)) { New-Item -ItemType Directory -Path $uploadsDest | Out-Null }
        foreach ($f in @(Get-ChildItem $uploadsDest -File -Recurse)) {
            $rel = $f.FullName.Substring($uploadsDest.Length).TrimStart('\').Replace('\', '/')
            $sha = Get-Sha256 $f.FullName
            $srcSha = Get-Sha256 (Join-Path $uploadsSrc $rel)
            if ($srcSha -ne $sha) { throw "Copy verification failed for $rel (source changed during the backup?)" }
            $uploads += [pscustomobject]@{ path = $rel; bytes = $f.Length; sha256 = $sha }
            $uploadBytes += $f.Length
        }
        Write-Log "  $($uploads.Count) file(s), $(Format-Bytes $uploadBytes), all hashes match the source"
    } else {
        Write-Log "No uploads directory at $uploadsSrc (nothing to copy)"
        New-Item -ItemType Directory -Path $uploadsDest | Out-Null
    }

    # 4. Configuration.
    $configDir = Join-Path $set 'config'
    New-Item -ItemType Directory -Path $configDir | Out-Null
    Copy-Item $envFile (Join-Path $configDir 'server.env')
    $config = @('config/server.env')
    $journal = Join-Path $serverDir 'migrations\meta\_journal.json'
    if (Test-Path $journal) {
        Copy-Item $journal (Join-Path $configDir 'migrations-journal.json')
        $config += 'config/migrations-journal.json'
    }

    # 5. Manifest (written last, so it only ever describes a complete set).
    $manifest = [ordered]@{
        version       = 1
        createdAt     = $startedAt.ToUniversalTime().ToString('o')
        host          = $env:COMPUTERNAME
        database      = $conn.Database
        pgDumpVersion = $pgDumpVersion
        dump          = [ordered]@{ file = 'db.dump'; bytes = $dumpBytes; sha256 = $dumpSha }
        counts        = $counts
        uploadCount   = $uploads.Count
        uploadBytes   = $uploadBytes
        uploads       = @($uploads)
        config        = @($config)
    }
    # UTF-8 without BOM: Set-Content -Encoding UTF8 adds a BOM on PowerShell 5.1, which JSON parsers reject.
    $json = $manifest | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText((Join-Path $set 'manifest.json'), $json, (New-Object System.Text.UTF8Encoding($false)))
    Write-Log "Manifest written"

    # 6. Prune old sets (by the date in the folder name).
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

    $elapsed = (Get-Date) - $startedAt
    Write-Log ("BACKUP OK  set={0}  dump={1}  uploads={2} ({3})  rows: {4}  elapsed={5:N1}s" -f `
        $set, (Format-Bytes $dumpBytes), $uploads.Count, (Format-Bytes $uploadBytes),
        (($counts.tables.PSObject.Properties | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ' '),
        $elapsed.TotalSeconds)
    exit 0
} catch {
    Write-Log "BACKUP FAILED: $($_.Exception.Message)"
    if (Test-Path $set) {
        Rename-Item -Path $set -NewName ($stamp + '_FAILED') -ErrorAction SilentlyContinue
    }
    exit 1
}
