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
  Info,
  CheckCircle,
  X,
  Save,
} from "lucide-react";

/* ── Channel type definitions with setup metadata ── */

interface ChannelTypeDef {
  emoji: string;
  label: string;
  description: string;
  fields: FieldDef[];
  instructions?: string[];
}

interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  type?: "text" | "password" | "number";
  defaultValue?: string;
  required?: boolean;
  hint?: string;
}

const CHANNEL_TYPES: Record<string, ChannelTypeDef> = {
  email: {
    emoji: "📧",
    label: "Email (Gmail)",
    description: "Connect your Gmail or any IMAP/SMTP email account",
    fields: [
      { key: "email", label: "Email Address", placeholder: "you@gmail.com", required: true },
      { key: "password", label: "App Password", placeholder: "xxxx xxxx xxxx xxxx", type: "password", required: true, hint: "Use a Google App Password, not your regular password" },
      { key: "imap_host", label: "IMAP Host", placeholder: "imap.gmail.com", defaultValue: "imap.gmail.com" },
      { key: "imap_port", label: "IMAP Port", placeholder: "993", defaultValue: "993", type: "number" },
      { key: "smtp_host", label: "SMTP Host", placeholder: "smtp.gmail.com", defaultValue: "smtp.gmail.com" },
      { key: "smtp_port", label: "SMTP Port", placeholder: "587", defaultValue: "587", type: "number" },
    ],
    instructions: [
      "Go to myaccount.google.com → Security",
      "Enable 2-Step Verification if not already on",
      "Search for \"App passwords\" in the security page",
      "Create a new app password (select \"Mail\")",
      "Copy the 16-character password and paste it below",
    ],
  },
  discord: {
    emoji: "🎮",
    label: "Discord",
    description: "Connect a Discord bot to your server",
    fields: [
      { key: "token", label: "Bot Token", placeholder: "your-discord-bot-token", type: "password", required: true },
    ],
    instructions: [
      "Go to discord.com/developers/applications",
      "Create a new application → Bot section",
      "Click \"Reset Token\" to get your bot token",
      "Enable Message Content Intent under Privileged Gateway Intents",
      "Invite the bot to your server via OAuth2 → URL Generator",
    ],
  },
  telegram: {
    emoji: "✈️",
    label: "Telegram",
    description: "Connect a Telegram bot",
    fields: [
      { key: "token", label: "Bot Token", placeholder: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz", type: "password", required: true },
    ],
    instructions: [
      "Message @BotFather on Telegram",
      "Send /newbot and follow the prompts",
      "Copy the bot token it gives you",
    ],
  },
  slack: {
    emoji: "💼",
    label: "Slack",
    description: "Connect to a Slack workspace",
    fields: [
      { key: "bot_token", label: "Bot Token", placeholder: "xoxb-...", type: "password", required: true },
      { key: "app_token", label: "App Token", placeholder: "xapp-...", type: "password", required: true },
    ],
    instructions: [
      "Go to api.slack.com/apps → Create New App",
      "Under OAuth & Permissions, add chat:write, channels:read scopes",
      "Install to workspace and copy the Bot Token (xoxb-...)",
      "Under Basic Information → App-Level Tokens, create one with connections:write",
    ],
  },
  whatsapp: {
    emoji: "💬",
    label: "WhatsApp",
    description: "Connect WhatsApp via the WhatsApp Business API",
    fields: [
      { key: "token", label: "Access Token", placeholder: "your-whatsapp-token", type: "password", required: true },
      { key: "phone_number_id", label: "Phone Number ID", placeholder: "123456789", hint: "From Meta Business dashboard" },
    ],
    instructions: [
      "Go to developers.facebook.com → WhatsApp",
      "Set up a business app and get your access token",
      "Copy the Phone Number ID from the dashboard",
    ],
  },
  signal: {
    emoji: "🔒",
    label: "Signal",
    description: "Connect Signal via signal-cli",
    fields: [
      { key: "phone", label: "Phone Number", placeholder: "+1234567890", required: true, hint: "Must be registered with signal-cli" },
    ],
    instructions: [
      "Install signal-cli: github.com/AsamK/signal-cli",
      "Register or link your phone number",
      "Enter the registered number below",
    ],
  },
  googlechat: {
    emoji: "🟢",
    label: "Google Chat",
    description: "Connect to Google Workspace Chat",
    fields: [
      { key: "token", label: "Service Account Key", placeholder: "Path to service-account.json", required: true },
    ],
  },
  matrix: {
    emoji: "🔷",
    label: "Matrix",
    description: "Connect to a Matrix homeserver",
    fields: [
      { key: "homeserver", label: "Homeserver URL", placeholder: "https://matrix.org", required: true },
      { key: "token", label: "Access Token", placeholder: "your-matrix-token", type: "password", required: true },
    ],
  },
  irc: {
    emoji: "📡",
    label: "IRC",
    description: "Connect to an IRC network",
    fields: [
      { key: "server", label: "Server", placeholder: "irc.libera.chat", required: true },
      { key: "port", label: "Port", placeholder: "6697", defaultValue: "6697", type: "number" },
      { key: "nickname", label: "Nickname", placeholder: "crystal-bot", required: true },
      { key: "channel", label: "Channel", placeholder: "#mychannel" },
    ],
  },
  linear: {
    emoji: "📐",
    label: "Linear",
    description: "Connect to Linear for issue tracking",
    fields: [
      { key: "token", label: "API Key", placeholder: "lin_api_...", type: "password", required: true },
    ],
    instructions: [
      "Go to linear.app → Settings → API",
      "Create a personal API key",
    ],
  },
  nostr: {
    emoji: "🟣",
    label: "Nostr",
    description: "Connect to the Nostr network",
    fields: [
      { key: "nsec", label: "Private Key (nsec)", placeholder: "nsec1...", type: "password", required: true },
      { key: "relay", label: "Relay URL", placeholder: "wss://relay.damus.io", defaultValue: "wss://relay.damus.io" },
    ],
  },
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
    const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", { command, cwd: null });
    return result.stdout;
  } catch (e) {
    throw new Error(String(e));
  }
}

async function fetchChannels(): Promise<Channel[]> {
  try {
    const statusRaw = await runCli("openclaw channels status --json");
    const statusData = JSON.parse(statusRaw);
    const channels: Channel[] = [];
    const meta: { id: string; label: string }[] = statusData.channelMeta || [];
    const chMap: Record<string, { configured: boolean; running: boolean }> = statusData.channels || {};
    const accounts: Record<string, { accountId: string; connected: boolean; bot?: { username: string } }[]> = statusData.channelAccounts || {};

    for (const m of meta) {
      const ch = chMap[m.id];
      if (!ch?.configured) continue;
      const accs = accounts[m.id] || [];
      const connected = accs.some(a => a.connected);
      channels.push({
        name: m.id,
        type: m.id,
        status: connected ? "connected" : ch.running ? "disconnected" : "disconnected",
        capabilities: [],
        config: {},
      });
    }

    if (channels.length === 0) {
      const listRaw = await runCli("openclaw channels list --json");
      const listData = JSON.parse(listRaw);
      const chat: Record<string, string[]> = listData.chat || {};
      for (const [type] of Object.entries(chat)) {
        channels.push({ name: type, type, status: "disconnected", capabilities: [], config: {} });
      }
    }

    return channels;
  } catch {
    return [];
  }
}

async function fetchStatus(): Promise<Record<string, string>> {
  try {
    const raw = await runCli("openclaw channels status --json");
    const data = JSON.parse(raw);
    const result: Record<string, string> = {};
    const chMap: Record<string, { configured: boolean; running: boolean }> = data.channels || {};
    const accounts: Record<string, { connected: boolean }[]> = data.channelAccounts || {};

    for (const [id, ch] of Object.entries(chMap)) {
      if (!ch.configured) continue;
      const accs = accounts[id] || [];
      const connected = accs.some(a => a.connected);
      result[id] = connected ? "connected" : ch.running ? "disconnected" : "disconnected";
    }
    return result;
  } catch {
    return {};
  }
}

async function fetchCapabilities(name: string): Promise<string[]> {
  try {
    const raw = await runCli("openclaw channels capabilities --json");
    const data = JSON.parse(raw);
    return data[name] ?? data ?? [];
  } catch {
    return [];
  }
}

const cardStyle: React.CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "12px 14px",
};

export function ChannelsView() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addType, setAddType] = useState("email");
  const [addFields, setAddFields] = useState<Record<string, string>>({});
  const [addError, setAddError] = useState("");
  const [addSuccess, setAddSuccess] = useState(false);
  const [resolveQuery, setResolveQuery] = useState("");
  const [resolveResult, setResolveResult] = useState("");

  const [editConfig, setEditConfig] = useState<Record<string, string>>({});
  const [configSaving, setConfigSaving] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);

  const channelDef = CHANNEL_TYPES[addType];

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
  const selectedDef = selected ? CHANNEL_TYPES[selected.type] : null;

  useEffect(() => {
    if (!selected) {
      setCapabilities([]);
      return;
    }
    fetchCapabilities(selected.name).then(setCapabilities);
    const cfg: Record<string, string> = {};
    if (selected.config) {
      for (const [k, v] of Object.entries(selected.config)) {
        cfg[k] = typeof v === "string" ? v : JSON.stringify(v);
      }
    }
    setEditConfig(cfg);
    setConfigSaved(false);
  }, [selected]);

  useEffect(() => {
    const def = CHANNEL_TYPES[addType];
    if (!def) return;
    const defaults: Record<string, string> = {};
    for (const f of def.fields) {
      defaults[f.key] = f.defaultValue || "";
    }
    setAddFields(defaults);
    setAddError("");
    setAddSuccess(false);
  }, [addType]);

  const handleLogin = async (name: string) => {
    setActionLoading(name);
    try { await runCli(`openclaw channels login --channel ${name}`); } catch { /* */ }
    await loadAll();
    setActionLoading(null);
  };

  const handleLogout = async (name: string) => {
    setActionLoading(name);
    try { await runCli(`openclaw channels logout --channel ${name}`); } catch { /* */ }
    await loadAll();
    setActionLoading(null);
  };

  const handleRemove = async (name: string) => {
    if (!window.confirm(`Remove ${name}? This will delete all configuration for this channel.`)) return;
    setActionLoading(name);
    try { await runCli(`openclaw channels remove --channel ${name}`); } catch { /* */ }
    setSelectedName(null);
    await loadAll();
    setActionLoading(null);
  };

  const handleAdd = async () => {
    const def = CHANNEL_TYPES[addType];
    if (!def) return;

    const missing = def.fields.filter(f => f.required && !addFields[f.key]?.trim());
    if (missing.length > 0) {
      setAddError(`Required: ${missing.map(f => f.label).join(", ")}`);
      return;
    }
    setAddError("");
    setActionLoading("add");

    try {
      const tokenField = addFields.token || addFields.password || addFields.bot_token || "";
      const tokenPart = tokenField ? ` --token "${tokenField.trim().replace(/"/g, '\\"')}"` : "";

      await runCli(`openclaw channels add --channel ${addType}${tokenPart}`);

      const configEntries = Object.entries(addFields).filter(([k, v]) => v.trim() && k !== "token" && k !== "password" && k !== "bot_token");
      for (const [key, value] of configEntries) {
        await runCli(`openclaw config set channels.${addType}.${key} "${value.trim().replace(/"/g, '\\"')}"`).catch(() => {});
      }

      setAddSuccess(true);
      setTimeout(() => {
        setShowAddForm(false);
        setAddSuccess(false);
        setAddFields({});
      }, 1500);
      await loadAll();
    } catch (e) {
      setAddError(String(e));
    }
    setActionLoading(null);
  };

  const handleSaveConfig = async () => {
    if (!selected) return;
    setConfigSaving(true);
    try {
      for (const [key, value] of Object.entries(editConfig)) {
        if (value.trim()) {
          await runCli(`openclaw config set channels.${selected.type}.${key} "${value.trim().replace(/"/g, '\\"')}"`).catch(() => {});
        }
      }
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2000);
      await loadAll();
    } catch { /* */ }
    setConfigSaving(false);
  };

  const handleResolve = async (name: string) => {
    if (!resolveQuery.trim()) return;
    setActionLoading("resolve");
    try {
      const raw = await runCli(`openclaw channels resolve --channel ${name} --query "${resolveQuery.trim().replace(/"/g, '\\"')}"`);
      setResolveResult(raw);
    } catch (e) {
      setResolveResult(`Error: ${e}`);
    }
    setActionLoading(null);
  };

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* ── Left panel ── */}
      <div style={{ width: 260, flexShrink: 0, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Channels</h2>
            <p style={{ margin: "4px 0 0", fontSize: 10, color: "var(--text-muted)" }}>
              {channels.filter((c) => c.status === "connected").length} connected &middot; {channels.length} total
            </p>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <IconBtn onClick={() => loadAll()} icon={<RefreshCw style={{ width: 12, height: 12 }} />} />
            <IconBtn onClick={() => setShowAddForm(!showAddForm)} icon={<Plus style={{ width: 12, height: 12 }} />} accent />
          </div>
        </div>

        {/* ── Add channel wizard ── */}
        {showAddForm && (
          <div style={{ margin: "0 8px 8px", padding: 14, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, maxHeight: 420, overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <SectionTitle text="Connect a Service" />
              <button onClick={() => { setShowAddForm(false); setAddError(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}>
                <X style={{ width: 12, height: 12 }} />
              </button>
            </div>

            {/* Type selector */}
            <select
              value={addType}
              onChange={(e) => setAddType(e.target.value)}
              style={{ width: "100%", padding: "7px 10px", borderRadius: 6, background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, marginBottom: 10, outline: "none" }}
            >
              {Object.entries(CHANNEL_TYPES).map(([key, { emoji, label }]) => (
                <option key={key} value={key} style={{ background: "var(--bg-primary)" }}>
                  {emoji} {label}
                </option>
              ))}
            </select>

            {/* Description */}
            {channelDef && (
              <p style={{ fontSize: 11, color: "var(--text-secondary)", margin: "0 0 10px", lineHeight: 1.4 }}>
                {channelDef.description}
              </p>
            )}

            {/* Setup instructions */}
            {channelDef?.instructions && (
              <div style={{ background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
                  <Info style={{ width: 11, height: 11, color: "var(--accent)", flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Setup Steps</span>
                </div>
                <ol style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                  {channelDef.instructions.map((step, i) => (
                    <li key={i} style={{ marginBottom: 2 }}>{step}</li>
                  ))}
                </ol>
              </div>
            )}

            {/* Dynamic fields */}
            {channelDef?.fields.map((field) => (
              <div key={field.key} style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 11, color: "var(--text-secondary)", display: "block", marginBottom: 3 }}>
                  {field.label} {field.required && <span style={{ color: "var(--error)" }}>*</span>}
                </label>
                <input
                  type={field.type || "text"}
                  placeholder={field.placeholder}
                  value={addFields[field.key] || ""}
                  onChange={(e) => setAddFields({ ...addFields, [field.key]: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, outline: "none", boxSizing: "border-box" }}
                />
                {field.hint && (
                  <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "3px 0 0", lineHeight: 1.3 }}>{field.hint}</p>
                )}
              </div>
            ))}

            {addError && (
              <p style={{ fontSize: 11, color: "var(--error)", margin: "0 0 8px", display: "flex", alignItems: "center", gap: 4 }}>
                <X style={{ width: 10, height: 10, flexShrink: 0 }} /> {addError}
              </p>
            )}

            {addSuccess ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--success)", fontSize: 12, padding: "6px 0" }}>
                <CheckCircle style={{ width: 14, height: 14 }} /> Connected!
              </div>
            ) : (
              <button
                onClick={handleAdd}
                disabled={actionLoading === "add"}
                style={{
                  width: "100%", padding: "8px 0", borderRadius: 8, border: "none", fontSize: 12, fontWeight: 600,
                  cursor: actionLoading === "add" ? "wait" : "pointer",
                  background: "var(--accent)", color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  opacity: actionLoading === "add" ? 0.7 : 1,
                }}
              >
                {actionLoading === "add" ? (
                  <><Loader2 style={{ width: 13, height: 13, animation: "spin 1s linear infinite" }} /> Connecting...</>
                ) : (
                  <>Connect {channelDef?.label || addType}</>
                )}
              </button>
            )}
          </div>
        )}

        {/* ── Channel list ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
              <Loader2 style={{ width: 18, height: 18, color: "var(--text-muted)", animation: "spin 1s linear infinite" }} />
            </div>
          ) : channels.length === 0 ? (
            <div style={{ padding: "30px 12px", textAlign: "center" }}>
              <Radio style={{ width: 28, height: 28, color: "var(--text-muted)", margin: "0 auto 8px", opacity: 0.4 }} />
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>No channels connected</p>
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, opacity: 0.7 }}>
                Click <strong>+</strong> above to connect Gmail, Discord, Telegram, and more
              </p>
            </div>
          ) : (
            <>
              {channels.filter((c) => c.status === "connected").length > 0 && (
                <>
                  <SectionTitle text="Connected" />
                  {channels.filter((c) => c.status === "connected").map((ch) => (
                    <ChannelRow key={ch.name} channel={ch} selected={selectedName === ch.name} onClick={() => setSelectedName(ch.name)} />
                  ))}
                </>
              )}
              {channels.filter((c) => c.status !== "connected").length > 0 && (
                <>
                  <SectionTitle text="Disconnected" style={{ marginTop: 8 }} />
                  {channels.filter((c) => c.status !== "connected").map((ch) => (
                    <ChannelRow key={ch.name} channel={ch} selected={selectedName === ch.name} onClick={() => setSelectedName(ch.name)} />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div style={{ flex: 1, overflow: "auto", padding: "14px 20px 20px" }}>
        {selected && selectedDef ? (
          <div>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: "var(--bg-hover)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>
                {selectedDef.emoji}
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, color: "var(--text)", fontSize: 16, fontWeight: 600 }}>{selectedDef.label}</h3>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <StatusBadge status={selected.status} />
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{selected.name}</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {selected.status === "connected" ? (
                  <ActionBtn onClick={() => handleLogout(selected.name)} loading={actionLoading === selected.name} icon={<LogOut style={{ width: 12, height: 12 }} />} label="Logout" color="var(--error)" />
                ) : (
                  <ActionBtn onClick={() => handleLogin(selected.name)} loading={actionLoading === selected.name} icon={<LogIn style={{ width: 12, height: 12 }} />} label="Login" color="var(--success)" />
                )}
                <button
                  onClick={() => handleRemove(selected.name)}
                  disabled={actionLoading === selected.name}
                  style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: 6, border: "none", fontSize: 11, cursor: "pointer", background: "rgba(248,113,113,0.1)", color: "var(--error)" }}
                >
                  <Trash2 style={{ width: 12, height: 12 }} />
                </button>
              </div>
            </div>

            {/* Capabilities */}
            <div style={{ marginBottom: 16 }}>
              <SectionTitle text="Capabilities" />
              <div style={cardStyle}>
                {capabilities.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {capabilities.map((cap) => (
                      <span key={cap} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, fontSize: 10, background: "var(--accent-bg)", color: "var(--accent)", border: "1px solid rgba(59,130,246,0.15)" }}>
                        <Shield style={{ width: 10, height: 10 }} /> {cap}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>No capabilities reported</p>
                )}
              </div>
            </div>

            {/* Editable Configuration */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <SectionTitle text="Configuration" style={{ margin: 0 }} />
                <button
                  onClick={handleSaveConfig}
                  disabled={configSaving}
                  style={{
                    display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, border: "none",
                    fontSize: 10, fontWeight: 600, cursor: "pointer",
                    background: configSaved ? "rgba(74,222,128,0.15)" : "var(--accent-bg)",
                    color: configSaved ? "var(--success)" : "var(--accent)",
                  }}
                >
                  {configSaved ? <><CheckCircle style={{ width: 10, height: 10 }} /> Saved</> : <><Save style={{ width: 10, height: 10 }} /> Save</>}
                </button>
              </div>
              <div style={cardStyle}>
                {selectedDef.fields.map((field) => (
                  <div key={field.key} style={{ marginBottom: 8 }}>
                    <label style={{ fontSize: 11, color: "var(--text-secondary)", display: "block", marginBottom: 3 }}>
                      {field.label}
                    </label>
                    <input
                      type={field.type || "text"}
                      placeholder={field.placeholder}
                      value={editConfig[field.key] || ""}
                      onChange={(e) => { setEditConfig({ ...editConfig, [field.key]: e.target.value }); setConfigSaved(false); }}
                      style={{ width: "100%", padding: "7px 10px", borderRadius: 6, background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, outline: "none", boxSizing: "border-box" }}
                    />
                  </div>
                ))}
                {Object.entries(editConfig).filter(([k]) => !selectedDef.fields.some(f => f.key === k)).map(([key, val]) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{key}</span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>
                      {val.length > 40 ? val.slice(0, 40) + "..." : val}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Resolve */}
            <div style={{ marginBottom: 16 }}>
              <SectionTitle text="Find Contacts / Groups" />
              <div style={cardStyle}>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="text"
                    placeholder="Search contacts, groups..."
                    value={resolveQuery}
                    onChange={(e) => setResolveQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleResolve(selected.name)}
                    style={{ flex: 1, padding: "7px 10px", borderRadius: 6, background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, outline: "none" }}
                  />
                  <ActionBtn onClick={() => handleResolve(selected.name)} loading={actionLoading === "resolve"} icon={<Search style={{ width: 12, height: 12 }} />} label="Search" color="var(--accent)" />
                </div>
                {resolveResult && (
                  <pre style={{ marginTop: 8, padding: 8, borderRadius: 6, background: "var(--bg-primary)", color: "var(--text-secondary)", fontSize: 11, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 150, overflowY: "auto", margin: "8px 0 0" }}>
                    {resolveResult}
                  </pre>
                )}
              </div>
            </div>

            {/* Docs link */}
            <div>
              <SectionTitle text="Documentation" />
              <div style={cardStyle}>
                <a
                  href={`https://docs.openclaw.ai/channels/${selected.type}`}
                  target="_blank"
                  rel="noopener"
                  style={{ fontSize: 11, color: "var(--accent)", display: "flex", alignItems: "center", gap: 4, textDecoration: "none" }}
                >
                  <ExternalLink style={{ width: 12, height: 12 }} />
                  OpenClaw {selectedDef.label} docs
                  <ChevronRight style={{ width: 10, height: 10, marginLeft: "auto" }} />
                </a>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12 }}>
            <Radio style={{ width: 40, height: 40, color: "var(--text-muted)", opacity: 0.3 }} />
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>Select a channel or add a new one</p>
            <p style={{ fontSize: 11, color: "var(--text-muted)", maxWidth: 280, textAlign: "center", margin: 0, lineHeight: 1.5, opacity: 0.6 }}>
              Connect Gmail, Discord, Telegram, Slack, and {Object.keys(CHANNEL_TYPES).length - 4} more services. Crystal can then send and receive messages through them.
            </p>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ── Sub-components ── */

function SectionTitle({ text, style }: { text: string; style?: React.CSSProperties }) {
  return (
    <p style={{
      fontSize: 10, textTransform: "uppercase", color: "var(--text-muted)",
      letterSpacing: "0.06em", fontWeight: 600, marginBottom: 8, marginTop: 0, ...style,
    }}>
      {text}
    </p>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = status === "connected" ? "var(--success)" : status === "error" ? "var(--error)" : "var(--text-muted)";
  const bg = status === "connected" ? "rgba(74,222,128,0.12)" : status === "error" ? "rgba(248,113,113,0.12)" : "var(--bg-hover)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 500, background: bg, color }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color }} />
      {status}
    </span>
  );
}

function IconBtn({ onClick, icon, accent }: { onClick: () => void; icon: React.ReactNode; accent?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: accent ? "var(--accent-bg)" : "var(--bg-hover)",
        border: "1px solid var(--border)", borderRadius: 6,
        padding: "5px 6px", cursor: "pointer", display: "flex", alignItems: "center",
        color: accent ? "var(--accent)" : "var(--text-muted)",
      }}
    >
      {icon}
    </button>
  );
}

function ActionBtn({ onClick, loading, icon, label, color }: { onClick: () => void; loading: boolean; icon: React.ReactNode; label: string; color: string }) {
  const bg = color === "var(--error)" ? "rgba(248,113,113,0.15)" : color === "var(--success)" ? "rgba(74,222,128,0.15)" : "var(--accent-bg)";
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 14px", borderRadius: 6, border: "none", fontSize: 11, fontWeight: 500, cursor: "pointer", background: bg, color }}
    >
      {loading ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : icon}
      {label}
    </button>
  );
}

function ChannelRow({ channel, selected, onClick }: { channel: Channel; selected: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const info = CHANNEL_TYPES[channel.type];
  const statusCol = channel.status === "connected" ? "var(--success)" : channel.status === "error" ? "var(--error)" : "var(--text-muted)";

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%", textAlign: "left", padding: "8px 12px", borderRadius: 8, border: "none",
        cursor: "pointer", marginBottom: 2, display: "flex", alignItems: "center", gap: 8,
        background: selected ? "var(--accent-bg)" : hovered ? "var(--bg-hover)" : "transparent",
        transition: "background 0.15s",
      }}
    >
      <span style={{ fontSize: 15 }}>{info?.emoji ?? "📡"}</span>
      <span style={{ fontSize: 12, color: "var(--text)", flex: 1 }}>{info?.label ?? channel.name}</span>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusCol, flexShrink: 0 }} />
    </button>
  );
}
