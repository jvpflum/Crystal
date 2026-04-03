import { useState, useEffect, useCallback } from "react";
import {
  Smartphone, Shield, CheckCircle2, XCircle, RefreshCw, Trash2,
  Key, Loader2, QrCode, UserPlus, AlertTriangle,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface Device {
  id: string;
  role?: string;
  status: "pending" | "paired" | string;
  scopes?: string[];
  requestId?: string;
  label?: string;
}

interface QrResult {
  url?: string;
  code?: string;
  data?: string;
  qr?: string;
}

const CARD: React.CSSProperties = {
  background: "var(--bg-elevated)", border: "1px solid var(--border)",
  borderRadius: 10, overflow: "hidden",
};
const ROW: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "10px 14px", borderBottom: "1px solid var(--border)",
};
const SECT: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, textTransform: "uppercase",
  letterSpacing: 0.5, color: "var(--text-muted)", marginBottom: 8,
};
const BTN_P: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 5, padding: "6px 12px",
  borderRadius: 6, border: "none", background: "var(--accent-bg)",
  color: "var(--accent)", fontSize: 11, fontWeight: 500, cursor: "pointer",
};
const BTN_G: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 4, padding: "5px 10px",
  borderRadius: 6, border: "1px solid var(--border)", background: "transparent",
  color: "var(--text-muted)", fontSize: 11, cursor: "pointer",
};
const BTN_DANGER: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 4, padding: "5px 10px",
  borderRadius: 6, border: "1px solid rgba(248,113,113,0.3)",
  background: "rgba(248,113,113,0.08)", color: "#f87171",
  fontSize: 11, cursor: "pointer",
};
const MONO: React.CSSProperties = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" };

export function DevicesView() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [qrData, setQrData] = useState<QrResult | null>(null);
  const [rotateRole, setRotateRole] = useState<Record<string, string>>({});
  const [revokeRole, setRevokeRole] = useState<Record<string, string>>({});
  const [confirmClear, setConfirmClear] = useState<"all" | "pending" | null>(null);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "openclaw devices list --json", cwd: null,
      });
      if (result.code !== 0) {
        setError(result.stderr || "Failed to list devices");
        setDevices([]);
      } else {
        const data = JSON.parse(result.stdout);
        const list: Device[] = Array.isArray(data) ? data : (data.devices ?? data.items ?? []);
        setDevices(list);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load devices");
      setDevices([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadDevices(); }, [loadDevices]);

  useEffect(() => {
    if (feedback) { const t = setTimeout(() => setFeedback(null), 4000); return () => clearTimeout(t); }
  }, [feedback]);

  const exec = async (label: string, command: string) => {
    setActionLoading(label);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command, cwd: null,
      });
      if (result.code === 0) {
        setFeedback({ type: "success", msg: `${label}: Success` });
        await loadDevices();
      } else {
        setFeedback({ type: "error", msg: result.stderr || `${label} failed` });
      }
    } catch (e) {
      setFeedback({ type: "error", msg: e instanceof Error ? e.message : `${label} failed` });
    }
    setActionLoading(null);
  };

  const generateQr = async () => {
    setActionLoading("qr");
    setQrData(null);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "openclaw qr --json", cwd: null,
      });
      if (result.code === 0 && result.stdout.trim()) {
        setQrData(JSON.parse(result.stdout));
        setFeedback({ type: "success", msg: "QR code generated" });
      } else {
        setFeedback({ type: "error", msg: result.stderr || "QR generation failed" });
      }
    } catch (e) {
      setFeedback({ type: "error", msg: e instanceof Error ? e.message : "QR generation failed" });
    }
    setActionLoading(null);
  };

  const pending = devices.filter(d => d.status === "pending");
  const paired = devices.filter(d => d.status === "paired");

  const isLoading = (key: string) => actionLoading === key;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Smartphone style={{ width: 18, height: 18, color: "var(--accent)" }} />
            <div>
              <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Devices</h2>
              <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted)" }}>
                {devices.length} device{devices.length !== 1 ? "s" : ""}
                {pending.length > 0 && <> &middot; <span style={{ color: "#fbbf24" }}>{pending.length} pending</span></>}
                {paired.length > 0 && <> &middot; <span style={{ color: "#4ade80" }}>{paired.length} paired</span></>}
              </p>
            </div>
          </div>
          <button onClick={loadDevices} disabled={loading} style={BTN_P}>
            <RefreshCw style={{ width: 12, height: 12, ...(loading ? { animation: "spin 1s linear infinite" } : {}) }} /> Refresh
          </button>
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
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 20px" }}>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
            <Loader2 style={{ width: 24, height: 24, color: "var(--accent)", animation: "spin 1s linear infinite" }} />
          </div>
        ) : error ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 8 }}>
            <AlertTriangle style={{ width: 24, height: 24, color: "#f87171" }} />
            <p style={{ fontSize: 12, color: "#f87171", textAlign: "center" }}>{error}</p>
            <button onClick={loadDevices} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "var(--bg-elevated)", color: "var(--text-secondary)", fontSize: 11, cursor: "pointer" }}>Retry</button>
          </div>
        ) : (
          <>
            {/* Pending Requests */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={SECT}>Pending Requests ({pending.length})</span>
                {pending.length > 0 && (
                  <button
                    onClick={() => exec("Approve Latest", "openclaw devices approve --latest")}
                    disabled={isLoading("Approve Latest")}
                    style={{ ...BTN_P, padding: "4px 10px", fontSize: 10 }}
                  >
                    {isLoading("Approve Latest")
                      ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} />
                      : <CheckCircle2 style={{ width: 10, height: 10 }} />}
                    Approve Latest
                  </button>
                )}
              </div>
              {pending.length === 0 ? (
                <div style={{ ...CARD, padding: "20px 14px", textAlign: "center" }}>
                  <Shield style={{ width: 24, height: 24, color: "var(--text-muted)", opacity: 0.3, margin: "0 auto 6px" }} />
                  <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>No pending pairing requests</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {pending.map(device => {
                    const reqId = device.requestId || device.id;
                    return (
                      <div key={device.id} style={CARD}>
                        <div style={{ ...ROW, borderBottom: "none" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{
                              width: 36, height: 36, borderRadius: 10, display: "flex",
                              alignItems: "center", justifyContent: "center",
                              background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)",
                            }}>
                              <Smartphone style={{ width: 16, height: 16, color: "#fbbf24" }} />
                            </div>
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{device.label || device.id}</span>
                                <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: 4, background: "rgba(251,191,36,0.15)", color: "#fbbf24", fontWeight: 600 }}>PENDING</span>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
                                <span style={{ fontSize: 10, color: "var(--text-muted)", ...MONO }}>{device.id}</span>
                                {device.role && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "var(--bg-hover)", color: "var(--text-muted)" }}>{device.role}</span>}
                                {device.scopes && device.scopes.length > 0 && (
                                  <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{device.scopes.join(", ")}</span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              onClick={() => exec(`Approve-${reqId}`, `openclaw devices approve ${reqId}`)}
                              disabled={isLoading(`Approve-${reqId}`)}
                              style={{ ...BTN_P, background: "rgba(74,222,128,0.15)", color: "#4ade80" }}
                            >
                              {isLoading(`Approve-${reqId}`)
                                ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} />
                                : <CheckCircle2 style={{ width: 10, height: 10 }} />}
                              Approve
                            </button>
                            <button
                              onClick={() => exec(`Reject-${reqId}`, `openclaw devices reject ${reqId}`)}
                              disabled={isLoading(`Reject-${reqId}`)}
                              style={BTN_DANGER}
                            >
                              {isLoading(`Reject-${reqId}`)
                                ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} />
                                : <XCircle style={{ width: 10, height: 10 }} />}
                              Reject
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Paired Devices */}
            <div style={{ marginBottom: 20 }}>
              <span style={SECT}>Paired Devices ({paired.length})</span>
              {paired.length === 0 ? (
                <div style={{ ...CARD, padding: "20px 14px", textAlign: "center" }}>
                  <Smartphone style={{ width: 24, height: 24, color: "var(--text-muted)", opacity: 0.3, margin: "0 auto 6px" }} />
                  <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>No paired devices</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {paired.map(device => (
                    <div key={device.id} style={CARD}>
                      <div style={ROW}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{
                            width: 36, height: 36, borderRadius: 10, display: "flex",
                            alignItems: "center", justifyContent: "center",
                            background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.2)",
                          }}>
                            <Smartphone style={{ width: 16, height: 16, color: "#4ade80" }} />
                          </div>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{device.label || device.id}</span>
                              <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: 4, background: "rgba(74,222,128,0.15)", color: "#4ade80", fontWeight: 600 }}>PAIRED</span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
                              <span style={{ fontSize: 10, color: "var(--text-muted)", ...MONO }}>{device.id}</span>
                              {device.role && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "var(--bg-hover)", color: "var(--text-muted)" }}>{device.role}</span>}
                              {device.scopes && device.scopes.length > 0 && (
                                <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{device.scopes.join(", ")}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => exec(`Remove-${device.id}`, `openclaw devices remove ${device.id}`)}
                          disabled={isLoading(`Remove-${device.id}`)}
                          style={BTN_DANGER}
                        >
                          {isLoading(`Remove-${device.id}`)
                            ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} />
                            : <Trash2 style={{ width: 10, height: 10 }} />}
                          Remove
                        </button>
                      </div>
                      {/* Token actions */}
                      <div style={{ padding: "8px 14px 10px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <Key style={{ width: 11, height: 11, color: "var(--text-muted)" }} />
                          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Token:</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <input
                            type="text" placeholder="role" value={rotateRole[device.id] || ""}
                            onChange={e => setRotateRole(prev => ({ ...prev, [device.id]: e.target.value }))}
                            style={{ width: 80, padding: "4px 8px", borderRadius: 4, background: "var(--bg-base)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 10, outline: "none", ...MONO }}
                          />
                          <button
                            onClick={() => exec(`Rotate-${device.id}`, `openclaw devices rotate --device ${device.id} --role ${rotateRole[device.id] || "default"}`)}
                            disabled={isLoading(`Rotate-${device.id}`)}
                            style={{ ...BTN_G, padding: "4px 8px", fontSize: 10, borderColor: "rgba(59,130,246,0.3)", color: "var(--accent)" }}
                          >
                            {isLoading(`Rotate-${device.id}`)
                              ? <Loader2 style={{ width: 9, height: 9, animation: "spin 1s linear infinite" }} />
                              : <RefreshCw style={{ width: 9, height: 9 }} />}
                            Rotate
                          </button>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <input
                            type="text" placeholder="role" value={revokeRole[device.id] || ""}
                            onChange={e => setRevokeRole(prev => ({ ...prev, [device.id]: e.target.value }))}
                            style={{ width: 80, padding: "4px 8px", borderRadius: 4, background: "var(--bg-base)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 10, outline: "none", ...MONO }}
                          />
                          <button
                            onClick={() => exec(`Revoke-${device.id}`, `openclaw devices revoke --device ${device.id} --role ${revokeRole[device.id] || "default"}`)}
                            disabled={isLoading(`Revoke-${device.id}`)}
                            style={{ ...BTN_DANGER, padding: "4px 8px", fontSize: 10 }}
                          >
                            {isLoading(`Revoke-${device.id}`)
                              ? <Loader2 style={{ width: 9, height: 9, animation: "spin 1s linear infinite" }} />
                              : <XCircle style={{ width: 9, height: 9 }} />}
                            Revoke
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pairing Section */}
            <div style={{ marginBottom: 20 }}>
              <span style={SECT}>Pairing</span>
              <div style={CARD}>
                <div style={{ padding: "12px 14px", display: "flex", gap: 8 }}>
                  <button onClick={generateQr} disabled={isLoading("qr")} style={BTN_P}>
                    {isLoading("qr")
                      ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />
                      : <QrCode style={{ width: 12, height: 12 }} />}
                    Generate QR Code
                  </button>
                  <button
                    onClick={() => exec("Start Pairing", "openclaw pairing start --json")}
                    disabled={isLoading("Start Pairing")}
                    style={BTN_P}
                  >
                    {isLoading("Start Pairing")
                      ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />
                      : <UserPlus style={{ width: 12, height: 12 }} />}
                    Start Pairing
                  </button>
                </div>
                {qrData && (
                  <div style={{ padding: "0 14px 12px" }}>
                    <pre style={{
                      margin: 0, padding: "8px 10px", borderRadius: 6,
                      background: "var(--bg-base)", border: "1px solid var(--border)",
                      fontSize: 11, ...MONO, color: "var(--text-secondary)",
                      whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 200, overflowY: "auto",
                    }}>
                      {JSON.stringify(qrData, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>

            {/* Bulk Actions */}
            <div>
              <span style={SECT}>Bulk Actions</span>
              <div style={CARD}>
                <div style={{ padding: "12px 14px", display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {confirmClear === "all" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, color: "#f87171", display: "flex", alignItems: "center", gap: 4 }}>
                        <AlertTriangle style={{ width: 12, height: 12 }} /> Remove ALL devices?
                      </span>
                      <button
                        onClick={() => { exec("Clear All", "openclaw devices clear --yes"); setConfirmClear(null); }}
                        disabled={isLoading("Clear All")}
                        style={{ ...BTN_DANGER, padding: "4px 10px" }}
                      >
                        {isLoading("Clear All") ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : "Confirm"}
                      </button>
                      <button onClick={() => setConfirmClear(null)} style={{ ...BTN_G, padding: "4px 10px" }}>Cancel</button>
                    </div>
                  ) : confirmClear === "pending" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, color: "#fbbf24", display: "flex", alignItems: "center", gap: 4 }}>
                        <AlertTriangle style={{ width: 12, height: 12 }} /> Remove all pending requests?
                      </span>
                      <button
                        onClick={() => { exec("Clear Pending", "openclaw devices clear --yes --pending"); setConfirmClear(null); }}
                        disabled={isLoading("Clear Pending")}
                        style={{ ...BTN_DANGER, padding: "4px 10px", borderColor: "rgba(251,191,36,0.3)", color: "#fbbf24", background: "rgba(251,191,36,0.08)" }}
                      >
                        {isLoading("Clear Pending") ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : "Confirm"}
                      </button>
                      <button onClick={() => setConfirmClear(null)} style={{ ...BTN_G, padding: "4px 10px" }}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <button onClick={() => setConfirmClear("all")} style={BTN_DANGER}>
                        <Trash2 style={{ width: 11, height: 11 }} /> Clear All Devices
                      </button>
                      <button onClick={() => setConfirmClear("pending")}
                        style={{ ...BTN_DANGER, borderColor: "rgba(251,191,36,0.3)", color: "#fbbf24", background: "rgba(251,191,36,0.08)" }}
                      >
                        <Trash2 style={{ width: 11, height: 11 }} /> Clear Pending Only
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
