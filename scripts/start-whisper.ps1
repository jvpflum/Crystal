# Crystal Whisper STT Server Startup Script
# Requires: Python 3.10+, CUDA 12.x

param(
    [string]$Model = "large-v3",
    [int]$Port = 8080
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Crystal Whisper STT Server" -ForegroundColor Cyan
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
$deps = @("faster-whisper", "fastapi", "uvicorn", "python-multipart")
foreach ($dep in $deps) {
    $installed = pip show $dep 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Installing $dep..." -ForegroundColor Yellow
        pip install $dep --quiet
    }
}

Write-Host ""
Write-Host "Starting Whisper server with:" -ForegroundColor Green
Write-Host "  Model: $Model" -ForegroundColor White
Write-Host "  Port: $Port" -ForegroundColor White
Write-Host "  Endpoint: http://127.0.0.1:$Port/inference" -ForegroundColor White
Write-Host ""
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Gray
Write-Host ""

$env:WHISPER_MODEL = $Model
$env:PORT = $Port

$scriptPath = Join-Path $PSScriptRoot "whisper_server.py"
python $scriptPath
