import { useState, useEffect, useRef, useCallback, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useFactoryStore, type AgentType, type AgentRun, type FactoryProject } from "@/stores/factoryStore";
import { factoryService } from "@/lib/factory";
import { RunWorkspace } from "@/components/factory/RunWorkspace";

/* ── Style Tokens ── */

const MONO: CSSProperties = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" };

const CARD: CSSProperties = {
  background: "var(--bg-elevated)", border: "1px solid var(--border)",
  borderRadius: 10, overflow: "hidden",
};

const BTN: CSSProperties = {
  padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 500,
  border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center",
  gap: 6, transition: "all .15s ease",
};

const BTN_PRIMARY: CSSProperties = { ...BTN, background: "var(--accent-bg)", color: "var(--accent)" };
const BTN_GHOST: CSSProperties = { ...BTN, background: "transparent", color: "var(--text-muted)" };
const BTN_DANGER: CSSProperties = { ...BTN, background: "rgba(239,68,68,0.1)", color: "#ef4444" };

const INPUT: CSSProperties = {
  background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6,
  padding: "8px 12px", color: "var(--text)", fontSize: 12, outline: "none", width: "100%",
  boxSizing: "border-box", ...MONO,
};

const LABEL: CSSProperties = { fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 };

const AGENT_META: Record<AgentType, { label: string; color: string; icon: string; desc: string }> = {
  "claude-code":  { label: "Claude Code",  color: "#d4a574", icon: "C", desc: "Anthropic's coding agent" },
  "cortex":       { label: "Cortex",       color: "#8b5cf6", icon: "X", desc: "OpenClaw multi-tool agent" },
};

const STATUS_COLORS: Record<string, string> = {
  queued: "var(--text-muted)",
  running: "var(--accent)",
  completed: "var(--success)",
  failed: "var(--error)",
  cancelled: "var(--text-muted)",
};

/* ── Helpers ── */

function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function IconPlus() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
}
function IconPlay() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21" /></svg>;
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

/* ── Main Component ── */

export function FactoryView() {
  const {
    projects, runs, selectedProjectId,
    addProject, removeProject, selectProject, updateProject,
    addRun, updateRun, removeRun, clearCompletedRuns,
  } = useFactoryStore();

  const [showNewProject, setShowNewProject] = useState(false);
  const [focusedRunId, setFocusedRunId] = useState<string | null>(null);
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const projectRuns = runs.filter((r) => r.projectId === selectedProjectId);
  const focusedRun = focusedRunId ? runs.find((r) => r.id === focusedRunId) ?? null : null;
  const focusedProject = focusedRun ? projects.find((p) => p.id === focusedRun.projectId) ?? null : null;

  const activeRunCount = (pid: string) => runs.filter((r) => r.projectId === pid && r.status === "running").length;

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
          updateRun(runId, {
            output,
            status: exitCode === 0 ? "completed" : "failed",
            completedAt: Date.now(),
            error: exitCode !== 0 ? `Exited with code ${exitCode}` : undefined,
          });
        } else {
          updateRun(runId, { output });
        }
      }, handle.pid);
    } catch (err) {
      updateRun(runId, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        completedAt: Date.now(),
      });
    }
  }, [selectedProject, addRun, updateRun, updateProject]);

  const handleCancelRun = useCallback(async (run: AgentRun) => {
    if (run.pid) {
      await factoryService.cancelRun(run.pid);
    }
    factoryService.stopPolling(run.id);
    updateRun(run.id, { status: "cancelled", completedAt: Date.now() });
  }, [updateRun]);

  // Resume polling for any runs that were running when the app restarted
  useEffect(() => {
    for (const run of runs) {
      if (run.status === "running" && run.logFile) {
        factoryService.startPolling(run.id, run.logFile, (output, finished, exitCode) => {
          if (finished) {
            updateRun(run.id, {
              output,
              status: exitCode === 0 ? "completed" : "failed",
              completedAt: Date.now(),
            });
          } else {
            updateRun(run.id, { output });
          }
        }, run.pid);
      }
    }
    return () => {
      for (const run of runs) factoryService.stopPolling(run.id);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When focused on a workspace, render it full-screen instead of normal layout
  if (focusedRun && focusedProject) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        <style>{`@keyframes _spin { to { transform: rotate(360deg) } } @keyframes _pulse { 0%,100% { opacity:1 } 50% { opacity:.4 } }`}</style>
        <RunWorkspace
          run={focusedRun}
          project={focusedProject}
          onBack={() => setFocusedRunId(null)}
          onCancel={() => handleCancelRun(focusedRun)}
        />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <style>{`@keyframes _spin { to { transform: rotate(360deg) } } @keyframes _pulse { 0%,100% { opacity:1 } 50% { opacity:.4 } }`}</style>

      {/* Header */}
      <div style={{ padding: "18px 24px 8px", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2 style={{ color: "var(--text)", fontSize: 16, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>&#9881;</span> Software Factory
          </h2>
          <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "4px 0 0" }}>
            Autonomous agent workspace &middot; {projects.length} project{projects.length !== 1 ? "s" : ""} &middot; {runs.filter((r) => r.status === "running").length} running
          </p>
        </div>
        <button onClick={() => setShowNewProject(true)} style={BTN_PRIMARY}>
          <IconPlus /> New Project
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", padding: "8px 24px 24px", gap: 16 }}>

        {/* ── Project Sidebar ── */}
        <div style={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column", gap: 6, overflowY: "auto" }}>
          {projects.length === 0 && !showNewProject && (
            <div style={{ ...CARD, padding: 20, textAlign: "center" }}>
              <IconFolder />
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "8px 0 12px" }}>No projects yet</p>
              <button onClick={() => setShowNewProject(true)} style={BTN_PRIMARY}><IconPlus /> Create Project</button>
            </div>
          )}
          {projects.map((p) => {
            const active = p.id === selectedProjectId;
            const running = activeRunCount(p.id);
            return (
              <button
                key={p.id}
                onClick={() => { selectProject(p.id); setFocusedRunId(null); }}
                style={{
                  ...CARD, padding: "10px 12px", cursor: "pointer", textAlign: "left",
                  borderColor: active ? "var(--accent)" : "var(--border)",
                  background: active ? "var(--accent-bg)" : "var(--bg-elevated)",
                  transition: "all .15s ease",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: active ? "var(--accent)" : "var(--text)", marginBottom: 2 }}>
                  {p.name}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", ...MONO, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.path}
                </div>
                {p.techStack.length > 0 && (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                    {p.techStack.map((t) => (
                      <span key={t} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "var(--bg-surface)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>{t}</span>
                    ))}
                  </div>
                )}
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

        {/* ── Main Content ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", gap: 12 }}>
          {showNewProject && (
            <NewProjectForm
              onSubmit={(p) => { addProject(p); setShowNewProject(false); }}
              onCancel={() => setShowNewProject(false)}
            />
          )}

          {selectedProject ? (
            <>
              <ProjectHeader
                project={selectedProject}
                runCount={projectRuns.length}
                activeCount={activeRunCount(selectedProject.id)}
                onDelete={() => { removeProject(selectedProject.id); }}
              />
              <NewRunForm onSubmit={handleStartRun} />
              <RunsList
                runs={projectRuns}
                onCancel={handleCancelRun}
                onRemove={removeRun}
                onClearCompleted={() => clearCompletedRuns(selectedProject.id)}
                onOpenWorkspace={setFocusedRunId}
              />
            </>
          ) : !showNewProject ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ textAlign: "center", color: "var(--text-muted)" }}>
                <span style={{ fontSize: 32, display: "block", marginBottom: 8 }}>&#9881;</span>
                <p style={{ fontSize: 13, margin: 0 }}>Select a project or create a new one</p>
                <p style={{ fontSize: 11, margin: "6px 0 0" }}>Spin up autonomous agents to build software</p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ── Sub-Components ── */

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
        {project.description && (
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>{project.description}</div>
        )}
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
      const projectPath = result.stdout.trim();
      onSubmit({
        name: name.trim(),
        description: desc.trim(),
        path: projectPath,
        techStack: stack.split(",").map((s) => s.trim()).filter(Boolean),
      });
    } catch (err) {
      console.error("Failed to create project directory:", err);
    }
    setCreating(false);
  };

  return (
    <div style={{ ...CARD, padding: 16, flexShrink: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>New Project</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <span style={LABEL}>Project Name *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My App" style={INPUT} autoFocus onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }} />
        </div>
        <div>
          <span style={LABEL}>Folder</span>
          <div style={{ ...INPUT, background: "var(--bg-base)", color: "var(--text-muted)", fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
            <IconFolder />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              ~/Projects/{name.trim() ? slugify(name) : "..."}
            </span>
          </div>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <span style={LABEL}>Description</span>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="A React dashboard with auth..." style={INPUT} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <span style={LABEL}>Tech Stack (comma separated)</span>
          <input value={stack} onChange={(e) => setStack(e.target.value)} placeholder="react, typescript, tailwind" style={INPUT} />
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

  const handleSubmit = () => {
    if (!objective.trim()) return;
    onSubmit(agentType, objective.trim());
    setObjective("");
  };

  return (
    <div style={{ ...CARD, flexShrink: 0, overflow: "visible" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{ width: "100%", padding: "10px 16px", display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", color: "var(--text)" }}
      >
        <IconChevron open={expanded} />
        <span style={{ fontSize: 12, fontWeight: 600 }}>New Build</span>
        <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: "auto" }}>OpenClaw dispatches an agent to build</span>
      </button>

      {expanded && (
        <div style={{ padding: "0 16px 14px", borderTop: "1px solid var(--border)" }}>
          <div style={{ marginTop: 12 }}>
            <span style={LABEL}>OpenClaw will use</span>
            <div style={{ display: "flex", gap: 6 }}>
              {(Object.keys(AGENT_META) as AgentType[]).map((at) => {
                const m = AGENT_META[at];
                const sel = agentType === at;
                return (
                  <button key={at} onClick={() => setAgentType(at)} style={{
                    padding: "8px 16px", borderRadius: 8, fontSize: 11, fontWeight: 600,
                    cursor: "pointer", transition: "all .15s ease",
                    display: "flex", alignItems: "center", gap: 8, flex: 1,
                    border: sel ? `1.5px solid ${m.color}` : "1px solid var(--border)",
                    background: sel ? `${m.color}15` : "var(--bg-surface)",
                    color: sel ? m.color : "var(--text-muted)",
                  }}>
                    <span style={{ width: 22, height: 22, borderRadius: 5, background: sel ? m.color : "var(--border)", color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {m.icon}
                    </span>
                    <div style={{ textAlign: "left" }}>
                      <div>{m.label}</div>
                      <div style={{ fontSize: 9, fontWeight: 400, opacity: 0.7, marginTop: 1 }}>{m.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <span style={LABEL}>Objective</span>
            <textarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) handleSubmit(); }}
              placeholder={`Describe what to build — OpenClaw will dispatch ${AGENT_META[agentType].label} (Ctrl+Enter to start)`}
              rows={3}
              style={{ ...INPUT, resize: "vertical", lineHeight: 1.5, fontFamily: "inherit" }}
            />
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
            <button onClick={handleSubmit} disabled={!objective.trim()} style={{ ...BTN_PRIMARY, opacity: !objective.trim() ? 0.5 : 1, background: `${AGENT_META[agentType].color}20`, color: AGENT_META[agentType].color }}>
              <IconPlay /> Build with {AGENT_META[agentType].label}
            </button>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Ctrl+Enter</span>
          </div>
        </div>
      )}
    </div>
  );
}

function RunsList({ runs, onCancel, onRemove, onClearCompleted, onOpenWorkspace }: {
  runs: AgentRun[];
  onCancel: (run: AgentRun) => void;
  onRemove: (id: string) => void;
  onClearCompleted: () => void;
  onOpenWorkspace: (runId: string) => void;
}) {
  const hasCompleted = runs.some((r) => r.status !== "running" && r.status !== "queued");

  return (
    <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
      {runs.length > 0 && hasCompleted && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClearCompleted} style={{ ...BTN_GHOST, fontSize: 10 }}>Clear Completed</button>
        </div>
      )}
      {runs.length === 0 && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <p style={{ fontSize: 11, color: "var(--text-muted)" }}>No runs yet — dispatch an agent above</p>
        </div>
      )}
      {runs.map((run) => (
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
  const meta = AGENT_META[run.agentType];
  const isActive = run.status === "running" || run.status === "queued";

  // Timer for running tasks
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!isActive) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isActive]);

  // Auto-scroll output
  useEffect(() => {
    if (expanded && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [run.output, expanded]);

  const duration = run.startedAt
    ? elapsed((run.completedAt ?? now) - run.startedAt)
    : "—";

  return (
    <div style={{ ...CARD, borderColor: isActive ? meta.color + "40" : "var(--border)" }}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{ width: "100%", padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", color: "var(--text)" }}
      >
        <span style={{
          width: 20, height: 20, borderRadius: 5, fontSize: 9, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          background: meta.color, color: "#fff",
        }}>
          {meta.icon}
        </span>

        <div style={{ flex: 1, textAlign: "left" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>
            {meta.label}
            <span style={{ fontWeight: 400, color: "var(--text-secondary)", marginLeft: 8 }}>
              {run.objective.length > 80 ? run.objective.slice(0, 80) + "..." : run.objective}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)", ...MONO }}>{duration}</span>
          {run.status === "running" ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={meta.color} strokeWidth="2.5" strokeLinecap="round" style={{ animation: "_spin .8s linear infinite" }}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : (
            <span style={{
              width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
              background: STATUS_COLORS[run.status] ?? "var(--text-muted)",
            }} />
          )}
          <span style={{ fontSize: 10, color: run.status === "running" ? meta.color : STATUS_COLORS[run.status], textTransform: "capitalize" }}>
            {run.status === "running" ? "Building..." : run.status}
          </span>
          <IconChevron open={expanded} />
        </div>
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div style={{ borderTop: "1px solid var(--border)" }}>
          {run.error && (
            <div style={{ padding: "8px 14px", background: "rgba(239,68,68,0.06)", fontSize: 11, color: "#ef4444" }}>
              {run.error}
            </div>
          )}
          {isActive && !run.output && (
            <div style={{ padding: "14px", display: "flex", alignItems: "center", gap: 10, background: "var(--bg-base)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={meta.color} strokeWidth="2.5" strokeLinecap="round" style={{ animation: "_spin .8s linear infinite", flexShrink: 0 }}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              <div>
                <div style={{ fontSize: 11, color: "var(--text)", fontWeight: 500 }}>
                  {meta.label} is working... <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>({duration})</span>
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                  Output will stream here. Open the workspace for a full view.
                </div>
              </div>
            </div>
          )}
          {(run.output || !isActive) && (
            <pre
              ref={outputRef}
              style={{
                margin: 0, padding: "10px 14px", fontSize: 10, lineHeight: 1.6, ...MONO,
                color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word",
                maxHeight: 300, overflowY: "auto", background: "var(--bg-base)",
              }}
            >
              {run.output || "No output captured."}
            </pre>
          )}
          <div style={{ padding: "8px 14px", display: "flex", gap: 8, borderTop: "1px solid var(--border)" }}>
            <button onClick={onOpenWorkspace} style={BTN_PRIMARY}>
              <IconFolder /> Open Workspace
            </button>
            {isActive && (
              <button onClick={onCancel} style={BTN_DANGER}><IconStop /> Cancel</button>
            )}
            {!isActive && (
              <button onClick={onRemove} style={BTN_GHOST}><IconTrash /> Remove</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
