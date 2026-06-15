import { useEffect, useMemo, useState } from "react";
import {
  KanbanSquare, RefreshCw, Plus, Search, AlertTriangle, Power, Server,
} from "lucide-react";
import { useOsStore } from "@/stores/osStore";
import type { OsTask, OsTaskStatus, OsTaskPriority } from "@/lib/openclaw";
import {
  EASE, glowCard, badge, emptyState, inputStyle, MONO,
} from "@/styles/viewStyles";

/** Board columns (Deliverable: Backlog/Todo/In Progress/Blocked/Review/Done). */
const COLUMNS: { status: OsTaskStatus; label: string; color: string }[] = [
  { status: "backlog", label: "Backlog", color: "#94a3b8" },
  { status: "todo", label: "Todo", color: "#60a5fa" },
  { status: "in_progress", label: "In Progress", color: "var(--accent)" },
  { status: "blocked", label: "Blocked", color: "#f87171" },
  { status: "review", label: "Review", color: "#c084fc" },
  { status: "completed", label: "Done", color: "#4ade80" },
];

const PRIORITY_COLOR: Record<OsTaskPriority, string> = {
  low: "#94a3b8",
  medium: "#60a5fa",
  high: "#fbbf24",
  urgent: "#f87171",
};

export function BoardView() {
  const tasks = useOsStore(s => s.tasks);
  const projects = useOsStore(s => s.projects);
  const loading = useOsStore(s => s.loadingTasks);
  const error = useOsStore(s => s.error);
  const unavailable = useOsStore(s => s.unavailable);
  const activeProjectId = useOsStore(s => s.activeProjectId);
  const searchQuery = useOsStore(s => s.searchQuery);
  const setActiveProject = useOsStore(s => s.setActiveProject);
  const setSearchQuery = useOsStore(s => s.setSearchQuery);
  const runs = useOsStore(s => s.runs);
  const loadTasks = useOsStore(s => s.loadTasks);
  const loadProjects = useOsStore(s => s.loadProjects);
  const loadRuns = useOsStore(s => s.loadRuns);
  const setTaskStatus = useOsStore(s => s.setTaskStatus);
  const createTask = useOsStore(s => s.createTask);

  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<OsTaskStatus | null>(null);
  const [composerCol, setComposerCol] = useState<OsTaskStatus | null>(null);
  const [composerTitle, setComposerTitle] = useState("");

  useEffect(() => {
    loadProjects();
    loadTasks();
    loadRuns({ limit: 100 });
  }, [loadProjects, loadTasks, loadRuns]);

  // Recent execution-run summary per task (count + most-recent status) so the
  // board surfaces task_execution_history without a per-card fetch.
  const runsByTask = useMemo(() => {
    const map = new Map<string, { count: number; lastStatus: string }>();
    for (const r of runs) {
      if (!r.taskId) continue;
      const existing = map.get(r.taskId);
      if (existing) existing.count += 1;
      else map.set(r.taskId, { count: 1, lastStatus: r.status });
    }
    return map;
  }, [runs]);

  // Debounced search re-query.
  useEffect(() => {
    const t = setTimeout(() => loadTasks(), 250);
    return () => clearTimeout(t);
  }, [searchQuery, loadTasks]);

  const grouped = useMemo(() => {
    const map: Record<OsTaskStatus, OsTask[]> = {
      backlog: [], todo: [], in_progress: [], blocked: [], review: [], completed: [], archived: [],
    };
    for (const t of tasks) (map[t.status] ?? map.backlog).push(t);
    return map;
  }, [tasks]);

  const onDrop = (status: OsTaskStatus) => {
    setDragOver(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const task = tasks.find(t => t.id === id);
    if (!task || task.status === status) return;
    void setTaskStatus(id, status);
  };

  const submitComposer = async (status: OsTaskStatus) => {
    const title = composerTitle.trim();
    if (!title) { setComposerCol(null); return; }
    await createTask({
      title,
      status,
      projectId: activeProjectId ?? null,
    });
    setComposerTitle("");
    setComposerCol(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "14px 20px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <KanbanSquare style={{ width: 18, height: 18, color: "var(--accent)" }} />
            <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Board</h2>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{tasks.length} task{tasks.length === 1 ? "" : "s"}</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <Search style={{ width: 12, height: 12, color: "var(--text-muted)", position: "absolute", left: 8 }} />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search tasks…"
                style={{ ...inputStyle, width: 180, padding: "6px 10px 6px 26px", fontSize: 12, borderRadius: 8 }}
              />
            </div>
            <select
              value={activeProjectId ?? ""}
              onChange={e => setActiveProject(e.target.value || null)}
              style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: 12, borderRadius: 8, cursor: "pointer" }}
            >
              <option value="">All projects</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button onClick={() => { loadTasks(undefined, { force: true }); loadProjects({ force: true }); loadRuns({ limit: 100 }, { force: true }); }} disabled={loading}
              style={{ display: "flex", alignItems: "center", padding: "6px 8px", borderRadius: 8, border: "none", background: "var(--bg-hover)", color: "var(--text-muted)", cursor: "pointer" }}>
              <RefreshCw style={{ width: 13, height: 13, ...(loading ? { animation: "spin 1s linear infinite" } : {}) }} />
            </button>
          </div>
        </div>

        {error && !unavailable && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)" }}>
            <AlertTriangle style={{ width: 13, height: 13, color: "#f87171" }} />
            <span style={{ fontSize: 11, color: "#f87171", flex: 1 }}>{error}</span>
          </div>
        )}
      </div>

      {unavailable ? (
        <PluginDisabledNotice />
      ) : (
        <div style={{ flex: 1, display: "flex", gap: 12, padding: "0 20px 20px", overflowX: "auto", overflowY: "hidden" }}>
          {COLUMNS.map(col => {
            const items = grouped[col.status] ?? [];
            const isOver = dragOver === col.status;
            return (
              <div
                key={col.status}
                onDragOver={e => { e.preventDefault(); setDragOver(col.status); }}
                onDragLeave={() => setDragOver(prev => (prev === col.status ? null : prev))}
                onDrop={() => onDrop(col.status)}
                style={{
                  display: "flex", flexDirection: "column", width: 264, flexShrink: 0,
                  background: isOver ? `color-mix(in srgb, ${col.color} 8%, transparent)` : "rgba(255,255,255,0.012)",
                  border: `1px solid ${isOver ? `color-mix(in srgb, ${col.color} 35%, transparent)` : "rgba(255,255,255,0.05)"}`,
                  borderRadius: 14, transition: `all 0.2s ${EASE}`, minHeight: 0,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px 8px", flexShrink: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: col.color }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{col.label}</span>
                    <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{items.length}</span>
                  </div>
                  <button onClick={() => { setComposerCol(col.status); setComposerTitle(""); }}
                    title="Add task" style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex", padding: 2 }}>
                    <Plus style={{ width: 14, height: 14 }} />
                  </button>
                </div>

                <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 10px", display: "flex", flexDirection: "column", gap: 7 }}>
                  {composerCol === col.status && (
                    <div style={{ ...glowCard(col.color), padding: 8 }}>
                      <textarea
                        autoFocus
                        value={composerTitle}
                        onChange={e => setComposerTitle(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submitComposer(col.status); }
                          if (e.key === "Escape") { setComposerCol(null); }
                        }}
                        onBlur={() => void submitComposer(col.status)}
                        placeholder="Task title…"
                        rows={2}
                        style={{ ...inputStyle, fontSize: 12, padding: 6, resize: "none" }}
                      />
                    </div>
                  )}

                  {items.map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      project={projects.find(p => p.id === task.projectId)?.name}
                      execRuns={runsByTask.get(task.id)}
                      onDragStart={() => setDragId(task.id)}
                      onDragEnd={() => { setDragId(null); setDragOver(null); }}
                    />
                  ))}

                  {items.length === 0 && composerCol !== col.status && (
                    <div style={{ padding: "16px 8px", textAlign: "center", fontSize: 10, color: "var(--text-muted)", opacity: 0.6 }}>
                      Drop tasks here
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const RUN_STATUS_COLOR: Record<string, string> = {
  queued: "#94a3b8", running: "#60a5fa", succeeded: "#4ade80", failed: "#f87171", cancelled: "#fbbf24",
};

function TaskCard({ task, project, execRuns, onDragStart, onDragEnd }: {
  task: OsTask; project?: string; execRuns?: { count: number; lastStatus: string }; onDragStart: () => void; onDragEnd: () => void;
}) {
  const pColor = PRIORITY_COLOR[task.priority];
  const blocked = task.blockedBy.length > 0;
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{
        ...glowCard(blocked ? "#f87171" : pColor),
        padding: "9px 11px", cursor: "grab", borderRadius: 11,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 6 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: pColor, marginTop: 5, flexShrink: 0 }} title={`priority: ${task.priority}`} />
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)", lineHeight: 1.35, flex: 1, wordBreak: "break-word" }}>{task.title}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
        {project && (
          <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 6, background: "var(--bg-hover)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>{project}</span>
        )}
        {task.tags.slice(0, 3).map(tag => (
          <span key={tag} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 6, background: "rgba(96,165,250,0.1)", color: "#93c5fd" }}>#{tag}</span>
        ))}
        {blocked && <span style={badge("#f87171")}>blocked ×{task.blockedBy.length}</span>}
        {execRuns && (
          <span title={`last run: ${execRuns.lastStatus}`}
            style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, padding: "1px 6px", borderRadius: 6, background: "var(--bg-hover)", color: RUN_STATUS_COLOR[execRuns.lastStatus] ?? "var(--text-muted)" }}>
            <Server style={{ width: 9, height: 9 }} /> {execRuns.count}
          </span>
        )}
        {task.dueDate && (
          <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: MONO }}>{formatDue(task.dueDate)}</span>
        )}
      </div>
    </div>
  );
}

function formatDue(iso: string): string {
  try { return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" }); }
  catch { return iso; }
}

function PluginDisabledNotice() {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ ...emptyState, maxWidth: 460 }}>
        <Power style={{ width: 32, height: 32, color: "var(--text-muted)" }} />
        <p style={{ fontSize: 13, color: "var(--text)", margin: 0, fontWeight: 600 }}>Crystal Data Science Workbench is not enabled</p>
        <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
          The <code style={{ fontFamily: MONO }}>crystal-os</code> plugin is opt-in. Enable it in
          {" "}<code style={{ fontFamily: MONO }}>~/.openclaw/openclaw.json</code>:
        </p>
        <pre style={{ margin: 0, fontSize: 10, fontFamily: MONO, color: "var(--text-secondary)", background: "rgba(255,255,255,0.03)", padding: "10px 14px", borderRadius: 8, textAlign: "left", whiteSpace: "pre-wrap" }}>
{`{
  "plugins": {
    "entries": { "crystal-os": { "enabled": true } }
  }
}`}
        </pre>
      </div>
    </div>
  );
}
