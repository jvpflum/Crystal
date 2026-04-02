import { useState, useEffect, useCallback } from "react";
import {
  Brain, Search, Plus, RefreshCw, Loader2, FileText, Calendar,
  Edit3, Trash2, Database, Copy, CheckCircle2, XCircle, ChevronDown, ChevronUp,
  HardDrive, Cpu, Activity, Layers, Zap, BarChart3, ArrowRight,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { openclawClient, MemoryEntry } from "@/lib/openclaw";

interface MemoryStatus {
  files: number;
  chunks: number;
  dirty: boolean;
  provider: string;
  searchMode: string;
  vectorReady: boolean;
  ftsReady: boolean;
}

function parseStatus(raw: Record<string, unknown> | null): MemoryStatus | null {
  if (!raw) return null;
  const s = raw.status as Record<string, unknown> | undefined;
  if (!s) return null;
  const custom = s.custom as Record<string, unknown> | undefined;
  const vector = s.vector as Record<string, unknown> | undefined;
  const fts = s.fts as Record<string, unknown> | undefined;
  return {
    files: Number(s.files ?? 0),
    chunks: Number(s.chunks ?? 0),
    dirty: Boolean(s.dirty),
    provider: String(s.provider ?? "none"),
    searchMode: String(custom?.searchMode ?? "unknown"),
    vectorReady: Boolean(vector?.available),
    ftsReady: Boolean(fts?.available),
  };
}

export function MemoryView() {
  const [curatedMemory, setCuratedMemory] = useState<MemoryEntry[]>([]);
  const [dailyMemory, setDailyMemory] = useState<MemoryEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MemoryEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [tab, setTab] = useState<"curated" | "daily" | "search" | "edit" | "vectordb">("curated");
  const [newMemory, setNewMemory] = useState("");
  const [adding, setAdding] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());

  useEffect(() => { loadMemory(); loadStatus(); }, []);

  const loadMemory = async () => {
    setLoading(true);
    const [curated, daily] = await Promise.all([
      openclawClient.getMemory(),
      openclawClient.getDailyMemory(),
    ]);
    setCuratedMemory(curated);
    setDailyMemory(daily);
    setLoading(false);
  };

  const loadStatus = async () => {
    const raw = await openclawClient.getMemoryStatus();
    setStatus(parseStatus(raw));
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setTab("search");
    const results = await openclawClient.searchMemory(searchQuery);
    setSearchResults(results);
    setSearching(false);
  };

  const handleAddMemory = async () => {
    if (!newMemory.trim()) return;
    setAdding(true);
    await openclawClient.addMemory(newMemory);
    setNewMemory("");
    await loadMemory();
    await loadStatus();
    showFeedback("success", "Memory saved & indexed");
    setAdding(false);
  };

  const handleDelete = async (entryId: string) => {
    await openclawClient.deleteMemory(entryId);
    await loadMemory();
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
    setFeedback({ type, text });
    setTimeout(() => setFeedback(null), 3000);
  };

  const loadEditContent = async () => {
    setEditLoading(true);
    try {
      const home = await invoke<{ stdout: string }>("execute_command", {
        command: "echo $env:USERPROFILE\\.openclaw", cwd: null,
      });
      const wsDir = home.stdout.trim().replace(/\r?\n/g, "") + "\\workspace";
      const content = await invoke<string>("read_file", { path: `${wsDir}\\MEMORY.md` });
      setEditContent(content);
    } catch {
      setEditContent("");
    } finally {
      setEditLoading(false);
    }
  };

  useEffect(() => {
    if (tab === "edit") loadEditContent();
  }, [tab]);

  const handleSaveEdit = async () => {
    setEditSaving(true);
    try {
      const home = await invoke<{ stdout: string }>("execute_command", {
        command: "echo $env:USERPROFILE\\.openclaw", cwd: null,
      });
      const wsDir = home.stdout.trim().replace(/\r?\n/g, "") + "\\workspace";
      await invoke("write_file", { path: `${wsDir}\\MEMORY.md`, content: editContent });
      await openclawClient.reindexMemory();
      await loadMemory();
      await loadStatus();
      showFeedback("success", "Saved & reindexed");
    } catch {
      showFeedback("error", "Failed to save");
    } finally {
      setEditSaving(false);
    }
  };

  const toggleEntry = (id: string) => {
    setExpandedEntries(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const copyEntry = (content: string) => {
    navigator.clipboard.writeText(content);
    showFeedback("success", "Copied to clipboard");
  };

  const displayEntries = tab === "search" ? (searchResults || []) : tab === "daily" ? dailyMemory : curatedMemory;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Memory</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {feedback && (
              <span style={{
                fontSize: 10, padding: "2px 8px", borderRadius: 6,
                display: "flex", alignItems: "center", gap: 4,
                background: feedback.type === "success" ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)",
                color: feedback.type === "success" ? "#4ade80" : "#f87171",
              }}>
                {feedback.type === "success" ? <CheckCircle2 style={{ width: 10, height: 10 }} /> : <XCircle style={{ width: 10, height: 10 }} />}
                {feedback.text}
              </span>
            )}
            <button onClick={handleReindex} disabled={reindexing}
              style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-muted)", fontSize: 10, background: "none", border: "none", cursor: "pointer", padding: "4px 8px", borderRadius: 6 }}>
              {reindexing ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Database style={{ width: 12, height: 12 }} />}
              Reindex
            </button>
            <button onClick={() => { loadMemory(); loadStatus(); }} disabled={loading}
              style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-muted)", fontSize: 10, background: "none", border: "none", cursor: "pointer", padding: "4px 8px", borderRadius: 6 }}>
              <RefreshCw style={{ width: 12, height: 12, ...(loading ? { animation: "spin 1s linear infinite" } : {}) }} /> Refresh
            </button>
          </div>
        </div>

        {/* Status bar */}
        {status && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <span style={{
              fontSize: 9, padding: "2px 8px", borderRadius: 6,
              background: status.vectorReady ? "rgba(74,222,128,0.1)" : "rgba(251,191,36,0.1)",
              color: status.vectorReady ? "#4ade80" : "#fbbf24",
              fontWeight: 500,
            }}>
              {status.searchMode === "hybrid" ? "Hybrid Search" : status.searchMode === "fts-only" ? "Text Search Only" : "Search"}
            </span>
            <span style={{ fontSize: 9, color: "var(--text-muted)" }}>
              {status.files} file{status.files !== 1 ? "s" : ""} · {status.chunks} chunk{status.chunks !== 1 ? "s" : ""}
            </span>
            {status.provider !== "none" && (
              <span style={{ fontSize: 9, color: "var(--text-muted)" }}>
                via {status.provider}
              </span>
            )}
            {status.dirty && (
              <span style={{ fontSize: 9, color: "#fbbf24" }}>needs reindex</span>
            )}
          </div>
        )}
      </div>

      {/* Search */}
      <div style={{ padding: "0 20px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "var(--text-muted)" }} />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              placeholder="Semantic search across memory..."
              style={{ width: "100%", padding: "7px 10px 7px 32px", borderRadius: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, outline: "none", boxSizing: "border-box" }}
            />
          </div>
          <button onClick={handleSearch} disabled={searching || !searchQuery.trim()}
            style={{ padding: "0 12px", borderRadius: 8, background: "var(--accent)", border: "none", color: "white", fontSize: 11, cursor: "pointer", opacity: searching || !searchQuery.trim() ? 0.5 : 1 }}>
            {searching ? <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} /> : "Search"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ padding: "0 20px 8px", display: "flex", gap: 4, flexShrink: 0, flexWrap: "wrap" }}>
        {(["curated", "daily", "search", "edit", "vectordb"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              padding: "4px 12px", borderRadius: 6, border: "none", fontSize: 11, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 4,
              background: tab === t ? "rgba(59,130,246,0.18)" : "var(--bg-elevated)",
              color: tab === t ? "var(--accent)" : "var(--text-muted)",
            }}>
            {t === "curated" && <><FileText style={{ width: 10, height: 10 }} />MEMORY.md</>}
            {t === "daily" && <><Calendar style={{ width: 10, height: 10 }} />Daily</>}
            {t === "search" && <><Search style={{ width: 10, height: 10 }} />Results {searchResults ? `(${searchResults.length})` : ""}</>}
            {t === "edit" && <><Edit3 style={{ width: 10, height: 10 }} />Edit</>}
            {t === "vectordb" && <><HardDrive style={{ width: 10, height: 10 }} />Vector DB</>}
          </button>
        ))}
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 12px", display: "flex", flexDirection: "column", minHeight: 0 }}>
        {tab === "vectordb" ? (
          <VectorDBTab status={status} onReindex={handleReindex} reindexing={reindexing} />
        ) : tab === "edit" ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
            {editLoading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
                <Loader2 style={{ width: 24, height: 24, color: "var(--accent)", animation: "spin 1s linear infinite" }} />
              </div>
            ) : (
              <>
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  style={{
                    flex: 1, minHeight: 200, fontFamily: "monospace", fontSize: 12, padding: 12,
                    background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8,
                    color: "var(--text)", resize: "none", width: "100%", outline: "none", boxSizing: "border-box",
                  }}
                  spellCheck={false}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button onClick={handleSaveEdit} disabled={editSaving}
                    style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 14px", borderRadius: 8, background: "var(--accent)", border: "none", color: "white", fontSize: 11, cursor: "pointer", opacity: editSaving ? 0.5 : 1 }}>
                    {editSaving && <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />}
                    Save & Reindex
                  </button>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    Saves to ~/.openclaw/workspace/MEMORY.md
                  </span>
                </div>
              </>
            )}
          </div>
        ) : loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <Loader2 style={{ width: 24, height: 24, color: "var(--accent)", animation: "spin 1s linear infinite" }} />
          </div>
        ) : displayEntries.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 8 }}>
            <Brain style={{ width: 32, height: 32, color: "var(--text-muted)" }} />
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {tab === "search" ? "No search results" : tab === "daily" ? "No daily entries for today" : "No memory entries yet"}
            </p>
            <p style={{ fontSize: 10, color: "var(--text-muted)", textAlign: "center", maxWidth: 280 }}>
              {tab === "curated"
                ? "Add important facts, preferences, and context below. Crystal will remember them across sessions."
                : tab === "daily"
                ? "Daily logs capture key events from each day. A scheduled job will do this automatically."
                : "Try searching for a topic like \"user preferences\" or \"project details\"."}
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {displayEntries.map(entry => {
              const isExpanded = expandedEntries.has(entry.id);
              const isLong = entry.content.length > 200;
              return (
                <div key={entry.id} style={{
                  background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500 }}>{entry.source}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{
                        fontSize: 9, padding: "2px 6px", borderRadius: 4,
                        background: entry.type === "curated" ? "rgba(59,130,246,0.15)" : "rgba(74,222,128,0.15)",
                        color: entry.type === "curated" ? "var(--accent)" : "#4ade80",
                      }}>
                        {entry.type}
                      </span>
                      <button onClick={() => copyEntry(entry.content)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2, display: "flex" }}>
                        <Copy style={{ width: 10, height: 10 }} />
                      </button>
                      {tab === "curated" && (
                        <button onClick={() => handleDelete(entry.id)}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2, display: "flex" }}>
                          <Trash2 style={{ width: 10, height: 10 }} />
                        </button>
                      )}
                    </div>
                  </div>
                  <p style={{
                    margin: 0, fontSize: 12, color: "var(--text)", whiteSpace: "pre-wrap", lineHeight: 1.5,
                    maxHeight: isLong && !isExpanded ? 80 : undefined, overflow: isLong && !isExpanded ? "hidden" : undefined,
                  }}>
                    {entry.content}
                  </p>
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
        )}
      </div>

      {/* Add memory input (curated tab) */}
      {tab === "curated" && (
        <div style={{ padding: "8px 20px 12px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={newMemory}
              onChange={e => setNewMemory(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAddMemory()}
              placeholder="Add a fact, preference, or note to long-term memory..."
              style={{ flex: 1, padding: "7px 10px", borderRadius: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, outline: "none" }}
            />
            <button onClick={handleAddMemory} disabled={adding || !newMemory.trim()}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 12px", borderRadius: 8, background: "var(--accent)", border: "none", color: "white", fontSize: 11, cursor: "pointer", opacity: adding || !newMemory.trim() ? 0.5 : 1 }}>
              {adding ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Plus style={{ width: 12, height: 12 }} />}
              Add
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
  plugin: string;
  enabled: boolean;
  autoCapture: boolean;
  autoRecall: boolean;
  embeddingModel: string;
  hybridEnabled: boolean;
  vectorWeight: number;
  textWeight: number;
  mmrEnabled: boolean;
  mmrLambda: number;
  temporalDecayEnabled: boolean;
  halfLifeDays: number;
  sources: string[];
}

interface SimilarityResult {
  path: string;
  snippet: string;
  score: number;
  startLine?: number;
  endLine?: number;
}

function VectorDBTab({ status, onReindex, reindexing }: {
  status: MemoryStatus | null;
  onReindex: () => void;
  reindexing: boolean;
}) {
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
        invoke<{ stdout: string; code: number }>("execute_command", {
          command: "openclaw config get memory --json", cwd: null,
        }),
        invoke<{ stdout: string; code: number }>("execute_command", {
          command: "openclaw config get plugins --json", cwd: null,
        }),
      ]);

      let embModel = "text-embedding-3-small";
      let autoCapture = true;
      let autoRecall = true;
      let pluginEnabled = true;
      let pluginSlot = "memory-lancedb";

      if (ocCfg.code === 0 && ocCfg.stdout.trim()) {
        try {
          const p = JSON.parse(ocCfg.stdout);
          pluginSlot = p?.slots?.memory ?? pluginSlot;
          const entry = p?.entries?.["memory-lancedb"];
          if (entry) {
            pluginEnabled = entry.enabled !== false;
            autoCapture = entry.config?.autoCapture !== false;
            autoRecall = entry.config?.autoRecall !== false;
            embModel = entry.config?.embedding?.model ?? embModel;
          }
        } catch { /* parse fail */ }
      }

      let hybridEnabled = true;
      let vectorWeight = 0.7;
      let textWeight = 0.3;
      let mmrEnabled = true;
      let mmrLambda = 0.7;
      let temporalDecayEnabled = true;
      let halfLifeDays = 30;
      let sources = ["memory", "sessions"];

      if (memCfg.code === 0 && memCfg.stdout.trim()) {
        try {
          const m = JSON.parse(memCfg.stdout);
          const ms = m?.memorySearch ?? m;
          sources = ms?.sources ?? sources;
          const h = ms?.query?.hybrid ?? {};
          hybridEnabled = h?.enabled !== false;
          vectorWeight = h?.vectorWeight ?? vectorWeight;
          textWeight = h?.textWeight ?? textWeight;
          mmrEnabled = h?.mmr?.enabled !== false;
          mmrLambda = h?.mmr?.lambda ?? mmrLambda;
          temporalDecayEnabled = h?.temporalDecay?.enabled !== false;
          halfLifeDays = h?.temporalDecay?.halfLifeDays ?? halfLifeDays;
        } catch { /* parse fail */ }
      }

      setConfig({
        plugin: pluginSlot,
        enabled: pluginEnabled,
        autoCapture,
        autoRecall,
        embeddingModel: embModel,
        hybridEnabled,
        vectorWeight,
        textWeight,
        mmrEnabled,
        mmrLambda,
        temporalDecayEnabled,
        halfLifeDays,
        sources,
      });
    } catch { /* ignore */ }
    setConfigLoading(false);
  }, []);

  const loadLanceInfo = useCallback(async () => {
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: "powershell -Command \"$p = Join-Path $env:USERPROFILE '.openclaw\\memory\\lancedb\\memories.lance'; if(Test-Path $p){ $s = (Get-ChildItem $p -Recurse | Measure-Object -Property Length -Sum).Sum; Write-Output ('{0}|{1}' -f $s, $p) } else { Write-Output 'MISSING' }\"",
        cwd: null,
      });
      if (result.code === 0 && result.stdout.trim() !== "MISSING") {
        const parts = result.stdout.trim().split("|");
        setLanceInfo({
          sizeBytes: Number(parts[0]) || 0,
          tablePath: parts[1] || "",
          exists: true,
        });
      } else {
        setLanceInfo({ tablePath: "", exists: false, sizeBytes: 0 });
      }
    } catch {
      setLanceInfo({ tablePath: "", exists: false, sizeBytes: 0 });
    }
  }, []);

  useEffect(() => {
    loadConfig();
    loadLanceInfo();
  }, [loadConfig, loadLanceInfo]);

  const handleSimilaritySearch = async () => {
    if (!simQuery.trim()) return;
    setSimLoading(true);
    setSimResults(null);
    try {
      const results = await openclawClient.searchMemory(simQuery);
      setSimResults(results.map(r => ({
        path: r.source,
        snippet: r.content,
        score: parseFloat(r.date?.replace("score: ", "") ?? "0"),
        startLine: undefined,
        endLine: undefined,
      })));
    } catch {
      setSimResults([]);
    }
    setSimLoading(false);
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const toggleChunk = (idx: number) => {
    setExpandedChunks(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const cardStyle: React.CSSProperties = {
    background: "var(--bg-elevated)", border: "1px solid var(--border)",
    borderRadius: 10, padding: "14px 16px",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase" as const,
    letterSpacing: "0.05em", fontWeight: 600, marginBottom: 6,
  };

  const metricStyle: React.CSSProperties = {
    fontSize: 20, fontWeight: 700, color: "var(--text)",
    fontVariantNumeric: "tabular-nums",
  };

  if (configLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
        <Loader2 style={{ width: 24, height: 24, color: "var(--accent)", animation: "spin 1s linear infinite" }} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Status Overview ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        <div style={cardStyle}>
          <div style={labelStyle}>Table</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
            <HardDrive style={{ width: 14, height: 14, color: "var(--accent)" }} />
            memories
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
            {lanceInfo?.exists ? formatBytes(lanceInfo.sizeBytes) : "not found"}
          </div>
        </div>

        <div style={cardStyle}>
          <div style={labelStyle}>Chunks</div>
          <div style={metricStyle}>{status?.chunks ?? "—"}</div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
            from {status?.files ?? 0} files
          </div>
        </div>

        <div style={cardStyle}>
          <div style={labelStyle}>Vector Index</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: status?.vectorReady ? "#4ade80" : "#f87171",
            }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
              {status?.vectorReady ? "Ready" : "Offline"}
            </span>
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
            {status?.dirty ? "⚠ needs reindex" : "up to date"}
          </div>
        </div>

        <div style={cardStyle}>
          <div style={labelStyle}>FTS Index</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: status?.ftsReady ? "#4ade80" : "#f87171",
            }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
              {status?.ftsReady ? "Ready" : "Offline"}
            </span>
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
            full-text search
          </div>
        </div>
      </div>

      {/* ── Embedding Configuration ── */}
      {config && (
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Cpu style={{ width: 14, height: 14, color: "var(--accent)" }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Embedding Configuration</span>
            </div>
            <span style={{
              fontSize: 9, padding: "2px 8px", borderRadius: 6,
              background: config.enabled ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)",
              color: config.enabled ? "#4ade80" : "#f87171",
              fontWeight: 500,
            }}>
              {config.enabled ? "Active" : "Disabled"}
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {/* Model Info */}
            <div>
              <div style={labelStyle}>Model</div>
              <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>{config.embeddingModel}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>1536 dimensions</div>
            </div>

            {/* Plugin */}
            <div>
              <div style={labelStyle}>Plugin</div>
              <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>{config.plugin}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>LanceDB backend</div>
            </div>

            {/* Sources */}
            <div>
              <div style={labelStyle}>Sources</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {config.sources.map(s => (
                  <span key={s} style={{
                    fontSize: 10, padding: "2px 8px", borderRadius: 4,
                    background: "rgba(59,130,246,0.1)", color: "var(--accent)",
                  }}>
                    {s}
                  </span>
                ))}
              </div>
            </div>

            {/* Auto Capture/Recall */}
            <div>
              <div style={labelStyle}>Auto Capture</div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: config.autoCapture ? "#4ade80" : "#f87171",
                }} />
                <span style={{ fontSize: 11, color: "var(--text)" }}>{config.autoCapture ? "On" : "Off"}</span>
              </div>
            </div>

            <div>
              <div style={labelStyle}>Auto Recall</div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: config.autoRecall ? "#4ade80" : "#f87171",
                }} />
                <span style={{ fontSize: 11, color: "var(--text)" }}>{config.autoRecall ? "On" : "Off"}</span>
              </div>
            </div>

            {/* Provider */}
            <div>
              <div style={labelStyle}>Provider</div>
              <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>
                {status?.provider ?? "openai"}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Hybrid Search Config ── */}
      {config?.hybridEnabled && (
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Activity style={{ width: 14, height: 14, color: "var(--accent)" }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Hybrid Search Pipeline</span>
          </div>

          {/* Weight bar */}
          <div style={{ marginBottom: 16 }}>
            <div style={labelStyle}>Search Weights</div>
            <div style={{ display: "flex", height: 24, borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)" }}>
              <div style={{
                width: `${config.vectorWeight * 100}%`, background: "rgba(59,130,246,0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontWeight: 600, color: "var(--accent)",
              }}>
                Vector {(config.vectorWeight * 100).toFixed(0)}%
              </div>
              <div style={{
                width: `${config.textWeight * 100}%`, background: "rgba(168,85,247,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontWeight: 600, color: "#a855f7",
              }}>
                Text {(config.textWeight * 100).toFixed(0)}%
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <div>
              <div style={labelStyle}>MMR (Diversity)</div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: config.mmrEnabled ? "#4ade80" : "#f87171",
                }} />
                <span style={{ fontSize: 11, color: "var(--text)" }}>
                  {config.mmrEnabled ? `λ = ${config.mmrLambda}` : "Off"}
                </span>
              </div>
            </div>

            <div>
              <div style={labelStyle}>Temporal Decay</div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: config.temporalDecayEnabled ? "#4ade80" : "#f87171",
                }} />
                <span style={{ fontSize: 11, color: "var(--text)" }}>
                  {config.temporalDecayEnabled ? `${config.halfLifeDays}d half-life` : "Off"}
                </span>
              </div>
            </div>

            <div>
              <div style={labelStyle}>Search Mode</div>
              <span style={{
                fontSize: 10, padding: "2px 8px", borderRadius: 4,
                background: "rgba(74,222,128,0.1)", color: "#4ade80",
              }}>
                {status?.searchMode ?? "hybrid"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Similarity Explorer ── */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Zap style={{ width: 14, height: 14, color: "var(--accent)" }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Similarity Explorer</span>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "var(--text-muted)" }} />
            <input
              value={simQuery}
              onChange={e => setSimQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSimilaritySearch()}
              placeholder="Enter text to find nearest neighbors in embedding space..."
              style={{
                width: "100%", padding: "8px 10px 8px 32px", borderRadius: 8,
                background: "var(--bg)", border: "1px solid var(--border)",
                color: "var(--text)", fontSize: 12, outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
          <button onClick={handleSimilaritySearch} disabled={simLoading || !simQuery.trim()}
            style={{
              padding: "0 14px", borderRadius: 8, background: "var(--accent)",
              border: "none", color: "white", fontSize: 11, cursor: "pointer",
              opacity: simLoading || !simQuery.trim() ? 0.5 : 1,
              display: "flex", alignItems: "center", gap: 4,
            }}>
            {simLoading ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <ArrowRight style={{ width: 12, height: 12 }} />}
            Search
          </button>
        </div>

        {simLoading && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 16, justifyContent: "center" }}>
            <Loader2 style={{ width: 16, height: 16, color: "var(--accent)", animation: "spin 1s linear infinite" }} />
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Computing embeddings & searching vector space...</span>
          </div>
        )}

        {simResults && !simLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                {simResults.length} nearest neighbor{simResults.length !== 1 ? "s" : ""} found
              </span>
              {simResults.length > 0 && (
                <span style={{ fontSize: 9, color: "var(--text-muted)" }}>
                  scores: {simResults[simResults.length - 1]?.score.toFixed(3)} → {simResults[0]?.score.toFixed(3)}
                </span>
              )}
            </div>

            {simResults.length === 0 ? (
              <div style={{ textAlign: "center", padding: 20, color: "var(--text-muted)", fontSize: 12 }}>
                No similar embeddings found. Try a different query.
              </div>
            ) : simResults.map((r, i) => {
              const isExpanded = expandedChunks.has(i);
              const isLong = r.snippet.length > 200;
              const barWidth = Math.max(5, r.score * 100);
              const scoreColor = r.score > 0.3 ? "#4ade80" : r.score > 0.15 ? "#fbbf24" : "#f87171";

              return (
                <div key={i} style={{
                  background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8,
                  padding: "10px 12px", position: "relative",
                }}>
                  {/* Score bar + metadata row */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: scoreColor,
                        fontVariantNumeric: "tabular-nums", minWidth: 40,
                      }}>
                        {r.score.toFixed(3)}
                      </span>
                      <div style={{
                        height: 4, borderRadius: 2, background: "var(--border)", width: 80,
                      }}>
                        <div style={{
                          height: "100%", borderRadius: 2, background: scoreColor,
                          width: `${barWidth}%`, transition: "width 0.3s",
                        }} />
                      </div>
                      <span style={{ fontSize: 9, color: "var(--text-muted)" }}>
                        #{i + 1}
                      </span>
                    </div>
                    <span style={{
                      fontSize: 9, padding: "2px 6px", borderRadius: 4,
                      background: "rgba(59,130,246,0.1)", color: "var(--accent)",
                      maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {r.path}
                    </span>
                  </div>

                  {/* Snippet */}
                  <p style={{
                    margin: 0, fontSize: 11, color: "var(--text)", whiteSpace: "pre-wrap",
                    lineHeight: 1.5, fontFamily: "monospace",
                    maxHeight: isLong && !isExpanded ? 60 : undefined,
                    overflow: isLong && !isExpanded ? "hidden" : undefined,
                  }}>
                    {r.snippet}
                  </p>
                  {isLong && (
                    <button onClick={() => toggleChunk(i)}
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        color: "var(--accent)", fontSize: 10, padding: "4px 0 0",
                        display: "flex", alignItems: "center", gap: 4,
                      }}>
                      {isExpanded
                        ? <><ChevronUp style={{ width: 10, height: 10 }} /> Show less</>
                        : <><ChevronDown style={{ width: 10, height: 10 }} /> Show more</>}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!simResults && !simLoading && (
          <div style={{
            padding: "20px 16px", textAlign: "center",
            color: "var(--text-muted)", fontSize: 11,
          }}>
            <BarChart3 style={{ width: 24, height: 24, margin: "0 auto 8px", opacity: 0.4 }} />
            <p style={{ margin: 0 }}>
              Enter a query above to explore the embedding space. Results are ranked by cosine similarity
              with hybrid reranking (vector {config ? `${(config.vectorWeight * 100).toFixed(0)}%` : ""} + text {config ? `${(config.textWeight * 100).toFixed(0)}%` : ""}).
            </p>
          </div>
        )}
      </div>

      {/* ── Actions ── */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={onReindex} disabled={reindexing}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 16px", borderRadius: 8,
            background: "var(--bg-elevated)", border: "1px solid var(--border)",
            color: "var(--text)", fontSize: 11, cursor: "pointer",
            opacity: reindexing ? 0.5 : 1,
          }}>
          {reindexing
            ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />
            : <Database style={{ width: 12, height: 12 }} />}
          Rebuild Index
        </button>

        <button onClick={() => { loadConfig(); loadLanceInfo(); }}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 16px", borderRadius: 8,
            background: "var(--bg-elevated)", border: "1px solid var(--border)",
            color: "var(--text)", fontSize: 11, cursor: "pointer",
          }}>
          <RefreshCw style={{ width: 12, height: 12 }} />
          Refresh Config
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
