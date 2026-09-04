param(
  [Parameter(Mandatory = $true)]
  [string]$NodePath
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$logsDirectory = Join-Path $projectRoot '.logs'
$pidFile = Join-Path $logsDirectory 'windows-service.json'
$stdoutLog = Join-Path $logsDirectory 'service.log'
$stderrLog = Join-Path $logsDirectory 'service-error.log'
$previousStdoutLog = Join-Path $logsDirectory 'service-previous.log'
$previousStderrLog = Join-Path $logsDirectory 'service-error-previous.log'

New-Item -ItemType Directory -Path $logsDirectory -Force | Out-Null
Set-Location $projectRoot
$env:BAIHUABEN_SERVICE_MODE = '1'

while ($true) {
  try {
    if (Test-Path $stdoutLog) {
      Move-Item -Path $stdoutLog -Destination $previousStdoutLog -Force
    }
    if (Test-Path $stderrLog) {
      Move-Item -Path $stderrLog -Destination $previousStderrLog -Force
    }

    $child = Start-Process `
      -FilePath $NodePath `
      -ArgumentList @('--env-file-if-exists=.env.local', 'server/dev.mjs', '--port', '5173') `
      -WorkingDirectory $projectRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutLog `
      -RedirectStandardError $stderrLog `
      -PassThru

    @{
      runnerPid = $PID
      childPid = $child.Id
      projectRoot = $projectRoot
    } | ConvertTo-Json | Set-Content -Path $pidFile -Encoding UTF8

    $child.WaitForExit()
    Add-Content -Path $stderrLog -Value "[$(Get-Date -Format o)] Service exited with code $($child.ExitCode); restarting in 5 seconds."
  } catch {
    Add-Content -Path $stderrLog -Value "[$(Get-Date -Format o)] Service start failed: $($_.Exception.Message)"
  }

  Start-Sleep -Seconds 5
}
