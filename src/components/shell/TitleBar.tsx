import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Minimize2 } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { LobsterIcon } from "@/components/LobsterIcon";
import { NavMenu } from "@/components/shell/Navigation";

export function TitleBar() {
  const setMinimized = useAppStore(s => s.setMinimized);
  const setView = useAppStore(s => s.setView);
  const currentView = useAppStore(s => s.currentView);
  const gatewayConnected = useAppStore(s => s.gatewayConnected);
  const serviceStatus = useAppStore(s => s.serviceStatus);
  const appWindow = getCurrentWindow();

  const svcDotColor = (s: "off" | "starting" | "ready") =>
    s === "ready" ? "var(--success)" : s === "starting" ? "var(--warning, #f59e0b)" : "rgba(255,255,255,0.14)";
  const svcDotGlow = (s: "off" | "starting" | "ready") =>
    s === "ready" ? "0 0 5px rgba(52,211,153,0.5)" : "none";

  return (
    <div
      className="glass-titlebar"
      style={{
        height: 38, display: "flex",
        alignItems: "center", flexShrink: 0,
        // Raise above the content area so the nav drawer overlays cleanly.
        position: "relative", zIndex: 60,
      }}
    >
      {/* Crystal logo doubles as the Home button. */}
      <button
        type="button"
        onClick={() => setView("home")}
        title="Home"
        aria-label="Go to Home"
        aria-current={currentView === "home" ? "page" : undefined}
        style={{
          height: "100%", display: "flex", alignItems: "center", gap: 7,
          padding: "0 10px 0 14px", border: "none", background: "transparent",
          cursor: "pointer", flexShrink: 0,
          color: currentView === "home" ? "var(--text)" : "var(--text-secondary)",
          transition: "color 0.15s ease, opacity 0.15s ease",
        }}
        onMouseEnter={e => { e.currentTarget.style.opacity = "0.78"; }}
        onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
      >
        <div style={{
          width: 22, height: 22, borderRadius: 6, overflow: "hidden",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <LobsterIcon size={22} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "-0.01em" }}>Crystal</span>
      </button>

      {/* Remaining space stays draggable. */}
      <div data-tauri-drag-region style={{ flex: 1, height: "100%", minWidth: 0 }} />

      {/* Service status — compact, beside the menu button. */}
      <div
        title={`Gateway: ${serviceStatus.gateway}\nvLLM: ${serviceStatus.vllm}`}
        aria-label={`Gateway ${serviceStatus.gateway}, vLLM ${serviceStatus.vllm}`}
        style={{ display: "flex", alignItems: "center", gap: 5, padding: "0 8px", flexShrink: 0 }}
      >
        <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
          {(["gateway", "vllm"] as const).map(svc => (
            <div key={svc} style={{
              width: 5, height: 5, borderRadius: "50%",
              background: svcDotColor(serviceStatus[svc]),
              boxShadow: svcDotGlow(serviceStatus[svc]),
              transition: "all 0.4s ease",
              animation: serviceStatus[svc] === "starting" ? "pulse-dot 1.5s infinite" : undefined,
            }} />
          ))}
        </div>
        <span style={{ fontSize: 8, color: "var(--text-muted)", letterSpacing: 0.8, fontWeight: 600 }}>
          {gatewayConnected ? "LIVE" : "BOOT"}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 1, paddingRight: 12 }}>
        <NavMenu />
        <div style={{ width: 1, height: 16, background: "var(--border-subtle, rgba(255,255,255,0.08))", margin: "0 5px" }} />
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
