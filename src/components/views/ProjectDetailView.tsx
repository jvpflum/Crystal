import React, { useEffect, useState } from "react";
import {
  ArrowLeft, Target, Flag, CheckCircle2, Circle, Plus, Archive, Loader2,
  Brain, AlertTriangle, ArrowRight, HelpCircle, Server,
} from "lucide-react";
import { useOsStore } from "@/stores/osStore";
import type { OsProject, OsProjectState, OsExecutionRun } from "@/lib/openclaw";
import {
  EASE, glowCard, badge, inputStyle, btnPrimary, btnSecondary, sectionLabel, MONO,
} from "@/styles/viewStyles";

const STATUS_COLOR: Record<string, string> = {
  active: "#4ade80",
  planning: "#60a5fa",
  paused: "#fbbf24",
  completed: "#a78bfa",
  archived: "#94a3b8",
};

export function ProjectDetailView({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const project = useOsStore(s => s.projects.find(p => p.id === projectId));
  const projectState = useOsStore(s => s.projectState[projectId]);
  const runs = useOsStore(s => s.runs);
  const loadRuns = useOsStore(s => s.loadRuns);
  const loadProjectDetail = useOsStore(s => s.loadProjectDetail);
  const loadProjectState = useOsStore(s => s.loadProjectState);
  const archiveProject = useOsStore(s => s.archiveProject);
  const addMilestone = useOsStore(s => s.addMilestone);
  const completeMilestone = useOsStore(s => s.completeMilestone);
  const addGoal = useOsStore(s => s.addGoal);

  const [loaded, setLoaded] = useState(false);
  const [newGoal, setNewGoal] = useState("");
  const [newMilestone, setNewMilestone] = useState("");

  useEffect(() => {
    (async () => {
      await Promise.allSettled([loadProjectDetail(projectId), loadProjectState(projectId), loadRuns({ limit: 50 })]);
      setLoaded(true);
    })();
  }, [projectId, loadProjectDetail, loadProjectState, loadRuns]);

  if (!project && !loaded) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)" }}>
        <Loader2 style={{ width: 18, height: 18, animation: "spin 1s linear infinite" }} />
      </div>
    );
  }

  if (!project) {
    return (
      <div style={{ padding: 24 }}>
        <button onClick={onBack} style={backBtn}><ArrowLeft style={{ width: 13, height: 13 }} /> Back</button>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 16 }}>Project not found.</p>
      </div>
    );
  }

  const color = STATUS_COLOR[project.status] ?? "var(--accent)";
  const goals = project.goals ?? [];
  const milestones = project.milestones ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "14px 24px 12px", flexShrink: 0, borderBottom: "1px solid var(--border)" }}>
        <button onClick={onBack} style={backBtn}><ArrowLeft style={{ width: 13, height: 13 }} /> Projects</button>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginTop: 12, gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", margin: 0, letterSpacing: "-0.02em" }}>{project.name}</h1>
              <span style={badge(color)}>{project.status}</span>
            </div>
            {project.description && (
              <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "8px 0 0", lineHeight: 1.5, maxWidth: 640 }}>{project.description}</p>
            )}
          </div>
          {project.status !== "archived" && (
            <button onClick={() => archiveProject(projectId)} style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 6 }}>
              <Archive style={{ width: 13, height: 13 }} /> Archive
            </button>
          )}
        </div>
        <ProgressBar project={project} color={color} />
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px 28px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        {/* Goals */}
        <section>
          <div style={{ ...sectionLabel, display: "flex", alignItems: "center", gap: 6 }}>
            <Target style={{ width: 12, height: 12 }} /> Goals
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 8 }}>
            {goals.length === 0 && <Empty text="No goals yet." />}
            {goals.map(g => (
              <div key={g.id} style={{ ...glowCard("#60a5fa"), padding: "9px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                <Target style={{ width: 14, height: 14, color: "#60a5fa", flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: "var(--text)" }}>{g.text}</span>
              </div>
            ))}
          </div>
          <InlineAdd
            value={newGoal} onChange={setNewGoal} placeholder="Add a goal…"
            onSubmit={async () => { if (newGoal.trim()) { await addGoal(projectId, newGoal.trim()); setNewGoal(""); } }}
          />
        </section>

        {/* Milestones */}
        <section>
          <div style={{ ...sectionLabel, display: "flex", alignItems: "center", gap: 6 }}>
            <Flag style={{ width: 12, height: 12 }} /> Milestones
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 8 }}>
            {milestones.length === 0 && <Empty text="No milestones yet." />}
            {milestones.map(m => (
              <div key={m.id} style={{ ...glowCard("#c084fc"), padding: "9px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  onClick={() => m.status !== "completed" && completeMilestone(projectId, m.id)}
                  style={{ background: "transparent", border: "none", cursor: m.status === "completed" ? "default" : "pointer", padding: 0, display: "flex" }}
                  title={m.status === "completed" ? "Completed" : "Mark complete"}
                >
                  {m.status === "completed"
                    ? <CheckCircle2 style={{ width: 14, height: 14, color: "#4ade80" }} />
                    : <Circle style={{ width: 14, height: 14, color: "var(--text-muted)" }} />}
                </button>
                <span style={{ fontSize: 12, color: "var(--text)", flex: 1 }}>{m.title}</span>
                {m.dueDate && <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: MONO }}>{formatDate(m.dueDate)}</span>}
              </div>
            ))}
          </div>
          <InlineAdd
            value={newMilestone} onChange={setNewMilestone} placeholder="Add a milestone…"
            onSubmit={async () => { if (newMilestone.trim()) { await addMilestone(projectId, newMilestone.trim()); setNewMilestone(""); } }}
          />
        </section>

        {/* Operating memory (project_state working-memory tier) */}
        <section style={{ gridColumn: "1 / -1" }}>
          <OperatingState state={projectState} />
        </section>

        {/* Execution activity (task_execution_history / runs) */}
        <section style={{ gridColumn: "1 / -1" }}>
          <ExecutionActivity runs={runs} activeTaskIds={projectState?.activeTaskIds ?? []} />
        </section>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ExecutionActivity({ runs, activeTaskIds }: { runs: OsExecutionRun[]; activeTaskIds: string[] }) {
  const scoped = activeTaskIds.length > 0
    ? runs.filter(r => r.taskId && activeTaskIds.includes(r.taskId))
    : runs.slice(0, 8);
  const statusColor: Record<string, string> = {
    queued: "#94a3b8", running: "#60a5fa", succeeded: "#4ade80", failed: "#f87171", cancelled: "#fbbf24",
  };
  return (
    <div>
      <div style={{ ...sectionLabel, display: "flex", alignItems: "center", gap: 6 }}>
        <Server style={{ width: 12, height: 12 }} /> Execution Activity
        <span style={{ fontSize: 9, fontWeight: 500, color: "var(--text-muted)", textTransform: "none", letterSpacing: 0 }}>
          {activeTaskIds.length > 0 ? "(active tasks)" : "(recent runs)"}
        </span>
      </div>
      {scoped.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--text-muted)", opacity: 0.6, padding: "8px 2px", marginTop: 8 }}>
          No execution runs yet. Dispatch work via <code style={{ fontFamily: MONO }}>os exec dispatch</code> or run the PEVIC loop with <code style={{ fontFamily: MONO }}>os pevic run</code>.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          {scoped.map(r => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderRadius: 8, background: "var(--bg-card)", border: "1px solid var(--border)" }}>
              <span style={badge(statusColor[r.status] ?? "#94a3b8")}>{r.status}</span>
              <span style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: MONO, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.id}{r.taskId ? `  ·  task ${r.taskId}` : ""}
              </span>
              {r.targetId && <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: MONO }}>{r.targetId}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OperatingState({ state }: { state: OsProjectState | undefined }) {
  const blockers = state?.blockers ?? [];
  const nextActions = state?.nextActions ?? [];
  const openQuestions = state?.openQuestions ?? [];
  const empty = blockers.length === 0 && nextActions.length === 0 && openQuestions.length === 0;
  return (
    <div>
      <div style={{ ...sectionLabel, display: "flex", alignItems: "center", gap: 6 }}>
        <Brain style={{ width: 12, height: 12 }} /> Operating State
        {state && (
          <span style={{ fontSize: 9, fontWeight: 500, color: "var(--text-muted)", textTransform: "none", letterSpacing: 0 }}>
            {state.derived ? "(derived from tasks)" : "(persisted)"}
          </span>
        )}
      </div>
      {empty ? (
        <div style={{ fontSize: 11, color: "var(--text-muted)", opacity: 0.6, padding: "8px 2px", marginTop: 8 }}>
          No operating state yet. Agents write blockers / next actions / open questions via <code style={{ fontFamily: MONO }}>os projects state set</code>.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 8 }}>
          <StateColumn icon={AlertTriangle} color="#f87171" label="Blockers" items={blockers} />
          <StateColumn icon={ArrowRight} color="#4ade80" label="Next Actions" items={nextActions} />
          <StateColumn icon={HelpCircle} color="#fbbf24" label="Open Questions" items={openQuestions} />
        </div>
      )}
    </div>
  );
}

function StateColumn({ icon: Icon, color, label, items }: {
  icon: React.ElementType; color: string; label: string; items: string[];
}) {
  return (
    <div style={{ ...glowCard(color), padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <Icon style={{ width: 13, height: 13, color }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>{label}</span>
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)", opacity: 0.6 }}>None</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 3 }}>
          {items.map((it, i) => (
            <li key={i} style={{ fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.4 }}>{it}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProgressBar({ project, color }: { project: OsProject; color: string }) {
  const total = project.taskCount ?? 0;
  if (total === 0) return null;
  const open = project.openTaskCount ?? 0;
  const done = Math.max(0, total - open);
  const pct = Math.round((done / total) * 100);
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{done} of {total} tasks done</span>
        <span style={{ fontSize: 10, color, fontWeight: 600 }}>{pct}%</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: `width 0.4s ${EASE}` }} />
      </div>
    </div>
  );
}

function InlineAdd({ value, onChange, placeholder, onSubmit }: {
  value: string; onChange: (v: string) => void; placeholder: string; onSubmit: () => void | Promise<void>;
}) {
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") void onSubmit(); }}
        placeholder={placeholder}
        style={{ ...inputStyle, fontSize: 12, padding: "7px 10px" }}
      />
      <button onClick={() => void onSubmit()} style={{ ...btnPrimary, padding: "0 12px", display: "flex", alignItems: "center" }}>
        <Plus style={{ width: 14, height: 14 }} />
      </button>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ fontSize: 11, color: "var(--text-muted)", opacity: 0.6, padding: "8px 2px" }}>{text}</div>;
}

const backBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 5, background: "transparent",
  border: "none", color: "var(--text-muted)", fontSize: 11, cursor: "pointer", padding: 0,
};

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" }); }
  catch { return iso; }
}
