import { useState, useEffect, useCallback } from "react";
import {
  Anchor,
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Info,
  Plus,
  Download,
  Search,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { cachedCommand, invalidateCache } from "@/lib/cache";

const HOOKS_LIST_CMD = "openclaw hooks list --json";

/** PowerShell single-quoted literal (safe for hook names with @, spaces, etc.). */
function psSingleQuoted(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function extractJsonObjectOrArray(stdout: string): string {
  const t = stdout.trim();
  const a = t.indexOf("[");
  const o = t.indexOf("{");
  if (o === -1 && a === -1) return t;
  const start = a === -1 ? o : o === -1 ? a : Math.min(a, o);
  return t.slice(start);
}

function normalizeHooksList(parsed: unknown): Hook[] {
  const rawList: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? (Array.isArray((parsed as Record<string, unknown>).hooks)
          ? ((parsed as Record<string, unknown>).hooks as unknown[])
          : Array.isArray((parsed as Record<string, unknown>).items)
            ? ((parsed as Record<string, unknown>).items as unknown[])
            : [])
      : [];
  return rawList
    .map((row) => {
      const o = row as Record<string, unknown>;
      const name = String(o.name ?? o.id ?? o.hook ?? "").trim();
      if (!name) return null;
      let enabled: boolean | undefined;
      if (typeof o.enabled === "boolean") enabled = o.enabled;
      else if (typeof o.enabled === "string") {
        const e = o.enabled.toLowerCase();
        enabled = e === "true" || e === "1" || e === "yes";
      }
      if (enabled === undefined && typeof o.active === "boolean") enabled = o.active;
      if (enabled === undefined && typeof o.status === "string") {
        const s = o.status.toLowerCase();
        enabled = s === "enabled" || s === "active" || s === "on";
      }
      if (enabled === undefined) enabled = false;
      return {
        ...o,
        name,
        enabled,
        version: o.version != null ? String(o.version) : undefined,
        description: o.description != null ? String(o.description) : undefined,
        type: o.type != null ? String(o.type) : undefined,
        source: o.source != null ? String(o.source) : undefined,
      } as Hook;
    })
    .filter((h): h is Hook => h != null);
}

interface Hook {
  name: string;
  enabled: boolean;
  version?: string;
  description?: string;
  type?: string;
  source?: string;
  [key: string]: unknown;
}

interface HookDetail {
  name: string;
  description?: string;
  version?: string;
  type?: string;
  triggers?: string[];
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

interface EligibilityItem {
  name: string;
  eligible: boolean;
  reason?: string;
  [key: string]: unknown;
}

export function HooksView() {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [expandedHook, setExpandedHook] = useState<string | null>(null);
  const [hookDetail, setHookDetail] = useState<HookDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showInstall, setShowInstall] = useState(false);
  const [installSpec, setInstallSpec] = useState("");
  const [installing, setInstalling] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [eligibility, setEligibility] = useState<EligibilityItem[] | null>(null);
  const [checkingEligibility, setCheckingEligibility] = useState(false);

  const loadHooks = useCallback(async (opts?: { bypassCache?: boolean }) => {
    setError(null);
    if (opts?.bypassCache) invalidateCache(HOOKS_LIST_CMD);
    try {
      const result = await cachedCommand(HOOKS_LIST_CMD, { ttl: 120_000 });
      if (result.stdout.trim()) {
        const jsonSlice = extractJsonObjectOrArray(result.stdout);
        const parsed = JSON.parse(jsonSlice);
        setHooks(normalizeHooksList(parsed));
      } else {
        setHooks([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load hooks");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadHooks();
  }, [loadHooks]);

  const loadDetail = async (name: string) => {
    if (expandedHook === name) {
      setExpandedHook(null);
      setHookDetail(null);
      return;
    }
    setExpandedHook(name);
    setDetailLoading(true);
    try {
      const result = await cachedCommand(`openclaw hooks info ${name} --json`, { ttl: 120_000 });
      if (result.stdout.trim()) {
        try {
          setHookDetail(JSON.parse(result.stdout));
        } catch {
          setHookDetail({ name, description: result.stdout.trim() });
        }
      }
    } catch {
      setHookDetail({ name, description: "Failed to load details" });
    }
    setDetailLoading(false);
  };

  const toggleHook = async (name: string, currentlyEnabled: boolean) => {
    setToggling(name);
    setError(null);
    try {
      const q = psSingleQuoted(name);
      const cmd = currentlyEnabled
        ? `openclaw hooks disable ${q}`
        : `openclaw hooks enable ${q}`;
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: cmd,
        cwd: null,
      });
      const errText = (result.stderr || "").trim() || (result.stdout || "").trim();
      if (result.code !== 0) {
        setError(errText || `Hook toggle failed (exit ${result.code})`);
      }
      await loadHooks({ bypassCache: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Toggle failed");
    }
    setToggling(null);
  };

  const installHook = async () => {
    if (!installSpec.trim()) return;
    setInstalling(true);
    setError(null);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `openclaw hooks install ${installSpec.trim()}`,
        cwd: null,
      });
      const errOut = (result.stderr || "").trim() || (result.stdout || "").trim();
      if (result.code !== 0) {
        setError(errOut || `Install failed (exit ${result.code})`);
      } else {
        setInstallSpec("");
        setShowInstall(false);
        await loadHooks({ bypassCache: true });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Install failed");
    }
    setInstalling(false);
  };

  const updateHooks = async () => {
    setUpdating(true);
    setError(null);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "openclaw hooks update",
        cwd: null,
      });
      const errUp = (result.stderr || "").trim() || (result.stdout || "").trim();
      if (result.code !== 0) {
        setError(errUp || `Update failed (exit ${result.code})`);
      }
      await loadHooks({ bypassCache: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
    setUpdating(false);
  };

  const checkEligibility = async () => {
    setCheckingEligibility(true);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "openclaw hooks check --json",
        cwd: null,
      });
      if (result.stdout.trim()) {
        const parsed = JSON.parse(result.stdout);
        const items: EligibilityItem[] = Array.isArray(parsed) ? parsed : (parsed.hooks ?? parsed.items ?? parsed.checks ?? []);
        setEligibility(items);
      } else {
        setEligibility([]);
      }
    } catch {
      setError("Failed to check eligibility");
    }
    setCheckingEligibility(false);
  };

  const filtered = hooks.filter(
    (h) => h.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const enabledCount = hooks.filter((h) => h.enabled).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px 10px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Hooks</h2>
          {!loading && (
            <div style={{ display: "flex", gap: 6 }}>
              <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "rgba(74,222,128,0.1)", color: "var(--success)", border: "1px solid rgba(74,222,128,0.2)" }}>
                {enabledCount} active
              </span>
              <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "rgba(255,255,255,0.05)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                {hooks.length} total
              </span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => setShowInstall(!showInstall)}
            style={{
              display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
              borderRadius: 6, border: "1px solid rgba(59,130,246,0.3)", background: "rgba(59,130,246,0.12)",
              color: "var(--accent)", fontSize: 11, cursor: "pointer",
            }}
          >
            <Plus style={{ width: 12, height: 12 }} /> Install
          </button>
          <button
            onClick={updateHooks}
            disabled={updating}
            style={{
              display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
              borderRadius: 6, border: "1px solid var(--border)", background: "rgba(255,255,255,0.04)",
              color: "rgba(255,255,255,0.6)", fontSize: 11, cursor: "pointer",
            }}
          >
            {updating ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Download style={{ width: 12, height: 12 }} />}
            Update
          </button>
          <button
            onClick={checkEligibility}
            disabled={checkingEligibility}
            style={{
              display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
              borderRadius: 6, border: "1px solid var(--border)", background: "rgba(255,255,255,0.04)",
              color: "rgba(255,255,255,0.6)", fontSize: 11, cursor: "pointer",
            }}
          >
            {checkingEligibility ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <CheckCircle style={{ width: 12, height: 12 }} />}
            Check
          </button>
          <button
            onClick={() => { setLoading(true); void loadHooks({ bypassCache: true }); }}
            disabled={loading}
            style={{
              display: "flex", alignItems: "center", gap: 4, padding: "4px 8px",
              borderRadius: 6, border: "none", background: "rgba(255,255,255,0.06)",
              color: "rgba(255,255,255,0.6)", fontSize: 11, cursor: "pointer",
            }}
          >
            <RefreshCw style={{ width: 12, height: 12, ...(loading ? { animation: "spin 1s linear infinite" } : {}) }} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "0 20px 20px" }}>
        {/* Error */}
        {error && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", marginBottom: 12 }}>
            <AlertTriangle style={{ width: 14, height: 14, color: "var(--error)", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "var(--error)", flex: 1 }}>{error}</span>
            <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", fontSize: 14, cursor: "pointer" }}>×</button>
          </div>
        )}

        {/* Install panel */}
        {showInstall && (
          <div style={{ marginBottom: 12, background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
            <span style={{ fontSize: 10, textTransform: "uppercase", color: "rgba(255,255,255,0.35)", letterSpacing: 1, fontWeight: 600, display: "block", marginBottom: 8 }}>
              INSTALL HOOK
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={installSpec}
                onChange={(e) => setInstallSpec(e.target.value)}
                placeholder="Hook spec (e.g. @openclaw/hook-name)"
                onKeyDown={(e) => e.key === "Enter" && installHook()}
                style={{
                  flex: 1, fontSize: 12, padding: "8px 12px", borderRadius: 8,
                  border: "1px solid var(--border)", background: "rgba(255,255,255,0.04)",
                  color: "rgba(255,255,255,0.9)", outline: "none",
                }}
              />
              <button
                onClick={installHook}
                disabled={installing || !installSpec.trim()}
                style={{
                  padding: "8px 16px", borderRadius: 8, border: "none",
                  background: "rgba(59,130,246,0.2)", color: "var(--accent)",
                  fontSize: 12, fontWeight: 500, cursor: "pointer",
                  opacity: installing || !installSpec.trim() ? 0.5 : 1,
                }}
              >
                {installing ? "Installing..." : "Install"}
              </button>
            </div>
          </div>
        )}

        {/* Eligibility */}
        {eligibility && (
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 10, textTransform: "uppercase", color: "rgba(255,255,255,0.35)", letterSpacing: 1, fontWeight: 600, display: "block", marginBottom: 6 }}>
              ELIGIBILITY CHECK
            </span>
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
              {eligibility.length === 0 ? (
                <div style={{ padding: "16px", textAlign: "center", fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
                  No eligibility data returned
                </div>
              ) : (
                eligibility.map((item, i) => (
                  <div
                    key={item.name + i}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
                      borderBottom: i < eligibility.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                    }}
                  >
                    {item.eligible ? (
                      <CheckCircle style={{ width: 13, height: 13, color: "var(--success)", flexShrink: 0 }} />
                    ) : (
                      <XCircle style={{ width: 13, height: 13, color: "var(--error)", flexShrink: 0 }} />
                    )}
                    <span style={{ fontSize: 12, color: "var(--text)", flex: 1, fontFamily: "monospace" }}>{item.name}</span>
                    {item.reason && (
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{item.reason}</span>
                    )}
                  </div>
                ))
              )}
            </div>
            <button
              onClick={() => setEligibility(null)}
              style={{
                marginTop: 6, fontSize: 10, color: "rgba(255,255,255,0.3)", background: "none",
                border: "none", cursor: "pointer", padding: "2px 0",
              }}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Search */}
        {!loading && hooks.length > 0 && (
          <div style={{ marginBottom: 12, position: "relative" }}>
            <Search style={{ width: 13, height: 13, color: "rgba(255,255,255,0.25)", position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter hooks..."
              style={{
                width: "100%", fontSize: 12, padding: "8px 12px 8px 32px", borderRadius: 8,
                border: "1px solid var(--border)", background: "rgba(255,255,255,0.03)",
                color: "rgba(255,255,255,0.8)", outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
        )}

        {/* Hooks list */}
        <div>
          <span style={{ fontSize: 10, textTransform: "uppercase", color: "rgba(255,255,255,0.35)", letterSpacing: 1, fontWeight: 600, display: "block", marginBottom: 6 }}>
            INSTALLED HOOKS
          </span>

          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
              <Loader2 style={{ width: 20, height: 20, color: "rgba(255,255,255,0.3)", animation: "spin 1s linear infinite" }} />
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", borderRadius: 10, padding: "24px 16px", textAlign: "center" }}>
              <Anchor style={{ width: 28, height: 28, color: "rgba(255,255,255,0.12)", margin: "0 auto 8px", display: "block" }} />
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: 0 }}>
                {hooks.length === 0 ? "No hooks installed" : "No hooks match your filter"}
              </p>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", margin: "4px 0 0" }}>
                {hooks.length === 0 ? "Use the Install button to add hooks" : "Try a different search term"}
              </p>
            </div>
          ) : (
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
              {filtered.map((hook, i) => (
                <div key={hook.name} style={{ borderBottom: i < filtered.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
                    <button
                      onClick={() => loadDetail(hook.name)}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", color: "rgba(255,255,255,0.3)" }}
                    >
                      {expandedHook === hook.name
                        ? <ChevronDown style={{ width: 14, height: 14 }} />
                        : <ChevronRight style={{ width: 14, height: 14 }} />
                      }
                    </button>

                    <Anchor style={{ width: 14, height: 14, color: hook.enabled ? "var(--accent)" : "rgba(255,255,255,0.2)", flexShrink: 0 }} />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)", fontFamily: "monospace" }}>{hook.name}</span>
                        {hook.version && (
                          <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>
                            v{hook.version}
                          </span>
                        )}
                        {hook.type && (
                          <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: "rgba(59,130,246,0.1)", color: "var(--accent)", border: "1px solid rgba(59,130,246,0.2)" }}>
                            {hook.type}
                          </span>
                        )}
                      </div>
                      {hook.description && (
                        <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted)" }}>{hook.description}</p>
                      )}
                    </div>

                    {/* Toggle switch */}
                    <button
                      onClick={() => toggleHook(hook.name, hook.enabled)}
                      disabled={toggling === hook.name}
                      style={{
                        width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer",
                        background: hook.enabled ? "rgba(74,222,128,0.3)" : "var(--border)",
                        position: "relative", flexShrink: 0, transition: "background 0.2s",
                        opacity: toggling === hook.name ? 0.5 : 1,
                      }}
                    >
                      <div style={{
                        width: 16, height: 16, borderRadius: "50%",
                        background: hook.enabled ? "var(--success)" : "rgba(255,255,255,0.4)",
                        position: "absolute", top: 3,
                        left: hook.enabled ? 21 : 3,
                        transition: "left 0.2s, background 0.2s",
                      }} />
                    </button>

                    <button
                      onClick={() => loadDetail(hook.name)}
                      style={{
                        background: "none", border: "none", cursor: "pointer", padding: 4,
                        color: "rgba(255,255,255,0.3)",
                      }}
                    >
                      <Info style={{ width: 14, height: 14 }} />
                    </button>
                  </div>

                  {/* Detail panel */}
                  {expandedHook === hook.name && (
                    <div style={{ padding: "0 14px 12px 42px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                      {detailLoading ? (
                        <div style={{ padding: "12px 0", display: "flex", alignItems: "center", gap: 8 }}>
                          <Loader2 style={{ width: 12, height: 12, color: "rgba(255,255,255,0.3)", animation: "spin 1s linear infinite" }} />
                          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Loading details...</span>
                        </div>
                      ) : hookDetail ? (
                        <div style={{ paddingTop: 10 }}>
                          {hookDetail.description && (
                            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", margin: "0 0 8px", lineHeight: 1.5 }}>
                              {hookDetail.description}
                            </p>
                          )}
                          {hookDetail.triggers && hookDetail.triggers.length > 0 && (
                            <div style={{ marginBottom: 8 }}>
                              <span style={{ fontSize: 9, textTransform: "uppercase", color: "rgba(255,255,255,0.3)", letterSpacing: 0.5 }}>Triggers</span>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                                {hookDetail.triggers.map((t) => (
                                  <span key={t} style={{ fontSize: 10, fontFamily: "monospace", padding: "2px 8px", borderRadius: 6, background: "rgba(168,85,247,0.1)", color: "#c084fc", border: "1px solid rgba(168,85,247,0.2)" }}>
                                    {t}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {hookDetail.config && Object.keys(hookDetail.config).length > 0 && (
                            <div>
                              <span style={{ fontSize: 9, textTransform: "uppercase", color: "rgba(255,255,255,0.3)", letterSpacing: 0.5 }}>Config</span>
                              <pre style={{
                                fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)",
                                background: "rgba(0,0,0,0.2)", borderRadius: 6, padding: 8, marginTop: 4,
                                overflow: "auto", maxHeight: 120,
                              }}>
                                {JSON.stringify(hookDetail.config, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
