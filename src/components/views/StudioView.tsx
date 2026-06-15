import { useEffect, useState } from "react";
import {
  FlaskConical, RefreshCw, AlertTriangle, Power, Play, X, Check, Loader2, BarChart3, FileSearch,
} from "lucide-react";
import { useOsStore } from "@/stores/osStore";
import { OS_STUDIO_STAGES, type OsStudioStage, type OsExecutionRun } from "@/lib/openclaw";
import {
  glowCard, badge, emptyState, inputStyle, btnPrimary, btnSecondary, sectionLabel, MONO,
} from "@/styles/viewStyles";

const STAGE_LABEL: Record<OsStudioStage, string> = {
  import: "Import", analyze: "Analyze", pii_scan: "PII Scan", split: "Split",
  format: "Format", tokenize: "Tokenize", train: "Train", evaluate: "Evaluate",
  benchmark: "Benchmark", package: "Package", deploy: "Deploy", report: "Report",
};

const RUN_STATUS_COLOR: Record<string, string> = {
  queued: "#94a3b8", running: "#60a5fa", succeeded: "#4ade80", failed: "#f87171", cancelled: "#fbbf24",
};

/**
 * Derive a stage index from a run. Prefers an explicit `stage`/`stages` field on
 * the sidecar result; otherwise approximates from status (succeeded = all done).
 */
function stageProgress(run: OsExecutionRun): { current: number; failed: boolean } {
  const result = run.result as Record<string, unknown> | null;
  const failed = run.status === "failed";
  if (run.status === "succeeded") return { current: OS_STUDIO_STAGES.length, failed: false };
  const stageName = result && typeof result.stage === "string" ? (result.stage as string) : null;
  if (stageName) {
    const idx = OS_STUDIO_STAGES.indexOf(stageName as OsStudioStage);
    if (idx >= 0) return { current: idx, failed };
  }
  const completed = result && Array.isArray(result.completed_stages) ? (result.completed_stages as unknown[]).length : 0;
  return { current: failed ? completed : Math.max(1, completed), failed };
}

/** Crystal OS — Fine-Tuning Studio (Phase 5). 12-stage pipeline over studio runs. */
export function StudioView() {
  const studioRuns = useOsStore(s => s.studioRuns);
  const loading = useOsStore(s => s.loadingStudio);
  const error = useOsStore(s => s.error);
  const unavailable = useOsStore(s => s.unavailable);
  const loadStudioRuns = useOsStore(s => s.loadStudioRuns);
  const analyzeDataset = useOsStore(s => s.analyzeDataset);
  const createStudioRun = useOsStore(s => s.createStudioRun);
  const refreshStudioRun = useOsStore(s => s.refreshStudioRun);

  const [showForm, setShowForm] = useState(false);
  const [dataset, setDataset] = useState("");
  const [baseModel, setBaseModel] = useState("");
  const [method, setMethod] = useState("qlora");
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => { loadStudioRuns(); }, [loadStudioRuns]);

  const selected = studioRuns.find(r => r.id === selectedId) ?? studioRuns[0] ?? null;

  const runAnalyze = async () => {
    if (!dataset.trim()) return;
    setBusy(true);
    const res = await analyzeDataset(dataset.trim());
    setBusy(false);
    setAnalysis(res ? JSON.stringify(res, null, 2) : "Analysis failed (is the sidecar running?)");
  };

  const submit = async () => {
    if (!dataset.trim() || !baseModel.trim()) return;
    setBusy(true);
    const run = await createStudioRun({ datasetPath: dataset.trim(), baseModel: baseModel.trim(), method });
    setBusy(false);
    if (run) { setSelectedId(run.id); setShowForm(false); setAnalysis(null); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "14px 24px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <FlaskConical style={{ width: 18, height: 18, color: "var(--accent)" }} />
            <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Fine-Tuning Studio</h2>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{studioRuns.length} runs</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={() => loadStudioRuns(undefined, { force: true })} disabled={loading}
              style={{ display: "flex", alignItems: "center", padding: "7px 9px", borderRadius: 8, border: "none", background: "var(--bg-hover)", color: "var(--text-muted)", cursor: "pointer" }}>
              <RefreshCw style={{ width: 13, height: 13, ...(loading ? { animation: "spin 1s linear infinite" } : {}) }} />
            </button>
            <button onClick={() => setShowForm(v => !v)} style={{ ...btnPrimary, display: "flex", alignItems: "center", gap: 6 }}>
              {showForm ? <X style={{ width: 14, height: 14 }} /> : <Play style={{ width: 14, height: 14 }} />}
              {showForm ? "Cancel" : "New Run"}
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
            <input value={dataset} onChange={e => setDataset(e.target.value)} placeholder="Dataset path (local file the sidecar can read)" style={{ ...inputStyle, fontSize: 13 }} autoFocus />
            <div style={{ display: "flex", gap: 8 }}>
              <input value={baseModel} onChange={e => setBaseModel(e.target.value)} placeholder="Base model (e.g. meta-llama/Llama-3.1-8B)" style={{ ...inputStyle, fontSize: 12 }} />
              <select value={method} onChange={e => setMethod(e.target.value)} style={{ ...inputStyle, width: 140, fontSize: 12, cursor: "pointer" }}>
                <option value="qlora">qlora</option>
                <option value="lora">lora</option>
                <option value="full">full</option>
              </select>
            </div>
            <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)" }}>
              Runs proxy to the crystal-gpu Fine-Tuning Studio. Each run is persisted as an execution_run and auto-records a Lesson on completion.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => void runAnalyze()} disabled={busy || !dataset.trim()} style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 6 }}>
                <FileSearch style={{ width: 13, height: 13 }} /> Analyze dataset
              </button>
              <button onClick={() => void submit()} disabled={busy || !dataset.trim() || !baseModel.trim()} style={btnPrimary}>
                {busy ? "Working…" : "Create Run"}
              </button>
            </div>
            {analysis && (
              <pre style={{ fontFamily: MONO, fontSize: 11, color: "var(--text-secondary)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: 10, overflowX: "auto", maxHeight: 180, margin: 0 }}>{analysis}</pre>
            )}
          </div>
        </div>
      )}

      {unavailable ? (
        <PluginDisabledNotice />
      ) : (
        <div style={{ flex: 1, overflowY: "auto", padding: "0 24px 24px", display: "flex", gap: 16 }}>
          <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={sectionLabel}>Runs</div>
            {studioRuns.length === 0 && !loading && (
              <div style={emptyState}>
                <FlaskConical style={{ width: 28, height: 28, opacity: 0.5 }} />
                <p style={{ margin: 0, fontSize: 12 }}>No studio runs yet</p>
              </div>
            )}
            {studioRuns.map(r => (
              <button key={r.id} onClick={() => setSelectedId(r.id)}
                style={{ ...glowCard(RUN_STATUS_COLOR[r.status] ?? "#94a3b8"), padding: 10, textAlign: "left", cursor: "pointer", border: selected?.id === r.id ? "1px solid var(--accent)" : "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontFamily: MONO, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.id}</span>
                  <span style={badge(RUN_STATUS_COLOR[r.status] ?? "#94a3b8")}>{r.status}</span>
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{r.submittedAt?.slice(0, 19).replace("T", " ") ?? ""}</div>
              </button>
            ))}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            {selected ? <RunDetail run={selected} onRefresh={() => void refreshStudioRun(selected.id)} /> : (
              <div style={emptyState}><p style={{ margin: 0, fontSize: 12 }}>Select a run to view the 12-stage pipeline.</p></div>
            )}
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function RunDetail({ run, onRefresh }: { run: OsExecutionRun; onRefresh: () => void }) {
  const { current, failed } = stageProgress(run);
  const benchmark = run.benchmark as Record<string, unknown> | null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={badge(RUN_STATUS_COLOR[run.status] ?? "#94a3b8")}>{run.status}</span>
          <span style={{ fontSize: 12, fontFamily: MONO, color: "var(--text-secondary)" }}>{run.id}</span>
          {run.externalRef && <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: MONO }}>ref {run.externalRef}</span>}
        </div>
        <button onClick={onRefresh} style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 6 }}>
          <RefreshCw style={{ width: 12, height: 12 }} /> Refresh
        </button>
      </div>

      <div>
        <div style={{ ...sectionLabel, marginBottom: 10 }}>Pipeline · 12 stages</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
          {OS_STUDIO_STAGES.map((stage, i) => {
            const done = i < current;
            const active = i === current && !failed && run.status !== "succeeded";
            const isFail = failed && i === current;
            const color = isFail ? "#f87171" : done ? "#4ade80" : active ? "#60a5fa" : "#475569";
            return (
              <div key={stage} style={{ ...glowCard(color), padding: "8px 10px", display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--border)", opacity: done || active || isFail ? 1 : 0.55 }}>
                <span style={{ width: 18, height: 18, borderRadius: "50%", background: `color-mix(in srgb, ${color} 18%, transparent)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {done ? <Check style={{ width: 11, height: 11, color }} />
                    : active ? <Loader2 style={{ width: 11, height: 11, color, animation: "spin 1s linear infinite" }} />
                    : isFail ? <X style={{ width: 11, height: 11, color }} />
                    : <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: MONO }}>{i + 1}</span>}
                </span>
                <span style={{ fontSize: 11, fontWeight: 500, color: done || active || isFail ? "var(--text)" : "var(--text-muted)" }}>{STAGE_LABEL[stage]}</span>
              </div>
            );
          })}
        </div>
      </div>

      {benchmark && Object.keys(benchmark).length > 0 && (
        <div>
          <div style={{ ...sectionLabel, marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
            <BarChart3 style={{ width: 11, height: 11 }} /> Benchmark
          </div>
          <pre style={{ fontFamily: MONO, fontSize: 11, color: "var(--text-secondary)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: 10, overflowX: "auto", maxHeight: 200, margin: 0 }}>
            {JSON.stringify(benchmark, null, 2)}
          </pre>
        </div>
      )}

      <div>
        <div style={{ ...sectionLabel, marginBottom: 6 }}>Result</div>
        <pre style={{ fontFamily: MONO, fontSize: 11, color: "var(--text-secondary)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: 10, overflowX: "auto", maxHeight: 260, margin: 0 }}>
          {JSON.stringify(run.result, null, 2)}
        </pre>
      </div>
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
          Enable the <code style={{ fontFamily: MONO }}>crystal-os</code> plugin and run the crystal-gpu sidecar to use the Fine-Tuning Studio.
        </p>
      </div>
    </div>
  );
}
