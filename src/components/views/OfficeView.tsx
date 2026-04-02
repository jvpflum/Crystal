import { useState, useEffect, useRef, useCallback } from "react";
import {
  Bot, Loader2, CheckCircle2, AlertCircle, Plus, Clock,
  Copy, ChevronDown, ChevronUp, MessageSquare, ArrowRight,
  RefreshCw, Cpu, Activity, Zap,
} from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useDataStore } from "@/stores/dataStore";
import { openclawClient } from "@/lib/openclaw";

interface OCAgent {
  id: string;
  name: string;
  emoji: string;
  model: string;
  isDefault: boolean;
  workspace: string;
}

interface AgentSession {
  sessionId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  agentId: string;
  updatedAt: number;
  ageMs: number;
  kind: string;
}

interface AgentTask {
  id: string;
  kind: string;
  status: string;
  label?: string;
  agentId?: string;
}

interface TaskLogEntry {
  id: string;
  task: string;
  status: "running" | "completed" | "error";
  output?: string;
  startedAt: number;
  completedAt?: number;
}

interface OfficeTask {
  id: string;
  sessionId: string;
  prompt: string;
  assignedTo: string | null;
  status: "queued" | "running" | "completed" | "error";
  result?: string;
  createdAt: number;
}

const AGENT_COLORS: Record<string, string> = {
  main: "#8b5cf6",
  research: "#3b82f6",
  home: "#10b981",
  finance: "#f59e0b",
};

function agentColor(id: string): string {
  return AGENT_COLORS[id] || "#6b7280";
}

function formatAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function OfficeView() {
  const [ocAgents, setOcAgents] = useState<OCAgent[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [bgTasks, setBgTasks] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(true);

  const [tasks, setTasks] = useState<OfficeTask[]>([]);
  const [taskLogs, setTaskLogs] = useState<Record<string, TaskLogEntry[]>>({});
  const [dispatchingSet, setDispatchingSet] = useState<Set<string>>(new Set());
  const [newTaskPrompt, setNewTaskPrompt] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<string>("main");
  const runningRef = useRef<Set<string>>(new Set());
  const setView = useAppStore(s => s.setView);

  const getAgents = useDataStore(s => s.getAgents);
  const getSessions = useDataStore(s => s.getSessions);
  const getTasks = useDataStore(s => s.getTasks);

  const loadData = useCallback(async (force = false) => {
    try {
      const [agentsData, sessionsData, tasksData] = await Promise.all([
        getAgents(force),
        getSessions(force),
        getTasks(force),
      ]);

      if (Array.isArray(agentsData)) {
        setOcAgents(agentsData.map((a: Record<string, unknown>) => ({
          id: String(a.id || ""),
          name: String(a.identityName || a.name || a.id || ""),
          emoji: String(a.identityEmoji || ""),
          model: String(a.model || ""),
          isDefault: a.isDefault === true,
          workspace: String(a.workspace || ""),
        })));
      }

      if (Array.isArray(sessionsData)) {
        setSessions(sessionsData.map((s: Record<string, unknown>) => ({
          sessionId: String(s.sessionId || s.key || ""),
          model: String(s.model || ""),
          inputTokens: Number(s.inputTokens || 0),
          outputTokens: Number(s.outputTokens || 0),
          totalTokens: Number(s.totalTokens || 0),
          agentId: String(s.agentId || "main"),
          updatedAt: Number(s.updatedAt || 0),
          ageMs: Number(s.ageMs || 0),
          kind: String(s.kind || ""),
        })));
      }

      if (Array.isArray(tasksData)) {
        setBgTasks(tasksData.map((t: Record<string, unknown>) => ({
          id: String(t.id || ""),
          kind: String(t.kind || ""),
          status: String(t.status || ""),
          label: t.label ? String(t.label) : undefined,
          agentId: t.agentId ? String(t.agentId) : undefined,
        })));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [getAgents, getSessions, getTasks]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const interval = setInterval(() => loadData(), 15_000);
    return () => clearInterval(interval);
  }, [loadData]);

  const dispatchTask = useCallback(async (task: OfficeTask, agentId: string) => {
    if (runningRef.current.has(task.id)) return;
    runningRef.current.add(task.id);
    setDispatchingSet(prev => new Set(prev).add(agentId));

    setTasks(prev => prev.map(t =>
      t.id === task.id ? { ...t, status: "running", assignedTo: agentId } : t
    ));

    const logId = crypto.randomUUID();
    setTaskLogs(prev => ({
      ...prev,
      [agentId]: [...(prev[agentId] || []).slice(-19), { id: logId, task: task.prompt, status: "running" as const, startedAt: Date.now() }],
    }));

    try {
      const result = await openclawClient.dispatchToAgent(agentId, task.prompt, { sessionId: task.sessionId });
      const output = result.stdout || result.stderr || "Task completed";
      const success = result.code === 0;

      setTaskLogs(prev => ({
        ...prev,
        [agentId]: (prev[agentId] || []).map(l =>
          l.id === logId ? { ...l, status: success ? "completed" as const : "error" as const, output, completedAt: Date.now() } : l
        ),
      }));
      setTasks(prev => prev.map(t =>
        t.id === task.id ? { ...t, status: success ? "completed" : "error", result: output } : t
      ));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      setTaskLogs(prev => ({
        ...prev,
        [agentId]: (prev[agentId] || []).map(l =>
          l.id === logId ? { ...l, status: "error" as const, output: errMsg, completedAt: Date.now() } : l
        ),
      }));
      setTasks(prev => prev.map(t =>
        t.id === task.id ? { ...t, status: "error", result: errMsg } : t
      ));
    }

    runningRef.current.delete(task.id);
    setDispatchingSet(prev => { const n = new Set(prev); n.delete(agentId); return n; });
    loadData(true);
  }, [loadData]);

  const addTask = useCallback(() => {
    if (!newTaskPrompt.trim()) return;
    const task: OfficeTask = {
      id: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      prompt: newTaskPrompt.trim(),
      assignedTo: null,
      status: "queued",
      createdAt: Date.now(),
    };
    setTasks(prev => [...prev, task]);
    setNewTaskPrompt("");
    dispatchTask(task, selectedAgent);
  }, [newTaskPrompt, selectedAgent, dispatchTask]);

  const sessionsForAgent = (agentId: string) =>
    sessions.filter(s => s.agentId === agentId).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);

  const tasksForAgent = (agentId: string) =>
    bgTasks.filter(t => t.agentId === agentId && t.status === "running");

  const totalSessions = sessions.length;
  const runningTasks = bgTasks.filter(t => t.status === "running").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "18px 24px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ color: "var(--text)", fontSize: 16, fontWeight: 700, margin: 0 }}>
              Agent Office
            </h2>
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "2px 0 0" }}>
              Live agent monitoring and task dispatch
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
              {ocAgents.length} agents &middot; {totalSessions} sessions &middot; {runningTasks} running
            </span>
            <button onClick={() => loadData(true)} style={{
              background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4,
            }}>
              <RefreshCw style={{ width: 13, height: 13 }} />
            </button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "0 24px 24px" }}>
        {loading && ocAgents.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
            <Loader2 style={{ width: 20, height: 20, color: "var(--accent)", animation: "spin 1s linear infinite" }} />
          </div>
        ) : (
          <>
            {/* Agent cards */}
            <div style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.min(ocAgents.length, 4)}, 1fr)`,
              gap: 14,
              marginBottom: 20,
            }}>
              {ocAgents.map(agent => {
                const color = agentColor(agent.id);
                const agentSessions = sessionsForAgent(agent.id);
                const agentRunning = tasksForAgent(agent.id);
                const localLogs = taskLogs[agent.id] || [];
                const isDispatching = dispatchingSet.has(agent.id);

                return (
                  <LiveAgentCard
                    key={agent.id}
                    agent={agent}
                    color={color}
                    sessions={agentSessions}
                    runningTasks={agentRunning}
                    localLogs={localLogs}
                    isDispatching={isDispatching}
                  />
                );
              })}
            </div>

            {/* Dispatch task */}
            <div style={{
              background: "var(--bg-elevated)", border: "1px solid var(--border)",
              borderRadius: 12, padding: "14px 16px", marginBottom: 16,
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-muted)", marginBottom: 8 }}>
                Dispatch Task
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={newTaskPrompt}
                  onChange={e => setNewTaskPrompt(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addTask()}
                  placeholder="Describe a task for an agent..."
                  style={{
                    flex: 1, background: "var(--bg-surface)", border: "1px solid var(--border)",
                    borderRadius: 8, padding: "8px 12px", color: "var(--text)", fontSize: 12, outline: "none",
                  }}
                />
                <select
                  value={selectedAgent}
                  onChange={e => setSelectedAgent(e.target.value)}
                  style={{
                    background: "var(--bg-surface)", border: "1px solid var(--border)",
                    borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontSize: 11, outline: "none",
                  }}
                >
                  {ocAgents.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name || a.id} {a.isDefault ? "(default)" : ""}
                    </option>
                  ))}
                </select>
                <button
                  onClick={addTask}
                  disabled={!newTaskPrompt.trim()}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "8px 16px", borderRadius: 8, border: "none",
                    background: newTaskPrompt.trim() ? "var(--accent)" : "var(--bg-surface)",
                    color: newTaskPrompt.trim() ? "#fff" : "var(--text-muted)",
                    fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
                  }}
                >
                  <Plus style={{ width: 13, height: 13 }} />
                  Dispatch
                </button>
              </div>
            </div>

            {/* Task Queue */}
            {tasks.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-muted)", marginBottom: 8 }}>
                  Task Queue ({tasks.length})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[...tasks].reverse().map(task => (
                    <TaskRow key={task.id} task={task} agents={ocAgents} onSendToChat={(result, prompt, sessionId) => {
                      const context = `A sub-agent completed the following task:\n\n**Task:** ${prompt}\n\n**Result:**\n${result}\n\nPlease review this result and execute any actionable items.`;
                      setView("conversation");
                      setTimeout(() => {
                        window.dispatchEvent(new CustomEvent("crystal:send-to-chat", {
                          detail: { context, surface: "office", sessionId },
                        }));
                      }, 300);
                    }} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes thinking-dot { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes indeterminate-bar { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }
      `}</style>
    </div>
  );
}

function LiveAgentCard({ agent, color, sessions, runningTasks, localLogs, isDispatching }: {
  agent: OCAgent; color: string; sessions: AgentSession[];
  runningTasks: AgentTask[]; localLogs: TaskLogEntry[]; isDispatching: boolean;
}) {
  const [showSessions, setShowSessions] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const isActive = isDispatching || runningTasks.length > 0;
  const modelShort = agent.model.split("/").pop() || agent.model;

  const totalTokens = sessions.reduce((sum, s) => sum + s.totalTokens, 0);

  return (
    <div style={{
      background: "var(--bg-elevated)", border: `1px solid var(--border)`,
      borderRadius: 14, padding: 16, position: "relative", overflow: "hidden",
    }}>
      {isActive && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 3,
          background: "var(--border)", overflow: "hidden",
        }}>
          <div style={{
            height: "100%", width: "40%", background: color, borderRadius: 2,
            animation: "indeterminate-bar 1.5s ease-in-out infinite",
          }} />
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: `${color}18`, border: `1px solid ${color}30`,
          fontSize: 20,
        }}>
          {agent.emoji || <Bot style={{ width: 20, height: 20, color }} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
            {agent.name || agent.id}
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: isActive ? color : "var(--text-muted)",
              boxShadow: isActive ? `0 0 8px ${color}` : "none",
              animation: isActive ? "thinking-dot 1.4s ease-in-out infinite" : "none",
            }} />
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
            {agent.id}{agent.isDefault ? " (default)" : ""}
          </div>
        </div>
        <div style={{
          fontSize: 9, padding: "2px 8px", borderRadius: 6, fontWeight: 600,
          textTransform: "uppercase", letterSpacing: 0.5,
          background: isActive ? `${color}15` : "rgba(255,255,255,0.04)",
          color: isActive ? color : "var(--text-muted)",
        }}>
          {isActive ? "active" : "idle"}
        </div>
      </div>

      {/* Model + stats */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{
          fontSize: 9, padding: "2px 8px", borderRadius: 6,
          background: "var(--bg-surface)", border: "1px solid var(--border)",
          color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 4,
        }}>
          <Cpu style={{ width: 9, height: 9 }} />
          {modelShort}
        </span>
        <span style={{
          fontSize: 9, padding: "2px 8px", borderRadius: 6,
          background: "var(--bg-surface)", border: "1px solid var(--border)",
          color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 4,
        }}>
          <Activity style={{ width: 9, height: 9 }} />
          {sessions.length} sessions
        </span>
        {totalTokens > 0 && (
          <span style={{
            fontSize: 9, padding: "2px 8px", borderRadius: 6,
            background: "var(--bg-surface)", border: "1px solid var(--border)",
            color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 4,
          }}>
            <Zap style={{ width: 9, height: 9 }} />
            {formatTokens(totalTokens)} tokens
          </span>
        )}
      </div>

      {/* Running tasks */}
      {runningTasks.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {runningTasks.map(t => (
            <div key={t.id} style={{
              fontSize: 10, color: "var(--text-secondary)", padding: "6px 10px", borderRadius: 8,
              background: "var(--bg-surface)", border: "1px solid var(--border)", marginBottom: 4,
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <Loader2 style={{ width: 10, height: 10, color, animation: "spin 1s linear infinite", flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.label || t.kind}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Dispatching indicator */}
      {isDispatching && runningTasks.length === 0 && (
        <div style={{
          fontSize: 10, color: "var(--text-secondary)", padding: "6px 10px", borderRadius: 8,
          background: "var(--bg-surface)", border: "1px solid var(--border)", marginBottom: 8,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <Loader2 style={{ width: 10, height: 10, color, animation: "spin 1s linear infinite", flexShrink: 0 }} />
          Processing dispatched task...
        </div>
      )}

      {/* Recent sessions toggle */}
      {sessions.length > 0 && (
        <div>
          <button onClick={() => setShowSessions(!showSessions)} style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 9, color: "var(--text-muted)", padding: "2px 0",
            display: "flex", alignItems: "center", gap: 4, width: "100%",
          }}>
            <Clock style={{ width: 9, height: 9 }} />
            Recent sessions ({sessions.length})
            {showSessions ? <ChevronUp style={{ width: 9, height: 9, marginLeft: "auto" }} /> : <ChevronDown style={{ width: 9, height: 9, marginLeft: "auto" }} />}
          </button>
          {showSessions && (
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
              {sessions.map(s => (
                <div key={s.sessionId} style={{
                  fontSize: 9, padding: "4px 8px", borderRadius: 6,
                  background: "var(--bg-surface)", color: "var(--text-muted)",
                  display: "flex", alignItems: "center", gap: 8,
                }}>
                  <span style={{ color: "var(--text-secondary)", fontFamily: "monospace" }}>
                    {s.sessionId.slice(0, 8)}
                  </span>
                  <span>{s.model.split("/").pop()}</span>
                  <span>{formatTokens(s.totalTokens)} tok</span>
                  <span style={{ marginLeft: "auto" }}>{formatAge(s.ageMs)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Local dispatch logs */}
      {localLogs.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <button onClick={() => setShowLogs(!showLogs)} style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 9, color: "var(--text-muted)", padding: "2px 0",
            display: "flex", alignItems: "center", gap: 4, width: "100%",
          }}>
            <Activity style={{ width: 9, height: 9 }} />
            Dispatch history ({localLogs.length})
            {showLogs ? <ChevronUp style={{ width: 9, height: 9, marginLeft: "auto" }} /> : <ChevronDown style={{ width: 9, height: 9, marginLeft: "auto" }} />}
          </button>
          {showLogs && (
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
              {localLogs.slice(-5).reverse().map(log => (
                <TaskLogItem key={log.id} log={log} agentColor={color} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TaskLogItem({ log, agentColor }: { log: TaskLogEntry; agentColor: string }) {
  const [showOutput, setShowOutput] = useState(false);
  return (
    <div style={{
      fontSize: 10, padding: "4px 8px", borderRadius: 6,
      background: "var(--bg-surface)", color: "var(--text-muted)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {log.status === "completed"
          ? <CheckCircle2 style={{ width: 10, height: 10, color: "var(--success)", flexShrink: 0 }} />
          : log.status === "error"
          ? <AlertCircle style={{ width: 10, height: 10, color: "var(--error)", flexShrink: 0 }} />
          : <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite", flexShrink: 0 }} />
        }
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {log.task}
        </span>
        {log.completedAt && (
          <span style={{ fontSize: 8, color: "var(--text-muted)", flexShrink: 0 }}>
            {((log.completedAt - log.startedAt) / 1000).toFixed(1)}s
          </span>
        )}
        {log.output && (
          <button onClick={e => { e.stopPropagation(); setShowOutput(!showOutput); }}
            style={{ background: "none", border: "none", cursor: "pointer", color: agentColor, padding: 0, display: "flex", alignItems: "center" }}>
            {showOutput ? <ChevronUp style={{ width: 10, height: 10 }} /> : <ChevronDown style={{ width: 10, height: 10 }} />}
          </button>
        )}
      </div>
      {showOutput && log.output && (
        <div style={{
          marginTop: 4, padding: "6px 8px", borderRadius: 4,
          background: "var(--bg)", fontSize: 10, fontFamily: "monospace",
          whiteSpace: "pre-wrap", wordBreak: "break-word",
          maxHeight: 200, overflowY: "auto",
          border: "1px solid var(--border)", color: "var(--text-secondary)",
        }}>
          {log.output}
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, agents, onSendToChat }: {
  task: OfficeTask;
  agents: OCAgent[];
  onSendToChat?: (result: string, prompt: string, sessionId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const assigned = task.assignedTo ? agents.find(a => a.id === task.assignedTo) : null;
  const assignedColor = assigned ? agentColor(assigned.id) : "var(--text-muted)";

  return (
    <div style={{
      padding: "8px 14px", borderRadius: 10,
      background: "var(--bg-elevated)", border: "1px solid var(--border)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {task.status === "queued" && <Clock style={{ width: 13, height: 13, color: "var(--text-muted)", flexShrink: 0 }} />}
        {task.status === "running" && <Loader2 style={{ width: 13, height: 13, color: "var(--accent)", animation: "spin 1s linear infinite", flexShrink: 0 }} />}
        {task.status === "completed" && <CheckCircle2 style={{ width: 13, height: 13, color: "var(--success)", flexShrink: 0 }} />}
        {task.status === "error" && <AlertCircle style={{ width: 13, height: 13, color: "var(--error)", flexShrink: 0 }} />}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {task.prompt}
          </div>
          {task.result && !expanded && (
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {task.result.slice(0, 200)}
            </div>
          )}
        </div>

        {assigned && (
          <span style={{
            fontSize: 9, padding: "2px 8px", borderRadius: 6,
            background: `${assignedColor}15`, color: assignedColor,
            fontWeight: 600, flexShrink: 0,
          }}>
            {assigned.name || assigned.id}
          </span>
        )}

        <span style={{
          fontSize: 9, padding: "2px 8px", borderRadius: 6,
          fontWeight: 600, textTransform: "uppercase", flexShrink: 0,
          background: task.status === "completed" ? "rgba(74,222,128,0.1)" : task.status === "error" ? "rgba(248,113,113,0.1)" : task.status === "running" ? "rgba(59,130,246,0.1)" : "rgba(255,255,255,0.05)",
          color: task.status === "completed" ? "var(--success)" : task.status === "error" ? "var(--error)" : task.status === "running" ? "var(--accent)" : "var(--text-muted)",
        }}>
          {task.status}
        </span>

        {(task.status === "completed" || task.status === "error") && task.result && onSendToChat && (
          <button
            onClick={() => onSendToChat(task.result || "", task.prompt, task.sessionId)}
            title="Execute in Chat"
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "3px 8px", borderRadius: 6, border: "none",
              background: "rgba(59,130,246,0.1)", color: "var(--accent)",
              fontSize: 9, fontWeight: 600, cursor: "pointer", transition: "all 0.15s", flexShrink: 0,
            }}
          >
            <ArrowRight style={{ width: 10, height: 10 }} />
            Chat
          </button>
        )}

        {task.result && (
          <button onClick={() => setExpanded(!expanded)} style={{
            background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "2px", display: "flex", alignItems: "center",
          }}>
            {expanded ? <ChevronUp style={{ width: 13, height: 13 }} /> : <ChevronDown style={{ width: 13, height: 13 }} />}
          </button>
        )}
      </div>

      {expanded && task.result && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Full Result</span>
            <div style={{ display: "flex", gap: 6 }}>
              {onSendToChat && (
                <button onClick={() => onSendToChat(task.result || "", task.prompt, task.sessionId)}
                  style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", color: "var(--accent)", fontSize: 9, fontWeight: 600 }}>
                  <MessageSquare style={{ width: 10, height: 10 }} /> Send to Chat
                </button>
              )}
              <button onClick={() => navigator.clipboard.writeText(task.result || "")}
                style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 9 }}>
                <Copy style={{ width: 10, height: 10 }} /> Copy
              </button>
            </div>
          </div>
          <div style={{
            padding: "8px 10px", borderRadius: 6,
            background: "var(--bg-surface)", border: "1px solid var(--border)",
            fontSize: 11, fontFamily: "monospace", color: "var(--text-secondary)",
            whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 300, overflowY: "auto",
          }}>
            {task.result}
          </div>
        </div>
      )}
    </div>
  );
}
