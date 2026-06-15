import { useEffect, useState, memo } from "react";
import {
  GitBranch, Plus, RefreshCw, Search, AlertTriangle, Power, X, CheckCircle2,
} from "lucide-react";
import { useOsStore } from "@/stores/osStore";
import type { OsDecision, OsDecisionOptionInput } from "@/lib/openclaw";
import {
  glowCard, badge, emptyState, inputStyle, btnPrimary, btnSecondary, sectionLabel, MONO, lazyRow,
} from "@/styles/viewStyles";

/** Crystal OS Decisions — ADR-style decision log (Phase 2). */
export function DecisionsView() {
  const decisions = useOsStore(s => s.decisions);
  const projects = useOsStore(s => s.projects);
  const loading = useOsStore(s => s.loadingDecisions);
  const error = useOsStore(s => s.error);
  const unavailable = useOsStore(s => s.unavailable);
  const loadDecisions = useOsStore(s => s.loadDecisions);
  const searchDecisions = useOsStore(s => s.searchDecisions);
  const createDecision = useOsStore(s => s.createDecision);
  const loadProjects = useOsStore(s => s.loadProjects);

  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [rationale, setRationale] = useState("");
  const [expected, setExpected] = useState("");
  const [projectId, setProjectId] = useState("");
  const [optionsText, setOptionsText] = useState("");
  const [chosenIdx, setChosenIdx] = useState(0);

  useEffect(() => { loadDecisions(); loadProjects(); }, [loadDecisions, loadProjects]);

  useEffect(() => {
    const t = setTimeout(() => searchDecisions(query), 250);
    return () => clearTimeout(t);
  }, [query, searchDecisions]);

  const optionLines = optionsText.split("\n").map(l => l.trim()).filter(Boolean);

  const submit = async () => {
    if (!title.trim() && !context.trim()) return;
    const options: OsDecisionOptionInput[] = optionLines.map((text, idx) => ({
      text,
      chosen: idx === chosenIdx,
    }));
    const created = await createDecision({
      title: title.trim() || null,
      context: context.trim() || null,
      rationale: rationale.trim() || null,
      expectedOutcome: expected.trim() || null,
      projectId: projectId || null,
      options,
      selectedIndex: options.length ? chosenIdx : null,
    });
    if (created) {
      setTitle(""); setContext(""); setRationale(""); setExpected(""); setOptionsText(""); setChosenIdx(0); setShowForm(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "14px 24px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <GitBranch style={{ width: 18, height: 18, color: "var(--accent)" }} />
            <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Decisions</h2>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{decisions.length}</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <Search style={{ width: 12, height: 12, color: "var(--text-muted)", position: "absolute", left: 8 }} />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search decisions…"
                style={{ ...inputStyle, width: 180, padding: "6px 10px 6px 26px", fontSize: 12, borderRadius: 8 }} />
            </div>
            <button onClick={() => loadDecisions(undefined, { force: true })} disabled={loading}
              style={{ display: "flex", alignItems: "center", padding: "7px 9px", borderRadius: 8, border: "none", background: "var(--bg-hover)", color: "var(--text-muted)", cursor: "pointer" }}>
              <RefreshCw style={{ width: 13, height: 13, ...(loading ? { animation: "spin 1s linear infinite" } : {}) }} />
            </button>
            <button onClick={() => setShowForm(v => !v)} style={{ ...btnPrimary, display: "flex", alignItems: "center", gap: 6 }}>
              {showForm ? <X style={{ width: 14, height: 14 }} /> : <Plus style={{ width: 14, height: 14 }} />}
              {showForm ? "Cancel" : "New"}
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
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Decision title" style={{ ...inputStyle, fontSize: 13 }} autoFocus />
            <textarea value={context} onChange={e => setContext(e.target.value)} placeholder="Context — why is a decision needed?" rows={2}
              style={{ ...inputStyle, fontSize: 12, resize: "vertical" }} />
            <textarea value={optionsText} onChange={e => setOptionsText(e.target.value)} placeholder="Options — one per line" rows={3}
              style={{ ...inputStyle, fontSize: 12, resize: "vertical" }} />
            {optionLines.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Chosen:</span>
                <select value={chosenIdx} onChange={e => setChosenIdx(Number(e.target.value))}
                  style={{ ...inputStyle, fontSize: 12, padding: "6px 10px", cursor: "pointer" }}>
                  {optionLines.map((l, i) => <option key={i} value={i}>{l.slice(0, 40)}</option>)}
                </select>
              </div>
            )}
            <textarea value={rationale} onChange={e => setRationale(e.target.value)} placeholder="Rationale for the chosen option" rows={2}
              style={{ ...inputStyle, fontSize: 12, resize: "vertical" }} />
            <input value={expected} onChange={e => setExpected(e.target.value)} placeholder="Expected outcome (optional)" style={{ ...inputStyle, fontSize: 12 }} />
            <select value={projectId} onChange={e => setProjectId(e.target.value)}
              style={{ ...inputStyle, fontSize: 12, padding: "7px 10px", cursor: "pointer" }}>
              <option value="">No project</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setShowForm(false)} style={btnSecondary}>Cancel</button>
              <button onClick={() => void submit()} style={btnPrimary}>Record Decision</button>
            </div>
          </div>
        </div>
      )}

      {unavailable ? (
        <PluginDisabledNotice />
      ) : (
        <div style={{ flex: 1, overflowY: "auto", padding: "0 24px 24px" }}>
          {decisions.length === 0 && !loading && (
            <div style={emptyState}>
              <GitBranch style={{ width: 30, height: 30, opacity: 0.5 }} />
              <p style={{ margin: 0, fontSize: 13 }}>No decisions yet</p>
              <p style={{ margin: 0, fontSize: 11, opacity: 0.7 }}>Record ADR-style decisions so agents can honor them before acting.</p>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {decisions.map(d => <DecisionCard key={d.id} decision={d} project={projects.find(p => p.id === d.projectId)?.name} />)}
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const DecisionCard = memo(function DecisionCard({ decision, project }: { decision: OsDecision; project?: string }) {
  const chosen = decision.options.find(o => o.chosen);
  return (
    <div style={{ ...glowCard("#c084fc"), padding: 14, ...lazyRow(180) }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{decision.title ?? "Decision"}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {project && <span style={badge("#c084fc")}>{project}</span>}
          {decision.date && <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: MONO }}>{formatDate(decision.date)}</span>}
        </div>
      </div>
      {decision.context && <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>{decision.context}</p>}
      {decision.options.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
          <div style={sectionLabel}>Options</div>
          {decision.options.map(o => (
            <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: o.chosen ? "var(--text)" : "var(--text-muted)" }}>
              {o.chosen ? <CheckCircle2 style={{ width: 13, height: 13, color: "#4ade80", flexShrink: 0 }} /> : <span style={{ width: 13, flexShrink: 0 }} />}
              <span>{o.text}</span>
            </div>
          ))}
        </div>
      )}
      {chosen && <Field label="Chosen" value={chosen.text ?? ""} color="#4ade80" />}
      {decision.rationale && <Field label="Rationale" value={decision.rationale} color="#60a5fa" />}
      {decision.expectedOutcome && <Field label="Expected" value={decision.expectedOutcome} color="#fbbf24" />}
    </div>
  );
});

function Field({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ marginTop: 4 }}>
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
