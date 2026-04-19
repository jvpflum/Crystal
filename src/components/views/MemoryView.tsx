import { useState, useEffect, useCallback, useRef } from "react";
import {
  Brain, Search, RefreshCw, Loader2, FileText,
  Edit3, Database, Copy, CheckCircle2, XCircle, ChevronDown, ChevronUp,
  BookOpen, Save, Eye,
  Castle, DoorOpen, Archive, GitBranch, Clock, Sparkles, Shield, Zap, ArrowRight,
  Pickaxe, Network,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { openclawClient } from "@/lib/openclaw";
import { memoryPalaceClient, type PalaceStatus, type PalaceDrawer, type KGTriple, type PalaceTunnel, type KGEntity } from "@/lib/memory-palace";
import { cachedCommand } from "@/lib/cache";
import { EASE, SPRING, glowCard, hoverLift, hoverReset, pressDown, pressUp, innerPanel, sectionLabel, mutedCaption, iconTile, inputStyle, btnPrimary, btnSecondary, viewContainer, headerRow, scrollArea, badge, emptyState, MONO } from "@/styles/viewStyles";

interface WorkspaceFile {
  name: string; path: string; size: number; modified: string; category: string;
}

type TabId = "palace" | "kb" | "mining" | "kgextract";

const FILE_CATEGORIES: Record<string, string> = {
  "SOUL.md": "identity", "USER.md": "identity", "IDENTITY.md": "identity",
  "AGENTS.md": "system", "TOOLS.md": "system", "HEARTBEAT.md": "system",
  "SYSTEM-STATE.md": "system", "MODEL-POLICY.md": "system",
  "MEMORY.md": "memory", "MEMORY-ARCHITECTURE.md": "memory",
  "HOT_MEMORY.md": "memory", "WARM_MEMORY.md": "memory",
  "AREAS.md": "ops", "BACKLOG.md": "ops", "BUILDING.md": "ops",
  "CAPTURE.md": "ops", "CHANGELOG.md": "ops", "DAILY-BRIEF.md": "ops",
  "DAY-TO-DAY-OPS.md": "ops", "IMPROVEMENTS.md": "ops",
  "LESSONS-LEARNED.md": "ops", "MILESTONE-RULES.md": "ops",
  "MILESTONES.md": "ops", "OPERATING-CONSTITUTION.md": "ops",
  "OPERATING-LOOP.md": "ops", "PROACTIVE-RULES.md": "ops",
  "ROUTINE-PROFILE.md": "ops", "TASK-SYSTEM.md": "ops",
  "WEEKLY-REVIEW.md": "ops", "WORKING-QUEUE.md": "ops",
  "CODING-AGENT-POLICY.md": "ops",
  "DEVICES.md": "infra", "HUE-BRIDGES.md": "infra", "HUE-SCENES.md": "infra",
  "MIGRATION-TO-CHROMEDOME.md": "infra", "HOME-SYSTEM.md": "infra",
  "TESLA-API-SETUP.md": "infra", "NOTION-SETUP.md": "infra",
  "GMAIL-RULES.md": "infra",
  "SECURITY.md": "security", "DISASTER-RECOVERY.md": "security",
  "LINKEDIN-POLICY.md": "security",
  "VIP-PEOPLE.md": "personal", "README.md": "other",
};

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  identity: { label: "Identity", color: "#b744ff" },
  system:   { label: "System", color: "#0088ff" },
  memory:   { label: "Memory", color: "#ff2d95" },
  ops:      { label: "Operations", color: "#ffb800" },
  infra:    { label: "Infrastructure", color: "#00fff2" },
  security: { label: "Security", color: "#ff003c" },
  personal: { label: "Personal", color: "#39ff14" },
  domain:   { label: "Domain", color: "#ff69b4" },
  other:    { label: "Other", color: "var(--text-muted)" },
};

export function MemoryView() {
  const [tab, setTab] = useState<TabId>("palace");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Knowledge Base state
  const [wsFiles, setWsFiles] = useState<WorkspaceFile[]>([]);
  const [wsFilesLoading, setWsFilesLoading] = useState(false);
  const [viewingFile, setViewingFile] = useState<{ name: string; path: string; content: string } | null>(null);
  const [viewingFileLoading, setViewingFileLoading] = useState(false);
  const [editingKB, setEditingKB] = useState(false);
  const [kbEditContent, setKbEditContent] = useState("");
  const [kbSaving, setKbSaving] = useState(false);
  const [kbFilter, setKbFilter] = useState<string>("all");

  const showFeedback = (type: "success" | "error", text: string) => {
    setFeedback({ type, text }); setTimeout(() => setFeedback(null), 3000);
  };

  const wsDir = useCallback(async () => {
    const home = await invoke<{ stdout: string }>("execute_command", { command: "echo $env:USERPROFILE\\.openclaw", cwd: null });
    return home.stdout.trim().replace(/\r?\n/g, "") + "\\workspace";
  }, []);

  const loadWsFiles = useCallback(async () => {
    setWsFilesLoading(true);
    try {
      const dir = await wsDir();
      const result = await cachedCommand(
        `powershell -Command "Get-ChildItem '${dir}' -Filter '*.md' -File | ForEach-Object { $_.Name + '|' + $_.FullName + '|' + $_.Length + '|' + $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm') }"`,
        { ttl: 30_000 },
      );
      if (result.code === 0 && result.stdout.trim()) {
        const files: WorkspaceFile[] = result.stdout.trim().split("\n")
          .filter(l => l.includes("|"))
          .map(line => {
            const [name, path, size, modified] = line.trim().split("|");
            const cat = FILE_CATEGORIES[name] || "other";
            return { name, path, size: Number(size) || 0, modified, category: cat };
          });
        const memResult = await cachedCommand(
          `powershell -Command "Get-ChildItem '${dir}\\memory' -Filter '*.md' -File -ErrorAction SilentlyContinue | ForEach-Object { $_.Name + '|' + $_.FullName + '|' + $_.Length + '|' + $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm') }"`,
          { ttl: 30_000 },
        );
        if (memResult.code === 0 && memResult.stdout.trim()) {
          for (const line of memResult.stdout.trim().split("\n")) {
            if (!line.includes("|")) continue;
            const [name, path, size, modified] = line.trim().split("|");
            if (name === "HOT_MEMORY.md" || name === "WARM_MEMORY.md") {
              files.push({ name: `memory/${name}`, path, size: Number(size) || 0, modified, category: "memory" });
            } else if (name.startsWith("memory-")) {
              files.push({ name: `memory/${name}`, path, size: Number(size) || 0, modified, category: "domain" });
            } else if (name.startsWith("security-")) {
              files.push({ name: `memory/${name}`, path, size: Number(size) || 0, modified, category: "security" });
            } else if (!name.match(/^\d{4}-/)) {
              files.push({ name: `memory/${name}`, path, size: Number(size) || 0, modified, category: "other" });
            }
          }
        }
        setWsFiles(files.sort((a, b) => a.name.localeCompare(b.name)));
      }
    } catch { /* ignore */ }
    setWsFilesLoading(false);
  }, [wsDir]);

  const viewFile = async (file: WorkspaceFile) => {
    setViewingFileLoading(true); setEditingKB(false);
    try {
      const content = await invoke<string>("read_file", { path: file.path });
      setViewingFile({ name: file.name, path: file.path, content });
      setKbEditContent(content);
    } catch {
      setViewingFile({ name: file.name, path: file.path, content: "(Could not read file)" });
    }
    setViewingFileLoading(false);
  };

  const saveKbFile = async () => {
    if (!viewingFile) return;
    setKbSaving(true);
    try {
      await invoke("write_file", { path: viewingFile.path, content: kbEditContent });
      setViewingFile({ ...viewingFile, content: kbEditContent });
      setEditingKB(false);
      showFeedback("success", `Saved ${viewingFile.name}`);
    } catch {
      showFeedback("error", "Failed to save");
    }
    setKbSaving(false);
  };

  useEffect(() => {
    if (tab === "kb" && wsFiles.length === 0) loadWsFiles();
  }, [tab, loadWsFiles, wsFiles.length]);

  const copyEntry = (content: string) => {
    navigator.clipboard.writeText(content); showFeedback("success", "Copied to clipboard");
  };

  const formatBytes = (b: number) => b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`;

  const filteredFiles = kbFilter === "all" ? wsFiles : wsFiles.filter(f => f.category === kbFilter);
  const categoryGroups = [...new Set(wsFiles.map(f => f.category))].sort();

  const tabDefs: { id: TabId; icon: typeof Brain; label: string }[] = [
    { id: "palace", icon: Castle, label: "Palace" },
    { id: "kb", icon: BookOpen, label: "Knowledge Base" },
    { id: "mining", icon: Pickaxe, label: "Mining" },
    { id: "kgextract", icon: Network, label: "KG Extract" },
  ];

  return (
    <div style={{ ...viewContainer, padding: 0, gap: 0 }}>
      {/* Header */}
      <div style={{ padding: "14px 20px 10px", flexShrink: 0 }}>
        <div style={headerRow}>
          <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Memory</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {feedback && (
              <span style={{ ...badge(feedback.type === "success" ? "#4ade80" : "#f87171"), display: "flex", alignItems: "center", gap: 4 }}>
                {feedback.type === "success" ? <CheckCircle2 style={{ width: 10, height: 10 }} /> : <XCircle style={{ width: 10, height: 10 }} />}
                {feedback.text}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ padding: "0 20px 8px", display: "flex", gap: 4, flexShrink: 0, flexWrap: "wrap" }}>
        {tabDefs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "4px 10px", borderRadius: 6, border: "none", fontSize: 11, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 4, transition: `all 0.2s ${EASE}`,
              background: tab === t.id ? "rgba(59,130,246,0.18)" : "var(--bg-elevated)",
              color: tab === t.id ? "var(--accent)" : "var(--text-muted)" }}>
              <Icon style={{ width: 10, height: 10 }} />{t.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div style={{ ...scrollArea, padding: "0 20px 12px", display: "flex", flexDirection: "column" }}>

        {/* ─── Palace Tab ─── */}
        {tab === "palace" && <PalaceTab />}

        {/* ─── Mining Tab ─── */}
        {tab === "mining" && <CronJobTab jobName="palace-mine-incremental" jobLabel="Palace Mine (Incremental)" jobId="palace-mine-incremental-2026" iconColor="#f59e0b" />}

        {/* ─── KG Extract Tab ─── */}
        {tab === "kgextract" && <CronJobTab jobName="palace-kg-extract" jobLabel="Palace KG Extract (Nightly)" jobId="palace-kg-extract-nightly-2026" iconColor="#06b6d4" />}

        {/* ─── Knowledge Base Tab ─── */}
        {tab === "kb" && (
          viewingFile ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
              <div style={headerRow}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button onClick={() => { setViewingFile(null); setEditingKB(false); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", fontSize: 11, padding: "4px 8px", borderRadius: 6, transition: `all 0.2s ${EASE}` }}>
                    ← Back
                  </button>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{viewingFile.name}</span>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {!editingKB ? (
                    <button onClick={() => { setEditingKB(true); setKbEditContent(viewingFile.content); }}
                      style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", fontSize: 10 }}
                      onMouseDown={pressDown} onMouseUp={pressUp}>
                      <Edit3 style={{ width: 10, height: 10 }} /> Edit
                    </button>
                  ) : (
                    <>
                      <button onClick={saveKbFile} disabled={kbSaving}
                        style={{ ...btnPrimary, display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", fontSize: 10, opacity: kbSaving ? 0.5 : 1 }}
                        onMouseDown={pressDown} onMouseUp={pressUp}>
                        {kbSaving ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : <Save style={{ width: 10, height: 10 }} />} Save
                      </button>
                      <button onClick={() => setEditingKB(false)}
                        style={{ ...btnSecondary, padding: "4px 10px", fontSize: 10 }}
                        onMouseDown={pressDown} onMouseUp={pressUp}>
                        Cancel
                      </button>
                    </>
                  )}
                  <button onClick={() => copyEntry(viewingFile.content)}
                    style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", fontSize: 10 }}
                    onMouseDown={pressDown} onMouseUp={pressUp}>
                    <Copy style={{ width: 10, height: 10 }} /> Copy
                  </button>
                </div>
              </div>
              {viewingFileLoading ? (
                <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
                  <Loader2 style={{ width: 24, height: 24, color: "var(--accent)", animation: "spin 1s linear infinite" }} />
                </div>
              ) : editingKB ? (
                <textarea value={kbEditContent} onChange={e => setKbEditContent(e.target.value)}
                  style={{ ...inputStyle, flex: 1, minHeight: 200, fontFamily: MONO, fontSize: 12, padding: 12,
                    resize: "none", boxSizing: "border-box" }}
                  spellCheck={false} />
              ) : (
                <pre style={{ ...innerPanel, flex: 1, margin: 0, fontFamily: MONO, fontSize: 12, padding: 14,
                  color: "var(--text)", overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6 }}>
                  {viewingFile.content}
                </pre>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Category filter */}
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                <button onClick={() => setKbFilter("all")}
                  style={{ padding: "3px 10px", borderRadius: 6, border: "none", fontSize: 10, cursor: "pointer", transition: `all 0.2s ${EASE}`,
                    background: kbFilter === "all" ? "rgba(59,130,246,0.2)" : "var(--bg-elevated)",
                    color: kbFilter === "all" ? "var(--accent)" : "var(--text-muted)" }}>
                  All ({wsFiles.length})
                </button>
                {categoryGroups.map(cat => {
                  const meta = CATEGORY_META[cat] || { label: cat, color: "var(--text-muted)" };
                  const count = wsFiles.filter(f => f.category === cat).length;
                  return (
                    <button key={cat} onClick={() => setKbFilter(cat)}
                      style={{ padding: "3px 10px", borderRadius: 6, border: "none", fontSize: 10, cursor: "pointer", transition: `all 0.2s ${EASE}`,
                        background: kbFilter === cat ? `${meta.color}22` : "var(--bg-elevated)",
                        color: kbFilter === cat ? meta.color : "var(--text-muted)" }}>
                      {meta.label} ({count})
                    </button>
                  );
                })}
              </div>

              {wsFilesLoading ? (
                <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
                  <Loader2 style={{ width: 24, height: 24, color: "var(--accent)", animation: "spin 1s linear infinite" }} />
                </div>
              ) : filteredFiles.length === 0 ? (
                <div style={emptyState}>No files found in this category.</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
                  {filteredFiles.map(file => {
                    const meta = CATEGORY_META[file.category] || { label: file.category, color: "var(--text-muted)" };
                    return (
                      <button key={file.name} onClick={() => viewFile(file)}
                        data-glow={meta.color}
                        style={{ ...glowCard(meta.color), padding: "10px 12px", cursor: "pointer", textAlign: "left", display: "flex", flexDirection: "column", gap: 4 }}
                        onMouseEnter={hoverLift} onMouseLeave={hoverReset}
                        onMouseDown={pressDown} onMouseUp={pressUp}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <FileText style={{ width: 12, height: 12, color: meta.color }} />
                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{file.name}</span>
                          </div>
                          <Eye style={{ width: 10, height: 10, color: "var(--text-muted)" }} />
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={badge(meta.color)}>{meta.label}</span>
                          <span style={mutedCaption}>{formatBytes(file.size)}</span>
                          <span style={mutedCaption}>{file.modified}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )
        )}

      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ─── Palace Tab ─── */

function PalaceTab() {
  const [status, setStatus] = useState<PalaceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [expandedWing, setExpandedWing] = useState<string | null>(null);
  const [wakeUpText, setWakeUpText] = useState<string | null>(null);
  const [wakeUpLoading, setWakeUpLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PalaceDrawer[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [expandedDrawers, setExpandedDrawers] = useState<Set<number>>(new Set());
  const [kgEntity, setKgEntity] = useState("");
  const [kgResults, setKgResults] = useState<KGTriple[] | null>(null);
  const [kgLoading, setKgLoading] = useState(false);
  const [kgEntities, setKgEntities] = useState<KGEntity[] | null>(null);
  const [kgEntitiesLoading, setKgEntitiesLoading] = useState(false);
  const [kgEntityFilter, setKgEntityFilter] = useState("");
  const [kgRecentTriples, setKgRecentTriples] = useState<KGTriple[] | null>(null);
  const [kgRecentLoading, setKgRecentLoading] = useState(false);
  const [identityText, setIdentityText] = useState<string | null>(null);
  const [identityEditing, setIdentityEditing] = useState(false);
  const [identityDraft, setIdentityDraft] = useState("");
  const [identitySaving, setIdentitySaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [mining, setMining] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [tunnels, setTunnels] = useState<PalaceTunnel[] | null>(null);
  const [tunnelsLoading, setTunnelsLoading] = useState(false);
  const [explicitTunnels, setExplicitTunnels] = useState<import("@/lib/memory-palace").ExplicitTunnel[] | null>(null);
  const [view, setView] = useState<"overview" | "search" | "graph" | "identity" | "tunnels">("overview");

  const showFeedback = (type: "success" | "error", text: string) => {
    setFeedback({ type, text }); setTimeout(() => setFeedback(null), 4000);
  };

  const expandedWingRef = useRef(expandedWing);
  expandedWingRef.current = expandedWing;

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const isInit = await memoryPalaceClient.isInitialized();
      setInitialized(isInit);
      if (isInit) {
        const s = await memoryPalaceClient.getStatus();
        setStatus(s);
        if (s?.wings?.length && !expandedWingRef.current) setExpandedWing(s.wings[0].name);
      }
    } catch (e) { console.error("[Palace] loadStatus failed:", e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    setView("search");
    try {
      const result = await memoryPalaceClient.search(searchQuery);
      setSearchResults(result.results);
    } catch (e) {
      if (import.meta.env.DEV) console.error("[Palace] search failed:", e);
      showFeedback("error", e instanceof Error ? e.message : "Search failed");
      setSearchResults([]);
    }
    finally { setSearchLoading(false); }
  };

  const runKgQuery = useCallback(async (name: string) => {
    if (!name.trim()) return;
    setKgEntity(name);
    setKgLoading(true);
    setView("graph");
    try {
      const results = await memoryPalaceClient.queryEntity(name);
      setKgResults(results);
    } catch (e) {
      if (import.meta.env.DEV) console.error("[Palace] KG query failed:", e);
      showFeedback("error", e instanceof Error ? e.message : "Knowledge graph query failed");
      setKgResults([]);
    }
    finally { setKgLoading(false); }
  }, []);

  const handleKgQuery = () => runKgQuery(kgEntity);

  const loadKgEntities = useCallback(async () => {
    setKgEntitiesLoading(true);
    try {
      const entities = await memoryPalaceClient.listEntities(500);
      setKgEntities(entities);
    } catch (e) {
      if (import.meta.env.DEV) console.error("[Palace] list entities failed:", e);
      setKgEntities([]);
    } finally { setKgEntitiesLoading(false); }
  }, []);

  const loadKgRecentTriples = useCallback(async () => {
    setKgRecentLoading(true);
    try {
      const triples = await memoryPalaceClient.listAllTriples(50, false);
      setKgRecentTriples(triples);
    } catch (e) {
      if (import.meta.env.DEV) console.error("[Palace] list triples failed:", e);
      setKgRecentTriples([]);
    } finally { setKgRecentLoading(false); }
  }, []);

  const handleMine = async () => {
    setMining(true);
    try {
      const ws = await openclawClient.getWorkspaceDir();
      const result = await memoryPalaceClient.mine(ws);
      showFeedback(result.success ? "success" : "error", result.message.split("\n").pop() || result.message);
      await loadStatus();
    } catch (e) {
      console.error("[Palace] mine failed:", e);
      showFeedback("error", "Mining failed");
    } finally { setMining(false); }
  };

  const handleCompress = async () => {
    setCompressing(true);
    try {
      const result = await memoryPalaceClient.compress();
      showFeedback(result.success ? "success" : "error", result.message.split("\n").pop() || result.message);
      await loadStatus();
    } catch (e) {
      console.error("[Palace] compress failed:", e);
      showFeedback("error", "Compression failed");
    } finally { setCompressing(false); }
  };

  const handleRepair = async () => {
    setRepairing(true);
    try {
      const result = await memoryPalaceClient.repair();
      showFeedback(result.success ? "success" : "error", result.message.split("\n").pop() || result.message);
      await loadStatus();
    } catch (e) {
      console.error("[Palace] repair failed:", e);
      showFeedback("error", "Repair failed");
    } finally { setRepairing(false); }
  };

  const loadWakeUp = async () => {
    setWakeUpLoading(true);
    const text = await memoryPalaceClient.getWakeUpContext();
    setWakeUpText(text || "No wake-up context available. Mine some files first.");
    setWakeUpLoading(false);
  };

  const loadTunnels = async () => {
    setTunnelsLoading(true);
    const [t, et] = await Promise.all([
      memoryPalaceClient.getTunnels(),
      memoryPalaceClient.getExplicitTunnels(),
    ]);
    setTunnels(t);
    setExplicitTunnels(et);
    setTunnelsLoading(false);
  };

  const loadIdentity = async () => {
    const text = await memoryPalaceClient.getIdentity();
    setIdentityText(text);
    setIdentityDraft(text);
    setView("identity");
  };

  const saveIdentity = async () => {
    setIdentitySaving(true);
    const ok = await memoryPalaceClient.setIdentity(identityDraft);
    if (ok) {
      setIdentityText(identityDraft);
      setIdentityEditing(false);
      showFeedback("success", "Identity saved");
    } else {
      showFeedback("error", "Failed to save identity");
    }
    setIdentitySaving(false);
  };

  const toggleDrawer = (idx: number) => {
    setExpandedDrawers(prev => { const n = new Set(prev); if (n.has(idx)) n.delete(idx); else n.add(idx); return n; });
  };

  const WING_COLORS = ["#b744ff", "#0088ff", "#ff2d95", "#ffb800", "#00fff2", "#39ff14", "#ff69b4", "#ff6a00"];

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
      <Loader2 style={{ width: 24, height: 24, color: "var(--accent)", animation: "spin 1s linear infinite" }} />
    </div>
  );

  if (!initialized) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: 40 }}>
      <Castle style={{ width: 48, height: 48, color: "var(--text-muted)", opacity: 0.5 }} />
      <p style={{ fontSize: 14, color: "var(--text)", fontWeight: 600 }}>Memory Palace not initialized</p>
      <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", maxWidth: 400 }}>
        MemPalace organizes your memories into wings, rooms, and drawers with semantic search, knowledge graph, and compressed wake-up context.
      </p>
      <button onClick={async () => {
        setLoading(true);
        try {
          const ws = await openclawClient.getWorkspaceDir();
          const initResult = await memoryPalaceClient.initialize(ws);
          if (!initResult.success) showFeedback("error", initResult.message);
          await loadStatus();
        } catch (e) {
          console.error("[Palace] init failed:", e);
          showFeedback("error", "Initialization failed");
          setLoading(false);
        }
      }} style={{ ...btnPrimary, display: "flex", alignItems: "center", gap: 6, padding: "8px 20px" }}
        onMouseDown={pressDown} onMouseUp={pressUp}>
        <Castle style={{ width: 14, height: 14 }} /> Initialize Palace
      </button>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {feedback && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 10,
          background: feedback.type === "success" ? "rgba(74,222,128,0.06)" : "rgba(248,113,113,0.06)",
          border: `1px solid ${feedback.type === "success" ? "rgba(74,222,128,0.15)" : "rgba(248,113,113,0.15)"}`,
        }}>
          {feedback.type === "success" ? <CheckCircle2 style={{ width: 10, height: 10, color: "#4ade80" }} /> : <XCircle style={{ width: 10, height: 10, color: "#f87171" }} />}
          <span style={{ fontSize: 10, color: feedback.type === "success" ? "#4ade80" : "#f87171" }}>{feedback.text}</span>
        </div>
      )}

      {/* Stats overview */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        <div style={glowCard("#b744ff", { padding: "12px 14px" })} data-glow="#b744ff" onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
          <div style={sectionLabel}>Drawers</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", fontFamily: MONO }}>{status?.totalDrawers ?? 0}</div>
          <div style={mutedCaption}>memories filed</div>
        </div>
        <div style={glowCard("#0088ff", { padding: "12px 14px" })} data-glow="#0088ff" onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
          <div style={sectionLabel}>Wings</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", fontFamily: MONO }}>{status?.wings?.length ?? 0}</div>
          <div style={mutedCaption}>projects</div>
        </div>
        <div style={glowCard("#ff2d95", { padding: "12px 14px" })} data-glow="#ff2d95" onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
          <div style={sectionLabel}>Rooms</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", fontFamily: MONO }}>
            {status?.wings?.reduce((acc, w) => acc + w.rooms.length, 0) ?? 0}
          </div>
          <div style={mutedCaption}>categories</div>
        </div>
        <div style={glowCard("#00fff2", { padding: "12px 14px" })} data-glow="#00fff2" onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
          <div style={sectionLabel}>Knowledge Graph</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", fontFamily: MONO }}>
            {status?.kgStats?.entities ?? 0}
          </div>
          <div style={mutedCaption}>{status?.kgStats?.triples ?? 0} triples</div>
        </div>
      </div>

      {/* Sub-nav */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {([
          { id: "overview" as const, icon: Castle, label: "Wings & Rooms" },
          { id: "tunnels" as const, icon: ArrowRight, label: "Tunnels" },
          { id: "search" as const, icon: Search, label: "Deep Search" },
          { id: "graph" as const, icon: GitBranch, label: "Knowledge Graph" },
          { id: "identity" as const, icon: Shield, label: "Identity (L0)" },
        ]).map(v => {
          const Icon = v.icon;
          return (
            <button key={v.id} onClick={() => {
              setView(v.id);
              if (v.id === "identity" && identityText === null) loadIdentity();
              if (v.id === "tunnels" && tunnels === null) loadTunnels();
              if (v.id === "graph") {
                if (kgEntities === null) loadKgEntities();
                if (kgRecentTriples === null) loadKgRecentTriples();
              }
            }}
              style={{
                padding: "4px 10px", borderRadius: 6, border: "none", fontSize: 11, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 4, transition: `all 0.2s ${EASE}`,
                background: view === v.id ? "rgba(183,68,255,0.18)" : "var(--bg-elevated)",
                color: view === v.id ? "#b744ff" : "var(--text-muted)",
              }}>
              <Icon style={{ width: 10, height: 10 }} />{v.label}
            </button>
          );
        })}
      </div>

      {/* ─── Overview: Wings & Rooms ─── */}
      {view === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Flat-import detection: most memories live in a single dumping-ground wing */}
          {(() => {
            const wings = status?.wings ?? [];
            const flatWing = wings.find(w =>
              w.name === "memory_palace_import" ||
              (w.rooms.length === 1 && w.rooms[0].name === "general" && w.drawerCount > 100),
            );
            const total = status?.totalDrawers ?? 0;
            if (!flatWing || total === 0) return null;
            const pct = Math.round((flatWing.drawerCount / total) * 100);
            if (pct < 40) return null;
            return (
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", borderRadius: 10,
                background: "rgba(255,184,0,0.06)", border: "1px solid rgba(255,184,0,0.22)",
              }}>
                <Zap style={{ width: 14, height: 14, color: "#ffb800", marginTop: 2, flexShrink: 0 }} />
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                    {pct}% of drawers live in a single "{flatWing.name}" wing
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
                    Your {flatWing.drawerCount.toLocaleString()} imported memories aren't organised into proper project / domain wings yet.
                    Re-mining the workspace lets MemPalace auto-classify them into wings &amp; rooms based on content.
                  </div>
                </div>
                <button onClick={handleMine} disabled={mining}
                  style={{ ...btnPrimary, padding: "6px 12px", fontSize: 11, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
                  onMouseDown={pressDown} onMouseUp={pressUp}
                  title="Re-mine workspace and classify into wings/rooms">
                  {mining
                    ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />
                    : <Sparkles style={{ width: 12, height: 12 }} />}
                  {mining ? "Organizing…" : "Organize Memories"}
                </button>
              </div>
            );
          })()}

          {/* Wake-up context */}
          <div style={glowCard("#b744ff", { padding: "12px 14px" })} data-glow="#b744ff" onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Sparkles style={{ width: 14, height: 14, color: "#b744ff" }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>Wake-up Context (L0 + L1)</span>
                <span style={badge("#b744ff")}>~600-900 tokens</span>
              </div>
              <button onClick={loadWakeUp} disabled={wakeUpLoading}
                style={{ ...btnSecondary, padding: "4px 10px", fontSize: 10, display: "flex", alignItems: "center", gap: 4 }}
                onMouseDown={pressDown} onMouseUp={pressUp}>
                {wakeUpLoading ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : <Sparkles style={{ width: 10, height: 10 }} />}
                Generate
              </button>
            </div>
            {wakeUpText && (
              <pre style={{ margin: 0, fontFamily: MONO, fontSize: 11, color: "var(--text)", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.55, maxHeight: 300, overflowY: "auto" }}>
                {wakeUpText}
              </pre>
            )}
            {!wakeUpText && !wakeUpLoading && (
              <div style={mutedCaption}>Click "Generate" to see what the AI wakes up with — identity + essential story.</div>
            )}
          </div>

          {/* Wing cards */}
          {status?.wings?.map((wing, wi) => {
            const color = WING_COLORS[wi % WING_COLORS.length];
            const isExpanded = expandedWing === wing.name;
            return (
              <div key={wing.name} data-glow={color} style={glowCard(color, isExpanded ? { border: `1px solid ${color}44` } : undefined)}
                onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
                <button onClick={() => setExpandedWing(isExpanded ? null : wing.name)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                  <div style={iconTile(color, 32)}>
                    <Castle style={{ width: 16, height: 16, color }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color }}>{wing.name}</div>
                    <div style={mutedCaption}>{wing.rooms.length} rooms · {wing.drawerCount} drawers</div>
                  </div>
                  {isExpanded ? <ChevronUp style={{ width: 12, height: 12, color: "var(--text-muted)" }} /> : <ChevronDown style={{ width: 12, height: 12, color: "var(--text-muted)" }} />}
                </button>
                {isExpanded && (
                  <div style={{ borderTop: `1px solid ${color}22`, padding: "10px 14px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 6 }}>
                      {wing.rooms.map(room => (
                        <div key={room.name} style={{ ...innerPanel, padding: "8px 10px", display: "flex", alignItems: "center", gap: 8 }}>
                          <DoorOpen style={{ width: 12, height: 12, color, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{room.name}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                              <span style={mutedCaption}>{room.drawerCount} drawers</span>
                              {room.halls?.map(h => (
                                <span key={h} style={{ ...badge("#ffb800"), fontSize: 7 }}>{h}</span>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {(!status?.wings?.length) && (
            <div style={emptyState}>
              <Castle style={{ width: 32, height: 32, color: "var(--text-muted)" }} />
              <p style={{ fontSize: 12, color: "var(--text-muted)" }}>No wings yet. Mine your workspace to populate the palace.</p>
            </div>
          )}
        </div>
      )}

      {/* ─── Deep Search ─── */}
      {view === "search" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <div style={{ flex: 1, position: "relative" }}>
              <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "var(--text-muted)" }} />
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearch()}
                placeholder="Semantic search across all palace drawers..."
                style={{ ...inputStyle, padding: "8px 10px 8px 32px", fontSize: 12, boxSizing: "border-box" }} />
            </div>
            <button onClick={handleSearch} disabled={searchLoading || !searchQuery.trim()}
              style={{ ...btnPrimary, padding: "0 14px", fontSize: 11, opacity: searchLoading || !searchQuery.trim() ? 0.5 : 1, display: "flex", alignItems: "center", gap: 4 }}
              onMouseDown={pressDown} onMouseUp={pressUp}>
              {searchLoading ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Search style={{ width: 12, height: 12 }} />} Search
            </button>
          </div>

          {searchLoading && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 16, justifyContent: "center" }}>
              <Loader2 style={{ width: 16, height: 16, color: "#b744ff", animation: "spin 1s linear infinite" }} />
              <span style={mutedCaption}>Querying palace (hybrid BM25 + vector)...</span>
            </div>
          )}

          {searchResults && !searchLoading && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={mutedCaption}>{searchResults.length} result{searchResults.length !== 1 ? "s" : ""}</span>
              {searchResults.length === 0 ? (
                <div style={emptyState}>No drawers found matching your query.</div>
              ) : searchResults.map((r, i) => {
                const isExpanded = expandedDrawers.has(i);
                const isLong = r.text.length > 250;
                const sim = r.similarity ?? 0;
                const scoreColor = sim > 0.5 ? "#4ade80" : sim > 0.3 ? "#fbbf24" : "#f87171";
                return (
                  <div key={i} style={{ ...innerPanel, padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: scoreColor, fontFamily: MONO, minWidth: 40 }}>{sim.toFixed(3)}</span>
                        <div style={{ height: 4, borderRadius: 2, background: "var(--border)", width: 60 }}>
                          <div style={{ height: "100%", borderRadius: 2, background: scoreColor, width: `${Math.min(100, sim * 100)}%`, transition: `width 0.3s ${SPRING}` }} />
                        </div>
                        <span style={badge("#b744ff")}>{r.wing}/{r.room}</span>
                        {r.matchedVia === "drawer+closet" && <span style={badge("#4ade80")}>closet boost</span>}
                      </div>
                      <span style={{ ...mutedCaption, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.sourceFile}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: 11, color: "var(--text)", whiteSpace: "pre-wrap", lineHeight: 1.5, fontFamily: MONO,
                      maxHeight: isLong && !isExpanded ? 70 : undefined, overflow: isLong && !isExpanded ? "hidden" : undefined }}>{r.text}</p>
                    {isLong && (
                      <button onClick={() => toggleDrawer(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "#b744ff", fontSize: 10, padding: "4px 0 0", display: "flex", alignItems: "center", gap: 4 }}>
                        {isExpanded ? <><ChevronUp style={{ width: 10, height: 10 }} /> Less</> : <><ChevronDown style={{ width: 10, height: 10 }} /> More</>}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!searchResults && !searchLoading && (
            <div style={emptyState}>
              <Archive style={{ width: 24, height: 24, opacity: 0.4 }} />
              <p style={{ margin: 0 }}>Search across all wings and rooms. Results ranked by hybrid BM25 + vector similarity with closet boost.</p>
            </div>
          )}
        </div>
      )}

      {/* ─── Knowledge Graph ─── */}
      {view === "graph" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* KG stats */}
          {status?.kgStats && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
              <div style={{ ...innerPanel, padding: "8px 10px" }}>
                <div style={sectionLabel}>Entities</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", fontFamily: MONO }}>{status.kgStats.entities}</div>
              </div>
              <div style={{ ...innerPanel, padding: "8px 10px" }}>
                <div style={sectionLabel}>Triples</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", fontFamily: MONO }}>{status.kgStats.triples}</div>
              </div>
              <div style={{ ...innerPanel, padding: "8px 10px" }}>
                <div style={sectionLabel}>Current</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#4ade80", fontFamily: MONO }}>{status.kgStats.currentFacts}</div>
              </div>
              <div style={{ ...innerPanel, padding: "8px 10px" }}>
                <div style={sectionLabel}>Expired</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#f87171", fontFamily: MONO }}>{status.kgStats.expiredFacts}</div>
              </div>
            </div>
          )}

          {/* Entity query */}
          <div style={{ display: "flex", gap: 6 }}>
            <div style={{ flex: 1, position: "relative" }}>
              <GitBranch style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "var(--text-muted)" }} />
              <input value={kgEntity} onChange={e => setKgEntity(e.target.value)} onKeyDown={e => e.key === "Enter" && handleKgQuery()}
                placeholder="Query an entity (e.g., a person, project, concept)..."
                style={{ ...inputStyle, padding: "8px 10px 8px 32px", fontSize: 12, boxSizing: "border-box" }} />
            </div>
            <button onClick={handleKgQuery} disabled={kgLoading || !kgEntity.trim()}
              style={{ ...btnPrimary, padding: "0 14px", fontSize: 11, opacity: kgLoading || !kgEntity.trim() ? 0.5 : 1, display: "flex", alignItems: "center", gap: 4 }}
              onMouseDown={pressDown} onMouseUp={pressUp}>
              {kgLoading ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <GitBranch style={{ width: 12, height: 12 }} />} Query
            </button>
          </div>

          {/* Relationship types */}
          {status?.kgStats?.relationshipTypes?.length ? (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <span style={{ fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.06em", alignSelf: "center" }}>RELATIONS:</span>
              {status.kgStats.relationshipTypes.map(rt => (
                <span key={rt} style={badge("#b744ff")}>{rt}</span>
              ))}
            </div>
          ) : null}

          {kgLoading && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 16, justifyContent: "center" }}>
              <Loader2 style={{ width: 16, height: 16, color: "#b744ff", animation: "spin 1s linear infinite" }} />
              <span style={mutedCaption}>Querying knowledge graph...</span>
            </div>
          )}

          {kgResults && !kgLoading && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={mutedCaption}>{kgResults.length} relationship{kgResults.length !== 1 ? "s" : ""} for "{kgEntity}"</span>
              {kgResults.length === 0 ? (
                <div style={emptyState}>No relationships found for this entity.</div>
              ) : kgResults.map((triple, i) => (
                <div key={i} style={{ ...innerPanel, padding: "8px 10px", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#b744ff", minWidth: 80 }}>{triple.subject}</span>
                  <ArrowRight style={{ width: 10, height: 10, color: "var(--text-muted)", flexShrink: 0 }} />
                  <span style={badge(triple.current ? "#4ade80" : "#f87171")}>{triple.predicate}</span>
                  <ArrowRight style={{ width: 10, height: 10, color: "var(--text-muted)", flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#0088ff" }}>{triple.object}</span>
                  <span style={{ flex: 1 }} />
                  {triple.validFrom && (
                    <span style={{ ...mutedCaption, display: "flex", alignItems: "center", gap: 3 }}>
                      <Clock style={{ width: 8, height: 8 }} />{triple.validFrom}
                    </span>
                  )}
                  {triple.validTo && (
                    <span style={{ ...mutedCaption, color: "#f87171" }}>→ {triple.validTo}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Entity browser — always visible so users can explore */}
          <div style={{ ...innerPanel, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Archive style={{ width: 12, height: 12, color: "#0088ff" }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>Entities</span>
                <span style={mutedCaption}>
                  {kgEntities ? `${kgEntities.length} discovered — click to explore` : "loading…"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input value={kgEntityFilter} onChange={e => setKgEntityFilter(e.target.value)}
                  placeholder="Filter…"
                  style={{ ...inputStyle, padding: "4px 8px", fontSize: 10, height: 24, width: 140 }} />
                <button onClick={loadKgEntities} disabled={kgEntitiesLoading}
                  style={{ ...btnSecondary, padding: "4px 8px", fontSize: 10, display: "flex", alignItems: "center", gap: 4 }}
                  aria-label="Refresh entities">
                  {kgEntitiesLoading
                    ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} />
                    : <RefreshCw style={{ width: 10, height: 10 }} />}
                </button>
              </div>
            </div>
            {kgEntitiesLoading && !kgEntities && (
              <div style={{ display: "flex", justifyContent: "center", padding: 12 }}>
                <Loader2 style={{ width: 14, height: 14, color: "#b744ff", animation: "spin 1s linear infinite" }} />
              </div>
            )}
            {kgEntities && kgEntities.length === 0 && !kgEntitiesLoading && (
              <div style={{ ...mutedCaption, padding: "6px 0" }}>
                No entities yet. Mine your workspace or add a triple to seed the graph.
              </div>
            )}
            {kgEntities && kgEntities.length > 0 && (() => {
              const q = kgEntityFilter.trim().toLowerCase();
              const filtered = q ? kgEntities.filter(e => e.name.toLowerCase().includes(q)) : kgEntities;
              const maxCnt = Math.max(1, ...filtered.map(e => e.tripleCount));
              return (
                <div style={{
                  display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                  gap: 4, maxHeight: 260, overflowY: "auto", paddingRight: 4,
                }}>
                  {filtered.map(ent => {
                    const intensity = 0.08 + 0.35 * (ent.tripleCount / maxCnt);
                    return (
                      <button key={ent.name} onClick={() => runKgQuery(ent.name)}
                        title={`${ent.tripleCount} triple${ent.tripleCount === 1 ? "" : "s"}${ent.type ? ` · ${ent.type}` : ""}`}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6,
                          padding: "5px 8px", borderRadius: 6, cursor: "pointer",
                          background: `rgba(183,68,255,${intensity.toFixed(3)})`,
                          border: "1px solid rgba(183,68,255,0.18)",
                          color: "var(--text)", fontSize: 11, textAlign: "left", transition: `all 0.15s ${EASE}`,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = "#b744ff"; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(183,68,255,0.18)"; }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>
                          {ent.name}
                        </span>
                        <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: MONO, flexShrink: 0 }}>
                          {ent.tripleCount}
                        </span>
                      </button>
                    );
                  })}
                  {filtered.length === 0 && (
                    <div style={{ ...mutedCaption, gridColumn: "1 / -1", padding: "8px 0" }}>
                      No entities match "{kgEntityFilter}".
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Recent facts — when no query is active, show what's in the graph */}
          {!kgResults && !kgLoading && (
            <div style={{ ...innerPanel, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Clock style={{ width: 12, height: 12, color: "#4ade80" }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>Recent Facts</span>
                  <span style={mutedCaption}>
                    {kgRecentTriples ? `latest ${kgRecentTriples.length} triples` : "loading…"}
                  </span>
                </div>
                <button onClick={loadKgRecentTriples} disabled={kgRecentLoading}
                  style={{ ...btnSecondary, padding: "4px 8px", fontSize: 10, display: "flex", alignItems: "center", gap: 4 }}
                  aria-label="Refresh recent facts">
                  {kgRecentLoading
                    ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} />
                    : <RefreshCw style={{ width: 10, height: 10 }} />}
                </button>
              </div>
              {kgRecentLoading && !kgRecentTriples && (
                <div style={{ display: "flex", justifyContent: "center", padding: 12 }}>
                  <Loader2 style={{ width: 14, height: 14, color: "#4ade80", animation: "spin 1s linear infinite" }} />
                </div>
              )}
              {kgRecentTriples && kgRecentTriples.length === 0 && !kgRecentLoading && (
                <div style={mutedCaption}>No triples stored yet.</div>
              )}
              {kgRecentTriples && kgRecentTriples.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 320, overflowY: "auto", paddingRight: 4 }}>
                  {kgRecentTriples.map((triple, i) => (
                    <button key={i} onClick={() => runKgQuery(triple.subject)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                        borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)",
                        cursor: "pointer", textAlign: "left", transition: `all 0.15s ${EASE}`,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = "#b744ff55"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; }}
                      title={`Query ${triple.subject}`}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#b744ff", minWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {triple.subject}
                      </span>
                      <ArrowRight style={{ width: 10, height: 10, color: "var(--text-muted)", flexShrink: 0 }} />
                      <span style={badge(triple.current ? "#4ade80" : "#f87171")}>{triple.predicate}</span>
                      <ArrowRight style={{ width: 10, height: 10, color: "var(--text-muted)", flexShrink: 0 }} />
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#0088ff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {triple.object}
                      </span>
                      <span style={{ flex: 1 }} />
                      {triple.validTo && <span style={{ ...mutedCaption, color: "#f87171", fontSize: 9 }}>expired</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── Tunnels (cross-wing links) ─── */}
      {view === "tunnels" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Graph stats */}
          {status?.graphStats && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              <div style={{ ...innerPanel, padding: "8px 10px" }}>
                <div style={sectionLabel}>Rooms</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", fontFamily: MONO }}>{status.graphStats.totalRooms}</div>
              </div>
              <div style={{ ...innerPanel, padding: "8px 10px" }}>
                <div style={sectionLabel}>Tunnel Rooms</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#ffb800", fontFamily: MONO }}>{status.graphStats.tunnelRooms}</div>
                <div style={mutedCaption}>cross-wing links</div>
              </div>
              <div style={{ ...innerPanel, padding: "8px 10px" }}>
                <div style={sectionLabel}>Edges</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", fontFamily: MONO }}>{status.graphStats.totalEdges}</div>
              </div>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ArrowRight style={{ width: 14, height: 14, color: "#ffb800" }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>Cross-Wing Tunnels</span>
              <span style={mutedCaption}>rooms that bridge multiple wings</span>
            </div>
            <button onClick={loadTunnels} disabled={tunnelsLoading}
              style={{ ...btnSecondary, padding: "4px 10px", fontSize: 10, display: "flex", alignItems: "center", gap: 4 }}>
              {tunnelsLoading ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : <RefreshCw style={{ width: 10, height: 10 }} />} Refresh
            </button>
          </div>

          {tunnelsLoading && (
            <div style={{ display: "flex", justifyContent: "center", padding: 20 }}>
              <Loader2 style={{ width: 16, height: 16, color: "#ffb800", animation: "spin 1s linear infinite" }} />
            </div>
          )}

          {tunnels && !tunnelsLoading && (
            tunnels.length === 0 ? (
              <div style={emptyState}>
                <ArrowRight style={{ width: 24, height: 24, opacity: 0.4 }} />
                <p style={{ margin: 0 }}>No tunnel rooms found. Tunnels appear when the same room name exists across multiple wings.</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {tunnels.map((t, i) => (
                  <div key={i} style={{ ...innerPanel, padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#ffb800" }}>{t.room}</span>
                      <span style={mutedCaption}>{t.count} drawers</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.06em" }}>BRIDGES:</span>
                      {t.wings.map((w, wi) => (
                        <span key={w} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                          {wi > 0 && <ArrowRight style={{ width: 8, height: 8, color: "var(--text-muted)" }} />}
                          <span style={badge(WING_COLORS[wi % WING_COLORS.length])}>{w}</span>
                        </span>
                      ))}
                      {t.halls?.length > 0 && (
                        <>
                          <span style={{ fontSize: 9, color: "var(--text-muted)", marginLeft: 8 }}>HALLS:</span>
                          {t.halls.map(h => <span key={h} style={badge("#ffb800")}>{h}</span>)}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* Explicit tunnels (agent-created) */}
          {explicitTunnels && explicitTunnels.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                <GitBranch style={{ width: 14, height: 14, color: "#b744ff" }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>Explicit Tunnels</span>
                <span style={mutedCaption}>{explicitTunnels.length} agent-created links</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {explicitTunnels.map((t, i) => (
                  <div key={t.id || i} style={{ ...innerPanel, padding: "8px 10px", display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                      <span style={badge("#b744ff")}>{t.source.wing}/{t.source.room}</span>
                      <ArrowRight style={{ width: 10, height: 10, color: "var(--text-muted)" }} />
                      <span style={badge("#00fff2")}>{t.target.wing}/{t.target.room}</span>
                    </div>
                    {t.label && <span style={{ fontSize: 10, color: "var(--text-muted)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label}</span>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── Identity (L0) ─── */}
      {view === "identity" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={glowCard("#00fff2", { padding: "14px 16px" })} data-glow="#00fff2" onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Shield style={{ width: 14, height: 14, color: "#00fff2" }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>L0 — Identity</span>
                <span style={badge("#00fff2")}>~100 tokens</span>
                <span style={badge(status?.l0Identity?.exists ? "#4ade80" : "#f87171")}>
                  {status?.l0Identity?.exists ? "configured" : "not set"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {!identityEditing ? (
                  <button onClick={() => { setIdentityEditing(true); setIdentityDraft(identityText || ""); }}
                    style={{ ...btnSecondary, padding: "4px 10px", fontSize: 10, display: "flex", alignItems: "center", gap: 4 }}
                    onMouseDown={pressDown} onMouseUp={pressUp}>
                    <Edit3 style={{ width: 10, height: 10 }} /> Edit
                  </button>
                ) : (
                  <>
                    <button onClick={saveIdentity} disabled={identitySaving}
                      style={{ ...btnPrimary, padding: "4px 10px", fontSize: 10, display: "flex", alignItems: "center", gap: 4, opacity: identitySaving ? 0.5 : 1 }}
                      onMouseDown={pressDown} onMouseUp={pressUp}>
                      {identitySaving ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : <Save style={{ width: 10, height: 10 }} />} Save
                    </button>
                    <button onClick={() => setIdentityEditing(false)}
                      style={{ ...btnSecondary, padding: "4px 10px", fontSize: 10 }}>Cancel</button>
                  </>
                )}
              </div>
            </div>
            <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "0 0 10px", lineHeight: 1.5 }}>
              The identity text (~100 tokens) is always injected at the start of every session. Define who the AI is, key traits, and critical relationships.
            </p>
            {identityEditing ? (
              <textarea value={identityDraft} onChange={e => setIdentityDraft(e.target.value)}
                placeholder="I am Crystal, a personal AI assistant for Jarrod.\nTraits: warm, direct, remembers everything.\nPeople: Jarrod (creator), Danielle (Jarrod's partner)."
                style={{ ...inputStyle, minHeight: 140, fontFamily: MONO, fontSize: 12, padding: 12, resize: "vertical", boxSizing: "border-box" }}
                spellCheck={false} />
            ) : identityText ? (
              <pre style={{ margin: 0, fontFamily: MONO, fontSize: 12, color: "var(--text)", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.55 }}>
                {identityText}
              </pre>
            ) : (
              <div style={emptyState}>No identity file found. Click Edit to create one.</div>
            )}
          </div>
        </div>
      )}

      {/* Actions bar */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
        <button onClick={handleMine} disabled={mining}
          style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", fontSize: 11, opacity: mining ? 0.5 : 1 }}
          onMouseDown={pressDown} onMouseUp={pressUp}>
          {mining ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Archive style={{ width: 12, height: 12 }} />}
          Mine Workspace
        </button>
        <button onClick={handleCompress} disabled={compressing}
          style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", fontSize: 11, opacity: compressing ? 0.5 : 1 }}
          onMouseDown={pressDown} onMouseUp={pressUp}>
          {compressing ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Zap style={{ width: 12, height: 12 }} />}
          Compress (AAAK)
        </button>
        <button onClick={handleRepair} disabled={repairing}
          style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", fontSize: 11, opacity: repairing ? 0.5 : 1 }}
          onMouseDown={pressDown} onMouseUp={pressUp}>
          {repairing ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Database style={{ width: 12, height: 12 }} />}
          Repair Index
        </button>
        <button onClick={() => loadStatus()} disabled={loading}
          style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", fontSize: 11 }}
          onMouseDown={pressDown} onMouseUp={pressUp}>
          <RefreshCw style={{ width: 12, height: 12 }} /> Refresh
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ ...mutedCaption, alignSelf: "center" }}>
          <Castle style={{ width: 10, height: 10, display: "inline", verticalAlign: "middle", marginRight: 4 }} />
          {status?.palacePath || "~/.openclaw/mempalace"}
        </span>
      </div>
    </div>
  );
}

/* ─── Cron Job Tab (shared by Mining + KG Extract) ─── */

interface CronLedgerEntry {
  at?: string;
  name?: string;
  job?: string;
  status?: string;
  duration_ms?: number;
  exit?: number;
  details?: string;
  drawers_seen?: number;
  drawers_processed?: number;
  triples_added?: number;
  errors?: number;
  targets?: { target?: string; status?: string; details?: string }[];
}

interface CronJobMeta {
  name?: string;
  enabled?: boolean;
  schedule?: { expr?: string; tz?: string };
  state?: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastRunStatus?: string;
    lastDurationMs?: number;
    consecutiveErrors?: number;
  };
}

function relativeAge(iso: string | null | undefined): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "never";
  const diff = Date.now() - t;
  if (diff < 0) return "scheduled";
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function relativeFutureMs(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  const diff = ms - Date.now();
  if (diff <= 0) return "due now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h ${m % 60}m`;
  return `in ${Math.floor(h / 24)}d`;
}

function CronJobTab({
  jobName, jobLabel, jobId, iconColor,
}: { jobName: string; jobLabel: string; jobId: string; iconColor: string }) {
  const [entries, setEntries] = useState<CronLedgerEntry[]>([]);
  const [meta, setMeta] = useState<CronJobMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const home = await invoke<{ stdout: string }>("execute_command", { command: "echo $env:USERPROFILE\\.openclaw", cwd: null });
      const root = home.stdout.trim().replace(/\r?\n/g, "");

      const ledgerCmd = await cachedCommand(
        `powershell -Command "Get-Content '${root}\\cron\\cron-ledger.jsonl' -Tail 500 -ErrorAction SilentlyContinue"`,
        { ttl: 30_000 },
      );
      const ledger: CronLedgerEntry[] = [];
      if (ledgerCmd.code === 0 && ledgerCmd.stdout.trim()) {
        for (const line of ledgerCmd.stdout.split(/\r?\n/)) {
          const t = line.trim();
          if (!t) continue;
          try {
            const obj = JSON.parse(t) as CronLedgerEntry;
            const n = (obj.name || obj.job || "").toString();
            if (n.includes(jobName)) ledger.push(obj);
          } catch { /* ignore malformed */ }
        }
      }
      ledger.reverse();
      setEntries(ledger.slice(0, 50));

      try {
        const cfg = await invoke<string>("read_file", { path: `${root}\\cron\\jobs.json` });
        const parsed = JSON.parse(cfg) as { jobs?: CronJobMeta[] };
        const j = (parsed.jobs || []).find((x) => (x as CronJobMeta & { id?: string }).id === jobId) || null;
        setMeta(j);
      } catch {
        setMeta(null);
      }
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  }, [jobName, jobId]);

  useEffect(() => { load(); }, [load]);

  const lastOk = entries.find((e) => (e.status || "").toLowerCase() === "ok") || null;

  const totalsLast24h = entries
    .filter((e) => e.at && Date.parse(e.at) > Date.now() - 24 * 3600_000)
    .reduce(
      (acc, e) => {
        acc.runs += 1;
        if ((e.status || "").toLowerCase() !== "ok") acc.errors += 1;
        acc.triples += e.triples_added ?? 0;
        acc.drawers += e.drawers_processed ?? 0;
        return acc;
      },
      { runs: 0, errors: 0, triples: 0, drawers: 0 },
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Pickaxe style={{ width: 14, height: 14, color: iconColor }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{jobLabel}</span>
          <span style={badge(meta?.enabled === false ? "#f87171" : "#4ade80")}>
            {meta?.enabled === false ? "disabled" : "enabled"}
          </span>
        </div>
        <button onClick={load} disabled={loading}
          style={{ ...btnSecondary, padding: "4px 10px", fontSize: 10, display: "flex", alignItems: "center", gap: 4 }}
          onMouseDown={pressDown} onMouseUp={pressUp}>
          {loading ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : <RefreshCw style={{ width: 10, height: 10 }} />}
          Refresh
        </button>
      </div>

      {error && (
        <div style={emptyState}>
          <XCircle style={{ width: 14, height: 14, color: "#f87171", display: "inline", marginRight: 6 }} />
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        <CronStatCard label="Schedule" value={meta?.schedule?.expr || "—"} sub={meta?.schedule?.tz || ""} color={iconColor} />
        <CronStatCard label="Next Run" value={relativeFutureMs(meta?.state?.nextRunAtMs)} sub="" color={iconColor} />
        <CronStatCard label="Last Run" value={relativeAge(lastOk?.at || (meta?.state?.lastRunAtMs ? new Date(meta.state.lastRunAtMs).toISOString() : null))} sub={lastOk?.status || meta?.state?.lastRunStatus || "—"} color={iconColor} />
        <CronStatCard
          label="Last 24h"
          value={`${totalsLast24h.runs} runs`}
          sub={totalsLast24h.triples ? `${totalsLast24h.triples} triples` : (totalsLast24h.drawers ? `${totalsLast24h.drawers} drawers` : `${totalsLast24h.errors} errors`)}
          color={iconColor}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={sectionLabel}>Recent runs ({entries.length})</span>
        {loading && entries.length === 0 ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 30 }}>
            <Loader2 style={{ width: 20, height: 20, color: "var(--accent)", animation: "spin 1s linear infinite" }} />
          </div>
        ) : entries.length === 0 ? (
          <div style={emptyState}>No ledger entries for {jobName} yet. The cron writes to ~/.openclaw/cron/cron-ledger.jsonl after each run.</div>
        ) : (
          <div style={{ ...innerPanel, padding: 0, maxHeight: 380, overflow: "auto" }}>
            {entries.map((e, i) => {
              const ok = (e.status || "").toLowerCase() === "ok";
              return (
                <div key={i} style={{
                  padding: "8px 12px",
                  borderBottom: i === entries.length - 1 ? "none" : "1px solid var(--border)",
                  display: "flex", flexDirection: "column", gap: 2,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: ok ? "#4ade80" : "#f87171", boxShadow: ok ? "0 0 4px #4ade80" : "0 0 4px #f87171", flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: "var(--text)", fontFamily: MONO }}>{e.at || "—"}</span>
                    <span style={badge(ok ? "#4ade80" : "#f87171")}>{e.status || "?"}</span>
                    {typeof e.duration_ms === "number" && (
                      <span style={mutedCaption}>{(e.duration_ms / 1000).toFixed(2)}s</span>
                    )}
                    {typeof e.triples_added === "number" && e.triples_added > 0 && (
                      <span style={badge("#06b6d4")}>+{e.triples_added} triples</span>
                    )}
                    {typeof e.drawers_processed === "number" && e.drawers_processed > 0 && (
                      <span style={badge("#a78bfa")}>{e.drawers_processed} drawers</span>
                    )}
                    {typeof e.errors === "number" && e.errors > 0 && (
                      <span style={badge("#f87171")}>{e.errors} errors</span>
                    )}
                  </div>
                  {(e.details || (e.targets && e.targets.length)) && (
                    <span style={{ ...mutedCaption, fontFamily: MONO, fontSize: 10, marginLeft: 14, wordBreak: "break-word" }}>
                      {e.details || (e.targets || []).map(t => `${t.target}:${t.status}`).join(" · ")}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function CronStatCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={glowCard(color, { padding: "10px 12px" })} data-glow={color}
      onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
      <div style={{ ...sectionLabel, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", fontFamily: MONO }}>{value}</div>
      {sub && <div style={mutedCaption}>{sub}</div>}
    </div>
  );
}

