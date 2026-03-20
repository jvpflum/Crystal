import { useRef, useEffect } from "react";
import type { VoiceSystemEvent } from "@/lib/voice/types";

interface EventLogProps {
  events: readonly VoiceSystemEvent[];
  maxHeight?: number;
}

function formatEvent(event: VoiceSystemEvent): { text: string; color: string } {
  switch (event.kind) {
    case "state_change":
      return {
        text: `State: ${event.from} → ${event.to} (${event.event})`,
        color: "#8b5cf6",
      };
    case "transcript":
      return {
        text: `[${event.entry.role}] ${event.entry.is_partial ? "(partial) " : ""}${event.entry.text.slice(0, 100)}`,
        color: event.entry.role === "user" ? "#3b82f6" : "#22c55e",
      };
    case "action":
      return {
        text: `Action: ${event.action.type} — ${event.action.user_visible_message.slice(0, 80)}`,
        color: "#f59e0b",
      };
    case "action_result":
      return {
        text: `Result: ${event.result.success ? "OK" : "FAIL"} — ${(event.result.output || event.result.error || "").slice(0, 80)}`,
        color: event.result.success ? "#22c55e" : "#ef4444",
      };
    case "task_update":
      return {
        text: `Task ${event.task.id}: ${event.task.status}`,
        color: "#06b6d4",
      };
    case "confirmation_request":
      return {
        text: `Confirmation: ${event.confirmation.description.slice(0, 80)}`,
        color: "#ef4444",
      };
    case "error":
      return {
        text: `Error: ${event.message}${event.recoverable ? " (recoverable)" : ""}`,
        color: "#ef4444",
      };
  }
}

export function EventLog({ events, maxHeight = 200 }: EventLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  if (events.length === 0) {
    return (
      <div style={{ padding: 12, textAlign: "center", color: "var(--text-muted)", fontSize: 11 }}>
        No events yet
      </div>
    );
  }

  return (
    <div
      style={{
        maxHeight,
        overflowY: "auto",
        fontFamily: "monospace",
        fontSize: 11,
        lineHeight: 1.6,
        padding: "6px 10px",
        background: "var(--bg-tertiary)",
        borderRadius: 6,
      }}
    >
      {events.slice(-50).map((event, i) => {
        const { text, color } = formatEvent(event);
        return (
          <div key={i} style={{ color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {text}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
