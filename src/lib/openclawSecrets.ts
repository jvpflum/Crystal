import { invoke } from "@tauri-apps/api/core";

/** localStorage: maps auth profile key (e.g. openai:default) → op:// reference */
export const ONEPASSWORD_REFS_KEY = "crystal_1password_refs";

export interface AuthProfileEntry {
  profileKey: string;
  type: string;
  provider: string;
  key: string;
  baseUrl?: string;
}

export interface ConfigSecretRef {
  path: string;
  masked: string;
  kind: "literal" | "op_ref" | "env_ref" | "other";
}

function lastJsonPathSegment(path: string): string {
  if (!path) return "";
  const tail = path.split(".").pop() || path;
  const bracket = tail.match(/^[A-Za-z0-9_-]+/);
  return (bracket ? bracket[0] : tail).toLowerCase();
}

function nameLooksSensitive(path: string): boolean {
  const seg = lastJsonPathSegment(path);
  if (!seg) return false;
  return /apikey|api_key|secret|token|password|auth|credential|privatekey|private_key|bearer|signing|clientsecret|client_secret|accesstoken|access_token|refreshtoken|refresh_token|webhook|hook|bot/.test(seg);
}

function maskSecret(s: string): string {
  const t = String(s);
  if (t.length <= 10) return "••••••••";
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

function classifyValue(s: string): ConfigSecretRef["kind"] {
  if (/^op:\/\//i.test(s)) return "op_ref";
  if (/^env:/i.test(s) || /^\$\{[^}]+\}$/.test(s)) return "env_ref";
  return "other";
}

function shouldReportString(path: string, s: string): boolean {
  if (typeof s !== "string" || s.length < 8) return false;
  if (nameLooksSensitive(path)) return true;
  if (/^sk-[a-zA-Z0-9_-]{8,}/.test(s)) return true;
  if (/^AIza[a-zA-Z0-9_-]{10,}/.test(s)) return true;
  if (/^gsk_[a-zA-Z0-9_-]{8,}/.test(s)) return true;
  if (s.length >= 32 && /^[A-Za-z0-9+/=_-]+$/.test(s)) return true;
  return false;
}

export function collectConfigSecretRefs(
  value: unknown,
  path = "",
  depth = 0,
  out: ConfigSecretRef[] = [],
): ConfigSecretRef[] {
  if (depth > 14 || out.length > 200) return out;
  if (value === null || value === undefined) return out;

  if (typeof value === "string") {
    if (shouldReportString(path, value)) {
      const kind = classifyValue(value);
      out.push({
        path: path || "(root)",
        masked: kind === "op_ref" || kind === "env_ref" ? value : maskSecret(value),
        kind,
      });
    }
    return out;
  }

  if (Array.isArray(value)) {
    value.forEach((item, i) => collectConfigSecretRefs(item, `${path}[${i}]`, depth + 1, out));
    return out;
  }

  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const next = path ? `${path}.${k}` : k;
      collectConfigSecretRefs(v, next, depth + 1, out);
    }
  }
  return out;
}

export async function getAuthProfilesFilePath(): Promise<string> {
  const result = await invoke<{ stdout: string }>("execute_command", {
    command: "echo $env:USERPROFILE\\.openclaw\\agents\\main\\agent\\auth-profiles.json",
    cwd: null,
  });
  return result.stdout.trim().replace(/\r?\n/g, "");
}

export async function getOpenClawConfigFilePath(): Promise<string> {
  const result = await invoke<{ stdout: string }>("execute_command", {
    command: "echo $env:USERPROFILE\\.openclaw\\openclaw.json",
    cwd: null,
  });
  return result.stdout.trim().replace(/\r?\n/g, "");
}

/** OpenAI-style secret (excludes Anthropic `sk-ant-…`). */
export function looksLikeOpenAiApiKey(s: string): boolean {
  const t = s.trim();
  return t.length >= 20 && /^sk-[a-zA-Z0-9_-]+$/.test(t) && !t.startsWith("sk-ant-");
}

export async function loadAuthProfileEntries(): Promise<AuthProfileEntry[]> {
  try {
    const path = await getAuthProfilesFilePath();
    const raw = await invoke<string>("read_file", { path });
    const data = JSON.parse(raw) as { profiles?: Record<string, Record<string, unknown>> };
    const profiles = data.profiles || {};
    return Object.entries(profiles).map(([profileKey, p]) => ({
      profileKey,
      type: String(p.type ?? "unknown"),
      provider: String(p.provider ?? profileKey.split(":")[0] ?? "?"),
      key: String(p.key ?? ""),
      baseUrl: p.baseUrl ? String(p.baseUrl) : undefined,
    }));
  } catch {
    return [];
  }
}

export function loadOnePasswordRefs(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ONEPASSWORD_REFS_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as unknown;
    return p && typeof p === "object" ? (p as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function saveOnePasswordRefs(refs: Record<string, string>): void {
  try {
    localStorage.setItem(ONEPASSWORD_REFS_KEY, JSON.stringify(refs));
  } catch { /* quota */ }
}

export async function readOnePasswordSecret(opReference: string): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
  const ref = opReference.trim();
  if (!ref.toLowerCase().startsWith("op://")) {
    return { ok: false, error: "Reference must start with op://" };
  }
  const q = ref.replace(/'/g, "''");
  try {
    const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
      command: `op read '${q}'`,
      cwd: null,
    });
    const v = (result.stdout || "").trim();
    if (result.code !== 0) {
      return { ok: false, error: result.stderr?.trim() || "op read failed (is 1Password CLI signed in?)" };
    }
    if (!v) return { ok: false, error: "1Password returned an empty value" };
    return { ok: true, value: v };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function findOpenAiKeyInOpenClawJson(value: unknown, jsonPath: string, requireOpenAiInPath: boolean): string | null {
  if (typeof value === "string") {
    if (!looksLikeOpenAiApiKey(value)) return null;
    if (requireOpenAiInPath && !/openai/i.test(jsonPath)) return null;
    return value.trim();
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const r = findOpenAiKeyInOpenClawJson(value[i], `${jsonPath}[${i}]`, requireOpenAiInPath);
      if (r) return r;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const next = jsonPath ? `${jsonPath}.${k}` : k;
      const r = findOpenAiKeyInOpenClawJson(v, next, requireOpenAiInPath);
      if (r) return r;
    }
  }
  return null;
}

async function resolveAuthProfileKeyValue(raw: string): Promise<string | null> {
  const t = raw.trim();
  if (!t || t === "ollama") return null;
  if (t.toLowerCase().startsWith("op://")) {
    const r = await readOnePasswordSecret(t);
    if (!r.ok) return null;
    const v = r.value.trim();
    return looksLikeOpenAiApiKey(v) ? v : null;
  }
  return looksLikeOpenAiApiKey(t) ? t : null;
}

/**
 * Resolves an OpenAI API key for Crystal features (e.g. command-palette AI search).
 * Order: auth-profiles.json (openai profiles, lastGood, op://), then openclaw.json (paths mentioning openai, then any OpenAI-style sk- key).
 */
export async function resolveOpenAiApiKeyForCrystal(): Promise<string | null> {
  try {
    const path = await getAuthProfilesFilePath();
    const raw = await invoke<string>("read_file", { path });
    const data = JSON.parse(raw) as {
      profiles?: Record<string, { type?: string; provider?: string; key?: string }>;
      lastGood?: Record<string, string>;
    };
    const profiles = data.profiles || {};
    const lastGood = data.lastGood || {};

    const candidateProfileKeys: string[] = [];
    const seen = new Set<string>();
    const add = (pk: string) => {
      const k = pk?.trim();
      if (!k || seen.has(k)) return;
      seen.add(k);
      candidateProfileKeys.push(k);
    };

    add("openai:default");
    if (typeof lastGood.openai === "string") add(lastGood.openai);
    for (const pk of Object.keys(profiles).sort()) {
      if (pk.startsWith("openai:")) add(pk);
    }
    for (const pk of Object.keys(profiles).sort()) {
      const p = profiles[pk];
      if (p && String(p.provider || "").toLowerCase() === "openai") add(pk);
    }

    const tryProfile = async (pk: string): Promise<string | null> => {
      const p = profiles[pk];
      if (!p || typeof p.key !== "string") return null;
      const prov = String(p.provider || pk.split(":")[0] || "").toLowerCase();
      if (prov !== "openai" && !pk.toLowerCase().startsWith("openai:")) return null;
      return resolveAuthProfileKeyValue(p.key);
    };

    for (const pk of candidateProfileKeys) {
      const key = await tryProfile(pk);
      if (key) return key;
    }
  } catch {
    /* missing or invalid auth-profiles.json */
  }

  try {
    const cfgPath = await getOpenClawConfigFilePath();
    const raw = await invoke<string>("read_file", { path: cfgPath });
    const cfg = JSON.parse(raw) as unknown;
    const hinted = findOpenAiKeyInOpenClawJson(cfg, "", true);
    if (hinted) return hinted;
    const fallback = findOpenAiKeyInOpenClawJson(cfg, "", false);
    if (fallback) return fallback;
  } catch {
    /* missing openclaw.json */
  }

  return null;
}

export async function checkOnePasswordCli(): Promise<boolean> {
  try {
    const r = await invoke<{ stdout: string; code: number }>("execute_command", {
      command: "op --version",
      cwd: null,
    });
    return r.code === 0 && Boolean(r.stdout?.trim());
  } catch {
    return false;
  }
}

/** Persist API key for a specific profile row (e.g. openai:default or anthropic:work). */
export async function saveAuthProfileForKey(
  profileKey: string,
  providerId: string,
  apiKey: string,
): Promise<{ ok: boolean; error?: string }> {
  const path = await getAuthProfilesFilePath();
  let data: Record<string, unknown> = { version: 1, profiles: {}, lastGood: {}, usageStats: {} };
  try {
    const raw = await invoke<string>("read_file", { path });
    data = JSON.parse(raw);
  } catch { /* new */ }

  const profs = { ...((data.profiles || {}) as Record<string, unknown>) };
  profs[profileKey] = { type: "api_key", provider: providerId, key: apiKey };
  data.profiles = profs;
  const lastGood = { ...((data.lastGood || {}) as Record<string, string>) };
  lastGood[providerId] = profileKey;
  data.lastGood = lastGood;

  const writeJson = JSON.stringify(data, null, 2);
  try {
    await invoke("write_file", { path, content: writeJson });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("EPERM") || msg.includes("Access")) {
      try {
        const escaped = apiKey.replace(/'/g, "''");
        const pkEsc = profileKey.replace(/'/g, "''");
        const cmd = `$p = "$env:USERPROFILE\\.openclaw\\agents\\main\\agent\\auth-profiles.json"; $d = Get-Content $p | ConvertFrom-Json; $d.profiles.'${pkEsc}' = @{type='api_key';provider='${providerId}';key='${escaped}'}; $d | ConvertTo-Json -Depth 10 | Set-Content $p -Encoding UTF8`;
        const result = await invoke<{ code: number; stderr: string }>("execute_command", { command: cmd, cwd: null });
        if (result.code === 0) return { ok: true };
        return { ok: false, error: result.stderr || "Fallback save failed" };
      } catch (e2) {
        return { ok: false, error: e2 instanceof Error ? e2.message : String(e2) };
      }
    }
    return { ok: false, error: msg };
  }
}

/** Persist API key for `providerId:default`. */
export async function saveAuthProfileApiKey(providerId: string, apiKey: string): Promise<{ ok: boolean; error?: string }> {
  return saveAuthProfileForKey(`${providerId}:default`, providerId, apiKey);
}
