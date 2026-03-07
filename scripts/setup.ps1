# Mogwai Setup Script
# Installs Python and required dependencies for voice servers

Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  Mogwai Setup - Voice Server Setup" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""

# Check for Python
$pythonCmd = $null
$pythonCandidates = @("python", "python3", "py")

foreach ($cmd in $pythonCandidates) {
    try {
        $version = & $cmd --version 2>&1
        if ($LASTEXITCODE -eq 0 -and $version -match "Python 3\.1[0-9]") {
            $pythonCmd = $cmd
            Write-Host "Found Python: $version" -ForegroundColor Green
            break
        }
    } catch {
        continue
    }
}

if (-not $pythonCmd) {
    Write-Host "Python 3.10+ not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install Python 3.10 or later from:" -ForegroundColor Yellow
    Write-Host "  https://www.python.org/downloads/" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Make sure to check 'Add Python to PATH' during installation!" -ForegroundColor Yellow
    Write-Host ""
    
    $install = Read-Host "Would you like to try installing Python via winget? (y/n)"
    if ($install -eq "y") {
        Write-Host "Installing Python 3.12..." -ForegroundColor Yellow
        winget install Python.Python.3.12 --accept-package-agreements --accept-source-agreements
        
        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        
        $pythonCmd = "python"
    } else {
        Write-Host "Please install Python and run this script again." -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "Installing voice server dependencies..." -ForegroundColor Yellow
Write-Host ""

# Upgrade pip first
& $pythonCmd -m pip install --upgrade pip

# Install core dependencies
Write-Host "Installing FastAPI, uvicorn, and audio processing..." -ForegroundColor Cyan
& $pythonCmd -m pip install fastapi uvicorn python-multipart soundfile numpy

# Install faster-whisper for STT
Write-Host "Installing faster-whisper (this may take a while)..." -ForegroundColor Cyan
& $pythonCmd -m pip install faster-whisper

# Try to install Kokoro for high-quality TTS
Write-Host "Installing Kokoro TTS..." -ForegroundColor Cyan
& $pythonCmd -m pip install kokoro
if ($LASTEXITCODE -ne 0) {
    Write-Host "Kokoro installation failed. Installing pyttsx3 as fallback..." -ForegroundColor Yellow
    & $pythonCmd -m pip install pyttsx3
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Voice servers will start automatically when you run Mogwai." -ForegroundColor White
Write-Host ""
Write-Host "To test the servers manually:" -ForegroundColor Gray
Write-Host "  cd mogwai" -ForegroundColor Gray
Write-Host "  .\scripts\start-whisper.ps1  # STT on port 8080" -ForegroundColor Gray
Write-Host "  .\scripts\start-tts.ps1      # TTS on port 8081" -ForegroundColor Gray
Write-Host ""
