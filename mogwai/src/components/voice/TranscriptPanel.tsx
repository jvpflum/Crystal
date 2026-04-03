import { useEffect, useRef } from "react";
import type { TranscriptEntry } from "@/lib/voice/types";

interface TranscriptPanelProps {
  entries: readonly TranscriptEntry[];
  maxHeight?: number;
}

export function TranscriptPanel({ entries, maxHeight = 300 }: TranscriptPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  if (entries.length === 0) {
    return (
      <div
        style={{
          padding: 20,
          textAlign: "center",
          color: "var(--text-muted)",
          fontSize: 13,
        }}
      >
        No transcript yet. Tap the orb or say "Hey Crystal" to start.
      </div>
    );
  }

  return (
    <div
      style={{
        maxHeight,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "8px 12px",
      }}
    >
      {entries.map((entry) => (
        <div
          key={entry.id}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: entry.role === "user" ? "flex-end" : "flex-start",
            opacity: entry.is_partial ? 0.6 : 1,
          }}
        >
          <div
            style={{
              maxWidth: "85%",
              padding: "8px 12px",
              borderRadius: entry.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
              background:
                entry.role === "user"
                  ? "var(--accent, #3b82f6)"
                  : entry.role === "system"
                    ? "var(--bg-tertiary, #1e1e2e)"
                    : "var(--bg-secondary, #2a2a3e)",
              color:
                entry.role === "user" ? "white" : "var(--text-primary)",
              fontSize: 13,
              lineHeight: 1.4,
              fontStyle: entry.is_partial ? "italic" : "normal",
            }}
          >
            {entry.text}
          </div>
          <span
            style={{
              fontSize: 10,
              color: "var(--text-muted)",
              marginTop: 2,
              paddingInline: 4,
            }}
          >
            {new Date(entry.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
