<#
.SYNOPSIS
    Windows Firewall rules for the DocFlow pilot machine (C5.3).

.DESCRIPTION
    Two inbound rules, and one deliberate absence.

    Allowed:  TCP 80 and 443, to Caddy. That is the entire public surface.
    Blocked:  everything else inbound, including 4000 (the API), 5432 (Postgres)
              and 3310 (clamd). Those three bind to 127.0.0.1 already; these
              rules are the second lock, for the day someone changes a bind
              address without thinking about it.

    The absence: no rule opens Postgres to the LAN. If a future "let me look at
    the database from my laptop" needs one, it belongs in an SSH tunnel, not
    here.

    Run elevated. Idempotent: existing DocFlow rules are replaced, never
    duplicated.

.PARAMETER Remove
    Removes the DocFlow rules instead of creating them.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File ops\windows\firewall.ps1
#>
[CmdletBinding()]
param(
    [switch]$Remove
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'Run this from an elevated PowerShell (firewall rules need administrator).' }

$rules = @(
    @{ Name = 'DocFlow HTTP (Caddy)';  Port = 80;  Note = 'Let''s Encrypt HTTP-01 and the redirect to HTTPS' },
    @{ Name = 'DocFlow HTTPS (Caddy)'; Port = 443; Note = 'The portal itself' }
)
$blocked = @(
    @{ Name = 'DocFlow API (loopback only)';      Port = 4000; Note = 'Express; already bound to 127.0.0.1' },
    @{ Name = 'DocFlow Postgres (loopback only)'; Port = 5432; Note = 'listen_addresses = localhost' },
    @{ Name = 'DocFlow clamd (loopback only)';    Port = 3310; Note = 'TCPAddr 127.0.0.1' }
)

foreach ($r in ($rules + $blocked)) {
    $existing = Get-NetFirewallRule -DisplayName $r.Name -ErrorAction SilentlyContinue
    if ($existing) {
        Remove-NetFirewallRule -DisplayName $r.Name
        Write-Log "Removed existing rule '$($r.Name)'"
    }
}

if ($Remove) {
    Write-Log 'DocFlow firewall rules removed.'
    exit 0
}

foreach ($r in $rules) {
    New-NetFirewallRule -DisplayName $r.Name -Direction Inbound -Action Allow `
        -Protocol TCP -LocalPort $r.Port -Profile Any -Program Any | Out-Null
    Write-Log "ALLOW inbound TCP $($r.Port)  — $($r.Note)"
}

foreach ($r in $blocked) {
    New-NetFirewallRule -DisplayName $r.Name -Direction Inbound -Action Block `
        -Protocol TCP -LocalPort $r.Port -Profile Any -Program Any | Out-Null
    Write-Log "BLOCK inbound TCP $($r.Port) — $($r.Note)"
}

Write-Log ''
Write-Log 'Check from ANOTHER machine on the same network:'
Write-Log '  Test-NetConnection <this-machine> -Port 443   -> TcpTestSucceeded True'
Write-Log '  Test-NetConnection <this-machine> -Port 4000  -> TcpTestSucceeded False'
Write-Log '  Test-NetConnection <this-machine> -Port 5432  -> TcpTestSucceeded False'
Write-Log 'A False for 443 usually means the router is not forwarding, not that this rule is wrong.'
