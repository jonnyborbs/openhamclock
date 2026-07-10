# OpenHamClock - Windows Setup Script
#
# Run in PowerShell as Administrator:
#   Set-ExecutionPolicy Bypass -Scope Process -Force
#   .\setup-windows.ps1
#

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Blue
Write-Host "           OpenHamClock Windows Setup                      " -ForegroundColor Blue
Write-Host "===========================================================" -ForegroundColor Blue
Write-Host ""

$InstallDir = "$env:USERPROFILE\openhamclock"

# Check for Node.js
function Check-Node {
    try {
        $nodeVersion = node -v
        $versionNumber = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')

        if ($versionNumber -lt 18) {
            Write-Host "Node.js version 18 or later required. Current: $nodeVersion" -ForegroundColor Yellow
            Write-Host "Download from: https://nodejs.org/" -ForegroundColor Yellow
            exit 1
        }

        Write-Host "[OK] Node.js $nodeVersion detected" -ForegroundColor Green
    }
    catch {
        Write-Host "Node.js not found. Please install Node.js 18 or later from https://nodejs.org/" -ForegroundColor Yellow
        exit 1
    }
}

# Check for Git
function Check-Git {
    try {
        git --version | Out-Null
        Write-Host "[OK] Git detected" -ForegroundColor Green
    }
    catch {
        Write-Host "Git not found. Please install Git from https://git-scm.com/" -ForegroundColor Yellow
        exit 1
    }
}

# Setup repository
function Setup-Repository {
    Write-Host ">>> Setting up OpenHamClock..." -ForegroundColor Blue

    if (Test-Path $InstallDir) {
        Write-Host "Updating existing installation..."
        Set-Location $InstallDir
        git pull
        Write-Host "Installing dependencies..."
        $env:ELECTRON_SKIP_BINARY_DOWNLOAD = "1"
        npm ci --ignore-scripts
        if ($LASTEXITCODE -ne 0) { npm install }
        Write-Host "Building frontend..."
        if (Test-Path "dist") { Remove-Item "dist" -Recurse -Force }
        npm run build
    }
    else {
        Write-Host "Cloning repository..."
        git clone https://github.com/accius/openhamclock.git $InstallDir
        Set-Location $InstallDir
        Write-Host "Installing dependencies..."
        $env:ELECTRON_SKIP_BINARY_DOWNLOAD = "1"
        npm ci --ignore-scripts
        Write-Host "Building frontend..."
        npm run build
    }

    Write-Host "[OK] Installation complete" -ForegroundColor Green
}

# Create desktop shortcut
function Create-Shortcut {
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut("$env:USERPROFILE\Desktop\OpenHamClock.lnk")
    $Shortcut.TargetPath = "cmd.exe"
    $Shortcut.Arguments = "/c cd /d `"$InstallDir`" && npm start"
    $Shortcut.WorkingDirectory = $InstallDir
    $Shortcut.Description = "OpenHamClock - Amateur Radio Dashboard"
    $Shortcut.Save()

    Write-Host "[OK] Desktop shortcut created" -ForegroundColor Green
}

# Create batch file launcher
function Create-Launcher {
    $lines = @(
        '@echo off',
        "cd /d `"$InstallDir`"",
        'if not exist "node_modules" (',
        '    echo node_modules not found - running npm install...',
        '    call npm install',
        '    if errorlevel 1 ( echo Install failed ^& pause ^& exit /b 1 )',
        '    call npm run build',
        '    if errorlevel 1 ( echo Build failed ^& pause ^& exit /b 1 )',
        ')',
        'echo Starting OpenHamClock...',
        'echo Open http://localhost:3000 in your browser',
        'npm start',
        'pause'
    )
    Set-Content -Path "$InstallDir\start.bat" -Value $lines -Encoding UTF8
    Write-Host "[OK] Launcher created: $InstallDir\start.bat" -ForegroundColor Green
}

# Print instructions
function Print-Instructions {
    Write-Host ""
    Write-Host "===========================================================" -ForegroundColor Green
    Write-Host "              Installation Complete!                       " -ForegroundColor Green
    Write-Host "===========================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  To start OpenHamClock:" -ForegroundColor Blue
    Write-Host ""
    Write-Host "    1. Double-click the desktop shortcut"
    Write-Host "    2. Or run: $InstallDir\start.bat"
    Write-Host "    3. Or in PowerShell: cd $InstallDir; npm start"
    Write-Host ""
    Write-Host "  Then open: http://localhost:3000" -ForegroundColor Blue
    Write-Host ""
    Write-Host "  For Electron desktop app:" -ForegroundColor Blue
    Write-Host "    npm run electron"
    Write-Host ""
    Write-Host "  73 de OpenHamClock!" -ForegroundColor Blue
    Write-Host ""
}

# Main
Check-Node
Check-Git
Setup-Repository
Create-Launcher
Create-Shortcut
Print-Instructions
