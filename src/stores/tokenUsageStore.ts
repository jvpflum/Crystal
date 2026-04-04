import { create } from "zustand";

const STORAGE_KEY = "crystal_lifetime_token_usage_v1";

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
  { id: "25k", threshold: 25_000, title: "Token tinkerer", emoji: "🛠️", flavor: "Twenty-five thousand — you’re in deep." },
  { id: "50k", threshold: 50_000, title: "Neural nomad", emoji: "🧭", flavor: "Fifty thousand tokens wandered through Crystal." },
  { id: "100k", threshold: 100_000, title: "Stack smasher", emoji: "💥", flavor: "Six-figure tokens. Respect." },
  { id: "250k", threshold: 250_000, title: "Heavy hitter", emoji: "🥊", flavor: "A quarter million tokens deep." },
  { id: "500k", threshold: 500_000, title: "Half a megatoken", emoji: "🌊", flavor: "Half a million — that’s real volume." },
  { id: "1m", threshold: 1_000_000, title: "Megatron (friendly)", emoji: "🤖", flavor: "One million tokens. Legend tier." },
  { id: "5m", threshold: 5_000_000, title: "Datacenter dweller", emoji: "🏢", flavor: "Five million tokens. The fans spin for you." },
  { id: "10m", threshold: 10_000_000, title: "Token tycoon", emoji: "👑", flavor: "Ten million tokens. Touch grass (optional)." },
];

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
  } catch {
    /* quota */
  }
}

export function formatLifetimeTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return String(Math.floor(n));
}

export function nextMilestoneAfter(total: number): TokenMilestone | null {
  return TOKEN_MILESTONES.find(m => total < m.threshold) ?? null;
}

export function unlockedMilestones(total: number): TokenMilestone[] {
  return TOKEN_MILESTONES.filter(m => total >= m.threshold);
}

interface TokenUsageState {
  totalTokens: number;
  celebratedIds: string[];
  toastQueue: TokenMilestone[];
  recordTokens: (delta: number) => void;
  shiftToastQueue: () => void;
  resetLifetimeStats: () => void;
}

const initial = loadPersisted();

export const useTokenUsageStore = create<TokenUsageState>((set, get) => ({
  totalTokens: initial.totalTokens,
  celebratedIds: initial.celebratedIds,
  toastQueue: [],

  recordTokens: (delta: number) => {
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
    set({
      totalTokens: next,
      celebratedIds: nextCelebrated,
      toastQueue: newlyCrossed.length ? [...prevQueue, ...newlyCrossed] : prevQueue,
    });
    persistSnapshot(next, nextCelebrated);
  },

  shiftToastQueue: () => {
    set(s => ({ toastQueue: s.toastQueue.slice(1) }));
  },

  resetLifetimeStats: () => {
    set({ totalTokens: 0, celebratedIds: [], toastQueue: [] });
    persistSnapshot(0, []);
  },
}));
