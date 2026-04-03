# Crystal Full Stack Startup Script
# Starts voice services: Whisper STT, TTS
# LLM is handled by Ollama (auto-detected by Crystal)

param(
    [switch]$SkipVoice
)

Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  Crystal AI Assistant - Full Stack" -ForegroundColor Magenta  
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""

$scriptDir = $PSScriptRoot

function Start-Server {
    param(
        [string]$Name,
        [string]$Script,
        [string]$Color
    )
    
    Write-Host "Starting $Name..." -ForegroundColor $Color
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "& '$Script'" -WindowStyle Normal
    Start-Sleep -Seconds 2
}

# Check Ollama
$ollamaRunning = $false
try {
    $null = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 3
    $ollamaRunning = $true
    Write-Host "Ollama: Already running" -ForegroundColor Green
} catch {
    Write-Host "Ollama: Not running - starting..." -ForegroundColor Yellow
    Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 3
}

# Start Voice servers
if (-not $SkipVoice) {
    $whisperScript = Join-Path $scriptDir "start-whisper.ps1"
    if (Test-Path $whisperScript) {
        Start-Server -Name "Whisper STT Server" -Script $whisperScript -Color "Cyan"
    }
    
    $ttsScript = Join-Path $scriptDir "start-tts.ps1"
    if (Test-Path $ttsScript) {
        Start-Server -Name "TTS Server" -Script $ttsScript -Color "Green"
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  All servers starting!" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "Services:" -ForegroundColor White
Write-Host "  - Ollama:  http://127.0.0.1:11434 (LLM inference)" -ForegroundColor Blue
if (-not $SkipVoice) {
    Write-Host "  - Whisper: http://127.0.0.1:8080 (Speech-to-Text)" -ForegroundColor Cyan
    Write-Host "  - TTS:     http://127.0.0.1:8081 (Text-to-Speech)" -ForegroundColor Green
}
Write-Host ""
Write-Host "Crystal auto-starts all services. This script is for manual debugging only." -ForegroundColor Yellow
Write-Host ""
