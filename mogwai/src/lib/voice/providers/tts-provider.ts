import type { TtsOptions, VoiceInfo } from "../types";

export interface TextToSpeechProvider {
  readonly id: string;
  readonly name: string;

  initialize(): Promise<void>;
  isAvailable(): Promise<boolean>;

  synthesize(text: string, options?: TtsOptions): Promise<Blob>;

  /** Optional streaming synthesis — returns audio chunks as they become available */
  synthesizeStream?(text: string, options?: TtsOptions): AsyncGenerator<ArrayBuffer>;

  getVoices(): Promise<VoiceInfo[]>;

  dispose(): void;
}
