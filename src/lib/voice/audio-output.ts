/**
 * AudioOutputManager — low-latency audio playback with queue and barge-in support.
 *
 * Uses Web Audio API (AudioContext + AudioBufferSourceNode) for playback instead
 * of HTMLAudioElement, eliminating blob URL overhead and reducing startup latency.
 *
 * Supports:
 *   - Queuing multiple utterances
 *   - Barge-in: stop current playback when user interrupts
 *   - Streaming playback via appendStreamChunk() for partial TTS
 *   - Volume control via GainNode
 */

export type AudioOutputState = "idle" | "playing" | "error";

export class AudioOutputManager {
  private _state: AudioOutputState = "idle";
  private _queue: Blob[] = [];
  private _audioCtx: AudioContext | null = null;
  private _gainNode: GainNode | null = null;
  private _currentSource: AudioBufferSourceNode | null = null;
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
    if (this._gainNode) {
      this._gainNode.gain.setValueAtTime(this._volume, this._getCtx().currentTime);
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

  private _getCtx(): AudioContext {
    if (!this._audioCtx) {
      this._audioCtx = new AudioContext();
      this._gainNode = this._audioCtx.createGain();
      this._gainNode.gain.setValueAtTime(this._volume, this._audioCtx.currentTime);
      this._gainNode.connect(this._audioCtx.destination);
    }
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    return this._audioCtx;
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

  private async _playBlob(blob: Blob): Promise<void> {
    try {
      const ctx = this._getCtx();
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this._gainNode!);
      this._currentSource = source;
      this._setState("playing");

      return new Promise<void>((resolve) => {
        source.onended = () => {
          if (this._currentSource === source) {
            this._currentSource = null;
          }
          this._playNext();
          resolve();
        };

        source.start(0);
      });
    } catch (err) {
      console.warn("[AudioOutputManager] Playback error:", err);
      this._currentSource = null;
      this._setState("error");
      setTimeout(() => this._playNext(), 50);
    }
  }

  private _stopCurrent(): void {
    if (this._currentSource) {
      try {
        this._currentSource.stop();
      } catch { /* ignore if already stopped */ }
      this._currentSource = null;
    }
  }

  dispose(): void {
    this.bargeIn();
    if (this._audioCtx) {
      this._audioCtx.close().catch(() => {});
      this._audioCtx = null;
      this._gainNode = null;
    }
  }
}
