import { useEffect, useRef } from "react";
import { Mic, MicOff } from "lucide-react";
import { useVoice } from "@/hooks/useVoice";
import type { VoiceState } from "@/lib/voice";

const gradients: Record<VoiceState, string> = {
  idle: "linear-gradient(135deg, rgba(59,130,246,0.35), rgba(139,92,246,0.35))",
  listening: "linear-gradient(135deg, rgba(59,130,246,0.55), rgba(34,211,238,0.55))",
  processing: "linear-gradient(135deg, rgba(139,92,246,0.55), rgba(236,72,153,0.55))",
  speaking: "linear-gradient(135deg, rgba(34,197,94,0.55), rgba(16,185,129,0.55))",
};

const glowColors: Record<VoiceState, string> = {
  idle: "rgba(59,130,246,0.15)",
  listening: "rgba(59,130,246,0.35)",
  processing: "rgba(168,85,247,0.35)",
  speaking: "rgba(34,197,94,0.35)",
};

const ringColors: Record<VoiceState, string> = {
  idle: "rgba(59,130,246,0.25)",
  listening: "rgba(96,165,250,0.6)",
  processing: "rgba(192,132,252,0.6)",
  speaking: "rgba(74,222,128,0.6)",
};

const stateLabels: Record<VoiceState, string> = {
  idle: 'Say "Hey Crystal" or tap to speak',
  listening: "Listening...",
  processing: "Processing...",
  speaking: "Speaking...",
};

export function VoiceOrb() {
  const { voiceState, transcript, startListening, stopListening, hasSpeechRecognition } = useVoice();
  const lastTranscript = useRef("");

  useEffect(() => {
    if (transcript && transcript !== lastTranscript.current && voiceState === "idle") {
      lastTranscript.current = transcript;
      window.dispatchEvent(new CustomEvent("crystal:navigate", { detail: "conversation" }));
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("crystal:voice-message", { detail: transcript }));
      }, 300);
    }
  }, [transcript, voiceState]);

  const handleClick = async () => {
    if (voiceState === "idle") {
      await startListening();
    } else if (voiceState === "listening") {
      await stopListening();
    }
  };

  const isActive = voiceState !== "idle";
  const available = hasSpeechRecognition;

  return (
    <>
      <style>{`
        @keyframes vorb-pulse {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.25); opacity: 0; }
        }
        @keyframes vorb-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes vorb-glow {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <button
          onClick={handleClick}
          disabled={!available}
          style={{
            position: "relative",
            width: 80,
            height: 80,
            borderRadius: "50%",
            border: "none",
            cursor: available ? "pointer" : "not-allowed",
            background: gradients[voiceState],
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "transform 0.2s, box-shadow 0.3s",
            boxShadow: isActive
              ? `0 0 24px ${glowColors[voiceState]}, 0 0 48px ${glowColors[voiceState]}`
              : `0 0 12px ${glowColors[voiceState]}`,
            outline: "none",
            opacity: available ? 1 : 0.5,
          }}
          onMouseEnter={e => { if (available) e.currentTarget.style.transform = "scale(1.05)"; }}
          onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}
          onMouseDown={e => { if (available) e.currentTarget.style.transform = "scale(0.95)"; }}
          onMouseUp={e => { if (available) e.currentTarget.style.transform = "scale(1.05)"; }}
        >
          {voiceState === "listening" && (
            <span style={{
              position: "absolute",
              inset: -4,
              borderRadius: "50%",
              border: `2px solid ${ringColors.listening}`,
              animation: "vorb-pulse 1.5s ease-in-out infinite",
              pointerEvents: "none",
            }} />
          )}

          {isActive && (
            <span style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              border: `2px solid ${ringColors[voiceState]}`,
              animation: voiceState === "processing" ? "vorb-spin 2s linear infinite" : "vorb-glow 2s ease-in-out infinite",
              pointerEvents: "none",
            }} />
          )}

          <span style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: "linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.05))",
            backdropFilter: "blur(6px)",
            border: "1px solid rgba(255,255,255,0.18)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            animation: voiceState === "processing" ? "vorb-spin 2s linear infinite" : "none",
          }}>
            {available ? (
              <Mic style={{
                width: 22,
                height: 22,
                color: isActive ? "white" : "rgba(255,255,255,0.6)",
                transition: "color 0.3s",
              }} />
            ) : (
              <MicOff style={{ width: 22, height: 22, color: "rgba(255,255,255,0.4)" }} />
            )}
          </span>

          {isActive && (
            <span style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${glowColors[voiceState]} 0%, transparent 70%)`,
              animation: "vorb-glow 2s ease-in-out infinite",
              pointerEvents: "none",
            }} />
          )}
        </button>

        <div style={{ textAlign: "center", maxWidth: 200 }}>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.4 }}>
            {available ? stateLabels[voiceState] : "Voice not available"}
          </div>

          {transcript && voiceState === "idle" && (
            <div style={{
              fontSize: 11,
              color: "var(--text-muted)",
              marginTop: 4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              "{transcript}"
            </div>
          )}
        </div>
      </div>
    </>
  );
}
