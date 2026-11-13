# Stops the watcher, route and gate processes of one operator home on Windows.
#   powershell -File Kill-Watchers.ps1 -OperatorHome "C:\Users\me\lighthouse-operator"
# Two grounds, and only these:
#   1. The kit's own processes name themselves: each watcher writes <script>.pid in the home, the sweep writes lh.pid,
#      every gate lists itself in gate-pids.json (re-registered every tick) and the last gate names itself in
#      gate-heartbeat.json. Those pids are this home's whatever launched them and from wherever: a wrapper in a scratch
#      folder can start the watchers with the home as working directory, so nothing else ever names the home. A listed
#      pid is stopped only if the process it names still runs one of our scripts, so a reused pid is safe.
#   2. A process running one of our scripts whose own command line names this home: the shell a Monitor started with
#      `cd <home> && ...`, left behind when the Monitor was stopped.
# Parentage is deliberately NOT a ground. Git Bash's fork emulation gives a script's helper children (the sweep's
# `sleep &` subshell, a pipeline segment) the script's own command line and a short-lived Windows parent that has often
# already exited, so "Windows parent gone" is not "orphan": deciding by it would kill a live sweep. -OrphansOnly is
# accepted for compatibility and changes nothing.
param([Parameter(Mandatory = $true)][string]$OperatorHome, [switch]$OrphansOnly)
# every script the kit runs as a watcher, route or gate, conductwatch included
$names = '(?<![\w.-])(fmwatch\.cjs|stwatch\.cjs|boardwatch\.cjs|conductwatch\.cjs|' +
  'lighthouse-sweep\.sh|gate\.cjs|route\.sh|watch\.sh|monitor\.cjs)(?![\w.-])'
# C:\x, C:/x, /c/x
$homeForms = @($OperatorHome, ($OperatorHome -replace '\\', '/'),
  ('/' + ($OperatorHome.Substring(0, 1).ToLower()) + ($OperatorHome.Substring(2) -replace '\\', '/')))
# the home's own folder name, for a command line that carries the path in Windows' short 8.3 form
$leaf = [regex]::Escape((Split-Path -Leaf $OperatorHome))
function InHome($cmd) {
  if (-not $cmd) { return $false }
  foreach ($h in $homeForms) { if ($cmd.IndexOf($h, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true } }
  return [bool]($cmd -match ('[\\/]' + $leaf + '([\\/"''\s]|$)'))
}
function Short($cmd) {
  $w = ($cmd -replace '^"[^"]*"\s*', '') -replace '\s+', ' '
  if ($w.Length -gt 70) { $w = $w.Substring(0, 70) + '...' }
  return $w
}
$all = Get-CimInstance Win32_Process
$byId = @{}; foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }
$stopped = 0; $done = @{}
# ---- 1. listed pids ----
$listed = @{}
foreach ($pf in @('fmwatch.cjs.pid', 'stwatch.cjs.pid', 'boardwatch.cjs.pid', 'conductwatch.cjs.pid', 'lh.pid')) {
  $fp = Join-Path $OperatorHome $pf
  if (Test-Path $fp) {
    $v = (Get-Content $fp -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($v -match '^\d+$') { $listed[[int]$v] = $pf }
  }
}
$rf = Join-Path $OperatorHome 'gate-pids.json'
foreach ($lease in Get-ChildItem -LiteralPath $OperatorHome -Filter 'monitor-*.json' -ErrorAction SilentlyContinue) {
  try {
    $owner = Get-Content -LiteralPath $lease.FullName -Raw | ConvertFrom-Json
    if ($owner.pid) { $listed[[int]$owner.pid] = $lease.Name }
  } catch {}
}
if (Test-Path $rf) {
  try {
    $reg = Get-Content $rf -Raw | ConvertFrom-Json
    foreach ($k in $reg.PSObject.Properties.Name) { if ($k -match '^\d+$') { $listed[[int]$k] = 'gate-pids.json' } }
  } catch {}
}
$hf = Join-Path $OperatorHome 'gate-heartbeat.json'
if (Test-Path $hf) {
  try {
    $hb = Get-Content $hf -Raw | ConvertFrom-Json
    if ($hb.pid) { $listed[[int]$hb.pid] = 'gate-heartbeat.json' }
  } catch {}
}
foreach ($lp in $listed.Keys) {
  $p = $byId[$lp]
  if (-not $p -or -not $p.CommandLine -or $p.CommandLine -notmatch $names -or $lp -eq $PID) { continue }
  try {
    Stop-Process -Id $lp -Force -ErrorAction Stop; $stopped++; $done[$lp] = $true
    "stopped ${lp}: $(Short $p.CommandLine) (listed in $($listed[$lp]))"
  } catch { "could not stop ${lp}: $(Short $p.CommandLine)" }
}
# ---- 2. shells and processes whose command line names this home ----
foreach ($p in $all) {
  if ($done[[int]$p.ProcessId] -or $p.ProcessId -eq $PID) { continue }
  if (-not $p.CommandLine -or $p.CommandLine -notmatch $names -or
    $p.CommandLine -match 'Kill-Watchers\.ps1') { continue }
  if (-not (InHome $p.CommandLine)) { continue }
  try {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; $stopped++
    "stopped $($p.ProcessId): $(Short $p.CommandLine) (started from this home)"
  } catch { "could not stop $($p.ProcessId): $(Short $p.CommandLine)" }
}
if ($stopped -eq 0) { 'no watcher, route or gate processes of this home are running' }
