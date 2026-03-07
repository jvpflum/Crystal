import { useState, useEffect, useCallback, useRef } from "react";
import { voiceService, VoiceState, VoiceConfig } from "@/lib/voice";

export function useVoice() {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState<string>("");
  const [isWhisperConnected, setIsWhisperConnected] = useState(false);
  const [isTTSConnected, setIsTTSConnected] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const pollIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    voiceService.onStateChangeCallback(setVoiceState);
    voiceService.onTranscriptCallback(setTranscript);

    const checkServers = async () => {
      const whisper = await voiceService.checkWhisperConnection();
      const tts = await voiceService.checkTTSConnection();
      setIsWhisperConnected(whisper);
      setIsTTSConnected(tts);
      return { whisper, tts };
    };

    checkServers().then(({ whisper, tts }) => {
      if (whisper && tts) {
        setIsInitializing(false);
      } else {
        let attempts = 0;
        const maxAttempts = 30;
        
        pollIntervalRef.current = window.setInterval(async () => {
          attempts++;
          const status = await checkServers();
          
          if ((status.whisper && status.tts) || attempts >= maxAttempts) {
            setIsInitializing(false);
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
          }
        }, 2000);
      }
    });

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  const startListening = useCallback(async () => {
    try {
      await voiceService.startListening();
    } catch (error) {
      console.error("Failed to start voice:", error);
    }
  }, []);

  const stopListening = useCallback(async () => {
    await voiceService.stopListening();
  }, []);

  const speak = useCallback(async (text: string) => {
    await voiceService.speak(text);
  }, []);

  const setConfig = useCallback((config: Partial<VoiceConfig>) => {
    voiceService.setConfig(config);
  }, []);

  const checkConnections = useCallback(async () => {
    const [whisper, tts] = await Promise.all([
      voiceService.checkWhisperConnection(),
      voiceService.checkTTSConnection(),
    ]);
    setIsWhisperConnected(whisper);
    setIsTTSConnected(tts);
    return { whisper, tts };
  }, []);

  return {
    voiceState,
    transcript,
    isWhisperConnected,
    isTTSConnected,
    isInitializing,
    startListening,
    stopListening,
    speak,
    setConfig,
    checkConnections,
    getConfig: () => voiceService.getConfig(),
  };
}
