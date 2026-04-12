import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Minimize2 } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { LobsterIcon } from "@/components/LobsterIcon";

export function TitleBar() {
  const setMinimized = useAppStore(s => s.setMinimized);
  const appWindow = getCurrentWindow();

  return (
    <div
      className="glass-titlebar"
      style={{
        height: 38, display: "flex",
        alignItems: "center", flexShrink: 0,
      }}
    >
      <div
        data-tauri-drag-region
        style={{
          flex: 1, height: "100%", display: "flex", alignItems: "center",
          gap: 7, paddingLeft: 16, minWidth: 0,
        }}
      >
        <div style={{
          width: 22, height: 22, borderRadius: 6, overflow: "hidden",
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>
          <LobsterIcon size={22} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", letterSpacing: "-0.01em", pointerEvents: "none" }}>Crystal</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 1, paddingRight: 12 }}>
        <TitleButton onClick={() => setMinimized(true)} title="Float Mode">
          <Minimize2 style={{ width: 13, height: 13 }} />
        </TitleButton>
        <TitleButton onClick={() => appWindow.minimize()} title="Minimize" aria-label="Minimize">
          <Minus style={{ width: 13, height: 13 }} />
        </TitleButton>
        <TitleButton onClick={() => appWindow.toggleMaximize()} title="Maximize" aria-label="Maximize">
          <Square style={{ width: 11, height: 11 }} />
        </TitleButton>
        <TitleButton onClick={() => appWindow.hide()} title="Minimize to tray" isClose aria-label="Minimize to tray">
          <X style={{ width: 13, height: 13 }} />
        </TitleButton>
      </div>
    </div>
  );
}

function TitleButton({ onClick, title, isClose, children, "aria-label": ariaLabel }: {
  onClick: () => void; title: string; isClose?: boolean; children: React.ReactNode; "aria-label"?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={ariaLabel || title}
      style={{
        width: 32, height: 28, borderRadius: 6, border: "none", cursor: "pointer",
        background: "transparent", color: "var(--text-muted)",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = isClose ? "var(--error)" : "var(--bg-hover)";
        e.currentTarget.style.color = isClose ? "#fff" : "var(--text)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--text-muted)";
      }}
    >
      {children}
    </button>
  );
}
