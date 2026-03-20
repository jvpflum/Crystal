import type { ActiveTask, TaskStatus } from "@/lib/voice/types";

const STATUS_CONFIG: Record<TaskStatus, { color: string; label: string }> = {
  queued: { color: "#6b7280", label: "Queued" },
  running: { color: "#3b82f6", label: "Running" },
  completed: { color: "#22c55e", label: "Done" },
  failed: { color: "#ef4444", label: "Failed" },
  cancelled: { color: "#9ca3af", label: "Cancelled" },
};

interface ActiveTasksListProps {
  tasks: readonly ActiveTask[];
}

export function ActiveTasksList({ tasks }: ActiveTasksListProps) {
  if (tasks.length === 0) {
    return (
      <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
        No active tasks
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {tasks.map((task) => {
        const status = STATUS_CONFIG[task.status];
        const elapsed = task.completed_at
          ? ((task.completed_at - task.started_at) / 1000).toFixed(1)
          : ((Date.now() - task.started_at) / 1000).toFixed(0);

        return (
          <div
            key={task.id}
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500 }}>
                {task.action.user_visible_message.slice(0, 80)}
                {task.action.user_visible_message.length > 80 ? "..." : ""}
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: status.color,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: `${status.color}15`,
                }}
              >
                {status.label}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {task.status === "running" && task.progress != null && (
                <div
                  style={{
                    flex: 1,
                    height: 3,
                    borderRadius: 2,
                    background: "var(--bg-tertiary)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${task.progress * 100}%`,
                      height: "100%",
                      background: status.color,
                      borderRadius: 2,
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              )}
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                {elapsed}s
              </span>
            </div>

            {task.error && (
              <span style={{ fontSize: 11, color: "#ef4444" }}>
                {task.error.slice(0, 120)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
