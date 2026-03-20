import type { VoiceState } from "@/lib/voice/types";

const STATE_CONFIG: Record<VoiceState, { label: string; color: string; icon: string }> = {
  idle: { label: "Ready", color: "var(--text-muted)", icon: "○" },
  listening: { label: "Listening...", color: "#3b82f6", icon: "◉" },
  transcribing: { label: "Transcribing...", color: "#8b5cf6", icon: "◎" },
  thinking: { label: "Thinking...", color: "#f59e0b", icon: "◈" },
  awaiting_confirmation: { label: "Awaiting Confirmation", color: "#ef4444", icon: "◆" },
  executing: { label: "Executing...", color: "#06b6d4", icon: "▶" },
  speaking: { label: "Speaking...", color: "#22c55e", icon: "◉" },
  error: { label: "Error", color: "#ef4444", icon: "✕" },
};

interface VoiceStateIndicatorProps {
  state: VoiceState;
  sttProvider?: string;
  ttsProvider?: string;
  compact?: boolean;
}

export function VoiceStateIndicator({ state, sttProvider, ttsProvider, compact }: VoiceStateIndicatorProps) {
  const config = STATE_CONFIG[state];
  const isActive = state !== "idle";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? 6 : 10,
        padding: compact ? "4px 8px" : "8px 14px",
        borderRadius: 8,
        background: isActive ? `${config.color}15` : "var(--bg-secondary)",
        border: `1px solid ${isActive ? `${config.color}30` : "var(--border)"}`,
        transition: "all 0.3s ease",
      }}
    >
      <span
        style={{
          fontSize: compact ? 12 : 16,
          color: config.color,
          animation: isActive ? "pulse-dot 1.5s ease-in-out infinite" : "none",
        }}
      >
        {config.icon}
      </span>

      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span
          style={{
            fontSize: compact ? 11 : 13,
            fontWeight: 500,
            color: config.color,
          }}
        >
          {config.label}
        </span>

        {!compact && (sttProvider || ttsProvider) && (
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
            {sttProvider && `STT: ${sttProvider}`}
            {sttProvider && ttsProvider && " · "}
            {ttsProvider && `TTS: ${ttsProvider}`}
          </span>
        )}
      </div>

      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
