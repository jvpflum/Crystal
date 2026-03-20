/**
 * FactoryService — orchestrates autonomous agent runs for the Software Factory.
 *
 * Spawns agent processes (Claude Code, Cortex, OpenClaw) in the background,
 * streams output via log file polling, and supports cancellation.
 *
 * Uses PowerShell `Start-Process` to spawn headless background processes
 * and the Tauri `execute_command` / `read_file` commands for I/O.
 */

import { invoke } from "@tauri-apps/api/core";
import type { AgentType } from "@/stores/factoryStore";

interface CommandOutput {
  stdout: string;
  stderr: string;
  code: number;
}

export interface RunHandle {
  pid: number;
  logFile: string;
}

const AGENT_COMMANDS: Record<AgentType, (objective: string, cwd: string) => string> = {
  "claude-code": (obj, cwd) =>
    `openclaw agent --agent claude-code --message ${esc(obj)} --cwd ${esc(cwd)}`,
  "cortex": (obj, cwd) =>
    `openclaw agent --agent cortex --message ${esc(obj)} --cwd ${esc(cwd)}`,
};

function esc(s: string): string {
  return `"${s.replace(/"/g, '`"')}"`;
}

class FactoryService {
  private _polls: Map<string, number> = new Map();

  /** Spawn an agent run in the background. Returns the PID and log file path. */
  async startRun(
    runId: string,
    agentType: AgentType,
    objective: string,
    cwd: string
  ): Promise<RunHandle> {
    const command = AGENT_COMMANDS[agentType](objective, cwd);

    const resolvedLogFile = await this._resolveLogPath(runId);

    const spawnCmd = [
      `$logFile = ${esc(resolvedLogFile)};`,
      `"[crystal] Agent starting at $(Get-Date -Format o)..." | Out-File -FilePath $logFile -Encoding utf8;`,
      `$scriptBlock = {`,
      `  param($cmd, $workDir, $outFile)`,
      `  try {`,
      `    Set-Location $workDir;`,
      `    Invoke-Expression $cmd *>&1 | ForEach-Object {`,
      `      $_ | Out-File -FilePath $outFile -Append -Encoding utf8`,
      `    };`,
      `    "___CRYSTAL_EXIT:0" | Out-File -FilePath $outFile -Append -Encoding utf8`,
      `  } catch {`,
      `    $_.Exception.Message | Out-File -FilePath $outFile -Append -Encoding utf8;`,
      `    "___CRYSTAL_EXIT:1" | Out-File -FilePath $outFile -Append -Encoding utf8`,
      `  }`,
      `};`,
      `$job = Start-Job -ScriptBlock $scriptBlock -ArgumentList @(${esc(command)}, ${esc(cwd)}, $logFile);`,
      `$job.Id`,
    ].join(" ");

    const result = await invoke<CommandOutput>("execute_command", {
      command: spawnCmd,
      cwd: null,
    });

    const jobId = parseInt(result.stdout.trim(), 10);
    if (isNaN(jobId)) {
      throw new Error(`Failed to start agent run: ${result.stderr || result.stdout}`);
    }

    return { pid: jobId, logFile: resolvedLogFile };
  }

  /** Read the current output from a run's log file. */
  async readOutput(logFile: string): Promise<{ output: string; finished: boolean; exitCode?: number; readError?: string }> {
    try {
      const content = await invoke<string>("read_file", { path: logFile });
      const exitMatch = content.match(/___CRYSTAL_EXIT:(\d+)\s*$/);
      if (exitMatch) {
        const cleaned = content.replace(/___CRYSTAL_EXIT:\d+\s*$/, "").trimEnd();
        return { output: cleaned, finished: true, exitCode: parseInt(exitMatch[1], 10) };
      }
      return { output: content, finished: false };
    } catch (e) {
      return { output: "", finished: false, readError: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Start polling a run's log file. Calls onUpdate with new output. */
  startPolling(
    runId: string,
    logFile: string,
    onUpdate: (output: string, finished: boolean, exitCode?: number) => void,
    jobId?: number
  ): void {
    this.stopPolling(runId);

    let lastLen = -1;
    let emptyPolls = 0;

    const poll = async () => {
      const { output, finished, exitCode, readError } = await this.readOutput(logFile);

      if (readError && output === "") {
        emptyPolls++;
        if (emptyPolls === 1) {
          onUpdate(`[crystal] Waiting for agent output...\n[crystal] Log: ${logFile}\n`, false);
        }
        if (emptyPolls > 40 && jobId !== undefined) {
          const stillRunning = await this.isRunning(jobId);
          if (!stillRunning) {
            onUpdate(
              `[crystal] Agent process exited but no output was captured.\n[crystal] Log file: ${logFile}\n[crystal] Error: ${readError}`,
              true, 1
            );
            this.stopPolling(runId);
            return;
          }
        }
        return;
      }

      emptyPolls = 0;
      if (output.length !== lastLen || finished) {
        lastLen = output.length;
        onUpdate(output, finished, exitCode);
      }
      if (finished) {
        this.stopPolling(runId);
      }
    };

    poll();
    const interval = window.setInterval(poll, 1500);
    this._polls.set(runId, interval);
  }

  /** Stop polling for a run. */
  stopPolling(runId: string): void {
    const interval = this._polls.get(runId);
    if (interval) {
      clearInterval(interval);
      this._polls.delete(runId);
    }
  }

  /** Cancel a running agent job. */
  async cancelRun(jobId: number): Promise<void> {
    try {
      await invoke<CommandOutput>("execute_command", {
        command: `Stop-Job -Id ${jobId} -ErrorAction SilentlyContinue; Remove-Job -Id ${jobId} -Force -ErrorAction SilentlyContinue`,
        cwd: null,
      });
    } catch {
      // Job may have already finished
    }
  }

  /** Check if a PowerShell job is still running. */
  async isRunning(jobId: number): Promise<boolean> {
    try {
      const result = await invoke<CommandOutput>("execute_command", {
        command: `(Get-Job -Id ${jobId} -ErrorAction SilentlyContinue).State -eq 'Running'`,
        cwd: null,
      });
      return result.stdout.trim().toLowerCase() === "true";
    } catch {
      return false;
    }
  }

  private async _resolveLogPath(runId: string): Promise<string> {
    const result = await invoke<CommandOutput>("execute_command", {
      command: `Write-Output "$env:TEMP\\crystal_factory_${runId}.log"`,
      cwd: null,
    });
    return result.stdout.trim();
  }

  /** Clean up log file after a run. */
  async cleanupRun(runId: string): Promise<void> {
    this.stopPolling(runId);
    try {
      const logPath = await this._resolveLogPath(runId);
      await invoke<CommandOutput>("execute_command", {
        command: `Remove-Item -Path ${esc(logPath)} -Force -ErrorAction SilentlyContinue`,
        cwd: null,
      });
    } catch {
      // Cleanup is best-effort
    }
  }

  /**
   * Snapshot all files in a directory tree, returning a map of relative paths
   * to their LastWriteTime as epoch-ms. Skips node_modules, .git, dist, build.
   */
  async snapshotFiles(dir: string): Promise<Map<string, number>> {
    const cmd = [
      `Get-ChildItem -Path ${esc(dir)} -Recurse -File`,
      `-ErrorAction SilentlyContinue`,
      `| Where-Object { $_.FullName -notmatch '[\\\\/](node_modules|\.git|dist|build)[\\\\/]' }`,
      `| ForEach-Object {`,
      `  $rel = $_.FullName.Substring(${dir.length}).TrimStart('\\','/');`,
      `  "$rel|$([DateTimeOffset]::new($_.LastWriteTimeUtc).ToUnixTimeMilliseconds())"`,
      `}`,
    ].join(" ");

    try {
      const result = await invoke<CommandOutput>("execute_command", { command: cmd, cwd: null });
      const map = new Map<string, number>();
      for (const line of result.stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const sep = trimmed.lastIndexOf("|");
        if (sep === -1) continue;
        const relPath = trimmed.slice(0, sep);
        const ts = parseInt(trimmed.slice(sep + 1), 10);
        if (relPath && !isNaN(ts)) map.set(relPath, ts);
      }
      return map;
    } catch {
      return new Map();
    }
  }

  /** Compare two snapshots and return the files that were added, modified, or deleted. */
  diffSnapshots(
    before: Map<string, number>,
    after: Map<string, number>
  ): { added: string[]; modified: string[]; deleted: string[] } {
    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];

    for (const [path, ts] of after) {
      const prev = before.get(path);
      if (prev === undefined) added.push(path);
      else if (prev !== ts) modified.push(path);
    }
    for (const path of before.keys()) {
      if (!after.has(path)) deleted.push(path);
    }

    return { added, modified, deleted };
  }
}

export const factoryService = new FactoryService();
