import { useState, useEffect, useCallback, useRef } from "react";
import {
  Bot, Plus, Trash2, RefreshCw, Loader2, Star, Pencil, Play, AlertTriangle,
  Send, ChevronDown, ChevronUp, Copy, Radio, Cpu, Network, Zap, Bell,
  CheckCircle2, AlertCircle, X, Cloud, HardDrive,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { escapeShellArg } from "@/lib/tools";
import { cachedCommand } from "@/lib/cache";
import { openclawClient } from "@/lib/openclaw";
import { useAppStore } from "@/stores/appStore";

interface Agent {
  id: string;
  workspace: string;
  agentDir: string;
  model: string;
  bindings: number;
  isDefault: boolean;
  routes: string[];
}

interface Binding { agentId: string; type: string; value: string; }

interface AgentSession {
  key: string; sessionId: string; model: string; modelProvider: string;
  inputTokens: number; outputTokens: number; totalTokens: number;
  contextTokens: number; agentId: string; updatedAt: number; ageMs: number; kind: string;
}

interface DispatchedTask {
  id: string; prompt: string; agentId: string;
  status: "running" | "completed" | "error";
  result?: string; startedAt: number; completedAt?: number;
}

interface ModelInfo {
  key: string; name: string; input: string; contextWindow: number;
  local: boolean; available: boolean; tags: string[]; missing: boolean;
}

interface NodeItem { id: string; name?: string; label?: string; status?: string; type?: string; }

type DetailTab = "overview" | "sessions" | "channels" | "tasks" | "compute";

const MONO: React.CSSProperties = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" };
const CARD: React.CSSProperties = { background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" };
const ROW: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--border)" };
const LABEL: React.CSSProperties = { fontSize: 11, color: "var(--text-secondary)" };
const INPUT: React.CSSProperties = { background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", color: "var(--text)", fontSize: 12, outline: "none", ...MONO, boxSizing: "border-box" as const };
const BTN_P: React.CSSProperties = { display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 6, border: "none", background: "var(--accent-bg)", color: "var(--accent)", fontSize: 11, fontWeight: 500, cursor: "pointer" };
const BTN_G: React.CSSProperties = { display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", fontSize: 11, cursor: "pointer" };
const SECT: React.CSSProperties = { fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)", marginBottom: 8 };

export function AgentsView() {
  const setView = useAppStore(s => s.setView);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");

  const [showAddForm, setShowAddForm] = useState(false);
  const [newAgentId, setNewAgentId] = useState("");
  const [newAgentModel, setNewAgentModel] = useState("");
  const [adding, setAdding] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [editingIdentity, setEditingIdentity] = useState(false);
  const [identityName, setIdentityName] = useState("");
  const [identityEmoji, setIdentityEmoji] = useState("");
  const [savingIdentity, setSavingIdentity] = useState(false);

  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const [bindings, setBindings] = useState<Binding[]>([]);
  const [showBindForm, setShowBindForm] = useState(false);
  const [bindType, setBindType] = useState<"phone" | "channel">("channel");
  const [bindValue, setBindValue] = useState("");
  const [binding, setBinding] = useState(false);

  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const [tasks, setTasks] = useState<DispatchedTask[]>([]);
  const [taskPrompt, setTaskPrompt] = useState("");
  const [dispatchAgentId, setDispatchAgentId] = useState<string>("main");
  const runningRef = useRef<Set<string>>(new Set());

  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);

  const [channelStatus, setChannelStatus] = useState<{
    channels: Record<string, { configured: boolean; running: boolean; lastError: string | null }>;
    channelMeta: { id: string; label: string }[];
    channelAccounts: Record<string, { accountId: string; connected: boolean; bot?: { username: string }; lastInboundAt: number | null }[]>;
  } | null>(null);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await openclawClient.listAgents();
      setAgents(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load agents");
      setAgents([]);
    }
    setLoading(false);
  }, []);

  const loadBindings = useCallback(async () => {
    try {
      const result = await cachedCommand("openclaw agents bindings --json", { ttl: 60_000 });
      if (result.code === 0) {
        const data = JSON.parse(result.stdout);
        setBindings(Array.isArray(data) ? data : []);
      }
    } catch { /* non-critical */ }
  }, []);

  const loadSessions = useCallback(async (agentId?: string) => {
    setLoadingSessions(true);
    try {
      const data = await openclawClient.getAgentSessions(agentId);
      setSessions(data);
    } catch { setSessions([]); }
    setLoadingSessions(false);
  }, []);

  const loadChannels = useCallback(async () => {
    try {
      const data = await openclawClient.getChannelStatus();
      setChannelStatus(data);
    } catch { /* ignore */ }
  }, []);

  const loadModels = useCallback(async () => {
    try {
      const result = await cachedCommand("openclaw models list --json", { ttl: 60_000 });
      if (result.code === 0 && result.stdout.trim()) {
        const jsonStart = result.stdout.indexOf("{");
        const jsonStr = jsonStart >= 0 ? result.stdout.slice(jsonStart) : result.stdout;
        const parsed = JSON.parse(jsonStr);
        setAvailableModels(parsed.models || []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadAgents();
    loadBindings();
    loadChannels();
    loadModels();
  }, [loadAgents, loadBindings, loadChannels, loadModels]);

  const selected = agents.find(a => a.id === selectedId);

  useEffect(() => {
    if (selected && detailTab === "sessions") loadSessions(selected.id);
  }, [selected, detailTab, loadSessions]);

  const addAgent = async () => {
    const id = newAgentId.trim().replace(/\s+/g, "-").toLowerCase();
    if (!id) return;
    if (id === "main") {
      setError("Cannot create agent with reserved ID 'main'");
      return;
    }
    if (!/^[a-z0-9][a-z0-9\-]*$/.test(id)) {
      setError("Agent ID must be lowercase alphanumeric with hyphens (e.g. 'researcher', 'code-review')");
      return;
    }
    if (agents.some(a => a.id === id)) {
      setError(`Agent "${id}" already exists`);
      return;
    }
    setAdding(true);
    try {
      const workspace = `$env:USERPROFILE\\.openclaw\\agents\\${id}\\workspace`;
      let cmd = `openclaw agents add "${id}" --non-interactive --workspace "${workspace}"`;
      if (newAgentModel) cmd += ` --model "${newAgentModel}"`;
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: cmd, cwd: null,
      });
      if (result.code !== 0) {
        setError(result.stderr || "Failed to add agent");
      } else {
        setNewAgentId("");
        setNewAgentModel("");
        setShowAddForm(false);
        await loadAgents();
        setSelectedId(id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add agent");
    }
    setAdding(false);
  };

  const deleteAgent = async (id: string) => {
    setDeleting(true);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `openclaw agents delete "${id}" --force`, cwd: null,
      });
      if (result.code !== 0) setError(result.stderr || "Failed to delete agent");
      else { setConfirmDelete(null); if (selectedId === id) setSelectedId(null); await loadAgents(); }
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    setDeleting(false);
  };

  const saveIdentity = async (id: string) => {
    setSavingIdentity(true);
    try {
      let cmd = `openclaw agents set-identity "${id}"`;
      if (identityName.trim()) cmd += ` --name "${escapeShellArg(identityName.trim())}"`;
      if (identityEmoji.trim()) cmd += ` --emoji "${escapeShellArg(identityEmoji.trim())}"`;
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", { command: cmd, cwd: null });
      if (result.code !== 0) setError(result.stderr || "Failed to set identity");
      else { setEditingIdentity(false); await loadAgents(); }
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    setSavingIdentity(false);
  };

  const testAgent = async (id: string) => {
    setTesting(id);
    setTestResult(null);
    try {
      const result = await openclawClient.dispatchToAgent(id, "Hello, who are you?");
      setTestResult(result.code === 0 ? result.stdout : (result.stderr || "Test failed"));
    } catch (e) { setTestResult(e instanceof Error ? e.message : "Test failed"); }
    setTesting(null);
  };

  const changeAgentModel = async (agentId: string, modelKey: string) => {
    try {
      if (agentId === "main") {
        await invoke("execute_command", {
          command: `openclaw models set "${modelKey}"`, cwd: null,
        });
      } else {
        const configPath = "~/.openclaw/openclaw.json";
        const raw = await invoke<string>("read_file", { path: configPath });
        const config = JSON.parse(raw);
        const agentEntry = config.agents?.list?.find((a: any) => a.id === agentId);
        if (agentEntry) {
          agentEntry.model = modelKey;
          await invoke("write_file", { path: configPath, content: JSON.stringify(config, null, 2) });
        } else {
          setError(`Agent "${agentId}" not found in config`);
          return;
        }
      }
      await loadAgents();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to change model");
    }
  };

  const addBinding = async (agentId: string) => {
    if (!bindValue.trim()) return;
    setBinding(true);
    try {
      const flag = bindType === "phone" ? `--phone "${escapeShellArg(bindValue.trim())}"` : `--channel "${escapeShellArg(bindValue.trim())}"`;
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `openclaw agents bind "${agentId}" ${flag}`, cwd: null,
      });
      if (result.code !== 0) setError(result.stderr || "Failed");
      else { setBindValue(""); setShowBindForm(false); await loadBindings(); await loadAgents(); }
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    setBinding(false);
  };

  const removeBinding = async (agentId: string, type: string, value: string) => {
    try {
      const flag = type === "phone" ? `--phone ${value}` : `--channel ${value}`;
      await invoke<{ stdout: string; code: number }>("execute_command", {
        command: `openclaw agents unbind "${agentId}" ${flag}`, cwd: null,
      });
      await loadBindings();
      await loadAgents();
    } catch { /* non-critical */ }
  };

  const agentBindings = (id: string) => bindings.filter(b => b.agentId === id);

  const dispatchTask = async () => {
    if (!taskPrompt.trim()) return;
    const task: DispatchedTask = {
      id: crypto.randomUUID(), prompt: taskPrompt.trim(), agentId: dispatchAgentId,
      status: "running", startedAt: Date.now(),
    };
    if (runningRef.current.has(task.id)) return;
    runningRef.current.add(task.id);
    setTasks(prev => [task, ...prev]);
    setTaskPrompt("");
    try {
      const result = await openclawClient.dispatchToAgent(task.agentId, task.prompt);
      const output = result.stdout || result.stderr || "Task completed";
      setTasks(prev => prev.map(t => t.id === task.id
        ? { ...t, status: result.code === 0 ? "completed" : "error", result: output, completedAt: Date.now() }
        : t
      ));
    } catch (err) {
      setTasks(prev => prev.map(t => t.id === task.id
        ? { ...t, status: "error", result: err instanceof Error ? err.message : "Unknown error", completedAt: Date.now() }
        : t
      ));
    }
    runningRef.current.delete(task.id);
  };

  const agentSessions = (id: string) => sessions.filter(s => s.agentId === id);

  const DETAIL_TABS: { id: DetailTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "sessions", label: `Sessions${selected ? ` (${agentSessions(selected.id).length})` : ""}` },
    { id: "channels", label: "Channels" },
    { id: "tasks", label: `Tasks (${tasks.filter(t => !selected || t.agentId === selected.id).length})` },
    { id: "compute", label: "Compute" },
  ];

  const modelForAgent = (agent: Agent) => {
    const m = availableModels.find(m2 => m2.key === agent.model);
    return m || null;
  };

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* ── Left: Agent Roster ── */}
      <div style={{ width: 240, flexShrink: 0, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Agents</h2>
            <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted)" }}>
              {agents.length} agent{agents.length !== 1 ? "s" : ""} &middot; {availableModels.length} model{availableModels.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => { loadAgents(); loadBindings(); loadChannels(); loadModels(); }} style={BTN_G}>
              <RefreshCw style={{ width: 11, height: 11 }} />
            </button>
            <button onClick={() => setShowAddForm(!showAddForm)} style={BTN_P}>
              <Plus style={{ width: 11, height: 11 }} /> New
            </button>
          </div>
        </div>

        {showAddForm && (
          <div style={{ padding: "0 12px 8px" }}>
            <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
              <input value={newAgentId} onChange={e => setNewAgentId(e.target.value.replace(/\s+/g, "-"))} onKeyDown={e => e.key === "Enter" && addAgent()}
                placeholder="e.g. researcher, code-review" style={{ ...INPUT, flex: 1, fontSize: 11 }} />
              <button onClick={addAgent} disabled={adding} style={BTN_P}>
                {adding ? <Loader2 style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} /> : "Add"}
              </button>
            </div>
            <select value={newAgentModel} onChange={e => setNewAgentModel(e.target.value)}
              style={{ ...INPUT, width: "100%", fontSize: 10, padding: "4px 6px" }}>
              <option value="">Default model</option>
              {availableModels.filter(m => m.available).map(m => (
                <option key={m.key} value={m.key}>{m.local ? "🖥️" : "☁️"} {m.name} ({m.key})</option>
              ))}
            </select>
          </div>
        )}

        {error && (
          <div style={{ padding: "0 12px 8px" }}>
            <div style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 6, padding: "6px 8px", display: "flex", alignItems: "center", gap: 6 }}>
              <AlertTriangle style={{ width: 11, height: 11, color: "var(--error)", flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: "var(--error)", flex: 1, wordBreak: "break-word" }}>{error}</span>
              <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--error)", padding: 2 }}>
                <X style={{ width: 10, height: 10 }} />
              </button>
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>
          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 30 }}>
              <Loader2 style={{ width: 16, height: 16, color: "var(--text-muted)", animation: "spin 1s linear infinite" }} />
            </div>
          ) : agents.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px 12px" }}>
              <Bot style={{ width: 28, height: 28, color: "var(--text-muted)", margin: "0 auto 8px", opacity: 0.3 }} />
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>No agents found</p>
              <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4, opacity: 0.6 }}>Click + New to create one</p>
            </div>
          ) : (
            agents.map(agent => {
              const active = selectedId === agent.id;
              const sessionCount = sessions.filter(s => s.agentId === agent.id).length;
              const mInfo = modelForAgent(agent);
              return (
                <button key={agent.id}
                  onClick={() => { setSelectedId(agent.id); setEditingIdentity(false); setConfirmDelete(null); setTestResult(null); }}
                  style={{
                    width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 8,
                    border: active ? "1px solid var(--accent)" : "1px solid transparent",
                    cursor: "pointer", marginBottom: 3,
                    background: active ? "var(--accent-bg)" : "transparent",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                      background: agent.isDefault ? "var(--accent-bg)" : "var(--bg-hover)",
                    }}>
                      <Bot style={{ width: 16, height: 16, color: agent.isDefault ? "var(--accent)" : "var(--text-muted)" }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {agent.id}
                        </span>
                        {agent.isDefault && <Star style={{ width: 10, height: 10, color: "var(--warning)", flexShrink: 0 }} />}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                        {mInfo && (mInfo.local
                          ? <HardDrive style={{ width: 9, height: 9, color: "#4ade80", flexShrink: 0 }} />
                          : <Cloud style={{ width: 9, height: 9, color: "#60a5fa", flexShrink: 0 }} />
                        )}
                        <span style={{ fontSize: 10, color: "var(--text-muted)", ...MONO, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {agent.model.split("/").pop()}
                        </span>
                        {sessionCount > 0 && (
                          <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: "var(--accent-bg)", color: "var(--accent)", flexShrink: 0 }}>
                            {sessionCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Quick dispatch at bottom of sidebar */}
        <div style={{ borderTop: "1px solid var(--border)", padding: "10px 12px", flexShrink: 0 }}>
          <div style={{ ...SECT, marginBottom: 6 }}>Quick Dispatch</div>
          <div style={{ display: "flex", gap: 4 }}>
            <select value={dispatchAgentId} onChange={e => setDispatchAgentId(e.target.value)}
              style={{ ...INPUT, fontSize: 10, padding: "5px 6px", width: 80, flexShrink: 0 }}>
              {agents.map(a => <option key={a.id} value={a.id}>{a.id}</option>)}
            </select>
            <input value={taskPrompt} onChange={e => setTaskPrompt(e.target.value)}
              onKeyDown={e => e.key === "Enter" && dispatchTask()}
              placeholder="Send a task..." style={{ ...INPUT, flex: 1, fontSize: 10, padding: "5px 8px" }} />
            <button onClick={dispatchTask} disabled={!taskPrompt.trim()} style={{ ...BTN_P, padding: "5px 8px" }}>
              <Send style={{ width: 10, height: 10 }} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Right: Detail Panel ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {selected ? (
          <>
            {/* Header */}
            <div style={{ padding: "14px 20px 0", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: "var(--accent-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Bot style={{ width: 22, height: 22, color: "var(--accent)" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <h3 style={{ margin: 0, color: "var(--text)", fontSize: 16, fontWeight: 600 }}>{selected.id}</h3>
                    {selected.isDefault && (
                      <span style={{ fontSize: 9, color: "var(--warning)", background: "rgba(251,191,36,0.12)", padding: "2px 6px", borderRadius: 4, fontWeight: 600 }}>DEFAULT</span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                    {modelForAgent(selected)?.local
                      ? <HardDrive style={{ width: 10, height: 10, color: "#4ade80" }} />
                      : <Cloud style={{ width: 10, height: 10, color: "#60a5fa" }} />
                    }
                    <span style={{ fontSize: 11, color: "var(--text-muted)", ...MONO }}>{selected.model}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => testAgent(selected.id)} disabled={testing !== null} style={BTN_G}>
                    {testing === selected.id ? <Loader2 style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} /> : <Play style={{ width: 11, height: 11 }} />}
                    Test
                  </button>
                  <button onClick={() => setEditingIdentity(!editingIdentity)} style={BTN_G}>
                    <Pencil style={{ width: 11, height: 11 }} /> Identity
                  </button>
                  {selected.id !== "main" && (
                    <button onClick={() => setConfirmDelete(confirmDelete === selected.id ? null : selected.id)}
                      style={{ ...BTN_G, borderColor: "rgba(248,113,113,0.3)", color: "var(--error)" }}>
                      <Trash2 style={{ width: 11, height: 11 }} /> Delete
                    </button>
                  )}
                </div>
              </div>

              {confirmDelete === selected.id && (
                <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, padding: "8px 12px", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, color: "var(--error)", display: "flex", alignItems: "center", gap: 6 }}>
                    <AlertTriangle style={{ width: 12, height: 12 }} /> Delete &ldquo;{selected.id}&rdquo;? Cannot be undone.
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => setConfirmDelete(null)} style={BTN_G}>Cancel</button>
                    <button onClick={() => deleteAgent(selected.id)} disabled={deleting}
                      style={{ ...BTN_P, background: "var(--error)", color: "#fff" }}>{deleting ? "..." : "Confirm"}</button>
                  </div>
                </div>
              )}

              {editingIdentity && (
                <div style={{ ...CARD, padding: 12, marginBottom: 10 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                    <div style={{ flex: 1 }}>
                      <label style={LABEL}>Display Name</label>
                      <input value={identityName} onChange={e => setIdentityName(e.target.value)} placeholder="e.g. Scout"
                        style={{ ...INPUT, width: "100%", marginTop: 4 }} />
                    </div>
                    <div style={{ width: 70 }}>
                      <label style={LABEL}>Emoji</label>
                      <input value={identityEmoji} onChange={e => setIdentityEmoji(e.target.value)} placeholder="🤖"
                        style={{ ...INPUT, width: "100%", marginTop: 4, textAlign: "center" }} />
                    </div>
                    <button onClick={() => saveIdentity(selected.id)} disabled={savingIdentity} style={BTN_P}>
                      {savingIdentity ? <Loader2 style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} /> : "Save"}
                    </button>
                  </div>
                </div>
              )}

              {testResult && (
                <div style={{ ...CARD, marginBottom: 10, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={SECT}>Test Result</span>
                    <button onClick={() => setTestResult(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}>
                      <X style={{ width: 10, height: 10 }} />
                    </button>
                  </div>
                  <pre style={{ margin: 0, padding: "8px 10px", borderRadius: 6, background: "var(--bg-surface)", border: "1px solid var(--border)", fontSize: 11, ...MONO, color: "var(--text-secondary)", whiteSpace: "pre-wrap", maxHeight: 120, overflowY: "auto" }}>
                    {testResult}
                  </pre>
                </div>
              )}

              {/* Tabs */}
              <div style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--border)" }}>
                {DETAIL_TABS.map(t => (
                  <button key={t.id} onClick={() => setDetailTab(t.id)}
                    style={{
                      padding: "8px 14px", borderRadius: "6px 6px 0 0", border: "none", cursor: "pointer",
                      background: detailTab === t.id ? "var(--bg-elevated)" : "transparent",
                      color: detailTab === t.id ? "var(--accent)" : "var(--text-muted)",
                      fontSize: 11, fontWeight: detailTab === t.id ? 600 : 500,
                      borderBottom: detailTab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
                    }}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab Content */}
            <div style={{ flex: 1, overflow: "auto", padding: "16px 20px 20px" }}>
              {detailTab === "overview" && <OverviewTab agent={selected} models={availableModels} onChangeModel={changeAgentModel} />}
              {detailTab === "sessions" && <SessionsTab sessions={agentSessions(selected.id)} loading={loadingSessions} onRefresh={() => loadSessions(selected.id)} />}
              {detailTab === "channels" && (
                <ChannelsTab bindings={agentBindings(selected.id)} channelStatus={channelStatus}
                  showBindForm={showBindForm} setShowBindForm={setShowBindForm} bindType={bindType} setBindType={setBindType}
                  bindValue={bindValue} setBindValue={setBindValue} binding={binding}
                  onBind={() => addBinding(selected.id)} onUnbind={(type, value) => removeBinding(selected.id, type, value)}
                  onGoToChannels={() => setView("channels")} />
              )}
              {detailTab === "tasks" && (
                <TasksTab tasks={tasks.filter(t => t.agentId === selected.id)} agents={agents}
                  taskPrompt={taskPrompt} setTaskPrompt={setTaskPrompt} dispatchAgentId={dispatchAgentId}
                  setDispatchAgentId={setDispatchAgentId} onDispatch={dispatchTask} />
              )}
              {detailTab === "compute" && <ComputeTab agent={selected} models={availableModels} onChangeModel={changeAgentModel} />}
            </div>
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12 }}>
            <Bot style={{ width: 40, height: 40, color: "var(--text-muted)", opacity: 0.2 }} />
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Select an agent to view details</p>
            <p style={{ fontSize: 11, color: "var(--text-muted)", maxWidth: 300, textAlign: "center", lineHeight: 1.5, opacity: 0.6 }}>
              Manage agents, assign models, dispatch tasks, and view compute infrastructure.
            </p>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Tab Components
   ═══════════════════════════════════════════ */

function OverviewTab({ agent, models, onChangeModel }: { agent: Agent; models: ModelInfo[]; onChangeModel: (agentId: string, model: string) => void }) {
  const currentModel = models.find(m => m.key === agent.model);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Model card with change button */}
      <div style={CARD}>
        <div style={{ ...ROW, padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {currentModel?.local
              ? <HardDrive style={{ width: 16, height: 16, color: "#4ade80" }} />
              : <Cloud style={{ width: 16, height: 16, color: "#60a5fa" }} />
            }
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{currentModel?.name || agent.model}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", ...MONO, marginTop: 1 }}>{agent.model}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {currentModel && (
              <span style={{
                fontSize: 9, padding: "2px 8px", borderRadius: 4, fontWeight: 600,
                background: currentModel.local ? "rgba(74,222,128,0.12)" : "rgba(96,165,250,0.12)",
                color: currentModel.local ? "#4ade80" : "#60a5fa",
              }}>
                {currentModel.local ? "LOCAL" : "CLOUD"}
              </span>
            )}
          </div>
        </div>
        {currentModel && (
          <div style={{ padding: "8px 14px 10px", display: "flex", gap: 16, fontSize: 10, color: "var(--text-secondary)" }}>
            <span>Context: <strong style={{ color: "var(--text)" }}>{(currentModel.contextWindow / 1000).toFixed(0)}K</strong></span>
            <span>Input: <strong style={{ color: "var(--text)" }}>{currentModel.input}</strong></span>
            {currentModel.tags.length > 0 && <span>Tags: {currentModel.tags.join(", ")}</span>}
          </div>
        )}
        <div style={{ padding: "6px 14px 10px" }}>
          <select onChange={e => { if (e.target.value) onChangeModel(agent.id, e.target.value); }}
            value="" style={{ ...INPUT, width: "100%", fontSize: 11 }}>
            <option value="">Change model...</option>
            {models.filter(m => m.available && m.key !== agent.model).map(m => (
              <option key={m.key} value={m.key}>
                {m.local ? "🖥️ LOCAL" : "☁️ CLOUD"} — {m.name} ({(m.contextWindow / 1000).toFixed(0)}K ctx)
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={CARD}>
        <div style={ROW}>
          <span style={LABEL}>Workspace</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)", ...MONO, wordBreak: "break-all" }}>{agent.workspace}</span>
        </div>
        <div style={ROW}>
          <span style={LABEL}>Agent Directory</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)", ...MONO, wordBreak: "break-all" }}>{agent.agentDir}</span>
        </div>
        <div style={{ ...ROW, borderBottom: "none" }}>
          <span style={LABEL}>Bindings</span>
          <span style={{ fontSize: 12, color: "var(--text)" }}>{agent.bindings}</span>
        </div>
      </div>

      {agent.routes.length > 0 && (
        <div>
          <div style={SECT}>Routes</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {agent.routes.map((route, i) => (
              <div key={i} style={{ padding: "6px 10px", borderRadius: 6, background: "var(--bg-elevated)", border: "1px solid var(--border)", fontSize: 11, color: "var(--text-secondary)", ...MONO }}>
                {route}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ComputeTab({ agent, models, onChangeModel }: { agent: Agent; models: ModelInfo[]; onChangeModel: (agentId: string, model: string) => void }) {
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [loadingNodes, setLoadingNodes] = useState(true);
  const [nodeOutput, setNodeOutput] = useState<string | null>(null);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [promptTarget, setPromptTarget] = useState<{ nodeId: string; action: "run" | "invoke" } | null>(null);
  const [promptInput, setPromptInput] = useState("");
  const [notifyMsg, setNotifyMsg] = useState("");
  const [showNotify, setShowNotify] = useState(false);

  const loadNodes = useCallback(async () => {
    setLoadingNodes(true);
    try {
      const data = await openclawClient.listNodes();
      setNodes(data);
    } catch { setNodes([]); }
    setLoadingNodes(false);
  }, []);

  useEffect(() => { loadNodes(); }, [loadNodes]);

  const executeNodeAction = async (nodeId: string, action: "run" | "invoke", input: string) => {
    setRunningAction(`${action}-${nodeId}`);
    setNodeOutput(null);
    try {
      const result = await openclawClient.nodeAction(nodeId, action, input);
      setNodeOutput(result.code === 0 ? result.stdout || "Done." : "Command failed.");
    } catch (e) {
      setNodeOutput(e instanceof Error ? e.message : "Action failed");
    }
    setRunningAction(null);
  };

  const notifyAll = async () => {
    if (!notifyMsg.trim()) return;
    setRunningAction("notify");
    try {
      const result = await openclawClient.notifyAllNodes(notifyMsg);
      setNodeOutput(result.code === 0 ? result.stdout || "Sent." : "Notify failed.");
    } catch (e) { setNodeOutput(e instanceof Error ? e.message : "Failed"); }
    setRunningAction(null);
    setShowNotify(false);
    setNotifyMsg("");
  };

  const handlePromptSubmit = () => {
    if (!promptTarget || !promptInput.trim()) return;
    executeNodeAction(promptTarget.nodeId, promptTarget.action, promptInput.trim());
    setPromptTarget(null);
    setPromptInput("");
  };

  const statusColor = (s?: string) => {
    if (!s) return "var(--text-muted)";
    const l = s.toLowerCase();
    if (l === "running" || l === "active" || l === "online") return "#4ade80";
    if (l === "stopped" || l === "offline") return "#f87171";
    return "#fbbf24";
  };

  const localModels = models.filter(m => m.local);
  const cloudModels = models.filter(m => !m.local);

  return (
    <div>
      {/* Model assignment for this agent */}
      <div style={{ marginBottom: 20 }}>
        <div style={SECT}>Model Assignment</div>
        <div style={CARD}>
          <div style={{ ...ROW, padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Cpu style={{ width: 14, height: 14, color: "var(--accent)" }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{agent.model}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  {models.find(m => m.key === agent.model)?.local ? "Running locally on your GPU" : "Cloud-hosted"}
                </div>
              </div>
            </div>
          </div>
          <div style={{ padding: "8px 14px 10px" }}>
            <select onChange={e => { if (e.target.value) onChangeModel(agent.id, e.target.value); }}
              value="" style={{ ...INPUT, width: "100%", fontSize: 11 }}>
              <option value="">Switch compute backend...</option>
              {models.filter(m => m.available && m.key !== agent.model).map(m => (
                <option key={m.key} value={m.key}>
                  {m.local ? "🖥️ LOCAL" : "☁️ CLOUD"} — {m.name} ({(m.contextWindow / 1000).toFixed(0)}K ctx)
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Available compute backends */}
      <div style={{ marginBottom: 20 }}>
        <div style={SECT}>Compute Backends ({models.length})</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {/* Local section */}
          <div style={CARD}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
              <HardDrive style={{ width: 13, height: 13, color: "#4ade80" }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>Local GPU ({localModels.length})</span>
            </div>
            {localModels.length === 0 ? (
              <div style={{ padding: "12px 14px", fontSize: 10, color: "var(--text-muted)" }}>No local models configured</div>
            ) : (
              localModels.map(m => (
                <div key={m.key} style={{ ...ROW, padding: "8px 14px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</div>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", ...MONO }}>{(m.contextWindow / 1000).toFixed(0)}K ctx</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: m.available ? "#4ade80" : "#f87171" }} />
                    {m.key === agent.model && <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 4, background: "var(--accent-bg)", color: "var(--accent)", fontWeight: 600 }}>ACTIVE</span>}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Cloud section */}
          <div style={CARD}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
              <Cloud style={{ width: 13, height: 13, color: "#60a5fa" }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>Cloud ({cloudModels.length})</span>
            </div>
            {cloudModels.length === 0 ? (
              <div style={{ padding: "12px 14px", fontSize: 10, color: "var(--text-muted)" }}>No cloud models configured</div>
            ) : (
              cloudModels.map(m => (
                <div key={m.key} style={{ ...ROW, padding: "8px 14px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</div>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", ...MONO }}>{(m.contextWindow / 1000).toFixed(0)}K ctx &middot; {m.input}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: m.available ? "#60a5fa" : "#f87171" }} />
                    {m.key === agent.model && <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 4, background: "var(--accent-bg)", color: "var(--accent)", fontWeight: 600 }}>ACTIVE</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Nodes */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={SECT}>Distributed Nodes ({nodes.length})</span>
          <div style={{ display: "flex", gap: 4 }}>
            {nodes.length > 0 && (
              <button onClick={() => setShowNotify(!showNotify)} style={BTN_G}>
                <Bell style={{ width: 10, height: 10 }} /> Notify
              </button>
            )}
            <button onClick={loadNodes} style={BTN_G}>
              <RefreshCw style={{ width: 10, height: 10 }} />
            </button>
          </div>
        </div>

        {showNotify && (
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <input value={notifyMsg} onChange={e => setNotifyMsg(e.target.value)} onKeyDown={e => e.key === "Enter" && notifyAll()}
              placeholder="Notification message..." autoFocus style={{ ...INPUT, flex: 1 }} />
            <button onClick={notifyAll} disabled={!notifyMsg.trim() || runningAction === "notify"} style={BTN_P}>
              {runningAction === "notify" ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : "Send"}
            </button>
            <button onClick={() => { setShowNotify(false); setNotifyMsg(""); }} style={BTN_G}>Cancel</button>
          </div>
        )}

        {promptTarget && (
          <div style={{ ...CARD, padding: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
              {promptTarget.action} &middot; {promptTarget.nodeId}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={promptInput} onChange={e => setPromptInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handlePromptSubmit()}
                placeholder="Input data..." autoFocus style={{ ...INPUT, flex: 1 }} />
              <button onClick={handlePromptSubmit} disabled={!promptInput.trim()} style={BTN_P}>
                {promptTarget.action === "run" ? "Run" : "Invoke"}
              </button>
              <button onClick={() => { setPromptTarget(null); setPromptInput(""); }} style={BTN_G}>Cancel</button>
            </div>
          </div>
        )}

        {loadingNodes ? (
          <div style={{ ...CARD, padding: "20px 14px", textAlign: "center" }}>
            <Loader2 style={{ width: 14, height: 14, color: "var(--text-muted)", animation: "spin 1s linear infinite", margin: "0 auto" }} />
          </div>
        ) : nodes.length === 0 ? (
          <div style={{ ...CARD, padding: "20px 14px", textAlign: "center" }}>
            <Network style={{ width: 24, height: 24, color: "var(--text-muted)", opacity: 0.3, margin: "0 auto 6px" }} />
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>No distributed nodes found</p>
            <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4, opacity: 0.6 }}>
              Nodes appear when you connect additional OpenClaw instances
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {nodes.map(node => (
              <div key={node.id} style={CARD}>
                <div style={{ ...ROW, borderBottom: "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Network style={{ width: 13, height: 13, color: "var(--accent)" }} />
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>{node.name || node.label || node.id}</span>
                        {node.type && <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>{node.type}</span>}
                        {node.status && <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: `${statusColor(node.status)}15`, color: statusColor(node.status) }}>{node.status}</span>}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", ...MONO, marginTop: 1 }}>{node.id}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => { setPromptTarget({ nodeId: node.id, action: "run" }); setPromptInput(""); }}
                      disabled={runningAction === `run-${node.id}`}
                      style={{ ...BTN_P, padding: "4px 8px", fontSize: 10 }}>
                      {runningAction === `run-${node.id}` ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : <Play style={{ width: 10, height: 10 }} />}
                      Run
                    </button>
                    <button onClick={() => { setPromptTarget({ nodeId: node.id, action: "invoke" }); setPromptInput(""); }}
                      disabled={runningAction === `invoke-${node.id}`}
                      style={{ ...BTN_G, padding: "4px 8px", fontSize: 10, borderColor: "rgba(168,85,247,0.3)", color: "#c084fc" }}>
                      {runningAction === `invoke-${node.id}` ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : <Zap style={{ width: 10, height: 10 }} />}
                      Invoke
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {nodeOutput && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={SECT}>Output</span>
              <button onClick={() => setNodeOutput(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 10, cursor: "pointer" }}>Dismiss</button>
            </div>
            <pre style={{ margin: 0, padding: "8px 10px", borderRadius: 6, background: "var(--bg-elevated)", border: "1px solid var(--border)", fontSize: 11, ...MONO, color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 150, overflowY: "auto" }}>
              {nodeOutput}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function SessionsTab({ sessions, loading, onRefresh }: { sessions: AgentSession[]; loading: boolean; onRefresh: () => void }) {
  const formatAge = (ms: number) => {
    if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
    return `${Math.round(ms / 3_600_000)}h ago`;
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={SECT}>Active Sessions ({sessions.length})</span>
        <button onClick={onRefresh} style={BTN_G}>
          {loading ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : <RefreshCw style={{ width: 10, height: 10 }} />}
          Refresh
        </button>
      </div>
      {sessions.length === 0 ? (
        <div style={{ ...CARD, padding: "20px 14px", textAlign: "center" }}>
          <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>No active sessions</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sessions.map(s => {
            const usage = s.contextTokens > 0 ? (s.totalTokens / s.contextTokens) * 100 : 0;
            const usageColor = usage > 80 ? "var(--error)" : usage > 50 ? "var(--warning)" : "var(--success)";
            return (
              <div key={s.key} style={CARD}>
                <div style={ROW}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Cpu style={{ width: 14, height: 14, color: "var(--accent)", flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{s.modelProvider}/{s.model}</div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>
                        <span style={{ textTransform: "capitalize" }}>{s.kind}</span> &middot; {formatAge(s.ageMs)}
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ padding: "8px 14px", display: "flex", gap: 16, fontSize: 10, color: "var(--text-secondary)" }}>
                  <span>In: <strong style={{ color: "var(--text)" }}>{s.inputTokens.toLocaleString()}</strong></span>
                  <span>Out: <strong style={{ color: "var(--text)" }}>{s.outputTokens.toLocaleString()}</strong></span>
                  <span>Total: <strong style={{ color: "var(--text)" }}>{s.totalTokens.toLocaleString()}</strong></span>
                </div>
                <div style={{ padding: "0 14px 10px" }}>
                  <div style={{ height: 4, borderRadius: 2, background: "var(--bg-hover)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.min(usage, 100)}%`, background: usageColor, borderRadius: 2, transition: "width 0.3s" }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 9, color: "var(--text-muted)" }}>
                    <span>{usage.toFixed(1)}% context used</span>
                    <span style={{ ...MONO }}>{s.contextTokens.toLocaleString()} ctx</span>
                  </div>
                </div>
                <div style={{ padding: "6px 14px 8px", borderTop: "1px solid var(--border)", fontSize: 9, color: "var(--text-muted)", ...MONO, wordBreak: "break-all" }}>
                  {s.key}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChannelsTab({ bindings, channelStatus, showBindForm, setShowBindForm, bindType, setBindType, bindValue, setBindValue, binding, onBind, onUnbind, onGoToChannels }: {
  bindings: Binding[];
  channelStatus: { channels: Record<string, { configured: boolean; running: boolean; lastError: string | null }>; channelMeta: { id: string; label: string }[]; channelAccounts: Record<string, { accountId: string; connected: boolean; bot?: { username: string }; lastInboundAt: number | null }[]>; } | null;
  showBindForm: boolean; setShowBindForm: (v: boolean) => void; bindType: "phone" | "channel"; setBindType: (v: "phone" | "channel") => void;
  bindValue: string; setBindValue: (v: string) => void; binding: boolean; onBind: () => void; onUnbind: (type: string, value: string) => void; onGoToChannels: () => void;
}) {
  const connectedChannels: { type: string; label: string; connected: boolean; botName?: string }[] = [];
  if (channelStatus) {
    for (const meta of channelStatus.channelMeta) {
      const ch = channelStatus.channels[meta.id];
      const accounts = channelStatus.channelAccounts[meta.id] || [];
      if (ch?.configured) {
        const connectedAccount = accounts.find((a: { connected: boolean }) => a.connected);
        connectedChannels.push({ type: meta.id, label: meta.label, connected: !!connectedAccount, botName: connectedAccount?.bot?.username });
      }
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={SECT}>Connected Channels</span>
          <button onClick={onGoToChannels} style={BTN_G}><Radio style={{ width: 10, height: 10 }} /> Manage Channels</button>
        </div>
        {connectedChannels.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {connectedChannels.map(ch => (
              <div key={ch.type} style={{ ...CARD, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: ch.connected ? "var(--success)" : "var(--text-muted)", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>{ch.label}</span>
                  {ch.botName && <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 8, ...MONO }}>@{ch.botName}</span>}
                </div>
                <span style={{ fontSize: 10, color: ch.connected ? "var(--success)" : "var(--text-muted)" }}>{ch.connected ? "Online" : "Offline"}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ ...CARD, padding: "16px 14px", textAlign: "center" }}>
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>No channels configured</p>
            <button onClick={onGoToChannels} style={{ ...BTN_P, margin: "8px auto 0" }}><Plus style={{ width: 10, height: 10 }} /> Connect a Channel</button>
          </div>
        )}
      </div>
      <div>
        <span style={SECT}>Agent Bindings</span>
        {bindings.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
            {bindings.map((b, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", borderRadius: 6, background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600, background: "var(--bg-hover)", padding: "2px 6px", borderRadius: 4 }}>{b.type}</span>
                  <span style={{ fontSize: 12, color: "var(--text)", ...MONO }}>{b.value}</span>
                </div>
                <button onClick={() => onUnbind(b.type, b.value)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}><Trash2 style={{ width: 11, height: 11 }} /></button>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 8px" }}>No bindings for this agent</p>
        )}
        {showBindForm ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <select value={bindType} onChange={e => setBindType(e.target.value as "phone" | "channel")} style={{ ...INPUT, fontSize: 11, padding: "5px 8px", width: 90 }}>
              <option value="channel">Channel</option><option value="phone">Phone</option>
            </select>
            <input value={bindValue} onChange={e => setBindValue(e.target.value)} onKeyDown={e => e.key === "Enter" && onBind()}
              placeholder={bindType === "phone" ? "+1234567890" : "discord"} style={{ ...INPUT, flex: 1, fontSize: 11 }} />
            <button onClick={onBind} disabled={binding} style={BTN_P}>{binding ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : "Bind"}</button>
            <button onClick={() => { setShowBindForm(false); setBindValue(""); }} style={{ ...BTN_G, padding: "5px 8px" }}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => setShowBindForm(true)} style={BTN_P}><Plus style={{ width: 10, height: 10 }} /> Add Binding</button>
        )}
      </div>
    </div>
  );
}

function TasksTab({ tasks, agents, taskPrompt, setTaskPrompt, dispatchAgentId, setDispatchAgentId, onDispatch }: {
  tasks: DispatchedTask[]; agents: Agent[]; taskPrompt: string; setTaskPrompt: (v: string) => void;
  dispatchAgentId: string; setDispatchAgentId: (v: string) => void; onDispatch: () => void;
}) {
  return (
    <div>
      <div style={{ ...CARD, padding: 14, marginBottom: 16 }}>
        <div style={{ ...SECT, marginBottom: 8 }}>Dispatch Task to Agent</div>
        <div style={{ display: "flex", gap: 8 }}>
          <select value={dispatchAgentId} onChange={e => setDispatchAgentId(e.target.value)} style={{ ...INPUT, width: 100, fontSize: 11 }}>
            {agents.map(a => <option key={a.id} value={a.id}>{a.id}</option>)}
          </select>
          <input value={taskPrompt} onChange={e => setTaskPrompt(e.target.value)} onKeyDown={e => e.key === "Enter" && onDispatch()}
            placeholder="Describe a task..." style={{ ...INPUT, flex: 1 }} />
          <button onClick={onDispatch} disabled={!taskPrompt.trim()}
            style={{ ...BTN_P, padding: "8px 16px", background: taskPrompt.trim() ? "var(--accent)" : "var(--bg-surface)", color: taskPrompt.trim() ? "#fff" : "var(--text-muted)" }}>
            <Send style={{ width: 12, height: 12 }} /> Dispatch
          </button>
        </div>
      </div>
      <div style={SECT}>Task History ({tasks.length})</div>
      {tasks.length === 0 ? (
        <div style={{ ...CARD, padding: "20px 14px", textAlign: "center" }}>
          <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>No tasks dispatched yet</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {tasks.map(task => <TaskItem key={task.id} task={task} />)}
        </div>
      )}
    </div>
  );
}

function TaskItem({ task }: { task: DispatchedTask }) {
  const [expanded, setExpanded] = useState(false);
  const statusIcon = task.status === "running"
    ? <Loader2 style={{ width: 13, height: 13, color: "var(--accent)", animation: "spin 1s linear infinite" }} />
    : task.status === "completed"
    ? <CheckCircle2 style={{ width: 13, height: 13, color: "var(--success)" }} />
    : <AlertCircle style={{ width: 13, height: 13, color: "var(--error)" }} />;
  const elapsed = task.completedAt ? ((task.completedAt - task.startedAt) / 1000).toFixed(1) : null;

  return (
    <div style={{ ...CARD }}>
      <div style={{ ...ROW, cursor: task.result ? "pointer" : "default" }} onClick={() => task.result && setExpanded(!expanded)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
          {statusIcon}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.prompt}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
              <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "var(--accent-bg)", color: "var(--accent)", fontWeight: 500 }}>{task.agentId}</span>
              {elapsed && <span style={{ fontSize: 9, color: "var(--text-muted)", ...MONO }}>{elapsed}s</span>}
            </div>
          </div>
        </div>
        {task.result && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(task.result || ""); }}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}><Copy style={{ width: 11, height: 11 }} /></button>
            {expanded ? <ChevronUp style={{ width: 12, height: 12, color: "var(--text-muted)" }} /> : <ChevronDown style={{ width: 12, height: 12, color: "var(--text-muted)" }} />}
          </div>
        )}
      </div>
      {expanded && task.result && (
        <div style={{ padding: "0 14px 12px" }}>
          <pre style={{ margin: 0, padding: "8px 10px", borderRadius: 6, background: "var(--bg-surface)", border: "1px solid var(--border)", fontSize: 11, ...MONO, color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 300, overflowY: "auto" }}>
            {task.result}
          </pre>
        </div>
      )}
    </div>
  );
}
