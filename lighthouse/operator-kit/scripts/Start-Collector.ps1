# Lighthouse collector, outside any Claude session: reads the operator's transcript and posts its timed lines to the
# board server. The operator starts it once at "start shift" and stops it at "end shift"; hidden window; one instance
# per home; not a Monitor.
#   powershell -NoProfile -ExecutionPolicy Bypass -File Start-Collector.ps1 [-Action start|stop|status]
# The operator never runs this. Token: LH-COLLECTOR-TOKEN.txt beside this script when the home is in tool mode (a token
# that only reports), otherwise LH-TOKEN.txt. Log: collector.log beside this script.
param([ValidateSet('start', 'stop', 'status')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
$opHome = $PSScriptRoot
$pidFile = Join-Path $opHome 'collector.pid'
$log = Join-Path $opHome 'collector.log'
$errLog = Join-Path $opHome 'collector.err'
$tokenFile = Join-Path $opHome 'LH-TOKEN.txt'
$collectorToken = Join-Path $opHome 'LH-COLLECTOR-TOKEN.txt'
$protocol = 'lines'
# tool mode: the operator's own token is a tool-mode one; the collector reports with its own
if (Test-Path $collectorToken) { $tokenFile = $collectorToken; $protocol = 'tools' }
$transcripts = '__OPERATOR_TRANSCRIPT_DIR__'
# the setting may name the operator's session folder itself: its transcript folder is then that path as Claude Code
# encodes it, under its projects folder (lighthouse-mcp.cjs reads the setting the same way)
if ($transcripts -notmatch '[\\/]\.claude[\\/]projects[\\/][^\\/]+[\\/]?$') {
  $claudeRoot = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }
  $transcripts = Join-Path (Join-Path $claudeRoot 'projects') `
    ([System.IO.Path]::GetFullPath($transcripts).TrimEnd('\', '/') -replace '[^A-Za-z0-9]', '-')
}
$server = '__BOARD_SERVER__'
$board = '__BOARD_ID__'

# The pid file counts only while that pid is still this collector: a process running collector.py. Windows reuses pids
# after a hibernate or a restart, and a pid alone would say "already running" for whatever process has the number now,
# and stop would end that other process. A pid file that names something else is removed.
function Get-Running {
  if (-not (Test-Path $pidFile)) { return $null }
  $p = "$(Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)".Trim()
  if ($p -match '^\d+$') {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $p" -ErrorAction SilentlyContinue
    if ($proc -and "$($proc.CommandLine)" -like '*collector.py*') { return [int]$p }
  }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
  return $null
}

switch ($Action) {
  'status' { $p = Get-Running; if ($p) { "running, pid $p; log $log" } else { 'not running' } }
  'stop' {
    $p = Get-Running
    if ($p) {
      Stop-Process -Id $p -Force; Remove-Item $pidFile -ErrorAction SilentlyContinue; "stopped pid $p"
    } else { 'not running' }
  }
  'start' {
    $p = Get-Running
    if ($p) { "already running, pid $p"; break }
    if (-not (Test-Path $tokenFile)) { throw "no token file at $tokenFile" }
    if (-not (Test-Path $transcripts)) { New-Item -ItemType Directory -Force $transcripts | Out-Null }
    $env:LH_TOKEN = (Get-Content $tokenFile | Select-Object -First 1).Trim()
    # the collector's log is a redirected file, which Python would open in the Windows code page and choke on the clock
    # character; the child inherits these and writes UTF-8
    $env:PYTHONUTF8 = '1'; $env:PYTHONIOENCODING = 'utf-8'
    # one quoted argument string: Windows PowerShell 5.1 joins an array with spaces and would split a path with a space
    $argString = ('collector.py --transcript-dir "{0}" --board {1} --server {2} --interval 5 --protocol {3}' -f
      $transcripts, $board, $server, $protocol)
    $proc = Start-Process -FilePath 'python' -ArgumentList $argString -WorkingDirectory $opHome -WindowStyle Hidden `
      -RedirectStandardOutput $log -RedirectStandardError $errLog -PassThru
    Set-Content $pidFile $proc.Id
    "started, pid $($proc.Id); log $log"
  }
}
