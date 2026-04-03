import { useState, useEffect, useRef, useCallback, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useFactoryStore, type AgentType, type AgentRun, type FactoryProject } from "@/stores/factoryStore";
import { factoryService } from "@/lib/factory";
import { openclawClient } from "@/lib/openclaw";
import { RunWorkspace } from "@/components/factory/RunWorkspace";
import {
  Loader2, RefreshCw, Play, Zap, GitBranch, Bot, Terminal,
  Square, Send, FileText, Eye, ChevronRight, ChevronDown,
  Cpu, FolderOpen, Navigation as NavIcon,
} from "lucide-react";

const MONO: CSSProperties = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" };
const CARD: CSSProperties = { background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" };
const BTN: CSSProperties = { padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 500, border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, transition: "all .15s ease" };
const BTN_PRIMARY: CSSProperties = { ...BTN, background: "var(--accent-bg)", color: "var(--accent)" };
const BTN_GHOST: CSSProperties = { ...BTN, background: "transparent", color: "var(--text-muted)" };
const BTN_DANGER: CSSProperties = { ...BTN, background: "rgba(239,68,68,0.1)", color: "#ef4444" };
const INPUT: CSSProperties = { background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 12px", color: "var(--text)", fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box", ...MONO };
const LABEL: CSSProperties = { fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 };

const STATUS_COLORS: Record<string, string> = {
  queued: "var(--text-muted)", running: "var(--accent)", completed: "var(--success)", failed: "var(--error)", cancelled: "var(--text-muted)",
};

interface LiveBuilder {
  id: string;
  label?: string;
  status?: string;
  task?: string;
  model?: string;
  thinking?: string;
  runtime?: string;
  cwd?: string;
  source: "subagent" | "acp";
  startedAt?: number;
}

type TabId = "builds" | "projects";

function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function statusColor(s?: string): string {
  if (!s) return "var(--text-muted)";
  const l = s.toLowerCase();
  if (l === "running" || l === "active") return "#4ade80";
  if (l === "completed" || l === "done") return "var(--accent)";
  if (l === "error" || l === "failed") return "#f87171";
  if (l === "killed" || l === "stopped" || l === "cancelled") return "#fbbf24";
  return "var(--text-muted)";
}

function IconPlus() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
}
function IconStop() {
  return <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>;
}
function IconTrash() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>;
}
function IconFolder() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>;
}
function IconChevron({ open }: { open: boolean }) {
  return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ transition: "transform .15s", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}><polyline points="9 18 15 12 9 6" /></svg>;
}

export function FactoryView() {
  const [tab, setTab] = useState<TabId>("builds");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <style>{`@keyframes _spin { to { transform: rotate(360deg) } } @keyframes _pulse { 0%,100% { opacity:1 } 50% { opacity:.4 } }`}</style>

      <div style={{ padding: "18px 24px 0", flexShrink: 0 }}>
        <h2 style={{ color: "var(--text)", fontSize: 16, fontWeight: 700, margin: 0 }}>The Forge</h2>
        <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "2px 0 12px" }}>
          Claude Code builds, sub-agents, and autonomous software development
        </p>
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)" }}>
          {([
            { id: "builds" as TabId, label: "Builds", icon: <Cpu style={{ width: 11, height: 11 }} /> },
            { id: "projects" as TabId, label: "Projects", icon: <FolderOpen style={{ width: 11, height: 11 }} /> },
          ]).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "8px 20px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer",
              background: "transparent", color: tab === t.id ? "var(--accent)" : "var(--text-muted)",
              borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
              transition: "all 0.15s", display: "flex", alignItems: "center", gap: 6,
            }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "builds" ? <BuildsTab /> : <ProjectsTab />}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   BUILDS TAB — Live Claude Code sub-agent builds
   ══════════════════════════════════════════════════════════════════════ */

function BuildsTab() {
  const [builders, setBuilders] = useState<LiveBuilder[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [output, setOutput] = useState<{ title: string; content: string } | null>(null);
  const [spawnOpen, setSpawnOpen] = useState(false);

  const [task, setTask] = useState("");
  const [cwd, setCwd] = useState("");
  const [runtime, setRuntime] = useState<string>("claude-code");
  const [model, setModel] = useState("");
  const [thinking, setThinking] = useState("default");
  const [spawning, setSpawning] = useState(false);

  const [steerInputs, setSteerInputs] = useState<Record<string, string>>({});
  const [sendInputs, setSendInputs] = useState<Record<string, string>>({});
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());

  const { projects } = useFactoryStore();

  const sendAgentMessage = useCallback(async (message: string): Promise<{ stdout: string; code: number }> => {
    const result = await openclawClient.dispatchToAgent("main", message);
    return { stdout: result.stdout || result.stderr, code: result.code };
  }, []);

  const loadBuilders = useCallback(async () => {
    const items: LiveBuilder[] = [];

    const [subResult, acpResult] = await Promise.allSettled([
      sendAgentMessage("/subagents list"),
      sendAgentMessage("/acp status"),
    ]);

    if (subResult.status === "fulfilled" && subResult.value.code === 0 && subResult.value.stdout.trim()) {
      try {
        const data = JSON.parse(subResult.value.stdout);
        const list = Array.isArray(data) ? data : (data.subagents ?? data.agents ?? data.items ?? data.result ?? []);
        if (Array.isArray(list)) {
          items.push(...list.map((s: LiveBuilder) => ({ ...s, source: "subagent" as const })));
        }
      } catch { /* text output, not JSON */ }
    }

    if (acpResult.status === "fulfilled" && acpResult.value.code === 0 && acpResult.value.stdout.trim()) {
      try {
        const parsed = JSON.parse(acpResult.value.stdout);
        const raw = parsed.sessions ?? parsed.agents ?? parsed.active ?? [];
        (Array.isArray(raw) ? raw : []).forEach((s: Record<string, unknown>) => {
          items.push({
            id: String(s.id ?? s.sessionId ?? ""),
            runtime: String(s.runtime ?? s.type ?? ""),
            status: String(s.status ?? s.state ?? "unknown"),
            task: String(s.task ?? s.message ?? s.prompt ?? ""),
            model: s.model ? String(s.model) : undefined,
            cwd: s.cwd ? String(s.cwd) : undefined,
            source: "acp" as const,
          });
        });
      } catch { /* ignore */ }
    }

    setBuilders(items);
    setLoading(false);
  }, [sendAgentMessage]);

  useEffect(() => { loadBuilders(); }, [loadBuilders]);
  useEffect(() => {
    if (feedback) { const t = setTimeout(() => setFeedback(null), 4000); return () => clearTimeout(t); }
  }, [feedback]);

  const builderAction = async (label: string, message: string) => {
    setActionLoading(label);
    try {
      const result = await sendAgentMessage(message);
      if (result.code === 0) {
        setFeedback({ type: "success", msg: `${label}: Done` });
        if (result.stdout.trim()) setOutput({ title: label, content: result.stdout });
        if (label.startsWith("Kill") || label.startsWith("Cancel") || label.startsWith("Close")) await loadBuilders();
      } else {
        setFeedback({ type: "error", msg: result.stdout || `${label} failed` });
      }
    } catch (e) {
      setFeedback({ type: "error", msg: e instanceof Error ? e.message : `${label} failed` });
    }
    setActionLoading(null);
  };

  const isActionLoading = (key: string) => actionLoading === key;

  const spawnBuild = async () => {
    if (!task.trim()) return;
    setSpawning(true);
    try {
      let cmd = `/acp spawn --runtime ${runtime}`;
      if (model.trim()) cmd += ` --model ${model.trim()}`;
      if (cwd.trim()) cmd += ` --cwd ${cwd.trim()}`;
      if (thinking !== "default") cmd += ` --thinking ${thinking}`;
      cmd += ` ${task.trim()}`;
      const result = await sendAgentMessage(cmd);
      if (result.code === 0) {
        setFeedback({ type: "success", msg: "Build spawned via Claude Code" });
        setTask(""); setCwd(""); setModel(""); setThinking("default");
        setSpawnOpen(false);
        await loadBuilders();
      } else {
        setFeedback({ type: "error", msg: result.stdout || "Spawn failed" });
      }
    } catch (e) {
      setFeedback({ type: "error", msg: e instanceof Error ? e.message : "Spawn failed" });
    }
    setSpawning(false);
  };

  const toggleLog = (id: string) => {
    setExpandedLogs(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const activeBuilders = builders.filter(b => ["running", "active"].includes(b.status?.toLowerCase() ?? ""));
  const inactiveBuilders = builders.filter(b => !["running", "active"].includes(b.status?.toLowerCase() ?? ""));

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px 24px 24px" }}>
      {/* Feedback */}
      {feedback && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, marginBottom: 12,
          background: feedback.type === "success" ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)",
          border: `1px solid ${feedback.type === "success" ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: feedback.type === "success" ? "#4ade80" : "#f87171" }} />
          <span style={{ fontSize: 11, color: feedback.type === "success" ? "#4ade80" : "#f87171", flex: 1 }}>{feedback.msg}</span>
          <button onClick={() => setFeedback(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>×</button>
        </div>
      )}

      {/* Spawn Build Card */}
      <div style={{ marginBottom: 20 }}>
        <button onClick={() => setSpawnOpen(!spawnOpen)} style={{
          display: "flex", alignItems: "center", gap: 10, width: "100%",
          padding: "14px 18px", borderRadius: spawnOpen ? "10px 10px 0 0" : 10,
          background: "linear-gradient(135deg, rgba(212,165,116,0.08), rgba(139,92,246,0.08))",
          border: "1px solid rgba(212,165,116,0.2)", cursor: "pointer", color: "var(--text)",
          transition: "all 0.15s",
        }}>
          {spawnOpen ? <ChevronDown style={{ width: 14, height: 14, color: "#d4a574" }} /> : <ChevronRight style={{ width: 14, height: 14, color: "#d4a574" }} />}
          <div style={{ width: 28, height: 28, borderRadius: 7, background: "rgba(212,165,116,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#d4a574" }}>C</div>
          <div style={{ flex: 1, textAlign: "left" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>New Build</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>Spawn a Claude Code sub-agent to build software autonomously</div>
          </div>
          <Play style={{ width: 16, height: 16, color: "#d4a574" }} />
        </button>

        {spawnOpen && (
          <div style={{ ...CARD, borderRadius: "0 0 10px 10px", borderTop: "none" }}>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <span style={LABEL}>What should Claude Code build? *</span>
                <textarea value={task} onChange={e => setTask(e.target.value)}
                  placeholder="Build a REST API with Express and TypeScript that has user auth, CRUD endpoints for posts, and PostgreSQL integration..."
                  rows={4} style={{ ...INPUT, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
                  onKeyDown={e => { if (e.key === "Enter" && e.ctrlKey && task.trim()) spawnBuild(); }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <span style={LABEL}>Working Directory</span>
                  {projects.length > 0 ? (
                    <select value={cwd} onChange={e => setCwd(e.target.value)}
                      style={{ ...INPUT, fontFamily: "inherit" }}>
                      <option value="">Default (agent home)</option>
                      {projects.map(p => (
                        <option key={p.id} value={p.path}>{p.name} — {p.path}</option>
                      ))}
                      <option value="__custom__">Custom path...</option>
                    </select>
                  ) : (
                    <input value={cwd} onChange={e => setCwd(e.target.value)}
                      placeholder="C:\Users\...\Projects\my-app" style={INPUT} />
                  )}
                  {cwd === "__custom__" && (
                    <input value="" onChange={e => setCwd(e.target.value)}
                      placeholder="Enter custom path..." style={{ ...INPUT, marginTop: 6 }} autoFocus />
                  )}
                </div>
                <div>
                  <span style={LABEL}>Runtime</span>
                  <select value={runtime} onChange={e => setRuntime(e.target.value)} style={{ ...INPUT, fontFamily: "inherit" }}>
                    <option value="claude-code">Claude Code</option>
                    <option value="codex">Codex</option>
                    <option value="gemini-cli">Gemini CLI</option>
                  </select>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <span style={LABEL}>Model Override</span>
                  <input value={model} onChange={e => setModel(e.target.value)}
                    placeholder="Default (claude-sonnet-4)" style={INPUT} />
                </div>
                <div>
                  <span style={LABEL}>Thinking Level</span>
                  <select value={thinking} onChange={e => setThinking(e.target.value)} style={{ ...INPUT, fontFamily: "inherit" }}>
                    {["default", "minimal", "low", "medium", "high"].map(l => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Ctrl+Enter to launch</span>
                <button onClick={spawnBuild} disabled={spawning || !task.trim()}
                  style={{
                    ...BTN, padding: "10px 24px", fontWeight: 600, fontSize: 12,
                    background: task.trim() ? "#d4a574" : "var(--bg-hover)",
                    color: task.trim() ? "#fff" : "var(--text-muted)",
                    opacity: !task.trim() || spawning ? 0.5 : 1,
                  }}>
                  {spawning ? <Loader2 style={{ width: 14, height: 14, animation: "_spin 1s linear infinite" }} /> : <Play style={{ width: 14, height: 14 }} />}
                  {spawning ? "Spawning..." : "Launch Build"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Stats Bar */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        {[
          { label: "Active Builds", value: activeBuilders.length, color: "#4ade80", icon: <Cpu style={{ width: 12, height: 12 }} /> },
          { label: "Total Agents", value: builders.length, color: "var(--accent)", icon: <Bot style={{ width: 12, height: 12 }} /> },
          { label: "Sub-Agents", value: builders.filter(b => b.source === "subagent").length, color: "#60a5fa", icon: <GitBranch style={{ width: 12, height: 12 }} /> },
          { label: "ACP Sessions", value: builders.filter(b => b.source === "acp").length, color: "#c084fc", icon: <Terminal style={{ width: 12, height: 12 }} /> },
        ].map(s => (
          <div key={s.label} style={{
            ...CARD, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flex: "1 1 140px",
          }}>
            <div style={{ color: s.color }}>{s.icon}</div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.color, ...MONO }}>{s.value}</div>
              <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 500 }}>{s.label}</div>
            </div>
          </div>
        ))}
        <button onClick={() => loadBuilders()} disabled={loading} style={{ ...BTN_GHOST, alignSelf: "center" }}>
          <RefreshCw style={{ width: 12, height: 12, ...(loading ? { animation: "_spin 1s linear infinite" } : {}) }} /> Refresh
        </button>
      </div>

      {/* Active Builds */}
      {loading && builders.length === 0 ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
          <Loader2 style={{ width: 20, height: 20, color: "var(--accent)", animation: "_spin 1s linear infinite" }} />
        </div>
      ) : builders.length === 0 ? (
        <div style={{ ...CARD, padding: "40px 20px", textAlign: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: "rgba(212,165,116,0.1)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
            <Bot style={{ width: 24, height: 24, color: "#d4a574", opacity: 0.5 }} />
          </div>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 4px" }}>No active builds</p>
          <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
            Use "New Build" above to spawn a Claude Code agent, or dispatch a task via Telegram
          </p>
        </div>
      ) : (
        <>
          {activeBuilders.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: "#4ade80", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#4ade80", animation: "_pulse 1.5s ease-in-out infinite" }} />
                Active Builds ({activeBuilders.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {activeBuilders.map(b => (
                  <BuilderCard key={`${b.source}-${b.id}`} builder={b}
                    steerInput={steerInputs[b.id] ?? ""} sendInput={sendInputs[b.id] ?? ""}
                    onSteerChange={v => setSteerInputs(p => ({ ...p, [b.id]: v }))}
                    onSendChange={v => setSendInputs(p => ({ ...p, [b.id]: v }))}
                    onAction={builderAction} isActionLoading={isActionLoading}
                    logExpanded={expandedLogs.has(b.id)} onToggleLog={() => toggleLog(b.id)}
                    projects={projects} />
                ))}
              </div>
            </div>
          )}

          {inactiveBuilders.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-muted)", marginBottom: 8 }}>
                Recent ({inactiveBuilders.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {inactiveBuilders.map(b => (
                  <BuilderCard key={`${b.source}-${b.id}`} builder={b}
                    steerInput={steerInputs[b.id] ?? ""} sendInput={sendInputs[b.id] ?? ""}
                    onSteerChange={v => setSteerInputs(p => ({ ...p, [b.id]: v }))}
                    onSendChange={v => setSendInputs(p => ({ ...p, [b.id]: v }))}
                    onAction={builderAction} isActionLoading={isActionLoading}
                    logExpanded={expandedLogs.has(b.id)} onToggleLog={() => toggleLog(b.id)}
                    projects={projects} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Output Panel */}
      {output && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)" }}>{output.title}</span>
            <button onClick={() => setOutput(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 10, cursor: "pointer" }}>Dismiss</button>
          </div>
          <pre style={{
            margin: 0, padding: "10px 14px", borderRadius: 10,
            background: "var(--bg-elevated)", border: "1px solid var(--border)",
            fontSize: 11, ...MONO, color: "var(--text-secondary)",
            whiteSpace: "pre-wrap", wordBreak: "break-word",
            maxHeight: 300, overflowY: "auto",
          }}>
            {output.content}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ── Builder Card ── */

function BuilderCard({ builder, steerInput, sendInput, onSteerChange, onSendChange, onAction, isActionLoading, logExpanded, onToggleLog, projects }: {
  builder: LiveBuilder;
  steerInput: string; sendInput: string;
  onSteerChange: (v: string) => void; onSendChange: (v: string) => void;
  onAction: (label: string, cmd: string) => void;
  isActionLoading: (key: string) => boolean;
  logExpanded: boolean; onToggleLog: () => void;
  projects: FactoryProject[];
}) {
  const isActive = ["running", "active"].includes(builder.status?.toLowerCase() ?? "");
  const runtimeLabel = builder.runtime ?? (builder.source === "acp" ? "ACP" : "Sub-Agent");
  const isClaudeCode = runtimeLabel.toLowerCase().includes("claude");
  const matchedProject = builder.cwd ? projects.find(p => builder.cwd?.startsWith(p.path)) : undefined;

  return (
    <div style={{
      ...CARD,
      borderColor: isActive ? `${statusColor(builder.status)}40` : "var(--border)",
      borderLeft: `3px solid ${statusColor(builder.status)}`,
    }}>
      {/* Header */}
      <div style={{ padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 9, flexShrink: 0,
          background: isClaudeCode ? "rgba(212,165,116,0.12)" : "rgba(139,92,246,0.12)",
          border: `1px solid ${isClaudeCode ? "rgba(212,165,116,0.25)" : "rgba(139,92,246,0.25)"}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 700, color: isClaudeCode ? "#d4a574" : "#a78bfa",
        }}>
          {isClaudeCode ? "C" : builder.source === "acp" ? <Terminal style={{ width: 16, height: 16 }} /> : <Bot style={{ width: 16, height: 16 }} />}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", ...MONO }}>{builder.id}</span>
            <span style={{
              fontSize: 8, padding: "2px 6px", borderRadius: 4, fontWeight: 600, textTransform: "uppercase",
              background: isClaudeCode ? "rgba(212,165,116,0.12)" : builder.source === "acp" ? "rgba(168,85,247,0.12)" : "rgba(59,130,246,0.12)",
              color: isClaudeCode ? "#d4a574" : builder.source === "acp" ? "#c084fc" : "var(--accent)",
            }}>
              {runtimeLabel}
            </span>
            {builder.label && <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{builder.label}</span>}
            <span style={{
              fontSize: 8, padding: "2px 6px", borderRadius: 4, fontWeight: 600,
              background: `${statusColor(builder.status)}15`, color: statusColor(builder.status),
              textTransform: "uppercase",
            }}>
              {isActive && <span style={{ width: 4, height: 4, borderRadius: "50%", background: statusColor(builder.status), display: "inline-block", marginRight: 3, animation: "_pulse 1.5s ease-in-out infinite" }} />}
              {builder.status}
            </span>
          </div>

          {builder.task && (
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
              {builder.task}
            </p>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            {builder.model && (
              <span style={{ fontSize: 9, color: "var(--text-muted)", ...MONO, display: "flex", alignItems: "center", gap: 3 }}>
                <Cpu style={{ width: 9, height: 9 }} /> {builder.model}
              </span>
            )}
            {builder.cwd && (
              <span style={{ fontSize: 9, color: "var(--text-muted)", ...MONO, display: "flex", alignItems: "center", gap: 3 }}>
                <FolderOpen style={{ width: 9, height: 9 }} /> {matchedProject ? matchedProject.name : builder.cwd}
              </span>
            )}
            {builder.thinking && (
              <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 4, background: "var(--bg-hover)", color: "var(--text-muted)" }}>
                thinking: {builder.thinking}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <button onClick={onToggleLog}
            style={{ ...BTN_GHOST, padding: "4px 8px", fontSize: 10 }} title="View log">
            <Eye style={{ width: 10, height: 10 }} />
          </button>
          {builder.source === "subagent" && (
            <>
              <button onClick={() => onAction(`Info-${builder.id}`, `/subagents info ${builder.id}`)}
                disabled={isActionLoading(`Info-${builder.id}`)}
                style={{ ...BTN_GHOST, padding: "4px 8px", fontSize: 10 }} title="Info">
                {isActionLoading(`Info-${builder.id}`) ? <Loader2 style={{ width: 10, height: 10, animation: "_spin 1s linear infinite" }} /> : <FileText style={{ width: 10, height: 10 }} />}
              </button>
              <button onClick={() => onAction(`Kill-${builder.id}`, `/subagents kill ${builder.id}`)}
                disabled={isActionLoading(`Kill-${builder.id}`)}
                style={{ ...BTN_DANGER, padding: "4px 8px", fontSize: 10 }} title="Kill">
                {isActionLoading(`Kill-${builder.id}`) ? <Loader2 style={{ width: 10, height: 10, animation: "_spin 1s linear infinite" }} /> : <Square style={{ width: 10, height: 10 }} />}
              </button>
            </>
          )}
          {builder.source === "acp" && (
            <>
              <button onClick={() => onAction(`Doctor-${builder.id}`, `/acp doctor ${builder.id}`)}
                disabled={isActionLoading(`Doctor-${builder.id}`)}
                style={{ ...BTN_GHOST, padding: "4px 8px", fontSize: 10, color: "#c084fc" }} title="Doctor">
                {isActionLoading(`Doctor-${builder.id}`) ? <Loader2 style={{ width: 10, height: 10, animation: "_spin 1s linear infinite" }} /> : <FileText style={{ width: 10, height: 10 }} />}
              </button>
              <button onClick={() => onAction(`Cancel-${builder.id}`, `/acp cancel ${builder.id}`)}
                disabled={isActionLoading(`Cancel-${builder.id}`)}
                style={{ ...BTN_DANGER, padding: "4px 8px", fontSize: 10 }} title="Cancel">
                {isActionLoading(`Cancel-${builder.id}`) ? <Loader2 style={{ width: 10, height: 10, animation: "_spin 1s linear infinite" }} /> : <Square style={{ width: 10, height: 10 }} />}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Log panel (expanded) */}
      {logExpanded && (
        <LogPanel builderId={builder.id} source={builder.source} onAction={onAction} isActionLoading={isActionLoading} />
      )}

      {/* Steer + Send row */}
      {isActive && (
        <div style={{ padding: "8px 14px 10px", borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
          <div style={{ flex: 1, display: "flex", gap: 4 }}>
            <input type="text" placeholder="Steer agent direction..."
              value={steerInput}
              onChange={e => onSteerChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && steerInput.trim()) {
                  const cmd = builder.source === "acp" ? `/acp steer ${builder.id} ${steerInput}` : `/subagents steer ${builder.id} ${steerInput}`;
                  onAction(`Steer-${builder.id}`, cmd);
                  onSteerChange("");
                }
              }}
              style={{ ...INPUT, flex: 1, fontSize: 10, padding: "5px 8px" }} />
            <button onClick={() => {
              if (steerInput.trim()) {
                const cmd = builder.source === "acp" ? `/acp steer ${builder.id} ${steerInput}` : `/subagents steer ${builder.id} ${steerInput}`;
                onAction(`Steer-${builder.id}`, cmd);
                onSteerChange("");
              }
            }} disabled={!steerInput.trim() || isActionLoading(`Steer-${builder.id}`)}
              style={{ ...BTN_GHOST, padding: "4px 8px", fontSize: 10, borderColor: "rgba(251,191,36,0.3)", color: "#fbbf24" }} title="Steer">
              {isActionLoading(`Steer-${builder.id}`) ? <Loader2 style={{ width: 9, height: 9, animation: "_spin 1s linear infinite" }} /> : <NavIcon style={{ width: 9, height: 9 }} />}
            </button>
          </div>
          {builder.source === "subagent" && (
            <div style={{ flex: 1, display: "flex", gap: 4 }}>
              <input type="text" placeholder="Send message..."
                value={sendInput}
                onChange={e => onSendChange(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && sendInput.trim()) {
                    onAction(`Send-${builder.id}`, `/subagents send ${builder.id} ${sendInput}`);
                    onSendChange("");
                  }
                }}
                style={{ ...INPUT, flex: 1, fontSize: 10, padding: "5px 8px" }} />
              <button onClick={() => {
                if (sendInput.trim()) {
                  onAction(`Send-${builder.id}`, `/subagents send ${builder.id} ${sendInput}`);
                  onSendChange("");
                }
              }} disabled={!sendInput.trim() || isActionLoading(`Send-${builder.id}`)}
                style={{ ...BTN_PRIMARY, padding: "4px 8px", fontSize: 10 }} title="Send">
                {isActionLoading(`Send-${builder.id}`) ? <Loader2 style={{ width: 9, height: 9, animation: "_spin 1s linear infinite" }} /> : <Send style={{ width: 9, height: 9 }} />}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Log Panel (fetches and displays builder log) ── */

function LogPanel({ builderId, source }: {
  builderId: string; source: "subagent" | "acp";
  onAction?: (label: string, cmd: string) => void;
  isActionLoading?: (key: string) => boolean;
}) {
  const [log, setLog] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const logRef = useRef<HTMLPreElement>(null);

  const fetchLog = useCallback(async () => {
    setLoading(true);
    try {
      const cmd = source === "subagent" ? `/subagents log ${builderId}` : `/acp log ${builderId}`;
      const result = await openclawClient.dispatchToAgent("main", cmd);
      setLog(result.stdout || result.stderr || "(no output)");
    } catch {
      setLog("(failed to fetch log)");
    }
    setLoading(false);
  }, [builderId, source]);

  useEffect(() => { fetchLog(); }, [fetchLog]);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  return (
    <div style={{ borderTop: "1px solid var(--border)" }}>
      <div style={{ padding: "4px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-base)" }}>
        <span style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)" }}>Build Output</span>
        <button onClick={fetchLog} disabled={loading} style={{ ...BTN_GHOST, padding: "2px 6px", fontSize: 9 }}>
          <RefreshCw style={{ width: 9, height: 9, ...(loading ? { animation: "_spin 1s linear infinite" } : {}) }} /> Refresh
        </button>
      </div>
      {loading && !log ? (
        <div style={{ padding: "20px 14px", display: "flex", justifyContent: "center" }}>
          <Loader2 style={{ width: 14, height: 14, color: "var(--accent)", animation: "_spin 1s linear infinite" }} />
        </div>
      ) : (
        <pre ref={logRef} style={{
          margin: 0, padding: "8px 14px", fontSize: 10, lineHeight: 1.6, ...MONO,
          color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word",
          maxHeight: 250, overflowY: "auto", background: "var(--bg-base)",
        }}>
          {log}
        </pre>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   PROJECTS TAB
   ══════════════════════════════════════════════════════════════════════ */

function ProjectsTab() {
  const {
    projects, runs, selectedProjectId,
    addProject, removeProject, selectProject, updateProject,
    addRun, updateRun, removeRun, clearCompletedRuns,
  } = useFactoryStore();

  const [showNewProject, setShowNewProject] = useState(false);
  const [focusedRunId, setFocusedRunId] = useState<string | null>(null);
  const selectedProject = projects.find(p => p.id === selectedProjectId) ?? null;
  const projectRuns = runs.filter(r => r.projectId === selectedProjectId);
  const focusedRun = focusedRunId ? runs.find(r => r.id === focusedRunId) ?? null : null;
  const focusedProject = focusedRun ? projects.find(p => p.id === focusedRun.projectId) ?? null : null;

  const activeRunCount = (pid: string) => runs.filter(r => r.projectId === pid && r.status === "running").length;

  const handleStartRun = useCallback(async (agentType: AgentType, objective: string) => {
    if (!selectedProject) return;
    const runId = addRun({ projectId: selectedProject.id, agentType, objective });
    updateRun(runId, { status: "running", startedAt: Date.now() });
    updateProject(selectedProject.id, {});
    setFocusedRunId(runId);
    try {
      const handle = await factoryService.startRun(runId, agentType, objective, selectedProject.path);
      updateRun(runId, { pid: handle.pid, logFile: handle.logFile });
      factoryService.startPolling(runId, handle.logFile, (output, finished, exitCode) => {
        if (finished) {
          updateRun(runId, { output, status: exitCode === 0 ? "completed" : "failed", completedAt: Date.now(), error: exitCode !== 0 ? `Exited with code ${exitCode}` : undefined });
        } else {
          updateRun(runId, { output });
        }
      }, handle.pid);
    } catch (err) {
      updateRun(runId, { status: "failed", error: err instanceof Error ? err.message : String(err), completedAt: Date.now() });
    }
  }, [selectedProject, addRun, updateRun, updateProject]);

  const handleCancelRun = useCallback(async (run: AgentRun) => {
    if (run.pid) await factoryService.cancelRun(run.pid);
    factoryService.stopPolling(run.id);
    updateRun(run.id, { status: "cancelled", completedAt: Date.now() });
  }, [updateRun]);

  useEffect(() => {
    for (const run of runs) {
      if (run.status === "running" && run.logFile) {
        factoryService.startPolling(run.id, run.logFile, (output, finished, exitCode) => {
          if (finished) updateRun(run.id, { output, status: exitCode === 0 ? "completed" : "failed", completedAt: Date.now() });
          else updateRun(run.id, { output });
        }, run.pid);
      }
    }
    return () => { for (const run of runs) factoryService.stopPolling(run.id); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (focusedRun && focusedProject) {
    return (
      <RunWorkspace run={focusedRun} project={focusedProject}
        onBack={() => setFocusedRunId(null)} onCancel={() => handleCancelRun(focusedRun)} />
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden", padding: "12px 24px 24px", gap: 16 }}>
      <div style={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column", gap: 6, overflowY: "auto" }}>
        <button onClick={() => setShowNewProject(true)} style={{ ...BTN_PRIMARY, marginBottom: 8 }}>
          <IconPlus /> New Project
        </button>
        {projects.map(p => {
          const active = p.id === selectedProjectId;
          const running = activeRunCount(p.id);
          return (
            <button key={p.id} onClick={() => { selectProject(p.id); setFocusedRunId(null); }}
              style={{ ...CARD, padding: "10px 12px", cursor: "pointer", textAlign: "left", borderColor: active ? "var(--accent)" : "var(--border)", background: active ? "var(--accent-bg)" : "var(--bg-elevated)", transition: "all .15s ease" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: active ? "var(--accent)" : "var(--text)", marginBottom: 2 }}>{p.name}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", ...MONO, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.path}</div>
              {running > 0 && (
                <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", animation: "_pulse 1.5s ease-in-out infinite" }} />
                  <span style={{ fontSize: 9, color: "var(--accent)" }}>{running} running</span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", gap: 12 }}>
        {showNewProject && <NewProjectForm onSubmit={p => { addProject(p); setShowNewProject(false); }} onCancel={() => setShowNewProject(false)} />}
        {selectedProject ? (
          <>
            <ProjectHeader project={selectedProject} runCount={projectRuns.length} activeCount={activeRunCount(selectedProject.id)} onDelete={() => removeProject(selectedProject.id)} />
            <NewRunForm onSubmit={handleStartRun} />
            <RunsList runs={projectRuns} onCancel={handleCancelRun} onRemove={removeRun} onClearCompleted={() => clearCompletedRuns(selectedProject.id)} onOpenWorkspace={setFocusedRunId} />
          </>
        ) : !showNewProject ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ textAlign: "center", color: "var(--text-muted)" }}>
              <Zap style={{ width: 32, height: 32, marginBottom: 8 }} />
              <p style={{ fontSize: 13, margin: 0 }}>Select or create a project</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── Sub-Components (Projects) ── */

function ProjectHeader({ project, runCount, activeCount, onDelete }: {
  project: FactoryProject; runCount: number; activeCount: number; onDelete: () => void;
}) {
  return (
    <div style={{ ...CARD, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{project.name}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)", ...MONO }}>{project.path}</span>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>&middot; {runCount} run{runCount !== 1 ? "s" : ""}</span>
          {activeCount > 0 && <span style={{ fontSize: 10, color: "var(--accent)" }}>&middot; {activeCount} active</span>}
        </div>
      </div>
      <button onClick={onDelete} style={BTN_DANGER} title="Delete project"><IconTrash /></button>
    </div>
  );
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "project";
}

function NewProjectForm({ onSubmit, onCancel }: {
  onSubmit: (p: { name: string; description: string; path: string; techStack: string[] }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [stack, setStack] = useState("");
  const [creating, setCreating] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const slug = slugify(name);
      const mkdirCmd = `$base = Join-Path $env:USERPROFILE 'Projects'; if (!(Test-Path $base)) { New-Item -ItemType Directory -Path $base -Force | Out-Null }; $dir = Join-Path $base '${slug}'; if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }; Write-Output $dir`;
      const result = await invoke<{ stdout: string }>("execute_command", { command: mkdirCmd, cwd: null });
      onSubmit({ name: name.trim(), description: desc.trim(), path: result.stdout.trim(), techStack: stack.split(",").map(s => s.trim()).filter(Boolean) });
    } catch (err) { console.error("Failed to create project directory:", err); }
    setCreating(false);
  };

  return (
    <div style={{ ...CARD, padding: 16, flexShrink: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>New Project</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <span style={LABEL}>Project Name *</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="My App" style={INPUT} autoFocus onKeyDown={e => { if (e.key === "Enter") handleSubmit(); }} />
        </div>
        <div>
          <span style={LABEL}>Folder</span>
          <div style={{ ...INPUT, background: "var(--bg-base)", color: "var(--text-muted)", fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
            <IconFolder /> <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>~/Projects/{name.trim() ? slugify(name) : "..."}</span>
          </div>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <span style={LABEL}>Description</span>
          <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="A React dashboard with auth..." style={INPUT} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <span style={LABEL}>Tech Stack (comma separated)</span>
          <input value={stack} onChange={e => setStack(e.target.value)} placeholder="react, typescript, tailwind" style={INPUT} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={handleSubmit} disabled={!name.trim() || creating} style={{ ...BTN_PRIMARY, opacity: !name.trim() || creating ? 0.5 : 1 }}>
          <IconPlus /> {creating ? "Creating..." : "Create Project"}
        </button>
        <button onClick={onCancel} style={BTN_GHOST}>Cancel</button>
      </div>
    </div>
  );
}

function NewRunForm({ onSubmit }: { onSubmit: (agentType: AgentType, objective: string) => void }) {
  const [agentType, setAgentType] = useState<AgentType>("claude-code");
  const [objective, setObjective] = useState("");
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ ...CARD, flexShrink: 0, overflow: "visible" }}>
      <button onClick={() => setExpanded(!expanded)}
        style={{ width: "100%", padding: "10px 16px", display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", color: "var(--text)" }}>
        <IconChevron open={expanded} />
        <span style={{ fontSize: 12, fontWeight: 600 }}>Local Build</span>
        <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: "auto" }}>Dispatch an agent via OpenClaw CLI</span>
      </button>
      {expanded && (
        <div style={{ padding: "0 16px 14px", borderTop: "1px solid var(--border)" }}>
          <div style={{ marginTop: 12 }}>
            <span style={LABEL}>Agent ID</span>
            <input value={agentType} onChange={e => setAgentType(e.target.value)}
              placeholder="claude-code, cortex, main, ..."
              style={{ ...INPUT, fontFamily: "inherit", marginBottom: 10 }} />
          </div>
          <div>
            <span style={LABEL}>Objective</span>
            <textarea value={objective} onChange={e => setObjective(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && e.ctrlKey) { if (objective.trim()) { onSubmit(agentType, objective.trim()); setObjective(""); } } }}
              placeholder="Describe what to build (Ctrl+Enter to start)"
              rows={3} style={{ ...INPUT, resize: "vertical", lineHeight: 1.5, fontFamily: "inherit" }} />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
            <button onClick={() => { if (objective.trim()) { onSubmit(agentType, objective.trim()); setObjective(""); } }}
              disabled={!objective.trim()} style={{ ...BTN_PRIMARY, opacity: !objective.trim() ? 0.5 : 1 }}>
              <Play style={{ width: 11, height: 11 }} /> Build
            </button>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Ctrl+Enter</span>
          </div>
        </div>
      )}
    </div>
  );
}

function RunsList({ runs, onCancel, onRemove, onClearCompleted, onOpenWorkspace }: {
  runs: AgentRun[]; onCancel: (run: AgentRun) => void; onRemove: (id: string) => void;
  onClearCompleted: () => void; onOpenWorkspace: (runId: string) => void;
}) {
  const hasCompleted = runs.some(r => r.status !== "running" && r.status !== "queued");
  return (
    <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
      {runs.length > 0 && hasCompleted && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClearCompleted} style={{ ...BTN_GHOST, fontSize: 10 }}>Clear Completed</button>
        </div>
      )}
      {runs.length === 0 && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <p style={{ fontSize: 11, color: "var(--text-muted)" }}>No runs yet</p>
        </div>
      )}
      {runs.map(run => (
        <RunCard key={run.id} run={run} onCancel={() => onCancel(run)} onRemove={() => onRemove(run.id)} onOpenWorkspace={() => onOpenWorkspace(run.id)} />
      ))}
    </div>
  );
}

function RunCard({ run, onCancel, onRemove, onOpenWorkspace }: {
  run: AgentRun; onCancel: () => void; onRemove: () => void; onOpenWorkspace: () => void;
}) {
  const [expanded, setExpanded] = useState(run.status === "running");
  const outputRef = useRef<HTMLPreElement>(null);
  const isActive = run.status === "running" || run.status === "queued";
  const color = "var(--accent)";

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!isActive) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isActive]);

  useEffect(() => {
    if (expanded && outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [run.output, expanded]);

  const duration = run.startedAt ? elapsed((run.completedAt ?? now) - run.startedAt) : "—";

  return (
    <div style={{ ...CARD, borderColor: isActive ? "var(--accent)" + "40" : "var(--border)" }}>
      <button onClick={() => setExpanded(!expanded)}
        style={{ width: "100%", padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", color: "var(--text)" }}>
        <span style={{ width: 20, height: 20, borderRadius: 5, fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: color, color: "#fff" }}>
          {run.agentType.charAt(0).toUpperCase()}
        </span>
        <div style={{ flex: 1, textAlign: "left" }}>
          <div style={{ fontSize: 11, fontWeight: 600 }}>
            {run.agentType}
            <span style={{ fontWeight: 400, color: "var(--text-secondary)", marginLeft: 8 }}>
              {run.objective.length > 80 ? run.objective.slice(0, 80) + "..." : run.objective}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)", ...MONO }}>{duration}</span>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS_COLORS[run.status] ?? "var(--text-muted)" }} />
          <span style={{ fontSize: 10, color: STATUS_COLORS[run.status], textTransform: "capitalize" }}>{run.status}</span>
          <IconChevron open={expanded} />
        </div>
      </button>
      {expanded && (
        <div style={{ borderTop: "1px solid var(--border)" }}>
          {run.error && <div style={{ padding: "8px 14px", background: "rgba(239,68,68,0.06)", fontSize: 11, color: "#ef4444" }}>{run.error}</div>}
          {(run.output || !isActive) && (
            <pre ref={outputRef} style={{ margin: 0, padding: "10px 14px", fontSize: 10, lineHeight: 1.6, ...MONO, color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 300, overflowY: "auto", background: "var(--bg-base)" }}>
              {run.output || "No output captured."}
            </pre>
          )}
          <div style={{ padding: "8px 14px", display: "flex", gap: 8, borderTop: "1px solid var(--border)" }}>
            <button onClick={onOpenWorkspace} style={BTN_PRIMARY}><IconFolder /> Workspace</button>
            {isActive && <button onClick={onCancel} style={BTN_DANGER}><IconStop /> Cancel</button>}
            {!isActive && <button onClick={onRemove} style={BTN_GHOST}><IconTrash /> Remove</button>}
          </div>
        </div>
      )}
    </div>
  );
}
