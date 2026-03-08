import { useState, useEffect, useCallback } from "react";
import {
  Box, Globe, Shield, RefreshCw, Loader2, AlertTriangle,
  Terminal, Info, ChevronDown, ChevronRight,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface SandboxContainer {
  id: string;
  name: string;
  status: string;
  image?: string;
}

interface SandboxBrowser {
  id: string;
  url?: string;
  status: string;
}

interface SandboxData {
  containers: SandboxContainer[];
  browsers: SandboxBrowser[];
}

export function ToolsView() {
  const [sandbox, setSandbox] = useState<SandboxData>({ containers: [], browsers: [] });
  const [policy, setPolicy] = useState<Record<string, unknown> | null>(null);
  const [toolPermissions, setToolPermissions] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPolicy, setShowPolicy] = useState(false);

  const loadSandbox = useCallback(async () => {
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "npx openclaw sandbox list --json",
        cwd: null,
      });
      if (result.code === 0) {
        try {
          setSandbox(JSON.parse(result.stdout));
        } catch {
          setSandbox({ containers: [], browsers: [] });
        }
      }
    } catch {
      /* non-critical */
    }
  }, []);

  const loadPolicy = useCallback(async () => {
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "npx openclaw sandbox explain --json",
        cwd: null,
      });
      if (result.code === 0) {
        try {
          setPolicy(JSON.parse(result.stdout));
        } catch {
          setPolicy(null);
        }
      }
    } catch {
      /* non-critical */
    }
  }, []);

  const loadToolPermissions = useCallback(async () => {
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "npx openclaw config get tools --json",
        cwd: null,
      });
      if (result.code === 0) {
        try {
          setToolPermissions(JSON.parse(result.stdout));
        } catch {
          setToolPermissions(null);
        }
      }
    } catch {
      /* non-critical */
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadSandbox(), loadPolicy(), loadToolPermissions()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tools data");
    }
    setLoading(false);
  }, [loadSandbox, loadPolicy, loadToolPermissions]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const totalContainers = sandbox.containers.length;
  const totalBrowsers = sandbox.browsers.length;
  const permCount = toolPermissions ? Object.keys(toolPermissions).length : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Tools &amp; Sandbox</h2>
            <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted)" }}>
              {totalContainers} container{totalContainers !== 1 ? "s" : ""} &middot; {totalBrowsers} browser{totalBrowsers !== 1 ? "s" : ""} &middot; {permCount} tool permission{permCount !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={loadAll}
            disabled={loading}
            style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 6, border: "none", background: "rgba(59,130,246,0.2)", color: "var(--accent)", fontSize: 11, cursor: "pointer" }}
          >
            {loading
              ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />
              : <RefreshCw style={{ width: 12, height: 12 }} />}
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "0 20px 8px" }}>
          <div style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 6, padding: "6px 10px", display: "flex", alignItems: "center", gap: 6 }}>
            <AlertTriangle style={{ width: 12, height: 12, color: "var(--error)", flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: "var(--error)" }}>{error}</span>
          </div>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 20px" }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <Loader2 style={{ width: 20, height: 20, color: "rgba(255,255,255,0.3)", animation: "spin 1s linear infinite" }} />
          </div>
        ) : (
          <>
            {/* Sandbox Containers */}
            <SectionHeader
              title="Sandbox Containers"
              icon={<Box style={{ width: 12, height: 12, color: "var(--text-muted)" }} />}
            />
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 16 }}>
              {sandbox.containers.length === 0 ? (
                <div style={{ padding: "14px 12px", textAlign: "center" }}>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: 0 }}>No active containers</p>
                </div>
              ) : (
                sandbox.containers.map((c, i) => (
                  <div
                    key={c.id}
                    style={{
                      padding: "10px 12px", display: "flex", alignItems: "center", gap: 10,
                      borderBottom: i < sandbox.containers.length - 1 ? "1px solid var(--border)" : "none",
                    }}
                  >
                    <Terminal style={{ width: 14, height: 14, color: "var(--accent)", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 12, color: "var(--text)", fontFamily: "monospace" }}>{c.name || c.id}</p>
                      {c.image && <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)" }}>{c.image}</p>}
                    </div>
                    <StatusBadge status={c.status} />
                  </div>
                ))
              )}
            </div>

            {/* Browser Instances */}
            <SectionHeader
              title="Browser Instances"
              icon={<Globe style={{ width: 12, height: 12, color: "var(--text-muted)" }} />}
            />
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 16 }}>
              {sandbox.browsers.length === 0 ? (
                <div style={{ padding: "14px 12px", textAlign: "center" }}>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: 0 }}>No active browsers</p>
                </div>
              ) : (
                sandbox.browsers.map((b, i) => (
                  <div
                    key={b.id}
                    style={{
                      padding: "10px 12px", display: "flex", alignItems: "center", gap: 10,
                      borderBottom: i < sandbox.browsers.length - 1 ? "1px solid var(--border)" : "none",
                    }}
                  >
                    <Globe style={{ width: 14, height: 14, color: "var(--accent)", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 12, color: "var(--text)", fontFamily: "monospace" }}>{b.id}</p>
                      {b.url && <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)" }}>{b.url}</p>}
                    </div>
                    <StatusBadge status={b.status} />
                  </div>
                ))
              )}
            </div>

            {/* Tool Permissions */}
            <SectionHeader
              title="Tool Permissions"
              icon={<Shield style={{ width: 12, height: 12, color: "var(--text-muted)" }} />}
            />
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 16 }}>
              {toolPermissions && Object.keys(toolPermissions).length > 0 ? (
                Object.entries(toolPermissions).map(([key, value], i, arr) => (
                  <div
                    key={key}
                    style={{
                      padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between",
                      borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none",
                    }}
                  >
                    <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text)" }}>{key}</span>
                    <PermissionValue value={value} />
                  </div>
                ))
              ) : (
                <div style={{ padding: "14px 12px", textAlign: "center" }}>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: 0 }}>No tool permissions configured</p>
                </div>
              )}
            </div>

            {/* Sandbox Policy */}
            <SectionHeader
              title="Sandbox Policy"
              icon={<Info style={{ width: 12, height: 12, color: "var(--text-muted)" }} />}
            />
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 16 }}>
              <button
                onClick={() => setShowPolicy(!showPolicy)}
                style={{ width: "100%", padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "none", border: "none", cursor: "pointer" }}
              >
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
                  {showPolicy ? "Hide" : "Show"} sandbox policy details
                </span>
                {showPolicy
                  ? <ChevronDown style={{ width: 12, height: 12, color: "var(--text-muted)" }} />
                  : <ChevronRight style={{ width: 12, height: 12, color: "var(--text-muted)" }} />}
              </button>
              {showPolicy && policy && (
                <div style={{ padding: "0 12px 12px" }}>
                  <pre style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.6)", fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                    {JSON.stringify(policy, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ title, icon }: { title: string; icon: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
      {icon}
      <p style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, margin: 0 }}>{title}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = status === "running" ? "#4ade80" : status === "stopped" ? "#f87171" : "#fbbf24";
  return (
    <span style={{ fontSize: 10, color, background: `${color}20`, padding: "2px 8px", borderRadius: 4, fontWeight: 500, textTransform: "lowercase" }}>
      {status}
    </span>
  );
}

function PermissionValue({ value }: { value: unknown }) {
  if (typeof value === "boolean") {
    return (
      <span style={{ fontSize: 11, color: value ? "var(--success)" : "var(--error)", fontFamily: "monospace" }}>
        {value ? "allowed" : "denied"}
      </span>
    );
  }
  if (Array.isArray(value)) {
    return (
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {value.map((v, i) => (
          <span key={i} style={{ fontSize: 10, color: "var(--accent)", background: "rgba(59,130,246,0.15)", padding: "2px 6px", borderRadius: 4, fontFamily: "monospace" }}>
            {String(v)}
          </span>
        ))}
      </div>
    );
  }
  return (
    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", fontFamily: "monospace" }}>
      {JSON.stringify(value)}
    </span>
  );
}
