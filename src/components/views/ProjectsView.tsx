import { useEffect, useState } from "react";
import {
  FolderKanban, Plus, RefreshCw, AlertTriangle, Power, ChevronRight, X,
} from "lucide-react";
import { useOsStore } from "@/stores/osStore";
import type { OsProject, OsProjectStatus } from "@/lib/openclaw";
import { ProjectDetailView } from "./ProjectDetailView";
import {
  EASE, glowCard, badge, emptyState, inputStyle, btnPrimary, btnSecondary,
  hoverLift, hoverReset, MONO,
} from "@/styles/viewStyles";

const STATUS_COLOR: Record<OsProjectStatus, string> = {
  active: "#4ade80",
  paused: "#fbbf24",
  completed: "#a78bfa",
  archived: "#94a3b8",
};

const STATUSES: OsProjectStatus[] = ["active", "paused", "completed", "archived"];

export function ProjectsView() {
  const projects = useOsStore(s => s.projects);
  const loading = useOsStore(s => s.loadingProjects);
  const error = useOsStore(s => s.error);
  const unavailable = useOsStore(s => s.unavailable);
  const loadProjects = useOsStore(s => s.loadProjects);
  const createProject = useOsStore(s => s.createProject);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [goalsText, setGoalsText] = useState("");

  useEffect(() => { loadProjects(); }, [loadProjects]);

  if (selectedId) {
    return <ProjectDetailView projectId={selectedId} onBack={() => setSelectedId(null)} />;
  }

  const submit = async () => {
    if (!name.trim()) return;
    const goals = goalsText.split("\n").map(g => g.trim()).filter(Boolean);
    const created = await createProject({
      name: name.trim(),
      description: description.trim() || null,
      goals: goals.length ? goals : undefined,
    });
    if (created) {
      setName(""); setDescription(""); setGoalsText(""); setShowForm(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "14px 24px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <FolderKanban style={{ width: 18, height: 18, color: "var(--accent)" }} />
            <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Projects</h2>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{projects.length}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => loadProjects({ force: true })} disabled={loading}
              style={{ display: "flex", alignItems: "center", padding: "7px 9px", borderRadius: 8, border: "none", background: "var(--bg-hover)", color: "var(--text-muted)", cursor: "pointer" }}>
              <RefreshCw style={{ width: 13, height: 13, ...(loading ? { animation: "spin 1s linear infinite" } : {}) }} />
            </button>
            <button onClick={() => setShowForm(v => !v)}
              style={{ ...btnPrimary, display: "flex", alignItems: "center", gap: 6 }}>
              {showForm ? <X style={{ width: 14, height: 14 }} /> : <Plus style={{ width: 14, height: 14 }} />}
              {showForm ? "Cancel" : "New Project"}
            </button>
          </div>
        </div>

        {error && !unavailable && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", marginTop: 10, borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)" }}>
            <AlertTriangle style={{ width: 13, height: 13, color: "#f87171" }} />
            <span style={{ fontSize: 11, color: "#f87171" }}>{error}</span>
          </div>
        )}
      </div>

      {showForm && (
        <div style={{ padding: "0 24px 12px", flexShrink: 0 }}>
          <div style={{ ...glowCard("var(--accent)"), padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Project name"
              style={{ ...inputStyle, fontSize: 13 }} autoFocus
              onKeyDown={e => { if (e.key === "Enter") void submit(); }} />
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)"
              style={{ ...inputStyle, fontSize: 12 }} />
            <textarea value={goalsText} onChange={e => setGoalsText(e.target.value)} placeholder="Goals — one per line (optional)"
              rows={3} style={{ ...inputStyle, fontSize: 12, resize: "vertical" }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setShowForm(false)} style={btnSecondary}>Cancel</button>
              <button onClick={() => void submit()} disabled={!name.trim()}
                style={{ ...btnPrimary, opacity: name.trim() ? 1 : 0.5 }}>Create</button>
            </div>
          </div>
        </div>
      )}

      {unavailable ? (
        <PluginDisabledNotice />
      ) : (
        <div style={{ flex: 1, overflowY: "auto", padding: "0 24px 24px" }}>
          {projects.length === 0 && !loading && (
            <div style={emptyState}>
              <FolderKanban style={{ width: 30, height: 30, opacity: 0.5 }} />
              <p style={{ margin: 0, fontSize: 13 }}>No projects yet</p>
              <p style={{ margin: 0, fontSize: 11, opacity: 0.7 }}>Create one to start organizing tasks and milestones.</p>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
            {projects.map(p => (
              <ProjectCard key={p.id} project={p} onClick={() => setSelectedId(p.id)} />
            ))}
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ProjectCard({ project, onClick }: { project: OsProject; onClick: () => void }) {
  const color = STATUS_COLOR[project.status] ?? "var(--accent)";
  const total = project.taskCount ?? 0;
  const open = project.openTaskCount ?? 0;
  const done = Math.max(0, total - open);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div
      data-glow={color}
      onClick={onClick}
      onMouseEnter={hoverLift}
      onMouseLeave={hoverReset}
      style={{ ...glowCard(color), padding: 16, cursor: "pointer" }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", lineHeight: 1.3 }}>{project.name}</span>
        <ChevronRight style={{ width: 15, height: 15, color: "var(--text-muted)", flexShrink: 0 }} />
      </div>
      <div style={{ marginTop: 7 }}><span style={badge(color)}>{project.status}</span></div>
      {project.description && (
        <p style={{ fontSize: 11, color: "var(--text-secondary)", margin: "10px 0 0", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{project.description}</p>
      )}
      {total > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{done}/{total} done</span>
            <span style={{ fontSize: 10, color, fontWeight: 600, fontFamily: MONO }}>{pct}%</span>
          </div>
          <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: color, transition: `width 0.4s ${EASE}` }} />
          </div>
        </div>
      )}
    </div>
  );
}

function PluginDisabledNotice() {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ ...emptyState, maxWidth: 460 }}>
        <Power style={{ width: 32, height: 32, color: "var(--text-muted)" }} />
        <p style={{ fontSize: 13, color: "var(--text)", margin: 0, fontWeight: 600 }}>Crystal Data Science Workbench is not enabled</p>
        <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
          Enable the <code style={{ fontFamily: MONO }}>crystal-os</code> plugin in
          {" "}<code style={{ fontFamily: MONO }}>~/.openclaw/openclaw.json</code> under
          {" "}<code style={{ fontFamily: MONO }}>plugins.entries.crystal-os.enabled = true</code>.
        </p>
      </div>
    </div>
  );
}

// Referenced for the create form status dropdown in future phases.
export const PROJECT_STATUSES = STATUSES;
