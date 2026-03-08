export type VoiceState = "idle" | "listening" | "processing" | "speaking";

export interface VoiceConfig {
  wakeWord: string;
  sttModel: string;
  ttsVoice: string;
  silenceThreshold: number;
  maxRecordingTime: number;
}

const defaultConfig: VoiceConfig = {
  wakeWord: "hey crystal",
  sttModel: "whisper-large-v3",
  ttsVoice: "nova",
  silenceThreshold: 1500,
  maxRecordingTime: 30000,
};

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

class VoiceService {
  private config: VoiceConfig = defaultConfig;
  private onStateChange: ((state: VoiceState) => void) | null = null;
  private onTranscript: ((text: string) => void) | null = null;
  private whisperEndpoint: string = "http://127.0.0.1:8080/inference";
  private ttsEndpoint: string = "http://127.0.0.1:8081/tts";

  private recognition: any = null;
  private isListening: boolean = false;

  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];

  private useWebSpeech: boolean = true;
  private whisperAvailable: boolean = false;
  private ttsAvailable: boolean = false;

  constructor() {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = false;
      this.recognition.interimResults = true;
      this.recognition.lang = "en-US";
      this.recognition.maxAlternatives = 1;

      this.recognition.onresult = (event: SpeechRecognitionEvent) => {
        let final = "";
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            final += result[0].transcript;
          } else {
            interim += result[0].transcript;
          }
        }
        if (final) {
          this.onTranscript?.(final.trim());
        } else if (interim) {
          this.onTranscript?.(interim.trim());
        }
      };

      this.recognition.onend = () => {
        if (this.isListening) {
          this.isListening = false;
          this.setState("processing");
          setTimeout(() => this.setState("idle"), 500);
        }
      };

      this.recognition.onerror = (event: any) => {
        console.warn("[Crystal] Speech recognition error:", event.error);
        this.isListening = false;
        this.setState("idle");
      };

      this.useWebSpeech = true;
    } else {
      this.useWebSpeech = false;
    }
  }

  setConfig(config: Partial<VoiceConfig>) {
    this.config = { ...this.config, ...config };
  }

  getConfig(): VoiceConfig {
    return this.config;
  }

  onStateChangeCallback(callback: (state: VoiceState) => void) {
    this.onStateChange = callback;
  }

  onTranscriptCallback(callback: (text: string) => void) {
    this.onTranscript = callback;
  }

  private setState(state: VoiceState) {
    this.onStateChange?.(state);
  }

  async startListening(): Promise<void> {
    if (this.isListening) return;

    if (this.useWebSpeech && this.recognition) {
      return this.startWebSpeech();
    }

    if (this.whisperAvailable) {
      return this.startWhisperRecording();
    }

    throw new Error("No speech recognition available. Enable microphone permissions.");
  }

  private async startWebSpeech(): Promise<void> {
    this.isListening = true;
    this.setState("listening");
    try {
      this.recognition.start();
    } catch (e: any) {
      if (e.message?.includes("already started")) {
        this.recognition.stop();
        await new Promise(r => setTimeout(r, 200));
        this.recognition.start();
      } else {
        this.isListening = false;
        this.setState("idle");
        throw e;
      }
    }

    setTimeout(() => {
      if (this.isListening) {
        this.stopListening();
      }
    }, this.config.maxRecordingTime);
  }

  private async startWhisperRecording(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
      });

      this.mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      this.audioChunks = [];
      this.isListening = true;
      this.setState("listening");

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.audioChunks.push(event.data);
      };

      this.mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(this.audioChunks, { type: "audio/webm" });
        this.audioChunks = [];
        if (audioBlob.size > 0) {
          this.setState("processing");
          await this.transcribeWhisper(audioBlob);
        }
        this.setState("idle");
      };

      this.mediaRecorder.start(100);

      setTimeout(() => {
        if (this.isListening) this.stopListening();
      }, this.config.maxRecordingTime);
    } catch (error) {
      console.error("Failed to start Whisper recording:", error);
      this.setState("idle");
      throw error;
    }
  }

  async stopListening(): Promise<void> {
    if (!this.isListening) return;
    this.isListening = false;

    if (this.useWebSpeech && this.recognition) {
      try {
        this.recognition.stop();
      } catch {}
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
      this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
      this.mediaRecorder = null;
    }
  }

  private async transcribeWhisper(audioBlob: Blob): Promise<string> {
    try {
      const formData = new FormData();
      formData.append("file", audioBlob, "audio.webm");
      formData.append("response_format", "json");

      const response = await fetch(this.whisperEndpoint, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error(`Whisper API error: ${response.statusText}`);

      const data = await response.json();
      const transcript = data.text || "";

      if (transcript) this.onTranscript?.(transcript);
      return transcript;
    } catch (error) {
      console.error("Transcription failed:", error);
      return "";
    }
  }

  async speak(text: string): Promise<void> {
    this.setState("speaking");

    if (this.ttsAvailable) {
      try {
        const response = await fetch(this.ttsEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice: this.config.ttsVoice }),
        });

        if (response.ok) {
          const audioBlob = await response.blob();
          const audioUrl = URL.createObjectURL(audioBlob);
          const audio = new Audio(audioUrl);

          return new Promise((resolve, reject) => {
            audio.onended = () => {
              URL.revokeObjectURL(audioUrl);
              this.setState("idle");
              resolve();
            };
            audio.onerror = (e) => {
              URL.revokeObjectURL(audioUrl);
              this.setState("idle");
              reject(e);
            };
            audio.play();
          });
        }
      } catch {
        // fall through to browser TTS
      }
    }

    if ("speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      return new Promise((resolve) => {
        utterance.onend = () => {
          this.setState("idle");
          resolve();
        };
        utterance.onerror = () => {
          this.setState("idle");
          resolve();
        };
        speechSynthesis.speak(utterance);
      });
    }

    this.setState("idle");
  }

  setWhisperEndpoint(endpoint: string) {
    this.whisperEndpoint = endpoint;
  }

  setTTSEndpoint(endpoint: string) {
    this.ttsEndpoint = endpoint;
  }

  async checkWhisperConnection(): Promise<boolean> {
    try {
      const response = await fetch(this.whisperEndpoint.replace("/inference", "/health"), {
        signal: AbortSignal.timeout(2000),
      });
      this.whisperAvailable = response.ok;
      return response.ok;
    } catch {
      this.whisperAvailable = false;
      return false;
    }
  }

  async checkTTSConnection(): Promise<boolean> {
    try {
      const response = await fetch(this.ttsEndpoint.replace("/tts", "/health"), {
        signal: AbortSignal.timeout(2000),
      });
      this.ttsAvailable = response.ok;
      return response.ok;
    } catch {
      this.ttsAvailable = false;
      return false;
    }
  }

  hasSpeechRecognition(): boolean {
    return this.useWebSpeech || this.whisperAvailable;
  }

  hasTTS(): boolean {
    return this.ttsAvailable || "speechSynthesis" in window;
  }
}

export const voiceService = new VoiceService();
