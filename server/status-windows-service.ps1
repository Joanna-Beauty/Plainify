$ErrorActionPreference = 'SilentlyContinue'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $projectRoot '.logs\windows-service.json'
$runnerPath = Join-Path $PSScriptRoot 'run-windows-service.ps1'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$runValue = Get-ItemPropertyValue -Path $runKey -Name 'Plainify'
$autoStartReady = -not [string]::IsNullOrWhiteSpace($runValue)
$runnerReady = $false

if (Test-Path $pidFile) {
  $serviceState = Get-Content -Raw $pidFile | ConvertFrom-Json
  $runnerPid = [int]$serviceState.runnerPid
  $runnerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $runnerPid"
  $runnerReady = $null -ne $runnerProcess.CommandLine -and `
    $runnerProcess.CommandLine.IndexOf($runnerPath, [StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Test-LocalUrl([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

$apiReady = Test-LocalUrl 'http://127.0.0.1:8787/api/health'
$websiteReady = Test-LocalUrl 'http://127.0.0.1:5173/'

Write-Output "Login auto-start: $autoStartReady"
Write-Output "Service runner: $runnerReady"
Write-Output "Backend health: $apiReady"
Write-Output "Website health: $websiteReady"

if ($autoStartReady -and $runnerReady -and $apiReady -and $websiteReady) {
  exit 0
}
exit 1
