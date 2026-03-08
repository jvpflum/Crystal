import { useState, useEffect, useCallback } from "react";
import {
  Clock,
  Plus,
  Play,
  Trash2,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Zap,
  Sun,
  Shield,
  HardDrive,
  Mail,
  FileText,
  Activity,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { escapeShellArg } from "@/lib/tools";

interface CronJob {
  id: string;
  schedule: string;
  message: string;
  agent: string;
  enabled: boolean;
}

interface CronStatus {
  running: boolean;
  nextRun?: string;
  lastRun?: string;
}

interface ExampleJob {
  icon: React.ElementType;
  name: string;
  schedule: string;
  message: string;
  color: string;
  description: string;
}

const EXAMPLE_JOBS: ExampleJob[] = [
  {
    icon: Sun, name: "Morning Briefing", schedule: "0 8 * * *",
    message: "Give me a morning briefing: today's date, weather outlook, top priorities, and any alerts.",
    color: "#fbbf24", description: "Every day at 8:00 AM",
  },
  {
    icon: Shield, name: "Security Scan", schedule: "0 2 * * 0",
    message: "Run a full security audit on my system. Check for vulnerabilities, outdated packages, and suspicious activity. Report any findings.",
    color: "#f87171", description: "Every Sunday at 2:00 AM",
  },
  {
    icon: HardDrive, name: "Disk Cleanup", schedule: "0 3 * * 6",
    message: "Check disk usage, identify large temporary files, and suggest cleanup actions. Report storage stats.",
    color: "#3B82F6", description: "Every Saturday at 3:00 AM",
  },
  {
    icon: Mail, name: "Email Digest", schedule: "0 18 * * 1-5",
    message: "Summarize my emails and messages from today. Highlight action items and urgent matters.",
    color: "#a855f7", description: "Weekdays at 6:00 PM",
  },
  {
    icon: FileText, name: "Daily Summary", schedule: "0 23 * * *",
    message: "Generate an end-of-day summary. What was accomplished today? What's pending for tomorrow?",
    color: "#4ade80", description: "Every day at 11:00 PM",
  },
  {
    icon: Activity, name: "Health Check", schedule: "*/30 * * * *",
    message: "Check all services status: gateway, LLM, and system resources. Alert if anything is down.",
    color: "#06b6d4", description: "Every 30 minutes",
  },
];

const CRON_HELP = [
  { expr: "* * * * *", desc: "Every minute" },
  { expr: "*/5 * * * *", desc: "Every 5 minutes" },
  { expr: "*/30 * * * *", desc: "Every 30 minutes" },
  { expr: "0 * * * *", desc: "Every hour" },
  { expr: "0 8 * * *", desc: "Daily at 8 AM" },
  { expr: "0 8 * * 1-5", desc: "Weekdays at 8 AM" },
  { expr: "0 0 * * 0", desc: "Weekly (Sunday midnight)" },
  { expr: "0 0 1 * *", desc: "Monthly (1st at midnight)" },
];

export function CronView() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [status, setStatus] = useState<CronStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newSchedule, setNewSchedule] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "npx openclaw cron list --json", cwd: null,
      });
      if (result.code === 0 && result.stdout.trim()) {
        try {
          const parsed = JSON.parse(result.stdout);
          setJobs(Array.isArray(parsed) ? parsed : parsed.jobs ?? []);
        } catch {
          setJobs([]);
        }
      } else {
        setJobs([]);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load cron jobs");
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "npx openclaw cron status", cwd: null,
      });
      if (result.code === 0 && result.stdout.trim()) {
        try {
          setStatus(JSON.parse(result.stdout));
        } catch {
          setStatus({ running: result.stdout.toLowerCase().includes("running") });
        }
      }
    } catch { /* optional */ }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadJobs(), loadStatus()]);
      setLoading(false);
    })();
  }, [loadJobs, loadStatus]);

  const toggleJob = async (job: CronJob) => {
    const cmd = job.enabled ? "disable" : "enable";
    await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
      command: `npx openclaw cron ${cmd} ${job.id}`, cwd: null,
    });
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, enabled: !j.enabled } : j)));
  };

  const runNow = async (id: string) => {
    setRunningId(id);
    try {
      await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `npx openclaw cron run ${id}`, cwd: null,
      });
    } catch { /* best-effort */ }
    setRunningId(null);
  };

  const removeJob = async (id: string) => {
    setRemovingId(id);
    await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
      command: `npx openclaw cron rm ${id}`, cwd: null,
    });
    setJobs((prev) => prev.filter((j) => j.id !== id));
    setRemovingId(null);
  };

  const addJob = async (schedule?: string, message?: string) => {
    const sched = schedule || newSchedule;
    const msg = message || newMessage;
    if (!sched.trim() || !msg.trim()) return;
    setAdding(true);
    try {
      const escaped = escapeShellArg(msg);
      const escapedSched = escapeShellArg(sched);
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `npx openclaw cron add --schedule "${escapedSched}" --message "${escaped}" --agent main`, cwd: null,
      });
      if (result.code === 0) {
        setNewSchedule(""); setNewMessage(""); setShowAdd(false);
        await loadJobs();
      } else {
        setError(result.stderr || "Failed to add job");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add job");
    }
    setAdding(false);
  };

  const addExample = async (ex: ExampleJob) => {
    await addJob(ex.schedule, ex.message);
  };

  const refresh = async () => {
    setLoading(true);
    await Promise.all([loadJobs(), loadStatus()]);
    setLoading(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "14px 20px 10px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Cron Jobs</h2>
          {status && (
            <span style={{
              fontSize: 10, padding: "2px 8px", borderRadius: 10,
              background: status.running ? "rgba(74,222,128,0.15)" : "var(--bg-hover)",
              color: status.running ? "#4ade80" : "var(--text-muted)",
              border: `1px solid ${status.running ? "rgba(74,222,128,0.25)" : "var(--border)"}`,
            }}>
              {status.running ? "Scheduler Active" : "Scheduler Idle"}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={refresh} disabled={loading}
            style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 6, border: "none", background: "var(--bg-hover)", color: "var(--text-muted)", fontSize: 11, cursor: "pointer" }}>
            <RefreshCw style={{ width: 12, height: 12, ...(loading ? { animation: "spin 1s linear infinite" } : {}) }} />
          </button>
          <button onClick={() => setShowAdd(!showAdd)}
            style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, border: "none", background: "var(--accent-bg)", color: "var(--accent)", fontSize: 11, cursor: "pointer" }}>
            <Plus style={{ width: 12, height: 12 }} /> Add Job
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "0 20px 20px" }}>
        {error && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", marginBottom: 12 }}>
            <AlertTriangle style={{ width: 14, height: 14, color: "#f87171", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "#f87171" }}>{error}</span>
            <button onClick={() => setError(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text-muted)", fontSize: 14, cursor: "pointer" }}>×</button>
          </div>
        )}

        {showAdd && (
          <div style={{ marginBottom: 16 }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, display: "block", marginBottom: 6 }}>New Cron Job</span>
            <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Schedule (cron expression)</label>
                  <input value={newSchedule} onChange={(e) => setNewSchedule(e.target.value)} placeholder="*/30 * * * *"
                    style={{ width: "100%", padding: "6px 8px", borderRadius: 6, background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, fontFamily: "monospace", outline: "none", boxSizing: "border-box" }}
                  />
                </div>
                <div style={{ flex: 2 }}>
                  <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Message / Prompt</label>
                  <input value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Check server health and report"
                    style={{ width: "100%", padding: "6px 8px", borderRadius: 6, background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, outline: "none", boxSizing: "border-box" }}
                  />
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <button onClick={() => setShowAdd(false)}
                  style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", fontSize: 11, cursor: "pointer" }}>
                  Cancel
                </button>
                <button onClick={() => addJob()} disabled={adding || !newSchedule.trim() || !newMessage.trim()}
                  style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "var(--accent)", color: "white", fontSize: 11, cursor: "pointer", opacity: adding || !newSchedule.trim() || !newMessage.trim() ? 0.5 : 1, display: "flex", alignItems: "center", gap: 4 }}>
                  {adding && <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />}
                  Add Job
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Scheduled Tasks */}
        <div style={{ marginBottom: 16 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, display: "block", marginBottom: 6 }}>
            Scheduled Tasks {!loading && `(${jobs.length})`}
          </span>

          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
              <Loader2 style={{ width: 20, height: 20, color: "var(--text-muted)", animation: "spin 1s linear infinite" }} />
            </div>
          ) : jobs.length === 0 ? (
            <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, padding: "24px 16px", textAlign: "center" }}>
              <Clock style={{ width: 28, height: 28, color: "var(--text-muted)", margin: "0 auto 8px" }} />
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>No cron jobs configured</p>
              <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "4px 0 0" }}>Click "Add Job" or use a template below</p>
            </div>
          ) : (
            <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
              {jobs.map((job, i) => (
                <div key={job.id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                  borderBottom: i < jobs.length - 1 ? "1px solid var(--border)" : "none",
                  opacity: job.enabled ? 1 : 0.5,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--accent)" }}>{job.schedule}</span>
                      {job.agent && (
                        <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: "var(--bg-hover)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                          {job.agent}
                        </span>
                      )}
                    </div>
                    <p style={{ margin: 0, fontSize: 11, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {job.message}
                    </p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    <button onClick={() => runNow(job.id)} disabled={runningId === job.id} title="Run now"
                      style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text-muted)" }}>
                      {runningId === job.id ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Play style={{ width: 12, height: 12 }} />}
                    </button>
                    <button onClick={() => removeJob(job.id)} disabled={removingId === job.id} title="Remove"
                      style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid rgba(248,113,113,0.15)", background: "rgba(248,113,113,0.06)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#f87171" }}>
                      {removingId === job.id ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Trash2 style={{ width: 12, height: 12 }} />}
                    </button>
                    <ToggleSwitch enabled={job.enabled} onToggle={() => toggleJob(job)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Example Templates */}
        <div style={{ marginBottom: 16 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, display: "block", marginBottom: 6 }}>
            Quick Templates
          </span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {EXAMPLE_JOBS.map((ex) => {
              const Icon = ex.icon;
              return (
                <button
                  key={ex.name}
                  onClick={() => addExample(ex)}
                  disabled={adding}
                  style={{
                    textAlign: "left", padding: "12px 14px", borderRadius: 10,
                    background: "var(--bg-elevated)", border: "1px solid var(--border)",
                    cursor: adding ? "wait" : "pointer",
                    display: "flex", alignItems: "flex-start", gap: 10,
                    transition: "border-color 0.15s, background 0.15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = ex.color; e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-elevated)"; }}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                    background: `color-mix(in srgb, ${ex.color} 12%, transparent)`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Icon style={{ width: 15, height: 15, color: ex.color }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--text)", fontWeight: 600 }}>{ex.name}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted)" }}>{ex.description}</p>
                    <code style={{ fontSize: 9, color: ex.color, fontFamily: "monospace" }}>{ex.schedule}</code>
                  </div>
                  <Zap style={{ width: 12, height: 12, color: "var(--text-muted)", flexShrink: 0, marginTop: 2 }} />
                </button>
              );
            })}
          </div>
        </div>

        {/* Cron Syntax Reference */}
        <div style={{ marginBottom: 16 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, display: "block", marginBottom: 6 }}>
            Cron Syntax Reference
          </span>
          <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ display: "flex", gap: 4, marginBottom: 8, fontSize: 10, fontFamily: "monospace", color: "var(--accent)" }}>
              <span style={{ flex: 1, textAlign: "center" }}>min</span>
              <span style={{ flex: 1, textAlign: "center" }}>hour</span>
              <span style={{ flex: 1, textAlign: "center" }}>day</span>
              <span style={{ flex: 1, textAlign: "center" }}>month</span>
              <span style={{ flex: 1, textAlign: "center" }}>weekday</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px" }}>
              {CRON_HELP.map((h) => (
                <div key={h.expr} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                  <code style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: "monospace", cursor: "pointer" }}
                    onClick={() => { setNewSchedule(h.expr); setShowAdd(true); }}
                  >{h.expr}</code>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{h.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {status && (status.lastRun || status.nextRun) && (
          <div style={{ marginBottom: 16 }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, display: "block", marginBottom: 6 }}>Status</span>
            <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px" }}>
              {status.lastRun && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Last Run</span>
                  <span style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "monospace" }}>{status.lastRun}</span>
                </div>
              )}
              {status.nextRun && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Next Run</span>
                  <span style={{ fontSize: 11, color: "#4ade80", fontFamily: "monospace" }}>{status.nextRun}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ToggleSwitch({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} style={{
      width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer",
      position: "relative", background: enabled ? "var(--accent)" : "var(--bg-hover)",
      transition: "background 0.2s", flexShrink: 0,
    }}>
      <span style={{
        position: "absolute", top: 2, left: enabled ? 18 : 2, width: 16, height: 16,
        borderRadius: "50%", background: "white", transition: "left 0.2s",
        boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
      }} />
    </button>
  );
}
