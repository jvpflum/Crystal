import { useState, useEffect, useCallback } from "react";
import {
  Brain, Search, Plus, RefreshCw, Loader2, FileText, Calendar,
  Edit3, Trash2, Database, Copy, CheckCircle2, XCircle, ChevronDown, ChevronUp,
  HardDrive, Cpu, Activity, Layers, Zap, BarChart3, ArrowRight,
  BookOpen, Flame, Thermometer, Snowflake, Save, Eye,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { openclawClient, MemoryEntry } from "@/lib/openclaw";
import { cachedCommand } from "@/lib/cache";
import { EASE, SPRING, glowCard, hoverLift, hoverReset, pressDown, pressUp, innerPanel, sectionLabel, mutedCaption, iconTile, inputStyle, btnPrimary, btnSecondary, viewContainer, headerRow, scrollArea, badge, emptyState, row as rowStyle, MONO } from "@/styles/viewStyles";

interface MemoryStatus {
  files: number; chunks: number; dirty: boolean; provider: string;
  searchMode: string; vectorReady: boolean; ftsReady: boolean;
}

interface WorkspaceFile {
  name: string; path: string; size: number; modified: string; category: string;
}

function parseStatus(raw: Record<string, unknown> | null): MemoryStatus | null {
  if (!raw) return null;
  const s = raw.status as Record<string, unknown> | undefined;
  if (!s) return null;
  const custom = s.custom as Record<string, unknown> | undefined;
  const vector = s.vector as Record<string, unknown> | undefined;
  const fts = s.fts as Record<string, unknown> | undefined;
  return {
    files: Number(s.files ?? 0), chunks: Number(s.chunks ?? 0), dirty: Boolean(s.dirty),
    provider: String(s.provider ?? "none"),
    searchMode: String(custom?.searchMode ?? "unknown"),
    vectorReady: Boolean(vector?.available), ftsReady: Boolean(fts?.available),
  };
}

type TabId = "kb" | "tiers" | "curated" | "daily" | "search" | "edit" | "vectordb";

const TIER_CATEGORIES: Record<string, { label: string; color: string; icon: typeof Flame; desc: string }> = {
  hot:   { label: "HOT", color: "#ff6a00", icon: Flame, desc: "Active context updated every session" },
  warm:  { label: "WARM", color: "#fbbf24", icon: Thermometer, desc: "Stable facts updated when preferences change" },
  cold:  { label: "COLD", color: "#3b82f6", icon: Snowflake, desc: "Long-term archive (MEMORY.md)" },
  daily: { label: "DAILY", color: "#4ade80", icon: Calendar, desc: "Session logs by date" },
};

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
  const [curatedMemory, setCuratedMemory] = useState<MemoryEntry[]>([]);
  const [dailyMemory, setDailyMemory] = useState<MemoryEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MemoryEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [tab, setTab] = useState<TabId>("kb");
  const [newMemory, setNewMemory] = useState("");
  const [adding, setAdding] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());

  // Knowledge Base state
  const [wsFiles, setWsFiles] = useState<WorkspaceFile[]>([]);
  const [wsFilesLoading, setWsFilesLoading] = useState(false);
  const [viewingFile, setViewingFile] = useState<{ name: string; path: string; content: string } | null>(null);
  const [viewingFileLoading, setViewingFileLoading] = useState(false);
  const [editingKB, setEditingKB] = useState(false);
  const [kbEditContent, setKbEditContent] = useState("");
  const [kbSaving, setKbSaving] = useState(false);
  const [kbFilter, setKbFilter] = useState<string>("all");

  // Tiers state
  const [hotContent, setHotContent] = useState<string | null>(null);
  const [warmContent, setWarmContent] = useState<string | null>(null);
  const [coldContent, setColdContent] = useState<string | null>(null);
  const [tiersLoading, setTiersLoading] = useState(false);
  const [expandedTier, setExpandedTier] = useState<string | null>("hot");

  useEffect(() => { loadMemory(); loadStatus(); }, []);

  const wsDir = useCallback(async () => {
    const home = await invoke<{ stdout: string }>("execute_command", { command: "echo $env:USERPROFILE\\.openclaw", cwd: null });
    return home.stdout.trim().replace(/\r?\n/g, "") + "\\workspace";
  }, []);

  const loadMemory = async () => {
    try {
      const [curated, daily] = await Promise.all([openclawClient.getMemory(), openclawClient.getDailyMemory()]);
      setCuratedMemory(curated); setDailyMemory(daily);
    } catch (e) {
      setFeedback({ type: "error", text: e instanceof Error ? e.message : "Failed to load memory" });
    }
    setLoading(false);
  };

  const loadStatus = async () => {
    try {
      const raw = await openclawClient.getMemoryStatus();
      setStatus(parseStatus(raw));
    } catch { /* status is supplementary */ }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true); setTab("search");
    const results = await openclawClient.searchMemory(searchQuery);
    setSearchResults(results); setSearching(false);
  };

  const handleAddMemory = async () => {
    if (!newMemory.trim()) return;
    setAdding(true); await openclawClient.addMemory(newMemory);
    setNewMemory(""); await loadMemory(); await loadStatus();
    showFeedback("success", "Memory saved & indexed"); setAdding(false);
  };

  const handleDelete = async (entryId: string) => {
    await openclawClient.deleteMemory(entryId); await loadMemory();
    showFeedback("success", "Entry removed");
  };

  const handleReindex = async () => {
    setReindexing(true);
    const result = await openclawClient.reindexMemory();
    await loadStatus();
    showFeedback(result.success ? "success" : "error", result.message);
    setReindexing(false);
  };

  const showFeedback = (type: "success" | "error", text: string) => {
    setFeedback({ type, text }); setTimeout(() => setFeedback(null), 3000);
  };

  // Knowledge Base: load workspace files
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
        // Also load memory subdirectory files
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

  // Tiers: load tiered memory
  const loadTiers = useCallback(async () => {
    setTiersLoading(true);
    try {
      const dir = await wsDir();
      const [hot, warm, cold] = await Promise.all([
        invoke<string>("read_file", { path: `${dir}\\memory\\HOT_MEMORY.md` }).catch(() => null),
        invoke<string>("read_file", { path: `${dir}\\memory\\WARM_MEMORY.md` }).catch(() => null),
        invoke<string>("read_file", { path: `${dir}\\MEMORY.md` }).catch(() => null),
      ]);
      setHotContent(hot); setWarmContent(warm); setColdContent(cold);
    } catch { /* ignore */ }
    setTiersLoading(false);
  }, [wsDir]);

  // Edit tab: load MEMORY.md
  const loadEditContent = useCallback(async () => {
    setEditLoading(true);
    try {
      const dir = await wsDir();
      const content = await invoke<string>("read_file", { path: `${dir}\\MEMORY.md` });
      setEditContent(content);
    } catch { setEditContent(""); }
    setEditLoading(false);
  }, [wsDir]);

  const handleSaveEdit = async () => {
    setEditSaving(true);
    try {
      const dir = await wsDir();
      await invoke("write_file", { path: `${dir}\\MEMORY.md`, content: editContent });
      await openclawClient.reindexMemory();
      await loadMemory(); await loadStatus();
      showFeedback("success", "Saved & reindexed");
    } catch { showFeedback("error", "Failed to save"); }
    setEditSaving(false);
  };

  useEffect(() => {
    if (tab === "edit") loadEditContent();
    if (tab === "kb" && wsFiles.length === 0) loadWsFiles();
    if (tab === "tiers") loadTiers();
  }, [tab, loadEditContent, loadWsFiles, loadTiers, wsFiles.length]);

  const toggleEntry = (id: string) => {
    setExpandedEntries(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const copyEntry = (content: string) => {
    navigator.clipboard.writeText(content); showFeedback("success", "Copied to clipboard");
  };

  const formatBytes = (b: number) => b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`;

  const displayEntries = tab === "search" ? (searchResults || []) : tab === "daily" ? dailyMemory : curatedMemory;

  const filteredFiles = kbFilter === "all" ? wsFiles : wsFiles.filter(f => f.category === kbFilter);
  const categoryGroups = [...new Set(wsFiles.map(f => f.category))].sort();

  const tabDefs: { id: TabId; icon: typeof Brain; label: string }[] = [
    { id: "kb", icon: BookOpen, label: "Knowledge Base" },
    { id: "tiers", icon: Layers, label: "Tiers" },
    { id: "curated", icon: FileText, label: "MEMORY.md" },
    { id: "daily", icon: Calendar, label: "Daily" },
    { id: "search", icon: Search, label: searchResults ? `Results (${searchResults.length})` : "Results" },
    { id: "edit", icon: Edit3, label: "Edit" },
    { id: "vectordb", icon: HardDrive, label: "Vector DB" },
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
            <button onClick={handleReindex} disabled={reindexing}
              style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-muted)", fontSize: 10, background: "none", border: "none", cursor: "pointer", padding: "4px 8px", borderRadius: 6, transition: `all 0.2s ${EASE}` }}
              onMouseDown={pressDown} onMouseUp={pressUp}>
              {reindexing ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Database style={{ width: 12, height: 12 }} />}
              Reindex
            </button>
            <button onClick={() => { loadMemory(); loadStatus(); if (tab === "kb") loadWsFiles(); if (tab === "tiers") loadTiers(); }} disabled={loading}
              style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-muted)", fontSize: 10, background: "none", border: "none", cursor: "pointer", padding: "4px 8px", borderRadius: 6, transition: `all 0.2s ${EASE}` }}
              onMouseDown={pressDown} onMouseUp={pressUp}>
              <RefreshCw style={{ width: 12, height: 12, ...(loading ? { animation: "spin 1s linear infinite" } : {}) }} /> Refresh
            </button>
          </div>
        </div>
        {status && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <span style={badge(status.vectorReady ? "#4ade80" : "#fbbf24")}>
              {status.searchMode === "hybrid" ? "Hybrid Search" : status.searchMode === "fts-only" ? "Text Search Only" : "Search"}
            </span>
            <span style={mutedCaption}>
              {status.files} file{status.files !== 1 ? "s" : ""} · {status.chunks} chunk{status.chunks !== 1 ? "s" : ""}
            </span>
            {status.provider !== "none" && <span style={mutedCaption}>via {status.provider}</span>}
            {status.dirty && <span style={{ fontSize: 9, color: "#fbbf24" }}>needs reindex</span>}
          </div>
        )}
      </div>

      {/* Search */}
      <div style={{ padding: "0 20px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "var(--text-muted)" }} />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearch()}
              placeholder="Semantic search across all memory..."
              style={{ ...inputStyle, padding: "7px 10px 7px 32px", fontSize: 12, boxSizing: "border-box" }} />
          </div>
          <button onClick={handleSearch} disabled={searching || !searchQuery.trim()}
            style={{ ...btnPrimary, padding: "0 12px", fontSize: 11, opacity: searching || !searchQuery.trim() ? 0.5 : 1 }}
            onMouseDown={pressDown} onMouseUp={pressUp}>
            {searching ? <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} /> : "Search"}
          </button>
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

        {/* ─── Tiers Tab ─── */}
        {tab === "tiers" && (
          tiersLoading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
              <Loader2 style={{ width: 24, height: 24, color: "var(--accent)", animation: "spin 1s linear infinite" }} />
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Tier diagram */}
              <div style={{ ...innerPanel, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px" }}>
                <span style={mutedCaption}>Memory Flow:</span>
                {(["hot", "warm", "cold"] as const).map((tier, i) => {
                  const cfg = TIER_CATEGORIES[tier];
                  return (
                    <span key={tier} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      {i > 0 && <ArrowRight style={{ width: 10, height: 10, color: "var(--text-muted)" }} />}
                      <span style={badge(cfg.color)}>{cfg.label}</span>
                    </span>
                  );
                })}
                <span style={{ flex: 1 }} />
                <span style={mutedCaption}>HOT updates every session · WARM on change · COLD archived</span>
              </div>

              {/* Each tier */}
              {(["hot", "warm", "cold", "daily"] as const).map(tierId => {
                const cfg = TIER_CATEGORIES[tierId];
                const Icon = cfg.icon;
                const content = tierId === "hot" ? hotContent : tierId === "warm" ? warmContent : tierId === "cold" ? coldContent : null;
                const isExpanded = expandedTier === tierId;
                const fileName = tierId === "hot" ? "memory/HOT_MEMORY.md" : tierId === "warm" ? "memory/WARM_MEMORY.md" : tierId === "cold" ? "MEMORY.md" : "memory/YYYY-MM-DD.md";

                return (
                  <div key={tierId} data-glow={cfg.color}
                    style={glowCard(cfg.color, isExpanded ? { border: `1px solid ${cfg.color}44` } : undefined)}
                    onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
                    <button onClick={() => setExpandedTier(isExpanded ? null : tierId)}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
                        background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                      <div style={iconTile(cfg.color, 32)}>
                        <Icon style={{ width: 16, height: 16, color: cfg.color }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: cfg.color }}>{cfg.label} MEMORY</div>
                        <div style={mutedCaption}>{cfg.desc}</div>
                      </div>
                      <span style={{ ...mutedCaption, padding: "2px 8px", borderRadius: 4, background: "var(--bg)" }}>{fileName}</span>
                      {content !== null && <span style={mutedCaption}>{formatBytes(content.length)}</span>}
                      {isExpanded ? <ChevronUp style={{ width: 12, height: 12, color: "var(--text-muted)" }} /> : <ChevronDown style={{ width: 12, height: 12, color: "var(--text-muted)" }} />}
                    </button>
                    {isExpanded && tierId !== "daily" && (
                      <div style={{ borderTop: `1px solid ${cfg.color}22`, padding: "12px 14px", maxHeight: 350, overflowY: "auto" }}>
                        {content ? (
                          <pre style={{ margin: 0, fontFamily: MONO, fontSize: 11, color: "var(--text)", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.55 }}>{content}</pre>
                        ) : (
                          <div style={emptyState}>File not found. Create it to start using this memory tier.</div>
                        )}
                      </div>
                    )}
                    {isExpanded && tierId === "daily" && (
                      <div style={{ borderTop: `1px solid ${cfg.color}22`, padding: "12px 14px" }}>
                        {dailyMemory.length > 0 ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {dailyMemory.slice(0, 10).map(entry => (
                              <div key={entry.id} style={{ ...rowStyle, fontSize: 11, color: "var(--text)", padding: "6px 8px" }}>
                                <span style={{ ...mutedCaption, marginRight: 8 }}>{entry.source}</span>
                                {entry.content.length > 120 ? entry.content.slice(0, 120) + "…" : entry.content}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={emptyState}>No daily entries for today.</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Installed memory skills */}
              <div style={glowCard("var(--accent)", { padding: "12px 14px" })}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <Brain style={{ width: 14, height: 14, color: "var(--accent)" }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>Memory Skills (ClawHub)</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
                  {[
                    { name: "memory-tiering", desc: "Automated HOT/WARM/COLD management", status: "installed" },
                    { name: "elite-longterm-memory", desc: "WAL + vector search + git-notes", status: "installed" },
                    { name: "memory-never-forget", desc: "Atkinson-Shiffrin 3-stage model", status: "installed" },
                    { name: "memory-lancedb", desc: "LanceDB vector embeddings", status: "active" },
                  ].map(skill => (
                    <div key={skill.name} style={{ ...innerPanel, padding: "8px 10px" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>{skill.name}</div>
                      <div style={{ ...mutedCaption, marginTop: 2 }}>{skill.desc}</div>
                      <span style={{ ...badge(skill.status === "active" ? "#4ade80" : "var(--accent)"), fontSize: 8, marginTop: 4, display: "inline-block" }}>
                        {skill.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        )}

        {/* ─── Vector DB Tab ─── */}
        {tab === "vectordb" && <VectorDBTab status={status} onReindex={handleReindex} reindexing={reindexing} />}

        {/* ─── Edit Tab ─── */}
        {tab === "edit" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
            {editLoading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
                <Loader2 style={{ width: 24, height: 24, color: "var(--accent)", animation: "spin 1s linear infinite" }} />
              </div>
            ) : (
              <>
                <textarea value={editContent} onChange={e => setEditContent(e.target.value)}
                  style={{ ...inputStyle, flex: 1, minHeight: 200, fontFamily: MONO, fontSize: 12, padding: 12,
                    resize: "none", boxSizing: "border-box" }}
                  spellCheck={false} />
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button onClick={handleSaveEdit} disabled={editSaving}
                    style={{ ...btnPrimary, display: "flex", alignItems: "center", gap: 4, opacity: editSaving ? 0.5 : 1 }}
                    onMouseDown={pressDown} onMouseUp={pressUp}>
                    {editSaving && <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />}
                    Save & Reindex
                  </button>
                  <span style={mutedCaption}>Saves to ~/.openclaw/workspace/MEMORY.md</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* ─── Curated / Daily / Search Tabs ─── */}
        {(tab === "curated" || tab === "daily" || tab === "search") && (
          loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
              <Loader2 style={{ width: 24, height: 24, color: "var(--accent)", animation: "spin 1s linear infinite" }} />
            </div>
          ) : displayEntries.length === 0 ? (
            <div style={emptyState}>
              <Brain style={{ width: 32, height: 32, color: "var(--text-muted)" }} />
              <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {tab === "search" ? "No search results" : tab === "daily" ? "No daily entries for today" : "No memory entries yet"}
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {displayEntries.map(entry => {
                const isExpanded = expandedEntries.has(entry.id);
                const isLong = entry.content.length > 200;
                return (
                  <div key={entry.id} data-glow="var(--accent)"
                    style={glowCard("var(--accent)", { padding: "10px 12px" })}
                    onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ ...mutedCaption, fontWeight: 500 }}>{entry.source}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={badge(entry.type === "curated" ? "var(--accent)" : "#4ade80")}>{entry.type}</span>
                        <button onClick={() => copyEntry(entry.content)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2, display: "flex", transition: `all 0.2s ${EASE}` }}>
                          <Copy style={{ width: 10, height: 10 }} />
                        </button>
                        {tab === "curated" && (
                          <button onClick={() => handleDelete(entry.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2, display: "flex", transition: `all 0.2s ${EASE}` }}>
                            <Trash2 style={{ width: 10, height: 10 }} />
                          </button>
                        )}
                      </div>
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--text)", whiteSpace: "pre-wrap", lineHeight: 1.5,
                      maxHeight: isLong && !isExpanded ? 80 : undefined, overflow: isLong && !isExpanded ? "hidden" : undefined }}>{entry.content}</p>
                    {isLong && (
                      <button onClick={() => toggleEntry(entry.id)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", fontSize: 10, padding: "4px 0 0", display: "flex", alignItems: "center", gap: 4, transition: `all 0.2s ${EASE}` }}>
                        {isExpanded ? <><ChevronUp style={{ width: 10, height: 10 }} /> Show less</> : <><ChevronDown style={{ width: 10, height: 10 }} /> Show more</>}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* Add memory input */}
      {tab === "curated" && (
        <div style={{ padding: "8px 20px 12px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={newMemory} onChange={e => setNewMemory(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAddMemory()}
              placeholder="Add a fact, preference, or note to long-term memory..."
              style={{ ...inputStyle, flex: 1, padding: "7px 10px", fontSize: 12 }} />
            <button onClick={handleAddMemory} disabled={adding || !newMemory.trim()}
              style={{ ...btnPrimary, display: "flex", alignItems: "center", gap: 4, padding: "0 12px", fontSize: 11, opacity: adding || !newMemory.trim() ? 0.5 : 1 }}
              onMouseDown={pressDown} onMouseUp={pressUp}>
              {adding ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Plus style={{ width: 12, height: 12 }} />} Add
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ─── Vector DB Tab ─── */

interface EmbeddingConfig {
  plugin: string; enabled: boolean; autoCapture: boolean; autoRecall: boolean;
  embeddingModel: string; hybridEnabled: boolean; vectorWeight: number; textWeight: number;
  mmrEnabled: boolean; mmrLambda: number; temporalDecayEnabled: boolean; halfLifeDays: number; sources: string[];
}

interface SimilarityResult { path: string; snippet: string; score: number; }

function VectorDBTab({ status, onReindex, reindexing }: { status: MemoryStatus | null; onReindex: () => void; reindexing: boolean }) {
  const [config, setConfig] = useState<EmbeddingConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [simQuery, setSimQuery] = useState("");
  const [simResults, setSimResults] = useState<SimilarityResult[] | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [lanceInfo, setLanceInfo] = useState<{ tablePath: string; exists: boolean; sizeBytes: number } | null>(null);
  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set());

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const [memCfg, ocCfg] = await Promise.all([
        cachedCommand("openclaw config get memory --json", { ttl: 120_000 }),
        cachedCommand("openclaw config get plugins --json", { ttl: 120_000 }),
      ]);
      let embModel = "text-embedding-3-small", autoCapture = true, autoRecall = true, pluginEnabled = true, pluginSlot = "memory-lancedb";
      if (ocCfg.code === 0 && ocCfg.stdout.trim()) {
        try { const p = JSON.parse(ocCfg.stdout); pluginSlot = p?.slots?.memory ?? pluginSlot; const entry = p?.entries?.["memory-lancedb"];
          if (entry) { pluginEnabled = entry.enabled !== false; autoCapture = entry.config?.autoCapture !== false; autoRecall = entry.config?.autoRecall !== false; embModel = entry.config?.embedding?.model ?? embModel; }
        } catch { /* */ }
      }
      let hybridEnabled = true, vectorWeight = 0.7, textWeight = 0.3, mmrEnabled = true, mmrLambda = 0.7, temporalDecayEnabled = true, halfLifeDays = 30, sources = ["memory", "sessions"];
      if (memCfg.code === 0 && memCfg.stdout.trim()) {
        try { const m = JSON.parse(memCfg.stdout); const ms = m?.memorySearch ?? m; sources = ms?.sources ?? sources;
          const h = ms?.query?.hybrid ?? {};
          hybridEnabled = h?.enabled !== false; vectorWeight = h?.vectorWeight ?? vectorWeight; textWeight = h?.textWeight ?? textWeight;
          mmrEnabled = h?.mmr?.enabled !== false; mmrLambda = h?.mmr?.lambda ?? mmrLambda;
          temporalDecayEnabled = h?.temporalDecay?.enabled !== false; halfLifeDays = h?.temporalDecay?.halfLifeDays ?? halfLifeDays;
        } catch { /* */ }
      }
      setConfig({ plugin: pluginSlot, enabled: pluginEnabled, autoCapture, autoRecall, embeddingModel: embModel,
        hybridEnabled, vectorWeight, textWeight, mmrEnabled, mmrLambda, temporalDecayEnabled, halfLifeDays, sources });
    } catch { /* */ }
    setConfigLoading(false);
  }, []);

  const loadLanceInfo = useCallback(async () => {
    try {
      const result = await cachedCommand(
        `powershell -Command "$p = Join-Path $env:USERPROFILE '.openclaw\\memory\\lancedb\\memories.lance'; if(Test-Path $p){ $s = (Get-ChildItem $p -Recurse | Measure-Object -Property Length -Sum).Sum; Write-Output ('{0}|{1}' -f $s, $p) } else { Write-Output 'MISSING' }"`,
        { ttl: 60_000 },
      );
      if (result.code === 0 && result.stdout.trim() !== "MISSING") {
        const parts = result.stdout.trim().split("|");
        setLanceInfo({ sizeBytes: Number(parts[0]) || 0, tablePath: parts[1] || "", exists: true });
      } else {
        setLanceInfo({ tablePath: "", exists: false, sizeBytes: 0 });
      }
    } catch { setLanceInfo({ tablePath: "", exists: false, sizeBytes: 0 }); }
  }, []);

  useEffect(() => { loadConfig(); loadLanceInfo(); }, [loadConfig, loadLanceInfo]);

  const handleSimilaritySearch = async () => {
    if (!simQuery.trim()) return;
    setSimLoading(true); setSimResults(null);
    try {
      const results = await openclawClient.searchMemory(simQuery);
      setSimResults(results.map(r => ({ path: r.source, snippet: r.content, score: parseFloat(r.date?.replace("score: ", "") ?? "0") })));
    } catch { setSimResults([]); }
    setSimLoading(false);
  };

  const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  const toggleChunk = (idx: number) => { setExpandedChunks(prev => { const next = new Set(prev); if (next.has(idx)) next.delete(idx); else next.add(idx); return next; }); };

  const vdbCard = glowCard("var(--accent)", { padding: "14px 16px" });
  const metricStyle: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: "var(--text)", fontFamily: MONO, fontVariantNumeric: "tabular-nums" };

  if (configLoading) return <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Loader2 style={{ width: 24, height: 24, color: "var(--accent)", animation: "spin 1s linear infinite" }} /></div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        <div style={vdbCard} data-glow="var(--accent)" onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
          <div style={sectionLabel}>Table</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
            <HardDrive style={{ width: 14, height: 14, color: "var(--accent)" }} />memories
          </div>
          <div style={{ ...mutedCaption, marginTop: 4 }}>{lanceInfo?.exists ? formatBytes(lanceInfo.sizeBytes) : "not found"}</div>
        </div>
        <div style={vdbCard} data-glow="var(--accent)" onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
          <div style={sectionLabel}>Chunks</div>
          <div style={metricStyle}>{status?.chunks ?? "—"}</div>
          <div style={{ ...mutedCaption, marginTop: 2 }}>from {status?.files ?? 0} files</div>
        </div>
        <div style={vdbCard} data-glow="var(--accent)" onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
          <div style={sectionLabel}>Vector Index</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: status?.vectorReady ? "#4ade80" : "#f87171" }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{status?.vectorReady ? "Ready" : "Offline"}</span>
          </div>
          <div style={{ ...mutedCaption, marginTop: 4 }}>{status?.dirty ? "needs reindex" : "up to date"}</div>
        </div>
        <div style={vdbCard} data-glow="var(--accent)" onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
          <div style={sectionLabel}>FTS Index</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: status?.ftsReady ? "#4ade80" : "#f87171" }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{status?.ftsReady ? "Ready" : "Offline"}</span>
          </div>
          <div style={{ ...mutedCaption, marginTop: 4 }}>full-text search</div>
        </div>
      </div>

      {config && (
        <div style={vdbCard} data-glow="var(--accent)" onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Cpu style={{ width: 14, height: 14, color: "var(--accent)" }} /><span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Embedding Configuration</span></div>
            <span style={badge(config.enabled ? "#4ade80" : "#f87171")}>{config.enabled ? "Active" : "Disabled"}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <div><div style={sectionLabel}>Model</div><div style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>{config.embeddingModel}</div><div style={{ ...mutedCaption, marginTop: 2 }}>1536 dimensions</div></div>
            <div><div style={sectionLabel}>Plugin</div><div style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>{config.plugin}</div><div style={{ ...mutedCaption, marginTop: 2 }}>LanceDB backend</div></div>
            <div><div style={sectionLabel}>Sources</div><div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{config.sources.map(s => <span key={s} style={badge("var(--accent)")}>{s}</span>)}</div></div>
            <div><div style={sectionLabel}>Auto Capture</div><div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: config.autoCapture ? "#4ade80" : "#f87171" }} /><span style={{ fontSize: 11, color: "var(--text)" }}>{config.autoCapture ? "On" : "Off"}</span></div></div>
            <div><div style={sectionLabel}>Auto Recall</div><div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: config.autoRecall ? "#4ade80" : "#f87171" }} /><span style={{ fontSize: 11, color: "var(--text)" }}>{config.autoRecall ? "On" : "Off"}</span></div></div>
            <div><div style={sectionLabel}>Provider</div><div style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>{status?.provider ?? "openai"}</div></div>
          </div>
        </div>
      )}

      {config?.hybridEnabled && (
        <div style={vdbCard} data-glow="var(--accent)" onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}><Activity style={{ width: 14, height: 14, color: "var(--accent)" }} /><span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Hybrid Search Pipeline</span></div>
          <div style={{ marginBottom: 16 }}>
            <div style={sectionLabel}>Search Weights</div>
            <div style={{ display: "flex", height: 24, borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)" }}>
              <div style={{ width: `${config.vectorWeight * 100}%`, background: "rgba(59,130,246,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 600, color: "var(--accent)" }}>Vector {(config.vectorWeight * 100).toFixed(0)}%</div>
              <div style={{ width: `${config.textWeight * 100}%`, background: "rgba(168,85,247,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 600, color: "#a855f7" }}>Text {(config.textWeight * 100).toFixed(0)}%</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <div><div style={sectionLabel}>MMR (Diversity)</div><div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: config.mmrEnabled ? "#4ade80" : "#f87171" }} /><span style={{ fontSize: 11, color: "var(--text)" }}>{config.mmrEnabled ? `λ = ${config.mmrLambda}` : "Off"}</span></div></div>
            <div><div style={sectionLabel}>Temporal Decay</div><div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: config.temporalDecayEnabled ? "#4ade80" : "#f87171" }} /><span style={{ fontSize: 11, color: "var(--text)" }}>{config.temporalDecayEnabled ? `${config.halfLifeDays}d half-life` : "Off"}</span></div></div>
            <div><div style={sectionLabel}>Search Mode</div><span style={badge("#4ade80")}>{status?.searchMode ?? "hybrid"}</span></div>
          </div>
        </div>
      )}

      <div style={vdbCard} data-glow="var(--accent)" onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}><Zap style={{ width: 14, height: 14, color: "var(--accent)" }} /><span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Similarity Explorer</span></div>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "var(--text-muted)" }} />
            <input value={simQuery} onChange={e => setSimQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSimilaritySearch()}
              placeholder="Enter text to find nearest neighbors in embedding space..."
              style={{ ...inputStyle, padding: "8px 10px 8px 32px", fontSize: 12, boxSizing: "border-box" }} />
          </div>
          <button onClick={handleSimilaritySearch} disabled={simLoading || !simQuery.trim()}
            style={{ ...btnPrimary, padding: "0 14px", fontSize: 11, opacity: simLoading || !simQuery.trim() ? 0.5 : 1, display: "flex", alignItems: "center", gap: 4 }}
            onMouseDown={pressDown} onMouseUp={pressUp}>
            {simLoading ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <ArrowRight style={{ width: 12, height: 12 }} />} Search
          </button>
        </div>
        {simLoading && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 16, justifyContent: "center" }}><Loader2 style={{ width: 16, height: 16, color: "var(--accent)", animation: "spin 1s linear infinite" }} /><span style={mutedCaption}>Computing embeddings & searching vector space...</span></div>}
        {simResults && !simLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={mutedCaption}>{simResults.length} nearest neighbor{simResults.length !== 1 ? "s" : ""} found</span>
            </div>
            {simResults.length === 0 ? (
              <div style={emptyState}>No similar embeddings found.</div>
            ) : simResults.map((r, i) => {
              const isExpanded = expandedChunks.has(i);
              const isLong = r.snippet.length > 200;
              const barWidth = Math.max(5, r.score * 100);
              const scoreColor = r.score > 0.3 ? "#4ade80" : r.score > 0.15 ? "#fbbf24" : "#f87171";
              return (
                <div key={i} style={{ ...innerPanel, padding: "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: scoreColor, fontFamily: MONO, fontVariantNumeric: "tabular-nums", minWidth: 40 }}>{r.score.toFixed(3)}</span>
                      <div style={{ height: 4, borderRadius: 2, background: "var(--border)", width: 80 }}><div style={{ height: "100%", borderRadius: 2, background: scoreColor, width: `${barWidth}%`, transition: `width 0.3s ${SPRING}` }} /></div>
                      <span style={mutedCaption}>#{i + 1}</span>
                    </div>
                    <span style={{ ...badge("var(--accent)"), maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.path}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--text)", whiteSpace: "pre-wrap", lineHeight: 1.5, fontFamily: MONO,
                    maxHeight: isLong && !isExpanded ? 60 : undefined, overflow: isLong && !isExpanded ? "hidden" : undefined }}>{r.snippet}</p>
                  {isLong && <button onClick={() => toggleChunk(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", fontSize: 10, padding: "4px 0 0", display: "flex", alignItems: "center", gap: 4, transition: `all 0.2s ${EASE}` }}>
                    {isExpanded ? <><ChevronUp style={{ width: 10, height: 10 }} /> Show less</> : <><ChevronDown style={{ width: 10, height: 10 }} /> Show more</>}
                  </button>}
                </div>
              );
            })}
          </div>
        )}
        {!simResults && !simLoading && (
          <div style={emptyState}>
            <BarChart3 style={{ width: 24, height: 24, opacity: 0.4 }} />
            <p style={{ margin: 0 }}>Enter a query to explore the embedding space. Results ranked by cosine similarity with hybrid reranking.</p>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={onReindex} disabled={reindexing}
          style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", fontSize: 11, opacity: reindexing ? 0.5 : 1 }}
          onMouseDown={pressDown} onMouseUp={pressUp}>
          {reindexing ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Database style={{ width: 12, height: 12 }} />} Rebuild Index
        </button>
        <button onClick={() => { loadConfig(); loadLanceInfo(); }}
          style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", fontSize: 11 }}
          onMouseDown={pressDown} onMouseUp={pressUp}>
          <RefreshCw style={{ width: 12, height: 12 }} /> Refresh Config
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ ...mutedCaption, alignSelf: "center" }}>
          <Layers style={{ width: 10, height: 10, display: "inline", verticalAlign: "middle", marginRight: 4 }} />
          {lanceInfo?.tablePath || "~/.openclaw/memory/lancedb/memories.lance"}
        </span>
      </div>

      <MemoryCleanup onReindex={onReindex} reindexing={reindexing} onRefreshLance={loadLanceInfo} />
    </div>
  );
}

function MemoryCleanup({ onReindex, reindexing, onRefreshLance }: { onReindex: () => void; reindexing: boolean; onRefreshLance: () => void }) {
  const [dailyFiles, setDailyFiles] = useState<{ name: string; path: string; size: number }[]>([]);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [deletingDaily, setDeletingDaily] = useState(false);
  const [selectedDays, setSelectedDays] = useState<Set<string>>(new Set());
  const [dailyDelProgress, setDailyDelProgress] = useState<{ done: number; total: number } | null>(null);
  const [clearingIndex, setClearingIndex] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  useEffect(() => {
    if (feedback) { const t = setTimeout(() => setFeedback(null), 5000); return () => clearTimeout(t); }
  }, [feedback]);

  const loadDailyFiles = useCallback(async () => {
    setDailyLoading(true);
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: `powershell -Command "$d = Join-Path $env:USERPROFILE '.openclaw\\workspace\\memory'; if(Test-Path $d){ Get-ChildItem $d -Filter '*.md' | Where-Object { $_.Name -match '^\\d{4}-\\d{2}-\\d{2}\\.md$' } | Sort-Object Name -Descending | ForEach-Object { Write-Output ('{0}|{1}|{2}' -f $_.Name, $_.FullName, $_.Length) } } else { Write-Output 'EMPTY' }"`,
        cwd: null,
      });
      if (result.code === 0 && result.stdout.trim() !== "EMPTY") {
        const files = result.stdout.trim().split("\n").filter(Boolean).map(line => {
          const [name, path, size] = line.trim().split("|");
          return { name: name || "", path: path || "", size: Number(size) || 0 };
        }).filter(f => f.name);
        setDailyFiles(files);
      } else {
        setDailyFiles([]);
      }
    } catch { setDailyFiles([]); }
    setDailyLoading(false);
  }, []);

  useEffect(() => { loadDailyFiles(); }, [loadDailyFiles]);

  const toggleDay = (name: string) => {
    setSelectedDays(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const selectOlderThan = (days: number) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const matching = dailyFiles.filter(f => f.name.replace(".md", "") < cutoffStr).map(f => f.name);
    setSelectedDays(new Set(matching));
    if (matching.length === 0) setFeedback({ type: "success", msg: `No daily logs older than ${days} days` });
  };

  const deleteSelectedDays = async () => {
    const toDelete = dailyFiles.filter(f => selectedDays.has(f.name));
    if (toDelete.length === 0) return;
    setDeletingDaily(true);
    setDailyDelProgress({ done: 0, total: toDelete.length });
    let deleted = 0;
    for (const file of toDelete) {
      try {
        await invoke("execute_command", {
          command: `powershell -Command "Remove-Item -LiteralPath '${file.path}' -Force"`, cwd: null,
        });
        deleted++;
        setDailyDelProgress({ done: deleted, total: toDelete.length });
      } catch { /* continue */ }
    }
    setFeedback({ type: "success", msg: `Deleted ${deleted} daily log${deleted !== 1 ? "s" : ""}` });
    setSelectedDays(new Set());
    setDeletingDaily(false);
    setDailyDelProgress(null);
    await loadDailyFiles();
  };

  const clearVectorIndex = async () => {
    setClearingIndex(true);
    try {
      await invoke("execute_command", {
        command: `powershell -Command "$p = Join-Path $env:USERPROFILE '.openclaw\\memory\\lancedb\\memories.lance'; if(Test-Path $p){ Remove-Item $p -Recurse -Force; Write-Output 'CLEARED' } else { Write-Output 'NOT_FOUND' }"`,
        cwd: null,
      });
      setFeedback({ type: "success", msg: "Vector index cleared. Rebuild to re-embed your memory files." });
      setShowClearConfirm(false);
      onRefreshLance();
    } catch {
      setFeedback({ type: "error", msg: "Failed to clear vector index" });
    }
    setClearingIndex(false);
  };

  const totalDailySize = dailyFiles.reduce((a, f) => a + f.size, 0);
  const selectedSize = dailyFiles.filter(f => selectedDays.has(f.name)).reduce((a, f) => a + f.size, 0);
  const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Trash2 style={{ width: 13, height: 13, color: "#f87171" }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Memory Cleanup</span>
      </div>

      {feedback && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 10,
          background: feedback.type === "success" ? "rgba(74,222,128,0.06)" : "rgba(248,113,113,0.06)",
          border: `1px solid ${feedback.type === "success" ? "rgba(74,222,128,0.15)" : "rgba(248,113,113,0.15)"}`,
        }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: feedback.type === "success" ? "#4ade80" : "#f87171", flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: feedback.type === "success" ? "#4ade80" : "#f87171", flex: 1 }}>{feedback.msg}</span>
        </div>
      )}

      {/* Daily log cleanup */}
      <div style={glowCard("#fbbf24", { padding: "14px 16px" })} data-glow="#fbbf24" onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Calendar style={{ width: 14, height: 14, color: "#fbbf24" }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>Daily Memory Logs</span>
            <span style={badge("#fbbf24")}>{dailyFiles.length} files</span>
            <span style={mutedCaption}>{formatBytes(totalDailySize)}</span>
          </div>
          <button onClick={loadDailyFiles} disabled={dailyLoading}
            style={{ ...btnSecondary, padding: "4px 8px", fontSize: 10, display: "flex", alignItems: "center", gap: 4 }}>
            <RefreshCw style={{ width: 9, height: 9 }} className={dailyLoading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          <span style={{ fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.06em", alignSelf: "center" }}>SELECT:</span>
          {[7, 14, 30, 90].map(d => (
            <button key={d} onClick={() => selectOlderThan(d)}
              style={{ ...btnSecondary, padding: "3px 8px", fontSize: 9 }}>
              {">"}{d}d old
            </button>
          ))}
          <button onClick={() => setSelectedDays(new Set(dailyFiles.map(f => f.name)))}
            style={{ ...btnSecondary, padding: "3px 8px", fontSize: 9 }}>All</button>
          <button onClick={() => setSelectedDays(new Set())}
            style={{ ...btnSecondary, padding: "3px 8px", fontSize: 9 }}>None</button>
        </div>

        {dailyDelProgress && (
          <div style={{ ...innerPanel, padding: "6px 10px", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
            <Loader2 style={{ width: 11, height: 11, color: "var(--accent)" }} className="animate-spin" />
            <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>Deleting {dailyDelProgress.done}/{dailyDelProgress.total}…</span>
            <div style={{ flex: 1, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.04)" }}>
              <div style={{ width: `${(dailyDelProgress.done / dailyDelProgress.total) * 100}%`, height: "100%", background: "var(--accent)", borderRadius: 2, transition: `width 0.2s ${EASE}` }} />
            </div>
          </div>
        )}

        {selectedDays.size > 0 && !deletingDaily && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 8, marginBottom: 8,
            background: "rgba(248,113,113,0.05)", border: "1px solid rgba(248,113,113,0.1)",
          }}>
            <span style={{ fontSize: 10, color: "var(--text-secondary)", flex: 1 }}>
              {selectedDays.size} file{selectedDays.size !== 1 ? "s" : ""} selected ({formatBytes(selectedSize)})
            </span>
            <button onClick={deleteSelectedDays} onMouseDown={pressDown} onMouseUp={pressUp}
              style={{ ...btnPrimary, background: "#dc2626", padding: "4px 12px", fontSize: 10 }}>
              <Trash2 style={{ width: 10, height: 10, marginRight: 4, verticalAlign: -1 }} /> Delete Selected
            </button>
          </div>
        )}

        {dailyLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 20 }}>
            <Loader2 style={{ width: 16, height: 16, color: "var(--accent)", animation: "spin 1s linear infinite" }} />
          </div>
        ) : dailyFiles.length === 0 ? (
          <div style={{ ...emptyState, padding: "16px 12px" }}>No daily log files found.</div>
        ) : (
          <div style={{ maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
            {dailyFiles.map(f => {
              const dateStr = f.name.replace(".md", "");
              const age = Math.floor((Date.now() - new Date(dateStr).getTime()) / (24 * 60 * 60 * 1000));
              const isSel = selectedDays.has(f.name);
              return (
                <label key={f.name} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 6, cursor: "pointer",
                  background: isSel ? "rgba(59,130,246,0.06)" : "rgba(255,255,255,0.01)",
                  border: `1px solid ${isSel ? "rgba(59,130,246,0.15)" : "transparent"}`,
                  transition: `all 0.15s ${EASE}`,
                }}>
                  <input type="checkbox" checked={isSel} onChange={() => toggleDay(f.name)}
                    style={{ width: 13, height: 13, accentColor: "var(--accent)", cursor: "pointer" }} />
                  <span style={{ fontSize: 11, color: "var(--text)", fontFamily: MONO, flex: 1 }}>{dateStr}</span>
                  <span style={mutedCaption}>{formatBytes(f.size)}</span>
                  <span style={{
                    ...badge(age > 30 ? "#f87171" : age > 7 ? "#fbbf24" : "#4ade80"),
                    fontSize: 8,
                  }}>
                    {age === 0 ? "today" : age === 1 ? "1d ago" : `${age}d ago`}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Vector index cleanup */}
      <div style={glowCard("#f87171", { padding: "14px 16px" })} data-glow="#f87171" onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Database style={{ width: 14, height: 14, color: "#f87171" }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>Vector Index Management</span>
        </div>
        <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "0 0 10px", lineHeight: 1.5 }}>
          Clear the LanceDB vector index to free disk space. After clearing, rebuild the index to re-embed your memory files.
          This is safe — your source markdown files are untouched.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          {!showClearConfirm ? (
            <button onClick={() => setShowClearConfirm(true)}
              style={{ ...btnSecondary, color: "#f87171", borderColor: "rgba(248,113,113,0.15)", fontSize: 11, display: "flex", alignItems: "center", gap: 6, padding: "7px 14px" }}
              onMouseDown={pressDown} onMouseUp={pressUp}>
              <Trash2 style={{ width: 12, height: 12 }} /> Clear Vector Index
            </button>
          ) : (
            <>
              <button onClick={clearVectorIndex} disabled={clearingIndex}
                style={{ ...btnPrimary, background: "#dc2626", fontSize: 11, display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", opacity: clearingIndex ? 0.5 : 1 }}
                onMouseDown={pressDown} onMouseUp={pressUp}>
                {clearingIndex ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Trash2 style={{ width: 12, height: 12 }} />}
                Confirm Clear
              </button>
              <button onClick={() => setShowClearConfirm(false)}
                style={{ ...btnSecondary, fontSize: 11, padding: "7px 14px" }}>
                Cancel
              </button>
            </>
          )}
          <button onClick={onReindex} disabled={reindexing}
            style={{ ...btnSecondary, fontSize: 11, display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", opacity: reindexing ? 0.5 : 1 }}
            onMouseDown={pressDown} onMouseUp={pressUp}>
            {reindexing ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Database style={{ width: 12, height: 12 }} />}
            Rebuild Index
          </button>
        </div>
      </div>
    </div>
  );
}
