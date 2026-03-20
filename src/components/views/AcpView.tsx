import { useState, useEffect, useCallback } from "react";
import {
  Terminal,
  Play,
  Square,
  RefreshCw,
  Loader2,
  Settings,
  Info,
  Navigation,
  XCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface AcpSession {
  id: string;
  runtime: string;
  status: string;
  task: string;
  model?: string;
  cwd?: string;
}

interface AcpConfig {
  defaultRuntime?: string;
  [key: string]: unknown;
}

const RUNTIMES = ["codex", "claude-code", "gemini-cli"] as const;
type Runtime = typeof RUNTIMES[number];

async function runCmd(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return invoke<{ stdout: string; stderr: string; code: number }>("execute_command", { command, cwd: null });
}

export function AcpView() {
  const [sessions, setSessions] = useState<AcpSession[]>([]);
  const [config, setConfig] = useState<AcpConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [showSpawn, setShowSpawn] = useState(true);
  const [spawnRuntime, setSpawnRuntime] = useState<Runtime>("codex");
  const [spawnTask, setSpawnTask] = useState("");
  const [spawnCwd, setSpawnCwd] = useState("");
  const [spawnModel, setSpawnModel] = useState("");
  const [spawnTimeout, setSpawnTimeout] = useState("");
  const [spawning, setSpawning] = useState(false);

  const [steerSessionId, setSteerSessionId] = useState<string | null>(null);
  const [steerMessage, setSteerMessage] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  const [defaultRuntime, setDefaultRuntime] = useState<Runtime>("codex");
  const [savingConfig, setSavingConfig] = useState(false);

  const showFeedback = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 2500);
  };

  const loadStatus = useCallback(async () => {
    try {
      const escaped = '/acp status'.replace(/"/g, '\\"');
      const result = await runCmd(`openclaw agent --agent main --message "${escaped}" --json`);
      if (result.stdout.trim()) {
        try {
          const parsed = JSON.parse(result.stdout);
          const raw = parsed.sessions ?? parsed.agents ?? parsed.active ?? [];
          const list: AcpSession[] = (Array.isArray(raw) ? raw : []).map((s: Record<string, unknown>) => ({
            id: String(s.id ?? s.sessionId ?? ""),
            runtime: String(s.runtime ?? s.type ?? "unknown"),
            status: String(s.status ?? s.state ?? "unknown"),
            task: String(s.task ?? s.message ?? s.prompt ?? ""),
            model: s.model ? String(s.model) : undefined,
            cwd: s.cwd ? String(s.cwd) : undefined,
          }));
          setSessions(list);
        } catch {
          setSessions([]);
        }
      } else {
        setSessions([]);
      }
    } catch (e) {
      if (sessions.length === 0) {
        setError(e instanceof Error ? e.message : "Failed to load ACP status");
      }
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const result = await runCmd("openclaw config get acp --json");
      if (result.stdout.trim()) {
        const parsed = JSON.parse(result.stdout);
        setConfig(parsed);
        if (parsed.defaultRuntime && RUNTIMES.includes(parsed.defaultRuntime)) {
          setDefaultRuntime(parsed.defaultRuntime as Runtime);
        }
      }
    } catch { /* optional */ }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      await Promise.all([loadStatus(), loadConfig()]);
      if (active) setLoading(false);
    })();
    const interval = setInterval(() => { loadStatus(); }, 15_000);
    return () => { active = false; clearInterval(interval); };
  }, [loadStatus, loadConfig]);

  const spawnSession = async () => {
    if (!spawnTask.trim()) return;
    setSpawning(true);
    setError(null);
    try {
      let cmd = `/acp spawn --runtime ${spawnRuntime}`;
      if (spawnModel.trim()) cmd += ` --model ${spawnModel.trim()}`;
      if (spawnCwd.trim()) cmd += ` --cwd ${spawnCwd.trim()}`;
      if (spawnTimeout.trim()) cmd += ` --timeout ${spawnTimeout.trim()}`;
      cmd += ` ${spawnTask.trim()}`;
      const escaped = cmd.replace(/"/g, '\\"');
      const result = await runCmd(`openclaw agent --agent main --message "${escaped}" --json`);
      const output = result.stdout?.trim() || result.stderr?.trim() || "";
      if (result.code === 0) {
        showFeedback("ACP session spawned");
        setSpawnTask("");
        setSpawnCwd("");
        setSpawnModel("");
        setSpawnTimeout("");
        await loadStatus();
      } else {
        setError(output || "Failed to spawn session");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to spawn session");
    }
    setSpawning(false);
  };

  const steerSession = async (id: string) => {
    if (!steerMessage.trim()) return;
    setActionLoading(`steer-${id}`);
    setActionResult(null);
    try {
      const escaped = `/acp steer ${id} ${steerMessage.trim()}`.replace(/"/g, '\\"');
      const result = await runCmd(`openclaw agent --agent main --message "${escaped}" --json`);
      const output = result.stdout?.trim() || result.stderr?.trim() || "Steer sent";
      setActionResult({ id, text: output, ok: result.code === 0 });
      setSteerMessage("");
      setSteerSessionId(null);
      await loadStatus();
    } catch (e) {
      setActionResult({ id, text: e instanceof Error ? e.message : "Steer failed", ok: false });
    }
    setActionLoading(null);
  };

  const sessionAction = async (action: "cancel" | "close" | "doctor", id: string) => {
    setActionLoading(`${action}-${id}`);
    setActionResult(null);
    try {
      const escaped = `/acp ${action} ${id}`.replace(/"/g, '\\"');
      const result = await runCmd(`openclaw agent --agent main --message "${escaped}" --json`);
      const output = result.stdout?.trim() || result.stderr?.trim() || `${action} completed`;
      setActionResult({ id, text: output, ok: result.code === 0 });
      await loadStatus();
    } catch (e) {
      setActionResult({ id, text: e instanceof Error ? e.message : `${action} failed`, ok: false });
    }
    setActionLoading(null);
  };

  const saveDefaultRuntime = async () => {
    setSavingConfig(true);
    try {
      const result = await runCmd(`openclaw config set acp.defaultRuntime "${defaultRuntime}"`);
      if (result.code !== 0 && result.stderr) {
        setError(result.stderr);
      } else {
        showFeedback("Default runtime updated");
        await loadConfig();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update config");
    }
    setSavingConfig(false);
  };

  const refresh = async () => {
    setLoading(true);
    await Promise.all([loadStatus(), loadConfig()]);
    setLoading(false);
  };

  const statusColor = (s: string) => {
    if (s === "running" || s === "active") return "var(--success)";
    if (s === "error" || s === "failed") return "var(--error)";
    if (s === "completed" || s === "done") return "var(--accent)";
    return "var(--text-muted)";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px 10px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Terminal style={{ width: 16, height: 16, color: "var(--accent)" }} />
          <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>ACP Agents</h2>
          {!loading && (
            <span style={{
              fontSize: 10, padding: "2px 8px", borderRadius: 10,
              background: sessions.length > 0 ? "rgba(74,222,128,0.1)" : "var(--bg-hover)",
              color: sessions.length > 0 ? "var(--success)" : "var(--text-muted)",
              border: `1px solid ${sessions.length > 0 ? "rgba(74,222,128,0.2)" : "var(--border)"}`,
            }}>
              {sessions.length} session{sessions.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          style={{
            display: "flex", alignItems: "center", gap: 4, padding: "4px 8px",
            borderRadius: 6, border: "none", background: "var(--bg-hover)",
            color: "var(--text-muted)", fontSize: 11, cursor: "pointer",
          }}
        >
          <RefreshCw style={{ width: 12, height: 12, ...(loading ? { animation: "spin 1s linear infinite" } : {}) }} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "0 20px 20px" }}>
        {/* Error */}
        {error && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", marginBottom: 12 }}>
            <XCircle style={{ width: 14, height: 14, color: "var(--error)", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "var(--error)", flex: 1 }}>{error}</span>
            <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 14, cursor: "pointer" }}>×</button>
          </div>
        )}

        {/* Feedback */}
        {feedback && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.2)", marginBottom: 12 }}>
            <Info style={{ width: 14, height: 14, color: "var(--success)", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "var(--success)" }}>{feedback}</span>
          </div>
        )}

        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
            <Loader2 style={{ width: 20, height: 20, color: "var(--text-muted)", animation: "spin 1s linear infinite" }} />
          </div>
        ) : (
          <>
            {/* Spawn Form */}
            <div style={{ marginBottom: 16 }}>
              <button
                onClick={() => setShowSpawn(!showSpawn)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, background: "none", border: "none",
                  cursor: "pointer", padding: 0, marginBottom: 8,
                }}
              >
                {showSpawn
                  ? <ChevronDown style={{ width: 12, height: 12, color: "var(--text-muted)" }} />
                  : <ChevronRight style={{ width: 12, height: 12, color: "var(--text-muted)" }} />
                }
                <span style={{ fontSize: 10, textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.06em", fontWeight: 600 }}>
                  SPAWN ACP SESSION
                </span>
              </button>

              {showSpawn && (
                <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px" }}>
                  {/* Runtime */}
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Runtime</label>
                    <select
                      value={spawnRuntime}
                      onChange={(e) => setSpawnRuntime(e.target.value as Runtime)}
                      style={{
                        width: "100%", padding: "7px 10px", borderRadius: 6,
                        background: "var(--bg-hover)", border: "1px solid var(--border)",
                        color: "var(--text)", fontSize: 12, outline: "none",
                      }}
                    >
                      {RUNTIMES.map((rt) => (
                        <option key={rt} value={rt} style={{ background: "var(--bg-primary)" }}>{rt}</option>
                      ))}
                    </select>
                  </div>

                  {/* Task */}
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                      Task / Message <span style={{ color: "var(--error)" }}>*</span>
                    </label>
                    <textarea
                      value={spawnTask}
                      onChange={(e) => setSpawnTask(e.target.value)}
                      placeholder="Describe what the agent should do..."
                      rows={3}
                      style={{
                        width: "100%", fontSize: 12, padding: "7px 10px", borderRadius: 6,
                        border: "1px solid var(--border)", background: "var(--bg-hover)",
                        color: "var(--text)", outline: "none", resize: "vertical",
                        fontFamily: "inherit", boxSizing: "border-box",
                      }}
                    />
                  </div>

                  {/* Optional fields row */}
                  <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    <div style={{ flex: 2 }}>
                      <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Working Directory</label>
                      <input
                        value={spawnCwd}
                        onChange={(e) => setSpawnCwd(e.target.value)}
                        placeholder="/path/to/project"
                        style={{
                          width: "100%", fontSize: 12, padding: "7px 10px", borderRadius: 6,
                          border: "1px solid var(--border)", background: "var(--bg-hover)",
                          color: "var(--text)", fontFamily: "monospace", outline: "none", boxSizing: "border-box",
                        }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Model Override</label>
                      <input
                        value={spawnModel}
                        onChange={(e) => setSpawnModel(e.target.value)}
                        placeholder="e.g. o3"
                        style={{
                          width: "100%", fontSize: 12, padding: "7px 10px", borderRadius: 6,
                          border: "1px solid var(--border)", background: "var(--bg-hover)",
                          color: "var(--text)", outline: "none", boxSizing: "border-box",
                        }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Timeout (s)</label>
                      <input
                        type="number"
                        value={spawnTimeout}
                        onChange={(e) => setSpawnTimeout(e.target.value)}
                        placeholder="300"
                        style={{
                          width: "100%", fontSize: 12, padding: "7px 10px", borderRadius: 6,
                          border: "1px solid var(--border)", background: "var(--bg-hover)",
                          color: "var(--text)", outline: "none", boxSizing: "border-box",
                        }}
                      />
                    </div>
                  </div>

                  <button
                    onClick={spawnSession}
                    disabled={spawning || !spawnTask.trim()}
                    style={{
                      width: "100%", padding: "8px 14px", borderRadius: 8, border: "none",
                      background: "var(--accent)", color: "#fff",
                      fontSize: 12, fontWeight: 600, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      opacity: spawning || !spawnTask.trim() ? 0.5 : 1,
                    }}
                  >
                    {spawning ? <Loader2 style={{ width: 13, height: 13, animation: "spin 1s linear infinite" }} /> : <Play style={{ width: 13, height: 13 }} />}
                    Spawn Session
                  </button>
                </div>
              )}
            </div>

            {/* Active Sessions */}
            <div style={{ marginBottom: 16 }}>
              <span style={{ fontSize: 10, textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.06em", fontWeight: 600, display: "block", marginBottom: 8 }}>
                ACTIVE SESSIONS {sessions.length > 0 && `(${sessions.length})`}
              </span>

              {sessions.length === 0 ? (
                <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, padding: "24px 16px", textAlign: "center" }}>
                  <Terminal style={{ width: 28, height: 28, color: "var(--text-muted)", margin: "0 auto 8px", display: "block", opacity: 0.4 }} />
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>No active ACP sessions</p>
                  <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "4px 0 0", opacity: 0.7 }}>Use the form above to spawn a new session</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      style={{
                        background: "var(--bg-elevated)", border: "1px solid var(--border)",
                        borderRadius: 10, padding: "12px 14px",
                      }}
                    >
                      {/* Session header */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <Terminal style={{ width: 13, height: 13, color: "var(--accent)", flexShrink: 0 }} />
                        <code style={{ fontSize: 11, color: "var(--text)", fontFamily: "monospace", fontWeight: 600 }}>
                          {session.id.length > 12 ? session.id.slice(0, 12) + "..." : session.id}
                        </code>
                        <span style={{
                          fontSize: 9, padding: "2px 7px", borderRadius: 8,
                          background: "var(--accent-bg)", color: "var(--accent)",
                          border: "1px solid rgba(59,130,246,0.15)",
                        }}>
                          {session.runtime}
                        </span>
                        <span style={{
                          fontSize: 9, padding: "2px 7px", borderRadius: 8,
                          background: `color-mix(in srgb, ${statusColor(session.status)} 12%, transparent)`,
                          color: statusColor(session.status),
                        }}>
                          {session.status}
                        </span>
                        {session.model && (
                          <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 8, background: "var(--bg-hover)", color: "var(--text-muted)" }}>
                            {session.model}
                          </span>
                        )}
                      </div>

                      {/* Task */}
                      <p style={{ margin: "0 0 8px", fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                        {session.task || "No task description"}
                      </p>

                      {session.cwd && (
                        <p style={{ margin: "0 0 8px", fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>
                          cwd: {session.cwd}
                        </p>
                      )}

                      {/* Action buttons */}
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          onClick={() => setSteerSessionId(steerSessionId === session.id ? null : session.id)}
                          style={{
                            display: "flex", alignItems: "center", gap: 4, padding: "5px 10px",
                            borderRadius: 6, border: "none", fontSize: 10, fontWeight: 500, cursor: "pointer",
                            background: "var(--accent-bg)", color: "var(--accent)",
                          }}
                        >
                          <Navigation style={{ width: 10, height: 10 }} /> Steer
                        </button>
                        <button
                          onClick={() => sessionAction("cancel", session.id)}
                          disabled={actionLoading === `cancel-${session.id}`}
                          style={{
                            display: "flex", alignItems: "center", gap: 4, padding: "5px 10px",
                            borderRadius: 6, border: "none", fontSize: 10, fontWeight: 500, cursor: "pointer",
                            background: "rgba(251,191,36,0.1)", color: "#fbbf24",
                          }}
                        >
                          {actionLoading === `cancel-${session.id}` ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : <Square style={{ width: 10, height: 10 }} />}
                          Cancel
                        </button>
                        <button
                          onClick={() => sessionAction("close", session.id)}
                          disabled={actionLoading === `close-${session.id}`}
                          style={{
                            display: "flex", alignItems: "center", gap: 4, padding: "5px 10px",
                            borderRadius: 6, border: "none", fontSize: 10, fontWeight: 500, cursor: "pointer",
                            background: "rgba(248,113,113,0.1)", color: "var(--error)",
                          }}
                        >
                          {actionLoading === `close-${session.id}` ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : <XCircle style={{ width: 10, height: 10 }} />}
                          Close
                        </button>
                        <button
                          onClick={() => sessionAction("doctor", session.id)}
                          disabled={actionLoading === `doctor-${session.id}`}
                          style={{
                            display: "flex", alignItems: "center", gap: 4, padding: "5px 10px",
                            borderRadius: 6, border: "none", fontSize: 10, fontWeight: 500, cursor: "pointer",
                            background: "rgba(168,85,247,0.1)", color: "#c084fc",
                          }}
                        >
                          {actionLoading === `doctor-${session.id}` ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : <Info style={{ width: 10, height: 10 }} />}
                          Doctor
                        </button>
                      </div>

                      {/* Steer input */}
                      {steerSessionId === session.id && (
                        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                          <input
                            value={steerMessage}
                            onChange={(e) => setSteerMessage(e.target.value)}
                            placeholder="Send a steering message..."
                            onKeyDown={(e) => e.key === "Enter" && steerSession(session.id)}
                            style={{
                              flex: 1, fontSize: 12, padding: "7px 10px", borderRadius: 6,
                              border: "1px solid var(--border)", background: "var(--bg-hover)",
                              color: "var(--text)", outline: "none",
                            }}
                          />
                          <button
                            onClick={() => steerSession(session.id)}
                            disabled={actionLoading === `steer-${session.id}` || !steerMessage.trim()}
                            style={{
                              padding: "7px 12px", borderRadius: 6, border: "none",
                              background: "var(--accent)", color: "#fff",
                              fontSize: 11, fontWeight: 500, cursor: "pointer",
                              display: "flex", alignItems: "center", gap: 4,
                              opacity: actionLoading === `steer-${session.id}` || !steerMessage.trim() ? 0.5 : 1,
                            }}
                          >
                            {actionLoading === `steer-${session.id}` ? <Loader2 style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} /> : <Navigation style={{ width: 11, height: 11 }} />}
                            Send
                          </button>
                        </div>
                      )}

                      {/* Action result */}
                      {actionResult?.id === session.id && (
                        <div style={{
                          marginTop: 8, padding: "6px 10px", borderRadius: 6, fontSize: 10, fontFamily: "monospace",
                          background: actionResult.ok ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)",
                          border: `1px solid ${actionResult.ok ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`,
                          color: actionResult.ok ? "var(--success)" : "var(--error)",
                          maxHeight: 80, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
                        }}>
                          {actionResult.text}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ACP Config */}
            <div style={{ marginBottom: 16 }}>
              <span style={{ fontSize: 10, textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.06em", fontWeight: 600, display: "block", marginBottom: 8 }}>
                ACP CONFIGURATION
              </span>
              <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Default Runtime</label>
                    <select
                      value={defaultRuntime}
                      onChange={(e) => setDefaultRuntime(e.target.value as Runtime)}
                      style={{
                        width: "100%", padding: "7px 10px", borderRadius: 6,
                        background: "var(--bg-hover)", border: "1px solid var(--border)",
                        color: "var(--text)", fontSize: 12, outline: "none",
                      }}
                    >
                      {RUNTIMES.map((rt) => (
                        <option key={rt} value={rt} style={{ background: "var(--bg-primary)" }}>{rt}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={saveDefaultRuntime}
                    disabled={savingConfig}
                    style={{
                      padding: "7px 14px", borderRadius: 6, border: "none",
                      background: "var(--accent-bg)", color: "var(--accent)",
                      fontSize: 11, fontWeight: 500, cursor: "pointer", marginTop: 14,
                      display: "flex", alignItems: "center", gap: 4,
                      opacity: savingConfig ? 0.5 : 1,
                    }}
                  >
                    {savingConfig ? <Loader2 style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} /> : <Settings style={{ width: 11, height: 11 }} />}
                    Save
                  </button>
                </div>

                {config && Object.keys(config).filter(k => k !== "defaultRuntime").length > 0 && (
                  <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                    <span style={{ fontSize: 9, textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.04em" }}>Other Config</span>
                    <pre style={{
                      fontSize: 10, fontFamily: "monospace", color: "var(--text-secondary)",
                      background: "var(--bg-hover)", borderRadius: 6, padding: 8, marginTop: 4,
                      overflow: "auto", maxHeight: 100,
                    }}>
                      {JSON.stringify(
                        Object.fromEntries(Object.entries(config).filter(([k]) => k !== "defaultRuntime")),
                        null,
                        2,
                      )}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
