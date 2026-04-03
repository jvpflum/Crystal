/**
 * AudioOutputManager — handles audio playback with queue and barge-in support.
 *
 * Plays WAV/PCM blobs from TTS providers. Supports:
 *   - Queuing multiple utterances
 *   - Barge-in: stop current playback when user interrupts
 *   - Volume control
 */

export type AudioOutputState = "idle" | "playing" | "error";

export class AudioOutputManager {
  private _state: AudioOutputState = "idle";
  private _queue: Blob[] = [];
  private _currentAudio: HTMLAudioElement | null = null;
  private _currentUrl: string | null = null;
  private _stateChangeCb: ((state: AudioOutputState) => void) | null = null;
  private _playbackCompleteCb: (() => void) | null = null;
  private _volume = 1.0;

  get state(): AudioOutputState {
    return this._state;
  }

  get isPlaying(): boolean {
    return this._state === "playing";
  }

  onStateChange(cb: (state: AudioOutputState) => void): void {
    this._stateChangeCb = cb;
  }

  onPlaybackComplete(cb: () => void): void {
    this._playbackCompleteCb = cb;
  }

  private _setState(state: AudioOutputState): void {
    this._state = state;
    this._stateChangeCb?.(state);
  }

  setVolume(volume: number): void {
    this._volume = Math.max(0, Math.min(1, volume));
    if (this._currentAudio) {
      this._currentAudio.volume = this._volume;
    }
  }

  /** Enqueue an audio blob for playback. Starts immediately if nothing is playing. */
  async play(audioBlob: Blob): Promise<void> {
    if (audioBlob.size === 0) return;

    this._queue.push(audioBlob);
    if (this._state !== "playing") {
      await this._playNext();
    }
  }

  /** Play immediately, skipping the queue. */
  async playImmediate(audioBlob: Blob): Promise<void> {
    if (audioBlob.size === 0) return;
    this._stopCurrent();
    this._queue = [];
    await this._playBlob(audioBlob);
  }

  /** Stop current playback and clear the queue (barge-in). */
  bargeIn(): void {
    this._stopCurrent();
    this._queue = [];
    this._setState("idle");
    this._playbackCompleteCb?.();
  }

  /** Stop current playback but continue with the queue. */
  skip(): void {
    this._stopCurrent();
    this._playNext();
  }

  private async _playNext(): Promise<void> {
    const next = this._queue.shift();
    if (!next) {
      this._setState("idle");
      this._playbackCompleteCb?.();
      return;
    }
    await this._playBlob(next);
  }

  private _playBlob(blob: Blob): Promise<void> {
    return new Promise((resolve) => {
      this._cleanupUrl();

      const url = URL.createObjectURL(blob);
      this._currentUrl = url;

      const audio = new Audio(url);
      audio.volume = this._volume;
      this._currentAudio = audio;
      this._setState("playing");

      audio.onended = () => {
        this._cleanupUrl();
        this._currentAudio = null;
        this._playNext();
        resolve();
      };

      audio.onerror = () => {
        console.warn("[AudioOutputManager] Playback error");
        this._cleanupUrl();
        this._currentAudio = null;
        this._setState("error");
        setTimeout(() => this._playNext(), 100);
        resolve();
      };

      audio.play().catch((err) => {
        console.warn("[AudioOutputManager] Failed to start playback:", err);
        this._cleanupUrl();
        this._currentAudio = null;
        this._playNext();
        resolve();
      });
    });
  }

  private _stopCurrent(): void {
    if (this._currentAudio) {
      try {
        this._currentAudio.pause();
        this._currentAudio.currentTime = 0;
      } catch { /* ignore */ }
      this._currentAudio = null;
    }
    this._cleanupUrl();
  }

  private _cleanupUrl(): void {
    if (this._currentUrl) {
      URL.revokeObjectURL(this._currentUrl);
      this._currentUrl = null;
    }
  }

  dispose(): void {
    this.bargeIn();
  }
}
