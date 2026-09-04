$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
Set-Location $projectRoot

function Invoke-NativeCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Command,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command failed with exit code $LASTEXITCODE."
  }
}

try {
  Write-Output 'Plainify Windows installer'
  Write-Output ''

  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($null -eq $nodeCommand -or $null -eq $npmCommand) {
    Start-Process 'https://nodejs.org/zh-cn/download'
    throw 'Install Node.js 20.19 or newer, then run install-windows.cmd again.'
  }

  $nodeVersion = [version](& $nodeCommand.Source -p 'process.versions.node')
  if ($nodeVersion -lt [version]'20.19.0') {
    Start-Process 'https://nodejs.org/zh-cn/download'
    throw "Node.js $nodeVersion is too old. Install Node.js 20.19 or newer, then try again."
  }

  Write-Output '[1/3] Installing project dependencies'
  Invoke-NativeCommand $npmCommand.Source ci

  Write-Output '[2/3] Installing login auto-start service'
  Invoke-NativeCommand $nodeCommand.Source 'server/install-service.mjs'

  Write-Output '[3/3] Checking the local service'
  $serviceReady = $false
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    try {
      $api = Invoke-WebRequest -Uri 'http://127.0.0.1:8787/api/health' -UseBasicParsing -TimeoutSec 1
      $website = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 1
      if ($api.StatusCode -eq 200 -and $website.StatusCode -eq 200) {
        $serviceReady = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }

  if (-not $serviceReady) {
    throw 'The local service did not start. Run npm run service:status and inspect the .logs folder.'
  }

  Start-Process 'http://127.0.0.1:5173/'
  Write-Output ''
  Write-Output 'Installation complete. Plainify is open in your browser.'
  exit 0
} catch {
  Write-Error "Installation failed: $($_.Exception.Message)"
  exit 1
}
