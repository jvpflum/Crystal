# Crystal Full Stack Startup Script
# Starts vLLM (Docker), voice services: Whisper STT, TTS

param(
    [switch]$SkipVoice,
    [switch]$SkipLLM
)

Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  Crystal AI Assistant - Full Stack" -ForegroundColor Magenta  
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""

$scriptDir = $PSScriptRoot
$composeFile = Join-Path (Split-Path $scriptDir -Parent) "docker-compose.yml"

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

function Test-Port([int]$Port) {
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect("127.0.0.1", $Port)
        $tcp.Close()
        return $true
    } catch {
        return $false
    }
}

# Start vLLM via Docker
if (-not $SkipLLM) {
    if (Test-Port 8000) {
        Write-Host "vLLM: Already running on port 8000" -ForegroundColor Green
    } elseif (Test-Path $composeFile) {
        Write-Host "vLLM: Starting Docker container (Qwen3-30B-A3B-NVFP4)..." -ForegroundColor Cyan
        docker compose -f $composeFile up -d vllm
        Write-Host "vLLM: Container started, model loading in background" -ForegroundColor Green
    } else {
        Write-Host "vLLM: docker-compose.yml not found at $composeFile" -ForegroundColor Red
    }
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
if (-not $SkipLLM) {
    Write-Host "  - vLLM:    http://127.0.0.1:8000  (Qwen3-30B-A3B-NVFP4, Docker)" -ForegroundColor Blue
}
if (-not $SkipVoice) {
    Write-Host "  - Whisper: http://127.0.0.1:8080 (Speech-to-Text)" -ForegroundColor Cyan
    Write-Host "  - TTS:     http://127.0.0.1:8081 (Text-to-Speech)" -ForegroundColor Green
}
Write-Host ""
Write-Host "Crystal auto-starts all services. This script is for manual debugging only." -ForegroundColor Yellow
Write-Host ""
