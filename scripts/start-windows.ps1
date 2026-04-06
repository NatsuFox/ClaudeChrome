param(
    [int]$Port = 9999,
    [switch]$Rebuild
)

$ErrorActionPreference = 'Stop'

function Write-Section([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Test-CommandAvailable([string]$Name) {
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

Set-Location $repoRoot

Write-Host "ClaudeChrome Windows launcher" -ForegroundColor Green
Write-Host "Repo root: $repoRoot"

Write-Section "Checking runtime prerequisites"

if (-not (Test-CommandAvailable "node")) {
    throw "node was not found. Install Node.js and make sure node is on PATH."
}

if (-not (Test-CommandAvailable "npm")) {
    throw "npm was not found. Install npm and make sure npm is on PATH."
}

if (-not (Test-CommandAvailable "bash")) {
    throw "bash was not found. On Windows, install Git Bash or WSL and make sure bash is on PATH."
}

$nodeVersion = node -v
$npmVersion = npm -v
$bashVersion = (& bash --version | Select-Object -First 1)

Write-Host "Node: $nodeVersion"
Write-Host "npm:  $npmVersion"
Write-Host "bash: $bashVersion"

$extensionManifest = Join-Path $repoRoot 'dist/manifest.json'
$nativeHostEntry = Join-Path $repoRoot 'native-host/dist/main.js'

if ($Rebuild -or -not (Test-Path $extensionManifest) -or -not (Test-Path $nativeHostEntry)) {
    Write-Section "Artifacts missing or -Rebuild was provided; installing and building"
    npm install
    if ($LASTEXITCODE -ne 0) { throw "Root npm install failed." }

    npm install --prefix native-host
    if ($LASTEXITCODE -ne 0) { throw "native-host npm install failed." }

    npm run package
    if ($LASTEXITCODE -ne 0) { throw "npm run package failed." }
}
else {
    Write-Section "Build artifacts already exist; skipping install/build"
    Write-Host "Extension manifest: $extensionManifest"
    Write-Host "Host entry: $nativeHostEntry"
}

Write-Section "Starting ClaudeChrome native-host"
$env:CLAUDECHROME_WS_PORT = [string]$Port

Write-Host "WebSocket port: $Port"
Write-Host "If the extension is not using port $Port, change it in the side panel and click Apply."
Write-Host ""
Write-Host "Keep this window open while using ClaudeChrome. Press Ctrl+C to stop."
Write-Host ""

npm --prefix native-host run start
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    throw "native-host exited with code: $exitCode"
}
