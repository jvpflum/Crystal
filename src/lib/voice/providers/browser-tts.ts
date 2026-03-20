/**
 * BrowserTtsProvider — last-resort TTS fallback using the Web Speech Synthesis API.
 *
 * Uses the browser's built-in speechSynthesis. No GPU required, no local server.
 * Quality varies by OS/browser, but universally available.
 */

import type { TextToSpeechProvider } from "./tts-provider";
import type { TtsOptions, VoiceInfo } from "../types";

export class BrowserTtsProvider implements TextToSpeechProvider {
  readonly id = "browser";
  readonly name = "Browser Speech Synthesis (Fallback)";

  async initialize(): Promise<void> { /* no-op */ }

  async isAvailable(): Promise<boolean> {
    return "speechSynthesis" in window;
  }

  /**
   * The browser TTS API is fire-and-forget with no audio blob output.
   * We return an empty blob and handle playback internally via speechSynthesis.speak().
   * The ConversationAgent should call speakDirect() instead for this provider.
   */
  async synthesize(text: string, options?: TtsOptions): Promise<Blob> {
    await this.speakDirect(text, options);
    return new Blob([], { type: "audio/wav" });
  }

  /** Direct playback through browser speechSynthesis — no blob intermediary. */
  speakDirect(text: string, options?: TtsOptions): Promise<void> {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) {
        resolve();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = options?.speed ?? 1.0;
      utterance.pitch = 1.0;

      if (options?.voice) {
        const voices = speechSynthesis.getVoices();
        const match = voices.find((v) => v.name === options.voice || v.voiceURI === options.voice);
        if (match) utterance.voice = match;
      }

      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      speechSynthesis.speak(utterance);
    });
  }

  async getVoices(): Promise<VoiceInfo[]> {
    if (!("speechSynthesis" in window)) return [];

    const voices = speechSynthesis.getVoices();
    if (voices.length > 0) {
      return voices.map((v) => ({
        id: v.voiceURI,
        name: v.name,
        language: v.lang,
      }));
    }

    // Voices may load asynchronously
    return new Promise((resolve) => {
      speechSynthesis.onvoiceschanged = () => {
        resolve(
          speechSynthesis.getVoices().map((v) => ({
            id: v.voiceURI,
            name: v.name,
            language: v.lang,
          }))
        );
      };
      setTimeout(() => resolve([]), 2000);
    });
  }

  dispose(): void {
    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
    }
  }
}
