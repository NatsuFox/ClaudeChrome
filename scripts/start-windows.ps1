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

function Find-BashCommand() {
    if ($env:CLAUDECHROME_BASH_PATH) {
        if (Test-Path $env:CLAUDECHROME_BASH_PATH) {
            return $env:CLAUDECHROME_BASH_PATH
        }
        throw "CLAUDECHROME_BASH_PATH points to a missing file: $($env:CLAUDECHROME_BASH_PATH)"
    }

    $bashCommand = Get-Command bash -ErrorAction SilentlyContinue
    if ($null -ne $bashCommand -and $bashCommand.Source) {
        return $bashCommand.Source
    }

    $candidates = @(
        $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'Git\bin\bash.exe' }),
        $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'Git\usr\bin\bash.exe' }),
        $(if ($env:'ProgramFiles(x86)') { Join-Path $env:'ProgramFiles(x86)' 'Git\bin\bash.exe' }),
        $(if ($env:'ProgramFiles(x86)') { Join-Path $env:'ProgramFiles(x86)' 'Git\usr\bin\bash.exe' }),
        $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs\Git\bin\bash.exe' }),
        $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs\Git\usr\bin\bash.exe' })
    ) | Where-Object { $_ }

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return $null
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

$bashCommand = Find-BashCommand
if (-not $bashCommand) {
    throw "bash was not found. Install Git Bash or WSL, or set CLAUDECHROME_BASH_PATH to bash.exe."
}
$env:CLAUDECHROME_BASH_PATH = $bashCommand

$nodeVersion = node -v
$npmVersion = npm -v
$bashVersion = (& $bashCommand --version | Select-Object -First 1)

Write-Host "Node: $nodeVersion"
Write-Host "npm:  $npmVersion"
Write-Host "bash: $bashVersion"
Write-Host "bash path: $bashCommand"

$extensionManifest = Join-Path $repoRoot 'dist/manifest.json'
$nativeHostEntry = Join-Path $repoRoot 'native-host/dist/main.js'
$rootNodeModules = Join-Path $repoRoot 'node_modules'
$nativeHostNodeModules = Join-Path $repoRoot 'native-host/node_modules'

$needsInstallOrBuild = $Rebuild -or -not (Test-Path $extensionManifest) -or -not (Test-Path $nativeHostEntry) -or -not (Test-Path $rootNodeModules) -or -not (Test-Path $nativeHostNodeModules)

if ($needsInstallOrBuild) {
    Write-Section "Dependencies or build artifacts missing; installing and building"
    npm install
    if ($LASTEXITCODE -ne 0) { throw "Root npm install failed." }

    npm install --prefix native-host
    if ($LASTEXITCODE -ne 0) { throw "native-host npm install failed." }

    npm run package
    if ($LASTEXITCODE -ne 0) { throw "npm run package failed." }
}
else {
    Write-Section "Dependencies and build artifacts already exist; skipping install/build"
    Write-Host "Extension manifest: $extensionManifest"
    Write-Host "Host entry: $nativeHostEntry"
    Write-Host "Root node_modules: $rootNodeModules"
    Write-Host "Native host node_modules: $nativeHostNodeModules"
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
