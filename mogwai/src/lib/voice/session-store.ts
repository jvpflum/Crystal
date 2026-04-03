import type {
  TranscriptEntry,
  ActiveTask,
  PendingConfirmation,
  StructuredAction,
  ActionResult,
  TaskStatus,
  VoiceSystemEvent,
  VoiceSystemEventHandler,
} from "./types";

const MAX_TRANSCRIPT_ENTRIES = 500;
const MAX_EVENT_LOG = 200;

export class SessionStateStore {
  private _transcript: TranscriptEntry[] = [];
  private _activeTasks: Map<string, ActiveTask> = new Map();
  private _pendingConfirmations: Map<string, PendingConfirmation> = new Map();
  private _lastAssistantUtterance: string = "";
  private _eventLog: VoiceSystemEvent[] = [];
  private _listeners: VoiceSystemEventHandler[] = [];

  // ── Transcript ───────────────────────────────────────────────

  get transcript(): readonly TranscriptEntry[] {
    return this._transcript;
  }

  get lastAssistantUtterance(): string {
    return this._lastAssistantUtterance;
  }

  addTranscriptEntry(entry: TranscriptEntry): void {
    if (entry.is_partial) {
      const lastIdx = this._transcript.length - 1;
      if (lastIdx >= 0 && this._transcript[lastIdx].is_partial && this._transcript[lastIdx].role === entry.role) {
        this._transcript[lastIdx] = entry;
        this._emit({ kind: "transcript", entry });
        return;
      }
    }

    this._transcript.push(entry);

    if (this._transcript.length > MAX_TRANSCRIPT_ENTRIES) {
      this._transcript = this._transcript.slice(-MAX_TRANSCRIPT_ENTRIES);
    }

    if (entry.role === "assistant" && !entry.is_partial) {
      this._lastAssistantUtterance = entry.text;
    }

    this._emit({ kind: "transcript", entry });
  }

  createTranscriptEntry(
    role: TranscriptEntry["role"],
    text: string,
    options?: { is_partial?: boolean; action?: StructuredAction }
  ): TranscriptEntry {
    return {
      id: `tr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role,
      text,
      timestamp: Date.now(),
      is_partial: options?.is_partial ?? false,
      action: options?.action,
    };
  }

  // ── Active Tasks ─────────────────────────────────────────────

  get activeTasks(): readonly ActiveTask[] {
    return Array.from(this._activeTasks.values());
  }

  addTask(action: StructuredAction): ActiveTask {
    const task: ActiveTask = {
      id: action.task_id || action.id,
      action,
      status: "queued",
      started_at: Date.now(),
    };
    this._activeTasks.set(task.id, task);
    this._emit({ kind: "task_update", task });
    return task;
  }

  updateTask(taskId: string, update: Partial<Pick<ActiveTask, "status" | "progress" | "output" | "error">>): void {
    const task = this._activeTasks.get(taskId);
    if (!task) return;

    Object.assign(task, update);
    if (update.status === "completed" || update.status === "failed" || update.status === "cancelled") {
      task.completed_at = Date.now();
    }

    this._emit({ kind: "task_update", task: { ...task } });
  }

  updateTaskFromResult(result: ActionResult): void {
    const taskId = result.action_id;
    const status: TaskStatus = result.success ? "completed" : "failed";
    this.updateTask(taskId, {
      status,
      output: result.output,
      error: result.error,
    });
  }

  removeCompletedTasks(): void {
    for (const [id, task] of this._activeTasks) {
      if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
        this._activeTasks.delete(id);
      }
    }
  }

  // ── Pending Confirmations ────────────────────────────────────

  get pendingConfirmations(): readonly PendingConfirmation[] {
    return Array.from(this._pendingConfirmations.values());
  }

  addConfirmation(confirmation: PendingConfirmation): void {
    this._pendingConfirmations.set(confirmation.id, confirmation);
    this._emit({ kind: "confirmation_request", confirmation });
  }

  resolveConfirmation(confirmationId: string): StructuredAction | null {
    const c = this._pendingConfirmations.get(confirmationId);
    if (!c) return null;
    this._pendingConfirmations.delete(confirmationId);
    return c.action;
  }

  dismissConfirmation(confirmationId: string): void {
    this._pendingConfirmations.delete(confirmationId);
  }

  // ── Event Log ────────────────────────────────────────────────

  get eventLog(): readonly VoiceSystemEvent[] {
    return this._eventLog;
  }

  logEvent(event: VoiceSystemEvent): void {
    this._eventLog.push(event);
    if (this._eventLog.length > MAX_EVENT_LOG) {
      this._eventLog = this._eventLog.slice(-MAX_EVENT_LOG);
    }
  }

  // ── Subscriptions ────────────────────────────────────────────

  on(handler: VoiceSystemEventHandler): () => void {
    this._listeners.push(handler);
    return () => {
      this._listeners = this._listeners.filter((h) => h !== handler);
    };
  }

  private _emit(event: VoiceSystemEvent): void {
    this.logEvent(event);
    for (const listener of this._listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[SessionStateStore] Listener error:", err);
      }
    }
  }

  // ── Reset ────────────────────────────────────────────────────

  clear(): void {
    this._transcript = [];
    this._activeTasks.clear();
    this._pendingConfirmations.clear();
    this._lastAssistantUtterance = "";
    this._eventLog = [];
  }
}
