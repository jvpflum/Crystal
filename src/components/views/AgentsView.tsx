import { useState, useEffect, useCallback } from "react";
import {
  Bot, Plus, Trash2, RefreshCw, Loader2, Star, Pencil, Play, AlertTriangle,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { escapeShellArg } from "@/lib/tools";

interface Agent {
  id: string;
  workspace: string;
  agentDir: string;
  model: string;
  bindings: number;
  isDefault: boolean;
  routes: string[];
}

interface Binding {
  agentId: string;
  type: string;
  value: string;
}

export function AgentsView() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newAgentId, setNewAgentId] = useState("");
  const [adding, setAdding] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [editingIdentity, setEditingIdentity] = useState(false);
  const [identityName, setIdentityName] = useState("");
  const [identityEmoji, setIdentityEmoji] = useState("");
  const [savingIdentity, setSavingIdentity] = useState(false);

  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const [bindings, setBindings] = useState<Binding[]>([]);
  const [showBindForm, setShowBindForm] = useState(false);
  const [bindType, setBindType] = useState<"phone" | "channel">("phone");
  const [bindValue, setBindValue] = useState("");
  const [binding, setBinding] = useState(false);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "npx openclaw agents list --json",
        cwd: null,
      });
      if (result.code !== 0) {
        setError(result.stderr || "Failed to list agents");
        setAgents([]);
      } else {
        try {
          const data = JSON.parse(result.stdout);
          setAgents(Array.isArray(data) ? data : []);
        } catch {
          setAgents([]);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load agents");
      setAgents([]);
    }
    setLoading(false);
  }, []);

  const loadBindings = useCallback(async () => {
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "npx openclaw agents bindings --json",
        cwd: null,
      });
      if (result.code === 0) {
        try {
          const data = JSON.parse(result.stdout);
          setBindings(Array.isArray(data) ? data : []);
        } catch {
          setBindings([]);
        }
      }
    } catch {
      /* non-critical */
    }
  }, []);

  useEffect(() => {
    loadAgents();
    loadBindings();
  }, [loadAgents, loadBindings]);

  const selected = agents.find((a) => a.id === selectedId);

  const addAgent = async () => {
    if (!newAgentId.trim()) return;
    setAdding(true);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `npx openclaw agents add ${newAgentId.trim()}`,
        cwd: null,
      });
      if (result.code !== 0) {
        setError(result.stderr || "Failed to add agent");
      } else {
        setNewAgentId("");
        setShowAddForm(false);
        await loadAgents();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add agent");
    }
    setAdding(false);
  };

  const deleteAgent = async (id: string) => {
    setDeleting(true);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `npx openclaw agents delete ${id}`,
        cwd: null,
      });
      if (result.code !== 0) {
        setError(result.stderr || "Failed to delete agent");
      } else {
        setConfirmDelete(null);
        if (selectedId === id) setSelectedId(null);
        await loadAgents();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete agent");
    }
    setDeleting(false);
  };

  const saveIdentity = async (id: string) => {
    setSavingIdentity(true);
    try {
      let cmd = `npx openclaw agents set-identity ${id}`;
      if (identityName.trim()) cmd += ` --name "${escapeShellArg(identityName.trim())}"`;
      if (identityEmoji.trim()) cmd += ` --emoji "${escapeShellArg(identityEmoji.trim())}"`;
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: cmd,
        cwd: null,
      });
      if (result.code !== 0) {
        setError(result.stderr || "Failed to set identity");
      } else {
        setEditingIdentity(false);
        await loadAgents();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set identity");
    }
    setSavingIdentity(false);
  };

  const testAgent = async (id: string) => {
    setTesting(id);
    setTestResult(null);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `npx openclaw agent --agent ${id} --message "Hello, who are you?"`,
        cwd: null,
      });
      setTestResult(result.code === 0 ? result.stdout : (result.stderr || "Test failed"));
    } catch (e) {
      setTestResult(e instanceof Error ? e.message : "Test failed");
    }
    setTesting(null);
  };

  const addBinding = async (agentId: string) => {
    if (!bindValue.trim()) return;
    setBinding(true);
    try {
      const flag = bindType === "phone" ? `--phone "${escapeShellArg(bindValue.trim())}"` : `--channel "${escapeShellArg(bindValue.trim())}"`;
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `npx openclaw agents bind ${agentId} ${flag}`,
        cwd: null,
      });
      if (result.code !== 0) {
        setError(result.stderr || "Failed to add binding");
      } else {
        setBindValue("");
        setShowBindForm(false);
        await loadBindings();
        await loadAgents();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add binding");
    }
    setBinding(false);
  };

  const removeBinding = async (agentId: string, type: string, value: string) => {
    try {
      const flag = type === "phone" ? `--phone ${value}` : `--channel ${value}`;
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `npx openclaw agents unbind ${agentId} ${flag}`,
        cwd: null,
      });
      if (result.code === 0) {
        await loadBindings();
        await loadAgents();
      }
    } catch {
      /* non-critical */
    }
  };

  const agentBindings = (id: string) => bindings.filter((b) => b.agentId === id);

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Sidebar */}
      <div style={{ width: 220, flexShrink: 0, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ color: "white", fontSize: 15, fontWeight: 600, margin: 0 }}>Agents</h2>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={() => { loadAgents(); loadBindings(); }}
              style={{ background: "none", border: "none", padding: 4, cursor: "pointer", color: "var(--text-muted)" }}
            >
              <RefreshCw style={{ width: 12, height: 12 }} />
            </button>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              style={{ background: "rgba(59,130,246,0.2)", border: "none", borderRadius: 6, padding: "4px 8px", color: "var(--accent)", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
            >
              <Plus style={{ width: 12, height: 12 }} /> New
            </button>
          </div>
        </div>

        {showAddForm && (
          <div style={{ padding: "0 12px 8px", display: "flex", gap: 4 }}>
            <input
              value={newAgentId}
              onChange={(e) => setNewAgentId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addAgent()}
              placeholder="agent-id"
              style={{ flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", color: "white", fontSize: 11, outline: "none" }}
            />
            <button
              onClick={addAgent}
              disabled={adding}
              style={{ background: "var(--accent)", border: "none", borderRadius: 6, padding: "5px 10px", color: "white", fontSize: 11, cursor: "pointer" }}
            >
              {adding ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : "Add"}
            </button>
          </div>
        )}

        {error && (
          <div style={{ padding: "0 12px 8px" }}>
            <div style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 6, padding: "6px 8px", display: "flex", alignItems: "center", gap: 6 }}>
              <AlertTriangle style={{ width: 12, height: 12, color: "var(--error)", flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: "var(--error)", wordBreak: "break-word" }}>{error}</span>
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>
          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 20 }}>
              <Loader2 style={{ width: 16, height: 16, color: "rgba(255,255,255,0.3)", animation: "spin 1s linear infinite" }} />
            </div>
          ) : agents.length === 0 ? (
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", textAlign: "center", padding: 16 }}>No agents found</p>
          ) : (
            agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => {
                  setSelectedId(agent.id);
                  setEditingIdentity(false);
                  setConfirmDelete(null);
                  setTestResult(null);
                }}
                style={{
                  width: "100%", textAlign: "left" as const, padding: "10px 12px", borderRadius: 8,
                  border: "none", cursor: "pointer", marginBottom: 4,
                  background: selectedId === agent.id ? "rgba(59,130,246,0.15)" : "transparent",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => { if (selectedId !== agent.id) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                onMouseLeave={(e) => { if (selectedId !== agent.id) e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Bot style={{ width: 16, height: 16, color: agent.isDefault ? "var(--accent)" : "rgba(255,255,255,0.4)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 500, color: "white", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agent.id}</p>
                    <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)" }}>
                      {agent.model.split("/").pop()} &middot; {agent.bindings} binding{agent.bindings !== 1 ? "s" : ""}
                    </p>
                  </div>
                  {agent.isDefault && (
                    <Star style={{ width: 12, height: 12, color: "var(--warning)", flexShrink: 0 }} />
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Detail panel */}
      <div style={{ flex: 1, overflow: "auto", padding: "14px 20px 20px" }}>
        {selected ? (
          <div>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: "rgba(59,130,246,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Bot style={{ width: 24, height: 24, color: "var(--accent)" }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <h3 style={{ margin: 0, color: "white", fontSize: 16, fontWeight: 600 }}>{selected.id}</h3>
                  {selected.isDefault && (
                    <span style={{ fontSize: 9, color: "var(--warning)", background: "rgba(251,191,36,0.15)", padding: "2px 6px", borderRadius: 4, fontWeight: 600 }}>DEFAULT</span>
                  )}
                </div>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted)" }}>
                  {selected.model} &middot; {selected.bindings} binding{selected.bindings !== 1 ? "s" : ""}
                </p>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => testAgent(selected.id)}
                  disabled={testing !== null}
                  style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)", fontSize: 11, cursor: "pointer" }}
                >
                  {testing === selected.id
                    ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />
                    : <Play style={{ width: 12, height: 12 }} />}
                  Test
                </button>
                <button
                  onClick={() => setEditingIdentity(!editingIdentity)}
                  style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)", fontSize: 11, cursor: "pointer" }}
                >
                  <Pencil style={{ width: 12, height: 12 }} /> Identity
                </button>
                <button
                  onClick={() => setConfirmDelete(confirmDelete === selected.id ? null : selected.id)}
                  style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, border: "none", background: "rgba(248,113,113,0.15)", color: "var(--error)", fontSize: 11, cursor: "pointer" }}
                >
                  <Trash2 style={{ width: 12, height: 12 }} /> Delete
                </button>
              </div>
            </div>

            {/* Confirm delete */}
            {confirmDelete === selected.id && (
              <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, padding: 12, marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <AlertTriangle style={{ width: 14, height: 14, color: "var(--error)" }} />
                  <span style={{ fontSize: 12, color: "var(--error)" }}>Delete agent &ldquo;{selected.id}&rdquo;? This cannot be undone.</span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => setConfirmDelete(null)}
                    style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "rgba(255,255,255,0.6)", fontSize: 11, cursor: "pointer" }}
                  >Cancel</button>
                  <button
                    onClick={() => deleteAgent(selected.id)}
                    disabled={deleting}
                    style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "var(--error)", color: "white", fontSize: 11, cursor: "pointer" }}
                  >{deleting ? "Deleting..." : "Confirm"}</button>
                </div>
              </div>
            )}

            {/* Identity editor */}
            {editingIdentity && (
              <Section title="Set Identity">
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Name</label>
                    <input
                      value={identityName}
                      onChange={(e) => setIdentityName(e.target.value)}
                      placeholder="Display name"
                      style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", color: "white", fontSize: 12, outline: "none", boxSizing: "border-box" }}
                    />
                  </div>
                  <div style={{ width: 80 }}>
                    <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Emoji</label>
                    <input
                      value={identityEmoji}
                      onChange={(e) => setIdentityEmoji(e.target.value)}
                      placeholder="🤖"
                      style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", color: "white", fontSize: 12, outline: "none", textAlign: "center", boxSizing: "border-box" }}
                    />
                  </div>
                  <button
                    onClick={() => saveIdentity(selected.id)}
                    disabled={savingIdentity}
                    style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "var(--accent)", color: "white", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}
                  >{savingIdentity ? "Saving..." : "Save"}</button>
                </div>
              </Section>
            )}

            {/* Model */}
            <Section title="Model">
              <span style={{ fontSize: 12, fontFamily: "monospace", color: "white", background: "rgba(255,255,255,0.06)", padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)" }}>
                {selected.model}
              </span>
            </Section>

            {/* Workspace */}
            <Section title="Workspace">
              <span style={{ fontSize: 11, fontFamily: "monospace", color: "rgba(255,255,255,0.6)", wordBreak: "break-all" }}>
                {selected.workspace}
              </span>
            </Section>

            {/* Routes */}
            <Section title="Routes">
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {selected.routes.map((route, i) => (
                  <span key={i} style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", background: "rgba(255,255,255,0.04)", padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)" }}>
                    {route}
                  </span>
                ))}
              </div>
            </Section>

            {/* Bindings */}
            <Section title="Bindings">
              {agentBindings(selected.id).length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {agentBindings(selected.id).map((b, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(255,255,255,0.04)", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)" }}>
                      <div>
                        <span style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginRight: 8 }}>{b.type}</span>
                        <span style={{ fontSize: 12, color: "white", fontFamily: "monospace" }}>{b.value}</span>
                      </div>
                      <button
                        onClick={() => removeBinding(selected.id, b.type, b.value)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.3)", padding: 4 }}
                      >
                        <Trash2 style={{ width: 11, height: 11 }} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: 0 }}>No bindings</p>
              )}

              {showBindForm ? (
                <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
                  <select
                    value={bindType}
                    onChange={(e) => setBindType(e.target.value as "phone" | "channel")}
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", color: "white", fontSize: 11, outline: "none" }}
                  >
                    <option value="phone">Phone</option>
                    <option value="channel">Channel</option>
                  </select>
                  <input
                    value={bindValue}
                    onChange={(e) => setBindValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addBinding(selected.id)}
                    placeholder={bindType === "phone" ? "+1234567890" : "channel-name"}
                    style={{ flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", color: "white", fontSize: 11, outline: "none" }}
                  />
                  <button
                    onClick={() => addBinding(selected.id)}
                    disabled={binding}
                    style={{ background: "var(--accent)", border: "none", borderRadius: 6, padding: "5px 10px", color: "white", fontSize: 11, cursor: "pointer" }}
                  >{binding ? "..." : "Bind"}</button>
                  <button
                    onClick={() => { setShowBindForm(false); setBindValue(""); }}
                    style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 11, cursor: "pointer" }}
                  >Cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => setShowBindForm(true)}
                  style={{ marginTop: 8, background: "rgba(59,130,246,0.15)", border: "none", borderRadius: 6, padding: "5px 10px", color: "var(--accent)", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                >
                  <Plus style={{ width: 10, height: 10 }} /> Add Binding
                </button>
              )}
            </Section>

            {/* Test result */}
            {testResult && (
              <Section title="Test Result">
                <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: 8, padding: 10, fontSize: 12, color: "rgba(255,255,255,0.8)", whiteSpace: "pre-wrap", maxHeight: 200, overflowY: "auto", fontFamily: "monospace" }}>
                  {testResult}
                </div>
              </Section>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12 }}>
            <Bot style={{ width: 40, height: 40, color: "rgba(255,255,255,0.15)" }} />
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)" }}>Select an agent to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <p style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, marginBottom: 6, margin: 0, paddingBottom: 6 }}>{title}</p>
      {children}
    </div>
  );
}
