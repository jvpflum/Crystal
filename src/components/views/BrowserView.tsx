import { useState, useEffect, useCallback, useRef } from "react";
import {
  Globe,
  RefreshCw,
  Play,
  Square,
  Camera,
  ExternalLink,
  Search,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { useAppStore } from "@/stores/appStore";

interface BrowserStatus {
  running?: boolean;
  status?: string;
  pid?: number;
  url?: string;
  [key: string]: unknown;
}

interface BrowserTab {
  id?: string;
  title?: string;
  url?: string;
  active?: boolean;
}

export function BrowserView() {
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionRunning, setActionRunning] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [tabFilter, setTabFilter] = useState("");
  const [navigateUrl, setNavigateUrl] = useState("");
  const tokenRef = useRef<string>("");

  const isRunning = status?.running === true || status?.status === "running";

  const getToken = useCallback(async (): Promise<string> => {
    if (tokenRef.current) return tokenRef.current;
    try {
      const home = await homeDir();
      const sep = home.endsWith("\\") || home.endsWith("/") ? "" : "\\";
      const raw = await invoke<string>("read_file", { path: `${home}${sep}.openclaw\\openclaw.json` });
      const cfg = JSON.parse(raw);
      const token = cfg?.gateway?.auth?.token;
      if (token && typeof token === "string") {
        tokenRef.current = token;
        return token;
      }
    } catch { /* fall through */ }
    return "";
  }, []);

  const browserCmd = useCallback(async (subcommand: string): Promise<{ stdout: string; stderr: string; code: number }> => {
    const token = await getToken();
    const tokenFlag = token ? ` --token "${token}"` : "";
    return invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
      command: `openclaw browser ${subcommand}${tokenFlag}`,
      cwd: null,
    });
  }, [getToken]);

  const loadStatus = useCallback(async () => {
    try {
      const result = await browserCmd("status --json");
      if (result.code === 0 && result.stdout.trim()) {
        const parsed = JSON.parse(result.stdout);
        setStatus(parsed);
      } else {
        setStatus({ running: false });
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to get browser status");
      setStatus({ running: false });
    }
  }, [browserCmd]);

  const loadTabs = useCallback(async () => {
    try {
      const result = await browserCmd("tabs --json");
      if (result.code === 0 && result.stdout.trim()) {
        const parsed = JSON.parse(result.stdout);
        setTabs(Array.isArray(parsed) ? parsed : parsed.tabs ?? []);
      } else {
        setTabs([]);
      }
    } catch {
      setTabs([]);
    }
  }, [browserCmd]);

  const loadAll = useCallback(async () => {
    await loadStatus();
    await loadTabs();
  }, [loadStatus, loadTabs]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadAll();
      setLoading(false);
    })();
  }, [loadAll]);

  const currentView = useAppStore(s => s.currentView);
  const isBrowserVisible = currentView === "browser";

  useEffect(() => {
    if (!isBrowserVisible || !isRunning) return;
    const id = setInterval(() => {
      loadStatus();
      loadTabs();
    }, 5000);
    return () => clearInterval(id);
  }, [isRunning, isBrowserVisible, loadStatus, loadTabs]);

  const startBrowser = async () => {
    setActionRunning("start");
    setOutput(null);
    try {
      const result = await browserCmd("start");
      setOutput(result.code === 0 ? result.stdout || "Browser started." : result.stderr || "Start failed.");
      await loadAll();
    } catch (e) {
      setOutput(e instanceof Error ? e.message : "Start failed");
    }
    setActionRunning(null);
  };

  const stopBrowser = async () => {
    setActionRunning("stop");
    setOutput(null);
    try {
      const result = await browserCmd("stop");
      setOutput(result.code === 0 ? result.stdout || "Browser stopped." : result.stderr || "Stop failed.");
      await loadAll();
    } catch (e) {
      setOutput(e instanceof Error ? e.message : "Stop failed");
    }
    setActionRunning(null);
  };

  const takeScreenshot = async () => {
    setActionRunning("screenshot");
    setOutput(null);
    try {
      const result = await browserCmd("screenshot --json");
      if (result.code === 0 && result.stdout.trim()) {
        try {
          const parsed = JSON.parse(result.stdout);
          const path = parsed.path ?? parsed.file ?? parsed.screenshot;
          setOutput(path ? `Screenshot saved: ${path}` : JSON.stringify(parsed, null, 2));
        } catch {
          setOutput(result.stdout || "Screenshot captured.");
        }
      } else {
        setOutput(result.stderr || "Screenshot failed.");
      }
    } catch (e) {
      setOutput(e instanceof Error ? e.message : "Screenshot failed");
    }
    setActionRunning(null);
  };

  const navigateTo = async () => {
    if (!navigateUrl.trim()) return;
    setActionRunning("navigate");
    setOutput(null);
    try {
      const url = navigateUrl.trim().startsWith("http") ? navigateUrl.trim() : `https://${navigateUrl.trim()}`;
      const result = await browserCmd(`navigate "${url}"`);
      setOutput(result.code === 0 ? result.stdout || `Navigated to ${url}` : result.stderr || "Navigation failed.");
      setNavigateUrl("");
      await loadTabs();
    } catch (e) {
      setOutput(e instanceof Error ? e.message : "Navigation failed");
    }
    setActionRunning(null);
  };

  const openTab = async () => {
    if (!navigateUrl.trim()) return;
    setActionRunning("open");
    setOutput(null);
    try {
      const url = navigateUrl.trim().startsWith("http") ? navigateUrl.trim() : `https://${navigateUrl.trim()}`;
      const result = await browserCmd(`open "${url}"`);
      setOutput(result.code === 0 ? result.stdout || `Opened ${url}` : result.stderr || "Open failed.");
      setNavigateUrl("");
      await loadTabs();
    } catch (e) {
      setOutput(e instanceof Error ? e.message : "Open failed");
    }
    setActionRunning(null);
  };

  const refresh = async () => {
    setLoading(true);
    await loadAll();
    setLoading(false);
  };

  const filteredTabs = tabs.filter((t) => {
    if (!tabFilter.trim()) return true;
    const q = tabFilter.toLowerCase();
    return (
      (t.title ?? "").toLowerCase().includes(q) ||
      (t.url ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px 10px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 style={{ color: "white", fontSize: 15, fontWeight: 600, margin: 0 }}>Browser</h2>
          <span style={{
            fontSize: 9, padding: "2px 8px", borderRadius: 8,
            background: isRunning ? "rgba(74,222,128,0.12)" : "rgba(255,255,255,0.06)",
            color: isRunning ? "#4ade80" : "rgba(255,255,255,0.35)",
            border: `1px solid ${isRunning ? "rgba(74,222,128,0.25)" : "rgba(255,255,255,0.08)"}`,
            fontWeight: 600,
          }}>
            {isRunning ? "Running" : "Stopped"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {isRunning ? (
            <button
              onClick={stopBrowser}
              disabled={actionRunning === "stop"}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6,
                border: "1px solid rgba(248,113,113,0.2)", background: "rgba(248,113,113,0.08)",
                color: "#f87171", fontSize: 11, cursor: "pointer",
              }}
            >
              {actionRunning === "stop" ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <Square style={{ width: 12, height: 12 }} />}
              Stop
            </button>
          ) : (
            <button
              onClick={startBrowser}
              disabled={actionRunning === "start"}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6,
                border: "none", background: "rgba(59,130,246,0.15)", color: "#60a5fa",
                fontSize: 11, cursor: "pointer",
              }}
            >
              {actionRunning === "start" ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <Play style={{ width: 12, height: 12 }} />}
              Start
            </button>
          )}
          <button
            onClick={takeScreenshot}
            disabled={!isRunning || actionRunning === "screenshot"}
            style={{
              display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)",
              color: "rgba(255,255,255,0.6)", fontSize: 11, cursor: "pointer",
              opacity: !isRunning ? 0.4 : 1,
            }}
          >
            {actionRunning === "screenshot" ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <Camera style={{ width: 12, height: 12 }} />}
            Screenshot
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
            <AlertTriangle style={{ width: 14, height: 14, color: "#f87171", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "#f87171", flex: 1 }}>{error}</span>
            <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", fontSize: 14, cursor: "pointer" }}>×</button>
          </div>
        )}

        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
            <Loader2 style={{ width: 20, height: 20, color: "rgba(255,255,255,0.3)" }} className="animate-spin" />
          </div>
        ) : (
          <>
            {/* Status card */}
            {status && (
              <div style={{ marginBottom: 16 }}>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 500, display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>
                  Status Details
                </span>
                <div style={{
                  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 10, padding: "12px 14px",
                }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                    <StatusField label="State" value={isRunning ? "Running" : "Stopped"} color={isRunning ? "#4ade80" : "#f87171"} />
                    {status.pid && <StatusField label="PID" value={String(status.pid)} />}
                    {status.url && <StatusField label="URL" value={status.url} />}
                    {Object.entries(status)
                      .filter(([k]) => !["running", "status", "pid", "url"].includes(k))
                      .map(([k, v]) => (
                        <StatusField key={k} label={k} value={String(v)} />
                      ))}
                  </div>
                </div>
              </div>
            )}

            {/* URL Bar */}
            {isRunning && (
              <div style={{ marginBottom: 16 }}>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 500, display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>
                  Navigate
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  <div style={{ flex: 1, position: "relative" }}>
                    <Globe style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, color: "rgba(255,255,255,0.25)" }} />
                    <input
                      value={navigateUrl}
                      onChange={e => setNavigateUrl(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") navigateTo(); }}
                      placeholder="Enter URL (e.g. google.com)"
                      style={{
                        width: "100%", padding: "8px 10px 8px 30px", borderRadius: 8,
                        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                        color: "white", fontSize: 12, outline: "none", boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <button
                    onClick={navigateTo}
                    disabled={!navigateUrl.trim() || !!actionRunning}
                    style={{
                      padding: "6px 12px", borderRadius: 8, border: "none",
                      background: navigateUrl.trim() ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.04)",
                      color: navigateUrl.trim() ? "#60a5fa" : "rgba(255,255,255,0.3)",
                      fontSize: 11, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap",
                    }}
                  >
                    Go
                  </button>
                  <button
                    onClick={openTab}
                    disabled={!navigateUrl.trim() || !!actionRunning}
                    style={{
                      padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)",
                      background: "rgba(255,255,255,0.04)",
                      color: navigateUrl.trim() ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.3)",
                      fontSize: 11, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap",
                    }}
                  >
                    New Tab
                  </button>
                </div>
              </div>
            )}

            {/* Tabs */}
            <div style={{ marginBottom: 16 }}>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 500, display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>
                Tabs {tabs.length > 0 && `(${tabs.length})`}
              </span>

              {tabs.length > 0 && (
                <div style={{ position: "relative", marginBottom: 8 }}>
                  <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, color: "rgba(255,255,255,0.25)" }} />
                  <input
                    value={tabFilter}
                    onChange={(e) => setTabFilter(e.target.value)}
                    placeholder="Filter tabs..."
                    style={{
                      width: "100%", padding: "7px 10px 7px 30px", borderRadius: 8,
                      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                      color: "white", fontSize: 12, outline: "none", boxSizing: "border-box",
                    }}
                  />
                </div>
              )}

              {filteredTabs.length === 0 ? (
                <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "24px 16px", textAlign: "center" }}>
                  <Globe style={{ width: 28, height: 28, color: "rgba(255,255,255,0.12)", margin: "0 auto 8px", display: "block" }} />
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: 0 }}>
                    {!isRunning ? "Browser is not running" : tabs.length === 0 ? "No open tabs" : "No tabs match your filter"}
                  </p>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", margin: "4px 0 0" }}>
                    {!isRunning ? "Start the browser to see tabs" : "Tabs will appear here when opened"}
                  </p>
                </div>
              ) : (
                <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
                  {filteredTabs.map((tab, i) => (
                    <div
                      key={tab.id ?? i}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                        borderBottom: i < filteredTabs.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
                      }}
                    >
                      <Globe style={{ width: 13, height: 13, color: tab.active ? "#60a5fa" : "rgba(255,255,255,0.3)", flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "white", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {tab.title || "Untitled"}
                        </div>
                        {tab.url && (
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {tab.url}
                          </div>
                        )}
                      </div>
                      {tab.active && (
                        <span style={{
                          fontSize: 9, padding: "1px 6px", borderRadius: 8,
                          background: "rgba(59,130,246,0.12)", color: "#60a5fa",
                          border: "1px solid rgba(59,130,246,0.2)",
                        }}>
                          active
                        </span>
                      )}
                      {tab.url && (
                        <button
                          onClick={() => window.open(tab.url, "_blank")}
                          title="Open in browser"
                          style={{
                            width: 26, height: 26, borderRadius: 6, border: "none",
                            background: "transparent", display: "flex", alignItems: "center", justifyContent: "center",
                            cursor: "pointer", color: "rgba(255,255,255,0.5)",
                          }}
                        >
                          <ExternalLink style={{ width: 12, height: 12 }} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Output */}
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

function StatusField({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 0.5, display: "block" }}>
        {label}
      </span>
      <span style={{ fontSize: 12, color: color ?? "rgba(255,255,255,0.7)", fontWeight: 500 }}>
        {value}
      </span>
    </div>
  );
}
