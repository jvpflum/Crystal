import { useEffect, useMemo, useState } from "react";
import {
  Sparkles, Search, RefreshCw, AlertTriangle, Power, DownloadCloud, Play, X, Cpu, Wrench, FlaskConical,
} from "lucide-react";
import { useOsStore } from "@/stores/osStore";
import {
  OS_SKILL_CATEGORIES, OS_SKILL_SOURCES,
  type OsSkill, type OsSkillCategory, type OsSkillSource, type OsSkillInvokeResult,
} from "@/lib/openclaw";
import {
  glowCard, badge, emptyState, inputStyle, btnPrimary, btnSecondary, sectionLabel, MONO,
} from "@/styles/viewStyles";

const SOURCE_COLOR: Record<OsSkillSource, string> = {
  nvidia: "#76b900",
  crystal: "#60a5fa",
  custom: "#c084fc",
};

const CATEGORY_COLOR: Record<string, string> = {
  data_science: "#38bdf8",
  training: "#fb923c",
  inference: "#a78bfa",
  evaluation: "#f472b6",
  research: "#34d399",
  automation: "#fbbf24",
  development: "#94a3b8",
};

/** Crystal OS — NVIDIA Skills Registry (Phase 4). Browse/search/import/invoke. */
export function SkillsRegistryView() {
  const skills = useOsStore(s => s.skills);
  const loading = useOsStore(s => s.loadingSkills);
  const error = useOsStore(s => s.error);
  const unavailable = useOsStore(s => s.unavailable);
  const loadSkills = useOsStore(s => s.loadSkills);
  const searchSkills = useOsStore(s => s.searchSkills);
  const importSkills = useOsStore(s => s.importSkills);

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<OsSkillCategory | "">("");
  const [sourceFilter, setSourceFilter] = useState<OsSkillSource | "">("");
  const [selected, setSelected] = useState<OsSkill | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  const filtered = useMemo(() => skills.filter(s =>
    (!categoryFilter || s.category === categoryFilter) &&
    (!sourceFilter || s.source === sourceFilter),
  ), [skills, categoryFilter, sourceFilter]);

  const runImport = async (source: "nvidia" | "crystal" | "all") => {
    setImportMsg(`Importing ${source}…`);
    const summaries = await importSkills(source);
    if (!summaries) { setImportMsg(null); return; }
    setImportMsg(
      summaries
        .map(s => `${s.source}: +${s.imported} ~${s.updated}${s.unavailable ? " (sidecar down)" : ""}`)
        .join("   ·   "),
    );
    setTimeout(() => setImportMsg(null), 6000);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "14px 24px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Sparkles style={{ width: 18, height: 18, color: "var(--accent)" }} />
            <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Skills Registry</h2>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{filtered.length}</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={() => void runImport("nvidia")} disabled={loading}
              style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 6 }} title="Fetch NVIDIA descriptors from the GPU sidecar">
              <DownloadCloud style={{ width: 13, height: 13 }} /> NVIDIA
            </button>
            <button onClick={() => void runImport("crystal")} disabled={loading}
              style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 6 }} title="Import OpenClaw SKILL.md skills">
              <DownloadCloud style={{ width: 13, height: 13 }} /> Crystal
            </button>
            <button onClick={() => void runImport("all")} disabled={loading}
              style={{ ...btnPrimary, display: "flex", alignItems: "center", gap: 6 }}>
              <DownloadCloud style={{ width: 14, height: 14 }} /> Import All
            </button>
            <button onClick={() => loadSkills(undefined, { force: true })} disabled={loading}
              style={{ display: "flex", alignItems: "center", padding: "7px 9px", borderRadius: 8, border: "none", background: "var(--bg-hover)", color: "var(--text-muted)", cursor: "pointer" }}>
              <RefreshCw style={{ width: 13, height: 13, ...(loading ? { animation: "spin 1s linear infinite" } : {}) }} />
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search style={{ width: 13, height: 13, color: "var(--text-muted)", position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void searchSkills(query); }}
              placeholder="Search skills by name / description…"
              style={{ ...inputStyle, fontSize: 12, paddingLeft: 30 }}
            />
          </div>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value as OsSkillCategory | "")}
            style={{ ...inputStyle, width: "auto", fontSize: 12, padding: "7px 10px", cursor: "pointer" }}>
            <option value="">All categories</option>
            {OS_SKILL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value as OsSkillSource | "")}
            style={{ ...inputStyle, width: "auto", fontSize: 12, padding: "7px 10px", cursor: "pointer" }}>
            <option value="">All sources</option>
            {OS_SKILL_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {importMsg && (
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 8, fontFamily: MONO }}>{importMsg}</div>
        )}
        {error && !unavailable && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", marginTop: 10, borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)" }}>
            <AlertTriangle style={{ width: 13, height: 13, color: "#f87171" }} />
            <span style={{ fontSize: 11, color: "#f87171" }}>{error}</span>
          </div>
        )}
      </div>

      {unavailable ? (
        <PluginDisabledNotice />
      ) : (
        <div style={{ flex: 1, overflowY: "auto", padding: "0 24px 24px" }}>
          {filtered.length === 0 && !loading && (
            <div style={emptyState}>
              <Sparkles style={{ width: 30, height: 30, opacity: 0.5 }} />
              <p style={{ margin: 0, fontSize: 13 }}>No skills yet</p>
              <p style={{ margin: 0, fontSize: 11, opacity: 0.7 }}>Use Import to pull NVIDIA (sidecar) + Crystal (SKILL.md) skills.</p>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
            {filtered.map(s => <SkillCard key={s.id} skill={s} onOpen={() => setSelected(s)} />)}
          </div>
        </div>
      )}

      {selected && <SkillDetail skill={selected} onClose={() => setSelected(null)} />}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function SkillCard({ skill, onOpen }: { skill: OsSkill; onOpen: () => void }) {
  const sc = SOURCE_COLOR[skill.source] ?? "#94a3b8";
  const cc = skill.category ? (CATEGORY_COLOR[skill.category] ?? "#94a3b8") : "#94a3b8";
  return (
    <button onClick={onOpen} style={{ ...glowCard(sc), padding: 14, textAlign: "left", cursor: "pointer", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{skill.name}</span>
        <span style={badge(sc)}>{skill.source}</span>
      </div>
      {skill.description && (
        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{skill.description}</div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
        {skill.category && <span style={badge(cc)}>{skill.category}</span>}
        {skill.requiredGpuLibraries.length > 0 && (
          <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 5, background: "var(--bg-hover)", color: "var(--text-muted)", fontFamily: MONO, display: "inline-flex", alignItems: "center", gap: 3 }}>
            <Cpu style={{ width: 9, height: 9 }} /> {skill.requiredGpuLibraries.length} gpu lib
          </span>
        )}
        {skill.version && <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: MONO }}>v{skill.version}</span>}
      </div>
    </button>
  );
}

function SkillDetail({ skill, onClose }: { skill: OsSkill; onClose: () => void }) {
  const invokeSkill = useOsStore(s => s.invokeSkill);
  const [payload, setPayload] = useState("{\n  \n}");
  const [invoking, setInvoking] = useState(false);
  const [result, setResult] = useState<OsSkillInvokeResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const sc = SOURCE_COLOR[skill.source] ?? "#94a3b8";

  const invoke = async () => {
    setErr(null);
    let parsed: Record<string, unknown> = {};
    if (payload.trim()) {
      try { parsed = JSON.parse(payload); }
      catch (e) { setErr(`Payload must be valid JSON: ${e instanceof Error ? e.message : String(e)}`); return; }
    }
    setInvoking(true);
    const res = await invokeSkill(skill.id, { payload: parsed });
    setInvoking(false);
    if (res) setResult(res);
    else setErr("Invocation failed (see Targets/runs).");
  };

  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", justifyContent: "flex-end", zIndex: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 460, maxWidth: "92%", height: "100%", background: "var(--bg-panel, #14141a)", borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <Sparkles style={{ width: 16, height: 16, color: sc }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{skill.name}</span>
            <span style={badge(sc)}>{skill.source}</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}><X style={{ width: 16, height: 16 }} /></button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          {skill.description && <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>{skill.description}</p>}

          <Meta label="Category" value={skill.category ?? "—"} />
          {skill.version && <Meta label="Version" value={skill.version} />}
          {skill.sourceFile && <Meta label="Source file" value={skill.sourceFile} mono />}
          {skill.requiredTools.length > 0 && <Chips icon={Wrench} label="Required tools" items={skill.requiredTools} />}
          {skill.requiredGpuLibraries.length > 0 && <Chips icon={Cpu} label="GPU libraries" items={skill.requiredGpuLibraries} />}

          {schemaBlock("Input schema", skill.inputSchema)}
          {schemaBlock("Output schema", skill.outputSchema)}
          {skill.validationRules.length > 0 && schemaBlock("Validation rules", skill.validationRules)}
          {skill.examples.length > 0 && schemaBlock(`Examples (${skill.examples.length})`, skill.examples.map(e => ({ input: e.input, output: e.output })))}

          <div>
            <div style={{ ...sectionLabel, marginBottom: 6 }}>Invoke — payload (JSON)</div>
            <textarea value={payload} onChange={e => setPayload(e.target.value)} spellCheck={false}
              style={{ ...inputStyle, fontFamily: MONO, fontSize: 12, minHeight: 100, resize: "vertical" }} />
            {err && <div style={{ fontSize: 11, color: "#f87171", marginTop: 6 }}>{err}</div>}
            <button onClick={() => void invoke()} disabled={invoking}
              style={{ ...btnPrimary, display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
              <Play style={{ width: 13, height: 13 }} /> {invoking ? "Invoking…" : "Invoke skill"}
            </button>
          </div>

          {result && (
            <div>
              <div style={{ ...sectionLabel, marginBottom: 6 }}>Result · route={result.route} · run {result.run.status}</div>
              <ValidationLine label="input" v={result.inputValidation} />
              {result.outputValidation && <ValidationLine label="output" v={result.outputValidation} />}
              <pre style={{ fontFamily: MONO, fontSize: 11, color: "var(--text-secondary)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: 10, overflowX: "auto", maxHeight: 220 }}>
                {JSON.stringify(result.run.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ValidationLine({ label, v }: { label: string; v: { ok: boolean; problems: string[] } }) {
  return (
    <div style={{ fontSize: 11, marginBottom: 4, color: v.ok ? "#4ade80" : "#f87171" }}>
      {label}: {v.ok ? "valid" : v.problems.join("; ")}
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 12 }}>
      <span style={{ color: "var(--text-muted)", minWidth: 90 }}>{label}</span>
      <span style={{ color: "var(--text)", fontFamily: mono ? MONO : undefined, wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

function Chips({ icon: Icon, label, items }: { icon: typeof Cpu; label: string; items: string[] }) {
  return (
    <div>
      <div style={{ ...sectionLabel, marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
        <Icon style={{ width: 11, height: 11 }} /> {label}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {items.map(i => <span key={i} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 6, background: "var(--bg-hover)", color: "var(--text-secondary)", fontFamily: MONO }}>{i}</span>)}
      </div>
    </div>
  );
}

function schemaBlock(label: string, value: unknown) {
  if (value === null || value === undefined) return null;
  const isEmpty = typeof value === "object" && value !== null && Object.keys(value as object).length === 0;
  if (isEmpty) return null;
  return (
    <div>
      <div style={{ ...sectionLabel, marginBottom: 6 }}>{label}</div>
      <pre style={{ fontFamily: MONO, fontSize: 11, color: "var(--text-secondary)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: 10, overflowX: "auto", maxHeight: 200, margin: 0 }}>
        {JSON.stringify(value, null, 2)}
      </pre>
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
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "var(--text-muted)" }}>
          <FlaskConical style={{ width: 11, height: 11 }} /> GPU/ML skills also need the crystal-gpu sidecar running.
        </div>
      </div>
    </div>
  );
}
