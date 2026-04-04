import { resolveOpenAiApiKeyForCrystal } from "@/lib/openclawSecrets";
import { useTokenUsageStore } from "@/stores/tokenUsageStore";

const SYSTEM_PROMPT = `You are Crystal AI, a smart assistant embedded in the Crystal desktop app — a command center for OpenClaw, an autonomous AI agent stack. You answer questions, help navigate the tool, and provide operational guidance.

Key views in Crystal:
- Home: Dashboard with system status, Telegram topics, cron health, quick actions
- Chat/Conversation: Talk with the OpenClaw agent
- Office: Live agent monitoring — shows all agents (main, research, home, finance) with sessions and tasks
- Factory: Skill launcher grid (18+ workspace skills like bill-sweep, bounty-hunter, car-broker, etc.) plus project builder
- Command Center: Calendar, workflows, scheduled jobs (cron), and heartbeat — use the Scheduled tab for cron management
- Workflows/Templates: Pre-built automation sequences mapped to real skills
- Channels: Telegram configuration with topic management (Finance #16, Home #17, System #38, Neighborhood #89, Factory #1195)
- Memory: Knowledge store with hot/warm/cold tiers
- Models: LLM model management
- Agents: Agent configuration and sessions
- Tasks: Background task monitoring
- Approvals: Exec approval management
- Security: Security audit
- Doctor: System diagnostics
- Settings: App preferences

Agents: main (JC/Juiceclaw — default), research, home, finance
Skills include: bill-pay, bill-sweep, bounty-hunter, car-broker, charts, goplaces, home-broker, home-project, market-research-agent, memory-tiering, notion, openclaw-auto-updater, sag, self-improve, session-logs, session-wrap, summarize, venture-capital

Keep answers concise (2-4 sentences max). If the question is about navigating Crystal, suggest the specific view to open. If it's a general question, answer directly. Format navigation suggestions as: "Navigate to: [view name]"`;

let cachedApiKey: string | null = null;

/** Call after the user updates OpenClaw keys in Settings / Tools so the next AI search reloads. */
export function clearOpenAiSearchKeyCache(): void {
  cachedApiKey = null;
}

async function getApiKey(): Promise<string> {
  if (cachedApiKey) return cachedApiKey;
  const key = await resolveOpenAiApiKeyForCrystal();
  if (!key) {
    throw new Error(
      "No OpenAI API key found. Add an OpenAI profile in OpenClaw (Settings → API keys or Tools → Keys), or put an OpenAI sk-… key under an openai-related path in openclaw.json / auth-profiles.json.",
    );
  }
  cachedApiKey = key;
  return cachedApiKey;
}

export interface AiSearchResult {
  answer: string;
  suggestedView?: string;
}

export async function askCrystalAI(question: string): Promise<AiSearchResult> {
  const apiKey = await getApiKey();

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: question },
      ],
      max_tokens: 300,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const data = await response.json() as {
    choices?: { message?: { content?: string } }[];
    usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
  };
  const answer: string = data.choices?.[0]?.message?.content || "No response.";

  const u = data.usage;
  const billed =
    typeof u?.total_tokens === "number" && u.total_tokens > 0
      ? u.total_tokens
      : Math.max(0, (u?.prompt_tokens ?? 0) + (u?.completion_tokens ?? 0));
  if (billed > 0) {
    useTokenUsageStore.getState().recordTokens(billed);
  } else {
    useTokenUsageStore.getState().recordTokens(Math.max(1, Math.ceil((question.length + answer.length) / 4)));
  }

  const viewMatch = answer.match(/Navigate to:\s*(.+?)(?:\.|$)/i);
  const suggestedView = viewMatch ? mapViewName(viewMatch[1].trim()) : undefined;

  return { answer, suggestedView };
}

const VIEW_MAP: Record<string, string> = {
  home: "home",
  dashboard: "home",
  chat: "conversation",
  conversation: "conversation",
  office: "office",
  factory: "factory",
  "command center": "command-center",
  calendar: "command-center",
  workflows: "templates",
  templates: "templates",
  cron: "command-center:scheduled",
  "scheduled jobs": "command-center:scheduled",
  channels: "channels",
  telegram: "channels",
  memory: "memory",
  models: "models",
  agents: "agents",
  tasks: "tasks",
  approvals: "approvals",
  security: "security",
  doctor: "doctor",
  diagnostics: "doctor",
  settings: "settings",
  tools: "tools",
  nodes: "nodes",
  browser: "browser",
  workspace: "workspace",
  sessions: "sessions",
};

function mapViewName(name: string): string | undefined {
  const lower = name.toLowerCase().replace(/[^a-z\s-]/g, "").trim();
  return VIEW_MAP[lower];
}
