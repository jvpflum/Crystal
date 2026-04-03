import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Mail,
  Send,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  Radio,
  BarChart3,
  X,
} from "lucide-react";

/* ── Types ── */

interface ChannelEntry {
  id: string;
  label: string;
}

interface SentMessage {
  id: string;
  channel: string;
  target: string;
  body: string;
  timestamp: number;
  success: boolean;
  isPoll?: boolean;
}

/* ── CLI helper ── */

async function runCli(command: string): Promise<string> {
  try {
    const result = await invoke<{ stdout: string; stderr: string; code: number }>(
      "execute_command",
      { command, cwd: null },
    );
    if (result.code !== 0 && result.stderr?.trim()) throw new Error(result.stderr.trim());
    return result.stdout;
  } catch (e) {
    throw new Error(String(e));
  }
}

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const STORAGE_TARGETS = "crystal-messaging-quick-targets";
const STORAGE_HISTORY = "crystal-messaging-history";
const PREFILL_KEY = "crystal-messaging-prefill";

function loadQuickTargets(): { channel: string; target: string }[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_TARGETS) || "[]");
  } catch {
    return [];
  }
}

function saveQuickTargets(targets: { channel: string; target: string }[]) {
  localStorage.setItem(STORAGE_TARGETS, JSON.stringify(targets.slice(0, 12)));
}

function loadHistory(): SentMessage[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_HISTORY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(history: SentMessage[]) {
  localStorage.setItem(STORAGE_HISTORY, JSON.stringify(history.slice(0, 50)));
}

/* ── Shared styles ── */

const cardStyle: React.CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "12px 14px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  background: "var(--bg-input, var(--bg-hover))",
  border: "1px solid var(--border)",
  color: "var(--text)",
  fontSize: 12,
  outline: "none",
  boxSizing: "border-box" as const,
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--text-muted)",
  fontWeight: 500,
  display: "block",
  marginBottom: 4,
};

/* ══════════════════════════════════════════════════════════════
   MESSAGING VIEW
   ══════════════════════════════════════════════════════════════ */

export function MessagingView() {
  const [channels, setChannels] = useState<ChannelEntry[]>([]);
  const [channel, setChannel] = useState("");
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; text: string } | null>(null);

  const [pollMode, setPollMode] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [pollMulti, setPollMulti] = useState(false);
  const [pollDuration, setPollDuration] = useState("");

  const [history, setHistory] = useState<SentMessage[]>(loadHistory);
  const [quickTargets, setQuickTargets] = useState(loadQuickTargets);

  const fetchChannels = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await runCli("openclaw channels list --json");
      const data = JSON.parse(raw);
      const entries: ChannelEntry[] = [];

      if (data.channelMeta) {
        for (const m of data.channelMeta as { id: string; label: string }[]) {
          entries.push({ id: m.id, label: m.label || m.id });
        }
      } else if (data.chat) {
        for (const type of Object.keys(data.chat)) {
          entries.push({ id: type, label: type });
        }
      } else if (Array.isArray(data)) {
        for (const ch of data) {
          const id = typeof ch === "string" ? ch : ch.id || ch.name || ch.type;
          entries.push({ id, label: ch.label || id });
        }
      } else {
        for (const key of Object.keys(data)) {
          entries.push({ id: key, label: key });
        }
      }

      setChannels(entries);
      if (entries.length > 0 && !channel) setChannel(entries[0].id);
    } catch {
      setChannels([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  useEffect(() => {
    try {
      const prefill = localStorage.getItem(PREFILL_KEY);
      if (prefill) {
        const data = JSON.parse(prefill);
        if (data.channel) setChannel(data.channel);
        if (data.target) setTarget(data.target);
        localStorage.removeItem(PREFILL_KEY);
      }
    } catch { /* ignore */ }
  }, []);

  const addToQuickTargets = useCallback(
    (ch: string, tgt: string) => {
      const existing = quickTargets.filter(
        (q) => !(q.channel === ch && q.target === tgt),
      );
      const updated = [{ channel: ch, target: tgt }, ...existing];
      setQuickTargets(updated);
      saveQuickTargets(updated);
    },
    [quickTargets],
  );

  const addToHistory = useCallback(
    (msg: SentMessage) => {
      const updated = [msg, ...history];
      setHistory(updated);
      saveHistory(updated);
    },
    [history],
  );

  const handleSendMessage = async () => {
    if (!channel || !target.trim() || !message.trim()) return;
    setSending(true);
    setSendResult(null);
    try {
      const cmd = `openclaw message send --channel ${channel} --target "${esc(target.trim())}" --message "${esc(message.trim())}"`;
      await runCli(cmd);
      setSendResult({ ok: true, text: "Message sent successfully" });
      addToQuickTargets(channel, target.trim());
      addToHistory({
        id: `msg-${Date.now()}`,
        channel,
        target: target.trim(),
        body: message.trim(),
        timestamp: Date.now(),
        success: true,
      });
      setMessage("");
    } catch (e) {
      const errText = e instanceof Error ? e.message : String(e);
      setSendResult({ ok: false, text: errText });
      addToHistory({
        id: `msg-${Date.now()}`,
        channel,
        target: target.trim(),
        body: message.trim(),
        timestamp: Date.now(),
        success: false,
      });
    }
    setSending(false);
    setTimeout(() => setSendResult(null), 4000);
  };

  const handleSendPoll = async () => {
    if (!channel || !target.trim() || !pollQuestion.trim()) return;
    const validOpts = pollOptions.filter((o) => o.trim());
    if (validOpts.length < 2) return;
    setSending(true);
    setSendResult(null);
    try {
      let cmd = `openclaw message poll --channel ${channel} --target "${esc(target.trim())}" --poll-question "${esc(pollQuestion.trim())}"`;
      for (const opt of validOpts) {
        cmd += ` --poll-option "${esc(opt.trim())}"`;
      }
      if (pollMulti) cmd += " --poll-multi";
      if (pollDuration.trim()) cmd += ` --poll-duration-hours ${pollDuration.trim()}`;
      await runCli(cmd);
      setSendResult({ ok: true, text: "Poll sent successfully" });
      addToQuickTargets(channel, target.trim());
      addToHistory({
        id: `poll-${Date.now()}`,
        channel,
        target: target.trim(),
        body: `📊 ${pollQuestion.trim()} [${validOpts.join(", ")}]`,
        timestamp: Date.now(),
        success: true,
        isPoll: true,
      });
      setPollQuestion("");
      setPollOptions(["", ""]);
      setPollMulti(false);
      setPollDuration("");
    } catch (e) {
      const errText = e instanceof Error ? e.message : String(e);
      setSendResult({ ok: false, text: errText });
    }
    setSending(false);
    setTimeout(() => setSendResult(null), 4000);
  };

  const addPollOption = () => setPollOptions([...pollOptions, ""]);
  const removePollOption = (i: number) => {
    if (pollOptions.length <= 2) return;
    setPollOptions(pollOptions.filter((_, idx) => idx !== i));
  };
  const updatePollOption = (i: number, val: string) => {
    const next = [...pollOptions];
    next[i] = val;
    setPollOptions(next);
  };

  const removeQuickTarget = (ch: string, tgt: string) => {
    const updated = quickTargets.filter(
      (q) => !(q.channel === ch && q.target === tgt),
    );
    setQuickTargets(updated);
    saveQuickTargets(updated);
  };

  const clearHistory = () => {
    setHistory([]);
    saveHistory([]);
  };

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* ── Left: Compose ── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "auto",
          padding: "14px 20px 20px",
          borderRight: "1px solid var(--border)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "var(--accent-bg)",
              border: "1px solid rgba(59,130,246,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Mail style={{ width: 18, height: 18, color: "var(--accent)" }} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--text)" }}>
              Messaging
            </h2>
            <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)" }}>
              Send messages &amp; polls across OpenClaw channels
            </p>
          </div>
        </div>

        {/* Channel selector */}
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Channel</label>
          {loading ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: 8,
              }}
            >
              <Loader2
                style={{
                  width: 12,
                  height: 12,
                  color: "var(--text-muted)",
                  animation: "spin 1s linear infinite",
                }}
              />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Loading channels...
              </span>
            </div>
          ) : channels.length === 0 ? (
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
              No channels found. Add channels in the Channels view.
            </p>
          ) : (
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              style={{
                ...inputStyle,
                cursor: "pointer",
              }}
            >
              {channels.map((ch) => (
                <option
                  key={ch.id}
                  value={ch.id}
                  style={{ background: "var(--bg-primary)" }}
                >
                  {ch.label}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Target */}
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Target (recipient)</label>
          <input
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="Phone number, chat ID, channel ID..."
            style={inputStyle}
          />
        </div>

        {/* Mode toggle */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          <button
            onClick={() => setPollMode(false)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "6px 14px",
              borderRadius: 8,
              border: !pollMode ? "1px solid var(--accent)" : "1px solid var(--border)",
              background: !pollMode ? "var(--accent-bg)" : "var(--bg-elevated)",
              color: !pollMode ? "var(--accent)" : "var(--text-muted)",
              fontSize: 11,
              fontWeight: !pollMode ? 600 : 400,
              cursor: "pointer",
            }}
          >
            <Send style={{ width: 11, height: 11 }} />
            Message
          </button>
          <button
            onClick={() => setPollMode(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "6px 14px",
              borderRadius: 8,
              border: pollMode ? "1px solid var(--accent)" : "1px solid var(--border)",
              background: pollMode ? "var(--accent-bg)" : "var(--bg-elevated)",
              color: pollMode ? "var(--accent)" : "var(--text-muted)",
              fontSize: 11,
              fontWeight: pollMode ? 600 : 400,
              cursor: "pointer",
            }}
          >
            <BarChart3 style={{ width: 11, height: 11 }} />
            Poll
          </button>
        </div>

        {/* Message composer */}
        {!pollMode ? (
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your message..."
              rows={5}
              style={{
                ...inputStyle,
                resize: "vertical",
                minHeight: 80,
                fontFamily: "inherit",
              }}
            />
          </div>
        ) : (
          /* Poll composer */
          <div
            style={{
              ...cardStyle,
              marginBottom: 14,
            }}
          >
            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>Poll Question</label>
              <input
                type="text"
                value={pollQuestion}
                onChange={(e) => setPollQuestion(e.target.value)}
                placeholder="What should we have for lunch?"
                style={inputStyle}
              />
            </div>

            <label style={labelStyle}>Options (min 2)</label>
            {pollOptions.map((opt, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 6,
                  marginBottom: 6,
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    width: 18,
                    fontSize: 10,
                    color: "var(--text-muted)",
                    textAlign: "center",
                    flexShrink: 0,
                  }}
                >
                  {i + 1}
                </span>
                <input
                  type="text"
                  value={opt}
                  onChange={(e) => updatePollOption(i, e.target.value)}
                  placeholder={`Option ${i + 1}`}
                  style={{ ...inputStyle, flex: 1 }}
                />
                {pollOptions.length > 2 && (
                  <button
                    onClick={() => removePollOption(i)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--text-muted)",
                      padding: 2,
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <Trash2 style={{ width: 11, height: 11 }} />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={addPollOption}
              style={{
                width: "100%",
                padding: "4px 0",
                borderRadius: 6,
                border: "1px dashed var(--border)",
                background: "transparent",
                color: "var(--text-muted)",
                fontSize: 10,
                cursor: "pointer",
                marginBottom: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
              }}
            >
              <Plus style={{ width: 10, height: 10 }} /> Add Option
            </button>

            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={pollMulti}
                  onChange={(e) => setPollMulti(e.target.checked)}
                  style={{ margin: 0 }}
                />
                Multi-select
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <label style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                  Duration (hrs)
                </label>
                <input
                  type="number"
                  value={pollDuration}
                  onChange={(e) => setPollDuration(e.target.value)}
                  placeholder="24"
                  min="1"
                  style={{
                    ...inputStyle,
                    width: 60,
                    padding: "4px 6px",
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Send button */}
        <button
          onClick={pollMode ? handleSendPoll : handleSendMessage}
          disabled={
            sending ||
            !channel ||
            !target.trim() ||
            (pollMode
              ? !pollQuestion.trim() || pollOptions.filter((o) => o.trim()).length < 2
              : !message.trim())
          }
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "10px 0",
            borderRadius: 8,
            border: "none",
            fontSize: 12,
            fontWeight: 600,
            cursor: sending ? "wait" : "pointer",
            background: "var(--accent)",
            color: "#fff",
            opacity:
              sending ||
              !channel ||
              !target.trim() ||
              (pollMode
                ? !pollQuestion.trim() || pollOptions.filter((o) => o.trim()).length < 2
                : !message.trim())
                ? 0.5
                : 1,
          }}
        >
          {sending ? (
            <>
              <Loader2
                style={{
                  width: 14,
                  height: 14,
                  animation: "spin 1s linear infinite",
                }}
              />
              Sending...
            </>
          ) : (
            <>
              <Send style={{ width: 14, height: 14 }} />
              {pollMode ? "Send Poll" : "Send Message"}
            </>
          )}
        </button>

        {/* Result toast */}
        {sendResult && (
          <div
            style={{
              marginTop: 10,
              padding: "8px 12px",
              borderRadius: 8,
              fontSize: 11,
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: sendResult.ok
                ? "rgba(74,222,128,0.1)"
                : "rgba(248,113,113,0.1)",
              border: sendResult.ok
                ? "1px solid rgba(74,222,128,0.2)"
                : "1px solid rgba(248,113,113,0.2)",
              color: sendResult.ok ? "#4ade80" : "#f87171",
            }}
          >
            {sendResult.ok ? (
              <CheckCircle2 style={{ width: 13, height: 13, flexShrink: 0 }} />
            ) : (
              <X style={{ width: 13, height: 13, flexShrink: 0 }} />
            )}
            <span style={{ flex: 1, wordBreak: "break-word" }}>
              {sendResult.text}
            </span>
          </div>
        )}
      </div>

      {/* ── Right: Channel info + history ── */}
      <div
        style={{
          width: 300,
          flexShrink: 0,
          overflow: "auto",
          padding: "14px 16px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* Quick targets */}
        <div>
          <SectionTitle text="Quick Targets" />
          {quickTargets.length === 0 ? (
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
              Recently used targets will appear here
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {quickTargets.map((qt, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 8px",
                    borderRadius: 6,
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <button
                    onClick={() => {
                      setChannel(qt.channel);
                      setTarget(qt.target);
                    }}
                    style={{
                      flex: 1,
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                      padding: 0,
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--text)",
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {qt.target}
                    </span>
                    <span style={{ fontSize: 9, color: "var(--text-muted)" }}>
                      {qt.channel}
                    </span>
                  </button>
                  <button
                    onClick={() => removeQuickTarget(qt.channel, qt.target)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--text-muted)",
                      padding: 2,
                      display: "flex",
                      alignItems: "center",
                      flexShrink: 0,
                    }}
                  >
                    <X style={{ width: 10, height: 10 }} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Channel info */}
        {channel && (
          <div>
            <SectionTitle text="Active Channel" />
            <div style={cardStyle}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Radio
                  style={{
                    width: 14,
                    height: 14,
                    color: "var(--accent)",
                    flexShrink: 0,
                  }}
                />
                <div>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--text)",
                      display: "block",
                    }}
                  >
                    {channels.find((c) => c.id === channel)?.label || channel}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    {channel}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Message history */}
        <div style={{ flex: 1, minHeight: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <SectionTitle text="Message History" style={{ margin: 0 }} />
            {history.length > 0 && (
              <button
                onClick={clearHistory}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  fontSize: 9,
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                }}
              >
                <Trash2 style={{ width: 9, height: 9 }} /> Clear
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
              No messages sent yet
            </p>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                maxHeight: 400,
                overflowY: "auto",
              }}
            >
              {history.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginBottom: 3,
                    }}
                  >
                    {msg.isPoll ? (
                      <BarChart3
                        style={{
                          width: 10,
                          height: 10,
                          color: "#a855f7",
                          flexShrink: 0,
                        }}
                      />
                    ) : (
                      <Send
                        style={{
                          width: 10,
                          height: 10,
                          color: "var(--accent)",
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--text-muted)",
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {msg.channel} → {msg.target}
                    </span>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: msg.success
                          ? "var(--success, #4ade80)"
                          : "var(--error, #f87171)",
                        flexShrink: 0,
                      }}
                    />
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 11,
                      color: "var(--text-secondary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {msg.body}
                  </p>
                  <span
                    style={{
                      fontSize: 9,
                      color: "var(--text-muted)",
                      marginTop: 2,
                      display: "block",
                    }}
                  >
                    {new Date(msg.timestamp).toLocaleString()}
                  </span>
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

/* ── Sub-components ── */

function SectionTitle({
  text,
  style,
}: {
  text: string;
  style?: React.CSSProperties;
}) {
  return (
    <p
      style={{
        fontSize: 10,
        textTransform: "uppercase",
        color: "var(--text-muted)",
        letterSpacing: "0.06em",
        fontWeight: 600,
        marginBottom: 8,
        marginTop: 0,
        ...style,
      }}
    >
      {text}
    </p>
  );
}
