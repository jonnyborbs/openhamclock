# OpenHamClock - Windows Update Script
#
# Run in PowerShell from your openhamclock directory:
#   Set-ExecutionPolicy Bypass -Scope Process -Force
#   .\scripts\update.ps1
#

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Blue
Write-Host "         OpenHamClock Update Script (Windows)              " -ForegroundColor Blue
Write-Host "===========================================================" -ForegroundColor Blue
Write-Host ""

# Must be run from the openhamclock directory
if (-not (Test-Path "server.js") -or -not (Test-Path "package.json")) {
    Write-Host "ERROR: Please run this script from the openhamclock directory" -ForegroundColor Red
    Write-Host "  cd C:\path\to\openhamclock"
    Write-Host "  .\scripts\update.ps1"
    exit 1
}

# Check for Git
try {
    git --version | Out-Null
}
catch {
    Write-Host "ERROR: git is not installed or not on PATH" -ForegroundColor Red
    Write-Host "  Download from https://git-scm.com/"
    exit 1
}

# Check for Node.js
try {
    node -v | Out-Null
}
catch {
    Write-Host "ERROR: Node.js is not installed or not on PATH" -ForegroundColor Red
    Write-Host "  Download from https://nodejs.org/"
    exit 1
}

# Save current version
$oldVersion = (Get-Content package.json | Select-String '"version"' | Select-Object -First 1) -replace '.*"version":\s*"([^"]+)".*', '$1'
Write-Host "Current version: $oldVersion"
Write-Host ""

Write-Host "Backing up configuration..."
if (Test-Path ".env") {
    Copy-Item ".env" ".env.backup" -Force
    Write-Host "   [OK] .env -> .env.backup" -ForegroundColor Green
}
if (Test-Path "config.json") {
    Copy-Item "config.json" "config.json.backup" -Force
    Write-Host "   [OK] config.json -> config.json.backup" -ForegroundColor Green
}
Write-Host ""

Write-Host "Pulling latest changes..."
git pull
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git pull failed. Check your internet connection." -ForegroundColor Red
    exit 1
}
Write-Host ""

Write-Host "Installing dependencies..."
$env:ELECTRON_SKIP_BINARY_DOWNLOAD = "1"
npm ci --ignore-scripts
if ($LASTEXITCODE -ne 0) {
    Write-Host "   npm ci failed, trying npm install..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: npm install failed." -ForegroundColor Red
        exit 1
    }
}
Write-Host ""

Write-Host "Building frontend..."
if (Test-Path "dist") { Remove-Item "dist" -Recurse -Force }
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Build failed." -ForegroundColor Red
    exit 1
}
Write-Host ""

Write-Host "Restoring configuration..."
if ((Test-Path ".env.backup") -and -not (Test-Path ".env")) {
    Copy-Item ".env.backup" ".env" -Force
    Write-Host "   [OK] .env restored from backup" -ForegroundColor Green
}
if ((Test-Path "config.json.backup") -and -not (Test-Path "config.json")) {
    Copy-Item "config.json.backup" "config.json" -Force
    Write-Host "   [OK] config.json restored from backup" -ForegroundColor Green
}

$newVersion = (Get-Content package.json | Select-String '"version"' | Select-Object -First 1) -replace '.*"version":\s*"([^"]+)".*', '$1'

Write-Host ""
if ($oldVersion -eq $newVersion) {
    Write-Host "Version: $newVersion (unchanged)" -ForegroundColor Yellow
} else {
    Write-Host "Updated: $oldVersion -> $newVersion" -ForegroundColor Green
}

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Green
Write-Host "                  Update Complete!                         " -ForegroundColor Green
Write-Host "===========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Restart the server to apply changes:" -ForegroundColor Blue
Write-Host ""
Write-Host "    npm start"
Write-Host "    # or double-click start.bat"
Write-Host ""
Write-Host "  73 de OpenHamClock!" -ForegroundColor Blue
Write-Host ""
