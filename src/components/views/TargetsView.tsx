import { useEffect, useState } from "react";
import {
  Server, Plus, RefreshCw, AlertTriangle, Power, X, Activity, Cpu, Cloud, Monitor, HardDrive,
} from "lucide-react";
import { useOsStore } from "@/stores/osStore";
import type { OsExecutionTarget, OsExecutionRun, OsTargetKind } from "@/lib/openclaw";
import {
  glowCard, badge, emptyState, inputStyle, btnPrimary, btnSecondary, sectionLabel, MONO,
} from "@/styles/viewStyles";

const KIND_META: Record<OsTargetKind, { label: string; icon: typeof Server; color: string }> = {
  local_desktop: { label: "Local Desktop", icon: Monitor, color: "#4ade80" },
  secondary_desktop: { label: "Secondary Desktop", icon: HardDrive, color: "#60a5fa" },
  cloud_gpu: { label: "Cloud GPU", icon: Cloud, color: "#c084fc" },
  future_dgx: { label: "Future DGX", icon: Cpu, color: "#fbbf24" },
};

const STATUS_COLOR: Record<string, string> = {
  online: "#4ade80",
  offline: "#f87171",
  degraded: "#fbbf24",
  unknown: "#94a3b8",
};

/** Crystal OS Execution Targets — where work runs + recent runs (Phase 3). */
export function TargetsView() {
  const targets = useOsStore(s => s.targets);
  const runs = useOsStore(s => s.runs);
  const loading = useOsStore(s => s.loadingTargets);
  const error = useOsStore(s => s.error);
  const unavailable = useOsStore(s => s.unavailable);
  const loadTargets = useOsStore(s => s.loadTargets);
  const loadRuns = useOsStore(s => s.loadRuns);
  const registerTarget = useOsStore(s => s.registerTarget);
  const healthCheckTargets = useOsStore(s => s.healthCheckTargets);
  const cancelRun = useOsStore(s => s.cancelRun);

  const [showForm, setShowForm] = useState(false);
  const [kind, setKind] = useState<OsTargetKind>("secondary_desktop");
  const [label, setLabel] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [capabilities, setCapabilities] = useState("");

  useEffect(() => { loadTargets(); loadRuns({ limit: 25 }); }, [loadTargets, loadRuns]);

  const submit = async () => {
    const created = await registerTarget({
      kind,
      label: label.trim() || null,
      endpoint: endpoint.trim() || null,
      capabilities: capabilities.split(",").map(c => c.trim()).filter(Boolean),
    });
    if (created) {
      setLabel(""); setEndpoint(""); setCapabilities(""); setShowForm(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "14px 24px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Server style={{ width: 18, height: 18, color: "var(--accent)" }} />
            <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Execution Targets</h2>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{targets.length}</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={() => void healthCheckTargets()} disabled={loading}
              style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 6 }}>
              <Activity style={{ width: 13, height: 13 }} /> Health
            </button>
            <button onClick={() => { loadTargets({ force: true }); loadRuns({ limit: 25 }, { force: true }); }} disabled={loading}
              style={{ display: "flex", alignItems: "center", padding: "7px 9px", borderRadius: 8, border: "none", background: "var(--bg-hover)", color: "var(--text-muted)", cursor: "pointer" }}>
              <RefreshCw style={{ width: 13, height: 13, ...(loading ? { animation: "spin 1s linear infinite" } : {}) }} />
            </button>
            <button onClick={() => setShowForm(v => !v)} style={{ ...btnPrimary, display: "flex", alignItems: "center", gap: 6 }}>
              {showForm ? <X style={{ width: 14, height: 14 }} /> : <Plus style={{ width: 14, height: 14 }} />}
              {showForm ? "Cancel" : "Register"}
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
            <select value={kind} onChange={e => setKind(e.target.value as OsTargetKind)}
              style={{ ...inputStyle, fontSize: 12, padding: "7px 10px", cursor: "pointer" }}>
              {Object.entries(KIND_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label (e.g. Studio GPU box)" style={{ ...inputStyle, fontSize: 13 }} autoFocus />
            <input value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="Endpoint (host / url) — remote targets" style={{ ...inputStyle, fontSize: 12 }} />
            <input value={capabilities} onChange={e => setCapabilities(e.target.value)} placeholder="Capabilities (comma-separated, e.g. gpu,cuda,vram48)" style={{ ...inputStyle, fontSize: 12 }} />
            <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)" }}>
              Remote adapters (secondary desktop / cloud GPU / DGX) are Phase-5 stubs; dispatch safely falls back to the local desktop.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setShowForm(false)} style={btnSecondary}>Cancel</button>
              <button onClick={() => void submit()} style={btnPrimary}>Register Target</button>
            </div>
          </div>
        </div>
      )}

      {unavailable ? (
        <PluginDisabledNotice />
      ) : (
        <div style={{ flex: 1, overflowY: "auto", padding: "0 24px 24px" }}>
          {targets.length === 0 && !loading && (
            <div style={emptyState}>
              <Server style={{ width: 30, height: 30, opacity: 0.5 }} />
              <p style={{ margin: 0, fontSize: 13 }}>No targets yet</p>
              <p style={{ margin: 0, fontSize: 11, opacity: 0.7 }}>A local desktop target is auto-registered on first use.</p>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
            {targets.map(t => <TargetCard key={t.id} target={t} />)}
          </div>

          {runs.length > 0 && (
            <div style={{ marginTop: 22 }}>
              <div style={{ ...sectionLabel, marginBottom: 8 }}>Recent Runs</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {runs.map(r => <RunRow key={r.id} run={r} onCancel={() => void cancelRun(r.id)} />)}
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function TargetCard({ target }: { target: OsExecutionTarget }) {
  const meta = KIND_META[target.kind] ?? KIND_META.local_desktop;
  const Icon = meta.icon;
  return (
    <div style={{ ...glowCard(meta.color), padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon style={{ width: 16, height: 16, color: meta.color }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{target.label ?? meta.label}</span>
        </div>
        <span style={{ ...badge(STATUS_COLOR[target.status] ?? "#94a3b8"), display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS_COLOR[target.status] ?? "#94a3b8" }} />
          {target.status}
        </span>
      </div>
      <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: MONO, marginBottom: 6 }}>{meta.label}</div>
      {target.endpoint && (
        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 6, wordBreak: "break-all" }}>{target.endpoint}</div>
      )}
      {target.capabilities.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {target.capabilities.map(c => (
            <span key={c} style={{ fontSize: 9, padding: "2px 6px", borderRadius: 5, background: "var(--bg-hover)", color: "var(--text-muted)", fontFamily: MONO }}>{c}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function RunRow({ run, onCancel }: { run: OsExecutionRun; onCancel: () => void }) {
  const active = run.status === "queued" || run.status === "running";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, background: "var(--bg-card)", border: "1px solid var(--border)" }}>
      <span style={{ ...badge(RUN_STATUS_COLOR[run.status] ?? "#94a3b8") }}>{run.status}</span>
      <span style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: MONO, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {run.id}{run.taskId ? `  ·  task ${run.taskId}` : ""}
      </span>
      {run.targetId && <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: MONO }}>{run.targetId}</span>}
      {active && (
        <button onClick={onCancel} style={{ ...btnSecondary, padding: "3px 8px", fontSize: 11 }}>Cancel</button>
      )}
    </div>
  );
}

const RUN_STATUS_COLOR: Record<string, string> = {
  queued: "#94a3b8",
  running: "#60a5fa",
  succeeded: "#4ade80",
  failed: "#f87171",
  cancelled: "#fbbf24",
};

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
