# The steward's waker, started and stopped with the shift (STEWARD-ASSISTANT-DESIGN.md): hidden window, one instance
# per home, not a Monitor. It runs only where the steward is installed (steward-config.json beside this script,
# written at Owner's word); elsewhere start and stop say so and do nothing.
#   powershell -NoProfile -ExecutionPolicy Bypass -File Start-Steward.ps1 [-Action start|stop|status]
param([ValidateSet('start', 'stop', 'status')][string]$Action = 'status')
$ErrorActionPreference = 'Stop'
$opHome = $PSScriptRoot
$pidFile = Join-Path $opHome 'stwake.pid'
$out = Join-Path $opHome 'stwake.out'
$errLog = Join-Path $opHome 'stwake.err'
$cfg = Join-Path $opHome 'steward-config.json'

# The pid file counts only while that pid is still this waker: node running stwake.cjs. Windows reuses pids after a
# hibernate or a restart, and a pid alone would say "already running" for whatever process has the number now (so a
# dead steward goes unnoticed while requests wait), and stop would end that other process. A pid file that names
# something else is removed.
function Get-Running {
  if (-not (Test-Path $pidFile)) { return $null }
  $p = "$(Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)".Trim()
  if ($p -match '^\d+$') {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $p" -ErrorAction SilentlyContinue
    if ($proc -and $proc.Name -match '^node(\.exe)?$' -and
      "$($proc.CommandLine)" -like '*stwake.cjs*') { return [int]$p }
  }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
  return $null
}

if (-not (Test-Path $cfg)) { 'no steward on this machine (no steward-config.json)'; exit 0 }
switch ($Action) {
  'status' {
    # what it is doing now, so a restart is made only when no job is running
    $p = Get-Running; $cur = Join-Path $opHome 'steward-state\current-job.json'
    if (-not $p) { 'not running' }
    elseif (Test-Path $cur) {
      $j = Get-Content $cur -Raw | ConvertFrom-Json
      "running, pid $p; on a $($j.kind) job since $($j.since): do not restart now; log stwake.log"
    }
    else { "running, pid $p; no job running; log stwake.log" }
  }
  'stop' {
    $p = Get-Running
    if ($p) {
      Stop-Process -Id $p -Force; Remove-Item $pidFile -ErrorAction SilentlyContinue
      Remove-Item (Join-Path $opHome 'stwake.lock') -ErrorAction SilentlyContinue; "stopped pid $p"
    } else { 'not running' }
  }
  'start' {
    $p = Get-Running
    if ($p) { "already running, pid $p"; break }
    if (-not (Test-Path (Join-Path $opHome 'LH-STEWARD-TOKEN.txt'))) {
      throw 'no LH-STEWARD-TOKEN.txt beside this script'
    }
    $argString = '"{0}"' -f (Join-Path $opHome 'stwake.cjs')
    $proc = Start-Process -FilePath 'node' -ArgumentList $argString -WorkingDirectory $opHome -WindowStyle Hidden `
      -RedirectStandardOutput $out -RedirectStandardError $errLog -PassThru
    Set-Content $pidFile $proc.Id
    "started, pid $($proc.Id); log stwake.log"
  }
}
