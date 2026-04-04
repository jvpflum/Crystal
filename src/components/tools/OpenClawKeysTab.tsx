import { useState, useEffect, useCallback, type CSSProperties } from "react";
import { KeyRound, RefreshCw, Loader2, Eye, EyeOff, AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { openclawClient } from "@/lib/openclaw";
import {
  type AuthProfileEntry,
  type ConfigSecretRef,
  collectConfigSecretRefs,
  loadAuthProfileEntries,
  loadOnePasswordRefs,
  saveOnePasswordRefs,
  readOnePasswordSecret,
  checkOnePasswordCli,
  saveAuthProfileApiKey,
  saveAuthProfileForKey,
  ONEPASSWORD_REFS_KEY,
} from "@/lib/openclawSecrets";

const MONO: CSSProperties = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" };
const CARD: CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  overflow: "hidden",
  marginBottom: 16,
};
const BTN: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 500,
  border: "none",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};
const INPUT: CSSProperties = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "8px 10px",
  color: "var(--text)",
  fontSize: 11,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  ...MONO,
};

const PROVIDER_PRESETS = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "google", label: "Google AI" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "groq", label: "Groq" },
  { id: "mistral", label: "Mistral" },
] as const;

function maskKey(key: string): string {
  if (!key || key === "ollama") return key || "—";
  if (key.length <= 12) return "••••••••";
  return `${key.slice(0, 6)}••••••••${key.slice(-4)}`;
}

export function OpenClawKeysTab() {
  const [profiles, setProfiles] = useState<AuthProfileEntry[]>([]);
  const [configRefs, setConfigRefs] = useState<ConfigSecretRef[]>([]);
  const [configPath, setConfigPath] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const [opAvailable, setOpAvailable] = useState(false);
  const [opRefs, setOpRefs] = useState<Record<string, string>>(() => loadOnePasswordRefs());
  const [opProvider, setOpProvider] = useState<string>("openai");
  const [opRefInput, setOpRefInput] = useState("");
  const [opPulling, setOpPulling] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const [entries, cfg, opOk] = await Promise.all([
        loadAuthProfileEntries(),
        openclawClient.getConfig(true),
        checkOnePasswordCli(),
      ]);
      setProfiles(entries);
      setConfigRefs(collectConfigSecretRefs(cfg));
      setOpAvailable(opOk);
      try {
        const dir = await openclawClient.getOpenClawHomeDir();
        setConfigPath(dir ? `${dir}\\openclaw.json` : "~/.openclaw/openclaw.json");
      } catch {
        setConfigPath("~/.openclaw/openclaw.json");
      }
      setOpRefs(loadOnePasswordRefs());
    } catch (e) {
      setFeedback({ type: "error", msg: e instanceof Error ? e.message : "Failed to load keys" });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 5000);
    return () => clearTimeout(t);
  }, [feedback]);

  const persistOpRef = (profileKey: string, ref: string) => {
    const next = { ...opRefs, [profileKey]: ref.trim() };
    if (!ref.trim()) delete next[profileKey];
    setOpRefs(next);
    saveOnePasswordRefs(next);
  };

  const pullFrom1Password = async () => {
    const ref = opRefInput.trim();
    if (!ref) {
      setFeedback({ type: "error", msg: "Enter an op:// reference" });
      return;
    }
    setOpPulling(true);
    setFeedback(null);
    const secret = await readOnePasswordSecret(ref);
    if (!secret.ok) {
      setFeedback({ type: "error", msg: secret.error });
      setOpPulling(false);
      return;
    }
    const pk = `${opProvider}:default`;
    const save = await saveAuthProfileApiKey(opProvider, secret.value);
    if (!save.ok) {
      setFeedback({ type: "error", msg: save.error || "Failed to write auth-profiles.json" });
      setOpPulling(false);
      return;
    }
    persistOpRef(pk, ref);
    setFeedback({ type: "success", msg: `Saved ${opProvider} key from 1Password` });
    await loadAll();
    setOpPulling(false);
  };

  const pullForProfile = async (profileKey: string) => {
    const ref = (opRefs[profileKey] || "").trim();
    if (!ref) {
      setFeedback({ type: "error", msg: "Save an op:// reference for this profile first" });
      return;
    }
    setOpPulling(true);
    const secret = await readOnePasswordSecret(ref);
    if (!secret.ok) {
      setFeedback({ type: "error", msg: secret.error });
      setOpPulling(false);
      return;
    }
    const provider = profileKey.split(":")[0] || "openai";
    const save = await saveAuthProfileForKey(profileKey, provider, secret.value);
    if (!save.ok) {
      setFeedback({ type: "error", msg: save.error || "Save failed" });
      setOpPulling(false);
      return;
    }
    setFeedback({ type: "success", msg: `Refreshed ${profileKey} from 1Password` });
    await loadAll();
    setOpPulling(false);
  };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px 24px 24px" }}>
      <style>{`@keyframes _kspin { to { transform: rotate(360deg) } }`}</style>

      {feedback && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            borderRadius: 8,
            marginBottom: 14,
            background: feedback.type === "success" ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)",
            border: `1px solid ${feedback.type === "success" ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`,
          }}
        >
          {feedback.type === "success" ? (
            <CheckCircle2 style={{ width: 14, height: 14, color: "#4ade80", flexShrink: 0 }} />
          ) : (
            <AlertTriangle style={{ width: 14, height: 14, color: "#f87171", flexShrink: 0 }} />
          )}
          <span style={{ fontSize: 11, color: feedback.type === "success" ? "#4ade80" : "#f87171", flex: 1 }}>{feedback.msg}</span>
          <button type="button" onClick={() => setFeedback(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
            ×
          </button>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <KeyRound style={{ width: 16, height: 16, color: "var(--accent)" }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>OpenClaw keys &amp; secrets</span>
        </div>
        <button type="button" onClick={() => loadAll()} disabled={loading} style={{ ...BTN, background: "var(--bg-hover)", color: "var(--text-muted)" }}>
          <RefreshCw style={{ width: 12, height: 12, ...(loading ? { animation: "_kspin 1s linear infinite" } : {}) }} />
          Refresh
        </button>
      </div>

      <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 16px", lineHeight: 1.5 }}>
        Auth profiles come from <code style={MONO}>auth-profiles.json</code>. Config paths below are scanned from{" "}
        <code style={MONO}>openclaw.json</code> (property names and token-like values). Use{" "}
        <strong>1Password CLI</strong> (<code style={MONO}>op</code>) to store secrets in your vault and sync them here when you choose — references are saved in this app (
        <code style={MONO}>{ONEPASSWORD_REFS_KEY}</code>).
      </p>

      {/* 1Password */}
      <div style={CARD}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>1Password</span>
          <span
            style={{
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: 8,
              background: opAvailable ? "rgba(74,222,128,0.12)" : "var(--bg-hover)",
              color: opAvailable ? "#4ade80" : "var(--text-muted)",
            }}
          >
            {opAvailable ? "CLI available" : "CLI not found (install 1Password CLI & sign in)"}
          </span>
        </div>
        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <a
            href="https://developer.1password.com/docs/cli/get-started/"
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 10, color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 4, width: "fit-content" }}
          >
            1Password CLI docs <ExternalLink style={{ width: 10, height: 10 }} />
          </a>
          <div style={{ display: "grid", gridTemplateColumns: "140px 1fr auto", gap: 8, alignItems: "end" }}>
            <div>
              <label style={{ fontSize: 9, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Provider</label>
              <select value={opProvider} onChange={e => setOpProvider(e.target.value)} style={{ ...INPUT, fontFamily: "inherit" }}>
                {PROVIDER_PRESETS.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 9, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Item reference</label>
              <input
                value={opRefInput}
                onChange={e => setOpRefInput(e.target.value)}
                placeholder="op://VaultName/ItemName/credential"
                style={INPUT}
              />
            </div>
            <button
              type="button"
              onClick={pullFrom1Password}
              disabled={opPulling || !opAvailable}
              style={{ ...BTN, background: "var(--accent-bg)", color: "var(--accent)", height: 36 }}
            >
              {opPulling ? <Loader2 style={{ width: 12, height: 12, animation: "_kspin 1s linear infinite" }} /> : null}
              Pull &amp; save
            </button>
          </div>
        </div>
      </div>

      {/* Auth profiles */}
      <div style={CARD}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>Auth profiles</span>
          <p style={{ margin: "4px 0 0", fontSize: 10, color: "var(--text-muted)" }}>
            ~/.openclaw/agents/main/agent/auth-profiles.json — all profile entries
          </p>
        </div>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <Loader2 style={{ width: 20, height: 20, color: "var(--accent)", animation: "_kspin 1s linear infinite", margin: "0 auto" }} />
          </div>
        ) : profiles.length === 0 ? (
          <div style={{ padding: 20, fontSize: 11, color: "var(--text-muted)" }}>No profiles found (add keys via Settings or 1Password above).</div>
        ) : (
          profiles.map(p => {
            const vis = showKey[p.profileKey];
            const display = vis ? p.key : maskKey(p.key);
            return (
              <div key={p.profileKey} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", ...MONO }}>{p.profileKey}</span>
                    <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 8 }}>
                      {p.type} · {p.provider}
                      {p.baseUrl ? ` · ${p.baseUrl}` : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowKey(s => ({ ...s, [p.profileKey]: !s[p.profileKey] }))}
                    style={{ ...BTN, background: "transparent", color: "var(--text-muted)", padding: "4px 8px" }}
                  >
                    {vis ? <EyeOff style={{ width: 12, height: 12 }} /> : <Eye style={{ width: 12, height: 12 }} />}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 6, wordBreak: "break-all", ...MONO }}>{display}</div>
                <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    value={opRefs[p.profileKey] || ""}
                    onChange={e => persistOpRef(p.profileKey, e.target.value)}
                    placeholder="op://… (save reference for this profile)"
                    style={{ ...INPUT, flex: 1, minWidth: 200 }}
                  />
                  <button
                    type="button"
                    onClick={() => pullForProfile(p.profileKey)}
                    disabled={opPulling || !opAvailable || !(opRefs[p.profileKey] || "").trim()}
                    style={{ ...BTN, background: "var(--bg-hover)", color: "var(--text)", fontSize: 10 }}
                  >
                    Refresh from 1Password
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* openclaw.json scan */}
      <div style={CARD}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>openclaw.json</span>
          <p style={{ margin: "4px 0 0", fontSize: 10, color: "var(--text-muted)", ...MONO }}>{configPath}</p>
        </div>
        {configRefs.length === 0 ? (
          <div style={{ padding: 20, fontSize: 11, color: "var(--text-muted)" }}>
            No secret-like string fields detected (or config empty). Tokens in auth-profiles only won’t appear here.
          </div>
        ) : (
          configRefs.map((r, i) => (
            <div key={`${r.path}-${i}`} style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, color: "var(--accent)", ...MONO }}>{r.path}</span>
              <span style={{ fontSize: 10, color: "var(--text-secondary)", ...MONO }}>
                {r.masked}
                <span style={{ marginLeft: 8, color: "var(--text-muted)", textTransform: "uppercase" }}>{r.kind}</span>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
