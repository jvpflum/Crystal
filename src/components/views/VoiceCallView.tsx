import { useState, useCallback } from "react";
import {
  Phone,
  PhoneCall,
  PhoneOff,
  Send,
  Loader2,
  Settings,
  Radio,
  CheckCircle2,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { EASE, hoverLift, hoverReset, pressDown, pressUp, innerPanel, sectionLabel, inputStyle, btnPrimary, emptyState, MONO } from "@/styles/viewStyles";

interface CallRecord {
  id: string;
  to: string;
  mode: string;
  status: string;
  timestamp: string;
}

interface ActiveCall {
  id: string;
  to: string;
  mode: string;
  status: string;
}

type CallMode = "notify" | "converse";
type ExposeMode = "serve" | "funnel" | "off";

async function runCmd(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return invoke<{ stdout: string; stderr: string; code: number }>("execute_command", { command, cwd: null });
}

export function VoiceCallView() {
  const [callTo, setCallTo] = useState("");
  const [callMessage, setCallMessage] = useState("");
  const [callMode, setCallMode] = useState<CallMode>("notify");
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [continueMsg, setContinueMsg] = useState("");
  const [continueSending, setContinueSending] = useState(false);
  const [ending, setEnding] = useState(false);

  const [exposeMode, setExposeMode] = useState<ExposeMode>("serve");
  const [exposing, setExposing] = useState(false);
  const [exposeResult, setExposeResult] = useState<string | null>(null);

  const [callHistory, setCallHistory] = useState<CallRecord[]>([]);

  const showFeedback = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 2500);
  };

  const makeCall = useCallback(async () => {
    if (!callTo.trim() || !callMessage.trim()) return;
    setCalling(true);
    setError(null);
    try {
      const toEsc = callTo.trim().replace(/"/g, '\\"');
      const msgEsc = callMessage.trim().replace(/"/g, '\\"');
      const result = await runCmd(`openclaw voicecall call --to "${toEsc}" --message "${msgEsc}" --mode ${callMode}`);
      const output = result.stdout?.trim() || result.stderr?.trim() || "";

      if (result.code === 0) {
        let callId = "";
        try {
          const parsed = JSON.parse(output);
          callId = parsed.callId ?? parsed.call_id ?? parsed.id ?? "";
        } catch {
          const match = output.match(/(?:call[_-]?id|id)\s*[:=]\s*["']?([^\s"']+)/i);
          callId = match ? match[1] : output.slice(0, 32);
        }

        const newCall: ActiveCall = { id: callId, to: callTo.trim(), mode: callMode, status: "active" };
        setActiveCall(newCall);

        setCallHistory((prev) => [
          { id: callId, to: callTo.trim(), mode: callMode, status: "started", timestamp: new Date().toLocaleTimeString() },
          ...prev,
        ]);

        showFeedback(`Call initiated (ID: ${callId || "unknown"})`);
        setCallTo("");
        setCallMessage("");
      } else {
        setError(output || "Call failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to make call");
    }
    setCalling(false);
  }, [callTo, callMessage, callMode]);

  const checkStatus = async () => {
    if (!activeCall) return;
    setStatusLoading(true);
    try {
      const result = await runCmd(`openclaw voicecall status --call-id ${activeCall.id}`);
      const output = result.stdout?.trim() || result.stderr?.trim() || "";
      if (result.code === 0) {
        try {
          const parsed = JSON.parse(output);
          setActiveCall((prev) => prev ? { ...prev, status: parsed.status ?? parsed.state ?? "unknown" } : null);
        } catch {
          setActiveCall((prev) => prev ? { ...prev, status: output || "unknown" } : null);
        }
      } else {
        setError(output || "Failed to check status");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Status check failed");
    }
    setStatusLoading(false);
  };

  const continueCall = async () => {
    if (!activeCall || !continueMsg.trim()) return;
    setContinueSending(true);
    try {
      const msgEsc = continueMsg.trim().replace(/"/g, '\\"');
      const result = await runCmd(`openclaw voicecall continue --call-id ${activeCall.id} --message "${msgEsc}"`);
      const output = result.stdout?.trim() || result.stderr?.trim() || "";
      if (result.code === 0) {
        showFeedback("Message sent to call");
        setContinueMsg("");
      } else {
        setError(output || "Failed to continue call");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Continue failed");
    }
    setContinueSending(false);
  };

  const endCall = async () => {
    if (!activeCall) return;
    setEnding(true);
    try {
      const result = await runCmd(`openclaw voicecall end --call-id ${activeCall.id}`);
      if (result.code === 0) {
        setCallHistory((prev) =>
          prev.map((c) => c.id === activeCall.id ? { ...c, status: "ended" } : c),
        );
        setActiveCall(null);
        showFeedback("Call ended");
      } else {
        const output = result.stdout?.trim() || result.stderr?.trim() || "";
        setError(output || "Failed to end call");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "End call failed");
    }
    setEnding(false);
  };

  const handleExpose = async () => {
    setExposing(true);
    setExposeResult(null);
    try {
      const result = await runCmd(`openclaw voicecall expose --mode ${exposeMode}`);
      const output = result.stdout?.trim() || result.stderr?.trim() || "";
      if (result.code === 0) {
        setExposeResult(output || `Expose mode set to ${exposeMode}`);
      } else {
        setError(output || "Failed to set expose mode");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Expose failed");
    }
    setExposing(false);
  };

  const statusColor = (s: string) => {
    if (s === "active" || s === "connected" || s === "in_progress") return "var(--success)";
    if (s === "ended" || s === "completed") return "var(--text-muted)";
    if (s === "failed" || s === "error") return "var(--error)";
    return "var(--accent)";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px 10px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Phone style={{ width: 16, height: 16, color: "var(--accent)" }} />
          <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Voice Calls</h2>
          {activeCall && (
            <span style={{
              fontSize: 10, padding: "2px 8px", borderRadius: 10,
              background: "rgba(74,222,128,0.1)", color: "var(--success)",
              border: "1px solid rgba(74,222,128,0.2)",
              display: "flex", alignItems: "center", gap: 4,
            }}>
              <PhoneCall style={{ width: 9, height: 9 }} /> Active
            </span>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "0 20px 20px" }}>
        {/* Error */}
        {error && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", marginBottom: 12 }}>
            <PhoneOff style={{ width: 14, height: 14, color: "var(--error)", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "var(--error)", flex: 1 }}>{error}</span>
            <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 14, cursor: "pointer" }}>×</button>
          </div>
        )}

        {/* Feedback */}
        {feedback && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.2)", marginBottom: 12 }}>
            <CheckCircle2 style={{ width: 14, height: 14, color: "var(--success)", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "var(--success)" }}>{feedback}</span>
          </div>
        )}

        {/* Call Form */}
        <div style={{ marginBottom: 16 }}>
          <SectionLabel text="MAKE A CALL" />
          <div style={{ ...innerPanel, padding: "14px" }} onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
            {/* To */}
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                To <span style={{ color: "var(--error)" }}>*</span>
              </label>
              <input
                value={callTo}
                onChange={(e) => setCallTo(e.target.value)}
                placeholder="+1 (555) 123-4567"
                style={{
                  ...inputStyle, fontFamily: MONO, boxSizing: "border-box",
                }}
              />
            </div>

            {/* Message */}
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                Message <span style={{ color: "var(--error)" }}>*</span>
              </label>
              <textarea
                value={callMessage}
                onChange={(e) => setCallMessage(e.target.value)}
                placeholder="What should the agent say?"
                rows={3}
                style={{
                  ...inputStyle, resize: "vertical",
                  fontFamily: "inherit", boxSizing: "border-box",
                }}
              />
            </div>

            {/* Mode */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Mode</label>
              <div style={{ display: "flex", gap: 6 }}>
                {(["notify", "converse"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setCallMode(m)}
                    style={{
                      flex: 1, padding: "7px 10px", borderRadius: 6, fontSize: 11, fontWeight: 500,
                      cursor: "pointer", textTransform: "capitalize",
                      background: callMode === m ? "var(--accent-bg)" : "var(--bg-hover)",
                      color: callMode === m ? "var(--accent)" : "var(--text-muted)",
                      border: `1px solid ${callMode === m ? "rgba(59,130,246,0.3)" : "var(--border)"}`,
                    }}
                  >
                    {m === "notify" && <Radio style={{ width: 10, height: 10, marginRight: 4, verticalAlign: "middle" }} />}
                    {m === "converse" && <PhoneCall style={{ width: 10, height: 10, marginRight: 4, verticalAlign: "middle" }} />}
                    {m}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 9, color: "var(--text-muted)", margin: "4px 0 0", opacity: 0.7 }}>
                {callMode === "notify" ? "One-way: deliver message and hang up" : "Two-way: agent converses with the recipient"}
              </p>
            </div>

            <button
              onClick={makeCall}
              disabled={calling || !callTo.trim() || !callMessage.trim()}
              onMouseDown={pressDown}
              onMouseUp={pressUp}
              style={{
                ...btnPrimary,
                width: "100%", padding: "9px 14px",
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                opacity: calling || !callTo.trim() || !callMessage.trim() ? 0.5 : 1,
              }}
            >
              {calling ? <Loader2 style={{ width: 13, height: 13, animation: "spin 1s linear infinite" }} /> : <Phone style={{ width: 13, height: 13 }} />}
              Place Call
            </button>
          </div>
        </div>

        {/* Active Call Panel */}
        {activeCall && (
          <div style={{ marginBottom: 16 }}>
            <SectionLabel text="ACTIVE CALL" />
            <div style={{
              ...innerPanel, border: "1px solid rgba(74,222,128,0.2)",
              padding: "14px",
            }} onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
              {/* Call info */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: "rgba(74,222,128,0.1)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <PhoneCall style={{ width: 16, height: 16, color: "var(--success)" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", fontFamily: MONO }}>{activeCall.to}</span>
                    <span style={{
                      fontSize: 9, padding: "2px 7px", borderRadius: 8,
                      background: `color-mix(in srgb, ${statusColor(activeCall.status)} 12%, transparent)`,
                      color: statusColor(activeCall.status),
                    }}>
                      {activeCall.status}
                    </span>
                    <span style={{
                      fontSize: 9, padding: "2px 7px", borderRadius: 8,
                      background: "var(--bg-hover)", color: "var(--text-muted)",
                      textTransform: "capitalize",
                    }}>
                      {activeCall.mode}
                    </span>
                  </div>
                  <code style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: MONO }}>ID: {activeCall.id}</code>
                </div>
              </div>

              {/* Status + End buttons */}
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <button
                  onClick={checkStatus}
                  disabled={statusLoading}
                  style={{
                    flex: 1, padding: "7px 12px", borderRadius: 6, border: "none",
                    background: "var(--accent-bg)", color: "var(--accent)",
                    fontSize: 11, fontWeight: 500, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    opacity: statusLoading ? 0.6 : 1,
                  }}
                >
                  {statusLoading ? <Loader2 style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} /> : <Radio style={{ width: 11, height: 11 }} />}
                  Check Status
                </button>
                <button
                  onClick={endCall}
                  disabled={ending}
                  style={{
                    flex: 1, padding: "7px 12px", borderRadius: 6, border: "none",
                    background: "rgba(248,113,113,0.12)", color: "var(--error)",
                    fontSize: 11, fontWeight: 500, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    opacity: ending ? 0.6 : 1,
                  }}
                >
                  {ending ? <Loader2 style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} /> : <PhoneOff style={{ width: 11, height: 11 }} />}
                  End Call
                </button>
              </div>

              {/* Continue */}
              {activeCall.mode === "converse" && (
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    value={continueMsg}
                    onChange={(e) => setContinueMsg(e.target.value)}
                    placeholder="Send follow-up message..."
                    onKeyDown={(e) => e.key === "Enter" && continueCall()}
                    style={{
                      flex: 1, fontSize: 12, padding: "7px 10px", borderRadius: 6,
                      border: "1px solid var(--border)", background: "var(--bg-hover)",
                      color: "var(--text)", outline: "none",
                    }}
                  />
                  <button
                    onClick={continueCall}
                    disabled={continueSending || !continueMsg.trim()}
                    style={{
                      padding: "7px 12px", borderRadius: 6, border: "none",
                      background: "var(--accent)", color: "#fff",
                      fontSize: 11, fontWeight: 500, cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 4,
                      opacity: continueSending || !continueMsg.trim() ? 0.5 : 1,
                    }}
                  >
                    {continueSending ? <Loader2 style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} /> : <Send style={{ width: 11, height: 11 }} />}
                    Send
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Expose Webhooks */}
        <div style={{ marginBottom: 16 }}>
          <SectionLabel text="EXPOSE WEBHOOKS" />
          <div style={{ ...innerPanel, padding: "14px" }} onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              {(["serve", "funnel", "off"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setExposeMode(m)}
                  style={{
                    flex: 1, padding: "7px 10px", borderRadius: 6, fontSize: 11, fontWeight: 500,
                    cursor: "pointer", textTransform: "capitalize",
                    background: exposeMode === m ? "var(--accent-bg)" : "var(--bg-hover)",
                    color: exposeMode === m ? "var(--accent)" : "var(--text-muted)",
                    border: `1px solid ${exposeMode === m ? "rgba(59,130,246,0.3)" : "var(--border)"}`,
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
            <button
              onClick={handleExpose}
              disabled={exposing}
              onMouseDown={pressDown}
              onMouseUp={pressUp}
              style={{
                width: "100%", padding: "8px 14px", borderRadius: 8, border: "none",
                background: "rgba(168,85,247,0.12)", color: "#c084fc",
                fontSize: 11, fontWeight: 500, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                opacity: exposing ? 0.6 : 1,
              }}
            >
              {exposing ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Settings style={{ width: 12, height: 12 }} />}
              Apply Expose Mode
            </button>

            {exposeResult && (
              <div style={{
                marginTop: 10, padding: "8px 10px", borderRadius: 6, fontSize: 10, fontFamily: MONO,
                background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.2)",
                color: "var(--success)", whiteSpace: "pre-wrap", wordBreak: "break-word", transition: `all 0.2s ${EASE}`,
              }}>
                {exposeResult}
              </div>
            )}
          </div>
        </div>

        {/* Call History */}
        <div style={{ marginBottom: 16 }}>
          <SectionLabel text={`CALL HISTORY (${callHistory.length})`} />

          {callHistory.length === 0 ? (
            <div style={{ ...emptyState, ...innerPanel }}>
              <Phone style={{ width: 28, height: 28, color: "var(--text-muted)", opacity: 0.4 }} />
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>No calls made yet</p>
              <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "4px 0 0", opacity: 0.7 }}>Calls placed during this session will appear here</p>
            </div>
          ) : (
            <div style={{ ...innerPanel, overflow: "hidden" }}>
              {callHistory.map((call, i) => (
                <div
                  key={`${call.id}-${i}`}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                    borderBottom: i < callHistory.length - 1 ? "1px solid var(--border)" : "none",
                  }}
                >
                  <Phone style={{ width: 12, height: 12, color: "var(--text-muted)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text)", fontFamily: MONO }}>{call.to}</span>
                      <span style={{
                        fontSize: 9, padding: "1px 6px", borderRadius: 8,
                        background: `color-mix(in srgb, ${statusColor(call.status)} 12%, transparent)`,
                        color: statusColor(call.status),
                      }}>
                        {call.status}
                      </span>
                      <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: "var(--bg-hover)", color: "var(--text-muted)", textTransform: "capitalize" }}>
                        {call.mode}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                      <code style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: MONO }}>{call.id}</code>
                      <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{call.timestamp}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <span style={{ ...sectionLabel, display: "block", marginBottom: 8 }}>
      {text}
    </span>
  );
}
