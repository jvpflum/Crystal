import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ListChecks, RefreshCw, Loader2, AlertTriangle, XCircle,
  CheckCircle2, Clock, Play, Ban, Wrench, Filter,
} from "lucide-react";

interface BackgroundTask {
  id: string;
  runId?: string;
  kind: string;
  status: string;
  label?: string;
  agentId?: string;
  sessionKey?: string;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
}

const STATUS_COLORS: Record<string, string> = {
  queued: "#fbbf24",
  running: "var(--accent)",
  succeeded: "#4ade80",
  failed: "#f87171",
  timed_out: "#f97316",
  cancelled: "var(--text-muted)",
  lost: "#ef4444",
};

const STATUS_ICONS: Record<string, React.ElementType> = {
  queued: Clock,
  running: Play,
  succeeded: CheckCircle2,
  failed: XCircle,
  timed_out: AlertTriangle,
  cancelled: Ban,
  lost: AlertTriangle,
};

export function TasksView() {
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [auditResult, setAuditResult] = useState<string | null>(null);
  const [maintenanceResult, setMaintenanceResult] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      let cmd = "openclaw tasks list --json";
      if (filter !== "all") cmd += ` --status ${filter}`;
      if (kindFilter !== "all") cmd += ` --runtime ${kindFilter}`;
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: cmd, cwd: null,
      });
      if (result.code === 0 && result.stdout.trim()) {
        const parsed = JSON.parse(result.stdout);
        const items = Array.isArray(parsed) ? parsed : parsed.tasks ?? parsed.runs ?? [];
        setTasks(items.map((t: Record<string, unknown>) => ({
          id: String(t.taskId ?? t.id ?? ""),
          runId: t.runId ? String(t.runId) : undefined,
          kind: String(t.kind ?? t.runtime ?? "unknown"),
          status: String(t.status ?? "unknown"),
          label: t.label ? String(t.label) : t.name ? String(t.name) : undefined,
          agentId: t.agentId ? String(t.agentId) : undefined,
          sessionKey: t.sessionKey ? String(t.sessionKey) : undefined,
          createdAt: t.createdAt ? String(t.createdAt) : t.queuedAt ? String(t.queuedAt) : undefined,
          startedAt: t.startedAt ? String(t.startedAt) : undefined,
          completedAt: t.completedAt ? String(t.completedAt) : t.finishedAt ? String(t.finishedAt) : undefined,
          durationMs: t.durationMs ? Number(t.durationMs) : undefined,
          error: t.error ? String(t.error) : undefined,
        })));
        setError(null);
      } else {
        setTasks([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tasks");
    }
    setLoading(false);
  }, [filter, kindFilter]);

  useEffect(() => {
    setLoading(true);
    loadTasks();
    const interval = setInterval(loadTasks, 15_000);
    return () => clearInterval(interval);
  }, [loadTasks]);

  const cancelTask = async (taskId: string) => {
    setCancellingId(taskId);
    try {
      await invoke("execute_command", {
        command: `openclaw tasks cancel ${taskId}`, cwd: null,
      });
      await loadTasks();
    } catch { /* ignore */ }
    setCancellingId(null);
  };

  const runAudit = async () => {
    setBusy("audit");
    setAuditResult(null);
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: "openclaw tasks audit --json", cwd: null,
      });
      setAuditResult(result.stdout?.trim() || "No issues found");
    } catch (e) {
      setAuditResult(`Error: ${e instanceof Error ? e.message : "Unknown"}`);
    }
    setBusy(null);
  };

  const runMaintenance = async () => {
    setBusy("maintenance");
    setMaintenanceResult(null);
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: "openclaw tasks maintenance --apply", cwd: null,
      });
      setMaintenanceResult(result.stdout?.trim() || "Maintenance complete");
      await loadTasks();
    } catch (e) {
      setMaintenanceResult(`Error: ${e instanceof Error ? e.message : "Unknown"}`);
    }
    setBusy(null);
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60_000).toFixed(1)}m`;
  };

  const formatTime = (iso: string) => {
    try { return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch { return iso; }
  };

  const running = tasks.filter(t => t.status === "running").length;
  const queued = tasks.filter(t => t.status === "queued").length;
  const failed = tasks.filter(t => t.status === "failed" || t.status === "timed_out" || t.status === "lost").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "14px 20px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ListChecks style={{ width: 18, height: 18, color: "var(--accent)" }} />
            <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Background Tasks</h2>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={runAudit} disabled={busy === "audit"}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-muted)", fontSize: 10, cursor: "pointer" }}>
              {busy === "audit" ? <Loader2 style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} /> : <AlertTriangle style={{ width: 11, height: 11 }} />}
              Audit
            </button>
            <button onClick={runMaintenance} disabled={busy === "maintenance"}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-muted)", fontSize: 10, cursor: "pointer" }}>
              {busy === "maintenance" ? <Loader2 style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} /> : <Wrench style={{ width: 11, height: 11 }} />}
              Maintenance
            </button>
            <button onClick={() => { setLoading(true); loadTasks(); }} disabled={loading}
              style={{ display: "flex", alignItems: "center", padding: "4px 8px", borderRadius: 6, border: "none", background: "var(--bg-hover)", color: "var(--text-muted)", cursor: "pointer" }}>
              <RefreshCw style={{ width: 12, height: 12, ...(loading ? { animation: "spin 1s linear infinite" } : {}) }} />
            </button>
          </div>
        </div>

        {/* Summary */}
        <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{tasks.length} total</span>
          {running > 0 && <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>{running} running</span>}
          {queued > 0 && <span style={{ fontSize: 10, color: "#fbbf24" }}>{queued} queued</span>}
          {failed > 0 && <span style={{ fontSize: 10, color: "#f87171" }}>{failed} failed</span>}
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Filter style={{ width: 11, height: 11, color: "var(--text-muted)" }} />
          <div style={{ display: "flex", gap: 4 }}>
            {["all", "running", "queued", "succeeded", "failed", "cancelled"].map(s => (
              <button key={s} onClick={() => setFilter(s)}
                style={{ padding: "3px 8px", borderRadius: 6, border: filter === s ? "1px solid var(--accent)" : "1px solid var(--border)", background: filter === s ? "var(--accent-bg)" : "var(--bg-elevated)", color: filter === s ? "var(--accent)" : "var(--text-muted)", fontSize: 9, cursor: "pointer", textTransform: "capitalize" }}>
                {s}
              </button>
            ))}
          </div>
          <div style={{ width: 1, height: 16, background: "var(--border)" }} />
          <div style={{ display: "flex", gap: 4 }}>
            {["all", "cron", "subagent", "acp", "cli"].map(k => (
              <button key={k} onClick={() => setKindFilter(k)}
                style={{ padding: "3px 8px", borderRadius: 6, border: kindFilter === k ? "1px solid var(--accent)" : "1px solid var(--border)", background: kindFilter === k ? "var(--accent-bg)" : "var(--bg-elevated)", color: kindFilter === k ? "var(--accent)" : "var(--text-muted)", fontSize: 9, cursor: "pointer", textTransform: "capitalize" }}>
                {k}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 20px" }}>
        {error && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", marginBottom: 12 }}>
            <AlertTriangle style={{ width: 14, height: 14, color: "#f87171" }} />
            <span style={{ fontSize: 11, color: "#f87171", flex: 1 }}>{error}</span>
          </div>
        )}

        {(auditResult || maintenanceResult) && (
          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)", marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>
                {auditResult ? "Audit Result" : "Maintenance Result"}
              </span>
              <button onClick={() => { setAuditResult(null); setMaintenanceResult(null); }} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>×</button>
            </div>
            <pre style={{ margin: 0, fontSize: 10, fontFamily: "monospace", color: "var(--text-secondary)", whiteSpace: "pre-wrap", maxHeight: 120, overflow: "auto" }}>
              {auditResult || maintenanceResult}
            </pre>
          </div>
        )}

        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
            <Loader2 style={{ width: 20, height: 20, color: "var(--text-muted)", animation: "spin 1s linear infinite" }} />
          </div>
        ) : tasks.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <ListChecks style={{ width: 32, height: 32, color: "var(--text-muted)", margin: "0 auto 10px" }} />
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>No background tasks found</p>
            <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "4px 0 0" }}>
              Tasks are created by cron jobs, sub-agents, and ACP sessions
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {tasks.map(task => {
              const StatusIcon = STATUS_ICONS[task.status] ?? Clock;
              const color = STATUS_COLORS[task.status] ?? "var(--text-muted)";
              const isActive = task.status === "running" || task.status === "queued";
              return (
                <div key={`${task.id}-${task.runId ?? ""}`} style={{
                  padding: "10px 14px", borderRadius: 10,
                  background: isActive ? `color-mix(in srgb, ${color} 4%, var(--bg-elevated))` : "var(--bg-elevated)",
                  border: `1px solid ${isActive ? `color-mix(in srgb, ${color} 20%, var(--border))` : "var(--border)"}`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                      background: `color-mix(in srgb, ${color} 12%, transparent)`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <StatusIcon style={{ width: 14, height: 14, color, ...(task.status === "running" ? { animation: "spin 2s linear infinite" } : {}) }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{task.label || task.id}</span>
                        <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: "var(--bg-hover)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>{task.kind}</span>
                        <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: `color-mix(in srgb, ${color} 12%, transparent)`, color, fontWeight: 600 }}>{task.status}</span>
                      </div>
                      <div style={{ display: "flex", gap: 12, fontSize: 10, color: "var(--text-muted)" }}>
                        {task.agentId && <span>Agent: {task.agentId}</span>}
                        {task.createdAt && <span>{formatTime(task.createdAt)}</span>}
                        {task.durationMs != null && <span>{formatDuration(task.durationMs)}</span>}
                      </div>
                      {task.error && (
                        <p style={{ margin: "4px 0 0", fontSize: 10, color: "#f87171", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.error}</p>
                      )}
                    </div>
                    {isActive && (
                      <button onClick={() => cancelTask(task.id)} disabled={cancellingId === task.id}
                        style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(248,113,113,0.2)", background: "rgba(248,113,113,0.08)", color: "#f87171", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                        {cancellingId === task.id ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : <Ban style={{ width: 10, height: 10 }} />}
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
