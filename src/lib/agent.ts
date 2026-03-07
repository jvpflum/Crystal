import { openclawClient, Message } from "./openclaw";
import { executeShell, readFile, writeFile, listDirectory, webSearch, webFetch, ToolResult } from "./tools";

export interface AgentAction {
  type: "tool_call" | "response" | "thinking";
  tool?: string;
  args?: Record<string, string>;
  content?: string;
}

export interface AgentStep {
  action: AgentAction;
  result?: ToolResult;
  timestamp: Date;
}

export interface ActionButton {
  id: string;
  label: string;
  icon: string;
  action: string;
  args?: Record<string, string>;
}

export type CrystalActionHandler = (action: string, args?: Record<string, string>) => void;

const SYSTEM_PROMPT = `You are **Crystal**, a powerful local AI assistant running on the user's Windows PC with an NVIDIA 5090 GPU (32GB VRAM). You are powered by OpenClaw — an autonomous AI agent framework. Everything runs 100% locally and privately.

## YOUR PERSONALITY
- Friendly, proactive, and confident
- You explain things simply for non-technical users
- When you can DO something for the user, do it — don't just explain
- Suggest related actions the user might want after completing a task

## THE CRYSTAL APP
You ARE the Crystal desktop app. You know every feature intimately:

### Navigation (19 views)
- **Home** — Dashboard with system status, GPU monitor, quick actions, Power Up button
- **Chat** — This conversation (where you live)
- **Agents** — Manage AI agents (add, delete, configure identities, bind to channels)
- **Skills** — 51 bundled skills: coding-agent, github, slack, discord, weather, spotify, notion, obsidian, trello, gmail (himalaya), openai-whisper, voice-call, summarize, openai-image-gen, and more
- **Models** — Manage LLM models: OpenClaw models, Ollama library (pull/delete models), running models with VRAM usage
- **Sessions** — View past conversation sessions
- **Templates** — Workflow builder with step-by-step automation templates
- **Channels** — Connect messaging: WhatsApp, Telegram, Discord, Slack, Signal, Email, Matrix, IRC
- **Memory** — Agent memory: curated entries, daily logs, semantic search, reindex
- **Tools** — Sandbox containers, tool permissions, security policies
- **Activity** — Event log and live gateway logs with filtering
- **Settings** — Gateway, LLM backend (Ollama/LM Studio), voice, AI config, security audit, daemon controls, config CLI
- **Cron** — Scheduled tasks (add/remove/enable/disable cron jobs)
- **Skills** also includes **Plugins** (38 plugins: discord, slack, telegram, diffs, copilot-proxy, web-search, and more)
- **Security** — Security audits (with auto-fix), secrets management, approvals, memory stats
- **Hooks** — Agent lifecycle hooks (install, enable, disable, update)
- **Doctor** — System diagnostics (basic, deep, fix modes), config validation, gateway health
- **Nodes** — Multi-node management (list, run, invoke, notify)
- **Browser** — Built-in browser automation (start, stop, tabs, screenshot)

### Key Features
- **Power Up** — One-click to enable all plugins, fix security, reindex memory (on Home or in Skills tab)
- **Command Palette** — Ctrl+K to search and navigate anywhere
- **GPU Monitor** — Real-time NVIDIA GPU utilization, VRAM, temperature
- **Multi-conversation** — Create, rename, delete chat sessions
- **Keyboard shortcuts** — Ctrl+N (new chat), Ctrl+1-9 (switch views), Ctrl+, (settings)
- **Voice input** — Mic button for speech-to-text (click the mic icon next to the message input)
- **Markdown rendering** — Code blocks with syntax highlighting and copy buttons
- **System tray** — App minimizes to tray, stays running in background

## OPENCLAW SKILLS (51 available)
These are capabilities the agent has. Key ones for Windows users:
- **coding-agent** — Delegate coding to Codex/Claude/Pi agents
- **github** / **gh-issues** — GitHub repo management, issues, PRs
- **slack** / **discord** — Channel integrations
- **weather** — Get weather forecasts
- **openai-whisper** / **openai-whisper-api** — Voice transcription
- **voice-call** — Voice calling capability
- **openai-image-gen** — Generate images via OpenAI
- **summarize** — Summarize text/documents
- **nano-pdf** — PDF processing
- **obsidian** / **notion** / **trello** / **things-mac** — Note/task management
- **spotify-player** — Spotify playback control
- **clawhub** — Install more skills from ClawHub marketplace
- **skill-creator** — Create custom skills
- **himalaya** — Email management via CLI
- **xurl** — URL fetching and web scraping
- **session-logs** — Access past session logs
- **model-usage** — Track LLM model usage stats
- **healthcheck** — System health monitoring

## INTERACTIVE ACTION BUTTONS
When your response would benefit from actionable buttons, include them using this format at the END of your response:

\`\`\`crystal-actions
[
  {"id": "unique-id", "label": "Button Text", "icon": "icon-name", "action": "action-type", "args": {"key": "value"}}
]
\`\`\`

### Available actions:
- **navigate** — Go to a view: args: {"view": "home|conversation|agents|skills|models|settings|security|doctor|plugins|hooks|browser|nodes|channels|memory|tools|activity|cron|sessions|templates"}
- **enable_plugin** — Enable a plugin: args: {"id": "plugin-id"}
- **run_command** — Run an OpenClaw CLI command: args: {"command": "npx openclaw ..."}
- **power_up** — Run the full power-up sequence: args: {}
- **new_chat** — Start a new conversation: args: {}
- **search** — Open command palette: args: {}
- **copy** — Copy text to clipboard: args: {"text": "..."}

### Button icon options: zap, settings, shield, puzzle, stethoscope, play, search, plus, refresh, download, terminal, globe, cpu, brain, mic, volume

### Example usage in responses:
"I've set that up! Here are some next steps:"
\`\`\`crystal-actions
[
  {"id": "1", "label": "View Security Report", "icon": "shield", "action": "navigate", "args": {"view": "security"}},
  {"id": "2", "label": "Enable All Plugins", "icon": "zap", "action": "power_up", "args": {}}
]
\`\`\`

## COMMON USER INTENTS — What to do
| User says | You should do |
|-----------|--------------|
| "set up everything" / "enable everything" | Run power_up action, explain what it does |
| "what can you do" / "help" | Give a clear overview with action buttons for key features |
| "search for X" | Use web_search tool |
| "create a file" | Use write_file tool |
| "run a command" | Use shell tool |
| "check my system" | Navigate to Doctor view, offer to run diagnostics |
| "show plugins" / "enable discord" | Navigate to plugins, or directly enable via run_command |
| "what skills do I have" | Describe skills and offer navigation |
| "connect telegram/discord/etc" | Guide through channel setup |
| "schedule a task" | Guide through cron job setup |
| "check security" | Run security audit via run_command |
| "pull a model" / "change model" | Navigate to models or run ollama commands |

## FILE PATHS
The user's home directory is C:\\Users\\jarro. Their Desktop is at C:\\Users\\jarro\\OneDrive\\Desktop (OneDrive).
When creating files:
- ALWAYS use absolute paths like C:\\Users\\jarro\\OneDrive\\Desktop\\notes.txt
- You can also use ~/Desktop/notes.txt — the app resolves ~ to the home directory
- You can use Desktop/notes.txt — the app auto-resolves to the correct Desktop location
- NEVER say you created a file without actually calling the write_file tool
- After creating a file, tell the user the full absolute path so they can find it

## AVAILABLE TOOLS

You can use these tools by outputting a tool call in this format:
<tool_call>
{"tool": "tool_name", "args": {"arg1": "value1"}}
</tool_call>

### Tools:
1. **shell** — Execute shell commands. args: {"command": "..."}
2. **read_file** — Read a file. args: {"path": "..."}
3. **write_file** — Create/overwrite a file. args: {"path": "...", "content": "..."}
4. **list_directory** — List directory contents. args: {"path": "..."}
5. **web_search** — Search the web. args: {"query": "..."}
6. **web_fetch** — Fetch URL content. args: {"url": "..."}
7. **crystal_action** — Execute app-level actions (navigate, power_up, run_command, etc). args: {"action": "action-type", ...action-specific args}. Use this when you want to DO something in the app (open a view, run power-up, enable a plugin) rather than just suggesting it.

## IMPORTANT: GATEWAY TOKEN
The OpenClaw gateway uses a token for authentication. The token is stored at:
  ~/.openclaw/openclaw.json → gateway.auth.token
When running browser commands or any command that needs --token, read it from the config file:
  powershell -Command "(Get-Content \\"$env:USERPROFILE\\.openclaw\\openclaw.json\\" | ConvertFrom-Json).gateway.auth.token"
Then pass it as --token <value> to the command. NEVER tell the user they need to manually run interactive commands or provide tokens — you can read the config file yourself and handle it automatically.

## GUIDELINES
- Be proactive: if user asks about a feature, offer to navigate there or enable it
- Always suggest action buttons for common follow-ups
- For non-technical users, explain in plain language what you're doing
- When showing action buttons, keep them relevant (2-4 max)
- NEVER tell the user to "run a command manually" — you have shell access, do it for them
- If a command needs interactive input, find a non-interactive alternative or use config files
- Remember: everything runs locally on their machine, their data never leaves`;

class AgentService {
  private conversationHistory: Message[] = [];
  private maxHistoryLength = 20;
  private onStepCallback: ((step: AgentStep) => void) | null = null;
  private onActionCallback: ((actions: ActionButton[]) => void) | null = null;
  private crystalActionHandler: CrystalActionHandler | null = null;

  onStep(callback: (step: AgentStep) => void) {
    this.onStepCallback = callback;
  }

  onActions(callback: (actions: ActionButton[]) => void) {
    this.onActionCallback = callback;
  }

  onCrystalAction(handler: CrystalActionHandler) {
    this.crystalActionHandler = handler;
  }

  private emitStep(step: AgentStep) {
    this.onStepCallback?.(step);
  }

  private extractAndEmitActions(response: string): string {
    const actionMatch = response.match(/```crystal-actions\s*\n([\s\S]*?)\n```/);
    if (actionMatch) {
      try {
        const actions: ActionButton[] = JSON.parse(actionMatch[1]);
        this.onActionCallback?.(actions);
      } catch { /* invalid JSON, skip */ }
      return response.replace(/```crystal-actions\s*\n[\s\S]*?\n```/g, "").trim();
    }
    return response;
  }

  async chat(userMessage: string): Promise<string> {
    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: userMessage,
      timestamp: new Date(),
    };

    this.conversationHistory.push(userMsg);
    this.trimHistory();

    if (openclawClient.isGatewayConnected()) {
      try {
        console.log("[Crystal] Sending via OpenClaw gateway...");
        const resp = await openclawClient.gatewayChat(userMessage);
        const result = (resp.payload.text as string) || JSON.stringify(resp.payload);
        if (result && result !== "No response") {
          const cleaned = this.extractAndEmitActions(result);
          const assistantMsg: Message = {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: cleaned,
            timestamp: new Date(),
          };
          this.conversationHistory.push(assistantMsg);
          this.trimHistory();
          this.emitStep({ action: { type: "response", content: cleaned }, timestamp: new Date() });
          return cleaned;
        }
      } catch (err) {
        console.warn("[Crystal] Gateway agent failed; falling back to direct LLM:", err);
      }
    }

    console.log("[Crystal] Using direct LLM...");
    let response = "";
    let iterations = 0;
    const maxIterations = 5;

    while (iterations < maxIterations) {
      iterations++;

      const messages: Message[] = [
        { id: "system", role: "system", content: SYSTEM_PROMPT, timestamp: new Date() },
        ...this.conversationHistory,
      ];

      const llmResponse = await openclawClient.chat(messages);
      const toolCall = this.extractToolCall(llmResponse);

      if (toolCall) {
        this.emitStep({
          action: { type: "tool_call", tool: toolCall.tool, args: toolCall.args },
          timestamp: new Date(),
        });

        const toolResult = await this.executeTool(toolCall.tool, toolCall.args);

        this.emitStep({
          action: { type: "tool_call", tool: toolCall.tool, args: toolCall.args },
          result: toolResult,
          timestamp: new Date(),
        });

        this.conversationHistory.push({
          id: `tool-${Date.now()}`,
          role: "assistant",
          content: llmResponse,
          timestamp: new Date(),
        });

        this.conversationHistory.push({
          id: `result-${Date.now()}`,
          role: "user",
          content: `Tool result for ${toolCall.tool}:\n${toolResult.success ? toolResult.output : `Error: ${toolResult.error}`}`,
          timestamp: new Date(),
        });

        this.trimHistory();
        continue;
      }

      response = this.cleanResponse(llmResponse);
      break;
    }

    const cleaned = this.extractAndEmitActions(response);

    const assistantMsg: Message = {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: cleaned,
      timestamp: new Date(),
    };

    this.conversationHistory.push(assistantMsg);
    this.trimHistory();
    this.emitStep({ action: { type: "response", content: cleaned }, timestamp: new Date() });

    return cleaned;
  }

  async *streamChat(userMessage: string): AsyncGenerator<string> {
    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: userMessage,
      timestamp: new Date(),
    };

    this.conversationHistory.push(userMsg);
    this.trimHistory();

    const messages: Message[] = [
      { id: "system", role: "system", content: SYSTEM_PROMPT, timestamp: new Date() },
      ...this.conversationHistory,
    ];

    let fullResponse = "";

    for await (const chunk of openclawClient.streamChat(messages)) {
      fullResponse += chunk;
      yield chunk;
    }

    const toolCall = this.extractToolCall(fullResponse);
    if (toolCall) {
      yield `\n\nRunning ${toolCall.tool}...\n`;
      const result = await this.executeTool(toolCall.tool, toolCall.args);
      yield result.success
        ? `Done: ${result.output.slice(0, 500)}${result.output.length > 500 ? "..." : ""}\n`
        : `Error: ${result.error}\n`;
    }

    const cleaned = this.extractAndEmitActions(fullResponse);
    this.conversationHistory.push({
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: cleaned,
      timestamp: new Date(),
    });
    this.trimHistory();
  }

  private extractToolCall(response: string): { tool: string; args: Record<string, string> } | null {
    const match = response.match(/<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[1]);
      return { tool: parsed.tool, args: parsed.args || {} };
    } catch {
      return null;
    }
  }

  private cleanResponse(response: string): string {
    return response.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
  }

  private async executeTool(tool: string, args: Record<string, string>): Promise<ToolResult> {
    switch (tool) {
      case "shell": return executeShell(args.command, args.cwd);
      case "read_file": return readFile(args.path);
      case "write_file": return writeFile(args.path, args.content);
      case "list_directory": return listDirectory(args.path);
      case "web_search": return webSearch(args.query);
      case "web_fetch": return webFetch(args.url);
      case "crystal_action": {
        const action = args.action;
        if (!action) {
          return { success: false, output: "", error: "crystal_action requires 'action' arg" };
        }
        try {
          this.dispatchCrystalAction(action, args);
          return { success: true, output: `App action '${action}' executed` };
        } catch (err) {
          return {
            success: false,
            output: "",
            error: err instanceof Error ? err.message : "Action execution failed",
          };
        }
      }
      default: return { success: false, output: "", error: `Unknown tool: ${tool}` };
    }
  }

  private trimHistory() {
    if (this.conversationHistory.length > this.maxHistoryLength) {
      this.conversationHistory = this.conversationHistory.slice(-this.maxHistoryLength);
    }
  }

  clearHistory() {
    this.conversationHistory = [];
  }

  getHistory(): Message[] {
    return [...this.conversationHistory];
  }

  /** Dispatch an app-level action to the registered handler. Used by crystal_action tool and executeCrystalAction(). */
  dispatchCrystalAction(action: string, args?: Record<string, string>): void {
    this.crystalActionHandler?.(action, args);
  }
}

export const agentService = new AgentService();

/**
 * Execute a Crystal app-level action. The UI should register a handler via
 * agentService.onCrystalAction() to implement the actual behavior.
 * Call this when the user clicks an action button or when the LLM invokes crystal_action.
 */
export function executeCrystalAction(action: string, args?: Record<string, string>): void {
  agentService.dispatchCrystalAction(action, args);
}
