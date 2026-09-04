param(
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$powershellPath = (Get-Process -Id $PID).Path
$repository = 'Joanna-Beauty/Plainify'
$archiveUrl = "https://github.com/$repository/archive/refs/heads/main.zip"
$installDirectory = if ([string]::IsNullOrWhiteSpace($env:PLAINIFY_INSTALL_DIR)) {
  if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    $null
  } else {
    Join-Path $env:LOCALAPPDATA 'Plainify'
  }
} else {
  $env:PLAINIFY_INSTALL_DIR
}
$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ("plainify-install-{0}" -f [guid]::NewGuid())
$archivePath = Join-Path $temporaryDirectory 'plainify.zip'
$sourceDirectory = Join-Path $temporaryDirectory 'Plainify-main'

function Invoke-ProjectInstaller {
  $projectInstaller = Join-Path $installDirectory 'install-windows.ps1'
  & $powershellPath -NoProfile -ExecutionPolicy Bypass -File $projectInstaller
  if ($LASTEXITCODE -ne 0) {
    throw "The project was downloaded to $installDirectory, but installation did not finish."
  }
}

try {
  if ([string]::IsNullOrWhiteSpace($installDirectory)) {
    throw 'LOCALAPPDATA is unavailable, so the install directory cannot be resolved.'
  }

  if ($DryRun) {
    Write-Output 'PASS Windows GitHub installer dry run'
    Write-Output "Install directory: $installDirectory"
    exit 0
  }

  Write-Output 'Plainify GitHub installer for Windows'
  Write-Output ''

  $existingProject = (Test-Path (Join-Path $installDirectory 'package.json') -PathType Leaf) -and `
    (Test-Path (Join-Path $installDirectory 'install-windows.ps1') -PathType Leaf)

  if (Test-Path $installDirectory) {
    if (-not $existingProject) {
      throw "The target already exists but is not a complete Plainify project: $installDirectory"
    }
    Write-Output "Existing project found: $installDirectory"
    Write-Output 'Reusing its files and checking the local service.'
  } else {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null

    Write-Output '[1/2] Downloading the latest source'
    for ($attempt = 1; $attempt -le 3; $attempt += 1) {
      try {
        Invoke-WebRequest -UseBasicParsing -Uri $archiveUrl -OutFile $archivePath
        break
      } catch {
        if ($attempt -eq 3) {
          throw
        }
        Start-Sleep -Seconds 1
      }
    }

    Write-Output "[2/2] Extracting to $installDirectory"
    Expand-Archive -Path $archivePath -DestinationPath $temporaryDirectory
    if (-not (Test-Path (Join-Path $sourceDirectory 'package.json') -PathType Leaf) -or `
        -not (Test-Path (Join-Path $sourceDirectory 'install-windows.ps1') -PathType Leaf)) {
      throw 'The downloaded project is incomplete.'
    }

    $installParent = Split-Path -Parent $installDirectory
    New-Item -ItemType Directory -Path $installParent -Force | Out-Null
    Move-Item -Path $sourceDirectory -Destination $installDirectory
  }

  Invoke-ProjectInstaller
  Write-Output ''
  Write-Output "Project: $installDirectory"
  Write-Output "Browser extension: $(Join-Path $installDirectory 'extension')"
  exit 0
} catch {
  Write-Error "Installation failed: $($_.Exception.Message)"
  exit 1
} finally {
  if (Test-Path $temporaryDirectory) {
    Remove-Item -Path $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }
}
