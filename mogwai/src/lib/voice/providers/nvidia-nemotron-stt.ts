/**
 * NvidiaNemotronSpeechProvider
 *
 * Concrete STT provider targeting local GPU inference with:
 *   nvidia/nemotron-speech-streaming-en-0.6b (Parakeet-family streaming ASR)
 *
 * This provider connects to a local Python WebSocket worker (nvidia_stt_worker.py)
 * running on port 8090. The worker loads the NeMo ASR model on the local NVIDIA GPU
 * and performs streaming transcription.
 *
 * Protocol:
 *   1. Client opens WS to ws://127.0.0.1:8090
 *   2. Client sends JSON: { type: "start", config: { sample_rate, encoding, ... } }
 *   3. Client pushes binary PCM audio chunks
 *   4. Server sends JSON partials: { type: "partial", text: "..." }
 *   5. Client sends JSON: { type: "end" }
 *   6. Server sends JSON final: { type: "final", text: "...", confidence: 0.95 }
 *
 * All Nemotron/Parakeet-specific protocol details are isolated in this file.
 * The actual model loading and inference happen in the Python worker.
 */

import type { SpeechToTextProvider, SttStreamHandle } from "./stt-provider";
import type { SttConfig, SttPartialResult } from "../types";
import { DEFAULT_STT_CONFIG } from "../types";
import { SttBridge } from "../bridge/speech-bridge";

const NEMOTRON_STT_PORT = 8090;
const NEMOTRON_WS_URL = `ws://127.0.0.1:${NEMOTRON_STT_PORT}`;
const NEMOTRON_HTTP_URL = `http://127.0.0.1:${NEMOTRON_STT_PORT}`;

class NemotronStreamHandle implements SttStreamHandle {
  private _bridge: SttBridge;
  private _finalResolve: ((text: string) => void) | null = null;
  private _finalText = "";

  constructor(bridge: SttBridge) {
    this._bridge = bridge;
  }

  pushAudioChunk(pcm: Float32Array | Int16Array): void {
    this._bridge.pushAudioChunk(pcm);
  }

  async endStream(): Promise<string> {
    return new Promise<string>((resolve) => {
      this._finalResolve = resolve;
      this._bridge.onFinalTranscript((text) => {
        this._finalText = text;
        this._finalResolve?.(text);
        this._finalResolve = null;
      });
      this._bridge.endStream();

      // Safety timeout: if the worker doesn't respond in 10s, resolve with whatever we have
      setTimeout(() => {
        if (this._finalResolve) {
          this._finalResolve(this._finalText);
          this._finalResolve = null;
        }
      }, 10000);
    });
  }

  cancelStream(): void {
    this._bridge.cancelStream();
    if (this._finalResolve) {
      this._finalResolve("");
      this._finalResolve = null;
    }
  }

  onPartialTranscript(cb: (result: SttPartialResult) => void): void {
    this._bridge.onPartialTranscript((text, confidence) => {
      cb({
        text,
        is_final: false,
        confidence,
        timestamp: Date.now(),
      });
    });
  }

  onFinalTranscript(cb: (text: string, confidence?: number) => void): void {
    this._bridge.onFinalTranscript((text, confidence) => {
      this._finalText = text;
      cb(text, confidence);
    });
  }

  onError(cb: (error: Error) => void): void {
    this._bridge.onError((msg) => cb(new Error(msg)));
  }
}

export class NvidiaNemotronSpeechProvider implements SpeechToTextProvider {
  readonly id = "nvidia-nemotron";
  readonly name = "NVIDIA Nemotron/Parakeet Streaming ASR";

  private _available = false;

  async initialize(): Promise<void> {
    this._available = await this.isAvailable();
    if (this._available) {
      console.log("[NvidiaNemotronSTT] Worker available on port", NEMOTRON_STT_PORT);
    } else {
      console.warn("[NvidiaNemotronSTT] Worker not available on port", NEMOTRON_STT_PORT);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const resp = await fetch(`${NEMOTRON_HTTP_URL}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!resp.ok) return false;
      const data = await resp.json();
      return data.status === "ok";
    } catch {
      return false;
    }
  }

  startStream(config?: Partial<SttConfig>): SttStreamHandle {
    const bridge = new SttBridge({ sttWsUrl: NEMOTRON_WS_URL });
    const handle = new NemotronStreamHandle(bridge);

    const mergedConfig: SttConfig = { ...DEFAULT_STT_CONFIG, ...config };
    bridge.startStream(mergedConfig);

    return handle;
  }

  /**
   * Batch transcription fallback. Sends the entire audio blob to the worker's
   * HTTP endpoint. This is not the primary path — streaming via startStream()
   * is preferred for low latency.
   */
  async transcribe(audio: Blob): Promise<string> {
    const formData = new FormData();
    formData.append("file", audio, "audio.wav");

    const resp = await fetch(`${NEMOTRON_HTTP_URL}/transcribe`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      throw new Error(`Nemotron batch transcription failed: ${resp.statusText}`);
    }

    const data = await resp.json();
    return data.text || "";
  }

  dispose(): void {
    this._available = false;
  }
}
