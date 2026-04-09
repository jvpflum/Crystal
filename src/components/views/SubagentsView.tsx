import { useState, useEffect, useCallback } from "react";
import {
  GitBranch, Play, Square, Loader2, RefreshCw, Info,
  FileText, Navigation, Send, Bot, ChevronDown, ChevronRight,
  Terminal, Settings, XCircle,
} from "lucide-react";
import {
  openclawClient,
  extractJsonFromAgentOutput,
  pickSubagentListJson,
  pickAcpSessionsJson,
} from "@/lib/openclaw";
import { EASE, MONO, innerPanel, inputStyle, btnPrimary, btnSecondary, sectionLabel, emptyState, row as rowStyle, hoverLift, hoverReset, pressDown, pressUp, scrollArea } from "@/styles/viewStyles";

interface SubAgent {
  id: string;
  label?: string;
  status?: string;
  task?: string;
  model?: string;
  thinking?: string;
  startedAt?: number;
  runtime?: string;
  cwd?: string;
  source?: "subagent" | "acp";
}

interface AgentItem { id: string; name?: string; model?: string; }
interface ModelItem { key: string; name: string; }

const THINKING_LEVELS = ["default", "minimal", "low", "medium", "high"] as const;
type ThinkingLevel = typeof THINKING_LEVELS[number];

const RUNTIMES = ["codex", "claude-code", "gemini-cli"] as const;
type Runtime = typeof RUNTIMES[number];

type SpawnMode = "subagent" | "acp";

const CARD: React.CSSProperties = {
  ...innerPanel, overflow: "hidden",
};
const ROW: React.CSSProperties = {
  ...rowStyle, justifyContent: "space-between",
  padding: "10px 14px", borderBottom: "1px solid var(--border)",
};
const SECT: React.CSSProperties = {
  ...sectionLabel,
};
const BTN_P: React.CSSProperties = {
  ...btnPrimary, display: "flex", alignItems: "center", gap: 5, padding: "6px 12px",
  borderRadius: 6, fontSize: 11,
};
const BTN_G: React.CSSProperties = {
  ...btnSecondary, display: "flex", alignItems: "center", gap: 4, padding: "5px 10px",
  borderRadius: 6, background: "transparent",
};
const BTN_DANGER: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 4, padding: "5px 10px",
  borderRadius: 6, border: "1px solid rgba(248,113,113,0.3)",
  background: "rgba(248,113,113,0.08)", color: "#f87171",
  fontSize: 11, cursor: "pointer", transition: `all 0.15s ${EASE}`,
};
const INPUT: React.CSSProperties = {
  ...inputStyle, fontFamily: MONO, padding: "6px 10px",
  boxSizing: "border-box" as const,
};

export function SubagentsView() {
  const [subagents, setSubagents] = useState<SubAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [output, setOutput] = useState<{ title: string; content: string } | null>(null);

  const [spawnOpen, setSpawnOpen] = useState(false);
  const [spawnMode, setSpawnMode] = useState<SpawnMode>("subagent");
  const [spawnTask, setSpawnTask] = useState("");
  const [spawnLabel, setSpawnLabel] = useState("");
  const [spawnAgentId, setSpawnAgentId] = useState("main");
  const [spawnModel, setSpawnModel] = useState("");
  const [spawnThinking, setSpawnThinking] = useState<ThinkingLevel>("default");
  const [spawnTimeout, setSpawnTimeout] = useState("");
  const [spawnSandbox, setSpawnSandbox] = useState<"inherit" | "require">("inherit");
  const [spawnCleanup, setSpawnCleanup] = useState<"keep" | "delete">("keep");
  const [spawnRuntime, setSpawnRuntime] = useState<Runtime>("codex");
  const [spawnCwd, setSpawnCwd] = useState("");
  const [spawning, setSpawning] = useState(false);

  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [models, setModels] = useState<ModelItem[]>([]);
  const [defaultRuntime, setDefaultRuntime] = useState<Runtime>("codex");
  const [savingConfig, setSavingConfig] = useState(false);

  const [steerInputs, setSteerInputs] = useState<Record<string, string>>({});
  const [sendInputs, setSendInputs] = useState<Record<string, string>>({});

  const sendAgentMessage = useCallback(async (message: string): Promise<{ stdout: string; code: number }> => {
    const result = await openclawClient.dispatchToAgent("main", message);
    return { stdout: result.stdout || result.stderr, code: result.code };
  }, []);

  const loadSubagents = useCallback(async () => {
    setLoading(true);
    setError(null);
    const items: SubAgent[] = [];

    const [subResult, acpResult] = await Promise.allSettled([
      sendAgentMessage("/subagents list"),
      sendAgentMessage("/acp status"),
    ]);

    if (subResult.status === "fulfilled" && subResult.value.code === 0 && subResult.value.stdout.trim()) {
      const data = extractJsonFromAgentOutput(subResult.value.stdout.trim());
      if (data !== null) {
        const list = pickSubagentListJson(data);
        items.push(
          ...list.map((s: unknown) => ({ ...(s as SubAgent), source: "subagent" as const }))
        );
      } else if (subResult.value.stdout.trim()) {
        setOutput({ title: "Sub-Agents (raw)", content: subResult.value.stdout });
      }
    }

    if (acpResult.status === "fulfilled" && acpResult.value.code === 0 && acpResult.value.stdout.trim()) {
      const data = extractJsonFromAgentOutput(acpResult.value.stdout.trim());
      if (data !== null) {
        const raw = pickAcpSessionsJson(data);
        const acpList: SubAgent[] = raw.map((s: unknown) => {
          const r = s as Record<string, unknown>;
          return {
            id: String(r.id ?? r.sessionId ?? ""),
            runtime: String(r.runtime ?? r.type ?? ""),
            status: String(r.status ?? r.state ?? "unknown"),
            task: String(r.task ?? r.message ?? r.prompt ?? ""),
            model: r.model ? String(r.model) : undefined,
            cwd: r.cwd ? String(r.cwd) : undefined,
            source: "acp" as const,
          };
        });
        items.push(...acpList);
      }
    }

    if (subResult.status === "rejected" && acpResult.status === "rejected") {
      setError("Failed to load sub-agents");
    }

    setSubagents(items);
    setLoading(false);
    setInitialLoad(false);
  }, [sendAgentMessage]);

  const loadAgents = useCallback(async () => {
    try {
      const list = await openclawClient.listAgents();
      setAgents(list);
    } catch { /* best-effort */ }
  }, []);

  const loadModels = useCallback(async () => {
    try {
      const keys = await openclawClient.getModels();
      setModels(keys.map(k => ({ key: k, name: openclawClient.getModelDisplayName(k) })));
    } catch { /* best-effort */ }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await openclawClient.getConfig();
      const rt = cfg?.acp?.defaultRuntime as string | undefined;
      if (rt && RUNTIMES.includes(rt as Runtime)) {
        setDefaultRuntime(rt as Runtime);
      }
    } catch { /* optional */ }
  }, []);

  useEffect(() => {
    loadAgents();
    loadModels();
    loadConfig();
    loadSubagents();
  }, [loadSubagents, loadAgents, loadModels, loadConfig]);

  useEffect(() => {
    if (feedback) { const t = setTimeout(() => setFeedback(null), 4000); return () => clearTimeout(t); }
  }, [feedback]);

  const spawnSubagent = async () => {
    if (!spawnTask.trim()) return;
    setSpawning(true);
    try {
      if (spawnMode === "subagent") {
        let cmd = `/subagents spawn ${spawnTask.trim()}`;
        if (spawnModel) cmd += ` --model ${spawnModel}`;
        if (spawnThinking !== "default") cmd += ` --thinking ${spawnThinking}`;
        if (spawnLabel.trim()) cmd += ` --label ${spawnLabel.trim()}`;
        if (spawnTimeout.trim()) cmd += ` --timeout ${spawnTimeout.trim()}`;
        if (spawnSandbox === "require") cmd += ` --sandbox require`;
        if (spawnCleanup === "delete") cmd += ` --cleanup delete`;
        const result = await sendAgentMessage(cmd);
        if (result.code === 0) {
          setFeedback({ type: "success", msg: "Sub-agent spawned" });
        } else {
          setFeedback({ type: "error", msg: result.stdout || "Spawn failed" });
        }
      } else {
        let cmd = `/acp spawn --runtime ${spawnRuntime}`;
        if (spawnModel.trim()) cmd += ` --model ${spawnModel.trim()}`;
        if (spawnCwd.trim()) cmd += ` --cwd ${spawnCwd.trim()}`;
        if (spawnTimeout.trim()) cmd += ` --timeout ${spawnTimeout.trim()}`;
        cmd += ` ${spawnTask.trim()}`;
        const result = await sendAgentMessage(cmd);
        if (result.code === 0) {
          setFeedback({ type: "success", msg: "ACP session spawned" });
        } else {
          setFeedback({ type: "error", msg: result.stdout || "Spawn failed" });
        }
      }
      setSpawnTask("");
      setSpawnLabel("");
      setSpawnModel("");
      setSpawnThinking("default");
      setSpawnTimeout("");
      setSpawnSandbox("inherit");
      setSpawnCleanup("keep");
      setSpawnCwd("");
      await loadSubagents();
    } catch (e) {
      setFeedback({ type: "error", msg: e instanceof Error ? e.message : "Spawn failed" });
    }
    setSpawning(false);
  };

  const subagentAction = async (label: string, message: string) => {
    setActionLoading(label);
    try {
      const result = await sendAgentMessage(message);
      if (result.code === 0) {
        setFeedback({ type: "success", msg: `${label}: Done` });
        if (result.stdout.trim()) setOutput({ title: label, content: result.stdout });
        if (label.startsWith("Kill") || label.startsWith("Cancel") || label.startsWith("Close")) await loadSubagents();
      } else {
        setFeedback({ type: "error", msg: result.stdout || `${label} failed` });
      }
    } catch (e) {
      setFeedback({ type: "error", msg: e instanceof Error ? e.message : `${label} failed` });
    }
    setActionLoading(null);
  };

  const saveDefaultRuntime = async () => {
    setSavingConfig(true);
    try {
      await openclawClient.updateConfig({ acp: { defaultRuntime } });
      setFeedback({ type: "success", msg: "Default runtime updated" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update config");
    }
    setSavingConfig(false);
  };

  const isLoading = (key: string) => actionLoading === key;

  const statusColor = (s?: string) => {
    if (!s) return "var(--text-muted)";
    const l = s.toLowerCase();
    if (l === "running" || l === "active") return "#4ade80";
    if (l === "completed" || l === "done") return "var(--accent)";
    if (l === "error" || l === "failed") return "#f87171";
    if (l === "killed" || l === "stopped" || l === "cancelled") return "#fbbf24";
    return "var(--text-muted)";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <GitBranch style={{ width: 18, height: 18, color: "var(--accent)" }} />
            <div>
              <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Sub-Agents</h2>
              <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted)" }}>
                {subagents.length} agent{subagents.length !== 1 ? "s" : ""}
                {subagents.filter(s => s.status?.toLowerCase() === "running" || s.status?.toLowerCase() === "active").length > 0 && (
                  <> &middot; <span style={{ color: "#4ade80" }}>{subagents.filter(s => s.status?.toLowerCase() === "running" || s.status?.toLowerCase() === "active").length} active</span></>
                )}
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => subagentAction("Kill All", "/subagents kill all")}
              disabled={isLoading("Kill All") || subagents.filter(s => s.source === "subagent").length === 0}
              onMouseDown={pressDown} onMouseUp={pressUp}
              style={{ ...BTN_DANGER, opacity: subagents.filter(s => s.source === "subagent").length === 0 ? 0.4 : 1 }}
            >
              {isLoading("Kill All") ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : <Square style={{ width: 10, height: 10 }} />}
              Kill All
            </button>
            <button onClick={loadSubagents} disabled={loading} onMouseDown={pressDown} onMouseUp={pressUp} style={BTN_P}>
              <RefreshCw style={{ width: 12, height: 12, ...(loading ? { animation: "spin 1s linear infinite" } : {}) }} /> Refresh
            </button>
          </div>
        </div>

        {feedback && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, marginBottom: 10,
            background: feedback.type === "success" ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)",
            border: `1px solid ${feedback.type === "success" ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: feedback.type === "success" ? "#4ade80" : "#f87171" }} />
            <span style={{ fontSize: 11, color: feedback.type === "success" ? "#4ade80" : "#f87171", flex: 1 }}>{feedback.msg}</span>
            <button onClick={() => setFeedback(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>×</button>
          </div>
        )}

        {error && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, marginBottom: 10,
            background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)",
          }}>
            <XCircle style={{ width: 14, height: 14, color: "#f87171", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "#f87171", flex: 1 }}>{error}</span>
            <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>×</button>
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ ...scrollArea, padding: "0 20px 20px" }}>
        {/* Spawn Form */}
        <div style={{ marginBottom: 20 }}>
          <button
            onClick={() => setSpawnOpen(!spawnOpen)}
            style={{
              display: "flex", alignItems: "center", gap: 8, width: "100%",
              padding: "10px 14px", borderRadius: spawnOpen ? "10px 10px 0 0" : 10,
              background: "var(--bg-elevated)", border: "1px solid var(--border)",
              cursor: "pointer", color: "var(--text)", fontSize: 12, fontWeight: 600,
            }}
          >
            {spawnOpen
              ? <ChevronDown style={{ width: 14, height: 14, color: "var(--text-muted)" }} />
              : <ChevronRight style={{ width: 14, height: 14, color: "var(--text-muted)" }} />}
            <Play style={{ width: 14, height: 14, color: "var(--accent)" }} />
            Spawn Agent
          </button>
          {spawnOpen && (
            <div style={{ ...CARD, borderRadius: "0 0 10px 10px", borderTop: "none" }}>
              <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                {/* Mode toggle */}
                <div>
                  <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4, fontWeight: 500 }}>Spawn Mode</label>
                  <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)" }}>
                    {([
                      { id: "subagent" as const, label: "Sub-Agent", icon: GitBranch },
                      { id: "acp" as const, label: "ACP Session", icon: Terminal },
                    ]).map(opt => (
                      <button key={opt.id} onClick={() => setSpawnMode(opt.id)}
                        style={{
                          flex: 1, padding: "7px 0", border: "none", fontSize: 11, cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                          background: spawnMode === opt.id ? "var(--accent-bg)" : "var(--bg-elevated)",
                          color: spawnMode === opt.id ? "var(--accent)" : "var(--text-muted)",
                          fontWeight: spawnMode === opt.id ? 600 : 400,
                        }}>
                        <opt.icon style={{ width: 11, height: 11 }} />
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {spawnMode === "acp" && (
                  <div>
                    <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4, fontWeight: 500 }}>Runtime</label>
                    <select value={spawnRuntime} onChange={e => setSpawnRuntime(e.target.value as Runtime)}
                      style={{ ...INPUT, width: "100%", fontSize: 11, padding: "6px 8px" }}>
                      {RUNTIMES.map(rt => <option key={rt} value={rt}>{rt}</option>)}
                    </select>
                  </div>
                )}

                <div>
                  <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4, fontWeight: 500 }}>Task Description *</label>
                  <textarea
                    value={spawnTask} onChange={e => setSpawnTask(e.target.value)}
                    placeholder={spawnMode === "subagent" ? "Describe the task for the sub-agent..." : "Describe what the ACP agent should do..."}
                    rows={3}
                    style={{ ...INPUT, width: "100%", resize: "vertical", fontSize: 11, lineHeight: 1.5 }}
                  />
                </div>

                {spawnMode === "subagent" ? (
                  <>
                    <div style={{ display: "flex", gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4, fontWeight: 500 }}>Label (optional)</label>
                        <input value={spawnLabel} onChange={e => setSpawnLabel(e.target.value)} placeholder="e.g. research-task"
                          style={{ ...INPUT, width: "100%", fontSize: 11 }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4, fontWeight: 500 }}>Agent</label>
                        <select value={spawnAgentId} onChange={e => setSpawnAgentId(e.target.value)}
                          style={{ ...INPUT, width: "100%", fontSize: 11, padding: "6px 8px" }}>
                          <option value="main">main</option>
                          {agents.filter(a => a.id !== "main").map(a => (
                            <option key={a.id} value={a.id}>{a.id}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4, fontWeight: 500 }}>Model Override</label>
                        <select value={spawnModel} onChange={e => setSpawnModel(e.target.value)}
                          style={{ ...INPUT, width: "100%", fontSize: 11, padding: "6px 8px" }}>
                          <option value="">Default model</option>
                          {models.filter(m => m.key).map(m => (
                            <option key={m.key} value={m.key}>{m.name || m.key}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ width: 140 }}>
                        <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4, fontWeight: 500 }}>Thinking Level</label>
                        <select value={spawnThinking} onChange={e => setSpawnThinking(e.target.value as ThinkingLevel)}
                          style={{ ...INPUT, width: "100%", fontSize: 11, padding: "6px 8px" }}>
                          {THINKING_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <div style={{ width: 120 }}>
                        <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4, fontWeight: 500 }}>Timeout (sec)</label>
                        <input type="number" value={spawnTimeout} onChange={e => setSpawnTimeout(e.target.value)}
                          placeholder="optional" min={0} style={{ ...INPUT, width: "100%", fontSize: 11 }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4, fontWeight: 500 }}>Sandbox</label>
                        <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)" }}>
                          {(["inherit", "require"] as const).map(opt => (
                            <button key={opt} onClick={() => setSpawnSandbox(opt)}
                              style={{
                                flex: 1, padding: "6px 0", border: "none", fontSize: 11, cursor: "pointer",
                                background: spawnSandbox === opt ? "var(--accent-bg)" : "var(--bg-elevated)",
                                color: spawnSandbox === opt ? "var(--accent)" : "var(--text-muted)",
                                fontWeight: spawnSandbox === opt ? 600 : 400,
                              }}>
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4, fontWeight: 500 }}>Cleanup</label>
                        <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)" }}>
                          {(["keep", "delete"] as const).map(opt => (
                            <button key={opt} onClick={() => setSpawnCleanup(opt)}
                              style={{
                                flex: 1, padding: "6px 0", border: "none", fontSize: 11, cursor: "pointer",
                                background: spawnCleanup === opt ? "var(--accent-bg)" : "var(--bg-elevated)",
                                color: spawnCleanup === opt ? "var(--accent)" : "var(--text-muted)",
                                fontWeight: spawnCleanup === opt ? 600 : 400,
                              }}>
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ flex: 2 }}>
                      <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4, fontWeight: 500 }}>Working Directory</label>
                      <input value={spawnCwd} onChange={e => setSpawnCwd(e.target.value)} placeholder="/path/to/project"
                        style={{ ...INPUT, width: "100%", fontSize: 11 }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4, fontWeight: 500 }}>Model Override</label>
                      <input value={spawnModel} onChange={e => setSpawnModel(e.target.value)} placeholder="e.g. o3"
                        style={{ ...INPUT, width: "100%", fontSize: 11 }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4, fontWeight: 500 }}>Timeout (s)</label>
                      <input type="number" value={spawnTimeout} onChange={e => setSpawnTimeout(e.target.value)} placeholder="300"
                        style={{ ...INPUT, width: "100%", fontSize: 11 }} />
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button onClick={spawnSubagent} disabled={spawning || !spawnTask.trim()}
                    onMouseDown={pressDown} onMouseUp={pressUp}
                    style={{
                      ...BTN_P, padding: "8px 20px",
                      background: spawnTask.trim() ? "var(--accent)" : "var(--bg-hover)",
                      color: spawnTask.trim() ? "#fff" : "var(--text-muted)",
                      opacity: !spawnTask.trim() ? 0.5 : 1,
                    }}>
                    {spawning
                      ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />
                      : <Play style={{ width: 12, height: 12 }} />}
                    {spawnMode === "subagent" ? "Spawn" : "Spawn ACP"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Active Agents List */}
        <div style={{ marginBottom: 20 }}>
          <span style={SECT}>Active Agents ({subagents.length})</span>
          {initialLoad && loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
              <Loader2 style={{ width: 24, height: 24, color: "var(--accent)", animation: "spin 1s linear infinite" }} />
            </div>
          ) : subagents.length === 0 ? (
            <div style={{ ...CARD, ...emptyState }}>
              <Bot style={{ width: 28, height: 28, color: "var(--text-muted)", opacity: 0.3 }} />
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>No active agents</p>
              <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4, opacity: 0.6 }}>Use the Spawn form above to create a sub-agent or ACP session</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {subagents.map(sa => (
                <div key={`${sa.source}-${sa.id}`} style={CARD}
                  data-glow={statusColor(sa.status)}
                  onMouseEnter={hoverLift}
                  onMouseLeave={hoverReset}
                >
                  <div style={ROW}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 10, display: "flex",
                        alignItems: "center", justifyContent: "center",
                        background: `${statusColor(sa.status)}12`,
                        border: `1px solid ${statusColor(sa.status)}25`,
                      }}>
                        {sa.source === "acp"
                          ? <Terminal style={{ width: 16, height: 16, color: statusColor(sa.status) }} />
                          : <Bot style={{ width: 16, height: 16, color: statusColor(sa.status) }} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", fontFamily: MONO }}>{sa.id}</span>
                          {sa.label && <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{sa.label}</span>}
                          <span style={{
                            fontSize: 8, padding: "2px 6px", borderRadius: 4, fontWeight: 600,
                            background: sa.source === "acp" ? "rgba(168,85,247,0.12)" : "rgba(59,130,246,0.12)",
                            color: sa.source === "acp" ? "#c084fc" : "var(--accent)",
                            textTransform: "uppercase",
                          }}>
                            {sa.source === "acp" ? `ACP${sa.runtime ? ` · ${sa.runtime}` : ""}` : "SUB"}
                          </span>
                          {sa.status && (
                            <span style={{
                              fontSize: 8, padding: "2px 6px", borderRadius: 4, fontWeight: 600,
                              background: `${statusColor(sa.status)}15`,
                              color: statusColor(sa.status),
                              textTransform: "uppercase",
                            }}>
                              {sa.status}
                            </span>
                          )}
                        </div>
                        {sa.task && (
                          <p style={{
                            margin: "3px 0 0", fontSize: 10, color: "var(--text-secondary)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 400,
                          }}>
                            {sa.task}
                          </p>
                        )}
                        <div style={{ display: "flex", gap: 8, marginTop: 3 }}>
                          {sa.model && <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: MONO }}>{sa.model}</span>}
                          {sa.thinking && <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: "var(--bg-hover)", color: "var(--text-muted)" }}>thinking: {sa.thinking}</span>}
                          {sa.cwd && <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: MONO }}>cwd: {sa.cwd}</span>}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      {sa.source === "subagent" && (
                        <>
                          <button onClick={() => subagentAction(`Info-${sa.id}`, `/subagents info ${sa.id}`)}
                            disabled={isLoading(`Info-${sa.id}`)}
                            style={{ ...BTN_G, padding: "4px 8px", fontSize: 10 }} title="Info">
                            {isLoading(`Info-${sa.id}`) ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : <Info style={{ width: 10, height: 10 }} />}
                          </button>
                          <button onClick={() => subagentAction(`Log-${sa.id}`, `/subagents log ${sa.id}`)}
                            disabled={isLoading(`Log-${sa.id}`)}
                            style={{ ...BTN_G, padding: "4px 8px", fontSize: 10 }} title="View Log">
                            {isLoading(`Log-${sa.id}`) ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : <FileText style={{ width: 10, height: 10 }} />}
                          </button>
                          <button onClick={() => subagentAction(`Kill-${sa.id}`, `/subagents kill ${sa.id}`)}
                            disabled={isLoading(`Kill-${sa.id}`)}
                            style={{ ...BTN_DANGER, padding: "4px 8px", fontSize: 10 }} title="Kill">
                            {isLoading(`Kill-${sa.id}`) ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : <Square style={{ width: 10, height: 10 }} />}
                          </button>
                        </>
                      )}
                      {sa.source === "acp" && (
                        <>
                          <button onClick={() => subagentAction(`Doctor-${sa.id}`, `/acp doctor ${sa.id}`)}
                            disabled={isLoading(`Doctor-${sa.id}`)}
                            style={{ ...BTN_G, padding: "4px 8px", fontSize: 10, borderColor: "rgba(168,85,247,0.3)", color: "#c084fc" }} title="Doctor">
                            {isLoading(`Doctor-${sa.id}`) ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : <Info style={{ width: 10, height: 10 }} />}
                          </button>
                          <button onClick={() => subagentAction(`Cancel-${sa.id}`, `/acp cancel ${sa.id}`)}
                            disabled={isLoading(`Cancel-${sa.id}`)}
                            style={{ ...BTN_G, padding: "4px 8px", fontSize: 10, borderColor: "rgba(251,191,36,0.3)", color: "#fbbf24" }} title="Cancel">
                            {isLoading(`Cancel-${sa.id}`) ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : <Square style={{ width: 10, height: 10 }} />}
                          </button>
                          <button onClick={() => subagentAction(`Close-${sa.id}`, `/acp close ${sa.id}`)}
                            disabled={isLoading(`Close-${sa.id}`)}
                            style={{ ...BTN_DANGER, padding: "4px 8px", fontSize: 10 }} title="Close">
                            {isLoading(`Close-${sa.id}`) ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : <XCircle style={{ width: 10, height: 10 }} />}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {/* Steer + Send row */}
                  <div style={{ padding: "8px 14px 10px", display: "flex", gap: 8 }}>
                    <div style={{ flex: 1, display: "flex", gap: 4 }}>
                      <input
                        type="text" placeholder="Steer message..."
                        value={steerInputs[sa.id] || ""}
                        onChange={e => setSteerInputs(prev => ({ ...prev, [sa.id]: e.target.value }))}
                        onKeyDown={e => {
                          if (e.key === "Enter" && steerInputs[sa.id]?.trim()) {
                            const cmd = sa.source === "acp" ? `/acp steer ${sa.id} ${steerInputs[sa.id]}` : `/subagents steer ${sa.id} ${steerInputs[sa.id]}`;
                            subagentAction(`Steer-${sa.id}`, cmd);
                            setSteerInputs(prev => ({ ...prev, [sa.id]: "" }));
                          }
                        }}
                        style={{ ...INPUT, flex: 1, fontSize: 10, padding: "5px 8px" }}
                      />
                      <button
                        onClick={() => {
                          if (steerInputs[sa.id]?.trim()) {
                            const cmd = sa.source === "acp" ? `/acp steer ${sa.id} ${steerInputs[sa.id]}` : `/subagents steer ${sa.id} ${steerInputs[sa.id]}`;
                            subagentAction(`Steer-${sa.id}`, cmd);
                            setSteerInputs(prev => ({ ...prev, [sa.id]: "" }));
                          }
                        }}
                        disabled={!steerInputs[sa.id]?.trim() || isLoading(`Steer-${sa.id}`)}
                        style={{ ...BTN_G, padding: "4px 8px", fontSize: 10, borderColor: "rgba(251,191,36,0.3)", color: "#fbbf24" }}
                        title="Steer"
                      >
                        {isLoading(`Steer-${sa.id}`) ? <Loader2 style={{ width: 9, height: 9, animation: "spin 1s linear infinite" }} /> : <Navigation style={{ width: 9, height: 9 }} />}
                      </button>
                    </div>
                    {sa.source === "subagent" && (
                      <div style={{ flex: 1, display: "flex", gap: 4 }}>
                        <input
                          type="text" placeholder="Send message..."
                          value={sendInputs[sa.id] || ""}
                          onChange={e => setSendInputs(prev => ({ ...prev, [sa.id]: e.target.value }))}
                          onKeyDown={e => {
                            if (e.key === "Enter" && sendInputs[sa.id]?.trim()) {
                              subagentAction(`Send-${sa.id}`, `/subagents send ${sa.id} ${sendInputs[sa.id]}`);
                              setSendInputs(prev => ({ ...prev, [sa.id]: "" }));
                            }
                          }}
                          style={{ ...INPUT, flex: 1, fontSize: 10, padding: "5px 8px" }}
                        />
                        <button
                          onClick={() => {
                            if (sendInputs[sa.id]?.trim()) {
                              subagentAction(`Send-${sa.id}`, `/subagents send ${sa.id} ${sendInputs[sa.id]}`);
                              setSendInputs(prev => ({ ...prev, [sa.id]: "" }));
                            }
                          }}
                          disabled={!sendInputs[sa.id]?.trim() || isLoading(`Send-${sa.id}`)}
                          style={{ ...BTN_P, padding: "4px 8px", fontSize: 10 }}
                          title="Send"
                        >
                          {isLoading(`Send-${sa.id}`) ? <Loader2 style={{ width: 9, height: 9, animation: "spin 1s linear infinite" }} /> : <Send style={{ width: 9, height: 9 }} />}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ACP Config */}
        <div style={{ marginBottom: 20 }}>
          <span style={SECT}>ACP Configuration</span>
          <div style={{ ...CARD, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Default Runtime</label>
                <select value={defaultRuntime} onChange={e => setDefaultRuntime(e.target.value as Runtime)}
                  style={{ ...INPUT, width: "100%", fontSize: 11, padding: "6px 8px" }}>
                  {RUNTIMES.map(rt => <option key={rt} value={rt}>{rt}</option>)}
                </select>
              </div>
              <button onClick={saveDefaultRuntime} disabled={savingConfig}
                style={{ ...BTN_P, marginTop: 14, opacity: savingConfig ? 0.5 : 1 }}>
                {savingConfig ? <Loader2 style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} /> : <Settings style={{ width: 11, height: 11 }} />}
                Save
              </button>
            </div>
          </div>
        </div>

        {/* Output Panel */}
        {output && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={SECT}>{output.title}</span>
              <button onClick={() => setOutput(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 10, cursor: "pointer" }}>Dismiss</button>
            </div>
            <pre style={{
              margin: 0, padding: "10px 14px", borderRadius: 10,
              background: "var(--bg-elevated)", border: "1px solid var(--border)",
              fontSize: 11, fontFamily: MONO, color: "var(--text-secondary)",
              whiteSpace: "pre-wrap", wordBreak: "break-word",
              maxHeight: 300, overflowY: "auto",
            }}>
              {output.content}
            </pre>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
