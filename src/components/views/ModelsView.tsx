import { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2, RefreshCw, Star, Cloud, HardDrive, Check, AlertTriangle,
  Search, ChevronDown, ChevronUp, Cpu, Scan, Download, Trash2, Info,
  Play, Square, X, MemoryStick, Key,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { cachedCommand } from "@/lib/cache";
import { useAppStore } from "@/stores/appStore";

// ─── Types ─────────────────────────────────────────────────────

interface Model {
  key: string;
  name: string;
  local: boolean;
  available: boolean;
  tags: string[];
  contextWindow: number;
}

interface OllamaModel {
  name: string;
  id: string;
  size: string;
  sizeBytes: number;
  modified: string;
}

interface RunningModel {
  name: string;
  id: string;
  size: string;
  sizeBytes: number;
  processor: string;
  until: string;
}

type FilterMode = "all" | "local" | "cloud";
type TabId = "openclaw" | "ollama" | "running";

// ─── Helpers ───────────────────────────────────────────────────

function formatBytes(raw: string): { display: string; bytes: number } {
  const cleaned = raw.trim();
  const match = cleaned.match(/^([\d.]+)\s*(GB|MB|KB|B)?$/i);
  if (!match) return { display: cleaned, bytes: 0 };
  const val = parseFloat(match[1]);
  const unit = (match[2] || "B").toUpperCase();
  const multipliers: Record<string, number> = { B: 1, KB: 1024, MB: 1048576, GB: 1073741824 };
  return { display: `${val} ${unit}`, bytes: val * (multipliers[unit] || 1) };
}

function humanSize(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function parseOllamaList(stdout: string): OllamaModel[] {
  const lines = stdout.trim().split("\n");
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const colStarts: number[] = [];
  const headers = headerLine.match(/\S+/g) || [];
  for (const h of headers) {
    colStarts.push(headerLine.indexOf(h));
  }

  return lines.slice(1).filter((l) => l.trim()).map((line) => {
    const cols: string[] = [];
    for (let i = 0; i < colStarts.length; i++) {
      const start = colStarts[i];
      const end = i + 1 < colStarts.length ? colStarts[i + 1] : line.length;
      cols.push(line.substring(start, end).trim());
    }
    const name = cols[0] || "";
    const id = cols[1] || "";
    const sizeRaw = cols[2] || "0 B";
    const modified = cols[3] || "";
    const { display, bytes } = formatBytes(sizeRaw);
    return { name, id, size: display, sizeBytes: bytes, modified };
  });
}

function parseOllamaPs(stdout: string): RunningModel[] {
  const lines = stdout.trim().split("\n");
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const colStarts: number[] = [];
  const headers = headerLine.match(/\S+/g) || [];
  for (const h of headers) {
    colStarts.push(headerLine.indexOf(h));
  }

  return lines.slice(1).filter((l) => l.trim()).map((line) => {
    const cols: string[] = [];
    for (let i = 0; i < colStarts.length; i++) {
      const start = colStarts[i];
      const end = i + 1 < colStarts.length ? colStarts[i + 1] : line.length;
      cols.push(line.substring(start, end).trim());
    }
    const name = cols[0] || "";
    const id = cols[1] || "";
    const sizeRaw = cols[2] || "0 B";
    const processor = cols[3] || "";
    const until = cols[4] || "";
    const { display, bytes } = formatBytes(sizeRaw);
    return { name, id, size: display, sizeBytes: bytes, processor, until };
  });
}

// ─── Main Component ────────────────────────────────────────────

export function ModelsView() {
  const [activeTab, setActiveTab] = useState<TabId>("openclaw");

  const tabs: { id: TabId; label: string }[] = [
    { id: "openclaw", label: "OpenClaw Models" },
    { id: "ollama", label: "Ollama Library" },
    { id: "running", label: "Running" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{
        display: "flex", gap: 2, padding: "12px 20px 0", flexShrink: 0,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "8px 16px", border: "none", cursor: "pointer",
              fontSize: 11, fontWeight: 500, borderRadius: "6px 6px 0 0",
              background: activeTab === tab.id ? "rgba(255,255,255,0.05)" : "transparent",
              color: activeTab === tab.id ? "white" : "rgba(255,255,255,0.4)",
              borderBottom: activeTab === tab.id ? "2px solid #3B82F6" : "2px solid transparent",
              transition: "all 0.15s ease",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "hidden" }}>
        {activeTab === "openclaw" && <OpenClawTab />}
        {activeTab === "ollama" && <OllamaTab />}
        {activeTab === "running" && <RunningTab />}
      </div>
    </div>
  );
}

// ─── OpenClaw Tab (preserved original) ─────────────────────────

function OpenClawTab() {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settingDefault, setSettingDefault] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [scanning, setScanning] = useState(false);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [authing, setAuthing] = useState(false);
  const [authOutput, setAuthOutput] = useState<string | null>(null);

  const loadModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await cachedCommand("npx openclaw models list --json", { ttl: 30_000 });
      if (result.code !== 0) {
        setError(result.stderr || "Failed to list models");
        setModels([]);
      } else {
        const data = JSON.parse(result.stdout);
        setModels(data.models || []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load models");
      setModels([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadModels(); }, [loadModels]);

  const scanAll = async () => {
    setScanning(true);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "npx openclaw models list --all --json",
        cwd: null,
      });
      if (result.code === 0) {
        const data = JSON.parse(result.stdout);
        setModels(data.models || []);
      }
    } catch { /* ignore */ }
    setScanning(false);
  };

  const setDefault = async (key: string) => {
    setSettingDefault(key);
    try {
      await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `npx openclaw models set ${key}`,
        cwd: null,
      });
      await loadModels();
    } catch { /* ignore */ }
    setSettingDefault(null);
  };

  const modelsAuth = async () => {
    setAuthing(true);
    setAuthOutput(null);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "npx openclaw models auth --json",
        cwd: null,
      });
      setAuthOutput(result.code === 0 ? result.stdout.trim() : (result.stderr || "Auth check failed"));
    } catch (e) {
      setAuthOutput(e instanceof Error ? e.message : "Failed");
    }
    setAuthing(false);
  };

  const defaultModel = models.find((m) => m.tags.includes("default"));

  const filtered = models.filter((m) => {
    if (filterMode === "local" && !m.local) return false;
    if (filterMode === "cloud" && m.local) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return m.key.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
  });

  const providers = [...new Set(filtered.map((m) => m.key.split("/")[0]))].sort();

  const toggleProvider = (p: string) => {
    setExpandedProvider(expandedProvider === p ? null : p);
  };

  const formatContext = (tokens: number) => {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
    return `${tokens}`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "14px 20px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ color: "white", fontSize: 15, fontWeight: 600, margin: 0 }}>Models</h2>
            <p style={{ margin: "2px 0 0", fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
              {models.length} configured &middot; {models.filter((m) => m.available).length} available
            </p>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={scanAll}
              disabled={scanning}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
                borderRadius: 6, border: "none", fontSize: 10, cursor: "pointer",
                background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)",
              }}
            >
              <Scan style={{ width: 10, height: 10 }} />
              Scan All
            </button>
            <button
              onClick={loadModels}
              disabled={loading}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
                borderRadius: 6, border: "none", fontSize: 10, cursor: "pointer",
                background: "rgba(59,130,246,0.15)", color: "#60a5fa",
              }}
            >
              <RefreshCw style={{ width: 10, height: 10 }} />
              Refresh
            </button>
            <button
              onClick={modelsAuth}
              disabled={authing}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
                borderRadius: 6, border: "none", fontSize: 10, cursor: "pointer",
                background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)",
              }}
            >
              <Key style={{ width: 10, height: 10 }} />
              Auth
            </button>
          </div>
        </div>

        {defaultModel && (
          <div style={{
            marginTop: 10, padding: "8px 12px", borderRadius: 8,
            background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <Star style={{ width: 14, height: 14, color: "#3B82F6", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Default Model</span>
              <p style={{ margin: "1px 0 0", fontSize: 12, color: "white", fontFamily: "monospace" }}>
                {defaultModel.key}
              </p>
            </div>
            {defaultModel.local ? (
              <HardDrive style={{ width: 12, height: 12, color: "#4ade80", flexShrink: 0 }} />
            ) : (
              <Cloud style={{ width: 12, height: 12, color: "#60a5fa", flexShrink: 0 }} />
            )}
          </div>
        )}

        {authOutput && (
          <div style={{
            marginTop: 8, padding: "8px 12px", borderRadius: 8,
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 0.5 }}>Auth Status</span>
              <button onClick={() => setAuthOutput(null)} style={{
                background: "none", border: "none", cursor: "pointer", padding: 2,
              }}>
                <X style={{ width: 10, height: 10, color: "rgba(255,255,255,0.3)" }} />
              </button>
            </div>
            <pre style={{
              margin: 0, fontSize: 10, color: "rgba(255,255,255,0.55)",
              fontFamily: "monospace", whiteSpace: "pre-wrap", lineHeight: 1.5,
              maxHeight: 100, overflowY: "auto",
            }}>
              {authOutput}
            </pre>
          </div>
        )}

        <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search style={{
              position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
              width: 14, height: 14, color: "rgba(255,255,255,0.4)",
            }} />
            <input
              type="text"
              placeholder="Search models..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%", padding: "7px 12px 7px 32px", borderRadius: 8,
                background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                color: "white", fontSize: 12, outline: "none",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 2 }}>
            {(["all", "local", "cloud"] as FilterMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                style={{
                  padding: "5px 10px", borderRadius: 6, border: "none",
                  fontSize: 10, cursor: "pointer", textTransform: "capitalize",
                  background: filterMode === mode ? "rgba(59,130,246,0.18)" : "rgba(255,255,255,0.04)",
                  color: filterMode === mode ? "#3B82F6" : "rgba(255,255,255,0.5)",
                }}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "0 20px 16px" }}>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
            <Loader2 style={{ width: 24, height: 24, color: "#3B82F6", animation: "modSpin 1s linear infinite" }} />
            <style>{`@keyframes modSpin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : error ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 8 }}>
            <AlertTriangle style={{ width: 24, height: 24, color: "#f87171" }} />
            <p style={{ fontSize: 12, color: "#f87171", textAlign: "center" }}>{error}</p>
            <button onClick={loadModels} style={{
              padding: "4px 12px", borderRadius: 6, border: "none",
              background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)",
              fontSize: 11, cursor: "pointer",
            }}>
              Retry
            </button>
          </div>
        ) : providers.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 8 }}>
            <Cpu style={{ width: 28, height: 28, color: "rgba(255,255,255,0.15)" }} />
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>No models found</p>
          </div>
        ) : (
          providers.map((provider) => {
            const providerModels = filtered.filter((m) => m.key.split("/")[0] === provider);
            const isExpanded = expandedProvider === null || expandedProvider === provider;
            return (
              <div key={provider} style={{ marginBottom: 12 }}>
                <button
                  onClick={() => toggleProvider(provider)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, marginBottom: 6,
                    background: "none", border: "none", cursor: "pointer", padding: 0,
                  }}
                >
                  {isExpanded
                    ? <ChevronDown style={{ width: 12, height: 12, color: "rgba(255,255,255,0.3)" }} />
                    : <ChevronUp style={{ width: 12, height: 12, color: "rgba(255,255,255,0.3)" }} />
                  }
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 500, textTransform: "capitalize" }}>
                    {provider}
                  </span>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>
                    ({providerModels.length})
                  </span>
                </button>
                {isExpanded && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {providerModels.map((model) => (
                      <OpenClawModelCard
                        key={model.key}
                        model={model}
                        isDefault={model.tags.includes("default")}
                        settingDefault={settingDefault === model.key}
                        onSetDefault={() => setDefault(model.key)}
                        formatContext={formatContext}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function OpenClawModelCard({ model, isDefault, settingDefault, onSetDefault, formatContext }: {
  model: Model; isDefault: boolean; settingDefault: boolean;
  onSetDefault: () => void; formatContext: (n: number) => string;
}) {
  return (
    <div style={{
      background: isDefault ? "rgba(59,130,246,0.06)" : "rgba(255,255,255,0.04)",
      border: `1px solid ${isDefault ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.08)"}`,
      borderRadius: 10, padding: "10px 12px",
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8, display: "flex",
        alignItems: "center", justifyContent: "center", flexShrink: 0,
        background: model.local ? "rgba(74,222,128,0.1)" : "rgba(96,165,250,0.1)",
      }}>
        {model.local
          ? <HardDrive style={{ width: 14, height: 14, color: "#4ade80" }} />
          : <Cloud style={{ width: 14, height: 14, color: "#60a5fa" }} />
        }
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "white", fontWeight: 500, fontFamily: "monospace" }}>
            {model.name}
          </span>
          {isDefault && (
            <span style={{
              fontSize: 8, padding: "1px 5px", borderRadius: 4,
              background: "rgba(59,130,246,0.18)", color: "#3B82F6", fontWeight: 600,
            }}>
              DEFAULT
            </span>
          )}
          {!model.available && (
            <span style={{
              fontSize: 8, padding: "1px 5px", borderRadius: 4,
              background: "rgba(248,113,113,0.12)", color: "#f87171",
            }}>
              UNAVAILABLE
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>
            {model.key}
          </span>
          {model.contextWindow > 0 && (
            <span style={{
              fontSize: 9, padding: "1px 5px", borderRadius: 3,
              background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.45)",
            }}>
              {formatContext(model.contextWindow)} ctx
            </span>
          )}
          <span style={{
            fontSize: 9, padding: "1px 5px", borderRadius: 3,
            background: model.local ? "rgba(74,222,128,0.08)" : "rgba(96,165,250,0.08)",
            color: model.local ? "#4ade80" : "#60a5fa",
          }}>
            {model.local ? "local" : "cloud"}
          </span>
        </div>
      </div>

      {!isDefault && (
        <button
          onClick={onSetDefault}
          disabled={settingDefault}
          style={{
            padding: "5px 10px", borderRadius: 6, border: "none",
            background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)",
            fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
            opacity: settingDefault ? 0.5 : 1, flexShrink: 0,
          }}
        >
          {settingDefault ? (
            <Loader2 style={{ width: 10, height: 10, animation: "modSpin 1s linear infinite" }} />
          ) : (
            <Check style={{ width: 10, height: 10 }} />
          )}
          Set Default
        </button>
      )}
    </div>
  );
}

// ─── Ollama Library Tab ────────────────────────────────────────

function OllamaTab() {
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pullInput, setPullInput] = useState("");
  const [pulling, setPulling] = useState(false);
  const [pullOutput, setPullOutput] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [detailModel, setDetailModel] = useState<string | null>(null);
  const [detailText, setDetailText] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const loadModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "ollama list",
        cwd: null,
      });
      if (result.code !== 0) {
        setError(result.stderr || "Failed to list Ollama models. Is Ollama running?");
        setModels([]);
      } else {
        setModels(parseOllamaList(result.stdout));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect to Ollama");
      setModels([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadModels(); }, [loadModels]);

  const pullModel = async () => {
    const name = pullInput.trim();
    if (!name) return;
    setPulling(true);
    setPullOutput("Pulling " + name + "...");
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `ollama pull ${name}`,
        cwd: null,
      });
      if (result.code === 0) {
        setPullOutput("Successfully pulled " + name);
        setPullInput("");
        await loadModels();
      } else {
        setPullOutput(result.stderr || "Pull failed");
      }
    } catch (e) {
      setPullOutput(e instanceof Error ? e.message : "Pull failed");
    }
    setPulling(false);
  };

  const deleteModel = async (name: string) => {
    setDeleting(name);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `ollama rm ${name}`,
        cwd: null,
      });
      if (result.code === 0) {
        await loadModels();
      }
    } catch { /* ignore */ }
    setDeleting(null);
    setDeleteConfirm(null);
  };

  const showDetail = async (name: string) => {
    if (detailModel === name) { setDetailModel(null); return; }
    setDetailModel(name);
    setDetailLoading(true);
    setDetailText(null);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `ollama show ${name}`,
        cwd: null,
      });
      setDetailText(result.code === 0 ? result.stdout : (result.stderr || "Failed to get details"));
    } catch (e) {
      setDetailText(e instanceof Error ? e.message : "Failed");
    }
    setDetailLoading(false);
  };

  const setAsOpenClawDefault = async (name: string) => {
    try {
      await invoke<{ stdout: string; code: number }>("execute_command", {
        command: `npx openclaw models set ollama/${name}`,
        cwd: null,
      });
    } catch { /* ignore */ }
  };

  const maxSize = Math.max(...models.map((m) => m.sizeBytes), 1);

  const filtered = models.filter((m) => {
    if (!searchQuery) return true;
    return m.name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "14px 20px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ color: "white", fontSize: 15, fontWeight: 600, margin: 0 }}>Ollama Library</h2>
            <p style={{ margin: "2px 0 0", fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
              {models.length} local model{models.length !== 1 ? "s" : ""} &middot;{" "}
              {humanSize(models.reduce((a, m) => a + m.sizeBytes, 0))} total
            </p>
          </div>
          <button
            onClick={loadModels}
            disabled={loading}
            style={{
              display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
              borderRadius: 6, border: "none", fontSize: 10, cursor: "pointer",
              background: "rgba(59,130,246,0.15)", color: "#60a5fa",
            }}
          >
            <RefreshCw style={{ width: 10, height: 10 }} />
            Refresh
          </button>
        </div>

        <div style={{
          display: "flex", gap: 6, marginTop: 10, alignItems: "center",
        }}>
          <div style={{
            display: "flex", flex: 1, gap: 6, alignItems: "center",
            background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8, padding: "3px 4px 3px 10px",
          }}>
            <Download style={{ width: 12, height: 12, color: "rgba(255,255,255,0.4)", flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Pull model (e.g. llama3:70b)..."
              value={pullInput}
              onChange={(e) => setPullInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && pullModel()}
              style={{
                flex: 1, border: "none", background: "transparent",
                color: "white", fontSize: 12, outline: "none", padding: "4px 0",
              }}
            />
            <button
              onClick={pullModel}
              disabled={pulling || !pullInput.trim()}
              style={{
                padding: "4px 12px", borderRadius: 6, border: "none",
                background: pulling ? "rgba(59,130,246,0.1)" : "rgba(59,130,246,0.2)",
                color: "#60a5fa", fontSize: 10, cursor: "pointer", fontWeight: 600,
                opacity: !pullInput.trim() ? 0.4 : 1,
              }}
            >
              {pulling ? "Pulling..." : "Pull"}
            </button>
          </div>
        </div>

        {pullOutput && (
          <div style={{
            marginTop: 8, padding: "6px 10px", borderRadius: 6,
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", flex: 1 }}>
              {pullOutput}
            </span>
            <button
              onClick={() => setPullOutput(null)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}
            >
              <X style={{ width: 10, height: 10, color: "rgba(255,255,255,0.3)" }} />
            </button>
          </div>
        )}

        {models.length > 4 && (
          <div style={{ position: "relative", marginTop: 8 }}>
            <Search style={{
              position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
              width: 14, height: 14, color: "rgba(255,255,255,0.4)",
            }} />
            <input
              type="text"
              placeholder="Filter models..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%", padding: "7px 12px 7px 32px", borderRadius: 8,
                background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                color: "white", fontSize: 12, outline: "none",
              }}
            />
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "0 20px 16px" }}>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
            <Loader2 style={{ width: 24, height: 24, color: "#3B82F6", animation: "modSpin 1s linear infinite" }} />
            <style>{`@keyframes modSpin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : error ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 8 }}>
            <AlertTriangle style={{ width: 24, height: 24, color: "#f87171" }} />
            <p style={{ fontSize: 12, color: "#f87171", textAlign: "center" }}>{error}</p>
            <button onClick={loadModels} style={{
              padding: "4px 12px", borderRadius: 6, border: "none",
              background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)",
              fontSize: 11, cursor: "pointer",
            }}>
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 8 }}>
            <Cpu style={{ width: 28, height: 28, color: "rgba(255,255,255,0.15)" }} />
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
              {models.length === 0 ? "No Ollama models installed" : "No matching models"}
            </p>
            {models.length === 0 && (
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
                Pull a model above to get started
              </p>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {filtered.map((model) => (
              <div key={model.name}>
                <div style={{
                  background: detailModel === model.name ? "rgba(59,130,246,0.06)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${detailModel === model.name ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.06)"}`,
                  borderRadius: detailModel === model.name ? "10px 10px 0 0" : 10,
                  padding: "10px 12px",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 8, display: "flex",
                      alignItems: "center", justifyContent: "center", flexShrink: 0,
                      background: "rgba(74,222,128,0.1)",
                    }}>
                      <HardDrive style={{ width: 14, height: 14, color: "#4ade80" }} />
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12, color: "white", fontWeight: 500, fontFamily: "monospace" }}>
                        {model.name}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
                        <span style={{
                          fontSize: 9, padding: "1px 5px", borderRadius: 3,
                          background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.45)",
                        }}>
                          {model.size}
                        </span>
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>
                          {model.id.substring(0, 12)}
                        </span>
                        {model.modified && (
                          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>
                            {model.modified}
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      <button
                        onClick={() => showDetail(model.name)}
                        style={{
                          padding: "5px 8px", borderRadius: 6, border: "none",
                          background: detailModel === model.name ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.06)",
                          color: detailModel === model.name ? "#60a5fa" : "rgba(255,255,255,0.5)",
                          fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center",
                        }}
                      >
                        <Info style={{ width: 11, height: 11 }} />
                      </button>
                      {deleteConfirm === model.name ? (
                        <div style={{ display: "flex", gap: 3 }}>
                          <button
                            onClick={() => deleteModel(model.name)}
                            disabled={deleting === model.name}
                            style={{
                              padding: "5px 8px", borderRadius: 6, border: "none",
                              background: "rgba(248,113,113,0.15)", color: "#f87171",
                              fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 3,
                              opacity: deleting === model.name ? 0.5 : 1,
                            }}
                          >
                            {deleting === model.name ? (
                              <Loader2 style={{ width: 10, height: 10, animation: "modSpin 1s linear infinite" }} />
                            ) : (
                              <Check style={{ width: 10, height: 10 }} />
                            )}
                            Confirm
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            style={{
                              padding: "5px 6px", borderRadius: 6, border: "none",
                              background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)",
                              fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center",
                            }}
                          >
                            <X style={{ width: 10, height: 10 }} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(model.name)}
                          style={{
                            padding: "5px 8px", borderRadius: 6, border: "none",
                            background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)",
                            fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center",
                          }}
                        >
                          <Trash2 style={{ width: 11, height: 11 }} />
                        </button>
                      )}
                      <button
                        onClick={() => setAsOpenClawDefault(model.name)}
                        title="Set as OpenClaw default model"
                        style={{
                          padding: "5px 8px", borderRadius: 6, border: "none",
                          background: "rgba(74,222,128,0.1)", color: "#4ade80",
                          fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center",
                        }}
                      >
                        <Star style={{ width: 11, height: 11 }} />
                      </button>
                    </div>
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <div style={{
                      height: 6, borderRadius: 3, background: "rgba(255,255,255,0.04)", overflow: "hidden",
                    }}>
                      <div style={{
                        height: "100%", borderRadius: 3,
                        width: `${Math.min((model.sizeBytes / maxSize) * 100, 100)}%`,
                        background: "linear-gradient(90deg, #3B82F6, #60a5fa)",
                        transition: "width 0.4s ease",
                      }} />
                    </div>
                  </div>
                </div>

                {detailModel === model.name && (
                  <div style={{
                    background: "rgba(255,255,255,0.02)", padding: "10px 12px",
                    border: "1px solid rgba(59,130,246,0.15)", borderTop: "none",
                    borderRadius: "0 0 10px 10px",
                  }}>
                    {detailLoading ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: 8 }}>
                        <Loader2 style={{ width: 12, height: 12, color: "#3B82F6", animation: "modSpin 1s linear infinite" }} />
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Loading details...</span>
                      </div>
                    ) : (
                      <pre style={{
                        margin: 0, fontSize: 10, color: "rgba(255,255,255,0.55)",
                        fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all",
                        maxHeight: 200, overflowY: "auto", lineHeight: 1.5,
                      }}>
                        {detailText}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Running Tab ───────────────────────────────────────────────

function RunningTab() {
  const [models, setModels] = useState<RunningModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentView = useAppStore(s => s.currentView);
  const isVisible = currentView === "models";

  const loadRunning = useCallback(async () => {
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "ollama ps",
        cwd: null,
      });
      if (result.code !== 0) {
        setError(result.stderr || "Failed to query running models");
        setModels([]);
      } else {
        setModels(parseOllamaPs(result.stdout));
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect to Ollama");
      setModels([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    loadRunning();
    const id = setInterval(loadRunning, 5000);
    return () => clearInterval(id);
  }, [loadRunning, isVisible]);

  const totalVram = models.reduce((a, m) => a + m.sizeBytes, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "14px 20px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ color: "white", fontSize: 15, fontWeight: 600, margin: 0 }}>Running Models</h2>
            <p style={{ margin: "2px 0 0", fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
              {models.length} loaded &middot; {humanSize(totalVram)} VRAM in use
            </p>
          </div>
          <button
            onClick={() => { setLoading(true); loadRunning(); }}
            disabled={loading}
            style={{
              display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
              borderRadius: 6, border: "none", fontSize: 10, cursor: "pointer",
              background: "rgba(59,130,246,0.15)", color: "#60a5fa",
            }}
          >
            <RefreshCw style={{ width: 10, height: 10 }} />
            Refresh
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "0 20px 16px" }}>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
            <Loader2 style={{ width: 24, height: 24, color: "#3B82F6", animation: "modSpin 1s linear infinite" }} />
            <style>{`@keyframes modSpin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : error ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 8 }}>
            <AlertTriangle style={{ width: 24, height: 24, color: "#f87171" }} />
            <p style={{ fontSize: 12, color: "#f87171", textAlign: "center" }}>{error}</p>
          </div>
        ) : models.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 8 }}>
            <Square style={{ width: 28, height: 28, color: "rgba(255,255,255,0.15)" }} />
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>No models currently loaded</p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
              Models load automatically when queried
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {models.map((model) => (
              <div key={model.name + model.id} style={{
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 10, padding: "10px 12px",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8, display: "flex",
                    alignItems: "center", justifyContent: "center", flexShrink: 0,
                    background: "rgba(59,130,246,0.1)",
                  }}>
                    <Play style={{ width: 14, height: 14, color: "#3B82F6" }} />
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 12, color: "white", fontWeight: 500, fontFamily: "monospace" }}>
                      {model.name}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>
                        {model.id.substring(0, 12)}
                      </span>
                      {model.processor && (
                        <span style={{
                          fontSize: 9, padding: "1px 5px", borderRadius: 3,
                          background: "rgba(59,130,246,0.1)", color: "#60a5fa",
                        }}>
                          {model.processor}
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <MemoryStick style={{ width: 10, height: 10, color: "rgba(255,255,255,0.4)" }} />
                      <span style={{ fontSize: 11, color: "white", fontWeight: 500, fontFamily: "monospace" }}>
                        {model.size}
                      </span>
                    </div>
                    {model.until && (
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>
                        until {model.until}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {models.length > 1 && (
              <div style={{
                marginTop: 8, padding: "10px 12px", borderRadius: 10,
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)",
              }}>
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6,
                }}>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>VRAM Distribution</span>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}>
                    {humanSize(totalVram)}
                  </span>
                </div>
                <div style={{
                  display: "flex", height: 6, borderRadius: 3, overflow: "hidden", gap: 1,
                }}>
                  {models.map((m, i) => {
                    const colors = ["#3B82F6", "#4ade80", "#fbbf24", "#f87171", "#a78bfa"];
                    return (
                      <div
                        key={m.name + m.id}
                        style={{
                          flex: m.sizeBytes,
                          background: colors[i % colors.length],
                          borderRadius: 2,
                          transition: "flex 0.4s ease",
                        }}
                        title={`${m.name}: ${m.size}`}
                      />
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                  {models.map((m, i) => {
                    const colors = ["#3B82F6", "#4ade80", "#fbbf24", "#f87171", "#a78bfa"];
                    return (
                      <div key={m.name + m.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <div style={{
                          width: 6, height: 6, borderRadius: 2,
                          background: colors[i % colors.length],
                        }} />
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>
                          {m.name.split(":")[0]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
