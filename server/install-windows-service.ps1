param(
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$logsDirectory = Join-Path $projectRoot '.logs'
$pidFile = Join-Path $logsDirectory 'windows-service.json'
$runnerPath = Join-Path $PSScriptRoot 'run-windows-service.ps1'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$powershellPath = (Get-Process -Id $PID).Path
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$runValueName = 'Plainify'
$runCommand = '"{0}" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{1}" -NodePath "{2}"' -f `
  $powershellPath, $runnerPath, $nodePath

if ($DryRun) {
  Write-Output 'PASS Windows service installer dry run'
  Write-Output "Project root: $projectRoot"
  exit 0
}

New-Item -ItemType Directory -Path $logsDirectory -Force | Out-Null
New-Item -Path $runKey -Force | Out-Null

if (Test-Path $pidFile) {
  try {
    $serviceState = Get-Content -Raw $pidFile | ConvertFrom-Json
    $runnerPid = [int]$serviceState.runnerPid
    $runnerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $runnerPid" -ErrorAction Stop
    $isCurrentRunner = $null -ne $runnerProcess.CommandLine -and `
      $runnerProcess.CommandLine.IndexOf($runnerPath, [StringComparison]::OrdinalIgnoreCase) -ge 0
    if ($isCurrentRunner) {
      & taskkill.exe /PID $runnerPid /T /F | Out-Null
      if ($LASTEXITCODE -ne 0) {
        throw "Could not stop the existing Plainify service process $runnerPid."
      }
      Start-Sleep -Milliseconds 500
    }
  } catch {
    # A stale state file is replaced when the new runner starts.
  }
}

New-ItemProperty -Path $runKey -Name $runValueName -Value $runCommand -PropertyType String -Force | Out-Null

$runnerArguments = @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-WindowStyle', 'Hidden',
  '-File', ('"{0}"' -f $runnerPath),
  '-NodePath', ('"{0}"' -f $nodePath)
)
Start-Process -FilePath $powershellPath -ArgumentList $runnerArguments -WindowStyle Hidden | Out-Null

Write-Output 'Plainify background service installed for the current Windows user.'
Write-Output "Website: http://127.0.0.1:5173/"
Write-Output "Backend: http://127.0.0.1:8787/api/health"
Write-Output "Logs: $logsDirectory"
