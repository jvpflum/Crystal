import { useState, useEffect, useRef, useCallback } from "react";
import { Activity, Trash2, Terminal, MessageSquare, AlertTriangle, Heart, Zap, Radio, Search, Copy, Check, RefreshCw, ArrowDown, ScrollText } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { openclawClient, ActivityEntry } from "@/lib/openclaw";
import { useAppStore } from "@/stores/appStore";

const TYPE_META: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  chat: { icon: MessageSquare, color: "#3B82F6", label: "Chat" },
  response: { icon: MessageSquare, color: "#8b5cf6", label: "Response" },
  tool_call: { icon: Terminal, color: "#f59e0b", label: "Tool Call" },
  tool_result: { icon: Terminal, color: "#10b981", label: "Tool Result" },
  skill_invoke: { icon: Zap, color: "#ec4899", label: "Skill" },
  error: { icon: AlertTriangle, color: "#f87171", label: "Error" },
  heartbeat: { icon: Heart, color: "#4ade80", label: "Heartbeat" },
  heartbeat_status: { icon: Heart, color: "#4ade80", label: "Heartbeat" },
  status: { icon: Radio, color: "#60a5fa", label: "Status" },
};

type TabId = "activity" | "logs";

/* ── Log level color mapping ── */
function getLogLineStyle(line: string): React.CSSProperties {
  const upper = line.toUpperCase();
  if (upper.includes("ERROR") || upper.includes("[ERR")) return { color: "#f87171" };
  if (upper.includes("WARN") || upper.includes("[WRN")) return { color: "#fbbf24" };
  if (upper.includes("INFO") || upper.includes("[INF")) return { color: "#60a5fa" };
  if (upper.includes("DEBUG") || upper.includes("[DBG")) return { color: "rgba(255,255,255,0.35)" };
  return { color: "rgba(255,255,255,0.55)" };
}

export function ActivityView() {
  const [activeTab, setActiveTab] = useState<TabId>("activity");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Tab bar */}
      <div style={{
        display: "flex", flexShrink: 0,
        background: "rgba(255,255,255,0.03)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        {([
          { id: "activity" as TabId, label: "Activity Feed", icon: Activity },
          { id: "logs" as TabId, label: "Gateway Logs", icon: ScrollText },
        ]).map(tab => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "10px 18px", border: "none", cursor: "pointer",
                fontSize: 12, fontWeight: isActive ? 600 : 400,
                background: isActive ? "rgba(59,130,246,0.15)" : "transparent",
                color: isActive ? "#60a5fa" : "rgba(255,255,255,0.45)",
                borderBottom: isActive ? "2px solid #3B82F6" : "2px solid transparent",
                transition: "all 0.15s",
              }}
              onMouseEnter={e => {
                if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
              }}
              onMouseLeave={e => {
                if (!isActive) e.currentTarget.style.background = "transparent";
              }}
            >
              <Icon style={{ width: 13, height: 13 }} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "activity" ? <ActivityFeedTab /> : <GatewayLogsTab />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Activity Feed Tab (original functionality preserved)
   ═══════════════════════════════════════════════════════ */

function ActivityFeedTab() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [live, setLive] = useState(true);
  const gatewayConnected = useAppStore(s => s.gatewayConnected);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEntries(openclawClient.getActivityLog());
  }, []);

  useEffect(() => {
    if (!live) return;
    const unsub = openclawClient.on("*", () => {
      setEntries(openclawClient.getActivityLog());
    });
    const poll = setInterval(() => {
      setEntries(openclawClient.getActivityLog());
    }, 5_000);
    return () => { unsub(); clearInterval(poll); };
  }, [live]);

  useEffect(() => {
    if (live) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries, live]);

  const filtered = filter === "all" ? entries : entries.filter(e => e.type === filter);

  const clearLog = () => {
    openclawClient.clearActivityLog();
    setEntries([]);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ color: "white", fontSize: 15, fontWeight: 600, margin: 0 }}>Activity</h2>
            <p style={{ margin: "2px 0 0", fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
              {gatewayConnected ? "Live gateway feed" : "Activity log"} &middot; {entries.length} events
            </p>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setLive(!live)}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6,
                border: "none", fontSize: 10, cursor: "pointer",
                background: live ? "rgba(74,222,128,0.15)" : "rgba(255,255,255,0.06)",
                color: live ? "#4ade80" : "rgba(255,255,255,0.5)",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: live ? "#4ade80" : "rgba(255,255,255,0.3)" }} />
              {live ? "Live" : "Paused"}
            </button>
            <button
              onClick={clearLog}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 6, border: "none", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", fontSize: 10, cursor: "pointer" }}
            >
              <Trash2 style={{ width: 10, height: 10 }} /> Clear
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ padding: "0 20px 8px", display: "flex", gap: 4, flexWrap: "wrap", flexShrink: 0 }}>
        {["all", "chat", "tool_call", "tool_result", "error", "heartbeat_status"].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "3px 8px", borderRadius: 5, border: "none", fontSize: 10, cursor: "pointer",
              background: filter === f ? "rgba(59,130,246,0.18)" : "rgba(255,255,255,0.04)",
              color: filter === f ? "#3B82F6" : "rgba(255,255,255,0.5)",
            }}
          >
            {f === "all" ? "All" : (TYPE_META[f]?.label || f)}
          </button>
        ))}
      </div>

      {/* Log entries */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 12px", fontFamily: "monospace" }}>
        {filtered.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 8 }}>
            <Activity style={{ width: 32, height: 32, color: "rgba(255,255,255,0.15)" }} />
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", fontFamily: "inherit" }}>
              {gatewayConnected ? "Waiting for activity..." : "Connect gateway to see live activity"}
            </p>
          </div>
        ) : (
          filtered.map(entry => {
            const meta = TYPE_META[entry.type] || TYPE_META.chat;
            const Icon = meta.icon;
            return (
              <div
                key={entry.id}
                style={{
                  display: "flex", gap: 8, padding: "6px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                }}
              >
                <Icon style={{ width: 12, height: 12, color: meta.color, flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 10, color: meta.color, fontWeight: 500 }}>{meta.label}</span>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>
                      {entry.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "rgba(255,255,255,0.6)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {entry.content.slice(0, 300)}{entry.content.length > 300 ? "..." : ""}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Gateway Logs Tab
   ═══════════════════════════════════════════════════════ */

function GatewayLogsTab() {
  const [logs, setLogs] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<string>("execute_command", {
        command: "openclaw logs --limit 100 --plain --no-color",
      });
      const raw = typeof result === "string" ? result : (result as { stdout?: string })?.stdout || "";
      const lines = raw.split("\n").filter((l: string) => l.trim());
      setLogs(lines);
      setLastFetch(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const currentView = useAppStore(s => s.currentView);
  const isActivityVisible = currentView === "activity";

  useEffect(() => {
    if (!autoRefresh || !isActivityVisible) return;
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, isActivityVisible, fetchLogs]);

  useEffect(() => {
    if (autoRefresh) {
      logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoRefresh]);

  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const copyAllLogs = () => {
    navigator.clipboard.writeText(filteredLogs.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const filteredLogs = searchQuery
    ? logs.filter(l => l.toLowerCase().includes(searchQuery.toLowerCase()))
    : logs;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ color: "white", fontSize: 15, fontWeight: 600, margin: 0 }}>Gateway Logs</h2>
            <p style={{ margin: "2px 0 0", fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
              {filteredLogs.length} lines
              {lastFetch && <> &middot; fetched {lastFetch.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</>}
            </p>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6,
                border: "none", fontSize: 10, cursor: "pointer",
                background: autoRefresh ? "rgba(74,222,128,0.15)" : "rgba(255,255,255,0.06)",
                color: autoRefresh ? "#4ade80" : "rgba(255,255,255,0.5)",
                transition: "all 0.15s",
              }}
            >
              <RefreshCw style={{
                width: 10, height: 10,
                animation: autoRefresh ? "spin 2s linear infinite" : "none",
              }} />
              {autoRefresh ? "Auto" : "Manual"}
            </button>
            <button
              onClick={fetchLogs}
              disabled={loading}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6,
                border: "none", fontSize: 10, cursor: loading ? "default" : "pointer",
                background: "rgba(59,130,246,0.12)",
                color: "#60a5fa",
                opacity: loading ? 0.5 : 1,
                transition: "all 0.15s",
              }}
            >
              <RefreshCw style={{ width: 10, height: 10 }} />
              Refresh
            </button>
            <button
              onClick={copyAllLogs}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 6,
                border: "none", fontSize: 10, cursor: "pointer",
                background: "rgba(255,255,255,0.06)",
                color: copied ? "#4ade80" : "rgba(255,255,255,0.5)",
                transition: "all 0.15s",
              }}
            >
              {copied
                ? <><Check style={{ width: 10, height: 10 }} /> Copied</>
                : <><Copy style={{ width: 10, height: 10 }} /> Copy All</>
              }
            </button>
            <button
              onClick={scrollToBottom}
              style={{
                display: "flex", alignItems: "center", padding: "4px 6px", borderRadius: 6,
                border: "none", fontSize: 10, cursor: "pointer",
                background: "rgba(255,255,255,0.06)",
                color: "rgba(255,255,255,0.5)",
              }}
              title="Scroll to bottom"
            >
              <ArrowDown style={{ width: 10, height: 10 }} />
            </button>
          </div>
        </div>
      </div>

      {/* Search */}
      <div style={{ padding: "0 20px 10px", flexShrink: 0 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8, padding: "4px 10px",
        }}>
          <Search style={{ width: 12, height: 12, color: "rgba(255,255,255,0.3)", flexShrink: 0 }} />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Filter logs..."
            style={{
              flex: 1, background: "transparent", border: "none",
              color: "white", fontSize: 11, outline: "none",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          />
          {searchQuery && (
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", flexShrink: 0 }}>
              {filteredLogs.length} match{filteredLogs.length !== 1 ? "es" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Terminal output */}
      <div
        ref={containerRef}
        style={{
          flex: 1, overflowY: "auto", margin: "0 20px 12px",
          background: "rgba(0,0,0,0.3)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 8,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
          fontSize: 11,
          lineHeight: 1.6,
        }}
      >
        {error ? (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            padding: 40, gap: 8,
          }}>
            <AlertTriangle style={{ width: 24, height: 24, color: "#f87171" }} />
            <p style={{ fontSize: 12, color: "#f87171", textAlign: "center", margin: 0 }}>
              Failed to fetch logs
            </p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textAlign: "center", margin: 0, maxWidth: 300 }}>
              {error}
            </p>
            <button
              onClick={fetchLogs}
              style={{
                marginTop: 8, padding: "6px 14px", borderRadius: 6,
                border: "1px solid rgba(59,130,246,0.3)",
                background: "rgba(59,130,246,0.1)",
                color: "#60a5fa", fontSize: 11, cursor: "pointer",
              }}
            >
              Retry
            </button>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            padding: 40, gap: 8,
          }}>
            <Terminal style={{ width: 24, height: 24, color: "rgba(255,255,255,0.15)" }} />
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: 0 }}>
              {loading ? "Fetching logs..." : searchQuery ? "No matching log lines" : "No log entries found"}
            </p>
          </div>
        ) : (
          <div style={{ padding: "8px 12px" }}>
            {filteredLogs.map((line, i) => (
              <div
                key={i}
                style={{
                  padding: "1px 0",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  ...getLogLineStyle(line),
                }}
              >
                <span style={{ color: "rgba(255,255,255,0.15)", userSelect: "none", marginRight: 8, display: "inline-block", width: 32, textAlign: "right" }}>
                  {i + 1}
                </span>
                {searchQuery ? highlightMatch(line, searchQuery) : line}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  let lastIndex = 0;

  let idx = lower.indexOf(queryLower, lastIndex);
  while (idx !== -1) {
    if (idx > lastIndex) parts.push(text.slice(lastIndex, idx));
    parts.push(
      <span key={idx} style={{ background: "rgba(250,204,21,0.25)", color: "#fde68a", borderRadius: 2, padding: "0 1px" }}>
        {text.slice(idx, idx + query.length)}
      </span>
    );
    lastIndex = idx + query.length;
    idx = lower.indexOf(queryLower, lastIndex);
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}
