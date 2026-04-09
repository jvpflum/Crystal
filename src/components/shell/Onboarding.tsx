import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openclawClient } from "@/lib/openclaw";
import { LobsterIcon } from "@/components/LobsterIcon";
import {
  CheckCircle,
  XCircle,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Download,
  Wifi,
  WifiOff,
  Rocket,
} from "lucide-react";

interface PrereqResult {
  label: string;
  ok: boolean;
  detail: string;
  loading: boolean;
}

interface OllamaModel {
  name: string;
  size: string;
}

const TOTAL_STEPS = 5;

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.7)",
  backdropFilter: "blur(12px)",
  zIndex: 3000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const cardStyle: React.CSSProperties = {
  background: "rgba(15,15,22,0.98)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 16,
  padding: 32,
  width: 500,
  maxWidth: "90vw",
  maxHeight: "85vh",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 24,
};

const primaryBtn: React.CSSProperties = {
  background: "linear-gradient(135deg, #3B82F6, #2563EB)",
  color: "white",
  border: "none",
  borderRadius: 10,
  padding: "12px 24px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
};

const secondaryBtn: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.8)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10,
  padding: "12px 24px",
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
};

async function runCmd(command: string): Promise<string> {
  try {
    const result = await invoke<{ stdout: string; stderr: string; code: number }>(
      "execute_command",
      { command, cwd: null }
    );
    return (result.stdout || result.stderr || "").trim();
  } catch {
    return "";
  }
}

export function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);

  const [prereqs, setPrereqs] = useState<PrereqResult[]>([
    { label: "Node.js", ok: false, detail: "", loading: true },
    { label: "Model Server", ok: false, detail: "", loading: true },
    { label: "OpenClaw", ok: false, detail: "", loading: true },
    { label: "NVIDIA GPU", ok: false, detail: "", loading: true },
  ]);

  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [pullInput, setPullInput] = useState("");
  const [pulling, setPulling] = useState(false);
  const [pullMsg, setPullMsg] = useState("");

  const [gatewayUp, setGatewayUp] = useState<boolean | null>(null);
  const [startingGateway, setStartingGateway] = useState(false);

  const checkPrereqs = useCallback(async () => {
    const cmds = [
      { cmd: "node --version", idx: 0 },
      { cmd: "ollama --version", idx: 1 },
      { cmd: "openclaw --version", idx: 2 },
      { cmd: "nvidia-smi --query-gpu=name --format=csv,noheader", idx: 3 },
    ];

    const results = await Promise.allSettled(
      cmds.map(async ({ cmd, idx }) => {
        const out = await runCmd(cmd);
        return { idx, out };
      })
    );

    setPrereqs((prev) => {
      const next = [...prev];
      for (let ri = 0; ri < results.length; ri++) {
        const r = results[ri];
        const { idx } = cmds[ri];
        if (r.status === "fulfilled") {
          const { out } = r.value;
          next[idx] = { ...next[idx], ok: out.length > 0, detail: out || "Not found", loading: false };
        } else {
          next[idx] = { ...next[idx], ok: false, detail: "Check failed", loading: false };
        }
      }
      return next;
    });
  }, []);

  const loadModels = useCallback(async () => {
    const raw = await runCmd("ollama list");
    if (!raw) {
      setModels([]);
      return;
    }
    const lines = raw.split("\n").filter((l) => l.trim());
    const parsed: OllamaModel[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(/\s+/);
      if (parts.length >= 2) {
        parsed.push({ name: parts[0], size: parts[2] ?? "" });
      }
    }
    setModels(parsed);
    if (parsed.length > 0 && !selectedModel) {
      setSelectedModel(parsed[0].name);
    }
  }, [selectedModel]);

  const pullModel = async () => {
    if (!pullInput.trim()) return;
    setPulling(true);
    setPullMsg(`Pulling ${pullInput}...`);
    const out = await runCmd(`ollama pull ${pullInput.trim()}`);
    setPulling(false);
    setPullMsg(out || "Done");
    await loadModels();
  };

  const checkGateway = useCallback(async () => {
    try {
      const status = await invoke<{ openclaw_running: boolean }>("get_server_status");
      if (status.openclaw_running) {
        setGatewayUp(true);
        return;
      }
      const out = await runCmd("openclaw health");
      setGatewayUp(out.length > 0 && !out.toLowerCase().includes("error"));
    } catch {
      setGatewayUp(false);
    }
  }, []);

  const startGateway = async () => {
    setStartingGateway(true);
    try {
      await invoke("start_openclaw_daemon");
      await new Promise((r) => setTimeout(r, 4000));
      await checkGateway();
    } catch {
      setGatewayUp(false);
    }
    setStartingGateway(false);
  };

  useEffect(() => {
    if (step === 1) checkPrereqs();
    if (step === 2) loadModels();
    if (step === 3) checkGateway();
  }, [step, checkPrereqs, loadModels, checkGateway]);

  const failedCount = prereqs.filter((p) => !p.ok && !p.loading).length;
  const anyLoading = prereqs.some((p) => p.loading);

  function renderDots() {
    return (
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <div
            key={i}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: i === step ? "#3B82F6" : "rgba(255,255,255,0.15)",
              transition: "background 0.2s",
            }}
          />
        ))}
      </div>
    );
  }

  function renderStep() {
    switch (step) {
      case 0:
        return (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, textAlign: "center" }}>
            <div style={{
              width: 72, height: 72, borderRadius: 18, overflow: "hidden",
              boxShadow: "0 4px 20px rgba(59,130,246,0.35)",
            }}>
              <LobsterIcon size={72} />
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: "white", margin: 0 }}>
              Welcome to Crystal
            </h1>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", lineHeight: 1.6, maxWidth: 380 }}>
              Your intelligent desktop companion. Crystal connects to local LLMs, agents, and tools to
              supercharge your workflow — all running privately on your machine.
            </p>
            <button style={primaryBtn} onClick={() => setStep(1)}>
              Get Started <ChevronRight size={16} />
            </button>
          </div>
        );

      case 1:
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "white", margin: 0 }}>
              Prerequisites Check
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {prereqs.map((p, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  {p.loading ? (
                    <Loader2 size={18} style={{ color: "#3B82F6", animation: "spin 1s linear infinite" }} />
                  ) : p.ok ? (
                    <CheckCircle size={18} style={{ color: "#4ade80" }} />
                  ) : (
                    <XCircle size={18} style={{ color: "#f87171" }} />
                  )}
                  <span style={{ fontSize: 13, color: "white", fontWeight: 600, minWidth: 90 }}>
                    {p.label}
                  </span>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", flex: 1, textAlign: "right" }}>
                    {p.loading ? "Checking..." : p.detail}
                  </span>
                </div>
              ))}
            </div>
            {!anyLoading && failedCount > 0 && (
              <p style={{ fontSize: 12, color: "#f87171", margin: 0 }}>
                {failedCount} prerequisite{failedCount > 1 ? "s" : ""} not detected. You can continue, but some features may not work.
              </p>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
              <button style={secondaryBtn} onClick={() => setStep(0)}>
                <ChevronLeft size={16} /> Back
              </button>
              <button style={primaryBtn} onClick={() => setStep(2)} disabled={anyLoading}>
                Continue <ChevronRight size={16} />
              </button>
            </div>
          </div>
        );

      case 2:
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "white", margin: 0 }}>
              OpenClaw Model
            </h2>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", margin: 0 }}>
              {models.length > 0
                ? "Select your default model for OpenClaw:"
                : "No local models detected. Pull one to get started."}
            </p>
            {models.length === 0 && (
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", margin: 0 }}>
                You can skip this step and set up a model later in Settings.
              </p>
            )}
            {models.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto" }}>
                {models.map((m) => (
                  <label
                    key={m.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      background: selectedModel === m.name ? "rgba(59,130,246,0.12)" : "rgba(255,255,255,0.03)",
                      border: selectedModel === m.name ? "1px solid rgba(59,130,246,0.4)" : "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 8,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="model"
                      checked={selectedModel === m.name}
                      onChange={() => {
                        setSelectedModel(m.name);
                        openclawClient.setModel(m.name);
                      }}
                      style={{ accentColor: "#3B82F6" }}
                    />
                    <span style={{ fontSize: 13, color: "white", fontWeight: 500 }}>{m.name}</span>
                    {m.size && (
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginLeft: "auto" }}>
                        {m.size}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}
            {selectedModel && (
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 12px", borderRadius: 8,
                background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.2)",
              }}>
                <CheckCircle size={14} style={{ color: "#4ade80" }} />
                <span style={{ fontSize: 12, color: "#4ade80" }}>
                  Selected: <strong>{selectedModel}</strong>
                </span>
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                placeholder="e.g. llama3.2"
                value={pullInput}
                onChange={(e) => setPullInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && pullModel()}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  fontSize: 13,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  color: "white",
                  outline: "none",
                }}
              />
              <button style={{ ...secondaryBtn, padding: "10px 16px" }} onClick={pullModel} disabled={pulling}>
                {pulling ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Download size={14} />}
                Pull
              </button>
            </div>
            {pullMsg && (
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", margin: 0 }}>{pullMsg}</p>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
              <button style={secondaryBtn} onClick={() => setStep(1)}>
                <ChevronLeft size={16} /> Back
              </button>
              <button
                style={{
                  ...primaryBtn,
                  opacity: 1,
                }}
                onClick={async () => {
                  if (selectedModel) {
                    openclawClient.setModel(selectedModel);
                    runCmd(`openclaw models set ollama/${selectedModel}`).catch(() => {});
                  }
                  setStep(3);
                }}
              >
                Continue <ChevronRight size={16} />
              </button>
            </div>
          </div>
        );

      case 3:
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "white", margin: 0 }}>
              Gateway & Services
            </h2>

            {/* Gateway status */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "14px 16px",
                background: "rgba(255,255,255,0.03)",
                borderRadius: 10,
                border: `1px solid ${gatewayUp ? "rgba(74,222,128,0.2)" : "rgba(255,255,255,0.06)"}`,
              }}
            >
              {gatewayUp === null ? (
                <Loader2 size={20} style={{ color: "#3B82F6", animation: "spin 1s linear infinite" }} />
              ) : gatewayUp ? (
                <Wifi size={20} style={{ color: "#4ade80" }} />
              ) : (
                <WifiOff size={20} style={{ color: "#f87171" }} />
              )}
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 14, color: "white", fontWeight: 600, margin: 0 }}>
                  OpenClaw Gateway
                </p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", margin: 0 }}>
                  {gatewayUp === null
                    ? "Checking status..."
                    : gatewayUp
                      ? "Gateway is running on port 18789"
                      : "Gateway is not running — click Start to launch it"}
                </p>
              </div>
              {gatewayUp === false && !startingGateway && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    style={{ ...primaryBtn, padding: "8px 16px", fontSize: 12 }}
                    onClick={startGateway}
                  >
                    <Rocket size={14} /> Start
                  </button>
                  <button
                    style={{ ...secondaryBtn, padding: "8px 16px", fontSize: 12 }}
                    onClick={() => setStep(4)}
                  >
                    Skip
                  </button>
                </div>
              )}
              {startingGateway && (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Loader2 size={14} style={{ color: "#3B82F6", animation: "spin 1s linear infinite" }} />
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>Starting...</span>
                </div>
              )}
              {gatewayUp && (
                <CheckCircle size={20} style={{ color: "#4ade80" }} />
              )}
            </div>

            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", margin: 0, lineHeight: 1.6 }}>
              The OpenClaw gateway powers all of Crystal's AI capabilities.
              It must be running for Crystal to function.
              You can manage the gateway from Settings.
            </p>

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
              <button style={secondaryBtn} onClick={() => setStep(2)}>
                <ChevronLeft size={16} /> Back
              </button>
              <button style={primaryBtn} onClick={() => setStep(4)}>
                Continue <ChevronRight size={16} />
              </button>
            </div>
          </div>
        );

      case 4:
        return (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, textAlign: "center" }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: "rgba(74,222,128,0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <CheckCircle size={28} style={{ color: "#4ade80" }} />
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: "white", margin: 0 }}>
              You're all set!
            </h2>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                fontSize: 13,
                color: "rgba(255,255,255,0.6)",
                textAlign: "left",
                width: "100%",
              }}
            >
              {prereqs.map((p, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {p.ok ? (
                    <CheckCircle size={14} style={{ color: "#4ade80" }} />
                  ) : (
                    <XCircle size={14} style={{ color: "#f87171" }} />
                  )}
                  <span>{p.label}: {p.ok ? p.detail : "Not available"}</span>
                </div>
              ))}
              {selectedModel && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <CheckCircle size={14} style={{ color: "#4ade80" }} />
                  <span>Default model: {selectedModel}</span>
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {gatewayUp ? (
                  <CheckCircle size={14} style={{ color: "#4ade80" }} />
                ) : (
                  <XCircle size={14} style={{ color: "#f87171" }} />
                )}
                <span>Gateway: {gatewayUp ? "Connected" : "Not running"}</span>
              </div>
            </div>
            <button style={primaryBtn} onClick={onComplete}>
              <Rocket size={16} /> Launch Crystal
            </button>
          </div>
        );

      default:
        return null;
    }
  }

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        {renderStep()}
        {renderDots()}
      </div>
    </div>
  );
}
