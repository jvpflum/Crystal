import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/appStore";
import {
  Users,
  Search,
  User,
  UserPlus,
  Copy,
  Mail,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

/* ── Types ── */

interface ChannelEntry {
  id: string;
  label: string;
}

interface SelfInfo {
  id?: string;
  name?: string;
  phone?: string;
  username?: string;
  status?: string;
  [key: string]: unknown;
}

interface PeerEntry {
  id: string;
  name?: string;
  username?: string;
  status?: string;
  phone?: string;
  [key: string]: unknown;
}

interface GroupEntry {
  id: string;
  name?: string;
  description?: string;
  memberCount?: number;
  [key: string]: unknown;
}

interface GroupMember {
  id: string;
  name?: string;
  role?: string;
  [key: string]: unknown;
}

type TabId = "self" | "peers" | "groups";

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

const PREFILL_KEY = "crystal-messaging-prefill";

/* ── Shared styles ── */

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

const cardStyle: React.CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "12px 14px",
};

/* ══════════════════════════════════════════════════════════════
   DIRECTORY VIEW
   ══════════════════════════════════════════════════════════════ */

export function DirectoryView() {
  const [channels, setChannels] = useState<ChannelEntry[]>([]);
  const [channel, setChannel] = useState("");
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [tab, setTab] = useState<TabId>("self");

  const fetchChannels = useCallback(async () => {
    setChannelsLoading(true);
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
    setChannelsLoading(false);
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  const TABS: { id: TabId; icon: React.ElementType; label: string }[] = [
    { id: "self", icon: User, label: "Self" },
    { id: "peers", icon: Users, label: "Peers" },
    { id: "groups", icon: UserPlus, label: "Groups" },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{ padding: "14px 20px 0", flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 14,
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
            <Users style={{ width: 18, height: 18, color: "var(--accent)" }} />
          </div>
          <div style={{ flex: 1 }}>
            <h2
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 600,
                color: "var(--text)",
              }}
            >
              Directory
            </h2>
            <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)" }}>
              Contacts, peers &amp; groups across channels
            </p>
          </div>
        </div>

        {/* Channel selector bar */}
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Channel</label>
          {channelsLoading ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: 6,
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
              style={{ ...inputStyle, cursor: "pointer" }}
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

        {/* Tab bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            borderBottom: "1px solid var(--border)",
          }}
        >
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 16px",
                  borderRadius: "8px 8px 0 0",
                  border: "none",
                  cursor: "pointer",
                  background: active ? "var(--bg-elevated)" : "transparent",
                  color: active ? "var(--accent)" : "var(--text-muted)",
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                  borderBottom: active
                    ? "2px solid var(--accent)"
                    : "2px solid transparent",
                  transition: "all 0.15s",
                }}
              >
                <Icon style={{ width: 14, height: 14 }} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {!channel ? (
          <EmptyState text="Select a channel to browse" />
        ) : tab === "self" ? (
          <SelfTab channel={channel} />
        ) : tab === "peers" ? (
          <PeersTab channel={channel} />
        ) : (
          <GroupsTab channel={channel} />
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB: Self
   ══════════════════════════════════════════════════════════════ */

function SelfTab({ channel }: { channel: string }) {
  const [info, setInfo] = useState<SelfInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSelf = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await runCli(
        `openclaw directory self --channel ${channel} --json`,
      );
      const data = JSON.parse(raw);
      setInfo(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setInfo(null);
    }
    setLoading(false);
  }, [channel]);

  useEffect(() => {
    fetchSelf();
  }, [fetchSelf]);

  if (loading) return <LoadingSpinner text="Loading profile..." />;
  if (error) return <ErrorBanner text={error} onRetry={fetchSelf} />;
  if (!info) return <EmptyState text="No profile data available" />;

  const entries = Object.entries(info).filter(
    ([, v]) => v !== undefined && v !== null && v !== "",
  );

  return (
    <div style={{ padding: "16px 20px", overflow: "auto", height: "100%" }}>
      <div
        style={{
          ...cardStyle,
          maxWidth: 500,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 14,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "var(--accent-bg)",
              border: "1px solid rgba(59,130,246,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <User style={{ width: 20, height: 20, color: "var(--accent)" }} />
          </div>
          <div>
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--text)",
                display: "block",
              }}
            >
              {info.name || info.username || "You"}
            </span>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
              {channel}
            </span>
          </div>
        </div>

        {entries.map(([key, val]) => (
          <div
            key={key}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 0",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: "var(--text-secondary)",
                textTransform: "capitalize",
              }}
            >
              {key}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text)",
                  fontFamily: "monospace",
                  maxWidth: 250,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {typeof val === "object" ? JSON.stringify(val) : String(val)}
              </span>
              <CopyButton
                text={typeof val === "object" ? JSON.stringify(val) : String(val)}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB: Peers
   ══════════════════════════════════════════════════════════════ */

function PeersTab({ channel }: { channel: string }) {
  const [peers, setPeers] = useState<PeerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchTimeout, setSearchTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);

  const fetchPeers = useCallback(
    async (q?: string) => {
      setLoading(true);
      setError(null);
      try {
        let cmd = `openclaw directory peers list --channel ${channel} --json --limit 50`;
        if (q?.trim()) cmd += ` --query "${esc(q.trim())}"`;
        const raw = await runCli(cmd);
        const data = JSON.parse(raw);
        const list: PeerEntry[] = Array.isArray(data)
          ? data
          : data.peers || data.contacts || data.results || [];
        setPeers(
          list.map((p) => ({
            ...p,
            id: p.id || p.phone || p.username || String(Math.random()),
          })),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPeers([]);
      }
      setLoading(false);
    },
    [channel],
  );

  useEffect(() => {
    fetchPeers();
  }, [fetchPeers]);

  const handleSearch = (val: string) => {
    setQuery(val);
    if (searchTimeout) clearTimeout(searchTimeout);
    setSearchTimeout(
      setTimeout(() => fetchPeers(val), 400),
    );
  };

  const navigateToMessaging = (targetId: string) => {
    localStorage.setItem(
      PREFILL_KEY,
      JSON.stringify({ channel, target: targetId }),
    );
    try {
      useAppStore.getState().setView("messaging");
    } catch {
      /* navigation unavailable */
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Search */}
      <div style={{ padding: "12px 20px 8px", flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            borderRadius: 8,
            background: "var(--bg-input, var(--bg-hover))",
            border: "1px solid var(--border)",
          }}
        >
          <Search
            style={{
              width: 13,
              height: 13,
              color: "var(--text-muted)",
              flexShrink: 0,
            }}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search peers..."
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              color: "var(--text)",
              fontSize: 12,
            }}
          />
          {loading && (
            <Loader2
              style={{
                width: 12,
                height: 12,
                color: "var(--text-muted)",
                animation: "spin 1s linear infinite",
              }}
            />
          )}
        </div>
      </div>

      {error && (
        <div style={{ padding: "0 20px" }}>
          <ErrorBanner text={error} onRetry={() => fetchPeers(query)} />
        </div>
      )}

      {/* List */}
      <div style={{ flex: 1, overflow: "auto", padding: "0 20px 16px" }}>
        {!loading && peers.length === 0 ? (
          <EmptyState
            text={query ? "No peers match your search" : "No peers found"}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {peers.map((peer) => (
              <div
                key={peer.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                }}
              >
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    background: "var(--bg-hover)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <User
                    style={{
                      width: 14,
                      height: 14,
                      color: "var(--text-muted)",
                    }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      color: "var(--text)",
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {peer.name || peer.username || peer.id}
                  </span>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginTop: 2,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--text-muted)",
                        fontFamily: "monospace",
                      }}
                    >
                      {peer.id}
                    </span>
                    {peer.status && (
                      <span
                        style={{
                          fontSize: 9,
                          padding: "1px 6px",
                          borderRadius: 6,
                          background: "var(--bg-hover)",
                          color: "var(--text-muted)",
                        }}
                      >
                        {peer.status}
                      </span>
                    )}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    flexShrink: 0,
                  }}
                >
                  <CopyButton text={peer.id} />
                  <button
                    onClick={() => navigateToMessaging(peer.id)}
                    title="Message this peer"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "4px 10px",
                      borderRadius: 6,
                      border: "none",
                      background: "var(--accent-bg)",
                      color: "var(--accent)",
                      fontSize: 10,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    <Mail style={{ width: 10, height: 10 }} />
                    Message
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB: Groups
   ══════════════════════════════════════════════════════════════ */

function GroupsTab({ channel }: { channel: string }) {
  const [groups, setGroups] = useState<GroupEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchTimeout, setSearchTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [members, setMembers] = useState<Record<string, GroupMember[]>>({});
  const [membersLoading, setMembersLoading] = useState<string | null>(null);

  const fetchGroups = useCallback(
    async (q?: string) => {
      setLoading(true);
      setError(null);
      try {
        let cmd = `openclaw directory groups list --channel ${channel} --json`;
        if (q?.trim()) cmd += ` --query "${esc(q.trim())}"`;
        const raw = await runCli(cmd);
        const data = JSON.parse(raw);
        const list: GroupEntry[] = Array.isArray(data)
          ? data
          : data.groups || data.results || [];
        setGroups(
          list.map((g) => ({
            ...g,
            id: g.id || String(Math.random()),
          })),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setGroups([]);
      }
      setLoading(false);
    },
    [channel],
  );

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleSearch = (val: string) => {
    setQuery(val);
    if (searchTimeout) clearTimeout(searchTimeout);
    setSearchTimeout(
      setTimeout(() => fetchGroups(val), 400),
    );
  };

  const toggleGroup = async (groupId: string) => {
    if (expandedGroup === groupId) {
      setExpandedGroup(null);
      return;
    }
    setExpandedGroup(groupId);
    if (members[groupId]) return;

    setMembersLoading(groupId);
    try {
      const raw = await runCli(
        `openclaw directory groups members --channel ${channel} --group-id ${groupId} --json`,
      );
      const data = JSON.parse(raw);
      const list: GroupMember[] = Array.isArray(data)
        ? data
        : data.members || data.results || [];
      setMembers((prev) => ({
        ...prev,
        [groupId]: list.map((m) => ({
          ...m,
          id: m.id || String(Math.random()),
        })),
      }));
    } catch {
      setMembers((prev) => ({ ...prev, [groupId]: [] }));
    }
    setMembersLoading(null);
  };

  const navigateToMessaging = (targetId: string) => {
    localStorage.setItem(
      PREFILL_KEY,
      JSON.stringify({ channel, target: targetId }),
    );
    try {
      useAppStore.getState().setView("messaging");
    } catch {
      /* navigation unavailable */
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Search */}
      <div style={{ padding: "12px 20px 8px", flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            borderRadius: 8,
            background: "var(--bg-input, var(--bg-hover))",
            border: "1px solid var(--border)",
          }}
        >
          <Search
            style={{
              width: 13,
              height: 13,
              color: "var(--text-muted)",
              flexShrink: 0,
            }}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search groups..."
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              color: "var(--text)",
              fontSize: 12,
            }}
          />
          {loading && (
            <Loader2
              style={{
                width: 12,
                height: 12,
                color: "var(--text-muted)",
                animation: "spin 1s linear infinite",
              }}
            />
          )}
        </div>
      </div>

      {error && (
        <div style={{ padding: "0 20px" }}>
          <ErrorBanner text={error} onRetry={() => fetchGroups(query)} />
        </div>
      )}

      {/* List */}
      <div style={{ flex: 1, overflow: "auto", padding: "0 20px 16px" }}>
        {!loading && groups.length === 0 ? (
          <EmptyState
            text={query ? "No groups match your search" : "No groups found"}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {groups.map((group) => {
              const isExpanded = expandedGroup === group.id;
              const groupMembers = members[group.id];
              return (
                <div
                  key={group.id}
                  style={{
                    borderRadius: 10,
                    background: "var(--bg-elevated)",
                    border: isExpanded
                      ? "1px solid var(--accent)"
                      : "1px solid var(--border)",
                    overflow: "hidden",
                    transition: "border-color 0.15s",
                  }}
                >
                  {/* Group header */}
                  <button
                    onClick={() => toggleGroup(group.id)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    {isExpanded ? (
                      <ChevronDown
                        style={{
                          width: 14,
                          height: 14,
                          color: "var(--accent)",
                          flexShrink: 0,
                        }}
                      />
                    ) : (
                      <ChevronRight
                        style={{
                          width: 14,
                          height: 14,
                          color: "var(--text-muted)",
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        background: isExpanded
                          ? "var(--accent-bg)"
                          : "var(--bg-hover)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Users
                        style={{
                          width: 14,
                          height: 14,
                          color: isExpanded
                            ? "var(--accent)"
                            : "var(--text-muted)",
                        }}
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          color: "var(--text)",
                          display: "block",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {group.name || group.id}
                      </span>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          marginTop: 2,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 10,
                            color: "var(--text-muted)",
                            fontFamily: "monospace",
                          }}
                        >
                          {group.id}
                        </span>
                        {group.memberCount != null && (
                          <span
                            style={{
                              fontSize: 9,
                              padding: "1px 6px",
                              borderRadius: 6,
                              background: "var(--bg-hover)",
                              color: "var(--text-muted)",
                            }}
                          >
                            {group.memberCount} members
                          </span>
                        )}
                      </div>
                      {group.description && (
                        <p
                          style={{
                            margin: "3px 0 0",
                            fontSize: 10,
                            color: "var(--text-muted)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {group.description}
                        </p>
                      )}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        flexShrink: 0,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <CopyButton text={group.id} />
                      <button
                        onClick={() => navigateToMessaging(group.id)}
                        title="Message this group"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "4px 10px",
                          borderRadius: 6,
                          border: "none",
                          background: "var(--accent-bg)",
                          color: "var(--accent)",
                          fontSize: 10,
                          fontWeight: 500,
                          cursor: "pointer",
                        }}
                      >
                        <Mail style={{ width: 10, height: 10 }} />
                      </button>
                    </div>
                  </button>

                  {/* Expanded members */}
                  {isExpanded && (
                    <div
                      style={{
                        borderTop: "1px solid var(--border)",
                        padding: "8px 12px 10px",
                        background: "var(--bg-base, var(--bg-primary))",
                      }}
                    >
                      {membersLoading === group.id ? (
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
                          <span
                            style={{ fontSize: 11, color: "var(--text-muted)" }}
                          >
                            Loading members...
                          </span>
                        </div>
                      ) : !groupMembers || groupMembers.length === 0 ? (
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--text-muted)",
                            fontStyle: "italic",
                          }}
                        >
                          No members found
                        </span>
                      ) : (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 3,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 600,
                              color: "var(--text-muted)",
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                              marginBottom: 4,
                            }}
                          >
                            Members ({groupMembers.length})
                          </span>
                          {groupMembers.map((member) => (
                            <div
                              key={member.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "4px 8px",
                                borderRadius: 6,
                                background: "var(--bg-elevated)",
                              }}
                            >
                              <User
                                style={{
                                  width: 11,
                                  height: 11,
                                  color: "var(--text-muted)",
                                  flexShrink: 0,
                                }}
                              />
                              <span
                                style={{
                                  fontSize: 11,
                                  color: "var(--text)",
                                  flex: 1,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {member.name || member.id}
                              </span>
                              {member.role && (
                                <span
                                  style={{
                                    fontSize: 9,
                                    padding: "1px 6px",
                                    borderRadius: 6,
                                    background:
                                      member.role === "admin" ||
                                      member.role === "owner"
                                        ? "rgba(168,85,247,0.12)"
                                        : "var(--bg-hover)",
                                    color:
                                      member.role === "admin" ||
                                      member.role === "owner"
                                        ? "#a855f7"
                                        : "var(--text-muted)",
                                    fontWeight: 500,
                                  }}
                                >
                                  {member.role}
                                </span>
                              )}
                              <CopyButton text={member.id} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Shared sub-components ── */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={handleCopy}
      title={copied ? "Copied!" : "Copy ID"}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: 6,
        border: "none",
        background: copied ? "rgba(74,222,128,0.15)" : "var(--bg-hover)",
        color: copied ? "#4ade80" : "var(--text-muted)",
        cursor: "pointer",
        flexShrink: 0,
        transition: "all 0.15s",
      }}
    >
      <Copy style={{ width: 10, height: 10 }} />
    </button>
  );
}

function LoadingSpinner({ text }: { text: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: 8,
      }}
    >
      <Loader2
        style={{
          width: 16,
          height: 16,
          color: "var(--text-muted)",
          animation: "spin 1s linear infinite",
        }}
      />
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{text}</span>
    </div>
  );
}

function ErrorBanner({
  text,
  onRetry,
}: {
  text: string;
  onRetry?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 8,
        background: "rgba(248,113,113,0.1)",
        border: "1px solid rgba(248,113,113,0.2)",
        margin: "8px 0",
      }}
    >
      <span style={{ fontSize: 11, color: "#f87171", flex: 1 }}>{text}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            padding: "3px 10px",
            borderRadius: 6,
            border: "none",
            background: "rgba(248,113,113,0.15)",
            color: "#f87171",
            fontSize: 10,
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: 10,
      }}
    >
      <Users
        style={{ width: 32, height: 32, color: "var(--text-muted)", opacity: 0.3 }}
      />
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
        {text}
      </p>
    </div>
  );
}
