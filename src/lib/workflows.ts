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
  category: "Productivity" | "Development" | "System";
  estimatedTime: string;
  isBuiltIn: boolean;
  needsInput?: boolean;
  inputLabel?: string;
  inputPlaceholder?: string;
  steps: WorkflowStep[];
}

export const BUILTIN_WORKFLOWS: WorkflowDefinition[] = [
  {
    id: "morning-briefing",
    name: "Morning Briefing",
    description: "Get weather, calendar summary, and top news headlines",
    icon: "\u2600\uFE0F",
    category: "Productivity",
    estimatedTime: "~1 min",
    isBuiltIn: true,
    steps: [
      { id: "weather", message: "What's the weather forecast for today? Give a brief summary.", parallel: true },
      { id: "calendar", message: "Summarize my calendar events for today and any upcoming deadlines.", parallel: true },
      { id: "news", message: "Give me a brief summary of the top 5 news headlines today.", parallel: true },
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
  {
    id: "research-topic",
    name: "Research Topic",
    description: "Deep multi-angle research on any topic",
    icon: "\uD83D\uDD2C",
    category: "Productivity",
    estimatedTime: "~2 min",
    isBuiltIn: true,
    needsInput: true,
    inputLabel: "Research topic",
    inputPlaceholder: "e.g. Quantum computing, AI ethics, Solar energy...",
    steps: [
      { id: "overview", message: "Provide a comprehensive overview of '{{INPUT}}', including key concepts and terminology.", parallel: true },
      { id: "pros-cons", message: "Analyze the pros and cons, trade-offs, and different perspectives on '{{INPUT}}'.", parallel: true },
      { id: "sources", message: "Find and summarize the most authoritative and recent information about '{{INPUT}}'.", parallel: true },
      { id: "synthesis", message: "Synthesize all findings about '{{INPUT}}' into a structured research brief with actionable conclusions." },
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
    id: "daily-digest",
    name: "Daily Digest",
    description: "Summarize messages, emails, and notifications",
    icon: "\uD83D\uDCCB",
    category: "Productivity",
    estimatedTime: "~1 min",
    isBuiltIn: true,
    steps: [
      { id: "messages", message: "Summarize any unread messages and conversations from today.", parallel: true },
      { id: "emails", message: "Summarize important emails and highlight action items.", parallel: true },
      { id: "digest", message: "Compile everything into a concise daily digest with priority items at the top." },
    ],
  },
  {
    id: "write-email",
    name: "Write Email",
    description: "Draft a professional email on any topic",
    icon: "\u2709\uFE0F",
    category: "Productivity",
    estimatedTime: "~1 min",
    isBuiltIn: true,
    needsInput: true,
    inputLabel: "Email topic / instructions",
    inputPlaceholder: "e.g. Follow up with client about project timeline...",
    steps: [
      { id: "draft", message: "Write a professional email about: {{INPUT}}. Make it concise and well-structured." },
      { id: "polish", message: "Review and polish the email draft. Check for tone, grammar, and clarity." },
    ],
  },
  {
    id: "explain-code",
    name: "Explain Code",
    description: "Get a detailed explanation of any code or concept",
    icon: "\uD83D\uDCA1",
    category: "Development",
    estimatedTime: "~1 min",
    isBuiltIn: true,
    needsInput: true,
    inputLabel: "Code or concept to explain",
    inputPlaceholder: "Paste code or describe a concept...",
    steps: [
      { id: "explain", message: "Explain the following in detail, including what it does, how it works, and any key patterns:\n\n{{INPUT}}" },
      { id: "improve", message: "Suggest improvements, best practices, and potential issues for the code or concept above." },
    ],
  },
];

export const CATEGORY_COLORS: Record<string, string> = {
  Productivity: "#fbbf24",
  Development: "#a855f7",
  System: "#3B82F6",
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
