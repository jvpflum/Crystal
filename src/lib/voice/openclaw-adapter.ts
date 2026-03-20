/**
 * OpenClawAdapter — typed wrapper around openclawClient for the voice/conversation layer.
 *
 * OpenClaw is the execution engine, not the assistant personality.
 * This adapter:
 *   - Sends commands/jobs/tasks to OpenClaw
 *   - Receives task status, logs, and events
 *   - Enforces confirmation rules before execution
 *   - Maps between StructuredAction types and OpenClaw CLI operations
 */

import { openclawClient } from "../openclaw";
import type { StructuredAction, ActionResult } from "./types";
import { requiresConfirmation } from "./actions";

export interface TaskEvent {
  taskId: string;
  type: "started" | "progress" | "completed" | "failed" | "log";
  message?: string;
  progress?: number;
  timestamp: number;
}

export class OpenClawAdapter {
  private _taskEventListeners: ((event: TaskEvent) => void)[] = [];

  /**
   * Dispatch a structured action to OpenClaw for execution.
   * Throws if the action requires confirmation but hasn't been confirmed.
   */
  async dispatch(action: StructuredAction, confirmed = false): Promise<ActionResult> {
    if (requiresConfirmation(action) && !confirmed) {
      return {
        id: `res_${Date.now()}`,
        action_id: action.id,
        success: false,
        error: "Action requires user confirmation before execution",
        timestamps: { queued: Date.now() },
      };
    }

    const startTime = Date.now();
    this._emitTaskEvent({
      taskId: action.task_id || action.id,
      type: "started",
      message: action.user_visible_message,
      timestamp: startTime,
    });

    try {
      const output = await this._executeAction(action);

      this._emitTaskEvent({
        taskId: action.task_id || action.id,
        type: "completed",
        message: output,
        timestamp: Date.now(),
      });

      return {
        id: `res_${Date.now()}`,
        action_id: action.id,
        success: true,
        output,
        timestamps: {
          queued: action.created_at,
          started: startTime,
          completed: Date.now(),
        },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      this._emitTaskEvent({
        taskId: action.task_id || action.id,
        type: "failed",
        message: errorMsg,
        timestamp: Date.now(),
      });

      return {
        id: `res_${Date.now()}`,
        action_id: action.id,
        success: false,
        error: errorMsg,
        timestamps: {
          queued: action.created_at,
          started: startTime,
          completed: Date.now(),
        },
      };
    }
  }

  private _activeSessionId: string | null = null;

  setActiveSessionId(id: string | null) {
    this._activeSessionId = id;
  }

  /** Send a chat message through OpenClaw and get a response. */
  async chat(message: string, sessionId?: string): Promise<string> {
    return openclawClient.openclawChat(message, sessionId || this._activeSessionId || undefined);
  }

  /** Dispatch to a specific agent. */
  async dispatchToAgent(agentId: string, message: string): Promise<string> {
    const result = await openclawClient.dispatchToAgent(agentId, message);
    return result.stdout || result.stderr || "";
  }

  /** Get current gateway connection status. */
  async isConnected(): Promise<boolean> {
    try {
      const status = await openclawClient.gatewayStatus();
      return (status?.payload?.healthy as boolean) ?? false;
    } catch {
      return false;
    }
  }

  /** Subscribe to task events. Returns an unsubscribe function. */
  onTaskEvent(cb: (event: TaskEvent) => void): () => void {
    this._taskEventListeners.push(cb);
    return () => {
      this._taskEventListeners = this._taskEventListeners.filter((l) => l !== cb);
    };
  }

  // ── Private ──────────────────────────────────────────────────

  private async _executeAction(action: StructuredAction): Promise<string> {
    const op = action.payload?.operation as string | undefined;
    const transcript = (action.payload?.raw_transcript as string) || action.user_visible_message;

    switch (action.type) {
      case "openclaw_command":
      case "openclaw_task":
        return this._executeOpenClawOp(op, transcript, action.payload);

      case "cancel_task":
        return `Task ${action.task_id} cancellation requested.`;

      case "chat_reply":
        return openclawClient.openclawChat(transcript, this._activeSessionId || undefined);

      default:
        return openclawClient.openclawChat(transcript, this._activeSessionId || undefined);
    }
  }

  private async _executeOpenClawOp(
    operation: string | undefined,
    transcript: string,
    payload?: Record<string, unknown>
  ): Promise<string> {
    switch (operation) {
      case "memory_write": {
        const content = (payload?.content as string) || transcript;
        await openclawClient.addMemory(content);
        return "Saved to memory.";
      }

      case "read":
      case "search":
      case "general":
      default:
        return openclawClient.openclawChat(transcript, this._activeSessionId || undefined);
    }
  }

  private _emitTaskEvent(event: TaskEvent): void {
    for (const cb of this._taskEventListeners) {
      try {
        cb(event);
      } catch (err) {
        console.error("[OpenClawAdapter] Task event listener error:", err);
      }
    }
  }
}
