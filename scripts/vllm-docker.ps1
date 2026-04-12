param(
    [Parameter(Position = 0)]
    [ValidateSet("start", "stop", "status", "logs", "restart", "pull")]
    [string]$Action = "status"
)

$composeDir = Split-Path $PSScriptRoot -Parent
$composeFile = Join-Path $composeDir "docker-compose.yml"

if (-not (Test-Path $composeFile)) {
    Write-Host "ERROR: docker-compose.yml not found at $composeFile" -ForegroundColor Red
    exit 1
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

function Show-Status {
    $portOpen = Test-Port 8000
    if ($portOpen) {
        Write-Host "vLLM: " -NoNewline
        Write-Host "RUNNING" -ForegroundColor Green -NoNewline
        Write-Host " (port 8000)"
        try {
            $models = Invoke-RestMethod -Uri "http://127.0.0.1:8000/v1/models" -TimeoutSec 5
            $modelId = $models.data[0].id
            Write-Host "Model: $modelId" -ForegroundColor Cyan
        } catch {
            Write-Host "Model: (querying...)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "vLLM: " -NoNewline
        Write-Host "STOPPED" -ForegroundColor Red -NoNewline
        Write-Host " (port 8000 not listening)"
    }

    $container = docker ps --filter "name=crystal-vllm" --format "{{.Status}}" 2>$null
    if ($container) {
        Write-Host "Container: $container" -ForegroundColor Gray
    } else {
        Write-Host "Container: not running" -ForegroundColor Gray
    }
}

switch ($Action) {
    "start" {
        if (Test-Port 8000) {
            Write-Host "vLLM already running on port 8000" -ForegroundColor Yellow
            Show-Status
            exit 0
        }
        Write-Host "Starting vLLM (Qwen3-30B-A3B-NVFP4)..." -ForegroundColor Cyan
        Write-Host "First run will download the model (~15-20 GB). This may take a while." -ForegroundColor Yellow
        docker compose -f $composeFile up -d vllm
        Write-Host ""
        Write-Host "Container started. Model is loading..." -ForegroundColor Green
        Write-Host "Run '.\vllm-docker.ps1 logs' to watch progress." -ForegroundColor Gray
        Write-Host "Run '.\vllm-docker.ps1 status' to check when ready." -ForegroundColor Gray
    }
    "stop" {
        Write-Host "Stopping vLLM..." -ForegroundColor Yellow
        docker compose -f $composeFile down
        Write-Host "vLLM stopped." -ForegroundColor Green
    }
    "restart" {
        Write-Host "Restarting vLLM..." -ForegroundColor Yellow
        docker compose -f $composeFile down
        docker compose -f $composeFile up -d vllm
        Write-Host "vLLM restarting. Model is loading..." -ForegroundColor Green
    }
    "logs" {
        docker compose -f $composeFile logs -f vllm
    }
    "pull" {
        Write-Host "Pulling latest vLLM image..." -ForegroundColor Cyan
        docker compose -f $composeFile pull vllm
    }
    "status" {
        Write-Host "========================================" -ForegroundColor Magenta
        Write-Host "  Crystal vLLM Status" -ForegroundColor Magenta
        Write-Host "========================================" -ForegroundColor Magenta
        Write-Host ""
        Show-Status
    }
}
