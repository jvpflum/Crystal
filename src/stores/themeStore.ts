import { create } from "zustand";

export interface ThemeColors {
  /** App shell background */
  bgBase: string;
  /** Slightly elevated surfaces (sidebar, header) */
  bgSurface: string;
  /** Cards, panels, elevated content */
  bgElevated: string;
  /** Hover/focus on cards */
  bgHover: string;
  /** Input fields */
  bgInput: string;

  /** Primary border (structural) */
  border: string;
  /** Subtle/secondary border */
  borderSubtle: string;

  /** Primary text */
  text: string;
  /** Secondary/label text */
  textSecondary: string;
  /** Muted/placeholder text */
  textMuted: string;

  /** Accent color (buttons, links, highlights) */
  accent: string;
  /** Lighter accent for hover */
  accentHover: string;
  /** Accent text on accent background */
  accentText: string;
  /** Accent with opacity for backgrounds */
  accentBg: string;

  /** Success/online */
  success: string;
  /** Error/offline */
  error: string;
  /** Warning */
  warning: string;

  /** User chat bubble */
  chatUser: string;
  chatUserText: string;
  /** Assistant chat bubble */
  chatAssistant: string;
  chatAssistantBorder: string;

  /** Scrollbar */
  scrollbar: string;
  scrollbarHover: string;

  /** Selection highlight */
  selection: string;
}

export interface Theme {
  id: string;
  name: string;
  description: string;
  preview: string[];
  colors: ThemeColors;
}

const midnight: Theme = {
  id: "midnight",
  name: "Midnight",
  description: "Deep dark with blue accents",
  preview: ["#0a0b0f", "#111318", "#3b82f6", "#e8ecf4"],
  colors: {
    bgBase: "#0a0b0f",
    bgSurface: "#111318",
    bgElevated: "rgba(255,255,255,0.03)",
    bgHover: "rgba(255,255,255,0.055)",
    bgInput: "rgba(255,255,255,0.035)",
    border: "rgba(255,255,255,0.06)",
    borderSubtle: "rgba(255,255,255,0.035)",
    text: "#e8ecf4",
    textSecondary: "rgba(232,236,244,0.7)",
    textMuted: "rgba(232,236,244,0.35)",
    accent: "#3b82f6",
    accentHover: "#60a5fa",
    accentText: "#ffffff",
    accentBg: "rgba(59,130,246,0.1)",
    success: "#34d399",
    error: "#f87171",
    warning: "#fbbf24",
    chatUser: "linear-gradient(135deg, #3b82f6, #2563eb)",
    chatUserText: "#ffffff",
    chatAssistant: "rgba(255,255,255,0.025)",
    chatAssistantBorder: "rgba(255,255,255,0.05)",
    scrollbar: "rgba(255,255,255,0.06)",
    scrollbarHover: "rgba(255,255,255,0.14)",
    selection: "rgba(59,130,246,0.25)",
  },
};

const socal: Theme = {
  id: "socal",
  name: "SoCal",
  description: "Warm sunset tones, coastal vibes",
  preview: ["#1a1215", "#251a1e", "#f97316", "#fef3c7"],
  colors: {
    bgBase: "#1a1215",
    bgSurface: "#201519",
    bgElevated: "rgba(249,115,22,0.04)",
    bgHover: "rgba(249,115,22,0.08)",
    bgInput: "rgba(255,255,255,0.04)",
    border: "rgba(249,115,22,0.1)",
    borderSubtle: "rgba(249,115,22,0.05)",
    text: "#fef3c7",
    textSecondary: "rgba(254,243,199,0.6)",
    textMuted: "rgba(254,243,199,0.3)",
    accent: "#f97316",
    accentHover: "#fb923c",
    accentText: "#ffffff",
    accentBg: "rgba(249,115,22,0.12)",
    success: "#a3e635",
    error: "#fb7185",
    warning: "#fbbf24",
    chatUser: "linear-gradient(135deg, #f97316, #ea580c)",
    chatUserText: "#ffffff",
    chatAssistant: "rgba(249,115,22,0.04)",
    chatAssistantBorder: "rgba(249,115,22,0.08)",
    scrollbar: "rgba(249,115,22,0.12)",
    scrollbarHover: "rgba(249,115,22,0.25)",
    selection: "rgba(249,115,22,0.3)",
  },
};

const arctic: Theme = {
  id: "arctic",
  name: "Arctic",
  description: "Clean light theme with cool tones",
  preview: ["#f8fafc", "#ffffff", "#0ea5e9", "#0f172a"],
  colors: {
    bgBase: "#f0f4f8",
    bgSurface: "#ffffff",
    bgElevated: "rgba(0,0,0,0.02)",
    bgHover: "rgba(0,0,0,0.04)",
    bgInput: "rgba(0,0,0,0.03)",
    border: "rgba(0,0,0,0.08)",
    borderSubtle: "rgba(0,0,0,0.04)",
    text: "#0f172a",
    textSecondary: "rgba(15,23,42,0.6)",
    textMuted: "rgba(15,23,42,0.35)",
    accent: "#0ea5e9",
    accentHover: "#38bdf8",
    accentText: "#ffffff",
    accentBg: "rgba(14,165,233,0.08)",
    success: "#22c55e",
    error: "#ef4444",
    warning: "#f59e0b",
    chatUser: "linear-gradient(135deg, #0ea5e9, #0284c7)",
    chatUserText: "#ffffff",
    chatAssistant: "rgba(0,0,0,0.02)",
    chatAssistantBorder: "rgba(0,0,0,0.06)",
    scrollbar: "rgba(0,0,0,0.1)",
    scrollbarHover: "rgba(0,0,0,0.2)",
    selection: "rgba(14,165,233,0.2)",
  },
};

const ember: Theme = {
  id: "ember",
  name: "Ember",
  description: "Dark with warm red-amber glow",
  preview: ["#141010", "#1c1515", "#ef4444", "#fecdd3"],
  colors: {
    bgBase: "#141010",
    bgSurface: "#1a1414",
    bgElevated: "rgba(239,68,68,0.04)",
    bgHover: "rgba(239,68,68,0.07)",
    bgInput: "rgba(255,255,255,0.04)",
    border: "rgba(239,68,68,0.08)",
    borderSubtle: "rgba(239,68,68,0.04)",
    text: "#fecdd3",
    textSecondary: "rgba(254,205,211,0.6)",
    textMuted: "rgba(254,205,211,0.3)",
    accent: "#ef4444",
    accentHover: "#f87171",
    accentText: "#ffffff",
    accentBg: "rgba(239,68,68,0.12)",
    success: "#4ade80",
    error: "#fca5a5",
    warning: "#fbbf24",
    chatUser: "linear-gradient(135deg, #ef4444, #dc2626)",
    chatUserText: "#ffffff",
    chatAssistant: "rgba(239,68,68,0.04)",
    chatAssistantBorder: "rgba(239,68,68,0.07)",
    scrollbar: "rgba(239,68,68,0.1)",
    scrollbarHover: "rgba(239,68,68,0.22)",
    selection: "rgba(239,68,68,0.25)",
  },
};

const slate: Theme = {
  id: "slate",
  name: "Slate",
  description: "Soft light theme, easy on the eyes",
  preview: ["#e8ecf1", "#f3f5f7", "#6366f1", "#1e293b"],
  colors: {
    bgBase: "#e8ecf1",
    bgSurface: "#f3f5f7",
    bgElevated: "rgba(0,0,0,0.025)",
    bgHover: "rgba(0,0,0,0.05)",
    bgInput: "rgba(0,0,0,0.03)",
    border: "rgba(0,0,0,0.08)",
    borderSubtle: "rgba(0,0,0,0.04)",
    text: "#1e293b",
    textSecondary: "rgba(30,41,59,0.6)",
    textMuted: "rgba(30,41,59,0.35)",
    accent: "#6366f1",
    accentHover: "#818cf8",
    accentText: "#ffffff",
    accentBg: "rgba(99,102,241,0.08)",
    success: "#22c55e",
    error: "#ef4444",
    warning: "#f59e0b",
    chatUser: "linear-gradient(135deg, #6366f1, #4f46e5)",
    chatUserText: "#ffffff",
    chatAssistant: "rgba(0,0,0,0.025)",
    chatAssistantBorder: "rgba(0,0,0,0.06)",
    scrollbar: "rgba(0,0,0,0.1)",
    scrollbarHover: "rgba(0,0,0,0.2)",
    selection: "rgba(99,102,241,0.2)",
  },
};

const nvidia: Theme = {
  id: "nvidia",
  name: "NVIDIA",
  description: "NVIDIA green on black — built for GPU power",
  preview: ["#0a0a0a", "#121212", "#76b900", "#c8e6a0"],
  colors: {
    bgBase: "#0a0a0a",
    bgSurface: "#121212",
    bgElevated: "rgba(118,185,0,0.04)",
    bgHover: "rgba(118,185,0,0.08)",
    bgInput: "rgba(255,255,255,0.04)",
    border: "rgba(118,185,0,0.12)",
    borderSubtle: "rgba(118,185,0,0.06)",
    text: "#e4f0d0",
    textSecondary: "rgba(228,240,208,0.65)",
    textMuted: "rgba(228,240,208,0.3)",
    accent: "#76b900",
    accentHover: "#8ecf10",
    accentText: "#000000",
    accentBg: "rgba(118,185,0,0.12)",
    success: "#76b900",
    error: "#f87171",
    warning: "#fbbf24",
    chatUser: "linear-gradient(135deg, #76b900, #5a9000)",
    chatUserText: "#000000",
    chatAssistant: "rgba(118,185,0,0.04)",
    chatAssistantBorder: "rgba(118,185,0,0.1)",
    scrollbar: "rgba(118,185,0,0.1)",
    scrollbarHover: "rgba(118,185,0,0.25)",
    selection: "rgba(118,185,0,0.25)",
  },
};

const cyberpunk: Theme = {
  id: "cyberpunk",
  name: "Neon Grid",
  description: "Chrome alley — magenta & cyan glow",
  preview: ["#06060f", "#12122a", "#ff2e97", "#00f5ff"],
  colors: {
    bgBase: "#06060f",
    bgSurface: "#0c0c18",
    bgElevated: "rgba(0,245,255,0.05)",
    bgHover: "rgba(255,46,151,0.09)",
    bgInput: "rgba(0,245,255,0.06)",
    border: "rgba(0,245,255,0.18)",
    borderSubtle: "rgba(255,46,151,0.1)",
    text: "#e8fbff",
    textSecondary: "rgba(232,251,255,0.68)",
    textMuted: "rgba(232,251,255,0.36)",
    accent: "#00f5ff",
    accentHover: "#7cfffd",
    accentText: "#050510",
    accentBg: "rgba(0,245,255,0.14)",
    success: "#39ff14",
    error: "#ff2e97",
    warning: "#ffe600",
    chatUser: "linear-gradient(135deg, #ff2e97, #00f5ff)",
    chatUserText: "#050510",
    chatAssistant: "rgba(0,245,255,0.04)",
    chatAssistantBorder: "rgba(255,46,151,0.12)",
    scrollbar: "rgba(0,245,255,0.12)",
    scrollbarHover: "rgba(255,46,151,0.28)",
    selection: "rgba(0,245,255,0.28)",
  },
};

const forest: Theme = {
  id: "forest",
  name: "Forest",
  description: "Deep pine with moss accents",
  preview: ["#07120c", "#0f1f16", "#34d399", "#d1fae5"],
  colors: {
    bgBase: "#07120c",
    bgSurface: "#0f1f16",
    bgElevated: "rgba(52,211,153,0.05)",
    bgHover: "rgba(52,211,153,0.09)",
    bgInput: "rgba(255,255,255,0.04)",
    border: "rgba(52,211,153,0.12)",
    borderSubtle: "rgba(52,211,153,0.06)",
    text: "#d1fae5",
    textSecondary: "rgba(209,250,229,0.65)",
    textMuted: "rgba(209,250,229,0.32)",
    accent: "#34d399",
    accentHover: "#6ee7b7",
    accentText: "#052e1f",
    accentBg: "rgba(52,211,153,0.12)",
    success: "#4ade80",
    error: "#f87171",
    warning: "#fbbf24",
    chatUser: "linear-gradient(135deg, #059669, #34d399)",
    chatUserText: "#ffffff",
    chatAssistant: "rgba(52,211,153,0.04)",
    chatAssistantBorder: "rgba(52,211,153,0.08)",
    scrollbar: "rgba(52,211,153,0.12)",
    scrollbarHover: "rgba(52,211,153,0.26)",
    selection: "rgba(52,211,153,0.25)",
  },
};

const ocean: Theme = {
  id: "ocean",
  name: "Abyss",
  description: "Midnight teal & bioluminescent blue",
  preview: ["#040a12", "#0a1628", "#22d3ee", "#cffafe"],
  colors: {
    bgBase: "#040a12",
    bgSurface: "#0a1628",
    bgElevated: "rgba(34,211,238,0.05)",
    bgHover: "rgba(34,211,238,0.09)",
    bgInput: "rgba(255,255,255,0.04)",
    border: "rgba(34,211,238,0.14)",
    borderSubtle: "rgba(6,182,212,0.08)",
    text: "#cffafe",
    textSecondary: "rgba(207,250,254,0.65)",
    textMuted: "rgba(207,250,254,0.32)",
    accent: "#22d3ee",
    accentHover: "#67e8f9",
    accentText: "#042f2e",
    accentBg: "rgba(34,211,238,0.12)",
    success: "#2dd4bf",
    error: "#fb7185",
    warning: "#fcd34d",
    chatUser: "linear-gradient(135deg, #0891b2, #22d3ee)",
    chatUserText: "#042f2e",
    chatAssistant: "rgba(34,211,238,0.04)",
    chatAssistantBorder: "rgba(34,211,238,0.1)",
    scrollbar: "rgba(34,211,238,0.12)",
    scrollbarHover: "rgba(34,211,238,0.28)",
    selection: "rgba(34,211,238,0.22)",
  },
};

const rose: Theme = {
  id: "rose",
  name: "Rosé",
  description: "Dusk rose gold on charcoal",
  preview: ["#120a10", "#1a1218", "#fb7185", "#ffe4e6"],
  colors: {
    bgBase: "#120a10",
    bgSurface: "#1a1218",
    bgElevated: "rgba(251,113,133,0.05)",
    bgHover: "rgba(251,113,133,0.09)",
    bgInput: "rgba(255,255,255,0.04)",
    border: "rgba(251,113,133,0.12)",
    borderSubtle: "rgba(251,113,133,0.06)",
    text: "#ffe4e6",
    textSecondary: "rgba(255,228,230,0.65)",
    textMuted: "rgba(255,228,230,0.32)",
    accent: "#fb7185",
    accentHover: "#fda4af",
    accentText: "#1f0a12",
    accentBg: "rgba(251,113,133,0.12)",
    success: "#86efac",
    error: "#f87171",
    warning: "#fcd34d",
    chatUser: "linear-gradient(135deg, #e11d48, #fb7185)",
    chatUserText: "#ffffff",
    chatAssistant: "rgba(251,113,133,0.04)",
    chatAssistantBorder: "rgba(251,113,133,0.08)",
    scrollbar: "rgba(251,113,133,0.12)",
    scrollbarHover: "rgba(251,113,133,0.28)",
    selection: "rgba(251,113,133,0.22)",
  },
};

const aurora: Theme = {
  id: "aurora",
  name: "Aurora",
  description: "Violet sky with electric mint",
  preview: ["#0c0618", "#150d24", "#a78bfa", "#5eead4"],
  colors: {
    bgBase: "#0c0618",
    bgSurface: "#150d24",
    bgElevated: "rgba(167,139,250,0.06)",
    bgHover: "rgba(94,234,212,0.08)",
    bgInput: "rgba(255,255,255,0.04)",
    border: "rgba(167,139,250,0.14)",
    borderSubtle: "rgba(94,234,212,0.08)",
    text: "#ede9fe",
    textSecondary: "rgba(237,233,254,0.65)",
    textMuted: "rgba(237,233,254,0.32)",
    accent: "#a78bfa",
    accentHover: "#c4b5fd",
    accentText: "#1e1033",
    accentBg: "rgba(167,139,250,0.14)",
    success: "#5eead4",
    error: "#f472b6",
    warning: "#fcd34d",
    chatUser: "linear-gradient(135deg, #7c3aed, #5eead4)",
    chatUserText: "#0c0618",
    chatAssistant: "rgba(167,139,250,0.05)",
    chatAssistantBorder: "rgba(94,234,212,0.1)",
    scrollbar: "rgba(167,139,250,0.12)",
    scrollbarHover: "rgba(94,234,212,0.22)",
    selection: "rgba(167,139,250,0.25)",
  },
};

export const THEMES: Theme[] = [
  midnight, socal, arctic, ember, slate, nvidia,
  cyberpunk, forest, ocean, rose, aurora,
];

function applyThemeToDOM(colors: ThemeColors) {
  const r = document.documentElement.style;
  r.setProperty("--bg-base", colors.bgBase);
  r.setProperty("--bg-surface", colors.bgSurface);
  r.setProperty("--bg-elevated", colors.bgElevated);
  r.setProperty("--bg-hover", colors.bgHover);
  r.setProperty("--bg-input", colors.bgInput);
  r.setProperty("--border", colors.border);
  r.setProperty("--border-subtle", colors.borderSubtle);
  r.setProperty("--text", colors.text);
  r.setProperty("--text-secondary", colors.textSecondary);
  r.setProperty("--text-muted", colors.textMuted);
  r.setProperty("--accent", colors.accent);
  r.setProperty("--accent-hover", colors.accentHover);
  r.setProperty("--accent-text", colors.accentText);
  r.setProperty("--accent-bg", colors.accentBg);
  r.setProperty("--success", colors.success);
  r.setProperty("--error", colors.error);
  r.setProperty("--warning", colors.warning);
  r.setProperty("--chat-user", colors.chatUser);
  r.setProperty("--chat-user-text", colors.chatUserText);
  r.setProperty("--chat-assistant", colors.chatAssistant);
  r.setProperty("--chat-assistant-border", colors.chatAssistantBorder);
  r.setProperty("--scrollbar", colors.scrollbar);
  r.setProperty("--scrollbar-hover", colors.scrollbarHover);
  r.setProperty("--selection", colors.selection);
}

interface ThemeState {
  themeId: string;
  setTheme: (id: string) => void;
  getTheme: () => Theme;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const saved = localStorage.getItem("crystal_theme") || "midnight";
  const initial = THEMES.find(t => t.id === saved) || midnight;
  applyThemeToDOM(initial.colors);

  return {
    themeId: initial.id,
    setTheme: (id: string) => {
      const theme = THEMES.find(t => t.id === id);
      if (!theme) return;
      localStorage.setItem("crystal_theme", id);
      applyThemeToDOM(theme.colors);
      set({ themeId: id });
    },
    getTheme: () => {
      const { themeId } = get();
      return THEMES.find(t => t.id === themeId) || midnight;
    },
  };
});
