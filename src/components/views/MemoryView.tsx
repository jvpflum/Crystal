import { useState, useEffect } from "react";
import { Brain, Search, Plus, RefreshCw, Loader2, FileText, Calendar } from "lucide-react";
import { openclawClient, MemoryEntry } from "@/lib/openclaw";

export function MemoryView() {
  const [curatedMemory, setCuratedMemory] = useState<MemoryEntry[]>([]);
  const [dailyMemory, setDailyMemory] = useState<MemoryEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MemoryEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [tab, setTab] = useState<"curated" | "daily" | "search">("curated");
  const [newMemory, setNewMemory] = useState("");
  const [adding, setAdding] = useState(false);

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

  const displayEntries = tab === "search" ? (searchResults || []) : tab === "daily" ? dailyMemory : curatedMemory;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ color: "white", fontSize: 15, fontWeight: 600, margin: 0 }}>Memory</h2>
          <button
            onClick={loadMemory}
            disabled={loading}
            style={{ display: "flex", alignItems: "center", gap: 4, color: "rgba(255,255,255,0.45)", fontSize: 10, background: "none", border: "none", cursor: "pointer" }}
          >
            <RefreshCw style={{ width: 12, height: 12 }} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
        <p style={{ margin: "4px 0 0", fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
          OpenClaw stores memory as Markdown files &middot; MEMORY.md + daily logs
        </p>
      </div>

      {/* Search */}
      <div style={{ padding: "0 20px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "rgba(255,255,255,0.4)" }} />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              placeholder="Semantic search across memory..."
              style={{ width: "100%", padding: "7px 10px 7px 32px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white", fontSize: 12 }}
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={searching}
            style={{ padding: "0 12px", borderRadius: 8, background: "#3B82F6", border: "none", color: "white", fontSize: 11, cursor: "pointer" }}
          >
            {searching ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> : "Search"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ padding: "0 20px 8px", display: "flex", gap: 4, flexShrink: 0 }}>
        {(["curated", "daily", "search"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "4px 12px", borderRadius: 6, border: "none", fontSize: 11, cursor: "pointer",
              background: tab === t ? "rgba(59,130,246,0.18)" : "rgba(255,255,255,0.04)",
              color: tab === t ? "#3B82F6" : "rgba(255,255,255,0.5)",
            }}
          >
            {t === "curated" && <><FileText style={{ width: 10, height: 10, marginRight: 4, verticalAlign: "middle" }} />MEMORY.md</>}
            {t === "daily" && <><Calendar style={{ width: 10, height: 10, marginRight: 4, verticalAlign: "middle" }} />Daily</>}
            {t === "search" && <><Search style={{ width: 10, height: 10, marginRight: 4, verticalAlign: "middle" }} />Results</>}
          </button>
        ))}
      </div>

      {/* Memory entries */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 12px" }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <Loader2 style={{ width: 24, height: 24, color: "#3B82F6" }} className="animate-spin" />
          </div>
        ) : displayEntries.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 8 }}>
            <Brain style={{ width: 32, height: 32, color: "rgba(255,255,255,0.15)" }} />
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
              {tab === "search" ? "No search results" : "No memory entries yet"}
            </p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", textAlign: "center", maxWidth: 240 }}>
              Memory is built as you chat. OpenClaw automatically stores important context in MEMORY.md.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {displayEntries.map(entry => (
              <div
                key={entry.id}
                style={{
                  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 8, padding: "10px 12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>{entry.source}</span>
                  <span style={{
                    fontSize: 9, padding: "2px 6px", borderRadius: 4,
                    background: entry.type === "curated" ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.06)",
                    color: entry.type === "curated" ? "#60a5fa" : "rgba(255,255,255,0.4)",
                  }}>
                    {entry.type}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.8)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                  {entry.content}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add memory */}
      {tab === "curated" && (
        <div style={{ padding: "8px 20px 12px", borderTop: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={newMemory}
              onChange={e => setNewMemory(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAddMemory()}
              placeholder="Add to MEMORY.md..."
              style={{ flex: 1, padding: "7px 10px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white", fontSize: 12 }}
            />
            <button
              onClick={handleAddMemory}
              disabled={adding || !newMemory.trim()}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 12px", borderRadius: 8, background: "#3B82F6", border: "none", color: "white", fontSize: 11, cursor: "pointer", opacity: adding || !newMemory.trim() ? 0.5 : 1 }}
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
