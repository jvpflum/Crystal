import { openclawClient } from "./openclaw";

export interface AgentAction {
  type: "tool_call" | "response" | "thinking";
  tool?: string;
  args?: Record<string, string>;
  content?: string;
}

export interface AgentStep {
  action: AgentAction;
  result?: { success: boolean; output: string; error?: string };
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

class AgentService {
  private onStepCallback: ((step: AgentStep) => void) | null = null;
  private onActionCallback: ((actions: ActionButton[]) => void) | null = null;
  private crystalActionHandler: CrystalActionHandler | null = null;

  onStep(callback: (step: AgentStep) => void) { this.onStepCallback = callback; }
  onActions(callback: (actions: ActionButton[]) => void) { this.onActionCallback = callback; }
  onCrystalAction(handler: CrystalActionHandler) { this.crystalActionHandler = handler; }

  private emitStep(step: AgentStep) { this.onStepCallback?.(step); }

  private extractAndEmitActions(response: string): string {
    const actionMatch = response.match(/```crystal-actions\s*\n([\s\S]*?)\n```/);
    if (actionMatch) {
      try {
        const actions: ActionButton[] = JSON.parse(actionMatch[1]);
        this.onActionCallback?.(actions);
      } catch { /* invalid JSON */ }
      return response.replace(/```crystal-actions\s*\n[\s\S]*?\n```/g, "").trim();
    }
    return response;
  }

  /**
   * Send a message through OpenClaw and yield the response character-by-character
   * for a typewriter effect. All orchestration (tools, memory, skills) is handled
   * by the OpenClaw gateway.
   */
  async *streamChat(userMessage: string): AsyncGenerator<string> {
    this.emitStep({ action: { type: "thinking" }, timestamp: new Date() });

    const response = await openclawClient.openclawChat(userMessage);
    const cleaned = this.extractAndEmitActions(response);

    this.emitStep({ action: { type: "response", content: cleaned }, timestamp: new Date() });

    const CHARS_PER_TICK = 3;
    const TICK_MS = 8;
    for (let i = 0; i < cleaned.length; i += CHARS_PER_TICK) {
      yield cleaned.slice(i, i + CHARS_PER_TICK);
      if (i + CHARS_PER_TICK < cleaned.length) {
        await new Promise(r => setTimeout(r, TICK_MS));
      }
    }
  }

  async chat(userMessage: string): Promise<string> {
    const response = await openclawClient.openclawChat(userMessage);
    return this.extractAndEmitActions(response);
  }

  clearHistory() {
    /* OpenClaw manages its own conversation context */
  }

  getHistory() {
    return [];
  }

  dispatchCrystalAction(action: string, args?: Record<string, string>): void {
    this.crystalActionHandler?.(action, args);
  }
}

export const agentService = new AgentService();

export function executeCrystalAction(action: string, args?: Record<string, string>): void {
  agentService.dispatchCrystalAction(action, args);
}
