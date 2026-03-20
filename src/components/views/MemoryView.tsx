import { useState, useEffect } from "react";
import {
  Brain, Search, Plus, RefreshCw, Loader2, FileText, Calendar,
  Edit3, Trash2, Database, Copy, CheckCircle2, XCircle, ChevronDown, ChevronUp,
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
  const [tab, setTab] = useState<"curated" | "daily" | "search" | "edit">("curated");
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
      <div style={{ padding: "0 20px 8px", display: "flex", gap: 4, flexShrink: 0 }}>
        {(["curated", "daily", "search", "edit"] as const).map(t => (
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
          </button>
        ))}
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 12px", display: "flex", flexDirection: "column", minHeight: 0 }}>
        {tab === "edit" ? (
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
