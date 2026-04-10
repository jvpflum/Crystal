/**
 * FactoryService — pipeline orchestration engine for the Software Factory.
 *
 * Uses Rust `start_streaming_command` / `poll_streaming_command` for real-time
 * output streaming instead of log file polling.
 *
 * Pipeline: Plan → Code → Test → Review (auto-advances on success).
 */

import { invoke } from "@tauri-apps/api/core";
import { useFactoryStore, PIPELINE_STAGES, type PipelineStage } from "@/stores/factoryStore";

interface StreamPollResult {
  new_output: string;
  new_stderr: string;
  done: boolean;
  exit_code: number | null;
}

interface CommandOutput {
  stdout: string;
  stderr: string;
  code: number;
}

function esc(s: string): string {
  return `"${s.replace(/"/g, '`"')}"`;
}

/* ─── Stage-specific agent prompts ───────────────────────────── */

const STAGE_PROMPTS: Record<PipelineStage, (task: string, context?: string) => string> = {
  plan: (task) =>
    `You are a software architect. Analyze this task and produce a step-by-step implementation plan. ` +
    `List every file to create or modify, describe the approach, and identify risks.\n\nTask: ${task}`,

  code: (task, planOutput) =>
    `You are a senior developer. Implement the following plan completely. ` +
    `Write production-quality code. Do not leave TODOs or placeholders.\n\n` +
    `Original task: ${task}\n\nPlan:\n${planOutput ?? "(no plan output)"}`,

  test: (task, _ctx) =>
    `You are a QA engineer. Run all available linters, type checkers, and test suites in this workspace. ` +
    `Parse the results and report pass/fail per file. Fix any issues you find.\n\nOriginal task: ${task}`,

  review: (task, codeOutput) =>
    `You are a code reviewer. Review all changes against the original task. ` +
    `Flag issues, suggest improvements, and produce a summary. ` +
    `If everything looks good, state "APPROVED".\n\nOriginal task: ${task}\n\nCode output:\n${codeOutput ?? "(no code output)"}`,
};

class FactoryService {
  private _activePolls = new Map<string, boolean>();

  /**
   * Start the full pipeline for a build.
   * Runs Plan → Code → Test → Review, auto-advancing on success.
   */
  async startPipeline(buildId: string): Promise<void> {
    const store = useFactoryStore.getState();
    const build = store.builds.find((b) => b.id === buildId);
    if (!build) return;

    for (let i = 0; i < PIPELINE_STAGES.length; i++) {
      const stage = PIPELINE_STAGES[i];

      const currentBuild = useFactoryStore.getState().builds.find((b) => b.id === buildId);
      if (!currentBuild || currentBuild.currentStage === "failed") return;

      const prevOutput = i > 0 ? currentBuild.stages[i - 1]?.output : undefined;
      const exitCode = await this.runStage(buildId, stage, build.task, prevOutput);

      if (exitCode !== 0) {
        useFactoryStore.getState().failBuild(buildId);
        return;
      }

      if (i < PIPELINE_STAGES.length - 1) {
        useFactoryStore.getState().advanceStage(buildId);
      } else {
        useFactoryStore.getState().advanceStage(buildId);
      }
    }
  }

  /**
   * Run a single pipeline stage. Returns the exit code (0 = success).
   */
  async runStage(
    buildId: string,
    stage: PipelineStage,
    task: string,
    previousOutput?: string,
  ): Promise<number> {
    const store = useFactoryStore.getState();
    const build = store.builds.find((b) => b.id === buildId);
    if (!build) return 1;

    const prompt = STAGE_PROMPTS[stage](task, previousOutput);
    const escaped = prompt
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/`/g, "``")
      .replace(/\$/g, "`$");

    let cmd = `$env:NODE_NO_READLINE=1; $env:PYTHONUNBUFFERED=1; openclaw agent --agent main`;
    if (build.thinking && build.thinking !== "default") cmd += ` --thinking ${build.thinking}`;
    cmd += ` --message "${escaped}"`;

    store.updateStage(buildId, stage, {
      status: "running",
      startedAt: Date.now(),
      output: "",
    });

    try {
      const streamId = await invoke<string>("start_streaming_command", {
        command: cmd,
        cwd: build.cwd || null,
      });

      store.updateStage(buildId, stage, { streamId });

      const exitCode = await this._pollStream(buildId, stage, streamId);

      useFactoryStore.getState().updateStage(buildId, stage, {
        status: exitCode === 0 ? "passed" : "failed",
        completedAt: Date.now(),
        exitCode,
      });

      try {
        await invoke("cleanup_streaming_command", { id: streamId });
      } catch { /* cleanup is best-effort */ }

      return exitCode;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useFactoryStore.getState().updateStage(buildId, stage, {
        status: "failed",
        completedAt: Date.now(),
        output: `[factory] Failed to start stage: ${msg}\n`,
        exitCode: 1,
      });
      return 1;
    }
  }

  /**
   * Cancel a running build by killing its active stream.
   */
  async cancelBuild(buildId: string): Promise<void> {
    this._activePolls.set(buildId, false);

    const build = useFactoryStore.getState().builds.find((b) => b.id === buildId);
    if (!build) return;

    const runningStage = build.stages.find((s) => s.status === "running");
    if (runningStage?.streamId) {
      try {
        await invoke("kill_streaming_command", { id: runningStage.streamId });
      } catch { /* may already be done */ }
      try {
        await invoke("cleanup_streaming_command", { id: runningStage.streamId });
      } catch { /* best effort */ }
    }

    useFactoryStore.getState().updateStage(
      buildId,
      build.currentStage as PipelineStage,
      { status: "failed", completedAt: Date.now() }
    );
    useFactoryStore.getState().failBuild(buildId);
  }

  /**
   * Retry a failed build from its failed stage.
   */
  async retryBuild(buildId: string): Promise<void> {
    const build = useFactoryStore.getState().builds.find((b) => b.id === buildId);
    if (!build || build.currentStage === "done") return;

    const failedIdx = build.stages.findIndex((s) => s.status === "failed");
    if (failedIdx === -1) return;

    const stage = PIPELINE_STAGES[failedIdx];
    useFactoryStore.getState().updateBuild(buildId, { currentStage: stage });
    useFactoryStore.getState().updateStage(buildId, stage, {
      status: "pending",
      output: "",
      exitCode: undefined,
      streamId: undefined,
      startedAt: undefined,
      completedAt: undefined,
    });

    const prevOutput = failedIdx > 0 ? build.stages[failedIdx - 1]?.output : undefined;
    const exitCode = await this.runStage(buildId, stage, build.task, prevOutput);

    if (exitCode !== 0) {
      useFactoryStore.getState().failBuild(buildId);
      return;
    }

    for (let i = failedIdx + 1; i < PIPELINE_STAGES.length; i++) {
      useFactoryStore.getState().advanceStage(buildId);
      const nextStage = PIPELINE_STAGES[i];
      const currentBuild = useFactoryStore.getState().builds.find((b) => b.id === buildId);
      if (!currentBuild || currentBuild.currentStage === "failed") return;
      const prev = currentBuild.stages[i - 1]?.output;
      const ec = await this.runStage(buildId, nextStage, build.task, prev);
      if (ec !== 0) {
        useFactoryStore.getState().failBuild(buildId);
        return;
      }
    }
    useFactoryStore.getState().advanceStage(buildId);
  }

  /**
   * Skip the current failed stage and advance to the next one.
   */
  async skipStage(buildId: string): Promise<void> {
    const build = useFactoryStore.getState().builds.find((b) => b.id === buildId);
    if (!build) return;

    const currentIdx = PIPELINE_STAGES.indexOf(build.currentStage as PipelineStage);
    if (currentIdx === -1) return;

    useFactoryStore.getState().updateStage(buildId, PIPELINE_STAGES[currentIdx], {
      status: "skipped",
      completedAt: Date.now(),
    });
    useFactoryStore.getState().advanceStage(buildId);

    const nextIdx = currentIdx + 1;
    if (nextIdx >= PIPELINE_STAGES.length) return;

    const prevOutput = build.stages[currentIdx]?.output || build.stages[currentIdx - 1]?.output;
    for (let i = nextIdx; i < PIPELINE_STAGES.length; i++) {
      const currentBuild = useFactoryStore.getState().builds.find((b) => b.id === buildId);
      if (!currentBuild || currentBuild.currentStage === "failed" || currentBuild.currentStage === "done") return;
      const stage = PIPELINE_STAGES[i];
      const prev = i === nextIdx ? prevOutput : currentBuild.stages[i - 1]?.output;
      const ec = await this.runStage(buildId, stage, build.task, prev);
      if (ec !== 0) {
        useFactoryStore.getState().failBuild(buildId);
        return;
      }
      if (i < PIPELINE_STAGES.length - 1) {
        useFactoryStore.getState().advanceStage(buildId);
      } else {
        useFactoryStore.getState().advanceStage(buildId);
      }
    }
  }

  /**
   * Snapshot files in a directory (for workspace change detection).
   */
  async snapshotFiles(dir: string): Promise<Map<string, number>> {
    const cmd = [
      `Get-ChildItem -Path ${esc(dir)} -Recurse -File`,
      `-ErrorAction SilentlyContinue`,
      `| Where-Object { $_.FullName -notmatch '[\\\\/](node_modules|\\.git|dist|build)[\\\\/]' }`,
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

  /* ─── Internal ─────────────────────────────────────────────── */

  private async _pollStream(
    buildId: string,
    stage: PipelineStage,
    streamId: string,
  ): Promise<number> {
    this._activePolls.set(buildId, true);
    const POLL_INTERVAL = 300;
    const TIMEOUT = 600_000; // 10 min per stage
    const start = Date.now();

    while (this._activePolls.get(buildId)) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));

      if (Date.now() - start > TIMEOUT) {
        useFactoryStore.getState().appendStageOutput(
          buildId, stage, "\n[factory] Stage timed out after 10 minutes.\n"
        );
        return 1;
      }

      try {
        const poll = await invoke<StreamPollResult>("poll_streaming_command", { id: streamId });

        if (poll.new_output) {
          useFactoryStore.getState().appendStageOutput(buildId, stage, poll.new_output);
        }
        if (poll.new_stderr) {
          useFactoryStore.getState().appendStageOutput(buildId, stage, poll.new_stderr);
        }

        if (poll.done) {
          return poll.exit_code ?? 1;
        }
      } catch {
        return 1;
      }
    }

    return 1; // cancelled
  }
}

export const factoryService = new FactoryService();
