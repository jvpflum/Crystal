import type { RiskLevel, StructuredAction, ActionSource } from "./types";

let _actionCounter = 0;
function nextId(): string {
  return `act_${Date.now()}_${++_actionCounter}`;
}

const RISKY_OPERATIONS = new Set([
  "file_write",
  "file_delete",
  "shell_execute",
  "git_commit",
  "git_push",
  "destructive_automation",
  "external_side_effect",
]);

/**
 * Determine if a structured action requires explicit user confirmation
 * before execution.
 */
export function requiresConfirmation(action: StructuredAction): boolean {
  if (action.risk_level === "high" || action.risk_level === "critical") {
    return true;
  }
  const op = action.payload?.operation;
  if (typeof op === "string" && RISKY_OPERATIONS.has(op)) {
    return true;
  }
  return false;
}

/** Classify the risk level of an operation string. */
export function classifyRisk(operation: string): RiskLevel {
  const op = operation.toLowerCase();

  if (op.includes("delete") || op.includes("rm ") || op.includes("format")) return "critical";
  if (op.includes("push") || op.includes("deploy") || op.includes("publish")) return "high";
  if (op.includes("write") || op.includes("commit") || op.includes("execute")) return "medium";
  if (op.includes("read") || op.includes("list") || op.includes("search")) return "none";
  return "low";
}

/** Create a chat_reply action — direct spoken/text response to the user. */
export function createChatReply(
  message: string,
  source: ActionSource = "conversation_agent"
): StructuredAction {
  return {
    id: nextId(),
    type: "chat_reply",
    confidence: 1.0,
    risk_level: "none",
    user_visible_message: message,
    source,
    created_at: Date.now(),
  };
}

/** Create an openclaw_task action — a long-running task dispatched to OpenClaw. */
export function createOpenClawTask(
  message: string,
  payload: Record<string, unknown>,
  confidence: number = 0.8
): StructuredAction {
  const operation = (payload.operation as string) || "unknown";
  return {
    id: nextId(),
    type: "openclaw_task",
    confidence,
    risk_level: classifyRisk(operation),
    user_visible_message: message,
    task_id: `task_${Date.now()}`,
    source: "intent_router",
    created_at: Date.now(),
    payload,
  };
}

/** Create an openclaw_command action — an immediate command to OpenClaw. */
export function createOpenClawCommand(
  message: string,
  payload: Record<string, unknown>,
  confidence: number = 0.9
): StructuredAction {
  const operation = (payload.operation as string) || "unknown";
  return {
    id: nextId(),
    type: "openclaw_command",
    confidence,
    risk_level: classifyRisk(operation),
    user_visible_message: message,
    source: "intent_router",
    created_at: Date.now(),
    payload,
  };
}

/** Wrap an existing action in a confirmation gate. */
export function createConfirmationAction(
  original: StructuredAction,
  description: string
): StructuredAction {
  return {
    id: nextId(),
    type: "confirm_required",
    confidence: original.confidence,
    risk_level: original.risk_level,
    user_visible_message: description,
    task_id: original.task_id,
    source: original.source,
    created_at: Date.now(),
    payload: { original_action: original },
  };
}

/** Create a cancel_task action. */
export function createCancelTask(
  taskId: string,
  reason: string = "Cancelled by user"
): StructuredAction {
  return {
    id: nextId(),
    type: "cancel_task",
    confidence: 1.0,
    risk_level: "none",
    user_visible_message: reason,
    task_id: taskId,
    source: "conversation_agent",
    created_at: Date.now(),
  };
}

/**
 * All action types that should go through OpenClaw for execution
 * (as opposed to being answered directly by the conversation agent).
 */
export function isOpenClawAction(action: StructuredAction): boolean {
  return action.type === "openclaw_task" || action.type === "openclaw_command";
}
