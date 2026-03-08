import { useState, useEffect } from "react";
import { Brain, Search, Plus, RefreshCw, Loader2, FileText, Calendar, Edit3 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { openclawClient, MemoryEntry } from "@/lib/openclaw";

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
  const [reindexFeedback, setReindexFeedback] = useState<"success" | "error" | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editSaveConfirm, setEditSaveConfirm] = useState(false);

  useEffect(() => { loadMemory(); }, []);

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
    setAdding(false);
  };

  const handleReindex = async () => {
    setReindexing(true);
    setReindexFeedback(null);
    try {
      await invoke("execute_command", { command: "npx openclaw memory index --all", cwd: null });
      setReindexFeedback("success");
      await loadMemory();
    } catch {
      setReindexFeedback("error");
    } finally {
      setReindexing(false);
    }
  };

  const loadEditContent = async () => {
    setEditLoading(true);
    try {
      const result = await invoke<{ stdout: string }>("execute_command", { command: "npx openclaw memory show", cwd: null });
      setEditContent(result.stdout ?? "");
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
      await invoke("write_file", { path: "~/.openclaw/MEMORY.md", content: editContent });
      setEditSaveConfirm(true);
      setTimeout(() => setEditSaveConfirm(false), 2000);
    } catch {
      setEditSaveConfirm(false);
    } finally {
      setEditSaving(false);
    }
  };

  const displayEntries = tab === "search" ? (searchResults || []) : tab === "daily" ? dailyMemory : curatedMemory;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Memory</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={handleReindex}
              disabled={reindexing}
              style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-muted)", fontSize: 10, background: "none", border: "none", cursor: "pointer" }}
            >
              {reindexing ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : null}
              Reindex
            </button>
            <button
              onClick={loadMemory}
              disabled={loading}
              style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-muted)", fontSize: 10, background: "none", border: "none", cursor: "pointer" }}
            >
              <RefreshCw style={{ width: 12, height: 12 }} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
            {reindexFeedback === "success" && <span style={{ fontSize: 10, color: "var(--accent)" }}>Reindexed</span>}
            {reindexFeedback === "error" && <span style={{ fontSize: 10, color: "var(--danger, #ef4444)" }}>Failed</span>}
          </div>
        </div>
        <p style={{ margin: "4px 0 0", fontSize: 10, color: "var(--text-muted)" }}>
          OpenClaw stores memory as Markdown files &middot; MEMORY.md + daily logs
        </p>
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
              style={{ width: "100%", padding: "7px 10px 7px 32px", borderRadius: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12 }}
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={searching}
            style={{ padding: "0 12px", borderRadius: 8, background: "var(--accent)", border: "none", color: "var(--text)", fontSize: 11, cursor: "pointer" }}
          >
            {searching ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> : "Search"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ padding: "0 20px 8px", display: "flex", gap: 4, flexShrink: 0 }}>
        {(["curated", "daily", "search", "edit"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "4px 12px", borderRadius: 6, border: "none", fontSize: 11, cursor: "pointer",
              background: tab === t ? "rgba(59,130,246,0.18)" : "var(--bg-elevated)",
              color: tab === t ? "var(--accent)" : "var(--text-muted)",
            }}
          >
            {t === "curated" && <><FileText style={{ width: 10, height: 10, marginRight: 4, verticalAlign: "middle" }} />MEMORY.md</>}
            {t === "daily" && <><Calendar style={{ width: 10, height: 10, marginRight: 4, verticalAlign: "middle" }} />Daily</>}
            {t === "search" && <><Search style={{ width: 10, height: 10, marginRight: 4, verticalAlign: "middle" }} />Results</>}
            {t === "edit" && <><Edit3 style={{ width: 10, height: 10, marginRight: 4, verticalAlign: "middle" }} />Edit MEMORY.md</>}
          </button>
        ))}
      </div>

      {/* Memory entries / Edit tab */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 12px", display: "flex", flexDirection: "column", minHeight: 0 }}>
        {tab === "edit" ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
            {editLoading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
                <Loader2 style={{ width: 24, height: 24, color: "var(--accent)" }} className="animate-spin" />
              </div>
            ) : (
              <>
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  style={{
                    flex: 1, minHeight: 200, fontFamily: "monospace", fontSize: 12, padding: 12,
                    background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8,
                    color: "var(--text)", resize: "none", width: "100%",
                  }}
                  spellCheck={false}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    onClick={handleSaveEdit}
                    disabled={editSaving}
                    style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 14px", borderRadius: 8, background: "var(--accent)", border: "none", color: "var(--text)", fontSize: 11, cursor: "pointer" }}
                  >
                    {editSaving ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : null}
                    Save
                  </button>
                  {editSaveConfirm && <span style={{ fontSize: 11, color: "var(--accent)" }}>Saved</span>}
                </div>
              </>
            )}
          </div>
        ) : loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <Loader2 style={{ width: 24, height: 24, color: "var(--accent)" }} className="animate-spin" />
          </div>
        ) : displayEntries.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 8 }}>
            <Brain style={{ width: 32, height: 32, color: "var(--text-muted)" }} />
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {tab === "search" ? "No search results" : "No memory entries yet"}
            </p>
            <p style={{ fontSize: 10, color: "var(--text-muted)", textAlign: "center", maxWidth: 240 }}>
              Memory is built as you chat. OpenClaw automatically stores important context in MEMORY.md.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {displayEntries.map(entry => (
              <div
                key={entry.id}
                style={{
                  background: "var(--bg-elevated)", border: "1px solid var(--border)",
                  borderRadius: 8, padding: "10px 12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>{entry.source}</span>
                  <span style={{
                    fontSize: 9, padding: "2px 6px", borderRadius: 4,
                    background: entry.type === "curated" ? "rgba(59,130,246,0.15)" : "var(--bg-elevated)",
                    color: entry.type === "curated" ? "var(--accent)" : "var(--text-muted)",
                  }}>
                    {entry.type}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: "var(--text)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                  {entry.content}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add memory */}
      {tab === "curated" && (
        <div style={{ padding: "8px 20px 12px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={newMemory}
              onChange={e => setNewMemory(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAddMemory()}
              placeholder="Add to MEMORY.md..."
              style={{ flex: 1, padding: "7px 10px", borderRadius: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12 }}
            />
            <button
              onClick={handleAddMemory}
              disabled={adding || !newMemory.trim()}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 12px", borderRadius: 8, background: "var(--accent)", border: "none", color: "var(--text)", fontSize: 11, cursor: "pointer", opacity: adding || !newMemory.trim() ? 0.5 : 1 }}
            >
              {adding ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <Plus style={{ width: 12, height: 12 }} />}
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
