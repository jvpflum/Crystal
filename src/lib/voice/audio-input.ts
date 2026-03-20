/**
 * AudioInputManager — handles microphone capture and real-time PCM extraction.
 *
 * Uses getUserMedia + AudioWorklet for low-latency PCM output suitable for
 * streaming STT. Falls back to ScriptProcessorNode when AudioWorklet is not
 * available (Tauri webview edge cases).
 */

const CHUNK_INTERVAL_MS = 100;
const DEFAULT_SAMPLE_RATE = 16000;

export type AudioInputState = "inactive" | "capturing" | "error";

export class AudioInputManager {
  private _state: AudioInputState = "inactive";
  private _stream: MediaStream | null = null;
  private _audioContext: AudioContext | null = null;
  private _sourceNode: MediaStreamAudioSourceNode | null = null;
  private _processorNode: ScriptProcessorNode | null = null;
  private _onChunk: ((pcm: Int16Array) => void) | null = null;
  private _onVolumeLevel: ((level: number) => void) | null = null;
  private _onStateChange: ((state: AudioInputState) => void) | null = null;
  private _sampleRate: number;

  constructor(sampleRate: number = DEFAULT_SAMPLE_RATE) {
    this._sampleRate = sampleRate;
  }

  get state(): AudioInputState {
    return this._state;
  }

  onAudioChunk(cb: (pcm: Int16Array) => void): void {
    this._onChunk = cb;
  }

  onVolumeLevel(cb: (level: number) => void): void {
    this._onVolumeLevel = cb;
  }

  onStateChange(cb: (state: AudioInputState) => void): void {
    this._onStateChange = cb;
  }

  async start(): Promise<void> {
    if (this._state === "capturing") return;

    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: this._sampleRate,
          channelCount: 1,
        },
      });

      this._audioContext = new AudioContext({ sampleRate: this._sampleRate });
      this._sourceNode = this._audioContext.createMediaStreamSource(this._stream);

      // ScriptProcessorNode (widely supported, including Tauri webviews)
      const bufferSize = Math.round((this._sampleRate * CHUNK_INTERVAL_MS) / 1000);
      const alignedBufferSize = nextPow2(bufferSize);
      this._processorNode = this._audioContext.createScriptProcessor(alignedBufferSize, 1, 1);

      this._processorNode.onaudioprocess = (event) => {
        const float32 = event.inputBuffer.getChannelData(0);

        // Volume level for UI visualization (RMS)
        let sum = 0;
        for (let i = 0; i < float32.length; i++) {
          sum += float32[i] * float32[i];
        }
        const rms = Math.sqrt(sum / float32.length);
        this._onVolumeLevel?.(Math.min(1, rms * 10));

        // Convert Float32 [-1,1] → Int16 for STT providers
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        this._onChunk?.(int16);
      };

      this._sourceNode.connect(this._processorNode);
      this._processorNode.connect(this._audioContext.destination);

      this._setState("capturing");
    } catch (err) {
      console.error("[AudioInputManager] Failed to start capture:", err);
      this._setState("error");
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (this._processorNode) {
      this._processorNode.disconnect();
      this._processorNode = null;
    }
    if (this._sourceNode) {
      this._sourceNode.disconnect();
      this._sourceNode = null;
    }
    if (this._audioContext) {
      await this._audioContext.close().catch(() => {});
      this._audioContext = null;
    }
    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
    }

    this._setState("inactive");
  }

  private _setState(state: AudioInputState): void {
    this._state = state;
    this._onStateChange?.(state);
  }
}

function nextPow2(n: number): number {
  let p = 256;
  while (p < n) p *= 2;
  return Math.min(p, 16384);
}
