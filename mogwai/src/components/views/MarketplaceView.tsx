import { useState, useEffect, useCallback, useRef } from "react";
import {
  Search, Loader2, CheckCircle, AlertTriangle, ExternalLink,
  RefreshCw, Package, ShieldAlert, Plug, Zap, Stethoscope,
  ChevronDown, ChevronUp, Check, X,
  Play, Square, Download, Upload, RotateCw, Globe, Tag,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { cachedCommand } from "@/lib/cache";

// ─── Types ──────────────────────────────────────────────────────

type TabId = "skills" | "plugins" | "powerup" | "clawhub";

interface SkillMissing {
  bins: string[];
  anyBins: string[];
  env: string[];
  config: string[];
  os: string[];
}

interface Skill {
  name: string;
  description: string;
  emoji: string;
  eligible: boolean;
  disabled: boolean;
  source: string;
  bundled: boolean;
  homepage?: string;
  missing: SkillMissing;
}

interface Plugin {
  id: string;
  name: string;
  description: string;
  version: string;
  origin: string;
  enabled: boolean;
  status: string;
}

interface PowerUpStep {
  id: string;
  label: string;
  command: string;
  status: "pending" | "running" | "success" | "error";
  output?: string;
}

// ─── Helpers ────────────────────────────────────────────────────

async function runCommand(command: string) {
  return invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
    command,
    cwd: null,
  });
}

function parseJsonOutput<T>(stdout: string): T | null {
  try {
    const jsonStart = stdout.indexOf("{");
    const jsonEnd = stdout.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) return null;
    return JSON.parse(stdout.substring(jsonStart, jsonEnd + 1));
  } catch {
    try {
      return JSON.parse(stdout);
    } catch {
      return null;
    }
  }
}

// ─── Main Component ─────────────────────────────────────────────

export function MarketplaceView() {
  const [activeTab, setActiveTab] = useState<TabId>("skills");

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "skills", label: "Skills", icon: <Package style={{ width: 12, height: 12 }} /> },
    { id: "plugins", label: "Plugins", icon: <Plug style={{ width: 12, height: 12 }} /> },
    { id: "powerup", label: "Power Up", icon: <Zap style={{ width: 12, height: 12 }} /> },
    { id: "clawhub", label: "ClawHub", icon: <Globe style={{ width: 12, height: 12 }} /> },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <style>{`
        @keyframes mpSpin { to { transform: rotate(360deg); } }
        @keyframes mpPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
      <div style={{
        display: "flex", gap: 2, padding: "12px 20px 0", flexShrink: 0,
        borderBottom: "1px solid var(--border)",
      }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "8px 16px", border: "none", cursor: "pointer",
              fontSize: 11, fontWeight: 500, borderRadius: "6px 6px 0 0",
              background: activeTab === tab.id ? "var(--bg-elevated)" : "transparent",
              color: activeTab === tab.id ? "var(--text)" : "var(--text-muted)",
              borderBottom: activeTab === tab.id ? "2px solid var(--accent)" : "2px solid transparent",
              transition: "all 0.15s ease",
              display: "flex", alignItems: "center", gap: 5,
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "hidden" }}>
        {activeTab === "skills" && <SkillsTab />}
        {activeTab === "plugins" && <PluginsTab />}
        {activeTab === "powerup" && <PowerUpTab />}
        {activeTab === "clawhub" && <ClawHubTab />}
      </div>
    </div>
  );
}

// ─── Toggle Switch ──────────────────────────────────────────────

function ToggleSwitch({ on, loading, onToggle }: {
  on: boolean; loading: boolean; onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={loading}
      style={{
        width: 40, height: 22, borderRadius: 11, border: "none", cursor: loading ? "wait" : "pointer",
        background: on ? "var(--accent)" : "var(--bg-hover)",
        transition: "background 0.2s",
        position: "relative", flexShrink: 0,
        opacity: loading ? 0.5 : 1,
      }}
    >
      <div style={{
        width: 16, height: 16, borderRadius: "50%", background: "var(--text)",
        position: "absolute", top: 3,
        left: on ? 21 : 3,
        transition: "left 0.2s",
      }}>
        {loading && (
          <Loader2 style={{
            width: 10, height: 10, color: "var(--accent)",
            position: "absolute", top: 3, left: 3,
            animation: "mpSpin 1s linear infinite",
          }} />
        )}
      </div>
    </button>
  );
}

// ─── Section Header ─────────────────────────────────────────────

function SectionHeader({ title, count, color }: { title: string; count: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, marginTop: 16 }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <span style={{
        fontSize: 10, textTransform: "uppercase" as const, color: "var(--text-muted)",
        letterSpacing: 1, fontWeight: 600,
      }}>
        {title}
      </span>
      <span style={{
        fontSize: 9, padding: "1px 6px", borderRadius: 8,
        background: `${color}20`, color,
      }}>
        {count}
      </span>
    </div>
  );
}

// ─── Search Bar ─────────────────────────────────────────────────

function SearchBar({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div style={{ position: "relative", marginTop: 10 }}>
      <Search style={{
        position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
        width: 14, height: 14, color: "var(--text-muted)",
      }} />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%", padding: "7px 12px 7px 32px", borderRadius: 8,
          background: "var(--bg-elevated)", border: "1px solid var(--border)",
          color: "var(--text)", fontSize: 12, outline: "none",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

// ─── Status Badge ───────────────────────────────────────────────

function StatusBadge({ label, color, icon }: {
  label: string; color: string; icon?: React.ReactNode;
}) {
  return (
    <span style={{
      fontSize: 9, padding: "1px 6px", borderRadius: 4,
      background: `${color}20`, color,
      display: "inline-flex", alignItems: "center", gap: 3,
      whiteSpace: "nowrap",
    }}>
      {icon}
      {label}
    </span>
  );
}

// ─── Missing Deps Badges ────────────────────────────────────────

const DEP_TITLES: Record<string, string> = {
  "bin": "Required CLI tool not found in PATH. Install it to use this skill.",
  "any-bin": "Needs at least one of these CLI tools. Install one to use this skill.",
  "env": "Required environment variable not set. Add it to your system environment.",
  "config": "Missing OpenClaw configuration entry. Run 'openclaw configure' to set it.",
  "os": "This skill requires a different operating system.",
};

function MissingBadges({ missing }: { missing: SkillMissing }) {
  const items: { label: string; values: string[]; color: string }[] = [];
  if (missing.bins?.length > 0) items.push({ label: "bin", values: missing.bins, color: "var(--error)" });
  if (missing.anyBins?.length > 0) items.push({ label: "any-bin", values: missing.anyBins, color: "#fb923c" });
  if (missing.env?.length > 0) items.push({ label: "env", values: missing.env, color: "var(--warning)" });
  if (missing.config?.length > 0) items.push({ label: "config", values: missing.config, color: "#fb923c" });
  if (missing.os?.length > 0) items.push({ label: "os", values: missing.os, color: "#a78bfa" });
  if (items.length === 0) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
      {items.map((item) =>
        item.values.map((v) => (
          <span
            key={`${item.label}-${v}`}
            title={DEP_TITLES[item.label] ?? ""}
            style={{
              fontSize: 9, padding: "2px 6px", borderRadius: 4,
              background: `${item.color}15`, color: item.color,
              display: "inline-flex", alignItems: "center", gap: 3,
            }}
          >
            <ShieldAlert style={{ width: 8, height: 8 }} />
            {item.label}: {v}
          </span>
        ))
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 1: Skills
// ═══════════════════════════════════════════════════════════════

const MACOS_ONLY_SKILLS = new Set([
  "things-mac", "apple-reminders", "apple-notes", "apple-calendar",
  "apple-contacts", "apple-mail", "apple-music", "apple-shortcuts",
  "apple-maps", "imessage", "macos-notifications", "macos-location",
  "macos-screen", "macos-camera", "raycast", "hazel",
]);

const API_KEY_SKILLS = new Set([
  "openai-image-gen", "openai-whisper-api", "openai-tts",
  "elevenlabs", "spotify-player", "notion", "trello",
  "linear", "gmail-pubsub",
]);

type SkillFilter = "all" | "ready" | "no-key";

function SkillsTab() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingSkills, setTogglingSkills] = useState<Set<string>>(new Set());
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [filter, setFilter] = useState<SkillFilter>("all");

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "openclaw skills list --json",
        cwd: null,
      });
      if (result.code !== 0) {
        setError(result.stderr || "Failed to list skills");
        return;
      }
      const data = parseJsonOutput<{ skills: Skill[] }>(result.stdout);
      setSkills(data?.skills ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load skills");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  const formatMissingForConfirm = (missing: SkillMissing): string => {
    const parts: string[] = [];
    if (missing.bins?.length) parts.push(`• bin: ${missing.bins.join(", ")}`);
    if (missing.anyBins?.length) parts.push(`• any-bin: ${missing.anyBins.join(", ")}`);
    if (missing.env?.length) parts.push(`• env: ${missing.env.join(", ")}`);
    if (missing.config?.length) parts.push(`• config: ${missing.config.join(", ")}`);
    if (missing.os?.length) parts.push(`• os: ${missing.os.join(", ")}`);
    return parts.join("\n");
  };

  const toggleSkill = async (skill: Skill) => {
    if (skill.disabled && !skill.eligible && skill.missing) {
      const missingList = formatMissingForConfirm(skill.missing);
      const msg = `This skill has missing dependencies:\n\n${missingList}\n\nEnable anyway? It may not work correctly until dependencies are installed.`;
      if (!window.confirm(msg)) return;
    }
    setTogglingSkills((s) => new Set(s).add(skill.name));
    try {
      const action = skill.disabled ? "enable" : "disable";
      const result = await runCommand(`openclaw skills ${action} ${skill.name}`);
      if (result.code !== 0) {
        window.alert(`Failed to ${action} ${skill.name}: ${result.stderr || result.stdout}`);
      }
    } catch (e) {
      window.alert(`Failed to toggle ${skill.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await loadSkills();
    setTogglingSkills((s) => {
      const next = new Set(s);
      next.delete(skill.name);
      return next;
    });
  };

  const refreshCheck = async () => {
    setLoading(true);
    try {
      await runCommand("openclaw skills check --json");
      await loadSkills();
    } catch {
      setLoading(false);
    }
  };

  const filtered = skills.filter((s) => {
    if (MACOS_ONLY_SKILLS.has(s.name) || s.missing?.os?.some(o => o.toLowerCase().includes("darwin") || o.toLowerCase().includes("macos"))) return false;
    if (filter === "no-key" && API_KEY_SKILLS.has(s.name)) return false;
    if (filter === "ready" && (s.disabled || !s.eligible)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return s.name.toLowerCase().includes(q)
      || s.description.toLowerCase().includes(q)
      || s.source.toLowerCase().includes(q);
  });

  const ready = filtered.filter((s) => s.eligible && !s.disabled);
  const available = filtered.filter((s) => !s.eligible || s.disabled);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "14px 20px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Skills</h2>
            <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted)" }}>
              {skills.length} skills &middot; {skills.filter((s) => s.eligible && !s.disabled).length} ready
            </p>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={refreshCheck}
              disabled={loading}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
                borderRadius: 6, border: "none", fontSize: 10, cursor: "pointer",
                background: "var(--border)", color: "var(--text-muted)",
              }}
            >
              <RefreshCw style={{ width: 10, height: 10 }} />
              Check
            </button>
            <button
              onClick={loadSkills}
              disabled={loading}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
                borderRadius: 6, border: "none", fontSize: 10, cursor: "pointer",
                background: "var(--accent-bg)", color: "var(--accent-hover)",
              }}
            >
              <RefreshCw style={{ width: 10, height: 10 }} />
              Refresh
            </button>
          </div>
        </div>
        <SearchBar value={search} onChange={setSearch} placeholder="Search skills..." />
        <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
          {([
            { id: "all", label: "All" },
            { id: "ready", label: "Ready to Use" },
            { id: "no-key", label: "No API Key Needed" },
          ] as { id: SkillFilter; label: string }[]).map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              style={{
                padding: "3px 10px", borderRadius: 6, border: "none", fontSize: 10, cursor: "pointer",
                background: filter === f.id ? "rgba(59,130,246,0.18)" : "var(--border)",
                color: filter === f.id ? "var(--accent)" : "var(--text-muted)",
                fontWeight: filter === f.id ? 600 : 400,
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "0 20px 16px" }}>
        {loading ? (
          <LoadingSpinner />
        ) : error ? (
          <ErrorMessage message={error} onRetry={loadSkills} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Package style={{ width: 28, height: 28, color: "var(--text-muted)" }} />} message="No skills found" />
        ) : (
          <>
            {ready.length > 0 && (
              <>
                <SectionHeader title="Ready Skills" count={ready.length} color="var(--success)" />
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {ready.map((skill) => (
                    <SkillCard
                      key={skill.name}
                      skill={skill}
                      toggling={togglingSkills.has(skill.name)}
                      onToggle={() => toggleSkill(skill)}
                      expanded={expandedSkill === skill.name}
                      onExpand={() => setExpandedSkill(expandedSkill === skill.name ? null : skill.name)}
                    />
                  ))}
                </div>
              </>
            )}
            {available.length > 0 && (
              <>
                <SectionHeader title="Available Skills" count={available.length} color="var(--warning)" />
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {available.map((skill) => (
                    <SkillCard
                      key={skill.name}
                      skill={skill}
                      toggling={togglingSkills.has(skill.name)}
                      onToggle={() => toggleSkill(skill)}
                      expanded={expandedSkill === skill.name}
                      onExpand={() => setExpandedSkill(expandedSkill === skill.name ? null : skill.name)}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SkillCard({ skill, toggling, onToggle, expanded, onExpand }: {
  skill: Skill; toggling: boolean; onToggle: () => void;
  expanded: boolean; onExpand: () => void;
}) {
  return (
    <div style={{
      background: "var(--bg-elevated)",
      border: "1px solid var(--border)",
      borderRadius: 10, overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px" }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8, background: "var(--border)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18, flexShrink: 0,
        }}>
          {skill.emoji}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{skill.name}</span>
            {skill.disabled ? (
              <StatusBadge label="Disabled" color="#6b7280" icon={<Square style={{ width: 8, height: 8 }} />} />
            ) : skill.eligible ? (
              <StatusBadge label="Ready" color="var(--success)" icon={<CheckCircle style={{ width: 8, height: 8 }} />} />
            ) : (
              <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
                <StatusBadge label="Missing deps" color="var(--warning)" icon={<AlertTriangle style={{ width: 8, height: 8 }} />} />
                <span style={{ fontSize: 9, color: "var(--warning)" }}>Some dependencies need to be installed</span>
              </span>
            )}
            {API_KEY_SKILLS.has(skill.name) && (
              <StatusBadge label="API key required" color="#fb923c" icon={<span style={{ fontSize: 7 }}>🔑</span>} />
            )}
            <span style={{
              fontSize: 9, padding: "1px 6px", borderRadius: 4,
              background: "var(--border)", color: "var(--text-muted)",
            }}>
              {skill.source}
            </span>
          </div>
          <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.4 }}>
            {skill.description}
          </p>
          {!skill.eligible && !skill.disabled && skill.missing && <MissingBadges missing={skill.missing} />}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <ToggleSwitch on={!skill.disabled} loading={toggling} onToggle={onToggle} />
          <button
            onClick={onExpand}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--text-muted)", padding: 2, display: "flex",
            }}
          >
            {expanded
              ? <ChevronUp style={{ width: 14, height: 14 }} />
              : <ChevronDown style={{ width: 14, height: 14 }} />
            }
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{
          padding: "8px 12px 10px", borderTop: "1px solid var(--border)",
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <DetailRow label="Source" value={skill.source} />
            <DetailRow label="Bundled" value={skill.bundled ? "Yes" : "No"} />
            <DetailRow label="Eligible" value={skill.eligible ? "Yes" : "No"} />
            {skill.homepage && (
              <div style={{ marginTop: 4 }}>
                <a
                  href={skill.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 11, color: "var(--accent-hover)", textDecoration: "none",
                    display: "inline-flex", alignItems: "center", gap: 4,
                  }}
                >
                  <ExternalLink style={{ width: 11, height: 11 }} />
                  Homepage
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 2: Plugins
// ═══════════════════════════════════════════════════════════════

function PluginsTab() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingPlugins, setTogglingPlugins] = useState<Set<string>>(new Set());
  const [doctorRunning, setDoctorRunning] = useState(false);
  const [doctorOutput, setDoctorOutput] = useState<string | null>(null);

  const loadPlugins = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "openclaw plugins list --json",
        cwd: null,
      });
      if (result.code !== 0) {
        setError(result.stderr || "Failed to list plugins");
        return;
      }
      const data = parseJsonOutput<{ plugins: Plugin[] }>(result.stdout);
      setPlugins(data?.plugins ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load plugins");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPlugins(); }, [loadPlugins]);

  const togglePlugin = async (plugin: Plugin) => {
    setTogglingPlugins((s) => new Set(s).add(plugin.id));
    try {
      const action = plugin.enabled ? "disable" : "enable";
      const result = await runCommand(`openclaw plugins ${action} ${plugin.id}`);
      if (result.code !== 0) {
        setError(`Failed to ${action} ${plugin.name}: ${result.stderr || result.stdout}`);
      }
    } catch (e) {
      setError(`Failed to toggle ${plugin.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await loadPlugins();
    setTogglingPlugins((s) => {
      const next = new Set(s);
      next.delete(plugin.id);
      return next;
    });
  };

  const runDoctor = async () => {
    setDoctorRunning(true);
    setDoctorOutput(null);
    try {
      const result = await runCommand("openclaw plugins doctor");
      setDoctorOutput(result.stdout || result.stderr || "Doctor completed.");
    } catch (e) {
      setDoctorOutput(e instanceof Error ? e.message : "Doctor failed");
    }
    setDoctorRunning(false);
  };

  const filtered = plugins.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q)
      || p.description.toLowerCase().includes(q)
      || p.id.toLowerCase().includes(q);
  });

  const statusColor = (status: string) => {
    switch (status) {
      case "loaded": return "var(--success)";
      case "disabled": return "#6b7280";
      case "error": return "var(--error)";
      default: return "var(--text-muted)";
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "14px 20px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Plugins</h2>
            <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted)" }}>
              {plugins.length} plugins &middot; {plugins.filter((p) => p.enabled).length} enabled
            </p>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={runDoctor}
              disabled={doctorRunning}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
                borderRadius: 6, border: "none", fontSize: 10, cursor: "pointer",
                background: "rgba(251,191,36,0.12)", color: "var(--warning)",
                opacity: doctorRunning ? 0.6 : 1,
              }}
            >
              <Stethoscope style={{ width: 10, height: 10 }} />
              {doctorRunning ? "Running..." : "Doctor"}
            </button>
            <button
              onClick={loadPlugins}
              disabled={loading}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
                borderRadius: 6, border: "none", fontSize: 10, cursor: "pointer",
                background: "var(--accent-bg)", color: "var(--accent-hover)",
              }}
            >
              <RefreshCw style={{ width: 10, height: 10 }} />
              Refresh
            </button>
          </div>
        </div>
        <SearchBar value={search} onChange={setSearch} placeholder="Search plugins..." />
      </div>

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "0 20px 16px" }}>
        {doctorOutput && (
          <div style={{
            background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.15)",
            borderRadius: 8, padding: "10px 12px", marginBottom: 12, marginTop: 4,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: "var(--warning)", textTransform: "uppercase", letterSpacing: 1 }}>
                Doctor Results
              </span>
              <button
                onClick={() => setDoctorOutput(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}
              >
                <X style={{ width: 12, height: 12 }} />
              </button>
            </div>
            <pre style={{
              fontSize: 10, color: "var(--text-secondary)", margin: 0,
              whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "monospace",
              maxHeight: 200, overflowY: "auto",
            }}>
              {doctorOutput}
            </pre>
          </div>
        )}

        {loading ? (
          <LoadingSpinner />
        ) : error ? (
          <ErrorMessage message={error} onRetry={loadPlugins} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Plug style={{ width: 28, height: 28, color: "var(--text-muted)" }} />} message="No plugins found" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
            {filtered.map((plugin) => (
              <div
                key={plugin.id}
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: 10, padding: "10px 12px",
                  display: "flex", alignItems: "flex-start", gap: 10,
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 8, background: "var(--border)",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  <Plug style={{ width: 16, height: 16, color: plugin.enabled ? "var(--accent-hover)" : "var(--text-muted)" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{plugin.name}</span>
                    <StatusBadge label={plugin.status} color={statusColor(plugin.status)} />
                    <span style={{
                      fontSize: 9, padding: "1px 6px", borderRadius: 4,
                      background: "var(--border)", color: "var(--text-muted)",
                    }}>
                      {plugin.origin}
                    </span>
                  </div>
                  <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.4 }}>
                    {plugin.description}
                  </p>
                  <span style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 4, display: "inline-block" }}>
                    v{plugin.version}
                  </span>
                </div>
                <ToggleSwitch
                  on={plugin.enabled}
                  loading={togglingPlugins.has(plugin.id)}
                  onToggle={() => togglePlugin(plugin)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 3: Power Up
// ═══════════════════════════════════════════════════════════════

function PowerUpTab() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [steps, setSteps] = useState<PowerUpStep[]>([]);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [skillsResult, pluginsResult] = await Promise.all([
        cachedCommand("openclaw skills list --json", { ttl: 30_000 }),
        cachedCommand("openclaw plugins list --json", { ttl: 30_000 }),
      ]);
      if (skillsResult.code === 0) {
        const sd = parseJsonOutput<{ skills: Skill[] }>(skillsResult.stdout);
        setSkills(sd?.skills ?? []);
      }
      if (pluginsResult.code === 0) {
        const pd = parseJsonOutput<{ plugins: Plugin[] }>(pluginsResult.stdout);
        setPlugins(pd?.plugins ?? []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const disabledPlugins = plugins.filter((p) => !p.enabled);
  const disabledSkills = skills.filter((s) => s.disabled);

  const buildSteps = (): PowerUpStep[] => {
    const s: PowerUpStep[] = [];
    s.push({
      id: "setup",
      label: "Run OpenClaw setup",
      command: "openclaw setup --non-interactive --mode local --accept-risk",
      status: "pending",
    });
    for (const p of disabledPlugins) {
      s.push({
        id: `plugin-${p.id}`,
        label: `Enable plugin: ${p.name}`,
        command: `openclaw plugins enable ${p.id}`,
        status: "pending",
      });
    }
    for (const sk of disabledSkills) {
      s.push({
        id: `skill-${sk.name}`,
        label: `Enable skill: ${sk.name}`,
        command: `openclaw skills enable ${sk.name}`,
        status: "pending",
      });
    }
    s.push({
      id: "security",
      label: "Security audit & fix",
      command: "openclaw security audit --fix",
      status: "pending",
    });
    s.push({
      id: "reindex",
      label: "Reindex memory",
      command: "openclaw memory index --force",
      status: "pending",
    });
    return s;
  };

  const runPowerUp = async () => {
    const allSteps = buildSteps();
    setSteps(allSteps);
    setRunning(true);
    setCompleted(false);

    for (let i = 0; i < allSteps.length; i++) {
      setSteps((prev) => prev.map((s, idx) =>
        idx === i ? { ...s, status: "running" as const } : s
      ));

      try {
        const result = await runCommand(allSteps[i].command);
        const success = result.code === 0;
        setSteps((prev) => prev.map((s, idx) =>
          idx === i ? {
            ...s,
            status: success ? "success" as const : "error" as const,
            output: success ? (result.stdout || "Done") : (result.stderr || result.stdout || "Failed"),
          } : s
        ));
      } catch (e) {
        setSteps((prev) => prev.map((s, idx) =>
          idx === i ? {
            ...s,
            status: "error" as const,
            output: e instanceof Error ? e.message : "Failed",
          } : s
        ));
      }

      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }

    setRunning(false);
    setCompleted(true);
  };

  const successCount = steps.filter((s) => s.status === "success").length;
  const errorCount = steps.filter((s) => s.status === "error").length;
  const previewSteps = buildSteps();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "14px 20px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>
              <Zap style={{ width: 14, height: 14, display: "inline", verticalAlign: "middle", marginRight: 6, color: "var(--warning)" }} />
              Power Up
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted)" }}>
              One-click setup to enable everything possible
            </p>
          </div>
          {!running && (
            <button
              onClick={runPowerUp}
              disabled={loading}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "6px 16px",
                borderRadius: 8, border: "none", fontSize: 11, fontWeight: 600, cursor: "pointer",
                background: "linear-gradient(135deg, var(--accent), #8B5CF6)",
                color: "var(--text)", transition: "opacity 0.2s",
                opacity: loading ? 0.5 : 1,
              }}
            >
              <Play style={{ width: 12, height: 12 }} />
              {completed ? "Run Again" : "Enable All"}
            </button>
          )}
          {running && (
            <span style={{
              fontSize: 10, color: "var(--warning)", display: "flex", alignItems: "center", gap: 6,
            }}>
              <Loader2 style={{ width: 12, height: 12, animation: "mpSpin 1s linear infinite" }} />
              Running...
            </span>
          )}
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "0 20px 16px" }}>
        {loading ? (
          <LoadingSpinner />
        ) : steps.length === 0 ? (
          <>
            <SectionHeader title="Actions to perform" count={previewSteps.length} color="var(--accent)" />
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {previewSteps.map((step) => (
                <div
                  key={step.id}
                  style={{
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border)",
                    borderRadius: 10, padding: "10px 12px",
                    display: "flex", alignItems: "center", gap: 10,
                  }}
                >
                  <div style={{
                    width: 20, height: 20, borderRadius: 4,
                    border: "1px solid var(--border)", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Check style={{ width: 12, height: 12, color: "var(--accent)" }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{step.label}</span>
                    <p style={{ margin: "2px 0 0", fontSize: 9, color: "var(--text-muted)", fontFamily: "monospace" }}>
                      {step.command}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {disabledPlugins.length === 0 && disabledSkills.length === 0 && (
              <div style={{
                marginTop: 12, padding: "10px 12px", borderRadius: 8,
                background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.15)",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <CheckCircle style={{ width: 14, height: 14, color: "var(--success)" }} />
                <span style={{ fontSize: 11, color: "var(--success)" }}>
                  All plugins and skills are already enabled!
                </span>
              </div>
            )}
          </>
        ) : (
          <>
            {completed && (
              <div style={{
                marginBottom: 12, padding: "10px 14px", borderRadius: 8,
                background: errorCount > 0 ? "rgba(251,191,36,0.08)" : "rgba(74,222,128,0.08)",
                border: `1px solid ${errorCount > 0 ? "rgba(251,191,36,0.15)" : "rgba(74,222,128,0.15)"}`,
                display: "flex", alignItems: "center", gap: 8,
              }}>
                {errorCount > 0 ? (
                  <AlertTriangle style={{ width: 14, height: 14, color: "var(--warning)" }} />
                ) : (
                  <CheckCircle style={{ width: 14, height: 14, color: "var(--success)" }} />
                )}
                <span style={{ fontSize: 11, color: errorCount > 0 ? "var(--warning)" : "var(--success)" }}>
                  Completed: {successCount} passed, {errorCount} failed
                </span>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {steps.map((step) => (
                <PowerUpStepCard key={step.id} step={step} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PowerUpStepCard({ step }: { step: PowerUpStep }) {
  const [showOutput, setShowOutput] = useState(false);

  const statusIcon = () => {
    switch (step.status) {
      case "pending":
        return <div style={{ width: 16, height: 16, borderRadius: "50%", border: "1px solid var(--border)" }} />;
      case "running":
        return <Loader2 style={{ width: 16, height: 16, color: "var(--accent)", animation: "mpSpin 1s linear infinite" }} />;
      case "success":
        return <CheckCircle style={{ width: 16, height: 16, color: "var(--success)" }} />;
      case "error":
        return <X style={{ width: 16, height: 16, color: "var(--error)" }} />;
    }
  };

  const bgColor = () => {
    switch (step.status) {
      case "running": return "var(--accent-bg)";
      case "success": return "rgba(74,222,128,0.04)";
      case "error": return "rgba(248,113,113,0.04)";
      default: return "var(--bg-elevated)";
    }
  };

  const borderColor = () => {
    switch (step.status) {
      case "running": return "rgba(59,130,246,0.15)";
      case "success": return "rgba(74,222,128,0.1)";
      case "error": return "rgba(248,113,113,0.1)";
      default: return "var(--border)";
    }
  };

  return (
    <div style={{
      background: bgColor(),
      border: `1px solid ${borderColor()}`,
      borderRadius: 10, overflow: "hidden",
    }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
          cursor: step.output ? "pointer" : "default",
        }}
        onClick={() => step.output && setShowOutput(!showOutput)}
      >
        {statusIcon()}
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{
            fontSize: 12,
            color: step.status === "running"
              ? "var(--text)"
              : step.status === "pending"
                ? "var(--text-muted)"
                : "var(--text-secondary)",
          }}>
            {step.label}
          </span>
          {step.status === "running" && (
            <span style={{
              fontSize: 9, color: "var(--accent)", marginLeft: 8,
              animation: "mpPulse 1.5s ease-in-out infinite",
            }}>
              executing...
            </span>
          )}
        </div>
        {step.output && (
          <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}>
            {showOutput ? <ChevronUp style={{ width: 12, height: 12 }} /> : <ChevronDown style={{ width: 12, height: 12 }} />}
          </button>
        )}
      </div>
      {showOutput && step.output && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "8px 12px" }}>
          <pre style={{
            fontSize: 10, color: "var(--text-secondary)", margin: 0,
            whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "monospace",
            maxHeight: 150, overflowY: "auto",
          }}>
            {step.output}
          </pre>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 4: ClawHub
// ═══════════════════════════════════════════════════════════════

interface ClawHubSkill {
  name: string;
  slug: string;
  version: string;
  tags: string[];
  description: string;
}

function parseClawHubLine(line: string): ClawHubSkill | null {
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

function ClawHubTab() {
  const [subTab, setSubTab] = useState<"search" | "installed" | "publish" | "sync">("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ClawHubSkill[]>([]);
  const [searching, setSearching] = useState(false);
  const [installedSkills, setInstalledSkills] = useState<ClawHubSkill[]>([]);
  const [loadingInstalled, setLoadingInstalled] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<Set<string>>(new Set());
  const [actionOutput, setActionOutput] = useState<string | null>(null);

  const [publishExpanded, setPublishExpanded] = useState(false);
  const [pubSlug, setPubSlug] = useState("");
  const [pubName, setPubName] = useState("");
  const [pubVersion, setPubVersion] = useState("");
  const [pubChangelog, setPubChangelog] = useState("");
  const [pubTags, setPubTags] = useState("");
  const [pubPath, setPubPath] = useState(".");
  const [publishing, setPublishing] = useState(false);

  const [syncPreview, setSyncPreview] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const doSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setActionOutput(null);
    try {
      const result = await runCommand(`clawhub search "${searchQuery}" --limit 20`);
      if (result.code === 0 && result.stdout.trim()) {
        const lines = result.stdout.trim().split("\n");
        const parsed = lines.map(parseClawHubLine).filter(Boolean) as ClawHubSkill[];
        setSearchResults(parsed.length > 0 ? parsed : [{ name: "raw output", slug: "", version: "", tags: [], description: result.stdout.trim().slice(0, 200) }]);
      } else {
        setSearchResults([]);
        setActionOutput(result.stderr || "No results found.");
      }
    } catch (e) {
      setActionOutput(e instanceof Error ? e.message : "Search failed");
    }
    setSearching(false);
  };

  const loadInstalled = useCallback(async () => {
    setLoadingInstalled(true);
    try {
      const result = await runCommand("clawhub list");
      if (result.code === 0 && result.stdout.trim()) {
        const lines = result.stdout.trim().split("\n");
        const parsed = lines.map(parseClawHubLine).filter(Boolean) as ClawHubSkill[];
        setInstalledSkills(parsed);
      } else {
        setInstalledSkills([]);
      }
    } catch { setInstalledSkills([]); }
    setLoadingInstalled(false);
  }, []);

  useEffect(() => { if (subTab === "installed") loadInstalled(); }, [subTab, loadInstalled]);

  const installSkill = async (slug: string) => {
    setActionInProgress(s => new Set(s).add(slug));
    setActionOutput(null);
    try {
      const result = await runCommand(`clawhub install ${slug} --force`);
      setActionOutput(result.code === 0 ? (result.stdout.trim() || `Installed ${slug}`) : (result.stderr || result.stdout || "Install failed"));
    } catch (e) { setActionOutput(e instanceof Error ? e.message : "Install failed"); }
    setActionInProgress(s => { const n = new Set(s); n.delete(slug); return n; });
  };

  const updateSkill = async (slug: string) => {
    setActionInProgress(s => new Set(s).add(slug));
    setActionOutput(null);
    try {
      const result = await runCommand(`clawhub update ${slug}`);
      setActionOutput(result.code === 0 ? (result.stdout.trim() || `Updated ${slug}`) : (result.stderr || result.stdout || "Update failed"));
    } catch (e) { setActionOutput(e instanceof Error ? e.message : "Update failed"); }
    setActionInProgress(s => { const n = new Set(s); n.delete(slug); return n; });
  };

  const updateAll = async () => {
    setActionInProgress(s => new Set(s).add("__all__"));
    setActionOutput(null);
    try {
      const result = await runCommand("clawhub update --all");
      setActionOutput(result.code === 0 ? (result.stdout.trim() || "All skills updated") : (result.stderr || result.stdout || "Update all failed"));
    } catch (e) { setActionOutput(e instanceof Error ? e.message : "Update all failed"); }
    setActionInProgress(s => { const n = new Set(s); n.delete("__all__"); return n; });
    await loadInstalled();
  };

  const doPublish = async () => {
    if (!pubSlug.trim()) return;
    setPublishing(true);
    setActionOutput(null);
    try {
      let cmd = `clawhub publish ${pubPath} --slug ${pubSlug}`;
      if (pubName.trim()) cmd += ` --name "${pubName}"`;
      if (pubVersion.trim()) cmd += ` --version ${pubVersion}`;
      if (pubChangelog.trim()) cmd += ` --changelog "${pubChangelog}"`;
      if (pubTags.trim()) cmd += ` --tags ${pubTags}`;
      const result = await runCommand(cmd);
      setActionOutput(result.code === 0 ? (result.stdout.trim() || "Published successfully") : (result.stderr || result.stdout || "Publish failed"));
    } catch (e) { setActionOutput(e instanceof Error ? e.message : "Publish failed"); }
    setPublishing(false);
  };

  const doSyncPreview = async () => {
    setSyncing(true);
    setSyncPreview(null);
    try {
      const result = await runCommand("clawhub sync --all --dry-run");
      setSyncPreview(result.code === 0 ? (result.stdout.trim() || "Nothing to sync.") : (result.stderr || result.stdout || "Sync preview failed"));
    } catch (e) { setSyncPreview(e instanceof Error ? e.message : "Sync preview failed"); }
    setSyncing(false);
  };

  const doSyncConfirm = async () => {
    setSyncing(true);
    setActionOutput(null);
    try {
      const result = await runCommand("clawhub sync --all");
      setActionOutput(result.code === 0 ? (result.stdout.trim() || "Sync complete") : (result.stderr || result.stdout || "Sync failed"));
      setSyncPreview(null);
    } catch (e) { setActionOutput(e instanceof Error ? e.message : "Sync failed"); }
    setSyncing(false);
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "7px 12px", borderRadius: 8,
    background: "var(--bg-elevated)", border: "1px solid var(--border)",
    color: "var(--text)", fontSize: 12, outline: "none",
    boxSizing: "border-box",
  };

  const btnPrimary: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 4, padding: "5px 12px",
    borderRadius: 6, border: "none", fontSize: 10, fontWeight: 500, cursor: "pointer",
    background: "var(--accent-bg)", color: "var(--accent-hover)",
  };

  const btnGhost: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 4, padding: "5px 12px",
    borderRadius: 6, border: "none", fontSize: 10, cursor: "pointer",
    background: "var(--border)", color: "var(--text-muted)",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "14px 20px 10px", flexShrink: 0 }}>
        <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>
          <Globe style={{ width: 14, height: 14, display: "inline", verticalAlign: "middle", marginRight: 6, color: "var(--accent)" }} />
          ClawHub
        </h2>
        <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted)" }}>
          Skill registry — search, install, update & publish
        </p>
        <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
          {([
            { id: "search", label: "Search", icon: <Search style={{ width: 9, height: 9 }} /> },
            { id: "installed", label: "Installed", icon: <Package style={{ width: 9, height: 9 }} /> },
            { id: "publish", label: "Publish", icon: <Upload style={{ width: 9, height: 9 }} /> },
            { id: "sync", label: "Sync", icon: <RotateCw style={{ width: 9, height: 9 }} /> },
          ] as { id: typeof subTab; label: string; icon: React.ReactNode }[]).map(t => (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              style={{
                padding: "4px 12px", borderRadius: 6, border: "none", fontSize: 10, cursor: "pointer",
                background: subTab === t.id ? "rgba(59,130,246,0.18)" : "var(--border)",
                color: subTab === t.id ? "var(--accent)" : "var(--text-muted)",
                fontWeight: subTab === t.id ? 600 : 400,
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "0 20px 16px" }}>
        {/* Action output */}
        {actionOutput && (
          <div style={{
            background: "var(--bg-elevated)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "8px 12px", marginBottom: 10, marginTop: 4,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 9, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1 }}>Output</span>
              <button onClick={() => setActionOutput(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}>
                <X style={{ width: 12, height: 12 }} />
              </button>
            </div>
            <pre style={{ fontSize: 10, color: "var(--text-secondary)", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "monospace", maxHeight: 150, overflowY: "auto" }}>
              {actionOutput}
            </pre>
          </div>
        )}

        {/* ── Search sub-tab ── */}
        {subTab === "search" && (
          <>
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <div style={{ position: "relative", flex: 1 }}>
                <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "var(--text-muted)" }} />
                <input
                  type="text" placeholder="Search ClawHub skills..."
                  value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") doSearch(); }}
                  style={{ ...inputStyle, paddingLeft: 32 }}
                />
              </div>
              <button onClick={doSearch} disabled={searching} style={btnPrimary}>
                {searching ? <Loader2 style={{ width: 10, height: 10, animation: "mpSpin 1s linear infinite" }} /> : <Search style={{ width: 10, height: 10 }} />}
                Search
              </button>
            </div>
            {searching ? (
              <LoadingSpinner />
            ) : searchResults.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                <SectionHeader title="Search Results" count={searchResults.length} color="var(--accent)" />
                {searchResults.map((skill, i) => (
                  <div key={`${skill.slug}-${i}`} style={{
                    background: "var(--bg-elevated)", border: "1px solid var(--border)",
                    borderRadius: 10, padding: "10px 12px",
                    display: "flex", alignItems: "flex-start", gap: 10,
                  }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: "var(--border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Globe style={{ width: 16, height: 16, color: "var(--accent)" }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{skill.name}</span>
                        {skill.slug && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "var(--border)", color: "var(--text-muted)", fontFamily: "monospace" }}>{skill.slug}</span>}
                        {skill.version && <span style={{ fontSize: 9, color: "var(--text-muted)" }}>v{skill.version}</span>}
                      </div>
                      <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.4 }}>{skill.description}</p>
                      {skill.tags.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 4 }}>
                          {skill.tags.map(tag => (
                            <span key={tag} style={{ fontSize: 8, padding: "1px 5px", borderRadius: 4, background: "rgba(59,130,246,0.08)", color: "var(--accent)" }}>
                              <Tag style={{ width: 7, height: 7, display: "inline", verticalAlign: "middle", marginRight: 2 }} />{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {skill.slug && (
                      <button
                        onClick={() => installSkill(skill.slug)}
                        disabled={actionInProgress.has(skill.slug)}
                        style={{ ...btnPrimary, flexShrink: 0, opacity: actionInProgress.has(skill.slug) ? 0.5 : 1 }}
                      >
                        {actionInProgress.has(skill.slug) ? <Loader2 style={{ width: 10, height: 10, animation: "mpSpin 1s linear infinite" }} /> : <Download style={{ width: 10, height: 10 }} />}
                        Install
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}

        {/* ── Installed sub-tab ── */}
        {subTab === "installed" && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4, marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{installedSkills.length} installed</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={updateAll} disabled={actionInProgress.has("__all__")} style={btnPrimary}>
                  {actionInProgress.has("__all__") ? <Loader2 style={{ width: 10, height: 10, animation: "mpSpin 1s linear infinite" }} /> : <RotateCw style={{ width: 10, height: 10 }} />}
                  Update All
                </button>
                <button onClick={loadInstalled} disabled={loadingInstalled} style={btnGhost}>
                  <RefreshCw style={{ width: 10, height: 10 }} /> Refresh
                </button>
              </div>
            </div>
            {loadingInstalled ? <LoadingSpinner /> : installedSkills.length === 0 ? (
              <EmptyState icon={<Package style={{ width: 28, height: 28, color: "var(--text-muted)" }} />} message="No ClawHub skills installed" />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {installedSkills.map((skill, i) => (
                  <div key={`${skill.slug}-${i}`} style={{
                    background: "var(--bg-elevated)", border: "1px solid var(--border)",
                    borderRadius: 10, padding: "10px 12px",
                    display: "flex", alignItems: "center", gap: 10,
                  }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: "var(--border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Package style={{ width: 16, height: 16, color: "var(--success)" }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{skill.name}</span>
                        <StatusBadge label={`v${skill.version}`} color="var(--text-muted)" />
                      </div>
                      <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-secondary)" }}>{skill.description || skill.slug}</p>
                    </div>
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      <button
                        onClick={() => updateSkill(skill.slug)}
                        disabled={actionInProgress.has(skill.slug)}
                        style={{ ...btnPrimary, opacity: actionInProgress.has(skill.slug) ? 0.5 : 1 }}
                      >
                        {actionInProgress.has(skill.slug) ? <Loader2 style={{ width: 10, height: 10, animation: "mpSpin 1s linear infinite" }} /> : <RotateCw style={{ width: 10, height: 10 }} />}
                        Update
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Publish sub-tab ── */}
        {subTab === "publish" && (
          <div style={{ marginTop: 4 }}>
            <div style={{
              background: "var(--bg-elevated)", border: "1px solid var(--border)",
              borderRadius: 10, overflow: "hidden",
            }}>
              <button onClick={() => setPublishExpanded(!publishExpanded)} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 14px", width: "100%", background: "transparent", border: "none",
                cursor: "pointer", color: "var(--text)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Upload style={{ width: 14, height: 14, color: "var(--accent)" }} />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>Publish a Skill</span>
                </div>
                {publishExpanded ? <ChevronUp style={{ width: 14, height: 14, color: "var(--text-muted)" }} /> : <ChevronDown style={{ width: 14, height: 14, color: "var(--text-muted)" }} />}
              </button>
              {publishExpanded && (
                <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>Slug *</label>
                      <input type="text" value={pubSlug} onChange={e => setPubSlug(e.target.value)} placeholder="my-skill" style={inputStyle} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>Name</label>
                      <input type="text" value={pubName} onChange={e => setPubName(e.target.value)} placeholder="My Skill" style={inputStyle} />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>Version</label>
                      <input type="text" value={pubVersion} onChange={e => setPubVersion(e.target.value)} placeholder="1.0.0" style={inputStyle} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>Tags (comma sep)</label>
                      <input type="text" value={pubTags} onChange={e => setPubTags(e.target.value)} placeholder="util,automation" style={inputStyle} />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>Path</label>
                    <input type="text" value={pubPath} onChange={e => setPubPath(e.target.value)} placeholder="." style={inputStyle} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>Changelog</label>
                    <textarea value={pubChangelog} onChange={e => setPubChangelog(e.target.value)} placeholder="What changed..." rows={3}
                      style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace", fontSize: 11, lineHeight: 1.5 }}
                    />
                  </div>
                  <button onClick={doPublish} disabled={publishing || !pubSlug.trim()} style={{ ...btnPrimary, alignSelf: "flex-start", padding: "6px 16px", opacity: publishing ? 0.5 : 1 }}>
                    {publishing ? <Loader2 style={{ width: 10, height: 10, animation: "mpSpin 1s linear infinite" }} /> : <Upload style={{ width: 10, height: 10 }} />}
                    Publish
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Sync sub-tab ── */}
        {subTab === "sync" && (
          <div style={{ marginTop: 4 }}>
            <div style={{
              background: "var(--bg-elevated)", border: "1px solid var(--border)",
              borderRadius: 10, padding: "14px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <RotateCw style={{ width: 14, height: 14, color: "var(--accent)" }} />
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>Sync Skills</span>
              </div>
              <p style={{ fontSize: 11, color: "var(--text-secondary)", margin: "0 0 12px", lineHeight: 1.5 }}>
                Synchronize all ClawHub skills with the registry. Preview changes first, then confirm.
              </p>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={doSyncPreview} disabled={syncing} style={btnPrimary}>
                  {syncing && !syncPreview ? <Loader2 style={{ width: 10, height: 10, animation: "mpSpin 1s linear infinite" }} /> : <Search style={{ width: 10, height: 10 }} />}
                  Preview (Dry Run)
                </button>
                {syncPreview && (
                  <button onClick={doSyncConfirm} disabled={syncing} style={{ ...btnPrimary, background: "rgba(74,222,128,0.15)", color: "var(--success)" }}>
                    {syncing ? <Loader2 style={{ width: 10, height: 10, animation: "mpSpin 1s linear infinite" }} /> : <Check style={{ width: 10, height: 10 }} />}
                    Confirm Sync
                  </button>
                )}
              </div>
              {syncPreview && (
                <pre style={{
                  marginTop: 10, padding: "10px 12px", borderRadius: 8,
                  background: "var(--bg-surface)", border: "1px solid var(--border)",
                  fontSize: 10, color: "var(--text-secondary)", margin: "10px 0 0",
                  whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "monospace",
                  maxHeight: 200, overflowY: "auto",
                }}>
                  {syncPreview}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Shared UI Atoms ────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
      <Loader2 style={{ width: 24, height: 24, color: "var(--accent)", animation: "mpSpin 1s linear infinite" }} />
    </div>
  );
}

function ErrorMessage({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 8 }}>
      <AlertTriangle style={{ width: 24, height: 24, color: "var(--error)" }} />
      <p style={{ fontSize: 12, color: "var(--error)", textAlign: "center", maxWidth: 300 }}>{message}</p>
      <button
        onClick={onRetry}
        style={{
          padding: "4px 12px", borderRadius: 6, border: "none",
          background: "var(--bg-hover)", color: "var(--text-secondary)",
          fontSize: 11, cursor: "pointer", marginTop: 4,
        }}
      >
        Retry
      </button>
    </div>
  );
}

function EmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 8 }}>
      {icon}
      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{message}</p>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 0" }}>
      <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{label}</span>
      <span style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "monospace" }}>{value}</span>
    </div>
  );
}
