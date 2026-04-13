import { create } from "zustand";

const STORAGE_KEY = "crystal_lifetime_token_usage_v1";
const PROVIDER_STORAGE_KEY = "crystal_provider_usage_v1";

/** ~4 chars per token (common heuristic when the provider does not return usage). */
export function roughTokenPairEstimate(userText: string, assistantText: string): number {
  const n = userText.length + assistantText.length;
  return Math.max(1, Math.ceil(n / 4));
}

export interface TokenMilestone {
  id: string;
  threshold: number;
  title: string;
  flavor: string;
  emoji: string;
}

export const TOKEN_MILESTONES: TokenMilestone[] = [
  { id: "1k", threshold: 1_000, title: "Spark started", emoji: "⚡", flavor: "Your first thousand tokens are on the board." },
  { id: "5k", threshold: 5_000, title: "Warming up", emoji: "🔥", flavor: "Five thousand tokens — the models noticed." },
  { id: "10k", threshold: 10_000, title: "Context cadet", emoji: "🎖️", flavor: "Ten thousand tokens of conversation." },
  { id: "25k", threshold: 25_000, title: "Token tinkerer", emoji: "🛠️", flavor: "Twenty-five thousand — you're in deep." },
  { id: "50k", threshold: 50_000, title: "Neural nomad", emoji: "🧭", flavor: "Fifty thousand tokens wandered through Crystal." },
  { id: "100k", threshold: 100_000, title: "Stack smasher", emoji: "💥", flavor: "Six-figure tokens. Respect." },
  { id: "250k", threshold: 250_000, title: "Heavy hitter", emoji: "🥊", flavor: "A quarter million tokens deep." },
  { id: "500k", threshold: 500_000, title: "Half a megatoken", emoji: "🌊", flavor: "Half a million — that's real volume." },
  { id: "1m", threshold: 1_000_000, title: "Megatron (friendly)", emoji: "🤖", flavor: "One million tokens. Legend tier." },
  { id: "5m", threshold: 5_000_000, title: "Datacenter dweller", emoji: "🏢", flavor: "Five million tokens. The fans spin for you." },
  { id: "10m", threshold: 10_000_000, title: "Token tycoon", emoji: "👑", flavor: "Ten million tokens. Touch grass (optional)." },
];

// ── Provider definitions ──────────────────────────────────────

export type ProviderId =
  | "openai"
  | "anthropic"
  | "vllm"
  | "elevenlabs"
  | "nvidia-stt"
  | "nvidia-tts"
  | "deepseek"
  | "xai"
  | "google"
  | "other";

export interface ProviderMeta {
  id: ProviderId;
  name: string;
  color: string;
  costPerMillionInput: number;
  costPerMillionOutput: number;
  isLocal: boolean;
}

/**
 * Pricing notes:
 *  - Cloud: published API rates (blended across common models per provider).
 *  - Local (vLLM, NVIDIA): electricity-only estimate for an RTX 5090 (575 W TDP,
 *    ~350 W avg during inference) at California residential rates (~$0.32/kWh).
 *    At ~60 tok/s output throughput the marginal electricity cost is ≈$0.07/M output
 *    tokens — roughly 100-200× cheaper than cloud APIs.
 *  - ElevenLabs: ~$0.24 per 1 K characters; mapped to token-equivalent units
 *    assuming ~4 chars/token → ~$960/M output tokens.
 */
export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  openai:      { id: "openai",      name: "OpenAI",       color: "#10a37f", costPerMillionInput: 2.50,  costPerMillionOutput: 10.00,  isLocal: false },
  anthropic:   { id: "anthropic",   name: "Anthropic",    color: "#d4a27f", costPerMillionInput: 3.00,  costPerMillionOutput: 15.00,  isLocal: false },
  vllm:        { id: "vllm",        name: "vLLM",         color: "#6366f1", costPerMillionInput: 0.01,  costPerMillionOutput: 0.07,   isLocal: true },
  elevenlabs:  { id: "elevenlabs",  name: "ElevenLabs",   color: "#ff6b35", costPerMillionInput: 0,     costPerMillionOutput: 960.00, isLocal: false },
  "nvidia-stt":{ id: "nvidia-stt",  name: "NVIDIA STT",   color: "#76b900", costPerMillionInput: 0.002, costPerMillionOutput: 0.005,  isLocal: true },
  "nvidia-tts":{ id: "nvidia-tts",  name: "NVIDIA TTS",   color: "#76b900", costPerMillionInput: 0.003, costPerMillionOutput: 0.008,  isLocal: true },
  deepseek:    { id: "deepseek",    name: "DeepSeek",     color: "#4f8cff", costPerMillionInput: 0.27,  costPerMillionOutput: 1.10,   isLocal: false },
  xai:         { id: "xai",         name: "xAI (Grok)",   color: "#1d9bf0", costPerMillionInput: 2.00,  costPerMillionOutput: 10.00,  isLocal: false },
  google:      { id: "google",      name: "Google",       color: "#4285f4", costPerMillionInput: 1.25,  costPerMillionOutput: 5.00,   isLocal: false },
  other:       { id: "other",       name: "Other",        color: "#94a3b8", costPerMillionInput: 0,     costPerMillionOutput: 0,      isLocal: false },
};

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requests: number;
  lastUsed: number;
  errors: number;
}

export interface DailyBucket {
  date: string; // YYYY-MM-DD
  providers: Partial<Record<ProviderId, ProviderUsage>>;
}

export interface CreditAlert {
  providerId: ProviderId;
  message: string;
  severity: "warning" | "critical";
  timestamp: number;
}

// ── Persistence ───────────────────────────────────────────────

function loadPersisted(): { totalTokens: number; celebratedIds: string[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { totalTokens: 0, celebratedIds: [] };
    const j = JSON.parse(raw) as { totalTokens?: number; celebratedIds?: unknown };
    const totalTokens = Math.max(0, Math.floor(Number(j.totalTokens) || 0));
    const celebratedIds = Array.isArray(j.celebratedIds)
      ? j.celebratedIds.filter((x): x is string => typeof x === "string")
      : [];
    return { totalTokens, celebratedIds };
  } catch {
    return { totalTokens: 0, celebratedIds: [] };
  }
}

function persistSnapshot(totalTokens: number, celebratedIds: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ totalTokens, celebratedIds }));
  } catch { /* quota */ }
}

function loadProviderData(): {
  providers: Record<ProviderId, ProviderUsage>;
  dailyHistory: DailyBucket[];
  creditAlerts: CreditAlert[];
} {
  const empty: Record<ProviderId, ProviderUsage> = {} as Record<ProviderId, ProviderUsage>;
  for (const id of Object.keys(PROVIDER_META) as ProviderId[]) {
    empty[id] = { inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0, lastUsed: 0, errors: 0 };
  }
  try {
    const raw = localStorage.getItem(PROVIDER_STORAGE_KEY);
    if (!raw) return { providers: empty, dailyHistory: [], creditAlerts: [] };
    const j = JSON.parse(raw);
    const providers = { ...empty };
    if (j.providers && typeof j.providers === "object") {
      for (const [k, v] of Object.entries(j.providers)) {
        if (k in PROVIDER_META && v && typeof v === "object") {
          const u = v as Record<string, unknown>;
          providers[k as ProviderId] = {
            inputTokens: Number(u.inputTokens) || 0,
            outputTokens: Number(u.outputTokens) || 0,
            totalTokens: Number(u.totalTokens) || 0,
            requests: Number(u.requests) || 0,
            lastUsed: Number(u.lastUsed) || 0,
            errors: Number(u.errors) || 0,
          };
        }
      }
    }
    const dailyHistory = Array.isArray(j.dailyHistory) ? j.dailyHistory.slice(-90) : [];
    const creditAlerts = Array.isArray(j.creditAlerts) ? j.creditAlerts : [];
    return { providers, dailyHistory, creditAlerts };
  } catch {
    return { providers: empty, dailyHistory: [], creditAlerts: [] };
  }
}

function persistProviderData(
  providers: Record<ProviderId, ProviderUsage>,
  dailyHistory: DailyBucket[],
  creditAlerts: CreditAlert[],
) {
  try {
    localStorage.setItem(PROVIDER_STORAGE_KEY, JSON.stringify({
      providers,
      dailyHistory: dailyHistory.slice(-90),
      creditAlerts,
    }));
  } catch { /* quota */ }
}

// ── Helpers ───────────────────────────────────────────────────

export function formatLifetimeTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return String(Math.floor(n));
}

export function formatCost(dollars: number): string {
  if (dollars >= 100) return `$${dollars.toFixed(0)}`;
  if (dollars >= 1) return `$${dollars.toFixed(2)}`;
  if (dollars >= 0.01) return `$${dollars.toFixed(3)}`;
  if (dollars === 0) return "$0.00";
  return `$${dollars.toFixed(4)}`;
}

export function estimateCost(provider: ProviderId, input: number, output: number): number {
  const meta = PROVIDER_META[provider];
  if (!meta) return 0;
  return (input / 1_000_000) * meta.costPerMillionInput
       + (output / 1_000_000) * meta.costPerMillionOutput;
}

/** What the same tokens would have cost if sent to a cloud API (default: Anthropic Sonnet pricing). */
export function hypotheticalCloudCost(input: number, output: number): number {
  return (input / 1_000_000) * PROVIDER_META.anthropic.costPerMillionInput
       + (output / 1_000_000) * PROVIDER_META.anthropic.costPerMillionOutput;
}

export function nextMilestoneAfter(total: number): TokenMilestone | null {
  return TOKEN_MILESTONES.find(m => total < m.threshold) ?? null;
}

export function unlockedMilestones(total: number): TokenMilestone[] {
  return TOKEN_MILESTONES.filter(m => total >= m.threshold);
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Store ─────────────────────────────────────────────────────

interface TokenUsageState {
  totalTokens: number;
  celebratedIds: string[];
  toastQueue: TokenMilestone[];
  providers: Record<ProviderId, ProviderUsage>;
  dailyHistory: DailyBucket[];
  creditAlerts: CreditAlert[];

  recordTokens: (delta: number, provider?: ProviderId, opts?: { input?: number; output?: number }) => void;
  recordError: (provider: ProviderId) => void;
  addCreditAlert: (alert: CreditAlert) => void;
  dismissCreditAlert: (providerId: ProviderId) => void;
  shiftToastQueue: () => void;
  resetLifetimeStats: () => void;
}

const initial = loadPersisted();
const initialProvider = loadProviderData();

export const useTokenUsageStore = create<TokenUsageState>((set, get) => ({
  totalTokens: initial.totalTokens,
  celebratedIds: initial.celebratedIds,
  toastQueue: [],
  providers: initialProvider.providers,
  dailyHistory: initialProvider.dailyHistory,
  creditAlerts: initialProvider.creditAlerts,

  recordTokens: (delta: number, provider?: ProviderId, opts?: { input?: number; output?: number }) => {
    const d = Math.max(0, Math.floor(delta));
    if (d === 0) return;
    const prev = get().totalTokens;
    const celebratedIds = get().celebratedIds;
    const prevQueue = get().toastQueue;
    const next = prev + d;
    const newlyCrossed = TOKEN_MILESTONES.filter(
      m => prev < m.threshold && next >= m.threshold && !celebratedIds.includes(m.id),
    );
    const nextCelebrated = [...celebratedIds, ...newlyCrossed.map(m => m.id)];

    const pid = provider ?? "other";
    const providers = { ...get().providers };
    const pu = { ...providers[pid] };
    const inputT = opts?.input ?? Math.floor(d * 0.3);
    const outputT = opts?.output ?? (d - inputT);
    pu.inputTokens += inputT;
    pu.outputTokens += outputT;
    pu.totalTokens += d;
    pu.requests += 1;
    pu.lastUsed = Date.now();
    providers[pid] = pu;

    const dailyHistory = [...get().dailyHistory];
    const today = todayKey();
    let bucket = dailyHistory.find(b => b.date === today);
    if (!bucket) {
      bucket = { date: today, providers: {} };
      dailyHistory.push(bucket);
    }
    const dp = bucket.providers[pid] ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0, lastUsed: 0, errors: 0 };
    dp.inputTokens += inputT;
    dp.outputTokens += outputT;
    dp.totalTokens += d;
    dp.requests += 1;
    dp.lastUsed = Date.now();
    bucket.providers[pid] = dp;

    set({
      totalTokens: next,
      celebratedIds: nextCelebrated,
      toastQueue: newlyCrossed.length ? [...prevQueue, ...newlyCrossed] : prevQueue,
      providers,
      dailyHistory,
    });
    persistSnapshot(next, nextCelebrated);
    persistProviderData(providers, dailyHistory, get().creditAlerts);
  },

  recordError: (provider: ProviderId) => {
    const providers = { ...get().providers };
    const pu = { ...providers[provider] };
    pu.errors += 1;
    providers[provider] = pu;
    set({ providers });
    persistProviderData(providers, get().dailyHistory, get().creditAlerts);
  },

  addCreditAlert: (alert: CreditAlert) => {
    const alerts = get().creditAlerts.filter(a => a.providerId !== alert.providerId);
    alerts.push(alert);
    set({ creditAlerts: alerts });
    persistProviderData(get().providers, get().dailyHistory, alerts);
  },

  dismissCreditAlert: (providerId: ProviderId) => {
    const alerts = get().creditAlerts.filter(a => a.providerId !== providerId);
    set({ creditAlerts: alerts });
    persistProviderData(get().providers, get().dailyHistory, alerts);
  },

  shiftToastQueue: () => {
    set(s => ({ toastQueue: s.toastQueue.slice(1) }));
  },

  resetLifetimeStats: () => {
    const emptyProviders: Record<ProviderId, ProviderUsage> = {} as Record<ProviderId, ProviderUsage>;
    for (const id of Object.keys(PROVIDER_META) as ProviderId[]) {
      emptyProviders[id] = { inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0, lastUsed: 0, errors: 0 };
    }
    set({ totalTokens: 0, celebratedIds: [], toastQueue: [], providers: emptyProviders, dailyHistory: [], creditAlerts: [] });
    persistSnapshot(0, []);
    persistProviderData(emptyProviders, [], []);
  },
}));
