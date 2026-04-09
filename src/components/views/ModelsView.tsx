import { useState, useEffect, useCallback } from "react";
import {
  Loader2, RefreshCw, Star, Cloud, HardDrive, Check, AlertTriangle,
  Search, ChevronDown, Cpu, Download, Trash2, X, MemoryStick, Play,
  ScanSearch, ShieldCheck, Brain, Plus, Minus, KeyRound,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { cachedCommand } from "@/lib/cache";
import { openclawClient } from "@/lib/openclaw";
import { useAppStore } from "@/stores/appStore";
import { EASE, MONO, innerPanel, emptyState, scrollArea, hoverLift, hoverReset, pressDown, pressUp, sectionLabel } from "@/styles/viewStyles";

interface Model {
  key: string;
  name: string;
  local: boolean;
  available: boolean;
  tags: string[];
  contextWindow: number;
}

interface ProviderStatus {
  provider: string;
  configured: boolean;
  authenticated: boolean;
  error?: string;
}

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
type ThinkingLevel = typeof THINKING_LEVELS[number];

interface RunningModel {
  name: string;
  size: string;
  sizeBytes: number;
  processor: string;
}

function humanSize(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function formatContext(tokens: number) {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return `${tokens}`;
}

function parseOllamaTable(stdout: string): { cols: string[][] } {
  const lines = stdout.trim().split("\n");
  if (lines.length < 2) return { cols: [] };
  const headerLine = lines[0];
  const colStarts: number[] = [];
  const headers = headerLine.match(/\S+/g) || [];
  for (const h of headers) colStarts.push(headerLine.indexOf(h));
  const rows = lines.slice(1).filter(l => l.trim()).map(line => {
    const cells: string[] = [];
    for (let i = 0; i < colStarts.length; i++) {
      const start = colStarts[i];
      const end = i + 1 < colStarts.length ? colStarts[i + 1] : line.length;
      cells.push(line.substring(start, end).trim());
    }
    return cells;
  });
  return { cols: rows };
}

function parseSizeString(sizeRaw: string): { val: number; unit: string; bytes: number } {
  const match = sizeRaw.trim().match(/^([\d.]+)\s*(GB|MB|KB|B)?$/i);
  const val = match ? parseFloat(match[1]) : 0;
  const unit = match ? (match[2] || "B").toUpperCase() : "B";
  const mult: Record<string, number> = { B: 1, KB: 1024, MB: 1048576, GB: 1073741824 };
  return { val, unit, bytes: val * (mult[unit] || 1) };
}

function parseOllamaPs(stdout: string): RunningModel[] {
  const { cols } = parseOllamaTable(stdout);
  return cols.map(cells => {
    const name = cells[0] || "";
    const { val, unit, bytes } = parseSizeString(cells[2] || "0 B");
    return { name, size: `${val} ${unit}`, sizeBytes: bytes, processor: cells[3] || "" };
  });
}

function parseOllamaList(stdout: string): Model[] {
  const { cols } = parseOllamaTable(stdout);
  return cols.map(cells => {
    const name = cells[0] || "";
    return {
      key: `ollama/${name}`,
      name,
      local: true,
      available: true,
      tags: [],
      contextWindow: 0,
    };
  });
}

interface AgentDefaults {
  model?: { primary?: string; fallbacks?: string[] };
  models?: Record<string, { alias?: string }>;
}

async function loadModelsFromConfig(): Promise<{ models: Model[]; primary: string | null; fallbacks: string[] }> {
  const result = await cachedCommand("openclaw config get agents.defaults --json", { ttl: 30_000 });
  if (result.code !== 0) return { models: [], primary: null, fallbacks: [] };

  const data: AgentDefaults = JSON.parse(result.stdout);
  const primary = data.model?.primary || null;
  const fallbackList = data.model?.fallbacks || [];
  const modelMap = data.models || {};

  const models: Model[] = Object.entries(modelMap).map(([key, cfg]) => ({
    key,
    name: cfg.alias || key.split("/").pop() || key,
    local: key.startsWith("ollama/"),
    available: true,
    tags: key === primary ? ["default"] : [],
    contextWindow: 0,
  }));

  return { models, primary, fallbacks: fallbackList };
}

function providerInfo(key: string): { provider: string; color: string; icon: "cloud" | "local" } {
  const p = key.split("/")[0].toLowerCase();
  if (p === "ollama") return { provider: "Ollama (Local)", color: "#4ade80", icon: "local" };
  if (p === "anthropic") return { provider: "Anthropic", color: "#d4a574", icon: "cloud" };
  if (p === "openai") return { provider: "OpenAI", color: "#10a37f", icon: "cloud" };
  if (p === "google") return { provider: "Google", color: "#4285f4", icon: "cloud" };
  if (p === "openrouter") return { provider: "OpenRouter", color: "#8b5cf6", icon: "cloud" };
  if (p === "groq") return { provider: "Groq", color: "#f55036", icon: "cloud" };
  if (p === "mistral") return { provider: "Mistral", color: "#ff7000", icon: "cloud" };
  return { provider: p, color: "var(--text-muted)", icon: "cloud" };
}

export function ModelsView() {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settingDefault, setSettingDefault] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [running, setRunning] = useState<RunningModel[]>([]);
  const [pullInput, setPullInput] = useState("");
  const [pulling, setPulling] = useState(false);
  const [pullOutput, setPullOutput] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<string | null>(null);
  const [fallbacks, setFallbacks] = useState<string[]>([]);
  const [fallbackInput, setFallbackInput] = useState("");
  const [fallbackLoading, setFallbackLoading] = useState(false);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("medium");
  const [thinkingLoading, setThinkingLoading] = useState(false);
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([]);
  const [statusLoading, setStatusLoading] = useState(false);
  const currentView = useAppStore(s => s.currentView);

  const loadModels = useCallback(async () => {
    setError(null);

    // Try openclaw models list first (full catalog)
    try {
      const result = await cachedCommand("openclaw models list --json", { ttl: 30_000 });
      if (result.code === 0) {
        const data = JSON.parse(result.stdout);
        const list: Model[] = data.models || [];
        if (list.length > 0) {
          setModels(list);
          setLoading(false);
          return;
        }
      }
    } catch {
      // timed out or errored — fall through to config-based approach
    }

    // Fallback: build model list from config + ollama list
    try {
      const [configData, ollamaResult] = await Promise.all([
        loadModelsFromConfig().catch(() => ({ models: [] as Model[], primary: null, fallbacks: [] as string[] })),
        cachedCommand("ollama list", { ttl: 15_000 }).catch(() => ({ stdout: "", stderr: "", code: 1 })),
      ]);

      const ollamaModels = ollamaResult.code === 0 ? parseOllamaList(ollamaResult.stdout) : [];

      // Merge: config models + any ollama models not already in config
      const merged = new Map<string, Model>();
      for (const m of configData.models) merged.set(m.key, m);
      for (const m of ollamaModels) {
        if (!merged.has(m.key)) merged.set(m.key, m);
        else {
          const existing = merged.get(m.key)!;
          existing.available = true;
          existing.local = true;
        }
      }

      // Mark the primary model as default
      if (configData.primary) {
        for (const m of merged.values()) {
          if (m.key === configData.primary) {
            if (!m.tags.includes("default")) m.tags = [...m.tags, "default"];
          }
        }
      }

      const list = Array.from(merged.values());
      setModels(list);
      setFallbacks(configData.fallbacks);

      if (list.length === 0) {
        setError("Could not discover models. Is OpenClaw gateway running?");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load models");
      setModels([]);
    }
    setLoading(false);
  }, []);

  const loadRunning = useCallback(async () => {
    try {
      const result = await cachedCommand("ollama ps", { ttl: 8_000 });
      if (result.code === 0) setRunning(parseOllamaPs(result.stdout));
    } catch { /* ignore */ }
  }, []);

  const scanModels = useCallback(async () => {
    setScanning(true);
    setScanResults(null);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "openclaw models scan --no-input --json", cwd: null,
      });
      setScanResults(result.code === 0 ? result.stdout : (result.stderr || "Scan failed"));
      if (result.code === 0) await loadModels();
    } catch (e) {
      setScanResults(e instanceof Error ? e.message : "Scan failed");
    }
    setScanning(false);
  }, [loadModels]);

  const loadFallbacks = useCallback(async () => {
    try {
      const result = await cachedCommand("openclaw models fallbacks list --json", { ttl: 120_000 });
      if (result.code === 0) {
        const data = JSON.parse(result.stdout);
        setFallbacks(data.fallbacks || []);
        return;
      }
    } catch { /* timed out — try config */ }
    try {
      const cfg = await cachedCommand("openclaw config get agents.defaults.model.fallbacks --json", { ttl: 60_000 });
      if (cfg.code === 0) {
        const data = JSON.parse(cfg.stdout);
        setFallbacks(Array.isArray(data.value) ? data.value : Array.isArray(data) ? data : []);
      }
    } catch { /* ignore */ }
  }, []);

  const addFallback = async () => {
    const model = fallbackInput.trim();
    if (!model) return;
    setFallbackLoading(true);
    try {
      await invoke("execute_command", { command: `openclaw models fallbacks add ${model}`, cwd: null });
      setFallbackInput("");
      await loadFallbacks();
      setFeedback({ type: "success", msg: `Added ${model} to fallbacks` });
    } catch (e) {
      setFeedback({ type: "error", msg: e instanceof Error ? e.message : "Failed to add fallback" });
    }
    setFallbackLoading(false);
  };

  const removeFallback = async (model: string) => {
    setFallbackLoading(true);
    try {
      await invoke("execute_command", { command: `openclaw models fallbacks remove ${model}`, cwd: null });
      await loadFallbacks();
      setFeedback({ type: "success", msg: `Removed ${model} from fallbacks` });
    } catch (e) {
      setFeedback({ type: "error", msg: e instanceof Error ? e.message : "Failed to remove fallback" });
    }
    setFallbackLoading(false);
  };

  const loadThinkingLevel = useCallback(async () => {
    try {
      const result = await cachedCommand("openclaw config get agents.defaults.thinking --json", { ttl: 120_000 });
      if (result.code === 0) {
        const data = JSON.parse(result.stdout);
        const val = (data.value || "medium") as ThinkingLevel;
        if (THINKING_LEVELS.includes(val)) setThinkingLevel(val);
      }
    } catch { /* ignore */ }
  }, []);

  const setThinkingLevelValue = async (level: ThinkingLevel) => {
    setThinkingLoading(true);
    try {
      await invoke("execute_command", {
        command: `openclaw config set agents.defaults.thinking "${level}"`, cwd: null,
      });
      setThinkingLevel(level);
      setFeedback({ type: "success", msg: `Thinking level set to ${level}` });
    } catch (e) {
      setFeedback({ type: "error", msg: e instanceof Error ? e.message : "Failed to set thinking level" });
    }
    setThinkingLoading(false);
  };

  const loadProviderStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const result = await cachedCommand("openclaw models status --json", { ttl: 120_000 });
      if (result.code === 0) {
        const data = JSON.parse(result.stdout);
        setProviderStatuses(data.providers || []);
        setStatusLoading(false);
        return;
      }
    } catch { /* timed out */ }
    // Fallback: derive provider status from config
    try {
      const cfg = await cachedCommand("openclaw config get models --json", { ttl: 60_000 });
      if (cfg.code === 0) {
        const data = JSON.parse(cfg.stdout);
        const providers: Record<string, { baseUrl?: string }> = data.providers || {};
        setProviderStatuses(Object.entries(providers).map(([name, p]) => ({
          provider: name,
          configured: !!p.baseUrl,
          authenticated: !!p.baseUrl,
        })));
      }
    } catch { /* ignore */ }
    setStatusLoading(false);
  }, []);

  useEffect(() => { loadModels(); loadRunning(); loadFallbacks(); loadThinkingLevel(); loadProviderStatus(); }, [loadModels, loadRunning, loadFallbacks, loadThinkingLevel, loadProviderStatus]);

  useEffect(() => {
    if (currentView !== "models") return;
    const id = setInterval(loadRunning, 8000);
    return () => clearInterval(id);
  }, [loadRunning, currentView]);

  useEffect(() => {
    if (feedback) { const t = setTimeout(() => setFeedback(null), 4000); return () => clearTimeout(t); }
  }, [feedback]);

  const defaultModel = models.find(m => m.tags.includes("default"));

  const setDefault = async (key: string) => {
    setSettingDefault(key);
    setDropdownOpen(false);
    try {
      await openclawClient.setModel(key);
      setFeedback({ type: "success", msg: `Default model set to ${key}` });
      await loadModels();
    } catch (e) {
      setFeedback({ type: "error", msg: e instanceof Error ? e.message : "Failed to set model" });
    }
    setSettingDefault(null);
  };

  const pullModel = async () => {
    const name = pullInput.trim();
    if (!name) return;
    setPulling(true);
    setPullOutput(`Pulling ${name}...`);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `ollama pull ${name}`, cwd: null,
      });
      if (result.code === 0) {
        setPullOutput(`Successfully pulled ${name}`);
        setPullInput("");
        await loadModels();
        await loadRunning();
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
      await invoke("execute_command", { command: `ollama rm ${name}`, cwd: null });
      setFeedback({ type: "success", msg: `Removed ${name}` });
      await loadModels();
    } catch { /* ignore */ }
    setDeleting(null);
    setDeleteConfirm(null);
  };

  const filtered = models.filter(m => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return m.key.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
  });

  const localCount = models.filter(m => m.local).length;
  const cloudCount = models.filter(m => !m.local).length;
  const totalVram = running.reduce((a, m) => a + m.sizeBytes, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "16px 24px 12px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <h2 style={{ color: "var(--text)", fontSize: 16, fontWeight: 700, margin: 0 }}>Models</h2>
            <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted)" }}>
              {models.length} available &middot; {localCount} local &middot; {cloudCount} cloud
            </p>
          </div>
          <button onClick={() => { loadModels(); loadRunning(); }} disabled={loading}
            onMouseDown={pressDown} onMouseUp={pressUp}
            style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, border: "none", fontSize: 11, cursor: "pointer", background: "var(--accent-bg)", color: "var(--accent)", transition: `all 0.15s ${EASE}` }}>
            <RefreshCw style={{ width: 12, height: 12, ...(loading ? { animation: "spin 1s linear infinite" } : {}) }} /> Refresh
          </button>
        </div>

        {/* Active Model Selector */}
        <div style={{ position: "relative", marginBottom: 12 }}>
          <button onClick={() => setDropdownOpen(!dropdownOpen)} style={{
            width: "100%", display: "flex", alignItems: "center", gap: 10,
            padding: "12px 16px", borderRadius: 12,
            background: "var(--bg-elevated)", border: "1px solid var(--border)",
            cursor: "pointer", transition: `border-color 0.15s ${EASE}`,
          }}>
            <Star style={{ width: 16, height: 16, color: "var(--accent)", flexShrink: 0 }} />
            <div style={{ flex: 1, textAlign: "left" }}>
              <span style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5, display: "block" }}>Active Model</span>
              {defaultModel ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", fontFamily: MONO }}>{defaultModel.name}</span>
                  {(() => { const info = providerInfo(defaultModel.key); return (
                    <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 6, background: `${info.color}15`, color: info.color, fontWeight: 500 }}>{info.provider}</span>
                  ); })()}
                </div>
              ) : (
                <span style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>No model selected</span>
              )}
            </div>
            {settingDefault ? (
              <Loader2 style={{ width: 14, height: 14, color: "var(--accent)", animation: "spin 1s linear infinite", flexShrink: 0 }} />
            ) : (
              <ChevronDown style={{ width: 16, height: 16, color: "var(--text-muted)", flexShrink: 0, transform: dropdownOpen ? "rotate(180deg)" : "none", transition: `transform 0.15s ${EASE}` }} />
            )}
          </button>

          {/* Dropdown */}
          {dropdownOpen && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setDropdownOpen(false)} />
              <div style={{
                position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 100,
                background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 12,
                boxShadow: "0 12px 40px rgba(0,0,0,0.4)", maxHeight: 320, overflowY: "auto",
              }}>
                {models.filter(m => m.available).map(m => {
                  const info = providerInfo(m.key);
                  const isActive = m.tags.includes("default");
                  return (
                    <button key={m.key} onClick={() => !isActive && setDefault(m.key)}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 10,
                        padding: "10px 14px", border: "none", cursor: isActive ? "default" : "pointer",
                        background: isActive ? "var(--accent-bg)" : "transparent",
                        borderBottom: "1px solid var(--border)",
                        transition: `background 0.1s ${EASE}`,
                      }}
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                    >
                      {info.icon === "local"
                        ? <HardDrive style={{ width: 14, height: 14, color: info.color, flexShrink: 0 }} />
                        : <Cloud style={{ width: 14, height: 14, color: info.color, flexShrink: 0 }} />
                      }
                      <div style={{ flex: 1, textAlign: "left" }}>
                        <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>{m.name}</span>
                        <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 8 }}>{info.provider}</span>
                      </div>
                      {m.contextWindow > 0 && (
                        <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: MONO }}>{formatContext(m.contextWindow)} ctx</span>
                      )}
                      {isActive && <Check style={{ width: 14, height: 14, color: "var(--accent)", flexShrink: 0 }} />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Feedback */}
        {feedback && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, marginBottom: 10,
            background: feedback.type === "success" ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)",
            border: `1px solid ${feedback.type === "success" ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: feedback.type === "success" ? "#4ade80" : "#f87171" }} />
            <span style={{ fontSize: 11, color: feedback.type === "success" ? "#4ade80" : "#f87171", flex: 1 }}>{feedback.msg}</span>
            <button onClick={() => setFeedback(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>×</button>
          </div>
        )}

        {/* Running Models Bar */}
        {running.length > 0 && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, marginBottom: 10,
            background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.12)",
          }}>
            <Play style={{ width: 12, height: 12, color: "var(--accent)", flexShrink: 0 }} />
            <div style={{ flex: 1, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              {running.map(r => (
                <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--success)", boxShadow: "0 0 6px rgba(74,222,128,0.5)" }} />
                      <span style={{ fontSize: 11, color: "var(--text)", fontFamily: MONO, fontWeight: 500 }}>{r.name}</span>
                  <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{r.size}</span>
                  {r.processor && <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 4, background: "rgba(59,130,246,0.1)", color: "var(--accent)" }}>{r.processor}</span>}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
              <MemoryStick style={{ width: 10, height: 10, color: "var(--text-muted)" }} />
              <span style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: MONO }}>{humanSize(totalVram)}</span>
            </div>
          </div>
        )}

        {/* Search + Pull */}
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, color: "var(--text-muted)" }} />
            <input type="text" placeholder="Search models..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              style={{ width: "100%", padding: "8px 12px 8px 30px", borderRadius: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, padding: "3px 4px 3px 10px" }}>
            <Download style={{ width: 11, height: 11, color: "var(--text-muted)", flexShrink: 0 }} />
            <input type="text" placeholder="Pull model..." value={pullInput} onChange={e => setPullInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && pullModel()}
              style={{ width: 140, border: "none", background: "transparent", color: "var(--text)", fontSize: 11, outline: "none", padding: "4px 0" }} />
            <button onClick={pullModel} disabled={pulling || !pullInput.trim()}
              style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: pulling ? "var(--bg-hover)" : "var(--accent-bg)", color: "var(--accent)", fontSize: 10, cursor: "pointer", fontWeight: 600, opacity: !pullInput.trim() ? 0.4 : 1 }}>
              {pulling ? "..." : "Pull"}
            </button>
          </div>
        </div>

        {pullOutput && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, padding: "6px 10px", borderRadius: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <span style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: MONO, flex: 1 }}>{pullOutput}</span>
            <button onClick={() => setPullOutput(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}><X style={{ width: 10, height: 10 }} /></button>
          </div>
        )}

        {/* Scan / Thinking / Providers row */}
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {/* Scan button */}
          <button onClick={scanModels} disabled={scanning}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, border: "none", fontSize: 11, cursor: "pointer", background: "var(--accent-bg)", color: "var(--accent)", fontWeight: 500, opacity: scanning ? 0.6 : 1 }}>
            {scanning ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <ScanSearch style={{ width: 12, height: 12 }} />}
            Scan for Models
          </button>

          {/* Thinking Level Selector */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <Brain style={{ width: 12, height: 12, color: "var(--text-muted)", flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: "var(--text-muted)", whiteSpace: "nowrap" }}>Thinking:</span>
            <select
              value={thinkingLevel}
              disabled={thinkingLoading}
              onChange={e => setThinkingLevelValue(e.target.value as ThinkingLevel)}
              style={{ fontSize: 11, padding: "2px 4px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-base)", color: "var(--text)", cursor: "pointer", outline: "none" }}
            >
              {THINKING_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            {thinkingLoading && <Loader2 style={{ width: 10, height: 10, color: "var(--accent)", animation: "spin 1s linear infinite" }} />}
          </div>
        </div>

        {/* Scan Results */}
        {scanResults && (
          <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)", maxHeight: 120, overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }}>Scan Results</span>
              <button onClick={() => setScanResults(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}><X style={{ width: 10, height: 10 }} /></button>
            </div>
            <pre style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: MONO, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{scanResults}</pre>
          </div>
        )}

        {/* Provider Auth Status */}
        {providerStatuses.length > 0 && (
          <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {providerStatuses.map(ps => (
              <div key={ps.provider} style={{
                display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 8,
                background: ps.authenticated ? "rgba(74,222,128,0.06)" : "rgba(248,113,113,0.06)",
                border: `1px solid ${ps.authenticated ? "rgba(74,222,128,0.15)" : "rgba(248,113,113,0.15)"}`,
              }}>
                {ps.authenticated
                  ? <ShieldCheck style={{ width: 11, height: 11, color: "#4ade80" }} />
                  : <KeyRound style={{ width: 11, height: 11, color: "#f87171" }} />
                }
                <span style={{ fontSize: 10, color: "var(--text)", fontWeight: 500 }}>{ps.provider}</span>
                <span style={{ fontSize: 9, color: ps.authenticated ? "#4ade80" : "#f87171" }}>
                  {ps.authenticated ? "Active" : ps.configured ? "No Auth" : "Not Configured"}
                </span>
              </div>
            ))}
            <button onClick={loadProviderStatus} disabled={statusLoading}
              style={{ display: "flex", alignItems: "center", gap: 3, padding: "4px 8px", borderRadius: 6, border: "none", background: "var(--bg-hover)", color: "var(--text-muted)", fontSize: 9, cursor: "pointer" }}>
              <RefreshCw style={{ width: 9, height: 9, ...(statusLoading ? { animation: "spin 1s linear infinite" } : {}) }} /> Refresh
            </button>
          </div>
        )}

        {/* Fallbacks */}
        <div style={{ ...innerPanel, marginTop: 10, padding: "8px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={sectionLabel}>Fallback Models</span>
          </div>
          {fallbacks.length === 0 ? (
            <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "0 0 6px" }}>No fallbacks configured</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
              {fallbacks.map(fb => (
                <div key={fb} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", borderRadius: 6, background: "var(--bg-base)" }}>
                  <span style={{ flex: 1, fontSize: 11, color: "var(--text)", fontFamily: MONO }}>{fb}</span>
                  <button onClick={() => removeFallback(fb)} disabled={fallbackLoading}
                    style={{ display: "flex", alignItems: "center", padding: "2px 6px", borderRadius: 4, border: "none", background: "rgba(248,113,113,0.1)", color: "#f87171", cursor: "pointer", opacity: fallbackLoading ? 0.5 : 1 }}>
                    <Minus style={{ width: 10, height: 10 }} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 4 }}>
            <input type="text" placeholder="model key..." value={fallbackInput} onChange={e => setFallbackInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addFallback()}
              style={{ flex: 1, padding: "5px 8px", borderRadius: 6, background: "var(--bg-base)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 11, outline: "none" }} />
            <button onClick={addFallback} disabled={fallbackLoading || !fallbackInput.trim()}
              style={{ display: "flex", alignItems: "center", gap: 3, padding: "5px 10px", borderRadius: 6, border: "none", background: "var(--accent-bg)", color: "var(--accent)", fontSize: 10, cursor: "pointer", fontWeight: 600, opacity: !fallbackInput.trim() ? 0.4 : 1 }}>
              <Plus style={{ width: 10, height: 10 }} /> Add
            </button>
          </div>
        </div>
      </div>

      {/* Model List */}
      <div style={{ ...scrollArea, padding: "0 24px 20px" }}>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
            <Loader2 style={{ width: 24, height: 24, color: "var(--accent)", animation: "spin 1s linear infinite" }} />
          </div>
        ) : error ? (
          <div style={emptyState}>
            <AlertTriangle style={{ width: 24, height: 24, color: "#f87171" }} />
            <p style={{ fontSize: 12, color: "#f87171", textAlign: "center" }}>{error}</p>
            <button onClick={loadModels} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "var(--bg-elevated)", color: "var(--text-secondary)", fontSize: 11, cursor: "pointer" }}>Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div style={emptyState}>
            <Cpu style={{ width: 28, height: 28, color: "var(--text-muted)" }} />
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{models.length === 0 ? "No models configured" : "No matching models"}</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {filtered.map(model => {
              const info = providerInfo(model.key);
              const isDefault = model.tags.includes("default");
              const isRunning = running.some(r => model.key.includes(r.name.split(":")[0]));
              const isLocal = model.local;
              const modelBaseName = model.key.split("/").pop() || model.name;
              const showDelete = isLocal && deleteConfirm !== modelBaseName;
              const showDeleteConfirm = isLocal && deleteConfirm === modelBaseName;

              return (
                <div key={model.key} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 14px", borderRadius: 12,
                  background: isDefault ? "var(--accent-bg)" : "var(--bg-elevated)",
                  border: `1px solid ${isDefault ? "rgba(59,130,246,0.2)" : "var(--border)"}`,
                  transition: `all 0.2s ${EASE}`,
                }}
                  data-glow={info.color}
                  onMouseEnter={hoverLift}
                  onMouseLeave={hoverReset}
                >
                  {/* Provider Icon */}
                  <div style={{
                    width: 36, height: 36, borderRadius: 10, display: "flex",
                    alignItems: "center", justifyContent: "center", flexShrink: 0,
                    background: `${info.color}12`, border: `1px solid ${info.color}20`,
                  }}>
                    {info.icon === "local"
                      ? <HardDrive style={{ width: 16, height: 16, color: info.color }} />
                      : <Cloud style={{ width: 16, height: 16, color: info.color }} />
                    }
                  </div>

                  {/* Model Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 600 }}>{model.name}</span>
                      {isDefault && (
                        <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: 4, background: "var(--accent)", color: "#fff", fontWeight: 700, letterSpacing: 0.3 }}>ACTIVE</span>
                      )}
                      {isRunning && (
                        <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: 4, background: "rgba(74,222,128,0.15)", color: "#4ade80", fontWeight: 600, display: "flex", alignItems: "center", gap: 3 }}>
                          <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#4ade80" }} /> LOADED
                        </span>
                      )}
                      {!model.available && (
                        <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: 4, background: "rgba(248,113,113,0.12)", color: "#f87171", fontWeight: 600 }}>UNAVAILABLE</span>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                      <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: `${info.color}10`, color: info.color, fontWeight: 500 }}>{info.provider}</span>
                      <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: MONO }}>{model.key}</span>
                      {model.contextWindow > 0 && (
                        <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "var(--bg-hover)", color: "var(--text-muted)" }}>{formatContext(model.contextWindow)} ctx</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                    {showDeleteConfirm && (
                      <>
                        <button onClick={() => deleteModel(modelBaseName)} disabled={deleting === modelBaseName}
                          style={{ padding: "5px 8px", borderRadius: 6, border: "none", background: "rgba(248,113,113,0.15)", color: "#f87171", fontSize: 9, cursor: "pointer", display: "flex", alignItems: "center", gap: 3, opacity: deleting === modelBaseName ? 0.5 : 1 }}>
                          {deleting === modelBaseName ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : <Check style={{ width: 10, height: 10 }} />} Delete?
                        </button>
                        <button onClick={() => setDeleteConfirm(null)} style={{ padding: "5px 6px", borderRadius: 6, border: "none", background: "var(--bg-hover)", color: "var(--text-muted)", fontSize: 9, cursor: "pointer", display: "flex", alignItems: "center" }}>
                          <X style={{ width: 10, height: 10 }} />
                        </button>
                      </>
                    )}
                    {showDelete && (
                      <button onClick={() => setDeleteConfirm(modelBaseName)} title="Delete from Ollama"
                        style={{ padding: "5px 8px", borderRadius: 6, border: "none", background: "var(--bg-hover)", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center" }}>
                        <Trash2 style={{ width: 12, height: 12 }} />
                      </button>
                    )}
                    {!isDefault && model.available && (
                      <button onClick={() => setDefault(model.key)} disabled={settingDefault === model.key}
                        style={{
                          padding: "6px 12px", borderRadius: 8, border: "none", fontSize: 11, fontWeight: 500,
                          cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                          background: "var(--accent-bg)", color: "var(--accent)",
                          opacity: settingDefault === model.key ? 0.5 : 1,
                        }}>
                        {settingDefault === model.key
                          ? <Loader2 style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} />
                          : <Star style={{ width: 11, height: 11 }} />
                        }
                        Use
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
