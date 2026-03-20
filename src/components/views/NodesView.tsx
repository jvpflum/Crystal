import { useState, useEffect, useCallback } from "react";
import {
  Network,
  RefreshCw,
  Play,
  Zap,
  Bell,
  Search,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { escapeShellArg } from "@/lib/tools";

interface NodeItem {
  id: string;
  name?: string;
  label?: string;
  status?: string;
  type?: string;
}

export function NodesView() {
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [output, setOutput] = useState<string | null>(null);
  const [runningAction, setRunningAction] = useState<string | null>(null);

  const [promptTarget, setPromptTarget] = useState<{ nodeId: string; action: "run" | "invoke" } | null>(null);
  const [promptInput, setPromptInput] = useState("");

  const [notifyMessage, setNotifyMessage] = useState("");
  const [showNotifyPrompt, setShowNotifyPrompt] = useState(false);

  const loadNodes = useCallback(async () => {
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "openclaw nodes list --json",
        cwd: null,
      });
      if (result.code === 0 && result.stdout.trim()) {
        const parsed = JSON.parse(result.stdout);
        setNodes(Array.isArray(parsed) ? parsed : parsed.nodes ?? []);
      } else {
        setNodes([]);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load nodes");
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadNodes();
      setLoading(false);
    })();
  }, [loadNodes]);

  const refresh = async () => {
    setLoading(true);
    await loadNodes();
    setLoading(false);
  };

  const executeAction = async (nodeId: string, action: "run" | "invoke", input: string) => {
    const key = `${action}-${nodeId}`;
    setRunningAction(key);
    setOutput(null);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: action === "run"
          ? `openclaw nodes run --node ${escapeShellArg(nodeId)} -- ${escapeShellArg(input)}`
          : `openclaw nodes invoke --node ${escapeShellArg(nodeId)} --command "${escapeShellArg(input)}"`,
        cwd: null,
      });
      setOutput(result.code === 0 ? result.stdout || "Done." : result.stderr || "Command failed.");
    } catch (e) {
      setOutput(e instanceof Error ? e.message : "Action failed");
    }
    setRunningAction(null);
  };

  const notifyAll = async () => {
    if (!notifyMessage.trim()) return;
    setRunningAction("notify");
    setOutput(null);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `openclaw nodes notify --body "${escapeShellArg(notifyMessage.trim())}"`,
        cwd: null,
      });
      setOutput(result.code === 0 ? result.stdout || "Notification sent." : result.stderr || "Notify failed.");
    } catch (e) {
      setOutput(e instanceof Error ? e.message : "Notify failed");
    }
    setRunningAction(null);
    setShowNotifyPrompt(false);
    setNotifyMessage("");
  };

  const handlePromptSubmit = () => {
    if (!promptTarget || !promptInput.trim()) return;
    executeAction(promptTarget.nodeId, promptTarget.action, promptInput.trim());
    setPromptTarget(null);
    setPromptInput("");
  };

  const filtered = nodes.filter((n) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (
      n.id.toLowerCase().includes(q) ||
      (n.name ?? "").toLowerCase().includes(q) ||
      (n.label ?? "").toLowerCase().includes(q) ||
      (n.type ?? "").toLowerCase().includes(q)
    );
  });

  const statusColor = (s?: string) => {
    if (!s) return "rgba(255,255,255,0.35)";
    const l = s.toLowerCase();
    if (l === "running" || l === "active" || l === "online") return "#4ade80";
    if (l === "stopped" || l === "offline") return "#f87171";
    if (l === "idle" || l === "waiting") return "#fbbf24";
    return "rgba(255,255,255,0.5)";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px 10px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Nodes</h2>
          {!loading && (
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", letterSpacing: 1, textTransform: "uppercase" }}>
              {filtered.length} node{filtered.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => setShowNotifyPrompt(true)}
            style={{
              display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6,
              border: "1px solid var(--border)", background: "rgba(255,255,255,0.04)",
              color: "rgba(255,255,255,0.6)", fontSize: 11, cursor: "pointer",
            }}
          >
            <Bell style={{ width: 12, height: 12 }} />
            Notify All
          </button>
          <button
            onClick={refresh}
            disabled={loading}
            style={{
              display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 6,
              border: "none", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)",
              fontSize: 11, cursor: "pointer",
            }}
          >
            <RefreshCw style={{ width: 12, height: 12 }} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "0 20px 20px" }}>
        {/* Error */}
        {error && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", marginBottom: 12 }}>
            <AlertTriangle style={{ width: 14, height: 14, color: "var(--error)", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "var(--error)", flex: 1 }}>{error}</span>
            <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", fontSize: 14, cursor: "pointer" }}>×</button>
          </div>
        )}

        {/* Notify prompt */}
        {showNotifyPrompt && (
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              value={notifyMessage}
              onChange={(e) => setNotifyMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && notifyAll()}
              placeholder="Notification message..."
              autoFocus
              style={{
                flex: 1, padding: "7px 10px", borderRadius: 8, background: "rgba(255,255,255,0.04)",
                border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, outline: "none",
              }}
            />
            <button
              onClick={notifyAll}
              disabled={runningAction === "notify" || !notifyMessage.trim()}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "7px 14px", borderRadius: 8,
                border: "none", background: "var(--accent)", color: "var(--text)", fontSize: 11, cursor: "pointer",
                opacity: runningAction === "notify" || !notifyMessage.trim() ? 0.5 : 1, flexShrink: 0,
              }}
            >
              {runningAction === "notify" ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <Bell style={{ width: 12, height: 12 }} />}
              Send
            </button>
            <button
              onClick={() => { setShowNotifyPrompt(false); setNotifyMessage(""); }}
              style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", fontSize: 14, cursor: "pointer" }}
            >×</button>
          </div>
        )}

        {/* Input prompt for run/invoke */}
        {promptTarget && (
          <div style={{ display: "flex", gap: 8, marginBottom: 12, padding: "10px 12px", borderRadius: 8, background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.15)" }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1 }}>
                {promptTarget.action} · {promptTarget.nodeId}
              </span>
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <input
                  value={promptInput}
                  onChange={(e) => setPromptInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handlePromptSubmit()}
                  placeholder="Input data..."
                  autoFocus
                  style={{
                    flex: 1, padding: "7px 10px", borderRadius: 8, background: "rgba(255,255,255,0.04)",
                    border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, outline: "none",
                  }}
                />
                <button
                  onClick={handlePromptSubmit}
                  disabled={!promptInput.trim()}
                  style={{
                    padding: "7px 14px", borderRadius: 8, border: "none", background: "rgba(59,130,246,0.15)",
                    color: "var(--accent)", fontSize: 11, cursor: "pointer", opacity: !promptInput.trim() ? 0.5 : 1,
                  }}
                >
                  {promptTarget.action === "run" ? "Run" : "Invoke"}
                </button>
              </div>
            </div>
            <button
              onClick={() => { setPromptTarget(null); setPromptInput(""); }}
              style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", fontSize: 14, cursor: "pointer", alignSelf: "flex-start" }}
            >×</button>
          </div>
        )}

        {/* Search */}
        <div style={{ position: "relative", marginBottom: 12 }}>
          <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, color: "rgba(255,255,255,0.25)" }} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter nodes..."
            style={{
              width: "100%", padding: "7px 10px 7px 30px", borderRadius: 8,
              background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)",
              color: "var(--text)", fontSize: 12, outline: "none", boxSizing: "border-box",
            }}
          />
        </div>

        {/* Node list */}
        <div style={{ marginBottom: 16 }}>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 500, display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>
            Nodes
          </span>

          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
              <Loader2 style={{ width: 20, height: 20, color: "rgba(255,255,255,0.3)" }} className="animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "24px 16px", textAlign: "center" }}>
              <Network style={{ width: 28, height: 28, color: "rgba(255,255,255,0.12)", margin: "0 auto 8px", display: "block" }} />
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: 0 }}>
                {nodes.length === 0 ? "No nodes found" : "No nodes match your filter"}
              </p>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", margin: "4px 0 0" }}>
                {nodes.length === 0 ? "Nodes will appear here once available" : "Try a different search term"}
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filtered.map((node) => {
                const actionKey = `run-${node.id}`;
                const invokeKey = `invoke-${node.id}`;
                return (
                  <div
                    key={node.id}
                    style={{
                      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 10, padding: "10px 14px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Network style={{ width: 14, height: 14, color: "var(--accent)", flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>{node.name || node.label || node.id}</span>
                          {node.type && (
                            <span style={{
                              fontSize: 9, padding: "1px 6px", borderRadius: 8,
                              background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)",
                              border: "1px solid var(--border)",
                            }}>
                              {node.type}
                            </span>
                          )}
                          {node.status && (
                            <span style={{
                              fontSize: 9, padding: "1px 6px", borderRadius: 8,
                              background: `${statusColor(node.status)}15`, color: statusColor(node.status),
                              border: `1px solid ${statusColor(node.status)}30`,
                            }}>
                              {node.status}
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>{node.id}</span>
                      </div>

                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <button
                          onClick={() => { setPromptTarget({ nodeId: node.id, action: "run" }); setPromptInput(""); }}
                          disabled={runningAction === actionKey}
                          title="Run"
                          style={{
                            display: "flex", alignItems: "center", gap: 3, padding: "4px 8px", borderRadius: 6,
                            border: "none", background: "rgba(59,130,246,0.15)", color: "var(--accent)",
                            fontSize: 10, cursor: "pointer",
                          }}
                        >
                          {runningAction === actionKey
                            ? <Loader2 style={{ width: 11, height: 11 }} className="animate-spin" />
                            : <Play style={{ width: 11, height: 11 }} />}
                          Run
                        </button>
                        <button
                          onClick={() => { setPromptTarget({ nodeId: node.id, action: "invoke" }); setPromptInput(""); }}
                          disabled={runningAction === invokeKey}
                          title="Invoke"
                          style={{
                            display: "flex", alignItems: "center", gap: 3, padding: "4px 8px", borderRadius: 6,
                            border: "none", background: "rgba(168,85,247,0.15)", color: "#c084fc",
                            fontSize: 10, cursor: "pointer",
                          }}
                        >
                          {runningAction === invokeKey
                            ? <Loader2 style={{ width: 11, height: 11 }} className="animate-spin" />
                            : <Zap style={{ width: 11, height: 11 }} />}
                          Invoke
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Output area */}
        {output && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 500, textTransform: "uppercase", letterSpacing: 1 }}>
                Output
              </span>
              <button onClick={() => setOutput(null)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", fontSize: 11, cursor: "pointer" }}>
                Dismiss
              </button>
            </div>
            <div style={{
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 10, padding: "10px 14px",
            }}>
              <pre style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.6)", fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {output}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
