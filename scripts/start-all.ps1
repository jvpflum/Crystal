# Crystal Full Stack Startup Script
# Starts vLLM (Docker)

param(
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

Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  All servers starting!" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "Services:" -ForegroundColor White
if (-not $SkipLLM) {
    Write-Host "  - vLLM:    http://127.0.0.1:8000  (Qwen3-30B-A3B-NVFP4, Docker)" -ForegroundColor Blue
}
Write-Host ""
Write-Host "Crystal auto-starts all services. This script is for manual debugging only." -ForegroundColor Yellow
Write-Host ""
