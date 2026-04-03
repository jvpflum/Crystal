import { useState, useEffect } from "react";
import type { PendingConfirmation, RiskLevel } from "@/lib/voice/types";

const RISK_COLORS: Record<RiskLevel, { bg: string; border: string; text: string }> = {
  none: { bg: "#22c55e15", border: "#22c55e40", text: "#22c55e" },
  low: { bg: "#3b82f615", border: "#3b82f640", text: "#3b82f6" },
  medium: { bg: "#f59e0b15", border: "#f59e0b40", text: "#f59e0b" },
  high: { bg: "#ef444415", border: "#ef444440", text: "#ef4444" },
  critical: { bg: "#dc262615", border: "#dc262660", text: "#dc2626" },
};

const RISK_LABELS: Record<RiskLevel, string> = {
  none: "Safe",
  low: "Low Risk",
  medium: "Medium Risk",
  high: "High Risk",
  critical: "CRITICAL",
};

interface ConfirmationCardProps {
  confirmation: PendingConfirmation;
  onConfirm: (id: string) => void;
  onDismiss: (id: string) => void;
}

export function ConfirmationCard({ confirmation, onConfirm, onDismiss }: ConfirmationCardProps) {
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const risk = RISK_COLORS[confirmation.risk_level];

  useEffect(() => {
    if (!confirmation.expires_at) return;

    const update = () => {
      const remaining = Math.max(0, confirmation.expires_at! - Date.now());
      setTimeLeft(Math.ceil(remaining / 1000));
      if (remaining <= 0) {
        onDismiss(confirmation.id);
      }
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [confirmation.expires_at, confirmation.id, onDismiss]);

  return (
    <div
      style={{
        border: `1px solid ${risk.border}`,
        borderRadius: 10,
        background: risk.bg,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: risk.text,
            padding: "2px 8px",
            borderRadius: 4,
            background: `${risk.text}20`,
          }}
        >
          {RISK_LABELS[confirmation.risk_level]}
        </span>
        {timeLeft !== null && (
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {timeLeft}s
          </span>
        )}
      </div>

      <p style={{ fontSize: 13, color: "var(--text-primary)", margin: 0, lineHeight: 1.5 }}>
        {confirmation.description}
      </p>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          onClick={() => onDismiss(confirmation.id)}
          style={{
            padding: "6px 16px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text-secondary)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => onConfirm(confirmation.id)}
          style={{
            padding: "6px 16px",
            borderRadius: 6,
            border: "none",
            background: risk.text,
            color: "white",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
