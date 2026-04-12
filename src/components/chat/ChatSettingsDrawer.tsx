import { useState, useEffect } from "react";
import { X, Wifi, WifiOff, Loader2 } from "lucide-react";
import { openclawClient } from "@/lib/openclaw";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore, type ThinkingLevel } from "@/stores/appStore";
import { useChatSettingsStore, type ResponseStyle } from "@/stores/chatSettingsStore";
import { EASE, MONO } from "@/styles/viewStyles";

async function checkPort(port: number): Promise<boolean> {
  try {
    const r = await invoke<{ stdout: string; code: number }>("execute_command", {
      command: `(Test-NetConnection -ComputerName 127.0.0.1 -Port ${port} -InformationLevel Quiet -WarningAction SilentlyContinue) -eq $true`,
      cwd: null,
    });
    return r.stdout.trim().toLowerCase() === "true";
  } catch { return false; }
}

export function ChatSettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    offlineMode, temperature, maxTokens, topP, responseStyle, streamEnabled,
    setOfflineMode, setTemperature, setMaxTokens, setTopP, setResponseStyle, setStreamEnabled,
    cloudModel, setCloudModel,
  } = useChatSettingsStore();

  const thinkingLevel = useAppStore(s => s.thinkingLevel);
  const setThinkingLevel = useAppStore(s => s.setThinkingLevel);

  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [currentModel, setCurrentModel] = useState(openclawClient.getModel());
  const [switchingOffline, setSwitchingOffline] = useState(false);
  const [offlineWarning, setOfflineWarning] = useState("");

  useEffect(() => {
    if (!open) return;
    setCurrentModel(openclawClient.getModel());
    setLoadingModels(true);
    openclawClient.getModels().then(m => { setModels(m); setLoadingModels(false); }).catch(() => setLoadingModels(false));
  }, [open]);

  const handleModelChange = async (key: string) => {
    setCurrentModel(key);
    await openclawClient.setModel(key);
  };

  const handleOfflineToggle = async () => {
    if (switchingOffline) return;
    setSwitchingOffline(true);
    setOfflineWarning("");

    if (!offlineMode) {
      setCloudModel(currentModel);
      const vllmUp = await checkPort(8000);
      if (vllmUp) {
        await openclawClient.setModel("vllm");
        setCurrentModel("vllm");
        setOfflineMode(true);
      } else {
        setOfflineWarning("vLLM not running on port 8000. Start vLLM for local inference.");
      }
    } else {
      const restore = cloudModel || "default";
      await openclawClient.setModel(restore);
      setCurrentModel(restore);
      setOfflineMode(false);
    }
    setSwitchingOffline(false);
  };

  const thinkingOptions: { value: ThinkingLevel | undefined; label: string }[] = [
    { value: undefined, label: "Default" },
    { value: "auto", label: "Auto" },
    { value: "minimal", label: "Minimal" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ];

  const styleOptions: { value: ResponseStyle; label: string; desc: string }[] = [
    { value: "concise", label: "Concise", desc: "Short, direct answers" },
    { value: "balanced", label: "Balanced", desc: "Standard detail level" },
    { value: "detailed", label: "Detailed", desc: "Thorough explanations" },
  ];

  const SECTION: React.CSSProperties = {
    marginBottom: 18,
  };
  const SECTION_TITLE: React.CSSProperties = {
    fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase",
    color: "var(--text-muted)", marginBottom: 8, display: "block",
  };
  const ROW: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "6px 0",
  };
  const LABEL: React.CSSProperties = {
    fontSize: 11, color: "var(--text-secondary)", fontWeight: 500,
  };

  return (
    <div style={{
      position: "absolute", top: 0, right: 0, bottom: 0,
      width: open ? 300 : 0, overflow: "hidden",
      transition: `width 0.25s ${EASE}`,
      zIndex: 20,
    }}>
      <div style={{
        width: 300, height: "100%",
        display: "flex", flexDirection: "column",
        background: "var(--bg-surface)",
        borderLeft: "1px solid var(--border)",
        backdropFilter: "blur(16px)",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0,
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>Chat Settings</span>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: 4,
              borderRadius: 4, display: "flex", alignItems: "center",
              transition: `background 0.15s ${EASE}`,
            }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}
            onMouseLeave={e => e.currentTarget.style.background = "none"}
          >
            <X style={{ width: 14, height: 14, color: "var(--text-muted)" }} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>

          {/* Model */}
          <div style={SECTION}>
            <span style={SECTION_TITLE}>Model</span>
            {loadingModels ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0" }}>
                <Loader2 style={{ width: 12, height: 12, color: "var(--accent)", animation: "spin 1s linear infinite" }} />
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Loading models...</span>
              </div>
            ) : (
              <select
                value={currentModel}
                onChange={e => handleModelChange(e.target.value)}
                style={{
                  width: "100%", padding: "6px 10px", borderRadius: 8,
                  background: "var(--bg-elevated)", border: "1px solid var(--border)",
                  color: "var(--text)", fontSize: 11, fontFamily: MONO,
                  outline: "none", cursor: "pointer",
                  transition: `border-color 0.2s ${EASE}`,
                }}
                onFocus={e => e.currentTarget.style.borderColor = "rgba(59,130,246,0.3)"}
                onBlur={e => e.currentTarget.style.borderColor = "var(--border)"}
              >
                {models.length === 0 && <option value={currentModel}>{openclawClient.getModelDisplayName(currentModel)}</option>}
                {models.map(m => (
                  <option key={m} value={m}>{openclawClient.getModelDisplayName(m)}</option>
                ))}
              </select>
            )}
          </div>

          {/* Offline Mode */}
          <div style={SECTION}>
            <span style={SECTION_TITLE}>Offline Mode</span>
            <div style={{
              ...ROW,
              padding: "8px 12px", borderRadius: 10,
              background: offlineMode ? "rgba(74,222,128,0.06)" : "rgba(255,255,255,0.015)",
              border: `1px solid ${offlineMode ? "rgba(74,222,128,0.15)" : "rgba(255,255,255,0.04)"}`,
              transition: `all 0.2s ${EASE}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {offlineMode
                  ? <WifiOff style={{ width: 14, height: 14, color: "var(--success)" }} />
                  : <Wifi style={{ width: 14, height: 14, color: "var(--text-muted)" }} />
                }
                <div>
                  <span style={{ ...LABEL, color: offlineMode ? "var(--success)" : "var(--text-secondary)" }}>
                    {offlineMode ? "Local Model Active" : "Use Local Model"}
                  </span>
                  <p style={{ fontSize: 9, color: "var(--text-muted)", margin: "2px 0 0" }}>
                    {offlineMode ? "vLLM Active" : "Switch to vLLM"}
                  </p>
                </div>
              </div>
              <button
                onClick={handleOfflineToggle}
                disabled={switchingOffline}
                style={{
                  width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer",
                  position: "relative", flexShrink: 0,
                  background: offlineMode ? "var(--success)" : "rgba(255,255,255,0.1)",
                  transition: `background 0.2s ${EASE}`,
                }}
              >
                <div style={{
                  width: 16, height: 16, borderRadius: "50%",
                  background: "#fff",
                  position: "absolute", top: 2,
                  left: offlineMode ? 18 : 2,
                  transition: `left 0.2s ${EASE}`,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                }} />
              </button>
            </div>
            {offlineWarning && (
              <p style={{ fontSize: 10, color: "var(--warning)", marginTop: 6 }}>{offlineWarning}</p>
            )}
          </div>

          {/* Parameters */}
          <div style={SECTION}>
            <span style={SECTION_TITLE}>Parameters</span>

            {/* Temperature */}
            <div style={ROW}>
              <span style={LABEL}>Temperature</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="range" min="0" max="2" step="0.05"
                  value={temperature}
                  onChange={e => setTemperature(parseFloat(e.target.value))}
                  style={{ width: 80, height: 4, accentColor: "var(--accent)", cursor: "pointer" }}
                />
                <span style={{ fontSize: 11, fontFamily: MONO, color: "var(--text)", fontWeight: 600, minWidth: 28, textAlign: "right" }}>
                  {temperature.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Max Tokens */}
            <div style={ROW}>
              <span style={LABEL}>Max Tokens</span>
              <input
                type="number" min={64} max={131072} step={256}
                value={maxTokens}
                onChange={e => setMaxTokens(parseInt(e.target.value) || 1024)}
                style={{
                  width: 80, padding: "4px 8px", borderRadius: 6,
                  background: "var(--bg-elevated)", border: "1px solid var(--border)",
                  color: "var(--text)", fontSize: 11, fontFamily: MONO,
                  outline: "none", textAlign: "right",
                }}
              />
            </div>

            {/* Top P */}
            <div style={ROW}>
              <span style={LABEL}>Top P</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="range" min="0" max="1" step="0.05"
                  value={topP}
                  onChange={e => setTopP(parseFloat(e.target.value))}
                  style={{ width: 80, height: 4, accentColor: "var(--accent)", cursor: "pointer" }}
                />
                <span style={{ fontSize: 11, fontFamily: MONO, color: "var(--text)", fontWeight: 600, minWidth: 28, textAlign: "right" }}>
                  {topP.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* Thinking Level */}
          <div style={SECTION}>
            <span style={SECTION_TITLE}>Thinking Level</span>
            <div style={{ display: "flex", gap: 4 }}>
              {thinkingOptions.map(opt => {
                const active = thinkingLevel === opt.value;
                return (
                  <button
                    key={opt.label}
                    onClick={() => setThinkingLevel(opt.value)}
                    style={{
                      flex: 1, padding: "5px 4px", borderRadius: 6,
                      fontSize: 10, fontWeight: active ? 600 : 500,
                      cursor: "pointer", border: "none",
                      background: active ? "rgba(139,92,246,0.15)" : "rgba(255,255,255,0.03)",
                      color: active ? "rgba(139,92,246,0.9)" : "var(--text-muted)",
                      transition: `all 0.15s ${EASE}`,
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Response Style */}
          <div style={SECTION}>
            <span style={SECTION_TITLE}>Response Style</span>
            <div style={{ display: "flex", gap: 6 }}>
              {styleOptions.map(opt => {
                const active = responseStyle === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setResponseStyle(opt.value)}
                    title={opt.desc}
                    style={{
                      flex: 1, padding: "8px 6px", borderRadius: 8,
                      fontSize: 10, fontWeight: active ? 600 : 500,
                      cursor: "pointer",
                      border: active ? "1px solid rgba(59,130,246,0.3)" : "1px solid rgba(255,255,255,0.04)",
                      background: active ? "rgba(59,130,246,0.08)" : "rgba(255,255,255,0.015)",
                      color: active ? "var(--accent)" : "var(--text-muted)",
                      transition: `all 0.15s ${EASE}`,
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                    }}
                  >
                    <span>{opt.label}</span>
                    <span style={{ fontSize: 8, opacity: 0.7 }}>{opt.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Streaming */}
          <div style={SECTION}>
            <span style={SECTION_TITLE}>Streaming</span>
            <div style={ROW}>
              <span style={LABEL}>Stream responses</span>
              <button
                onClick={() => setStreamEnabled(!streamEnabled)}
                style={{
                  width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer",
                  position: "relative", flexShrink: 0,
                  background: streamEnabled ? "var(--accent)" : "rgba(255,255,255,0.1)",
                  transition: `background 0.2s ${EASE}`,
                }}
              >
                <div style={{
                  width: 16, height: 16, borderRadius: "50%",
                  background: "#fff",
                  position: "absolute", top: 2,
                  left: streamEnabled ? 18 : 2,
                  transition: `left 0.2s ${EASE}`,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                }} />
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
