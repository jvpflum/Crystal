# Mogwai TTS Server Startup Script
# Supports: Kokoro (recommended), pyttsx3 (fallback)

param(
    [int]$Port = 8081
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Mogwai TTS Server" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check Python
$pythonVersion = python --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Python not found. Please install Python 3.10+" -ForegroundColor Red
    exit 1
}
Write-Host "Found: $pythonVersion" -ForegroundColor Green

# Check/install dependencies
Write-Host "Checking dependencies..." -ForegroundColor Yellow

$baseDeps = @("fastapi", "uvicorn", "soundfile", "numpy")
foreach ($dep in $baseDeps) {
    $installed = pip show $dep 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Installing $dep..." -ForegroundColor Yellow
        pip install $dep --quiet
    }
}

# Check for Kokoro (preferred)
$kokoroInstalled = python -c "import kokoro" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Kokoro TTS not installed. For best quality, install it:" -ForegroundColor Yellow
    Write-Host "  pip install kokoro>=0.9.2 soundfile" -ForegroundColor White
    Write-Host ""
    Write-Host "Falling back to pyttsx3..." -ForegroundColor Yellow
    pip install pyttsx3 --quiet
} else {
    Write-Host "Kokoro TTS found!" -ForegroundColor Green
}

Write-Host ""
Write-Host "Starting TTS server on port $Port" -ForegroundColor Green
Write-Host "  Endpoint: http://127.0.0.1:$Port/tts" -ForegroundColor White
Write-Host ""
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Gray
Write-Host ""

$env:PORT = $Port

$scriptPath = Join-Path $PSScriptRoot "tts_server.py"
python $scriptPath
