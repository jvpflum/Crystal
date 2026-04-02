export interface WorkflowStep {
  id: string;
  message: string;
  agentId?: string;
  parallel?: boolean;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: "Finance" | "Home" | "Development" | "System" | "Research" | "Productivity";
  estimatedTime: string;
  isBuiltIn: boolean;
  needsInput?: boolean;
  inputLabel?: string;
  inputPlaceholder?: string;
  steps: WorkflowStep[];
}

export const BUILTIN_WORKFLOWS: WorkflowDefinition[] = [
  {
    id: "bill-sweep",
    name: "Bill Sweep",
    description: "Sweep Gmail/Yahoo for recurring charges and update the bill sheet",
    icon: "\uD83D\uDCB3",
    category: "Finance",
    estimatedTime: "~3 min",
    isBuiltIn: true,
    steps: [
      { id: "sweep", message: "Run the bill sweep: sweep bills from Gmail and Yahoo, compare to the bill sheet, and add or correct any missing entries." },
      { id: "summary", message: "Post a summary of the bill sweep results to the Finance Telegram topic." },
    ],
  },
  {
    id: "bill-check",
    name: "Bill Check",
    description: "Check what bills are due and surface upcoming payments",
    icon: "\uD83D\uDCB0",
    category: "Finance",
    estimatedTime: "~1 min",
    isBuiltIn: true,
    steps: [
      { id: "check", message: "Check what bills are due this week. Surface any upcoming payments and create reminders for them." },
    ],
  },
  {
    id: "bounty-scout",
    name: "Bounty Scout",
    description: "Scan for open-source bounties and generate a digest of targets",
    icon: "\uD83C\uDFAF",
    category: "Development",
    estimatedTime: "~5 min",
    isBuiltIn: true,
    steps: [
      { id: "scout", message: "Run the bounty hunter scout: scan Algora, IssueHunt, and GitHub for open bounties." },
      { id: "scan", message: "Score and filter the discovered bounties. Focus on high-value targets that match our skills." },
      { id: "digest", message: "Generate a bounty digest with the top opportunities, scores, and recommended approach for each." },
    ],
  },
  {
    id: "car-deal-finder",
    name: "Car Deal Finder",
    description: "Search dealer inventory and surface below-MSRP opportunities",
    icon: "\uD83D\uDE97",
    category: "Research",
    estimatedTime: "~3 min",
    isBuiltIn: true,
    needsInput: true,
    inputLabel: "Vehicle type or search criteria",
    inputPlaceholder: "e.g. Porsche 911 GTS, Tesla Model S, BMW M3...",
    steps: [
      { id: "search", message: "Search dealer inventory for {{INPUT}}. Find motivated sellers, check days on lot, and identify below-MSRP opportunities." },
      { id: "outreach", message: "Draft personalized GM outreach emails for the best opportunities found. Do NOT send without approval." },
    ],
  },
  {
    id: "home-service-quote",
    name: "Home Service Quote",
    description: "Find contractors and get competitive quotes for home services",
    icon: "\uD83C\uDFE0",
    category: "Home",
    estimatedTime: "~3 min",
    isBuiltIn: true,
    needsInput: true,
    inputLabel: "Service needed",
    inputPlaceholder: "e.g. pressure washing, landscaping, plumbing...",
    steps: [
      { id: "find", message: "Use goplaces to find top-rated local contractors for: {{INPUT}}. Get at least 3 options with reviews." },
      { id: "quotes", message: "Draft quote request emails for the top contractors found. Do NOT send without explicit APPROVE." },
      { id: "compare", message: "Create a comparison table of the contractors: rating, review count, distance, and estimated cost range." },
    ],
  },
  {
    id: "memory-maintenance",
    name: "Memory Maintenance",
    description: "Organize, prune, and archive memory across tiers",
    icon: "\uD83E\uDDE0",
    category: "System",
    estimatedTime: "~2 min",
    isBuiltIn: true,
    steps: [
      { id: "tier", message: "Run memory tiering: organize content across HOT, WARM, and COLD memory tiers. Prune stale entries and archive old content." },
      { id: "update", message: "Update MEMORY.md with a refreshed summary of current knowledge. Ensure the most important facts are in HOT memory." },
    ],
  },
  {
    id: "session-wrap",
    name: "Session Wrap-Up",
    description: "Extract learnings, update memory, and commit knowledge from the current session",
    icon: "\uD83D\uDD01",
    category: "System",
    estimatedTime: "~2 min",
    isBuiltIn: true,
    steps: [
      { id: "wrap", message: "Run the session wrap flow: extract learnings from recent sessions, append to daily memory, update MEMORY.md with patterns and rules, and post a summary to the System Telegram topic." },
    ],
  },
  {
    id: "system-health",
    name: "System Health",
    description: "Run diagnostics, security audit, and check all services",
    icon: "\uD83C\uDFE5",
    category: "System",
    estimatedTime: "~1 min",
    isBuiltIn: true,
    steps: [
      { id: "doctor", message: "Run a full system diagnostic check and report any issues found.", parallel: true },
      { id: "security", message: "Perform a security audit: check for outdated dependencies, exposed ports, and vulnerabilities.", parallel: true },
      { id: "services", message: "Check the status of all configured services and connections.", parallel: true },
      { id: "report", message: "Generate a system health report card with scores and recommended actions." },
    ],
  },
  {
    id: "morning-briefing",
    name: "Morning Briefing",
    description: "Get weather, calendar summary, bills due, and top priorities",
    icon: "\u2600\uFE0F",
    category: "Productivity",
    estimatedTime: "~1 min",
    isBuiltIn: true,
    steps: [
      { id: "weather", message: "What's the weather forecast for today? Give a brief summary.", parallel: true },
      { id: "bills", message: "Check if any bills are due this week. Give a quick summary.", parallel: true },
      { id: "priorities", message: "Summarize my top priorities and any upcoming deadlines or meetings.", parallel: true },
      { id: "brief", message: "Compile everything into a concise morning briefing with priority items at the top." },
    ],
  },
  {
    id: "market-research",
    name: "Market Research",
    description: "Structured market research: TAM/SAM/SOM, competitors, SWOT",
    icon: "\uD83D\uDD2C",
    category: "Research",
    estimatedTime: "~3 min",
    isBuiltIn: true,
    needsInput: true,
    inputLabel: "Market or industry to research",
    inputPlaceholder: "e.g. AI code assistants, home automation, EV charging...",
    steps: [
      { id: "overview", message: "Conduct a structured market research analysis on '{{INPUT}}': TAM/SAM/SOM sizing, key trends, and market dynamics." },
      { id: "competitors", message: "Analyze the competitive landscape for '{{INPUT}}': top players, market share, strengths/weaknesses, and positioning." },
      { id: "synthesis", message: "Generate a SWOT analysis and strategic recommendations for entering or investing in '{{INPUT}}'." },
    ],
  },
  {
    id: "vc-evaluation",
    name: "VC Evaluation",
    description: "Evaluate a startup with VC frameworks and due diligence",
    icon: "\uD83D\uDCC8",
    category: "Finance",
    estimatedTime: "~3 min",
    isBuiltIn: true,
    needsInput: true,
    inputLabel: "Startup name or description",
    inputPlaceholder: "e.g. Acme Corp - AI-powered logistics...",
    steps: [
      { id: "team", message: "Evaluate the team and founding story for '{{INPUT}}'. Assess domain expertise, track record, and team dynamics." },
      { id: "market", message: "Analyze the market opportunity for '{{INPUT}}'. Size the TAM/SAM/SOM and assess timing." },
      { id: "deal", message: "Structure a potential deal for '{{INPUT}}': valuation framework, term sheet considerations, and investment thesis." },
    ],
  },
  {
    id: "code-review",
    name: "Code Review",
    description: "Automated code review with best practices analysis",
    icon: "\uD83D\uDD0D",
    category: "Development",
    estimatedTime: "~2 min",
    isBuiltIn: true,
    needsInput: true,
    inputLabel: "Project or file path",
    inputPlaceholder: "e.g. C:\\project or describe what to review...",
    steps: [
      { id: "structure", message: "Analyze the project structure at {{INPUT}} and identify the main modules.", parallel: true },
      { id: "issues", message: "Review the codebase at {{INPUT}} for common issues: unused imports, potential bugs, and code smells.", parallel: true },
      { id: "security", message: "Check {{INPUT}} for any security vulnerabilities or sensitive data exposure.", parallel: true },
      { id: "summary", message: "Provide a summary of the code review findings with priority recommendations for {{INPUT}}." },
    ],
  },
];

export const CATEGORY_COLORS: Record<string, string> = {
  Finance: "#f59e0b",
  Home: "#10b981",
  Development: "#a855f7",
  System: "#3B82F6",
  Research: "#06b6d4",
  Productivity: "#fbbf24",
};

const WF_STORAGE_KEY = "crystal-custom-workflows";

export function loadCustomWorkflows(): WorkflowDefinition[] {
  try {
    const raw = localStorage.getItem(WF_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCustomWorkflows(workflows: WorkflowDefinition[]) {
  localStorage.setItem(WF_STORAGE_KEY, JSON.stringify(workflows));
}
