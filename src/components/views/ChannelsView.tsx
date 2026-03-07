import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Radio,
  Loader2,
  Plus,
  Trash2,
  RefreshCw,
  Search,
  Shield,
  LogIn,
  LogOut,
  ChevronRight,
  ExternalLink,
} from "lucide-react";

const CHANNEL_TYPES: Record<string, { emoji: string; label: string }> = {
  whatsapp: { emoji: "💬", label: "WhatsApp" },
  telegram: { emoji: "✈️", label: "Telegram" },
  discord: { emoji: "🎮", label: "Discord" },
  slack: { emoji: "💼", label: "Slack" },
  signal: { emoji: "🔒", label: "Signal" },
  imessage: { emoji: "🍎", label: "iMessage" },
  googlechat: { emoji: "🟢", label: "Google Chat" },
  email: { emoji: "📧", label: "Email" },
  matrix: { emoji: "🔷", label: "Matrix" },
  irc: { emoji: "📡", label: "IRC" },
  linear: { emoji: "📐", label: "Linear" },
  nostr: { emoji: "🟣", label: "Nostr" },
};

interface Channel {
  name: string;
  type: string;
  status: "connected" | "disconnected" | "error";
  capabilities?: string[];
  config?: Record<string, unknown>;
}

async function runCli(command: string): Promise<string> {
  try {
    const result = await invoke("execute_command", { command });
    return result as string;
  } catch (e) {
    throw new Error(String(e));
  }
}

async function fetchChannels(): Promise<Channel[]> {
  try {
    const raw = await runCli("npx openclaw channels list --json");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function fetchStatus(): Promise<Record<string, string>> {
  try {
    const raw = await runCli("npx openclaw channels status --json");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function fetchCapabilities(name: string): Promise<string[]> {
  try {
    const raw = await runCli("npx openclaw channels capabilities --json");
    const data = JSON.parse(raw);
    return data[name] ?? data ?? [];
  } catch {
    return [];
  }
}

export function ChannelsView() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addType, setAddType] = useState("telegram");
  const [addToken, setAddToken] = useState("");
  const [addError, setAddError] = useState("");
  const [resolveQuery, setResolveQuery] = useState("");
  const [resolveResult, setResolveResult] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [list, statusMap] = await Promise.all([fetchChannels(), fetchStatus()]);
      const merged = list.map((ch) => ({
        ...ch,
        status: (statusMap[ch.name] as Channel["status"]) ?? ch.status,
      }));
      setChannels(merged);
    } catch {
      setChannels([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const selected = channels.find((c) => c.name === selectedName) ?? null;

  useEffect(() => {
    if (!selected) {
      setCapabilities([]);
      return;
    }
    fetchCapabilities(selected.name).then(setCapabilities);
  }, [selected]);

  const handleLogin = async (name: string) => {
    setActionLoading(name);
    try {
      await runCli(`npx openclaw channels login --channel ${name}`);
    } catch { /* */ }
    await loadAll();
    setActionLoading(null);
  };

  const handleLogout = async (name: string) => {
    setActionLoading(name);
    try {
      await runCli(`npx openclaw channels logout --channel ${name}`);
    } catch { /* */ }
    await loadAll();
    setActionLoading(null);
  };

  const handleRemove = async (name: string) => {
    setActionLoading(name);
    try {
      await runCli(`npx openclaw channels remove --channel ${name}`);
    } catch { /* */ }
    setSelectedName(null);
    await loadAll();
    setActionLoading(null);
  };

  const handleAdd = async () => {
    if (!addToken.trim()) {
      setAddError("Token is required");
      return;
    }
    setAddError("");
    setActionLoading("add");
    try {
      await runCli(`npx openclaw channels add --channel ${addType} --token ${addToken.trim()}`);
      setAddToken("");
      setShowAddForm(false);
      await loadAll();
    } catch (e) {
      setAddError(String(e));
    }
    setActionLoading(null);
  };

  const handleResolve = async (name: string) => {
    if (!resolveQuery.trim()) return;
    setActionLoading("resolve");
    try {
      const raw = await runCli(
        `npx openclaw channels resolve --channel ${name} --query ${resolveQuery.trim()}`
      );
      setResolveResult(raw);
    } catch (e) {
      setResolveResult(`Error: ${e}`);
    }
    setActionLoading(null);
  };

  const statusColor = (s: string) =>
    s === "connected" ? "#4ade80" : s === "error" ? "#f87171" : "rgba(255,255,255,0.3)";


  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Left panel */}
      <div
        style={{
          width: 260,
          flexShrink: 0,
          borderRight: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "14px 16px 10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h2 style={{ color: "white", fontSize: 15, fontWeight: 600, margin: 0 }}>Channels</h2>
            <p style={{ margin: "4px 0 0", fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
              {channels.filter((c) => c.status === "connected").length} connected &middot;{" "}
              {channels.length} total
            </p>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={() => loadAll()}
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 6,
                padding: "5px 6px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                color: "rgba(255,255,255,0.5)",
              }}
            >
              <RefreshCw style={{ width: 12, height: 12 }} />
            </button>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              style={{
                background: "rgba(59,130,246,0.15)",
                border: "1px solid rgba(59,130,246,0.2)",
                borderRadius: 6,
                padding: "5px 6px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                color: "#60a5fa",
              }}
            >
              <Plus style={{ width: 12, height: 12 }} />
            </button>
          </div>
        </div>

        {/* Add channel form */}
        {showAddForm && (
          <div
            style={{
              margin: "0 8px 8px",
              padding: 12,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 10,
            }}
          >
            <p
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.35)",
                letterSpacing: 1,
                margin: "0 0 8px",
                fontWeight: 600,
              }}
            >
              Add Channel
            </p>
            <select
              value={addType}
              onChange={(e) => setAddType(e.target.value)}
              style={{
                width: "100%",
                padding: "6px 8px",
                borderRadius: 6,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "white",
                fontSize: 12,
                marginBottom: 6,
                outline: "none",
              }}
            >
              {Object.entries(CHANNEL_TYPES).map(([key, { emoji, label }]) => (
                <option key={key} value={key} style={{ background: "#1a1a2e" }}>
                  {emoji} {label}
                </option>
              ))}
            </select>
            <input
              type="password"
              placeholder="Token / API key"
              value={addToken}
              onChange={(e) => setAddToken(e.target.value)}
              style={{
                width: "100%",
                padding: "6px 8px",
                borderRadius: 6,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "white",
                fontSize: 12,
                marginBottom: 8,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            {addError && (
              <p style={{ fontSize: 10, color: "#f87171", margin: "0 0 6px" }}>{addError}</p>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={handleAdd}
                disabled={actionLoading === "add"}
                style={{
                  flex: 1,
                  padding: "5px 0",
                  borderRadius: 6,
                  border: "none",
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: "pointer",
                  background: "rgba(59,130,246,0.15)",
                  color: "#60a5fa",
                }}
              >
                {actionLoading === "add" ? "Adding..." : "Add"}
              </button>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setAddError("");
                }}
                style={{
                  padding: "5px 10px",
                  borderRadius: 6,
                  border: "none",
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: "pointer",
                  background: "rgba(255,255,255,0.05)",
                  color: "rgba(255,255,255,0.5)",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Channel list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>
          {loading ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 40,
              }}
            >
              <Loader2
                style={{
                  width: 18,
                  height: 18,
                  color: "rgba(255,255,255,0.3)",
                  animation: "spin 1s linear infinite",
                }}
              />
            </div>
          ) : channels.length === 0 ? (
            <div style={{ padding: "30px 12px", textAlign: "center" }}>
              <Radio
                style={{
                  width: 28,
                  height: 28,
                  color: "rgba(255,255,255,0.15)",
                  margin: "0 auto 8px",
                }}
              />
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
                No channels configured
              </p>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 4 }}>
                Click + to add your first channel
              </p>
            </div>
          ) : (
            <>
              {channels.filter((c) => c.status === "connected").length > 0 && (
                <>
                  <p
                    style={{
                      fontSize: 10,
                      textTransform: "uppercase",
                      color: "rgba(255,255,255,0.35)",
                      letterSpacing: 1,
                      padding: "8px 12px 4px",
                      fontWeight: 600,
                      margin: 0,
                    }}
                  >
                    Connected
                  </p>
                  {channels
                    .filter((c) => c.status === "connected")
                    .map((ch) => (
                      <ChannelRow
                        key={ch.name}
                        channel={ch}
                        selected={selectedName === ch.name}
                        onClick={() => setSelectedName(ch.name)}
                      />
                    ))}
                </>
              )}
              {channels.filter((c) => c.status !== "connected").length > 0 && (
                <>
                  <p
                    style={{
                      fontSize: 10,
                      textTransform: "uppercase",
                      color: "rgba(255,255,255,0.35)",
                      letterSpacing: 1,
                      padding: "10px 12px 4px",
                      fontWeight: 600,
                      margin: 0,
                    }}
                  >
                    Disconnected
                  </p>
                  {channels
                    .filter((c) => c.status !== "connected")
                    .map((ch) => (
                      <ChannelRow
                        key={ch.name}
                        channel={ch}
                        selected={selectedName === ch.name}
                        onClick={() => setSelectedName(ch.name)}
                      />
                    ))}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, overflow: "auto", padding: "14px 20px 20px" }}>
        {selected ? (
          <div>
            {/* Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 24,
                }}
              >
                {CHANNEL_TYPES[selected.type]?.emoji ?? "📡"}
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, color: "white", fontSize: 16, fontWeight: 600 }}>
                  {CHANNEL_TYPES[selected.type]?.label ?? selected.name}
                </h3>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginTop: 4,
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "2px 8px",
                      borderRadius: 10,
                      fontSize: 10,
                      fontWeight: 500,
                      background:
                        selected.status === "connected"
                          ? "rgba(74,222,128,0.12)"
                          : selected.status === "error"
                          ? "rgba(248,113,113,0.12)"
                          : "rgba(255,255,255,0.06)",
                      color: statusColor(selected.status),
                    }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: statusColor(selected.status),
                      }}
                    />
                    {selected.status}
                  </span>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                    {selected.name}
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {selected.status === "connected" ? (
                  <button
                    onClick={() => handleLogout(selected.name)}
                    disabled={actionLoading === selected.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "6px 14px",
                      borderRadius: 6,
                      border: "none",
                      fontSize: 11,
                      fontWeight: 500,
                      cursor: "pointer",
                      background: "rgba(248,113,113,0.15)",
                      color: "#f87171",
                    }}
                  >
                    {actionLoading === selected.name ? (
                      <Loader2
                        style={{
                          width: 12,
                          height: 12,
                          animation: "spin 1s linear infinite",
                        }}
                      />
                    ) : (
                      <LogOut style={{ width: 12, height: 12 }} />
                    )}
                    Logout
                  </button>
                ) : (
                  <button
                    onClick={() => handleLogin(selected.name)}
                    disabled={actionLoading === selected.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "6px 14px",
                      borderRadius: 6,
                      border: "none",
                      fontSize: 11,
                      fontWeight: 500,
                      cursor: "pointer",
                      background: "rgba(74,222,128,0.15)",
                      color: "#4ade80",
                    }}
                  >
                    {actionLoading === selected.name ? (
                      <Loader2
                        style={{
                          width: 12,
                          height: 12,
                          animation: "spin 1s linear infinite",
                        }}
                      />
                    ) : (
                      <LogIn style={{ width: 12, height: 12 }} />
                    )}
                    Login
                  </button>
                )}
                <button
                  onClick={() => handleRemove(selected.name)}
                  disabled={actionLoading === selected.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "none",
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: "pointer",
                    background: "rgba(248,113,113,0.1)",
                    color: "#f87171",
                  }}
                >
                  <Trash2 style={{ width: 12, height: 12 }} />
                </button>
              </div>
            </div>

            {/* Capabilities */}
            <div style={{ marginBottom: 16 }}>
              <p
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.35)",
                  letterSpacing: 1,
                  fontWeight: 600,
                  marginBottom: 8,
                }}
              >
                Capabilities
              </p>
              <div
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 10,
                  padding: "10px 12px",
                }}
              >
                {capabilities.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {capabilities.map((cap) => (
                      <span
                        key={cap}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "3px 8px",
                          borderRadius: 6,
                          fontSize: 10,
                          background: "rgba(59,130,246,0.1)",
                          color: "#60a5fa",
                          border: "1px solid rgba(59,130,246,0.15)",
                        }}
                      >
                        <Shield style={{ width: 10, height: 10 }} />
                        {cap}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", margin: 0 }}>
                    No capabilities reported
                  </p>
                )}
              </div>
            </div>

            {/* Channel config */}
            <div style={{ marginBottom: 16 }}>
              <p
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.35)",
                  letterSpacing: 1,
                  fontWeight: 600,
                  marginBottom: 8,
                }}
              >
                Configuration
              </p>
              <div
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 10,
                  padding: "10px 12px",
                }}
              >
                {selected.config && Object.keys(selected.config).length > 0 ? (
                  Object.entries(selected.config).map(([key, val]) => (
                    <div
                      key={key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "4px 0",
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                      }}
                    >
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>{key}</span>
                      <span
                        style={{
                          fontSize: 11,
                          color: "rgba(255,255,255,0.45)",
                          fontFamily: "monospace",
                        }}
                      >
                        {typeof val === "string"
                          ? val.length > 30
                            ? val.slice(0, 30) + "..."
                            : val
                          : JSON.stringify(val)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", margin: 0 }}>
                    Default configuration
                  </p>
                )}

                {/* Type-specific inputs */}
                {(selected.type === "telegram" || selected.type === "discord") && (
                  <div style={{ marginTop: 10 }}>
                    <label
                      style={{
                        fontSize: 11,
                        color: "rgba(255,255,255,0.5)",
                        display: "block",
                        marginBottom: 4,
                      }}
                    >
                      Bot Token
                    </label>
                    <input
                      type="password"
                      placeholder={`your-${selected.type}-bot-token`}
                      style={{
                        width: "100%",
                        padding: "6px 10px",
                        borderRadius: 6,
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "white",
                        fontSize: 12,
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                )}
                {selected.type === "slack" && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div>
                      <label
                        style={{
                          fontSize: 11,
                          color: "rgba(255,255,255,0.5)",
                          display: "block",
                          marginBottom: 4,
                        }}
                      >
                        Bot Token (xoxb-...)
                      </label>
                      <input
                        type="password"
                        placeholder="xoxb-..."
                        style={{
                          width: "100%",
                          padding: "6px 10px",
                          borderRadius: 6,
                          background: "rgba(255,255,255,0.04)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          color: "white",
                          fontSize: 12,
                          outline: "none",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                    <div>
                      <label
                        style={{
                          fontSize: 11,
                          color: "rgba(255,255,255,0.5)",
                          display: "block",
                          marginBottom: 4,
                        }}
                      >
                        App Token (xapp-...)
                      </label>
                      <input
                        type="password"
                        placeholder="xapp-..."
                        style={{
                          width: "100%",
                          padding: "6px 10px",
                          borderRadius: 6,
                          background: "rgba(255,255,255,0.04)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          color: "white",
                          fontSize: 12,
                          outline: "none",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                  </div>
                )}
                {selected.type === "email" && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div>
                      <label
                        style={{
                          fontSize: 11,
                          color: "rgba(255,255,255,0.5)",
                          display: "block",
                          marginBottom: 4,
                        }}
                      >
                        IMAP Host
                      </label>
                      <input
                        type="text"
                        placeholder="imap.gmail.com"
                        style={{
                          width: "100%",
                          padding: "6px 10px",
                          borderRadius: 6,
                          background: "rgba(255,255,255,0.04)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          color: "white",
                          fontSize: 12,
                          outline: "none",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                    <div>
                      <label
                        style={{
                          fontSize: 11,
                          color: "rgba(255,255,255,0.5)",
                          display: "block",
                          marginBottom: 4,
                        }}
                      >
                        SMTP Host
                      </label>
                      <input
                        type="text"
                        placeholder="smtp.gmail.com"
                        style={{
                          width: "100%",
                          padding: "6px 10px",
                          borderRadius: 6,
                          background: "rgba(255,255,255,0.04)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          color: "white",
                          fontSize: 12,
                          outline: "none",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Resolve */}
            <div style={{ marginBottom: 16 }}>
              <p
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.35)",
                  letterSpacing: 1,
                  fontWeight: 600,
                  marginBottom: 8,
                }}
              >
                Resolve
              </p>
              <div
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 10,
                  padding: "10px 12px",
                }}
              >
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="text"
                    placeholder="Search contacts, groups..."
                    value={resolveQuery}
                    onChange={(e) => setResolveQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleResolve(selected.name)}
                    style={{
                      flex: 1,
                      padding: "6px 10px",
                      borderRadius: 6,
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      color: "white",
                      fontSize: 12,
                      outline: "none",
                    }}
                  />
                  <button
                    onClick={() => handleResolve(selected.name)}
                    disabled={actionLoading === "resolve"}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: "none",
                      fontSize: 11,
                      fontWeight: 500,
                      cursor: "pointer",
                      background: "rgba(59,130,246,0.15)",
                      color: "#60a5fa",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    {actionLoading === "resolve" ? (
                      <Loader2
                        style={{
                          width: 12,
                          height: 12,
                          animation: "spin 1s linear infinite",
                        }}
                      />
                    ) : (
                      <Search style={{ width: 12, height: 12 }} />
                    )}
                    Resolve
                  </button>
                </div>
                {resolveResult && (
                  <pre
                    style={{
                      marginTop: 8,
                      padding: 8,
                      borderRadius: 6,
                      background: "rgba(0,0,0,0.3)",
                      color: "rgba(255,255,255,0.7)",
                      fontSize: 11,
                      fontFamily: "monospace",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                      maxHeight: 150,
                      overflowY: "auto",
                      margin: "8px 0 0",
                    }}
                  >
                    {resolveResult}
                  </pre>
                )}
              </div>
            </div>

            {/* Docs link */}
            <div style={{ marginBottom: 16 }}>
              <p
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.35)",
                  letterSpacing: 1,
                  fontWeight: 600,
                  marginBottom: 8,
                }}
              >
                Documentation
              </p>
              <div
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 10,
                  padding: "10px 12px",
                }}
              >
                <a
                  href={`https://docs.openclaw.ai/channels/${selected.type}`}
                  target="_blank"
                  rel="noopener"
                  style={{
                    fontSize: 11,
                    color: "#60a5fa",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    textDecoration: "none",
                  }}
                >
                  <ExternalLink style={{ width: 12, height: 12 }} />
                  OpenClaw {CHANNEL_TYPES[selected.type]?.label ?? selected.type} docs
                  <ChevronRight style={{ width: 10, height: 10, marginLeft: "auto" }} />
                </a>
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              gap: 12,
            }}
          >
            <Radio style={{ width: 40, height: 40, color: "rgba(255,255,255,0.12)" }} />
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", margin: 0 }}>
              Select a channel to configure
            </p>
            <p
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.22)",
                maxWidth: 260,
                textAlign: "center",
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              OpenClaw supports {Object.keys(CHANNEL_TYPES).length} messaging platforms. Connect
              your accounts to chat from anywhere.
            </p>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ChannelRow({
  channel,
  selected,
  onClick,
}: {
  channel: Channel;
  selected: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const info = CHANNEL_TYPES[channel.type];
  const statusCol =
    channel.status === "connected"
      ? "#4ade80"
      : channel.status === "error"
      ? "#f87171"
      : "rgba(255,255,255,0.25)";

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "8px 12px",
        borderRadius: 8,
        border: "none",
        cursor: "pointer",
        marginBottom: 2,
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: selected
          ? "rgba(59,130,246,0.15)"
          : hovered
          ? "rgba(255,255,255,0.04)"
          : "transparent",
        transition: "background 0.15s",
      }}
    >
      <span style={{ fontSize: 15 }}>{info?.emoji ?? "📡"}</span>
      <span style={{ fontSize: 12, color: "white", flex: 1 }}>
        {info?.label ?? channel.name}
      </span>
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: statusCol,
          flexShrink: 0,
        }}
      />
    </button>
  );
}
