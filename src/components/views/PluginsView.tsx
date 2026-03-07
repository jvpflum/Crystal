import { useState, useEffect, useCallback } from "react";
import {
  Puzzle,
  Plus,
  Trash2,
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Info,
  Stethoscope,
  ChevronUp,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface Plugin {
  name: string;
  version?: string;
  description?: string;
  enabled: boolean;
  author?: string;
}

interface DoctorResult {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
}

export function PluginsView() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [installSpec, setInstallSpec] = useState("");
  const [installing, setInstalling] = useState(false);
  const [uninstallingName, setUninstallingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doctorResults, setDoctorResults] = useState<DoctorResult[] | null>(null);
  const [runningDoctor, setRunningDoctor] = useState(false);
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);
  const [pluginInfo, setPluginInfo] = useState<Record<string, Record<string, unknown>>>({});
  const [loadingInfo, setLoadingInfo] = useState<string | null>(null);

  const loadPlugins = useCallback(async () => {
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "npx openclaw plugins list --json",
        cwd: null,
      });
      if (result.code === 0 && result.stdout.trim()) {
        const parsed = JSON.parse(result.stdout);
        setPlugins(Array.isArray(parsed) ? parsed : parsed.plugins ?? []);
      } else {
        setPlugins([]);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load plugins");
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadPlugins();
      setLoading(false);
    })();
  }, [loadPlugins]);

  const togglePlugin = async (plugin: Plugin) => {
    const cmd = plugin.enabled ? "disable" : "enable";
    await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
      command: `npx openclaw plugins ${cmd} ${plugin.name}`,
      cwd: null,
    });
    setPlugins((prev) => prev.map((p) => (p.name === plugin.name ? { ...p, enabled: !p.enabled } : p)));
  };

  const installPlugin = async () => {
    if (!installSpec.trim()) return;
    setInstalling(true);
    setError(null);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `npx openclaw plugins install ${installSpec.trim()}`,
        cwd: null,
      });
      if (result.code === 0) {
        setInstallSpec("");
        await loadPlugins();
      } else {
        setError(result.stderr || "Failed to install plugin");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Install failed");
    }
    setInstalling(false);
  };

  const uninstallPlugin = async (name: string) => {
    setUninstallingName(name);
    try {
      await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `npx openclaw plugins uninstall ${name}`,
        cwd: null,
      });
      setPlugins((prev) => prev.filter((p) => p.name !== name));
      if (expandedPlugin === name) setExpandedPlugin(null);
    } catch {
      setError(`Failed to uninstall ${name}`);
    }
    setUninstallingName(null);
  };

  const runDoctor = async () => {
    setRunningDoctor(true);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "npx openclaw plugins doctor",
        cwd: null,
      });
      if (result.stdout.trim()) {
        try {
          const parsed = JSON.parse(result.stdout);
          setDoctorResults(Array.isArray(parsed) ? parsed : parsed.results ?? []);
        } catch {
          setDoctorResults([{ name: "Doctor", status: result.code === 0 ? "ok" : "warn", message: result.stdout.trim() }]);
        }
      }
    } catch (e) {
      setDoctorResults([{ name: "Error", status: "error", message: e instanceof Error ? e.message : "Doctor failed" }]);
    }
    setRunningDoctor(false);
  };

  const fetchPluginInfo = async (name: string) => {
    if (expandedPlugin === name) {
      setExpandedPlugin(null);
      return;
    }
    setExpandedPlugin(name);
    if (pluginInfo[name]) return;
    setLoadingInfo(name);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `npx openclaw plugins info ${name}`,
        cwd: null,
      });
      if (result.stdout.trim()) {
        try {
          setPluginInfo((prev) => ({ ...prev, [name]: JSON.parse(result.stdout) }));
        } catch {
          setPluginInfo((prev) => ({ ...prev, [name]: { raw: result.stdout.trim() } }));
        }
      }
    } catch {
      /* info is optional */
    }
    setLoadingInfo(null);
  };

  const refresh = async () => {
    setLoading(true);
    await loadPlugins();
    setLoading(false);
  };

  const statusIcon = (s: string) => {
    if (s === "ok") return <CheckCircle style={{ width: 13, height: 13, color: "#4ade80", flexShrink: 0 }} />;
    if (s === "warn") return <AlertTriangle style={{ width: 13, height: 13, color: "#fbbf24", flexShrink: 0 }} />;
    return <XCircle style={{ width: 13, height: 13, color: "#f87171", flexShrink: 0 }} />;
  };

  const statusColor = (s: string) => {
    if (s === "ok") return "#4ade80";
    if (s === "warn") return "#fbbf24";
    return "#f87171";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "14px 20px 10px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ color: "white", fontSize: 15, fontWeight: 600, margin: 0 }}>Plugins</h2>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={runDoctor} disabled={runningDoctor} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.6)", fontSize: 11, cursor: "pointer" }}>
            {runningDoctor ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <Stethoscope style={{ width: 12, height: 12 }} />}
            Doctor
          </button>
          <button onClick={refresh} disabled={loading} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 6, border: "none", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)", fontSize: 11, cursor: "pointer" }}>
            <RefreshCw style={{ width: 12, height: 12 }} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "0 20px 20px" }}>
        {error && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", marginBottom: 12 }}>
            <AlertTriangle style={{ width: 14, height: 14, color: "#f87171", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "#f87171", flex: 1 }}>{error}</span>
            <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", fontSize: 14, cursor: "pointer" }}>×</button>
          </div>
        )}

        {/* Install */}
        <div style={{ marginBottom: 16 }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 500, display: "block", marginBottom: 6 }}>Install Plugin</span>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={installSpec}
              onChange={(e) => setInstallSpec(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && installPlugin()}
              placeholder="package-name or github:user/repo"
              style={{ flex: 1, padding: "7px 10px", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "white", fontSize: 12 }}
            />
            <button onClick={installPlugin} disabled={installing || !installSpec.trim()} style={{ display: "flex", alignItems: "center", gap: 4, padding: "7px 14px", borderRadius: 8, border: "none", background: "#3B82F6", color: "white", fontSize: 11, cursor: "pointer", opacity: installing || !installSpec.trim() ? 0.5 : 1, flexShrink: 0 }}>
              {installing ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <Plus style={{ width: 12, height: 12 }} />}
              Install
            </button>
          </div>
        </div>

        {/* Plugin list */}
        <div style={{ marginBottom: 16 }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 500, display: "block", marginBottom: 6 }}>
            Installed {!loading && `(${plugins.length})`}
          </span>

          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
              <Loader2 style={{ width: 20, height: 20, color: "rgba(255,255,255,0.3)" }} className="animate-spin" />
            </div>
          ) : plugins.length === 0 ? (
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "24px 16px", textAlign: "center" }}>
              <Puzzle style={{ width: 28, height: 28, color: "rgba(255,255,255,0.12)", margin: "0 auto 8px" }} />
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: 0 }}>No plugins installed</p>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", margin: "4px 0 0" }}>Install a plugin to extend OpenClaw's capabilities</p>
            </div>
          ) : (
            <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, overflow: "hidden" }}>
              {plugins.map((plugin, i) => (
                <div key={plugin.name}>
                  <div
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                      borderBottom: (i < plugins.length - 1 || expandedPlugin === plugin.name) ? "1px solid rgba(255,255,255,0.07)" : "none",
                      opacity: plugin.enabled ? 1 : 0.5,
                    }}
                  >
                    <Puzzle style={{ width: 14, height: 14, color: plugin.enabled ? "#3B82F6" : "rgba(255,255,255,0.3)", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 500, color: "white" }}>{plugin.name}</span>
                        {plugin.version && (
                          <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)", border: "1px solid rgba(255,255,255,0.08)" }}>
                            v{plugin.version}
                          </span>
                        )}
                      </div>
                      {plugin.description && (
                        <p style={{ margin: 0, fontSize: 10, color: "rgba(255,255,255,0.45)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {plugin.description}
                        </p>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => fetchPluginInfo(plugin.name)}
                        title="Info"
                        style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.5)" }}
                      >
                        {loadingInfo === plugin.name
                          ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" />
                          : expandedPlugin === plugin.name
                            ? <ChevronUp style={{ width: 12, height: 12 }} />
                            : <Info style={{ width: 12, height: 12 }} />}
                      </button>
                      <button
                        onClick={() => uninstallPlugin(plugin.name)}
                        disabled={uninstallingName === plugin.name}
                        title="Uninstall"
                        style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid rgba(248,113,113,0.15)", background: "rgba(248,113,113,0.06)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#f87171" }}
                      >
                        {uninstallingName === plugin.name
                          ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" />
                          : <Trash2 style={{ width: 12, height: 12 }} />}
                      </button>
                      <ToggleSwitch enabled={plugin.enabled} onToggle={() => togglePlugin(plugin)} />
                    </div>
                  </div>

                  {expandedPlugin === plugin.name && (
                    <div style={{ padding: "10px 14px 10px 38px", background: "rgba(0,0,0,0.15)", borderBottom: i < plugins.length - 1 ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
                      {pluginInfo[plugin.name] ? (
                        <pre style={{ margin: 0, fontSize: 10, color: "rgba(255,255,255,0.6)", fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {typeof pluginInfo[plugin.name].raw === "string"
                            ? (pluginInfo[plugin.name].raw as string)
                            : JSON.stringify(pluginInfo[plugin.name], null, 2)}
                        </pre>
                      ) : (
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>No additional info available</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Doctor results */}
        {doctorResults && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 500 }}>Health Check</span>
              <button onClick={() => setDoctorResults(null)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", fontSize: 11, cursor: "pointer" }}>
                Dismiss
              </button>
            </div>
            <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, overflow: "hidden" }}>
              {doctorResults.map((item, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 14px", borderBottom: i < doctorResults.length - 1 ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
                  {statusIcon(item.status)}
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 500, color: statusColor(item.status), display: "block" }}>{item.name}</span>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{item.message}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ToggleSwitch({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} style={{ width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer", position: "relative", background: enabled ? "#3B82F6" : "rgba(255,255,255,0.15)", transition: "background 0.2s", flexShrink: 0 }}>
      <span style={{ position: "absolute", top: 2, left: enabled ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "white", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
    </button>
  );
}
