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
  "MIGRATION-TO-CHROMEDOME.md": "infra", "JARROD-HQ-SYSTEM.md": "infra",
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
    const [curated, daily] = await Promise.all([openclawClient.getMemory(), openclawClient.getDailyMemory()]);
    setCuratedMemory(curated); setDailyMemory(daily); setLoading(false);
  };

  const loadStatus = async () => {
    const raw = await openclawClient.getMemoryStatus();
    setStatus(parseStatus(raw));
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
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Memory</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {feedback && (
              <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, display: "flex", alignItems: "center", gap: 4,
                background: feedback.type === "success" ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)",
                color: feedback.type === "success" ? "#4ade80" : "#f87171" }}>
                {feedback.type === "success" ? <CheckCircle2 style={{ width: 10, height: 10 }} /> : <XCircle style={{ width: 10, height: 10 }} />}
                {feedback.text}
              </span>
            )}
            <button onClick={handleReindex} disabled={reindexing}
              style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-muted)", fontSize: 10, background: "none", border: "none", cursor: "pointer", padding: "4px 8px", borderRadius: 6 }}>
              {reindexing ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Database style={{ width: 12, height: 12 }} />}
              Reindex
            </button>
            <button onClick={() => { loadMemory(); loadStatus(); if (tab === "kb") loadWsFiles(); if (tab === "tiers") loadTiers(); }} disabled={loading}
              style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-muted)", fontSize: 10, background: "none", border: "none", cursor: "pointer", padding: "4px 8px", borderRadius: 6 }}>
              <RefreshCw style={{ width: 12, height: 12, ...(loading ? { animation: "spin 1s linear infinite" } : {}) }} /> Refresh
            </button>
          </div>
        </div>
        {status && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 6,
              background: status.vectorReady ? "rgba(74,222,128,0.1)" : "rgba(251,191,36,0.1)",
              color: status.vectorReady ? "#4ade80" : "#fbbf24", fontWeight: 500 }}>
              {status.searchMode === "hybrid" ? "Hybrid Search" : status.searchMode === "fts-only" ? "Text Search Only" : "Search"}
            </span>
            <span style={{ fontSize: 9, color: "var(--text-muted)" }}>
              {status.files} file{status.files !== 1 ? "s" : ""} · {status.chunks} chunk{status.chunks !== 1 ? "s" : ""}
            </span>
            {status.provider !== "none" && <span style={{ fontSize: 9, color: "var(--text-muted)" }}>via {status.provider}</span>}
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
              style={{ width: "100%", padding: "7px 10px 7px 32px", borderRadius: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, outline: "none", boxSizing: "border-box" }} />
          </div>
          <button onClick={handleSearch} disabled={searching || !searchQuery.trim()}
            style={{ padding: "0 12px", borderRadius: 8, background: "var(--accent)", border: "none", color: "white", fontSize: 11, cursor: "pointer", opacity: searching || !searchQuery.trim() ? 0.5 : 1 }}>
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
              display: "flex", alignItems: "center", gap: 4,
              background: tab === t.id ? "rgba(59,130,246,0.18)" : "var(--bg-elevated)",
              color: tab === t.id ? "var(--accent)" : "var(--text-muted)" }}>
              <Icon style={{ width: 10, height: 10 }} />{t.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 12px", display: "flex", flexDirection: "column", minHeight: 0 }}>

        {/* ─── Knowledge Base Tab ─── */}
        {tab === "kb" && (
          viewingFile ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button onClick={() => { setViewingFile(null); setEditingKB(false); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", fontSize: 11, padding: "4px 8px", borderRadius: 6 }}>
                    ← Back
                  </button>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{viewingFile.name}</span>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {!editingKB ? (
                    <button onClick={() => { setEditingKB(true); setKbEditContent(viewingFile.content); }}
                      style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 10, cursor: "pointer" }}>
                      <Edit3 style={{ width: 10, height: 10 }} /> Edit
                    </button>
                  ) : (
                    <>
                      <button onClick={saveKbFile} disabled={kbSaving}
                        style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, background: "var(--accent)", border: "none", color: "white", fontSize: 10, cursor: "pointer", opacity: kbSaving ? 0.5 : 1 }}>
                        {kbSaving ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : <Save style={{ width: 10, height: 10 }} />} Save
                      </button>
                      <button onClick={() => setEditingKB(false)}
                        style={{ padding: "4px 10px", borderRadius: 6, background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 10, cursor: "pointer" }}>
                        Cancel
                      </button>
                    </>
                  )}
                  <button onClick={() => copyEntry(viewingFile.content)}
                    style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 10, cursor: "pointer" }}>
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
                  style={{ flex: 1, minHeight: 200, fontFamily: "monospace", fontSize: 12, padding: 12,
                    background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8,
                    color: "var(--text)", resize: "none", width: "100%", outline: "none", boxSizing: "border-box" }}
                  spellCheck={false} />
              ) : (
                <pre style={{ flex: 1, margin: 0, fontFamily: "monospace", fontSize: 12, padding: 14,
                  background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8,
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
                  style={{ padding: "3px 10px", borderRadius: 6, border: "none", fontSize: 10, cursor: "pointer",
                    background: kbFilter === "all" ? "rgba(59,130,246,0.2)" : "var(--bg-elevated)",
                    color: kbFilter === "all" ? "var(--accent)" : "var(--text-muted)" }}>
                  All ({wsFiles.length})
                </button>
                {categoryGroups.map(cat => {
                  const meta = CATEGORY_META[cat] || { label: cat, color: "var(--text-muted)" };
                  const count = wsFiles.filter(f => f.category === cat).length;
                  return (
                    <button key={cat} onClick={() => setKbFilter(cat)}
                      style={{ padding: "3px 10px", borderRadius: 6, border: "none", fontSize: 10, cursor: "pointer",
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
                <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)", fontSize: 12 }}>
                  No files found in this category.
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
                  {filteredFiles.map(file => {
                    const meta = CATEGORY_META[file.category] || { label: file.category, color: "var(--text-muted)" };
                    return (
                      <button key={file.name} onClick={() => viewFile(file)}
                        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8,
                          padding: "10px 12px", cursor: "pointer", textAlign: "left", display: "flex", flexDirection: "column", gap: 4,
                          transition: "border-color 0.15s" }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = meta.color; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <FileText style={{ width: 12, height: 12, color: meta.color }} />
                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{file.name}</span>
                          </div>
                          <Eye style={{ width: 10, height: 10, color: "var(--text-muted)" }} />
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: `${meta.color}15`, color: meta.color }}>{meta.label}</span>
                          <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{formatBytes(file.size)}</span>
                          <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{file.modified}</span>
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
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "var(--bg-elevated)", borderRadius: 8, border: "1px solid var(--border)" }}>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Memory Flow:</span>
                {(["hot", "warm", "cold"] as const).map((tier, i) => {
                  const cfg = TIER_CATEGORIES[tier];
                  return (
                    <span key={tier} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      {i > 0 && <ArrowRight style={{ width: 10, height: 10, color: "var(--text-muted)" }} />}
                      <span style={{ fontSize: 10, fontWeight: 700, color: cfg.color, padding: "2px 8px", borderRadius: 4, background: `${cfg.color}15` }}>
                        {cfg.label}
                      </span>
                    </span>
                  );
                })}
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 9, color: "var(--text-muted)" }}>HOT updates every session • WARM on change • COLD archived</span>
              </div>

              {/* Each tier */}
              {(["hot", "warm", "cold", "daily"] as const).map(tierId => {
                const cfg = TIER_CATEGORIES[tierId];
                const Icon = cfg.icon;
                const content = tierId === "hot" ? hotContent : tierId === "warm" ? warmContent : tierId === "cold" ? coldContent : null;
                const isExpanded = expandedTier === tierId;
                const fileName = tierId === "hot" ? "memory/HOT_MEMORY.md" : tierId === "warm" ? "memory/WARM_MEMORY.md" : tierId === "cold" ? "MEMORY.md" : "memory/YYYY-MM-DD.md";

                return (
                  <div key={tierId} style={{ background: "var(--bg-elevated)", border: `1px solid ${isExpanded ? cfg.color + "44" : "var(--border)"}`, borderRadius: 10, overflow: "hidden" }}>
                    <button onClick={() => setExpandedTier(isExpanded ? null : tierId)}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
                        background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: `${cfg.color}15` }}>
                        <Icon style={{ width: 16, height: 16, color: cfg.color }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: cfg.color }}>{cfg.label} MEMORY</div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{cfg.desc}</div>
                      </div>
                      <span style={{ fontSize: 9, color: "var(--text-muted)", padding: "2px 8px", borderRadius: 4, background: "var(--bg)" }}>{fileName}</span>
                      {content !== null && <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{formatBytes(content.length)}</span>}
                      {isExpanded ? <ChevronUp style={{ width: 12, height: 12, color: "var(--text-muted)" }} /> : <ChevronDown style={{ width: 12, height: 12, color: "var(--text-muted)" }} />}
                    </button>
                    {isExpanded && tierId !== "daily" && (
                      <div style={{ borderTop: `1px solid ${cfg.color}22`, padding: "12px 14px", maxHeight: 350, overflowY: "auto" }}>
                        {content ? (
                          <pre style={{ margin: 0, fontFamily: "monospace", fontSize: 11, color: "var(--text)", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.55 }}>{content}</pre>
                        ) : (
                          <div style={{ textAlign: "center", padding: 20, color: "var(--text-muted)", fontSize: 11 }}>File not found. Create it to start using this memory tier.</div>
                        )}
                      </div>
                    )}
                    {isExpanded && tierId === "daily" && (
                      <div style={{ borderTop: `1px solid ${cfg.color}22`, padding: "12px 14px" }}>
                        {dailyMemory.length > 0 ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {dailyMemory.slice(0, 10).map(entry => (
                              <div key={entry.id} style={{ fontSize: 11, color: "var(--text)", padding: "6px 8px", background: "var(--bg)", borderRadius: 6 }}>
                                <span style={{ fontSize: 9, color: "var(--text-muted)", marginRight: 8 }}>{entry.source}</span>
                                {entry.content.length > 120 ? entry.content.slice(0, 120) + "…" : entry.content}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ textAlign: "center", padding: 16, color: "var(--text-muted)", fontSize: 11 }}>No daily entries for today.</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Installed memory skills */}
              <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
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
                    <div key={skill.name} style={{ padding: "8px 10px", borderRadius: 6, background: "var(--bg)", border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>{skill.name}</div>
                      <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 2 }}>{skill.desc}</div>
                      <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 4, marginTop: 4, display: "inline-block",
                        background: skill.status === "active" ? "rgba(74,222,128,0.15)" : "rgba(59,130,246,0.1)",
                        color: skill.status === "active" ? "#4ade80" : "var(--accent)" }}>
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
                  style={{ flex: 1, minHeight: 200, fontFamily: "monospace", fontSize: 12, padding: 12,
                    background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8,
                    color: "var(--text)", resize: "none", width: "100%", outline: "none", boxSizing: "border-box" }}
                  spellCheck={false} />
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button onClick={handleSaveEdit} disabled={editSaving}
                    style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 14px", borderRadius: 8, background: "var(--accent)", border: "none", color: "white", fontSize: 11, cursor: "pointer", opacity: editSaving ? 0.5 : 1 }}>
                    {editSaving && <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />}
                    Save & Reindex
                  </button>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Saves to ~/.openclaw/workspace/MEMORY.md</span>
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
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 8 }}>
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
                  <div key={entry.id} style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500 }}>{entry.source}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4,
                          background: entry.type === "curated" ? "rgba(59,130,246,0.15)" : "rgba(74,222,128,0.15)",
                          color: entry.type === "curated" ? "var(--accent)" : "#4ade80" }}>{entry.type}</span>
                        <button onClick={() => copyEntry(entry.content)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2, display: "flex" }}>
                          <Copy style={{ width: 10, height: 10 }} />
                        </button>
                        {tab === "curated" && (
                          <button onClick={() => handleDelete(entry.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2, display: "flex" }}>
                            <Trash2 style={{ width: 10, height: 10 }} />
                          </button>
                        )}
                      </div>
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--text)", whiteSpace: "pre-wrap", lineHeight: 1.5,
                      maxHeight: isLong && !isExpanded ? 80 : undefined, overflow: isLong && !isExpanded ? "hidden" : undefined }}>{entry.content}</p>
                    {isLong && (
                      <button onClick={() => toggleEntry(entry.id)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", fontSize: 10, padding: "4px 0 0", display: "flex", alignItems: "center", gap: 4 }}>
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
              style={{ flex: 1, padding: "7px 10px", borderRadius: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, outline: "none" }} />
            <button onClick={handleAddMemory} disabled={adding || !newMemory.trim()}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 12px", borderRadius: 8, background: "var(--accent)", border: "none", color: "white", fontSize: 11, cursor: "pointer", opacity: adding || !newMemory.trim() ? 0.5 : 1 }}>
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

  const cardStyle: React.CSSProperties = { background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" };
  const labelStyle: React.CSSProperties = { fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase" as const, letterSpacing: "0.05em", fontWeight: 600, marginBottom: 6 };
  const metricStyle: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" };

  if (configLoading) return <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Loader2 style={{ width: 24, height: 24, color: "var(--accent)", animation: "spin 1s linear infinite" }} /></div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        <div style={cardStyle}><div style={labelStyle}>Table</div><div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}><HardDrive style={{ width: 14, height: 14, color: "var(--accent)" }} />memories</div><div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>{lanceInfo?.exists ? formatBytes(lanceInfo.sizeBytes) : "not found"}</div></div>
        <div style={cardStyle}><div style={labelStyle}>Chunks</div><div style={metricStyle}>{status?.chunks ?? "—"}</div><div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>from {status?.files ?? 0} files</div></div>
        <div style={cardStyle}><div style={labelStyle}>Vector Index</div><div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: status?.vectorReady ? "#4ade80" : "#f87171" }} /><span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{status?.vectorReady ? "Ready" : "Offline"}</span></div><div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>{status?.dirty ? "needs reindex" : "up to date"}</div></div>
        <div style={cardStyle}><div style={labelStyle}>FTS Index</div><div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: status?.ftsReady ? "#4ade80" : "#f87171" }} /><span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{status?.ftsReady ? "Ready" : "Offline"}</span></div><div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>full-text search</div></div>
      </div>

      {config && (
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Cpu style={{ width: 14, height: 14, color: "var(--accent)" }} /><span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Embedding Configuration</span></div>
            <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 6, background: config.enabled ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)", color: config.enabled ? "#4ade80" : "#f87171", fontWeight: 500 }}>{config.enabled ? "Active" : "Disabled"}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <div><div style={labelStyle}>Model</div><div style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>{config.embeddingModel}</div><div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>1536 dimensions</div></div>
            <div><div style={labelStyle}>Plugin</div><div style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>{config.plugin}</div><div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>LanceDB backend</div></div>
            <div><div style={labelStyle}>Sources</div><div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{config.sources.map(s => <span key={s} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(59,130,246,0.1)", color: "var(--accent)" }}>{s}</span>)}</div></div>
            <div><div style={labelStyle}>Auto Capture</div><div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: config.autoCapture ? "#4ade80" : "#f87171" }} /><span style={{ fontSize: 11, color: "var(--text)" }}>{config.autoCapture ? "On" : "Off"}</span></div></div>
            <div><div style={labelStyle}>Auto Recall</div><div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: config.autoRecall ? "#4ade80" : "#f87171" }} /><span style={{ fontSize: 11, color: "var(--text)" }}>{config.autoRecall ? "On" : "Off"}</span></div></div>
            <div><div style={labelStyle}>Provider</div><div style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>{status?.provider ?? "openai"}</div></div>
          </div>
        </div>
      )}

      {config?.hybridEnabled && (
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}><Activity style={{ width: 14, height: 14, color: "var(--accent)" }} /><span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Hybrid Search Pipeline</span></div>
          <div style={{ marginBottom: 16 }}>
            <div style={labelStyle}>Search Weights</div>
            <div style={{ display: "flex", height: 24, borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)" }}>
              <div style={{ width: `${config.vectorWeight * 100}%`, background: "rgba(59,130,246,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 600, color: "var(--accent)" }}>Vector {(config.vectorWeight * 100).toFixed(0)}%</div>
              <div style={{ width: `${config.textWeight * 100}%`, background: "rgba(168,85,247,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 600, color: "#a855f7" }}>Text {(config.textWeight * 100).toFixed(0)}%</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <div><div style={labelStyle}>MMR (Diversity)</div><div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: config.mmrEnabled ? "#4ade80" : "#f87171" }} /><span style={{ fontSize: 11, color: "var(--text)" }}>{config.mmrEnabled ? `λ = ${config.mmrLambda}` : "Off"}</span></div></div>
            <div><div style={labelStyle}>Temporal Decay</div><div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: config.temporalDecayEnabled ? "#4ade80" : "#f87171" }} /><span style={{ fontSize: 11, color: "var(--text)" }}>{config.temporalDecayEnabled ? `${config.halfLifeDays}d half-life` : "Off"}</span></div></div>
            <div><div style={labelStyle}>Search Mode</div><span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(74,222,128,0.1)", color: "#4ade80" }}>{status?.searchMode ?? "hybrid"}</span></div>
          </div>
        </div>
      )}

      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}><Zap style={{ width: 14, height: 14, color: "var(--accent)" }} /><span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Similarity Explorer</span></div>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "var(--text-muted)" }} />
            <input value={simQuery} onChange={e => setSimQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSimilaritySearch()}
              placeholder="Enter text to find nearest neighbors in embedding space..."
              style={{ width: "100%", padding: "8px 10px 8px 32px", borderRadius: 8, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, outline: "none", boxSizing: "border-box" }} />
          </div>
          <button onClick={handleSimilaritySearch} disabled={simLoading || !simQuery.trim()}
            style={{ padding: "0 14px", borderRadius: 8, background: "var(--accent)", border: "none", color: "white", fontSize: 11, cursor: "pointer", opacity: simLoading || !simQuery.trim() ? 0.5 : 1, display: "flex", alignItems: "center", gap: 4 }}>
            {simLoading ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <ArrowRight style={{ width: 12, height: 12 }} />} Search
          </button>
        </div>
        {simLoading && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 16, justifyContent: "center" }}><Loader2 style={{ width: 16, height: 16, color: "var(--accent)", animation: "spin 1s linear infinite" }} /><span style={{ fontSize: 11, color: "var(--text-muted)" }}>Computing embeddings & searching vector space...</span></div>}
        {simResults && !simLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{simResults.length} nearest neighbor{simResults.length !== 1 ? "s" : ""} found</span>
            </div>
            {simResults.length === 0 ? (
              <div style={{ textAlign: "center", padding: 20, color: "var(--text-muted)", fontSize: 12 }}>No similar embeddings found.</div>
            ) : simResults.map((r, i) => {
              const isExpanded = expandedChunks.has(i);
              const isLong = r.snippet.length > 200;
              const barWidth = Math.max(5, r.score * 100);
              const scoreColor = r.score > 0.3 ? "#4ade80" : r.score > 0.15 ? "#fbbf24" : "#f87171";
              return (
                <div key={i} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: scoreColor, fontVariantNumeric: "tabular-nums", minWidth: 40 }}>{r.score.toFixed(3)}</span>
                      <div style={{ height: 4, borderRadius: 2, background: "var(--border)", width: 80 }}><div style={{ height: "100%", borderRadius: 2, background: scoreColor, width: `${barWidth}%` }} /></div>
                      <span style={{ fontSize: 9, color: "var(--text-muted)" }}>#{i + 1}</span>
                    </div>
                    <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "rgba(59,130,246,0.1)", color: "var(--accent)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.path}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--text)", whiteSpace: "pre-wrap", lineHeight: 1.5, fontFamily: "monospace",
                    maxHeight: isLong && !isExpanded ? 60 : undefined, overflow: isLong && !isExpanded ? "hidden" : undefined }}>{r.snippet}</p>
                  {isLong && <button onClick={() => toggleChunk(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", fontSize: 10, padding: "4px 0 0", display: "flex", alignItems: "center", gap: 4 }}>
                    {isExpanded ? <><ChevronUp style={{ width: 10, height: 10 }} /> Show less</> : <><ChevronDown style={{ width: 10, height: 10 }} /> Show more</>}
                  </button>}
                </div>
              );
            })}
          </div>
        )}
        {!simResults && !simLoading && (
          <div style={{ padding: "20px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: 11 }}>
            <BarChart3 style={{ width: 24, height: 24, margin: "0 auto 8px", opacity: 0.4 }} />
            <p style={{ margin: 0 }}>Enter a query to explore the embedding space. Results ranked by cosine similarity with hybrid reranking.</p>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={onReindex} disabled={reindexing}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 11, cursor: "pointer", opacity: reindexing ? 0.5 : 1 }}>
          {reindexing ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Database style={{ width: 12, height: 12 }} />} Rebuild Index
        </button>
        <button onClick={() => { loadConfig(); loadLanceInfo(); }}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 11, cursor: "pointer" }}>
          <RefreshCw style={{ width: 12, height: 12 }} /> Refresh Config
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 9, color: "var(--text-muted)", alignSelf: "center" }}>
          <Layers style={{ width: 10, height: 10, display: "inline", verticalAlign: "middle", marginRight: 4 }} />
          {lanceInfo?.tablePath || "~/.openclaw/memory/lancedb/memories.lance"}
        </span>
      </div>
    </div>
  );
}
