import type { VoiceState, VoiceEvent, VoiceSystemEvent, VoiceSystemEventHandler } from "./types";

/**
 * Valid state transitions for the voice FSM.
 * Key = current state, value = map of event → next state.
 */
const TRANSITIONS: Record<VoiceState, Partial<Record<VoiceEvent, VoiceState>>> = {
  idle: {
    START_LISTENING: "listening",
  },
  listening: {
    AUDIO_COMPLETE: "transcribing",
    CANCEL: "idle",
  },
  processing: {
    TRANSCRIPT_READY: "thinking",
    CANCEL: "idle",
  },
  transcribing: {
    TRANSCRIPT_READY: "thinking",
    TRANSCRIPTION_FAILED: "error",
    CANCEL: "idle",
  },
  thinking: {
    REPLY_READY: "speaking",
    CONFIRM_REQUIRED: "awaiting_confirmation",
    TASK_DISPATCHED: "executing",
    INTENT_FAILED: "error",
    CANCEL: "idle",
  },
  awaiting_confirmation: {
    USER_CONFIRMED: "executing",
    USER_CANCELLED: "idle",
    CANCEL: "idle",
  },
  executing: {
    EXECUTION_COMPLETE: "speaking",
    EXECUTION_FAILED: "error",
    CANCEL: "idle",
  },
  speaking: {
    SPEECH_COMPLETE: "idle",
    BARGE_IN: "listening",
    CANCEL: "idle",
  },
  error: {
    RESET: "idle",
  },
};

export class VoiceStateMachine {
  private _state: VoiceState = "idle";
  private _listeners: VoiceSystemEventHandler[] = [];
  private _errorMessage: string | null = null;

  get state(): VoiceState {
    return this._state;
  }

  get errorMessage(): string | null {
    return this._errorMessage;
  }

  /**
   * Attempt a state transition. Returns true if the transition was valid.
   * Invalid transitions are logged but do not throw — the machine stays in its current state.
   */
  send(event: VoiceEvent, meta?: { errorMessage?: string }): boolean {
    const allowed = TRANSITIONS[this._state];
    const next = allowed?.[event];

    if (!next) {
      console.warn(
        `[VoiceStateMachine] Invalid transition: ${this._state} + ${event} (no target state)`
      );
      return false;
    }

    const from = this._state;
    this._state = next;

    if (next === "error" && meta?.errorMessage) {
      this._errorMessage = meta.errorMessage;
    } else if (next !== "error") {
      this._errorMessage = null;
    }

    this._emit({
      kind: "state_change",
      from,
      to: next,
      event,
    });

    return true;
  }

  /** Force-reset to idle (e.g. after unrecoverable error or app-level override). */
  reset(): void {
    const from = this._state;
    this._state = "idle";
    this._errorMessage = null;
    this._emit({ kind: "state_change", from, to: "idle", event: "RESET" });
  }

  /** Check whether a given event is valid from the current state. */
  canSend(event: VoiceEvent): boolean {
    return !!TRANSITIONS[this._state]?.[event];
  }

  /** Subscribe to all state-machine events. Returns an unsubscribe function. */
  on(handler: VoiceSystemEventHandler): () => void {
    this._listeners.push(handler);
    return () => {
      this._listeners = this._listeners.filter((h) => h !== handler);
    };
  }

  private _emit(event: VoiceSystemEvent): void {
    for (const listener of this._listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[VoiceStateMachine] Listener error:", err);
      }
    }
  }
}
