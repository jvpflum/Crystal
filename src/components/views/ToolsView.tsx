import { useState, useEffect, useCallback } from "react";
import {
  Box, Globe, Shield, RefreshCw, Loader2, AlertTriangle,
  Terminal, Info, ChevronDown, ChevronRight, Search,
  CheckCircle2, XCircle, Zap, Play, KeyRound, ExternalLink,
  Download, RotateCw, Package, Tag, X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { OpenClawKeysTab } from "@/components/tools/OpenClawKeysTab";
import { cachedCommand } from "@/lib/cache";
import { useDataStore } from "@/stores/dataStore";
import { openclawClient } from "@/lib/openclaw";
import { EASE, MONO, glowCard, innerPanel, inputStyle, btnPrimary, btnSecondary, sectionLabel, emptyState, hoverLift, hoverReset, pressDown, pressUp, iconTile } from "@/styles/viewStyles";

const CARD: React.CSSProperties = { ...innerPanel, overflow: "hidden" };
const BTN: React.CSSProperties = { padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 500, border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, transition: `all .15s ${EASE}` };
const BTN_PRIMARY: React.CSSProperties = { ...BTN, ...btnPrimary, display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 6, fontSize: 11 };
const BTN_GHOST: React.CSSProperties = { ...BTN, ...btnSecondary, background: "transparent", display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 6, fontSize: 11 };
const INPUT: React.CSSProperties = { ...inputStyle, fontFamily: MONO, boxSizing: "border-box" as const };

interface OCSkill {
  name: string; description: string; emoji: string; eligible: boolean;
  disabled: boolean; source: string; bundled: boolean; homepage?: string;
  missing: { bins: string[]; anyBins: string[]; env: string[]; config: string[]; os: string[] };
}

type TabId = "skills" | "hub" | "sandbox" | "keys";

export function ToolsView() {
  const [tab, setTab] = useState<TabId>("skills");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <style>{`@keyframes _spin { to { transform: rotate(360deg) } }`}</style>

      <div style={{ padding: "14px 20px 0", flexShrink: 0 }}>
        <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Tools &amp; Skills</h2>
        <p style={{ margin: "2px 0 10px", fontSize: 10, color: "var(--text-muted)" }}>
          Manage skills, browse the hub, configure keys and sandbox
        </p>
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)" }}>
          {([
            { id: "skills" as TabId, label: "Skills", icon: <Zap style={{ width: 11, height: 11 }} /> },
            { id: "hub" as TabId, label: "Hub", icon: <Globe style={{ width: 11, height: 11 }} /> },
            { id: "keys" as TabId, label: "Keys", icon: <KeyRound style={{ width: 11, height: 11 }} /> },
            { id: "sandbox" as TabId, label: "Sandbox & Tools", icon: <Box style={{ width: 11, height: 11 }} /> },
          ]).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "8px 20px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer",
              background: "transparent", color: tab === t.id ? "var(--accent)" : "var(--text-muted)",
              borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
              transition: `all 0.15s ${EASE}`, display: "flex", alignItems: "center", gap: 6,
            }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "skills" ? <SkillsTab /> : tab === "hub" ? <HubTab /> : tab === "keys" ? <OpenClawKeysTab /> : <SandboxTab />}
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
  const [togglingSkills, setTogglingSkills] = useState<Set<string>>(new Set());

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

  const toggleSkill = useCallback(async (skill: OCSkill) => {
    if (skill.disabled && !skill.eligible && skill.missing) {
      const parts: string[] = [];
      if (skill.missing.bins.length) parts.push(`bins: ${skill.missing.bins.join(", ")}`);
      if (skill.missing.env.length) parts.push(`env: ${skill.missing.env.join(", ")}`);
      if (skill.missing.config.length) parts.push(`config: ${skill.missing.config.join(", ")}`);
      if (skill.missing.os.length) parts.push(`os: ${skill.missing.os.join(", ")}`);
      const msg = `This skill has missing dependencies:\n\n${parts.join("\n")}\n\nEnable anyway?`;
      if (!window.confirm(msg)) return;
    }
    setTogglingSkills(s => new Set(s).add(skill.name));
    try {
      const ok = skill.disabled
        ? await openclawClient.enableSkill(skill.name)
        : await openclawClient.disableSkill(skill.name);
      if (!ok) window.alert(`Failed to ${skill.disabled ? "enable" : "disable"} ${skill.name}`);
    } catch (e) {
      window.alert(`Toggle failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    await loadSkills(true);
    setTogglingSkills(s => { const n = new Set(s); n.delete(skill.name); return n; });
  }, [loadSkills]);

  const filtered = skills.filter(s => {
    if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !s.description.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === "workspace") return !s.bundled;
    if (filter === "bundled") return s.bundled;
    if (filter === "eligible") return s.eligible;
    return true;
  });

  const enabledCount = skills.filter(s => !s.disabled).length;
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
        {/* Stats bar */}
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 8, background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.12)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80" }} />
            <span style={{ fontSize: 10, color: "#4ade80", fontWeight: 600 }}>{enabledCount} enabled</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500 }}>{skills.length - enabledCount} disabled</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 8, background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.12)" }}>
            <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 500 }}>{skills.filter(s => s.eligible).length} eligible</span>
          </div>
        </div>

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
          <button onClick={() => loadSkills(true)} style={BTN_GHOST} aria-label="Refresh skills">
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
                <div style={{ ...sectionLabel, marginBottom: 8 }}>
                  Workspace Skills ({workspaceSkills.length})
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 8 }}>
                  {workspaceSkills.map(s => (
                    <SkillCard key={`${s.name}:${s.source}`} skill={s} selected={selectedSkill?.name === s.name}
                      onSelect={() => setSelectedSkill(selectedSkill?.name === s.name ? null : s)}
                      toggling={togglingSkills.has(s.name)} onToggle={() => toggleSkill(s)} />
                  ))}
                </div>
              </div>
            )}
            {bundledSkills.length > 0 && (
              <div>
                <div style={{ ...sectionLabel, marginBottom: 8 }}>
                  Bundled Skills ({bundledSkills.length})
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 8 }}>
                  {bundledSkills.map(s => (
                    <SkillCard key={`${s.name}:${s.source}`} skill={s} selected={selectedSkill?.name === s.name}
                      onSelect={() => setSelectedSkill(selectedSkill?.name === s.name ? null : s)}
                      toggling={togglingSkills.has(s.name)} onToggle={() => toggleSkill(s)} />
                  ))}
                </div>
              </div>
            )}
            {filtered.length === 0 && (
              <div style={emptyState}>
                No skills found
              </div>
            )}
          </>
        )}
      </div>

      {selectedSkill && (
        <div style={{ width: 340, flexShrink: 0, borderLeft: "1px solid var(--border)", overflow: "auto", padding: 20, background: "var(--bg-surface)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 28 }}>{selectedSkill.emoji || "🔧"}</div>
            <SkillToggle on={!selectedSkill.disabled} loading={togglingSkills.has(selectedSkill.name)} onToggle={() => toggleSkill(selectedSkill)} />
          </div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: "0 0 4px" }}>{selectedSkill.name}</h3>
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 6, background: selectedSkill.disabled ? "rgba(248,113,113,0.1)" : "rgba(74,222,128,0.1)", color: selectedSkill.disabled ? "var(--error)" : "var(--success)", fontWeight: 600 }}>
              {selectedSkill.disabled ? "Disabled" : "Enabled"}
            </span>
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

          {selectedSkill.eligible && !selectedSkill.disabled && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ ...sectionLabel }}>Launch Skill</div>
              <textarea value={launchPrompt} onChange={e => setLaunchPrompt(e.target.value)}
                placeholder={`Tell ${selectedSkill.name} what to do...`} rows={3}
                style={{ ...INPUT, resize: "vertical", fontFamily: "inherit", marginBottom: 8 }} />
              <button onClick={launchSkill} disabled={!launchPrompt.trim() || launching}
                onMouseDown={pressDown} onMouseUp={pressUp}
                style={{ ...BTN_PRIMARY, width: "100%", justifyContent: "center", opacity: !launchPrompt.trim() || launching ? 0.5 : 1 }}>
                {launching ? <Loader2 style={{ width: 12, height: 12, animation: "_spin 1s linear infinite" }} /> : <Play style={{ width: 12, height: 12 }} />}
                {launching ? "Running..." : "Launch"}
              </button>
            </div>
          )}

          {launchResult && (
            <div style={{ padding: 10, borderRadius: 8, background: "var(--bg-base)", border: "1px solid var(--border)", marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>Result</div>
              <pre style={{ fontSize: 10, color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 200, overflowY: "auto", margin: 0, fontFamily: MONO }}>
                {launchResult}
              </pre>
            </div>
          )}

          {selectedSkill.homepage && (
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
              <a href={selectedSkill.homepage} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 3 }}>
                Documentation <ExternalLink style={{ width: 9, height: 9 }} />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SkillToggle({ on, loading, onToggle }: { on: boolean; loading: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onToggle(); }}
      disabled={loading}
      aria-label={on ? "Disable skill" : "Enable skill"}
      style={{
        width: 40, height: 22, borderRadius: 11, border: "none", cursor: loading ? "wait" : "pointer",
        background: on ? "#4ade80" : "rgba(255,255,255,0.12)",
        transition: `background 0.2s ${EASE}`,
        position: "relative", flexShrink: 0,
        opacity: loading ? 0.5 : 1,
      }}
    >
      <div style={{
        width: 16, height: 16, borderRadius: "50%", background: "#fff",
        position: "absolute", top: 3,
        left: on ? 21 : 3,
        transition: `left 0.2s ${EASE}`,
        boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
      }}>
        {loading && (
          <Loader2 style={{ width: 10, height: 10, color: "var(--accent)", position: "absolute", top: 3, left: 3, animation: "_spin 1s linear infinite" }} />
        )}
      </div>
    </button>
  );
}

function SkillCard({ skill, selected, onSelect, toggling, onToggle }: {
  skill: OCSkill; selected: boolean; onSelect: () => void; toggling: boolean; onToggle: () => void;
}) {
  return (
    <div
      data-glow={selected ? "var(--accent)" : undefined}
      onMouseEnter={hoverLift}
      onMouseLeave={hoverReset}
      style={{
        ...CARD, padding: "12px 14px", textAlign: "left" as const, width: "100%",
        borderColor: selected ? "var(--accent)" : skill.disabled ? "rgba(255,255,255,0.03)" : "var(--border)",
        background: selected ? "var(--accent-bg)" : skill.disabled ? "rgba(255,255,255,0.015)" : "var(--bg-elevated)",
        display: "flex", alignItems: "center", gap: 10, transition: `all 0.15s ${EASE}`,
        opacity: skill.disabled ? 0.6 : 1,
      }}
    >
      <button onClick={onSelect} style={{
        background: "none", border: "none", cursor: "pointer", padding: 0,
        display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0,
        textAlign: "left" as const,
      }}>
        <span style={{ fontSize: 20, flexShrink: 0, lineHeight: 1 }}>{skill.emoji || "🔧"}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{skill.name}</span>
            {skill.eligible && !skill.disabled && <CheckCircle2 style={{ width: 10, height: 10, color: "var(--success)", flexShrink: 0 }} />}
            {!skill.eligible && <XCircle style={{ width: 10, height: 10, color: "var(--text-muted)", flexShrink: 0 }} />}
            {skill.disabled && <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 4, background: "rgba(248,113,113,0.1)", color: "#f87171", fontWeight: 600 }}>OFF</span>}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{skill.description}</div>
        </div>
      </button>
      <SkillToggle on={!skill.disabled} loading={toggling} onToggle={onToggle} />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   HUB TAB — ClawHub search, install, and manage verified 3rd-party skills
   ══════════════════════════════════════════════════════════════════════ */

interface HubSkill {
  name: string;
  slug: string;
  version: string;
  tags: string[];
  description: string;
}

function parseHubLine(line: string): HubSkill | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("─") || trimmed.startsWith("=") || trimmed.toLowerCase().startsWith("name")) return null;
  const parts = trimmed.split(/\s{2,}|\t+/);
  if (parts.length < 3) return null;
  return {
    name: parts[0] || trimmed,
    slug: parts[1] || parts[0] || trimmed,
    version: parts[2] || "0.0.0",
    tags: parts[3] ? parts[3].split(",").map(t => t.trim()) : [],
    description: parts.slice(4).join(" ") || parts[0] || "",
  };
}

function HubTab() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<HubSkill[]>([]);
  const [searching, setSearching] = useState(false);
  const [installed, setInstalled] = useState<HubSkill[]>([]);
  const [loadingInstalled, setLoadingInstalled] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const showFb = (type: "success" | "error", text: string) => {
    setFeedback({ type, text });
    setTimeout(() => setFeedback(null), 6000);
  };

  const runCmd = useCallback(async (command: string) => {
    return invoke<{ stdout: string; stderr: string; code: number }>("execute_command", { command, cwd: null });
  }, []);

  const loadInstalled = useCallback(async () => {
    setLoadingInstalled(true);
    try {
      const r = await runCmd("clawhub list");
      if (r.code === 0 && r.stdout.trim()) {
        const lines = r.stdout.trim().split("\n");
        setInstalled(lines.map(parseHubLine).filter(Boolean) as HubSkill[]);
      } else { setInstalled([]); }
    } catch { setInstalled([]); }
    setLoadingInstalled(false);
  }, [runCmd]);

  useEffect(() => { loadInstalled(); }, [loadInstalled]);

  const doSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const r = await runCmd(`clawhub search "${searchQuery}" --limit 20`);
      if (r.code === 0 && r.stdout.trim()) {
        const parsed = r.stdout.trim().split("\n").map(parseHubLine).filter(Boolean) as HubSkill[];
        setSearchResults(parsed.length > 0 ? parsed : []);
        if (parsed.length === 0) showFb("error", "No matching skills found.");
      } else {
        setSearchResults([]);
        showFb("error", r.stderr || "No results.");
      }
    } catch (e) { showFb("error", e instanceof Error ? e.message : "Search failed"); }
    setSearching(false);
  };

  const installSkill = async (slug: string) => {
    setActionInProgress(s => new Set(s).add(slug));
    try {
      const r = await runCmd(`clawhub install ${slug} --force`);
      if (r.code === 0) showFb("success", `Installed ${slug} successfully`);
      else showFb("error", r.stderr || r.stdout || "Install failed");
      await loadInstalled();
    } catch (e) { showFb("error", e instanceof Error ? e.message : "Install failed"); }
    setActionInProgress(s => { const n = new Set(s); n.delete(slug); return n; });
  };

  const updateSkill = async (slug: string) => {
    setActionInProgress(s => new Set(s).add(slug));
    try {
      const r = await runCmd(`clawhub update ${slug}`);
      if (r.code === 0) showFb("success", `Updated ${slug}`);
      else showFb("error", r.stderr || "Update failed");
      await loadInstalled();
    } catch (e) { showFb("error", e instanceof Error ? e.message : "Update failed"); }
    setActionInProgress(s => { const n = new Set(s); n.delete(slug); return n; });
  };

  const updateAll = async () => {
    setActionInProgress(s => new Set(s).add("__all__"));
    try {
      const r = await runCmd("clawhub update --all");
      if (r.code === 0) showFb("success", "All skills updated");
      else showFb("error", r.stderr || "Update all failed");
      await loadInstalled();
    } catch (e) { showFb("error", e instanceof Error ? e.message : "Update all failed"); }
    setActionInProgress(s => { const n = new Set(s); n.delete("__all__"); return n; });
  };

  const syncAll = async () => {
    setActionInProgress(s => new Set(s).add("__sync__"));
    try {
      const r = await runCmd("clawhub sync --all");
      if (r.code === 0) showFb("success", r.stdout.trim() || "Sync complete");
      else showFb("error", r.stderr || "Sync failed");
      await loadInstalled();
    } catch (e) { showFb("error", e instanceof Error ? e.message : "Sync failed"); }
    setActionInProgress(s => { const n = new Set(s); n.delete("__sync__"); return n; });
  };

  const isInstalledSlug = (slug: string) => installed.some(s => s.slug === slug || s.name === slug);
  const fbColors = feedback?.type === "success"
    ? { bg: "rgba(74,222,128,0.08)", fg: "#4ade80", border: "rgba(74,222,128,0.2)" }
    : { bg: "rgba(248,113,113,0.08)", fg: "#f87171", border: "rgba(248,113,113,0.2)" };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <div style={iconTile("var(--accent)", 34)}>
          <Globe style={{ width: 16, height: 16, color: "var(--accent)" }} />
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text)" }}>ClawHub</h3>
          <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted)" }}>
            Browse, install, and update verified 3rd-party skills
          </p>
        </div>
      </div>

      {/* Feedback banner */}
      {feedback && (
        <div style={{
          padding: "8px 14px", borderRadius: 8, fontSize: 11, marginBottom: 12, marginTop: 10,
          background: fbColors.bg, color: fbColors.fg, border: `1px solid ${fbColors.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span>{feedback.text}</span>
          <button onClick={() => setFeedback(null)} style={{ background: "none", border: "none", cursor: "pointer", color: fbColors.fg, padding: 2, display: "flex" }}>
            <X style={{ width: 12, height: 12 }} />
          </button>
        </div>
      )}

      {/* Search */}
      <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "var(--text-muted)" }} />
          <input
            type="text" placeholder="Search ClawHub for skills..."
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") doSearch(); }}
            style={{ ...INPUT, paddingLeft: 32, fontFamily: "inherit" }}
          />
        </div>
        <button onClick={doSearch} disabled={searching || !searchQuery.trim()} onMouseDown={pressDown} onMouseUp={pressUp}
          style={{ ...BTN_PRIMARY, opacity: searching || !searchQuery.trim() ? 0.5 : 1 }}>
          {searching ? <Loader2 style={{ width: 11, height: 11, animation: "_spin 1s linear infinite" }} /> : <Search style={{ width: 11, height: 11 }} />}
          Search
        </button>
      </div>

      {/* Search Results */}
      {searchResults.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ ...sectionLabel, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            Search Results
            <span style={{ fontSize: 9, padding: "1px 7px", borderRadius: 6, background: "rgba(59,130,246,0.1)", color: "var(--accent)", fontWeight: 600 }}>{searchResults.length}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {searchResults.map((skill, i) => (
              <div key={`${skill.slug}-${i}`} style={{
                ...glowCard("var(--accent)"), padding: "12px 14px",
                display: "flex", alignItems: "center", gap: 12,
              }}
                data-glow="var(--accent)" onMouseEnter={hoverLift} onMouseLeave={hoverReset}
              >
                <div style={iconTile("var(--accent)", 34)}>
                  <Package style={{ width: 15, height: 15, color: "var(--accent)" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 600 }}>{skill.name}</span>
                    {skill.version && <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: MONO }}>v{skill.version}</span>}
                    {isInstalledSlug(skill.slug) && (
                      <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 4, background: "rgba(74,222,128,0.1)", color: "#4ade80", fontWeight: 600 }}>INSTALLED</span>
                    )}
                  </div>
                  <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted)", lineHeight: 1.4 }}>{skill.description}</p>
                  {skill.tags.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 4 }}>
                      {skill.tags.map(tag => (
                        <span key={tag} style={{
                          fontSize: 8, padding: "1px 5px", borderRadius: 4,
                          background: "rgba(59,130,246,0.08)", color: "var(--accent)", fontWeight: 500,
                          display: "inline-flex", alignItems: "center", gap: 2,
                        }}>
                          <Tag style={{ width: 7, height: 7 }} />{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {skill.slug && (
                  <button
                    onClick={() => isInstalledSlug(skill.slug) ? updateSkill(skill.slug) : installSkill(skill.slug)}
                    disabled={actionInProgress.has(skill.slug)}
                    onMouseDown={pressDown} onMouseUp={pressUp}
                    style={{ ...BTN_PRIMARY, flexShrink: 0, opacity: actionInProgress.has(skill.slug) ? 0.5 : 1 }}
                  >
                    {actionInProgress.has(skill.slug)
                      ? <Loader2 style={{ width: 11, height: 11, animation: "_spin 1s linear infinite" }} />
                      : isInstalledSlug(skill.slug)
                        ? <RotateCw style={{ width: 11, height: 11 }} />
                        : <Download style={{ width: 11, height: 11 }} />
                    }
                    {isInstalledSlug(skill.slug) ? "Update" : "Install"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Installed Skills */}
      <div style={{ marginTop: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ ...sectionLabel, marginBottom: 0, display: "flex", alignItems: "center", gap: 6 }}>
            Installed from Hub
            <span style={{ fontSize: 9, padding: "1px 7px", borderRadius: 6, background: "rgba(74,222,128,0.1)", color: "#4ade80", fontWeight: 600 }}>
              {installed.length}
            </span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={syncAll} disabled={actionInProgress.has("__sync__")} onMouseDown={pressDown} onMouseUp={pressUp}
              style={{ ...BTN_GHOST, opacity: actionInProgress.has("__sync__") ? 0.5 : 1 }}>
              {actionInProgress.has("__sync__") ? <Loader2 style={{ width: 10, height: 10, animation: "_spin 1s linear infinite" }} /> : <RotateCw style={{ width: 10, height: 10 }} />}
              Sync
            </button>
            <button onClick={updateAll} disabled={actionInProgress.has("__all__")} onMouseDown={pressDown} onMouseUp={pressUp}
              style={{ ...BTN_PRIMARY, opacity: actionInProgress.has("__all__") ? 0.5 : 1 }}>
              {actionInProgress.has("__all__") ? <Loader2 style={{ width: 10, height: 10, animation: "_spin 1s linear infinite" }} /> : <Download style={{ width: 10, height: 10 }} />}
              Update All
            </button>
            <button onClick={loadInstalled} disabled={loadingInstalled} style={BTN_GHOST} aria-label="Refresh installed">
              <RefreshCw style={{ width: 10, height: 10 }} />
            </button>
          </div>
        </div>

        {loadingInstalled ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 30 }}>
            <Loader2 style={{ width: 18, height: 18, color: "var(--accent)", animation: "_spin 1s linear infinite" }} />
          </div>
        ) : installed.length === 0 ? (
          <div style={{ ...glowCard("var(--text-muted)"), padding: "30px 20px", textAlign: "center" as const }}>
            <Package style={{ width: 28, height: 28, color: "var(--text-muted)", margin: "0 auto 10px" }} />
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>No ClawHub skills installed yet</p>
            <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "4px 0 0", opacity: 0.7 }}>Search above to find and install verified community skills</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
            {installed.map((skill, i) => (
              <div key={`${skill.slug}-${i}`} style={{
                ...glowCard("#4ade80"), padding: "12px 14px",
                display: "flex", alignItems: "center", gap: 10,
              }}
                data-glow="#4ade80" onMouseEnter={hoverLift} onMouseLeave={hoverReset}
              >
                <div style={iconTile("#4ade80", 32)}>
                  <Package style={{ width: 14, height: 14, color: "#4ade80" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 600 }}>{skill.name}</span>
                    <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: MONO }}>v{skill.version}</span>
                  </div>
                  <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {skill.description || skill.slug}
                  </p>
                </div>
                <button
                  onClick={() => updateSkill(skill.slug)}
                  disabled={actionInProgress.has(skill.slug)}
                  onMouseDown={pressDown} onMouseUp={pressUp}
                  aria-label={`Update ${skill.name}`}
                  style={{ ...BTN_GHOST, opacity: actionInProgress.has(skill.slug) ? 0.5 : 1, flexShrink: 0 }}
                >
                  {actionInProgress.has(skill.slug)
                    ? <Loader2 style={{ width: 10, height: 10, animation: "_spin 1s linear infinite" }} />
                    : <RotateCw style={{ width: 10, height: 10 }} />
                  }
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
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

  const [osInstalled, setOsInstalled] = useState<boolean | null>(null);
  const [osVersion, setOsVersion] = useState("");
  const [dockerOk, setDockerOk] = useState<boolean | null>(null);
  const [sandboxMode, setSandboxMode] = useState<"off" | "openshell">("off");
  const [osSandboxes, setOsSandboxes] = useState<{ name: string; status: string; image?: string }[]>([]);
  const [osToggling, setOsToggling] = useState(false);
  const [osInstalling, setOsInstalling] = useState(false);
  const [osFeedback, setOsFeedback] = useState<{ type: "success" | "error" | "warn"; text: string } | null>(null);
  const [osLogs, setOsLogs] = useState<string | null>(null);
  const [osLogsLoading, setOsLogsLoading] = useState(false);
  const [osExpanded, setOsExpanded] = useState(false);

  const showFb = (type: "success" | "error" | "warn", text: string) => {
    setOsFeedback({ type, text }); setTimeout(() => setOsFeedback(null), 6000);
  };

  const checkOsInstalled = useCallback(async (): Promise<boolean> => {
    try {
      const r = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", { command: "openshell --version", cwd: null });
      const ok = r.code === 0 && r.stdout.trim().length > 0;
      setOsInstalled(ok);
      if (ok) setOsVersion(r.stdout.trim());
      return ok;
    } catch { setOsInstalled(false); return false; }
  }, []);

  const checkDocker = useCallback(async (): Promise<boolean> => {
    try {
      const r = await invoke<{ stdout: string; code: number }>("execute_command", { command: "docker info --format '{{.ServerVersion}}'", cwd: null });
      const ok = r.code === 0 && !r.stdout.toLowerCase().includes("error");
      setDockerOk(ok); return ok;
    } catch { setDockerOk(false); return false; }
  }, []);

  const loadOsSandboxes = useCallback(async () => {
    if (!osInstalled) { setOsSandboxes([]); return; }
    try {
      const r = await invoke<{ stdout: string; code: number }>("execute_command", { command: "openshell sandbox list --json", cwd: null });
      if (r.code === 0 && r.stdout.trim()) {
        try {
          const data = JSON.parse(r.stdout);
          setOsSandboxes(Array.isArray(data) ? data : data.sandboxes ?? data.items ?? []);
          return;
        } catch { /* fall through */ }
        const lines = r.stdout.trim().split("\n").filter(l => l.trim() && !l.startsWith("NAME"));
        setOsSandboxes(lines.map(l => { const p = l.trim().split(/\s{2,}/); return { name: p[0] || "unknown", status: p[1] || "unknown", image: p[2] }; }));
      } else { setOsSandboxes([]); }
    } catch { setOsSandboxes([]); }
  }, [osInstalled]);

  const loadSandboxMode = useCallback(async () => {
    try {
      // Read directly from openclaw.json for speed
      const homeCmd = `powershell -Command "Write-Output (Join-Path $env:USERPROFILE '.openclaw')"`;
      const homeResult = await invoke<{ stdout: string }>("execute_command", { command: homeCmd, cwd: null });
      const homePath = homeResult.stdout.trim().replace(/\r?\n/g, "");
      const cfgContent = await invoke<string>("read_file", { path: `${homePath}\\openclaw.json` });
      const cfg = JSON.parse(cfgContent);
      const mode = cfg?.agents?.defaults?.sandbox?.mode ?? "off";
      setSandboxMode(typeof mode === "string" && mode !== "off" ? "openshell" : "off");
    } catch {
      try {
        const r = await cachedCommand("openclaw config get agents.defaults.sandbox --json", { ttl: 30_000, timeout: 8_000 });
        if (r.code === 0 && r.stdout.trim()) {
          const data = JSON.parse(r.stdout);
          const mode = data.mode ?? data.value?.mode ?? data.value ?? data ?? "off";
          setSandboxMode(typeof mode === "string" && mode !== "off" ? "openshell" : "off");
        }
      } catch { /* keep default */ }
    }
  }, []);

  const loadSandbox = useCallback(async () => {
    try {
      const result = await cachedCommand("openclaw sandbox list --json", { ttl: 60_000, timeout: 8_000 });
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
      const result = await cachedCommand("openclaw sandbox explain --json", { ttl: 120_000, timeout: 8_000 });
      const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
      setPolicy(extractCliJsonObject(combined));
    } catch { /* non-critical */ }
  }, []);

  const loadToolPermissions = useCallback(async () => {
    try {
      // Read directly from openclaw.json for speed
      const homeCmd = `powershell -Command "Write-Output (Join-Path $env:USERPROFILE '.openclaw')"`;
      const homeResult = await invoke<{ stdout: string }>("execute_command", { command: homeCmd, cwd: null });
      const homePath = homeResult.stdout.trim().replace(/\r?\n/g, "");
      const cfgContent = await invoke<string>("read_file", { path: `${homePath}\\openclaw.json` });
      const cfg = JSON.parse(cfgContent);
      if (cfg?.tools) {
        setToolPermissions(cfg.tools);
      }
    } catch {
      try {
        const result = await cachedCommand("openclaw config get tools --json", { ttl: 120_000, timeout: 8_000 });
        const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
        const parsed = extractCliJsonObject(combined);
        setToolPermissions(normalizeToolsConfigPayload(parsed));
      } catch { setToolPermissions(null); }
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [isInstalled] = await Promise.all([checkOsInstalled(), checkDocker(), loadSandboxMode(), loadSandbox(), loadPolicy(), loadToolPermissions()]);
      if (isInstalled) await loadOsSandboxes();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load tools data"); }
    setLoading(false);
  }, [checkOsInstalled, checkDocker, loadSandboxMode, loadSandbox, loadPolicy, loadToolPermissions, loadOsSandboxes]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleInstallOs = async () => {
    setOsInstalling(true);
    showFb("warn", "Installing OpenShell... This may take a minute.");
    try {
      const uvR = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", { command: "uv tool install -U openshell", cwd: null });
      if (uvR.code === 0) {
        const vr = await invoke<{ stdout: string; code: number }>("execute_command", { command: "openshell --version", cwd: null });
        if (vr.code === 0 && vr.stdout.trim()) {
          setOsInstalled(true); setOsVersion(vr.stdout.trim());
          showFb("success", `OpenShell installed: ${vr.stdout.trim()}`);
          await loadOsSandboxes(); setOsInstalling(false); return;
        }
      }
      const pipR = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", { command: "pip install -U openshell", cwd: null });
      if (pipR.code === 0) {
        const vr = await invoke<{ stdout: string; code: number }>("execute_command", { command: "openshell --version", cwd: null });
        if (vr.code === 0 && vr.stdout.trim()) {
          setOsInstalled(true); setOsVersion(vr.stdout.trim());
          showFb("success", `OpenShell installed: ${vr.stdout.trim()}`);
          await loadOsSandboxes();
        } else { showFb("error", "Package installed but CLI not found. Install manually: uv tool install -U openshell"); }
      } else { showFb("error", "Install failed. Run manually: uv tool install -U openshell"); }
    } catch (e) { showFb("error", `Install error: ${e instanceof Error ? e.message : String(e)}`); }
    setOsInstalling(false);
  };

  const setConfigMode = async (mode: "openshell" | "off"): Promise<boolean> => {
    try {
      const r = await invoke<{ code: number }>("execute_command", { command: `openclaw config set agents.defaults.sandbox.mode ${mode}`, cwd: null });
      return r.code === 0;
    } catch { return false; }
  };

  const handleToggleSandbox = async () => {
    setOsToggling(true);
    const enabling = sandboxMode === "off";
    try {
      if (enabling) {
        if (!dockerOk) { const ok = await checkDocker(); if (!ok) { showFb("error", "Docker is not running. Start Docker Desktop first."); setOsToggling(false); return; } }
        const hasOc = osSandboxes.some(s => s.name === "openclaw" || s.name === "openclaw-crystal" || s.image?.includes("openclaw"));
        if (!hasOc && osInstalled) {
          showFb("warn", "Creating OpenShell sandbox... This may take a minute on first run.");
          const cr = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", { command: "openshell sandbox create --from openclaw --name openclaw-crystal", cwd: null });
          if (cr.code !== 0) {
            const errMsg = (cr.stderr || cr.stdout || "").trim();
            showFb("error", errMsg.toLowerCase().includes("docker") ? "Docker is not responding. Make sure Docker Desktop is running." : `Sandbox creation failed: ${errMsg}`.slice(0, 150));
            setOsToggling(false); return;
          }
        }
        const ok = await setConfigMode("openshell");
        if (ok) { setSandboxMode("openshell"); showFb("success", "Sandbox mode enabled — agents run inside OpenShell"); }
        else showFb("error", "Failed to update config. Sandbox not enabled.");
      } else {
        const ok = await setConfigMode("off");
        if (ok) { setSandboxMode("off"); showFb("success", "Sandbox mode disabled — agents run on host"); }
        else showFb("error", "Failed to update config.");
      }
      await loadOsSandboxes();
    } catch (e) {
      if (enabling) { await setConfigMode("off").catch(() => {}); setSandboxMode("off"); }
      showFb("error", `Toggle failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    setOsToggling(false);
  };

  const handleViewLogs = async () => {
    setOsLogsLoading(true);
    try {
      const name = osSandboxes[0]?.name || "openclaw-crystal";
      const r = await invoke<{ stdout: string; code: number }>("execute_command", { command: `openshell logs ${name} --tail 40`, cwd: null });
      setOsLogs(r.stdout || "(no output)");
    } catch { setOsLogs("(failed to fetch logs)"); }
    setOsLogsLoading(false);
  };

  const totalContainers = sandbox.containers.length;
  const totalBrowsers = sandbox.browsers.length;
  const permCount = toolPermissions ? Object.keys(toolPermissions).length : 0;
  const fbColors: Record<string, { bg: string; fg: string; border: string }> = {
    success: { bg: "rgba(74,222,128,0.08)", fg: "#4ade80", border: "rgba(74,222,128,0.2)" },
    error: { bg: "rgba(248,113,113,0.08)", fg: "#f87171", border: "rgba(248,113,113,0.2)" },
    warn: { bg: "rgba(251,191,36,0.08)", fg: "#fbbf24", border: "rgba(251,191,36,0.2)" },
  };
  const fb = osFeedback ? fbColors[osFeedback.type] : null;

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
          {totalContainers} container{totalContainers !== 1 ? "s" : ""} &middot; {totalBrowsers} browser{totalBrowsers !== 1 ? "s" : ""} &middot; {permCount} tool perm{permCount !== 1 ? "s" : ""}
        </span>
        <button onClick={() => loadAll()} disabled={loading} style={BTN_GHOST}>
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
          {/* ── OpenShell Sandbox Management ── */}
          <SectionHeader title="OpenShell Sandbox" icon={<Box style={{ width: 12, height: 12, color: sandboxMode !== "off" ? "#4ade80" : "var(--text-muted)" }} />} />
          <div style={{ ...glowCard(sandboxMode !== "off" ? "#4ade80" : "var(--accent)"), marginBottom: 16 }}
            data-glow={sandboxMode !== "off" ? "#4ade80" : "var(--accent)"} onMouseEnter={hoverLift} onMouseLeave={hoverReset}>

            {osFeedback && fb && (
              <div style={{ padding: "8px 14px", fontSize: 11, background: fb.bg, color: fb.fg, borderBottom: `1px solid ${fb.border}` }}>
                {osFeedback.text}
              </div>
            )}

            {dockerOk === false && (
              <div style={{ padding: "8px 14px", fontSize: 11, background: "rgba(251,191,36,0.06)", color: "#fbbf24", borderBottom: "1px solid rgba(251,191,36,0.15)", display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle style={{ width: 12, height: 12, flexShrink: 0 }} />
                Docker Desktop is not running. Sandbox mode requires Docker.
              </div>
            )}

            {/* Toggle row */}
            <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={iconTile(sandboxMode !== "off" ? "#4ade80" : "var(--text-muted)", 32)}>
                  <Shield style={{ width: 16, height: 16, color: sandboxMode !== "off" ? "#4ade80" : "var(--text-muted)" }} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Sandbox Mode</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    {sandboxMode !== "off" ? "Agents execute inside isolated OpenShell containers" : "Agents execute directly on the host system"}
                  </div>
                </div>
              </div>
              {osInstalled ? (
                <button onClick={handleToggleSandbox} disabled={osToggling} style={{
                  width: 48, height: 26, borderRadius: 13, border: "none", cursor: osToggling ? "wait" : "pointer",
                  background: sandboxMode !== "off" ? "#4ade80" : "rgba(255,255,255,0.12)",
                  position: "relative", transition: `background 0.2s ${EASE}`, flexShrink: 0,
                  opacity: osToggling ? 0.6 : 1,
                }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: "50%", background: "#fff",
                    position: "absolute", top: 3,
                    left: sandboxMode !== "off" ? 25 : 3,
                    transition: `left 0.2s ${EASE}`,
                    boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                  }} />
                </button>
              ) : (
                <button onClick={handleInstallOs} disabled={osInstalling} style={{
                  ...BTN_PRIMARY, opacity: osInstalling ? 0.6 : 1,
                }}>
                  {osInstalling && <Loader2 style={{ width: 11, height: 11, animation: "_spin 1s linear infinite" }} />}
                  {osInstalling ? "Installing..." : "Install OpenShell"}
                </button>
              )}
            </div>

            {/* Status row */}
            <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: osExpanded ? "1px solid var(--border)" : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: osInstalled ? "#4ade80" : "#f87171" }} />
                <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                  {osInstalled === null ? "Checking..." : osInstalled ? `OpenShell ${osVersion}` : "OpenShell not installed"}
                </span>
                {osInstalled && (
                  <>
                    <span style={{ color: "var(--border)", margin: "0 2px" }}>·</span>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: dockerOk ? "#4ade80" : "#f87171" }} />
                    <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{dockerOk ? "Docker running" : "Docker stopped"}</span>
                  </>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {osInstalled && osSandboxes.length > 0 && (
                  <span style={{ fontSize: 10, color: "var(--text-muted)", padding: "2px 8px", borderRadius: 4, background: "rgba(59,130,246,0.08)" }}>
                    {osSandboxes.length} sandbox{osSandboxes.length !== 1 ? "es" : ""}
                  </span>
                )}
                <button onClick={() => setOsExpanded(!osExpanded)} style={{
                  background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 10,
                  display: "flex", alignItems: "center", gap: 2, padding: "2px 6px",
                }}>
                  {osExpanded ? "▲ Less" : "▼ Details"}
                </button>
              </div>
            </div>

            {/* Expanded details */}
            {osExpanded && (
              <div style={{ padding: "8px 14px 12px" }}>
                {osInstalled && osSandboxes.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                    <div style={{ fontSize: 9, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Active Sandboxes</div>
                    {osSandboxes.map((sb, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 8px", background: "var(--bg)", borderRadius: 6, border: "1px solid var(--border)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: sb.status === "running" ? "#4ade80" : sb.status === "stopped" ? "#fbbf24" : "var(--text-muted)" }} />
                          <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text)", fontFamily: MONO }}>{sb.name}</span>
                        </div>
                        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{sb.status}{sb.image ? ` · ${sb.image}` : ""}</span>
                      </div>
                    ))}
                  </div>
                ) : osInstalled ? (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "8px 0" }}>
                    No sandboxes created yet. Toggle sandbox mode to create one.
                  </div>
                ) : null}

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button onClick={async () => { await Promise.all([checkOsInstalled(), checkDocker()]); await loadOsSandboxes(); await loadSandboxMode(); }} style={BTN_GHOST}>
                    <RefreshCw style={{ width: 10, height: 10 }} /> Refresh
                  </button>
                  {osInstalled && osSandboxes.length > 0 && (
                    <button onClick={handleViewLogs} disabled={osLogsLoading} style={{ ...BTN_GHOST, opacity: osLogsLoading ? 0.5 : 1 }}>
                      {osLogsLoading && <Loader2 style={{ width: 10, height: 10, animation: "_spin 1s linear infinite" }} />}
                      View Logs
                    </button>
                  )}
                </div>

                {osLogs !== null && (
                  <pre style={{
                    marginTop: 8, padding: 10, borderRadius: 6, background: "var(--bg)", border: "1px solid var(--border)",
                    fontSize: 10, color: "var(--text-muted)", fontFamily: MONO, maxHeight: 200, overflowY: "auto",
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>{osLogs}</pre>
                )}

                <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 6, background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.1)" }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "var(--accent)", marginBottom: 4 }}>About OpenShell</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.5 }}>
                    <a href="https://github.com/NVIDIA/OpenShell" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 3 }}>
                      NVIDIA OpenShell <ExternalLink style={{ width: 9, height: 9 }} />
                    </a> provides
                    sandboxed execution environments with policy-enforced egress routing, filesystem isolation, and process constraints.
                    Each sandbox runs inside a container with kernel-level security (Landlock, seccomp, OPA policy proxy).
                  </div>
                </div>

                {!osInstalled && (
                  <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 6, background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Install Manually</div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.6, fontFamily: MONO }}>
                      # Recommended (requires uv)<br />
                      uv tool install -U openshell<br /><br />
                      # Or via pip<br />
                      pip install -U openshell
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── OpenClaw Sandbox Containers ── */}
          <SectionHeader title="Sandbox Containers" icon={<Terminal style={{ width: 12, height: 12, color: "var(--text-muted)" }} />} />
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
                    <p style={{ margin: 0, fontSize: 12, color: "var(--text)", fontFamily: MONO }}>{c.name || c.id}</p>
                    {c.image && <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)" }}>{c.image}</p>}
                  </div>
                  <StatusBadge status={c.status} />
                </div>
              ))
            )}
          </div>

          {/* ── Browser Instances ── */}
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
                    <p style={{ margin: 0, fontSize: 12, color: "var(--text)", fontFamily: MONO }}>{b.id}</p>
                    {b.url && <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)" }}>{b.url}</p>}
                  </div>
                  <StatusBadge status={b.status} />
                </div>
              ))
            )}
          </div>

          {/* ── Tool Permissions ── */}
          <SectionHeader title="Tool Permissions" icon={<Shield style={{ width: 12, height: 12, color: "var(--text-muted)" }} />} />
          <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 16 }}>
            {toolPermissions && Object.keys(toolPermissions).length > 0 ? (
              Object.entries(toolPermissions).map(([key, value], i, arr) => (
                <div key={key} style={{ padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <span style={{ fontSize: 12, fontFamily: MONO, color: "var(--text)" }}>{key}</span>
                  <PermissionValue value={value} />
                </div>
              ))
            ) : (
              <div style={{ padding: "14px 12px", textAlign: "center" }}>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: 0 }}>No tool permissions configured</p>
              </div>
            )}
          </div>

          {/* ── Sandbox Policy ── */}
          <SectionHeader title="Sandbox Policy" icon={<Info style={{ width: 12, height: 12, color: "var(--text-muted)" }} />} />
          <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 16 }}>
            <button onClick={() => setShowPolicy(!showPolicy)} style={{ width: "100%", padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "none", border: "none", cursor: "pointer" }}>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{showPolicy ? "Hide" : "Show"} sandbox policy details</span>
              {showPolicy ? <ChevronDown style={{ width: 12, height: 12, color: "var(--text-muted)" }} /> : <ChevronRight style={{ width: 12, height: 12, color: "var(--text-muted)" }} />}
            </button>
            {showPolicy && policy && (
              <div style={{ padding: "0 12px 12px" }}>
                <pre style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.6)", fontFamily: MONO, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
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
    return <span style={{ fontSize: 11, color: value ? "var(--success)" : "var(--error)", fontFamily: MONO }}>{value ? "allowed" : "denied"}</span>;
  }
  if (Array.isArray(value)) {
    return (
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {value.map((v, i) => (
          <span key={i} style={{ fontSize: 10, color: "var(--accent)", background: "rgba(59,130,246,0.15)", padding: "2px 6px", borderRadius: 4, fontFamily: MONO }}>{String(v)}</span>
        ))}
      </div>
    );
  }
  return <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", fontFamily: MONO }}>{JSON.stringify(value)}</span>;
}
