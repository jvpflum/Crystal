import { useEffect, useState, memo } from "react";
import {
  GraduationCap, Plus, RefreshCw, Search, AlertTriangle, Power, X,
} from "lucide-react";
import { useOsStore } from "@/stores/osStore";
import type { OsLesson } from "@/lib/openclaw";
import {
  glowCard, badge, emptyState, inputStyle, btnPrimary, btnSecondary, sectionLabel, MONO, lazyRow,
} from "@/styles/viewStyles";

/** Crystal OS Lessons — problem → solution → outcome knowledge base (Phase 2). */
export function LessonsView() {
  const lessons = useOsStore(s => s.lessons);
  const projects = useOsStore(s => s.projects);
  const loading = useOsStore(s => s.loadingLessons);
  const error = useOsStore(s => s.error);
  const unavailable = useOsStore(s => s.unavailable);
  const loadLessons = useOsStore(s => s.loadLessons);
  const searchLessons = useOsStore(s => s.searchLessons);
  const recordLesson = useOsStore(s => s.recordLesson);
  const loadProjects = useOsStore(s => s.loadProjects);

  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [problem, setProblem] = useState("");
  const [solution, setSolution] = useState("");
  const [outcome, setOutcome] = useState("");
  const [confidence, setConfidence] = useState("0.7");
  const [projectId, setProjectId] = useState("");
  const [tags, setTags] = useState("");

  useEffect(() => { loadLessons(); loadProjects(); }, [loadLessons, loadProjects]);

  useEffect(() => {
    const t = setTimeout(() => searchLessons(query), 250);
    return () => clearTimeout(t);
  }, [query, searchLessons]);

  const submit = async () => {
    if (!problem.trim() && !solution.trim() && !outcome.trim()) return;
    const created = await recordLesson({
      problem: problem.trim() || null,
      solution: solution.trim() || null,
      outcome: outcome.trim() || null,
      confidence: confidence ? Number(confidence) : null,
      projectId: projectId || null,
      tags: tags.split(",").map(t => t.trim()).filter(Boolean),
    });
    if (created) {
      setProblem(""); setSolution(""); setOutcome(""); setTags(""); setShowForm(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "14px 24px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <GraduationCap style={{ width: 18, height: 18, color: "var(--accent)" }} />
            <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Lessons</h2>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{lessons.length}</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <Search style={{ width: 12, height: 12, color: "var(--text-muted)", position: "absolute", left: 8 }} />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search lessons…"
                style={{ ...inputStyle, width: 180, padding: "6px 10px 6px 26px", fontSize: 12, borderRadius: 8 }} />
            </div>
            <button onClick={() => loadLessons(undefined, { force: true })} disabled={loading}
              style={{ display: "flex", alignItems: "center", padding: "7px 9px", borderRadius: 8, border: "none", background: "var(--bg-hover)", color: "var(--text-muted)", cursor: "pointer" }}>
              <RefreshCw style={{ width: 13, height: 13, ...(loading ? { animation: "spin 1s linear infinite" } : {}) }} />
            </button>
            <button onClick={() => setShowForm(v => !v)} style={{ ...btnPrimary, display: "flex", alignItems: "center", gap: 6 }}>
              {showForm ? <X style={{ width: 14, height: 14 }} /> : <Plus style={{ width: 14, height: 14 }} />}
              {showForm ? "Cancel" : "Record"}
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
            <textarea value={problem} onChange={e => setProblem(e.target.value)} placeholder="Problem — what went wrong?" rows={2}
              style={{ ...inputStyle, fontSize: 12, resize: "vertical" }} autoFocus />
            <textarea value={solution} onChange={e => setSolution(e.target.value)} placeholder="Solution — what resolved it?" rows={2}
              style={{ ...inputStyle, fontSize: 12, resize: "vertical" }} />
            <textarea value={outcome} onChange={e => setOutcome(e.target.value)} placeholder="Outcome — the result" rows={2}
              style={{ ...inputStyle, fontSize: 12, resize: "vertical" }} />
            <div style={{ display: "flex", gap: 8 }}>
              <select value={projectId} onChange={e => setProjectId(e.target.value)}
                style={{ ...inputStyle, fontSize: 12, padding: "7px 10px", cursor: "pointer" }}>
                <option value="">No project</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input value={confidence} onChange={e => setConfidence(e.target.value)} placeholder="Confidence 0..1" type="number" min={0} max={1} step={0.1}
                style={{ ...inputStyle, fontSize: 12, width: 130 }} />
            </div>
            <input value={tags} onChange={e => setTags(e.target.value)} placeholder="Tags (comma-separated)"
              style={{ ...inputStyle, fontSize: 12 }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setShowForm(false)} style={btnSecondary}>Cancel</button>
              <button onClick={() => void submit()} style={btnPrimary}>Record Lesson</button>
            </div>
          </div>
        </div>
      )}

      {unavailable ? (
        <PluginDisabledNotice />
      ) : (
        <div style={{ flex: 1, overflowY: "auto", padding: "0 24px 24px" }}>
          {lessons.length === 0 && !loading && (
            <div style={emptyState}>
              <GraduationCap style={{ width: 30, height: 30, opacity: 0.5 }} />
              <p style={{ margin: 0, fontSize: 13 }}>No lessons yet</p>
              <p style={{ margin: 0, fontSize: 11, opacity: 0.7 }}>Record problem → solution → outcome so agents can consult them before acting.</p>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {lessons.map(l => <LessonCard key={l.id} lesson={l} project={projects.find(p => p.id === l.projectId)?.name} />)}
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const LessonCard = memo(function LessonCard({ lesson, project }: { lesson: OsLesson; project?: string }) {
  const conf = typeof lesson.confidence === "number" ? Math.round(lesson.confidence * 100) : null;
  const confColor = conf === null ? "#94a3b8" : conf >= 70 ? "#4ade80" : conf >= 40 ? "#fbbf24" : "#f87171";
  return (
    <div style={{ ...glowCard(confColor), padding: 14, ...lazyRow(160) }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {project && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 6, background: "var(--bg-hover)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>{project}</span>}
          {conf !== null && <span style={badge(confColor)}>{conf}% confidence</span>}
          {lesson.tags.map(t => (
            <span key={t} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 6, background: "rgba(96,165,250,0.1)", color: "#93c5fd" }}>#{t}</span>
          ))}
        </div>
        {lesson.date && <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: MONO }}>{formatDate(lesson.date)}</span>}
      </div>
      {lesson.problem && <Field label="Problem" value={lesson.problem} color="#f87171" />}
      {lesson.solution && <Field label="Solution" value={lesson.solution} color="#4ade80" />}
      {lesson.outcome && <Field label="Outcome" value={lesson.outcome} color="#60a5fa" />}
    </div>
  );
});

function Field({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ ...sectionLabel, color, marginBottom: 2 }}>{label}</div>
      <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>{value}</p>
    </div>
  );
}

function formatDate(iso: string): string {
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
          Enable the <code style={{ fontFamily: MONO }}>crystal-os</code> plugin in
          {" "}<code style={{ fontFamily: MONO }}>~/.openclaw/openclaw.json</code> under
          {" "}<code style={{ fontFamily: MONO }}>plugins.entries.crystal-os.enabled = true</code>.
        </p>
      </div>
    </div>
  );
}
