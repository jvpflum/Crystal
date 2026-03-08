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

const SYSTEM_PROMPT = `You are Crystal, a local AI assistant on a Windows PC with NVIDIA 5090 GPU. Powered by OpenClaw. Everything runs 100% locally.

Be friendly, proactive, and action-oriented. Do things for users rather than explaining how.

## TOOLS
Output tool calls in this format:
<tool_call>
{"tool": "tool_name", "args": {"arg1": "value1"}}
</tool_call>

Available tools:
- **shell** (command) — Run any command. Use this for OpenClaw CLI commands.
- **read_file** (path) — Read file contents
- **write_file** (path, content) — Create/write files
- **list_directory** (path) — List directory
- **web_search** (query) — Search the web
- **web_fetch** (url) — Fetch a URL
- **openclaw** (subcommand) — Run OpenClaw CLI commands directly (shorthand for npx openclaw ...)
- **crystal_action** (action + args) — App navigation/actions

## OPENCLAW COMMANDS (use the openclaw tool)
Browser control:
- openclaw browser start — Launch controlled browser
- openclaw browser navigate "https://example.com" — Go to URL
- openclaw browser screenshot — Take screenshot
- openclaw browser tabs — List open tabs
- openclaw browser stop — Close browser

Memory:
- openclaw memory add "important fact" — Save to memory
- openclaw memory search "query" — Search memory
- openclaw memory show — View all memory

Skills:
- openclaw skills list — Show all available skills
- openclaw skills enable <name> — Enable a skill
- openclaw skills run <name> "prompt" — Run a skill with a prompt

Agent:
- openclaw agent --agent main --message "do something" — Ask the agent to do something autonomously

System:
- openclaw doctor --deep --yes — Run diagnostics and fix issues
- openclaw security audit --fix — Security audit with auto-fix
- openclaw system heartbeat — Trigger autonomous heartbeat check

## FILE PATHS
Home: C:\\Users\\jarro. Desktop: C:\\Users\\jarro\\OneDrive\\Desktop.

## KEY RULES
- DO things, don't explain. Use tools to accomplish tasks.
- For browser tasks, use the openclaw tool with browser subcommands.
- Keep responses concise and actionable.`;

class AgentService {
  private conversationHistory: Message[] = [];
  private maxHistoryLength = 12;
  private onStepCallback: ((step: AgentStep) => void) | null = null;
  private onActionCallback: ((actions: ActionButton[]) => void) | null = null;
  private crystalActionHandler: CrystalActionHandler | null = null;
  private memoryWriteDebounce: ReturnType<typeof setTimeout> | null = null;

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
    this.saveToMemory(userMessage, cleaned);

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

    let fullResponse = "";
    let iterations = 0;
    const maxIterations = 3;

    while (iterations < maxIterations) {
      iterations++;

      const messages: Message[] = [
        { id: "system", role: "system", content: SYSTEM_PROMPT, timestamp: new Date() },
        ...this.conversationHistory,
      ];

      let iterResponse = "";
      for await (const chunk of openclawClient.streamChat(messages)) {
        iterResponse += chunk;
        yield chunk;
      }

      const toolCall = this.extractToolCall(iterResponse);
      if (toolCall) {
        this.emitStep({ action: { type: "tool_call", tool: toolCall.tool, args: toolCall.args }, timestamp: new Date() });
        yield `\n\n_Running ${toolCall.tool}..._\n`;
        const result = await this.executeTool(toolCall.tool, toolCall.args);
        const resultText = result.success
          ? result.output.slice(0, 500)
          : `Error: ${result.error}`;
        this.emitStep({ action: { type: "tool_call", tool: toolCall.tool, args: toolCall.args }, result, timestamp: new Date() });

        this.conversationHistory.push(
          { id: `tool-${Date.now()}`, role: "assistant", content: iterResponse, timestamp: new Date() },
          { id: `result-${Date.now()}`, role: "user", content: `Tool result for ${toolCall.tool}:\n${resultText}`, timestamp: new Date() },
        );
        this.trimHistory();
        continue;
      }

      fullResponse = this.cleanResponse(iterResponse);
      break;
    }

    const cleaned = this.extractAndEmitActions(fullResponse);
    this.conversationHistory.push({
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: cleaned,
      timestamp: new Date(),
    });
    this.trimHistory();
    this.saveToMemory(userMessage, cleaned);
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
      case "openclaw": {
        const sub = args.subcommand || args.command || Object.values(args).join(" ");
        if (!sub) return { success: false, output: "", error: "openclaw tool requires a subcommand" };
        return executeShell(`npx openclaw ${sub}`);
      }
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

  private saveToMemory(userMsg: string, assistantMsg: string) {
    if (this.memoryWriteDebounce) clearTimeout(this.memoryWriteDebounce);
    this.memoryWriteDebounce = setTimeout(async () => {
      try {
        const time = new Date().toLocaleTimeString();
        const entry = `## Chat @ ${time}\n**User:** ${userMsg.slice(0, 500)}\n**Crystal:** ${assistantMsg.slice(0, 500)}`;
        await openclawClient.addMemory(entry);
      } catch (e) {
        console.warn("[Crystal] Failed to save to memory:", e);
      }
    }, 2000);
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
