/**
 * KokoroTtsProvider — fallback TTS provider wrapping the existing
 * Kokoro FastAPI server on port 8081 (scripts/tts_server.py).
 *
 * Kept for migration compatibility while transitioning to NVIDIA Magpie TTS.
 */

import type { TextToSpeechProvider } from "./tts-provider";
import type { TtsOptions, VoiceInfo } from "../types";

const KOKORO_PORT = 8081;
const KOKORO_URL = `http://127.0.0.1:${KOKORO_PORT}`;

export class KokoroTtsProvider implements TextToSpeechProvider {
  readonly id = "kokoro";
  readonly name = "Kokoro TTS (Fallback)";

  private _cachedVoices: VoiceInfo[] = [];

  async initialize(): Promise<void> {
    if (await this.isAvailable()) {
      this._cachedVoices = await this.getVoices();
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const resp = await fetch(`${KOKORO_URL}/health`, { signal: AbortSignal.timeout(2000) });
      return resp.ok;
    } catch {
      return false;
    }
  }

  async synthesize(text: string, options?: TtsOptions): Promise<Blob> {
    const resp = await fetch(`${KOKORO_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: options?.voice ?? "af_heart" }),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      throw new Error(`Kokoro TTS error: ${resp.statusText}`);
    }

    return resp.blob();
  }

  async getVoices(): Promise<VoiceInfo[]> {
    if (this._cachedVoices.length > 0) return this._cachedVoices;
    try {
      const resp = await fetch(`${KOKORO_URL}/voices`, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) return [];
      const data = await resp.json();
      this._cachedVoices = (data.voices ?? []).map((v: { id: string; name: string }) => ({
        id: v.id,
        name: v.name,
      }));
      return this._cachedVoices;
    } catch {
      return [];
    }
  }

  dispose(): void {
    this._cachedVoices = [];
  }
}
