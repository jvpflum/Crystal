import { resolveOpenAiApiKeyForCrystal } from "@/lib/openclawSecrets";
import { useTokenUsageStore } from "@/stores/tokenUsageStore";

const SYSTEM_PROMPT = `You are Crystal AI, a smart assistant embedded in the Crystal desktop app — a command center for OpenClaw, an autonomous AI agent stack. You answer questions, help navigate the tool, and provide operational guidance.

Key views in Crystal:

PRIMARY NAVIGATION:
- Home: Dashboard with system performance ring gauges (CPU/RAM/Storage), lifetime token radial burst, CPU & memory sparkline trends, cron job bar chart, stat tiles (sessions/agents/skills/heartbeat), memory chunks ring gauge with dot matrix, vector store ring gauge (vector DB status, FTS, provider), LLM models (hosted OpenAI + local NVIDIA/Ollama), uptime, Telegram topics, security score, GPU monitor, and PC optimizer quick actions.
- City: Crystal City — a sim-city style interactive map showing agent buildings, activity feed, and task routing visualization.
- Chat/Conversation: Talk with the OpenClaw agent. Supports slash commands (/status, /compact, /new, /stop, /model, /think, /tts, /bash, etc.), file attachments, and multi-session management.
- Command Center: Four tabs — Calendar (agenda timeline with heatmap & day picker for cron jobs), Workflows (template launcher), Scheduled (full cron job management — add/edit/enable/disable/delete/run), and Heartbeat (system heartbeat monitoring).

OPENCLAW SECTION:
- Agents: Agent management + live monitoring dashboard with agent cards, sessions, token usage, task dispatch, and "send to chat" capability. Manages main, research, home, and finance agents.
- Forge (Factory): Software factory — nightly builds, sub-agent orchestration, Git integration, project creation, code preview, workspace management. Supports Codex and ACP-based builds.
- Memory: Knowledge store with hot/warm/cold tiers, curated memories, daily logs, vector DB tab (LanceDB embeddings, embedding config, reindexing), full-text search, and file workspace.
- Models: LLM model management — view active/available models, switch models, check status and auth for OpenAI/Anthropic/Ollama/local endpoints.
- Channels: Telegram channel configuration with topic management and message routing.
- Hooks: Agent lifecycle hooks and event triggers.

SYSTEM SECTION:
- Usage: Token usage analytics — per-provider breakdown (Anthropic, OpenAI, Ollama, Eleven Labs, NVIDIA STT/TTS), estimated costs (cloud API rates + local GPU electricity), local compute savings comparison, input/output token split table with $/M Tok column.
- Tools: Four tabs — Skills (enable/disable toggles for loaded skills), Hub (ClawHub marketplace — search, install, update verified 3rd-party skills), Sandbox (OpenShell sandbox management — install, enable/disable, Docker status, logs), and Permissions (tool permissions).
- Doctor: System diagnostics and health checks.
- Settings: App preferences, API keys, gateway config, security settings, sandbox management.

ADDITIONAL VIEWS (accessible via Ctrl+K command palette):
- Sessions: Agent session history and management. Clean up old sessions.
- Templates/Workflows: Pre-built automation sequences mapped to real skills.
- Activity: Gateway event log and activity feed.
- Security: Security audit dashboard.
- Nodes: Multi-node OpenClaw management.
- Browser: Browser automation interface.
- Workspace: File workspace explorer.
- Tasks: Background task monitoring and dispatch.
- Approvals: Exec approval queue.
- Sub-Agents: Sub-agent management and ACP sessions.
- Devices: Connected device management.
- Directory: Contact directory.
- Messaging: Notifications and messages.
- Webhooks: Webhook endpoint management.
- Voice Calls: Voice call interface (NVIDIA Riva STT/TTS).

Agents: main (JC/Juiceclaw — default), research, home, finance
Key Skills: bill-pay, bill-sweep, bounty-hunter, car-broker, charts, goplaces, home-broker, home-project, market-research-agent, memory-tiering, notion, openclaw-auto-updater, sag, self-improve, session-logs, session-wrap, summarize, venture-capital, memory-lancedb, elite-longterm-memory, memory-never-forget

TIPS FOR GUIDING USERS:
- To manage cron/scheduled jobs: Navigate to Command Center → Scheduled tab
- To see token costs and API spending: Navigate to Usage
- To enable/disable skills without CLI: Navigate to Tools → Skills tab
- To install 3rd-party skills from ClawHub: Navigate to Tools → Hub tab
- To manage sandboxes: Navigate to Tools → Sandbox tab (or Settings)
- To see vector store / embedding status: Navigate to Memory → Vector DB tab
- To dispatch tasks to agents: Navigate to Agents (monitor dashboard)
- To build software projects: Navigate to Forge
- GPU monitoring is on the Home dashboard (bottom section)

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
    useTokenUsageStore.getState().recordTokens(billed, "openai", {
      input: u?.prompt_tokens ?? Math.ceil(question.length / 4),
      output: u?.completion_tokens ?? Math.ceil(answer.length / 4),
    });
  } else {
    const est = Math.max(1, Math.ceil((question.length + answer.length) / 4));
    useTokenUsageStore.getState().recordTokens(est, "openai", {
      input: Math.ceil(question.length / 4),
      output: Math.ceil(answer.length / 4),
    });
  }

  const viewMatch = answer.match(/Navigate to:\s*(.+?)(?:\.|$)/i);
  const suggestedView = viewMatch ? mapViewName(viewMatch[1].trim()) : undefined;

  return { answer, suggestedView };
}

const VIEW_MAP: Record<string, string> = {
  // Primary
  home: "home",
  dashboard: "home",
  chat: "conversation",
  conversation: "conversation",
  city: "city",
  "crystal city": "city",
  map: "city",

  // Command Center + tabs
  "command center": "command-center",
  center: "command-center",
  calendar: "command-center:calendar",
  workflows: "command-center:workflows",
  cron: "command-center:scheduled",
  "cron jobs": "command-center:scheduled",
  "scheduled jobs": "command-center:scheduled",
  scheduled: "command-center:scheduled",
  heartbeat: "command-center:heartbeat",

  // OpenClaw
  agents: "agents",
  "agent monitor": "agents",
  "task dispatch": "agents",
  office: "agents",
  factory: "factory",
  forge: "factory",
  "software factory": "factory",
  builds: "factory",
  memory: "memory",
  "vector store": "memory",
  "vector db": "memory",
  embeddings: "memory",
  "knowledge base": "memory",
  models: "models",
  llm: "models",
  "model management": "models",
  channels: "channels",
  telegram: "channels",
  skills: "tools",
  marketplace: "tools",
  "skill store": "tools",
  plugins: "tools",
  hooks: "hooks",
  "event hooks": "hooks",

  // System
  usage: "usage",
  tokens: "usage",
  "token usage": "usage",
  spending: "usage",
  costs: "usage",
  billing: "usage",
  "api costs": "usage",
  tools: "tools",
  sandbox: "tools",
  openshell: "tools",
  "claw hub": "tools",
  clawhub: "tools",
  hub: "tools",
  "skill management": "tools",
  doctor: "doctor",
  diagnostics: "doctor",
  health: "doctor",
  "health check": "doctor",
  settings: "settings",
  preferences: "settings",
  "api keys": "settings",
  configuration: "settings",

  // Extended views
  templates: "templates",
  "workflow templates": "templates",
  sessions: "sessions",
  "session history": "sessions",
  activity: "activity",
  logs: "activity",
  "event log": "activity",
  security: "security",
  "security audit": "security",
  tasks: "tasks",
  "task queue": "tasks",
  approvals: "approvals",
  "exec approvals": "approvals",
  nodes: "nodes",
  "multi-node": "nodes",
  browser: "browser",
  "browser automation": "browser",
  workspace: "workspace",
  files: "workspace",
  messaging: "messaging",
  notifications: "messaging",
  directory: "directory",
  contacts: "directory",
  devices: "devices",
  subagents: "subagents",
  "sub-agents": "subagents",
  acp: "subagents",
  webhooks: "webhooks",
  "voice call": "voicecall",
  voice: "voicecall",

  // Dashboard sections
  gpu: "home",
  "gpu monitor": "home",
  "system performance": "home",
  "pc optimizer": "home",
  uptime: "home",
};

function mapViewName(name: string): string | undefined {
  const lower = name.toLowerCase().replace(/[^a-z\s-]/g, "").trim();
  return VIEW_MAP[lower];
}
