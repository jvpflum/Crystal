import { useState, useEffect, useCallback, type CSSProperties } from "react";
import {
  Box, Globe, Shield, RefreshCw, Loader2, AlertTriangle,
  Terminal, Info, ChevronDown, ChevronRight, Search,
  CheckCircle2, XCircle, Zap, Play, KeyRound,
} from "lucide-react";
import { OpenClawKeysTab } from "@/components/tools/OpenClawKeysTab";
import { cachedCommand } from "@/lib/cache";
import { useDataStore } from "@/stores/dataStore";
import { openclawClient } from "@/lib/openclaw";

const MONO: CSSProperties = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" };
const CARD: CSSProperties = { background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" };
const BTN: CSSProperties = { padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 500, border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, transition: "all .15s ease" };
const BTN_PRIMARY: CSSProperties = { ...BTN, background: "var(--accent-bg)", color: "var(--accent)" };
const BTN_GHOST: CSSProperties = { ...BTN, background: "transparent", color: "var(--text-muted)" };
const INPUT: CSSProperties = { background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 12px", color: "var(--text)", fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box" as const, ...MONO };

interface OCSkill {
  name: string; description: string; emoji: string; eligible: boolean;
  disabled: boolean; source: string; bundled: boolean; homepage?: string;
  missing: { bins: string[]; anyBins: string[]; env: string[]; config: string[]; os: string[] };
}

type TabId = "skills" | "sandbox" | "keys";

export function ToolsView() {
  const [tab, setTab] = useState<TabId>("skills");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <style>{`@keyframes _spin { to { transform: rotate(360deg) } }`}</style>

      <div style={{ padding: "14px 20px 0", flexShrink: 0 }}>
        <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Tools &amp; Skills</h2>
        <p style={{ margin: "2px 0 10px", fontSize: 10, color: "var(--text-muted)" }}>
          OpenClaw skills, keys, sandbox, and tool permissions
        </p>
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)" }}>
          {([
            { id: "skills" as TabId, label: "Skills", icon: <Zap style={{ width: 11, height: 11 }} /> },
            { id: "keys" as TabId, label: "Keys", icon: <KeyRound style={{ width: 11, height: 11 }} /> },
            { id: "sandbox" as TabId, label: "Sandbox & Tools", icon: <Box style={{ width: 11, height: 11 }} /> },
          ]).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "8px 20px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer",
              background: "transparent", color: tab === t.id ? "var(--accent)" : "var(--text-muted)",
              borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
              transition: "all 0.15s", display: "flex", alignItems: "center", gap: 6,
            }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "skills" ? <SkillsTab /> : tab === "keys" ? <OpenClawKeysTab /> : <SandboxTab />}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   SKILLS TAB
   ══════════════════════════════════════════════════════════════════════ */

function parseSkill(s: Record<string, unknown>): OCSkill {
  return {
    name: String(s.name || s.id || s.skillId || s.key || ""),
    description: String(s.description || ""),
    emoji: String(s.emoji || ""),
    eligible: s.eligible === true,
    disabled: s.disabled === true,
    source: String(s.source || ""),
    bundled: s.bundled === true,
    homepage: s.homepage ? String(s.homepage) : undefined,
    missing: {
      bins: Array.isArray((s.missing as Record<string, unknown>)?.bins) ? (s.missing as Record<string, unknown[]>).bins.map(String) : [],
      anyBins: Array.isArray((s.missing as Record<string, unknown>)?.anyBins) ? (s.missing as Record<string, unknown[]>).anyBins.map(String) : [],
      env: Array.isArray((s.missing as Record<string, unknown>)?.env) ? (s.missing as Record<string, unknown[]>).env.map(String) : [],
      config: Array.isArray((s.missing as Record<string, unknown>)?.config) ? (s.missing as Record<string, unknown[]>).config.map(String) : [],
      os: Array.isArray((s.missing as Record<string, unknown>)?.os) ? (s.missing as Record<string, unknown[]>).os.map(String) : [],
    },
  };
}

function SkillsTab() {
  const [skills, setSkills] = useState<OCSkill[]>(() => {
    const cached = useDataStore.getState().skills?.data;
    return Array.isArray(cached) ? cached.map(parseSkill) : [];
  });
  const [loading, setLoading] = useState(() => !useDataStore.getState().skills?.data);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "workspace" | "bundled" | "eligible">("all");
  const [selectedSkill, setSelectedSkill] = useState<OCSkill | null>(null);
  const [launchPrompt, setLaunchPrompt] = useState("");
  const [launching, setLaunching] = useState(false);
  const [launchResult, setLaunchResult] = useState<string | null>(null);

  const getSkills = useDataStore(s => s.getSkills);

  const loadSkills = useCallback(async (force = false) => {
    try {
      const data = await getSkills(force);
      if (Array.isArray(data)) {
        setSkills(data.map(parseSkill));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [getSkills]);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  const filtered = skills.filter(s => {
    if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !s.description.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === "workspace") return !s.bundled;
    if (filter === "bundled") return s.bundled;
    if (filter === "eligible") return s.eligible;
    return true;
  });

  const workspaceSkills = filtered.filter(s => !s.bundled);
  const bundledSkills = filtered.filter(s => s.bundled);

  const launchSkill = async () => {
    if (!selectedSkill || !launchPrompt.trim()) return;
    setLaunching(true);
    setLaunchResult(null);
    try {
      const result = await openclawClient.invokeSkill(selectedSkill.name, launchPrompt.trim());
      setLaunchResult(String(result.payload.text || "Done"));
    } catch (e) {
      setLaunchResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLaunching(false);
  };

  return (
    <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
      <div style={{ flex: 1, overflow: "auto", padding: "16px 24px" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, color: "var(--text-muted)" }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search skills..."
              style={{ ...INPUT, paddingLeft: 30, fontFamily: "inherit" }} />
          </div>
          <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} style={{
            ...INPUT, width: "auto", fontFamily: "inherit", fontSize: 11,
          }}>
            <option value="all">All ({skills.length})</option>
            <option value="workspace">Workspace ({skills.filter(s => !s.bundled).length})</option>
            <option value="bundled">Bundled ({skills.filter(s => s.bundled).length})</option>
            <option value="eligible">Eligible ({skills.filter(s => s.eligible).length})</option>
          </select>
          <button onClick={() => loadSkills(true)} style={BTN_GHOST}>
            <RefreshCw style={{ width: 12, height: 12 }} />
          </button>
        </div>

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <Loader2 style={{ width: 20, height: 20, color: "var(--accent)", animation: "_spin 1s linear infinite" }} />
          </div>
        ) : (
          <>
            {workspaceSkills.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-muted)", marginBottom: 8 }}>
                  Workspace Skills ({workspaceSkills.length})
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
                  {workspaceSkills.map(s => (
                    <SkillCard key={`${s.name}:${s.source}`} skill={s} selected={selectedSkill?.name === s.name} onSelect={() => setSelectedSkill(selectedSkill?.name === s.name ? null : s)} />
                  ))}
                </div>
              </div>
            )}
            {bundledSkills.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-muted)", marginBottom: 8 }}>
                  Bundled Skills ({bundledSkills.length})
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
                  {bundledSkills.map(s => (
                    <SkillCard key={`${s.name}:${s.source}`} skill={s} selected={selectedSkill?.name === s.name} onSelect={() => setSelectedSkill(selectedSkill?.name === s.name ? null : s)} />
                  ))}
                </div>
              </div>
            )}
            {filtered.length === 0 && (
              <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)", fontSize: 12 }}>
                No skills found
              </div>
            )}
          </>
        )}
      </div>

      {selectedSkill && (
        <div style={{ width: 340, flexShrink: 0, borderLeft: "1px solid var(--border)", overflow: "auto", padding: 20, background: "var(--bg-surface)" }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>{selectedSkill.emoji || "🔧"}</div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: "0 0 4px" }}>{selectedSkill.name}</h3>
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 6, background: selectedSkill.eligible ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)", color: selectedSkill.eligible ? "var(--success)" : "var(--error)", fontWeight: 600 }}>
              {selectedSkill.eligible ? "Eligible" : "Not Eligible"}
            </span>
            <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 6, background: "rgba(255,255,255,0.05)", color: "var(--text-muted)", fontWeight: 600 }}>
              {selectedSkill.bundled ? "Bundled" : "Workspace"}
            </span>
          </div>
          <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5, margin: "0 0 16px" }}>{selectedSkill.description}</p>

          {!selectedSkill.eligible && (
            <div style={{ padding: 10, borderRadius: 8, background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.15)", marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "var(--error)", marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
                <AlertTriangle style={{ width: 11, height: 11 }} /> Missing Dependencies
              </div>
              {selectedSkill.missing.bins.length > 0 && <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>Binaries: {selectedSkill.missing.bins.join(", ")}</div>}
              {selectedSkill.missing.env.length > 0 && <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>Environment: {selectedSkill.missing.env.join(", ")}</div>}
              {selectedSkill.missing.config.length > 0 && <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>Config: {selectedSkill.missing.config.join(", ")}</div>}
              {selectedSkill.missing.os.length > 0 && <div style={{ fontSize: 10, color: "var(--text-muted)" }}>OS: {selectedSkill.missing.os.join(", ")}</div>}
            </div>
          )}

          {selectedSkill.eligible && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-muted)", marginBottom: 6 }}>Launch Skill</div>
              <textarea value={launchPrompt} onChange={e => setLaunchPrompt(e.target.value)}
                placeholder={`Tell ${selectedSkill.name} what to do...`} rows={3}
                style={{ ...INPUT, resize: "vertical", fontFamily: "inherit", marginBottom: 8 }} />
              <button onClick={launchSkill} disabled={!launchPrompt.trim() || launching}
                style={{ ...BTN_PRIMARY, width: "100%", justifyContent: "center", opacity: !launchPrompt.trim() || launching ? 0.5 : 1 }}>
                {launching ? <Loader2 style={{ width: 12, height: 12, animation: "_spin 1s linear infinite" }} /> : <Play style={{ width: 12, height: 12 }} />}
                {launching ? "Running..." : "Launch"}
              </button>
            </div>
          )}

          {launchResult && (
            <div style={{ padding: 10, borderRadius: 8, background: "var(--bg-base)", border: "1px solid var(--border)", marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>Result</div>
              <pre style={{ fontSize: 10, color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 200, overflowY: "auto", margin: 0, ...MONO }}>
                {launchResult}
              </pre>
            </div>
          )}

          {selectedSkill.homepage && (
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
              <a href={selectedSkill.homepage} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", textDecoration: "none" }}>Documentation</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SkillCard({ skill, selected, onSelect }: { skill: OCSkill; selected: boolean; onSelect: () => void }) {
  return (
    <button onClick={onSelect} style={{
      ...CARD, padding: "12px 14px", cursor: "pointer", textAlign: "left" as const, width: "100%",
      borderColor: selected ? "var(--accent)" : "var(--border)",
      background: selected ? "var(--accent-bg)" : "var(--bg-elevated)",
      display: "flex", alignItems: "flex-start", gap: 10, transition: "all 0.15s",
    }}>
      <span style={{ fontSize: 20, flexShrink: 0, lineHeight: 1 }}>{skill.emoji || "🔧"}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{skill.name}</span>
          {skill.eligible ? <CheckCircle2 style={{ width: 10, height: 10, color: "var(--success)", flexShrink: 0 }} />
            : <XCircle style={{ width: 10, height: 10, color: "var(--text-muted)", flexShrink: 0 }} />}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{skill.description}</div>
      </div>
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   SANDBOX & TOOLS TAB
   ══════════════════════════════════════════════════════════════════════ */

function extractCliJsonObject(text: string): Record<string, unknown> | null {
  const c = text.trim();
  if (!c) return null;
  const first = c.indexOf("{");
  const last = c.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try {
    return JSON.parse(c.slice(first, last + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** `config get tools` may return `{ tools: { allow, deny, profile } }` or a flat tools section. */
function normalizeToolsConfigPayload(parsed: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!parsed) return null;
  const inner = parsed.tools;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return parsed;
}

interface SandboxContainer { id: string; name: string; status: string; image?: string; }
interface SandboxBrowser { id: string; url?: string; status: string; }
interface SandboxData { containers: SandboxContainer[]; browsers: SandboxBrowser[]; }

function SandboxTab() {
  const [sandbox, setSandbox] = useState<SandboxData>({ containers: [], browsers: [] });
  const [policy, setPolicy] = useState<Record<string, unknown> | null>(null);
  const [toolPermissions, setToolPermissions] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPolicy, setShowPolicy] = useState(false);

  const loadSandbox = useCallback(async () => {
    try {
      const result = await cachedCommand("openclaw sandbox list --json", { ttl: 60_000 });
      const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
      const raw = extractCliJsonObject(combined);
      if (raw) {
        setSandbox({
          containers: Array.isArray(raw.containers) ? (raw.containers as SandboxContainer[]) : [],
          browsers: Array.isArray(raw.browsers) ? (raw.browsers as SandboxBrowser[]) : [],
        });
      }
    } catch { /* non-critical */ }
  }, []);

  const loadPolicy = useCallback(async () => {
    try {
      const result = await cachedCommand("openclaw sandbox explain --json", { ttl: 120_000 });
      const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
      setPolicy(extractCliJsonObject(combined));
    } catch { /* non-critical */ }
  }, []);

  const loadToolPermissions = useCallback(async () => {
    try {
      const result = await cachedCommand("openclaw config get tools --json", { ttl: 120_000 });
      const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
      const parsed = extractCliJsonObject(combined);
      setToolPermissions(normalizeToolsConfigPayload(parsed));
    } catch {
      setToolPermissions(null);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      await Promise.all([loadSandbox(), loadPolicy(), loadToolPermissions()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tools data");
    }
    setLoading(false);
  }, [loadSandbox, loadPolicy, loadToolPermissions]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const totalContainers = sandbox.containers.length;
  const totalBrowsers = sandbox.browsers.length;
  const permCount = toolPermissions ? Object.keys(toolPermissions).length : 0;

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
          {totalContainers} container{totalContainers !== 1 ? "s" : ""} &middot; {totalBrowsers} browser{totalBrowsers !== 1 ? "s" : ""} &middot; {permCount} tool perm{permCount !== 1 ? "s" : ""}
        </span>
        <button onClick={() => { setLoading(true); loadAll(); }} disabled={loading} style={BTN_GHOST}>
          {loading
            ? <Loader2 style={{ width: 12, height: 12, animation: "_spin 1s linear infinite" }} />
            : <RefreshCw style={{ width: 12, height: 12 }} />}
        </button>
      </div>

      {error && (
        <div style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 6, padding: "6px 10px", display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
          <AlertTriangle style={{ width: 12, height: 12, color: "var(--error)", flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: "var(--error)" }}>{error}</span>
        </div>
      )}

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
          <Loader2 style={{ width: 20, height: 20, color: "rgba(255,255,255,0.3)", animation: "_spin 1s linear infinite" }} />
        </div>
      ) : (
        <>
          <SectionHeader title="Sandbox Containers" icon={<Box style={{ width: 12, height: 12, color: "var(--text-muted)" }} />} />
          <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 16 }}>
            {sandbox.containers.length === 0 ? (
              <div style={{ padding: "14px 12px", textAlign: "center" }}>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: 0 }}>No active containers</p>
              </div>
            ) : (
              sandbox.containers.map((c, i) => (
                <div key={c.id} style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, borderBottom: i < sandbox.containers.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <Terminal style={{ width: 14, height: 14, color: "var(--accent)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--text)", fontFamily: "monospace" }}>{c.name || c.id}</p>
                    {c.image && <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)" }}>{c.image}</p>}
                  </div>
                  <StatusBadge status={c.status} />
                </div>
              ))
            )}
          </div>

          <SectionHeader title="Browser Instances" icon={<Globe style={{ width: 12, height: 12, color: "var(--text-muted)" }} />} />
          <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 16 }}>
            {sandbox.browsers.length === 0 ? (
              <div style={{ padding: "14px 12px", textAlign: "center" }}>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: 0 }}>No active browsers</p>
              </div>
            ) : (
              sandbox.browsers.map((b, i) => (
                <div key={b.id} style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, borderBottom: i < sandbox.browsers.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <Globe style={{ width: 14, height: 14, color: "var(--accent)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--text)", fontFamily: "monospace" }}>{b.id}</p>
                    {b.url && <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)" }}>{b.url}</p>}
                  </div>
                  <StatusBadge status={b.status} />
                </div>
              ))
            )}
          </div>

          <SectionHeader title="Tool Permissions" icon={<Shield style={{ width: 12, height: 12, color: "var(--text-muted)" }} />} />
          <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 16 }}>
            {toolPermissions && Object.keys(toolPermissions).length > 0 ? (
              Object.entries(toolPermissions).map(([key, value], i, arr) => (
                <div key={key} style={{ padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text)" }}>{key}</span>
                  <PermissionValue value={value} />
                </div>
              ))
            ) : (
              <div style={{ padding: "14px 12px", textAlign: "center" }}>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: 0 }}>No tool permissions configured</p>
              </div>
            )}
          </div>

          <SectionHeader title="Sandbox Policy" icon={<Info style={{ width: 12, height: 12, color: "var(--text-muted)" }} />} />
          <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 16 }}>
            <button onClick={() => setShowPolicy(!showPolicy)} style={{ width: "100%", padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "none", border: "none", cursor: "pointer" }}>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{showPolicy ? "Hide" : "Show"} sandbox policy details</span>
              {showPolicy ? <ChevronDown style={{ width: 12, height: 12, color: "var(--text-muted)" }} /> : <ChevronRight style={{ width: 12, height: 12, color: "var(--text-muted)" }} />}
            </button>
            {showPolicy && policy && (
              <div style={{ padding: "0 12px 12px" }}>
                <pre style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.6)", fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                  {JSON.stringify(policy, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SectionHeader({ title, icon }: { title: string; icon: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
      {icon}
      <p style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, margin: 0 }}>{title}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = status === "running" ? "#4ade80" : status === "stopped" ? "#f87171" : "#fbbf24";
  return (
    <span style={{ fontSize: 10, color, background: `${color}20`, padding: "2px 8px", borderRadius: 4, fontWeight: 500, textTransform: "lowercase" }}>
      {status}
    </span>
  );
}

function PermissionValue({ value }: { value: unknown }) {
  if (typeof value === "boolean") {
    return <span style={{ fontSize: 11, color: value ? "var(--success)" : "var(--error)", fontFamily: "monospace" }}>{value ? "allowed" : "denied"}</span>;
  }
  if (Array.isArray(value)) {
    return (
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {value.map((v, i) => (
          <span key={i} style={{ fontSize: 10, color: "var(--accent)", background: "rgba(59,130,246,0.15)", padding: "2px 6px", borderRadius: 4, fontFamily: "monospace" }}>{String(v)}</span>
        ))}
      </div>
    );
  }
  return <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", fontFamily: "monospace" }}>{JSON.stringify(value)}</span>;
}
