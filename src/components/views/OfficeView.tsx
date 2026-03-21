import { useState, useEffect, useRef, useCallback } from "react";
import { Bot, Loader2, CheckCircle2, AlertCircle, Plus, Clock, Brain, Globe, Terminal, FileText, Shield, Cpu, Copy, ChevronDown, ChevronUp, MessageSquare, ArrowRight } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useDataStore } from "@/stores/dataStore";
import { openclawClient } from "@/lib/openclaw";

interface SubAgent {
  id: string;
  name: string;
  role: string;
  icon: string;
  status: "idle" | "working" | "done" | "error";
  currentTask: string | null;
  taskLog: TaskLogEntry[];
  color: string;
  progress: number;
  openclawAgentId?: string;
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

const PRESET_AGENTS: Omit<SubAgent, "currentTask" | "taskLog" | "status" | "progress">[] = [
  { id: "researcher", name: "Scout", role: "Web Research", icon: "globe", color: "#60a5fa" },
  { id: "coder", name: "Forge", role: "Code & Automation", icon: "terminal", color: "#a78bfa" },
  { id: "analyst", name: "Lens", role: "Data Analysis", icon: "cpu", color: "#4ade80" },
  { id: "writer", name: "Quill", role: "Writing & Docs", icon: "file", color: "#fbbf24" },
  { id: "security", name: "Sentinel", role: "Security & Audit", icon: "shield", color: "#f87171" },
  { id: "planner", name: "Atlas", role: "Planning & Strategy", icon: "brain", color: "#c084fc" },
];

function getAgentIcon(icon: string) {
  const s = { width: 18, height: 18 };
  switch (icon) {
    case "globe": return <Globe style={s} />;
    case "terminal": return <Terminal style={s} />;
    case "cpu": return <Cpu style={s} />;
    case "file": return <FileText style={s} />;
    case "shield": return <Shield style={s} />;
    case "brain": return <Brain style={s} />;
    default: return <Bot style={s} />;
  }
}

export function OfficeView() {
  const [agents, setAgents] = useState<SubAgent[]>(() =>
    PRESET_AGENTS.map(a => ({ ...a, status: "idle" as const, currentTask: null, taskLog: [], progress: 0 }))
  );
  const [tasks, setTasks] = useState<OfficeTask[]>([]);
  const [newTaskPrompt, setNewTaskPrompt] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [autoAssign, setAutoAssign] = useState(true);
  const runningRef = useRef<Set<string>>(new Set());
  const setView = useAppStore(s => s.setView);
  const [realAgents, setRealAgents] = useState<string[]>([]);

  const getAgents = useDataStore(s => s.getAgents);
  useEffect(() => {
    (async () => {
      try {
        const data = await getAgents();
        if (Array.isArray(data)) {
          const ids = data.map((a: Record<string, unknown>) => String(a.id || "")).filter((id: string) => id && id !== "main");
          setRealAgents(ids);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const dispatchTask = useCallback(async (task: OfficeTask, agentId: string) => {
    if (runningRef.current.has(task.id)) return;
    runningRef.current.add(task.id);

    setAgents(prev => prev.map(a =>
      a.id === agentId ? { ...a, status: "working", currentTask: task.prompt, progress: 0 } : a
    ));
    setTasks(prev => prev.map(t =>
      t.id === task.id ? { ...t, status: "running", assignedTo: agentId } : t
    ));

    const logId = crypto.randomUUID();
    setAgents(prev => prev.map(a =>
      a.id === agentId ? {
        ...a,
        taskLog: [...a.taskLog.slice(-19), { id: logId, task: task.prompt, status: "running", startedAt: Date.now() }],
      } : a
    ));

    try {
      const agent = agents.find(a => a.id === agentId);
      const ocAgent = agent?.openclawAgentId || "main";
      const roleHint = (ocAgent === "main" && agent) ? `You are ${agent.name}, a sub-agent specializing in ${agent.role}.` : "";
      const fullPrompt = `${roleHint} ${task.prompt}`.trim();
      const result = await openclawClient.dispatchToAgent(ocAgent, fullPrompt, { sessionId: task.sessionId });

      const output = result.stdout || result.stderr || "Task completed";
      const success = result.code === 0;

      setAgents(prev => prev.map(a =>
        a.id === agentId ? {
          ...a,
          status: "done",
          currentTask: null,
          progress: 100,
          taskLog: a.taskLog.map(l => l.id === logId ? { ...l, status: success ? "completed" : "error", output, completedAt: Date.now() } : l),
        } : a
      ));
      setTasks(prev => prev.map(t =>
        t.id === task.id ? { ...t, status: success ? "completed" : "error", result: output } : t
      ));

      setTimeout(() => {
        setAgents(prev => prev.map(a =>
          a.id === agentId && a.status === "done" ? { ...a, status: "idle", progress: 0 } : a
        ));
      }, 3000);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      setAgents(prev => prev.map(a =>
        a.id === agentId ? {
          ...a,
          status: "error",
          currentTask: null,
          progress: 0,
          taskLog: a.taskLog.map(l => l.id === logId ? { ...l, status: "error", output: errMsg, completedAt: Date.now() } : l),
        } : a
      ));
      setTasks(prev => prev.map(t =>
        t.id === task.id ? { ...t, status: "error", result: errMsg } : t
      ));
    }

    runningRef.current.delete(task.id);
  }, [agents]);

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

    if (autoAssign) {
      const idle = agents.find(a => a.status === "idle");
      if (idle) dispatchTask(task, idle.id);
    } else if (selectedAgent) {
      const agent = agents.find(a => a.id === selectedAgent);
      if (agent && agent.status === "idle") dispatchTask(task, selectedAgent);
    }
  }, [newTaskPrompt, autoAssign, selectedAgent, agents, dispatchTask]);

  const runTask = useCallback((taskId: string, agentId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (task && task.status === "queued") dispatchTask(task, agentId);
  }, [tasks, dispatchTask]);

  useEffect(() => {
    if (!autoAssign) return;
    const queued = tasks.find(t => t.status === "queued" && !t.assignedTo);
    if (!queued) return;
    const idle = agents.find(a => a.status === "idle");
    if (idle) dispatchTask(queued, idle.id);
  }, [tasks, agents, autoAssign, dispatchTask]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "18px 24px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ color: "var(--text)", fontSize: 16, fontWeight: 700, margin: 0 }}>
              Office
            </h2>
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "2px 0 0" }}>
              Sub-agents working on tasks in real-time
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={autoAssign}
                onChange={e => setAutoAssign(e.target.checked)}
                style={{ accentColor: "var(--accent)" }}
              />
              Auto-assign
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                {agents.filter(a => a.status === "working").length} active
              </span>
              <span style={{ width: 4, height: 4, borderRadius: "50%", background: agents.some(a => a.status === "working") ? "var(--success)" : "var(--text-muted)" }} />
            </div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "0 24px 24px" }}>
        {/* Agent Grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 14,
          marginBottom: 20,
        }}>
          {agents.map(agent => (
            <AgentCard
              key={agent.id}
              agent={agent}
              selected={selectedAgent === agent.id}
              onSelect={() => setSelectedAgent(selectedAgent === agent.id ? null : agent.id)}
              realAgents={realAgents}
              onMapAgent={(ocId) => setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, openclawAgentId: ocId } : a))}
            />
          ))}
        </div>

        {/* Task Input */}
        <div style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "14px 16px",
          marginBottom: 16,
        }}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-muted)", marginBottom: 8 }}>
            Dispatch Task
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={newTaskPrompt}
              onChange={e => setNewTaskPrompt(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addTask()}
              placeholder="Describe a task for a sub-agent..."
              style={{
                flex: 1,
                background: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "8px 12px",
                color: "var(--text)",
                fontSize: 12,
                outline: "none",
              }}
            />
            {!autoAssign && (
              <select
                value={selectedAgent || ""}
                onChange={e => setSelectedAgent(e.target.value || null)}
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  color: "var(--text)",
                  fontSize: 11,
                  outline: "none",
                }}
              >
                <option value="">Select agent...</option>
                {agents.map(a => (
                  <option key={a.id} value={a.id} disabled={a.status === "working"}>
                    {a.name} ({a.role}) {a.status === "working" ? "— busy" : ""}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={addTask}
              disabled={!newTaskPrompt.trim()}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 16px", borderRadius: 8, border: "none",
                background: newTaskPrompt.trim() ? "var(--accent)" : "var(--bg-surface)",
                color: newTaskPrompt.trim() ? "#fff" : "var(--text-muted)",
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                transition: "all 0.15s",
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
                <TaskRow key={task.id} task={task} agents={agents} onRun={runTask} onSendToChat={(result, prompt, sessionId) => {
                  const context = `A sub-agent completed the following task:\n\n**Task:** ${prompt}\n\n**Result:**\n${result}\n\nPlease review this result and execute any actionable items. Ask me to confirm before taking irreversible actions.`;
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
      </div>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes thinking-dot { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes indeterminate-bar { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }
      `}</style>
    </div>
  );
}

function AgentCard({ agent, selected, onSelect, realAgents, onMapAgent }: {
  agent: SubAgent; selected: boolean; onSelect: () => void;
  realAgents: string[]; onMapAgent: (openclawId: string | undefined) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusColor = agent.status === "working" ? agent.color
    : agent.status === "done" ? "var(--success)"
    : agent.status === "error" ? "var(--error)"
    : "var(--text-muted)";

  return (
    <div
      onClick={onSelect}
      style={{
        background: "var(--bg-elevated)",
        border: selected ? `1.5px solid ${agent.color}` : "1px solid var(--border)",
        borderRadius: 14,
        padding: 16,
        cursor: "pointer",
        transition: "all 0.2s",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {agent.status === "working" && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 3,
          background: "var(--border)", overflow: "hidden",
        }}>
          <div style={{
            height: "100%", width: "40%",
            background: agent.color,
            borderRadius: 2,
            animation: "indeterminate-bar 1.5s ease-in-out infinite",
          }} />
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: `${agent.color}18`,
          color: agent.color,
          border: `1px solid ${agent.color}30`,
        }}>
          {getAgentIcon(agent.icon)}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
            {agent.name}
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: statusColor,
              boxShadow: agent.status === "working" ? `0 0 8px ${agent.color}` : "none",
              animation: agent.status === "working" ? "thinking-dot 1.4s ease-in-out infinite" : "none",
            }} />
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
            {agent.role}
            {realAgents.length > 0 && (
              <select
                value={agent.openclawAgentId || ""}
                onClick={e => e.stopPropagation()}
                onChange={e => { e.stopPropagation(); onMapAgent(e.target.value || undefined); }}
                style={{
                  fontSize: 8, padding: "1px 4px", borderRadius: 4,
                  background: agent.openclawAgentId ? "rgba(139,92,246,0.12)" : "var(--bg-input)",
                  border: "1px solid var(--border)", color: agent.openclawAgentId ? "rgba(139,92,246,0.9)" : "var(--text-muted)",
                  outline: "none", cursor: "pointer",
                }}
              >
                <option value="" style={{ background: "var(--bg-base)" }}>main (default)</option>
                {realAgents.map(id => (
                  <option key={id} value={id} style={{ background: "var(--bg-base)" }}>{id}</option>
                ))}
              </select>
            )}
          </div>
        </div>
        <div style={{
          fontSize: 9, padding: "2px 8px", borderRadius: 6,
          fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5,
          background: `${statusColor}15`,
          color: statusColor,
        }}>
          {agent.status}
        </div>
      </div>

      {/* Current task */}
      {agent.currentTask && (
        <div style={{
          fontSize: 11, color: "var(--text-secondary)",
          padding: "8px 10px", borderRadius: 8,
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          marginBottom: 8,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <Loader2 style={{ width: 11, height: 11, color: agent.color, animation: "spin 1s linear infinite", flexShrink: 0 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {agent.currentTask}
          </span>
        </div>
      )}

      {/* Task log */}
      {agent.taskLog.length > 0 && (
        <div>
          <button
            onClick={e => { e.stopPropagation(); setExpanded(!expanded); }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 9, color: "var(--text-muted)", padding: "2px 0",
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            <Clock style={{ width: 9, height: 9 }} />
            {agent.taskLog.length} task{agent.taskLog.length !== 1 ? "s" : ""} completed
          </button>
          {expanded && (
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
              {agent.taskLog.slice(-5).reverse().map(log => (
                <TaskLogItem key={log.id} log={log} agentColor={agent.color} />
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
      background: "var(--bg-surface)",
      color: "var(--text-muted)",
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

function TaskRow({ task, agents, onRun, onSendToChat }: {
  task: OfficeTask;
  agents: SubAgent[];
  onRun: (taskId: string, agentId: string) => void;
  onSendToChat?: (result: string, prompt: string, sessionId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const assigned = task.assignedTo ? agents.find(a => a.id === task.assignedTo) : null;

  return (
    <div style={{
      padding: "8px 14px", borderRadius: 10,
      background: "var(--bg-elevated)",
      border: "1px solid var(--border)",
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
              {task.result.slice(0, 200)}...
            </div>
          )}
        </div>

        {assigned && (
          <span style={{
            fontSize: 9, padding: "2px 8px", borderRadius: 6,
            background: `${assigned.color}15`, color: assigned.color,
            fontWeight: 600, flexShrink: 0,
          }}>
            {assigned.name}
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
              fontSize: 9, fontWeight: 600, cursor: "pointer",
              transition: "all 0.15s", flexShrink: 0,
            }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(59,130,246,0.2)"}
            onMouseLeave={e => e.currentTarget.style.background = "rgba(59,130,246,0.1)"}
          >
            <ArrowRight style={{ width: 10, height: 10 }} />
            Chat
          </button>
        )}

        {task.result && (
          <button onClick={() => setExpanded(!expanded)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "2px", display: "flex", alignItems: "center" }}>
            {expanded ? <ChevronUp style={{ width: 13, height: 13 }} /> : <ChevronDown style={{ width: 13, height: 13 }} />}
          </button>
        )}

        {task.status === "queued" && (
          <select
            onChange={e => { if (e.target.value) onRun(task.id, e.target.value); e.target.value = ""; }}
            defaultValue=""
            style={{
              background: "var(--bg-surface)", border: "1px solid var(--border)",
              borderRadius: 6, padding: "3px 6px", fontSize: 10,
              color: "var(--text-secondary)", cursor: "pointer", outline: "none",
            }}
          >
            <option value="" disabled>Assign...</option>
            {agents.filter(a => a.status === "idle").map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
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
            whiteSpace: "pre-wrap", wordBreak: "break-word",
            maxHeight: 300, overflowY: "auto",
          }}>
            {task.result}
          </div>
        </div>
      )}
    </div>
  );
}
