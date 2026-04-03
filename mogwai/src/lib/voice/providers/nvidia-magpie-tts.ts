/**
 * NvidiaMagpieTtsProvider
 *
 * Concrete TTS provider targeting local GPU inference with:
 *   nvidia/magpie_tts_multilingual_357m
 *
 * This provider connects to a local Python HTTP worker (nvidia_tts_worker.py)
 * running on port 8091. The worker loads the NeMo TTS model on the local NVIDIA GPU
 * and performs text-to-speech synthesis.
 *
 * Endpoints:
 *   POST /synthesize       — full synthesis, returns WAV blob
 *   POST /synthesize/stream — chunked streaming synthesis
 *   GET  /voices           — list available voices
 *   GET  /health           — health check
 *
 * All Magpie-specific protocol details are isolated in this file.
 * The actual model loading and inference happen in the Python worker.
 */

import type { TextToSpeechProvider } from "./tts-provider";
import type { TtsOptions, VoiceInfo } from "../types";
import { TtsBridge } from "../bridge/speech-bridge";

const MAGPIE_TTS_PORT = 8091;
const MAGPIE_HTTP_URL = `http://127.0.0.1:${MAGPIE_TTS_PORT}`;

export class NvidiaMagpieTtsProvider implements TextToSpeechProvider {
  readonly id = "nvidia-magpie";
  readonly name = "NVIDIA Magpie TTS (Local GPU)";

  private _bridge: TtsBridge;
  private _available = false;
  private _voices: VoiceInfo[] = [];

  constructor() {
    this._bridge = new TtsBridge({ ttsHttpUrl: MAGPIE_HTTP_URL });
  }

  async initialize(): Promise<void> {
    this._available = await this.isAvailable();
    if (this._available) {
      console.log("[NvidiaMagpieTTS] Worker available on port", MAGPIE_TTS_PORT);
      this._voices = await this.getVoices();
    } else {
      console.warn("[NvidiaMagpieTTS] Worker not available on port", MAGPIE_TTS_PORT);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const resp = await fetch(`${MAGPIE_HTTP_URL}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!resp.ok) return false;
      const data = await resp.json();
      return data.status === "ok";
    } catch {
      return false;
    }
  }

  /**
   * Full synthesis: send text, receive complete WAV audio.
   * Suitable for short utterances and acknowledgements.
   */
  async synthesize(text: string, options?: TtsOptions): Promise<Blob> {
    return this._bridge.synthesize({
      text,
      voice: options?.voice,
      speed: options?.speed,
      sample_rate: options?.sampleRate,
    });
  }

  /**
   * Streaming synthesis: returns audio chunks as they become available.
   * Enables playback to begin before the full utterance is synthesized,
   * reducing perceived latency for longer responses.
   */
  async *synthesizeStream(text: string, options?: TtsOptions): AsyncGenerator<ArrayBuffer> {
    yield* this._bridge.synthesizeStream({
      text,
      voice: options?.voice,
      speed: options?.speed,
      sample_rate: options?.sampleRate,
    });
  }

  async getVoices(): Promise<VoiceInfo[]> {
    if (this._voices.length > 0) return this._voices;

    const raw = await this._bridge.getVoices();
    this._voices = raw.map((v) => ({
      id: v.id,
      name: v.name,
      language: v.language,
    }));
    return this._voices;
  }

  dispose(): void {
    this._available = false;
    this._voices = [];
  }
}
