# Adds the resolved path of a CLI on PATH to OpenClaw exec allowlists for cron/main agents.
# Fixes "allowlist miss" when jobs run chained commands like: openhue ... && openhue ...
# Usage: .\scripts\openclaw-allowlist-exe.ps1 openhue
# Gateway: append --gateway   Node: use openclaw approvals allowlist add ... --node <id>

param(
  [Parameter(Position = 0)]
  [string]$ExeName = "openhue"
)

$ErrorActionPreference = "Stop"
$src = (Get-Command $ExeName -CommandType Application -ErrorAction Stop).Source

Write-Host "Allowlisting: $src"

foreach ($agent in @("main", "*")) {
  if ($agent -eq "*") {
    openclaw approvals allowlist add $src --agent "*"
  } else {
    openclaw approvals allowlist add $src --agent $agent
  }
}

Write-Host "Done. Restart gateway if cron still fails: openclaw gateway restart"
