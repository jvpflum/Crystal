# Crystal Full Stack Startup Script
# Starts vLLM (Docker), NVIDIA voice services (Parakeet STT, Magpie TTS)

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

# Start NVIDIA Voice servers
if (-not $SkipVoice) {
    $sttScript = Join-Path $scriptDir "nvidia_stt_worker.py"
    if (Test-Path $sttScript) {
        Write-Host "Starting NVIDIA Parakeet STT worker..." -ForegroundColor Cyan
        Start-Process python -ArgumentList $sttScript -WindowStyle Normal
        Start-Sleep -Seconds 2
    }

    $ttsScript = Join-Path $scriptDir "nvidia_tts_worker.py"
    if (Test-Path $ttsScript) {
        Write-Host "Starting NVIDIA Magpie TTS worker..." -ForegroundColor Green
        Start-Process python -ArgumentList $ttsScript -WindowStyle Normal
        Start-Sleep -Seconds 2
    }

    $gwScript = Join-Path $scriptDir "voice_gateway.py"
    if (Test-Path $gwScript) {
        Write-Host "Starting Voice Gateway..." -ForegroundColor Yellow
        Start-Process python -ArgumentList $gwScript -WindowStyle Normal
        Start-Sleep -Seconds 1
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
    Write-Host "  - NVIDIA STT: http://127.0.0.1:8090 (Parakeet ASR)" -ForegroundColor Cyan
    Write-Host "  - NVIDIA TTS: http://127.0.0.1:8091 (Magpie TTS)" -ForegroundColor Green
    Write-Host "  - Gateway:    http://127.0.0.1:6500 (Voice Gateway)" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Crystal auto-starts all services. This script is for manual debugging only." -ForegroundColor Yellow
Write-Host ""
