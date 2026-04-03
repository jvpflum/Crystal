import "@/stores/themeStore";
import { useEffect, useState, useCallback, useRef, lazy, Suspense } from "react";
import { TitleBar } from "@/components/shell/TitleBar";
import { Navigation } from "@/components/shell/Navigation";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { LobsterIcon } from "@/components/LobsterIcon";
import { ToastProvider } from "@/components/shell/Toast";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { Onboarding } from "@/components/shell/Onboarding";
import { useAppStore } from "@/stores/appStore";
import { useToggleWindowShortcut } from "@/hooks/useGlobalShortcut";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useStorage } from "@/hooks/useStorage";
import { openclawClient } from "@/lib/openclaw";
import { Loader2 } from "lucide-react";
import "./index.css";

const HomeView = lazy(() => import("@/components/views/HomeView").then(m => ({ default: m.HomeView })));
const ConversationView = lazy(() => import("@/components/views/ConversationView").then(m => ({ default: m.ConversationView })));
const CommandCenterView = lazy(() => import("@/components/views/CommandCenterView").then(m => ({ default: m.CommandCenterView })));
const AgentsView = lazy(() => import("@/components/views/AgentsView").then(m => ({ default: m.AgentsView })));
const MarketplaceView = lazy(() => import("@/components/views/MarketplaceView").then(m => ({ default: m.MarketplaceView })));
const ModelsView = lazy(() => import("@/components/views/ModelsView").then(m => ({ default: m.ModelsView })));
const SessionsView = lazy(() => import("@/components/views/SessionsView").then(m => ({ default: m.SessionsView })));
const TemplatesView = lazy(() => import("@/components/views/TemplatesView").then(m => ({ default: m.TemplatesView })));
const ChannelsView = lazy(() => import("@/components/views/ChannelsView").then(m => ({ default: m.ChannelsView })));
const MemoryView = lazy(() => import("@/components/views/MemoryView").then(m => ({ default: m.MemoryView })));
const ToolsView = lazy(() => import("@/components/views/ToolsView").then(m => ({ default: m.ToolsView })));
const ActivityView = lazy(() => import("@/components/views/ActivityView").then(m => ({ default: m.ActivityView })));
const SettingsView = lazy(() => import("@/components/views/SettingsView").then(m => ({ default: m.SettingsView })));
const CronView = lazy(() => import("@/components/views/CronView").then(m => ({ default: m.CronView })));
const SecurityView = lazy(() => import("@/components/views/SecurityView").then(m => ({ default: m.SecurityView })));
const HooksView = lazy(() => import("@/components/views/HooksView").then(m => ({ default: m.HooksView })));
const DoctorView = lazy(() => import("@/components/views/DoctorView").then(m => ({ default: m.DoctorView })));
const NodesView = lazy(() => import("@/components/views/NodesView").then(m => ({ default: m.NodesView })));
const BrowserView = lazy(() => import("@/components/views/BrowserView").then(m => ({ default: m.BrowserView })));
const OfficeView = lazy(() => import("@/components/views/OfficeView").then(m => ({ default: m.OfficeView })));
const FactoryView = lazy(() => import("@/components/views/FactoryView").then(m => ({ default: m.FactoryView })));
const WorkspaceView = lazy(() => import("@/components/views/WorkspaceView").then(m => ({ default: m.WorkspaceView })));
const MessagingView = lazy(() => import("@/components/views/MessagingView").then(m => ({ default: m.MessagingView })));
const DirectoryView = lazy(() => import("@/components/views/DirectoryView").then(m => ({ default: m.DirectoryView })));
const DevicesView = lazy(() => import("@/components/views/DevicesView").then(m => ({ default: m.DevicesView })));
const SubagentsView = lazy(() => import("@/components/views/SubagentsView").then(m => ({ default: m.SubagentsView })));
const WebhooksView = lazy(() => import("@/components/views/WebhooksView").then(m => ({ default: m.WebhooksView })));
const VoiceCallView = lazy(() => import("@/components/views/VoiceCallView").then(m => ({ default: m.VoiceCallView })));
const TasksView = lazy(() => import("@/components/views/TasksView").then(m => ({ default: m.TasksView })));
const ApprovalsView = lazy(() => import("@/components/views/ApprovalsView").then(m => ({ default: m.ApprovalsView })));
const CityView = lazy(() => import("@/components/views/CityView").then(m => ({ default: m.CityView })));

function ViewSlot({ id, active, children }: { id: string; active: boolean; children: React.ReactNode }) {
  const mountedRef = useRef(false);
  if (active && !mountedRef.current) mountedRef.current = true;
  if (!mountedRef.current) return null;
  return (
    <div key={id} style={{ display: active ? "contents" : "none" }}>
      {children}
    </div>
  );
}

function ViewFallback() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", gap: 8 }}>
      <Loader2 style={{ width: 16, height: 16, color: "var(--accent)", animation: "spin 1s linear infinite" }} />
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading...</span>
    </div>
  );
}

function App() {
  const currentView = useAppStore(s => s.currentView);
  const isMinimized = useAppStore(s => s.isMinimized);
  const setGatewayConnected = useAppStore(s => s.setGatewayConnected);
  const setView = useAppStore(s => s.setView);
  const { isInitialized } = useStorage();
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(
    !localStorage.getItem("crystal_onboarded")
  );

  useToggleWindowShortcut();
  useKeyboardShortcuts();

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      setCmdPaletteOpen((o) => !o);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    const handler = (e: Event) => {
      const view = (e as CustomEvent).detail;
      if (view) setView(view);
    };
    window.addEventListener("crystal:navigate", handler);
    return () => window.removeEventListener("crystal:navigate", handler);
  }, [setView]);

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const statusCb = (s: string) => {
      if (!disposed) setGatewayConnected(s === "connected");
    };
    const unsubscribe = openclawClient.onStatusChange(statusCb);

    openclawClient.connectGateway().then(connected => {
      if (!disposed) setGatewayConnected(connected);
    }).catch(() => { if (!disposed) setGatewayConnected(false); });

    const scheduleReconnect = (delay: number) => {
      if (disposed) return;
      reconnectTimer = setTimeout(async () => {
        if (disposed) return;
        if (openclawClient.isGatewayConnected()) {
          scheduleReconnect(30_000);
          return;
        }
        try {
          const ok = await openclawClient.connectGateway();
          if (!disposed) setGatewayConnected(ok);
          scheduleReconnect(ok ? 30_000 : 10_000);
        } catch {
          if (!disposed) setGatewayConnected(false);
          scheduleReconnect(10_000);
        }
      }, delay);
    };
    scheduleReconnect(8_000);

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (unsubscribe) unsubscribe();
    };
  }, [setGatewayConnected]);

  if (!isInitialized) {
    return (
      <div className="h-screen w-screen" style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-base)" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <Loader2 style={{ width: 32, height: 32, color: "var(--accent)" }} className="animate-spin" />
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Loading Crystal...</p>
        </div>
      </div>
    );
  }

  if (isMinimized) return <FloatingOrb />;

  return (
    <ToastProvider>
      <div className="h-screen w-screen overflow-hidden" style={{ background: "var(--bg-base)" }}>
        <div style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <TitleBar />
          <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
            <Navigation />
            <main style={{ flex: 1, minWidth: 0, overflow: "hidden", background: "var(--bg-base)", position: "relative" }}>
              <ErrorBoundary>
                <Suspense fallback={<ViewFallback />}>
                  <ViewSlot id="home" active={currentView === "home"}><HomeView /></ViewSlot>
                  <ViewSlot id="conversation" active={currentView === "conversation"}><ConversationView /></ViewSlot>
                  <ViewSlot id="command-center" active={currentView === "command-center"}><CommandCenterView /></ViewSlot>
                  <ViewSlot id="agents" active={currentView === "agents"}><AgentsView /></ViewSlot>
                  <ViewSlot id="marketplace" active={currentView === "marketplace"}><MarketplaceView /></ViewSlot>
                  <ViewSlot id="models" active={currentView === "models"}><ModelsView /></ViewSlot>
                  <ViewSlot id="sessions" active={currentView === "sessions"}><SessionsView /></ViewSlot>
                  <ViewSlot id="templates" active={currentView === "templates"}><TemplatesView /></ViewSlot>
                  <ViewSlot id="channels" active={currentView === "channels"}><ChannelsView /></ViewSlot>
                  <ViewSlot id="memory" active={currentView === "memory"}><MemoryView /></ViewSlot>
                  <ViewSlot id="tools" active={currentView === "tools"}><ToolsView /></ViewSlot>
                  <ViewSlot id="activity" active={currentView === "activity"}><ActivityView /></ViewSlot>
                  <ViewSlot id="settings" active={currentView === "settings"}><SettingsView /></ViewSlot>
                  <ViewSlot id="cron" active={currentView === "cron"}><CronView /></ViewSlot>
                  <ViewSlot id="security" active={currentView === "security"}><SecurityView /></ViewSlot>
                  <ViewSlot id="hooks" active={currentView === "hooks"}><HooksView /></ViewSlot>
                  <ViewSlot id="doctor" active={currentView === "doctor"}><DoctorView /></ViewSlot>
                  <ViewSlot id="nodes" active={currentView === "nodes"}><NodesView /></ViewSlot>
                  <ViewSlot id="browser" active={currentView === "browser"}><BrowserView /></ViewSlot>
                  <ViewSlot id="office" active={currentView === "office"}><OfficeView /></ViewSlot>
                  <ViewSlot id="factory" active={currentView === "factory"}><FactoryView /></ViewSlot>
                  <ViewSlot id="workspace" active={currentView === "workspace"}><WorkspaceView /></ViewSlot>
                  <ViewSlot id="messaging" active={currentView === "messaging"}><MessagingView /></ViewSlot>
                  <ViewSlot id="directory" active={currentView === "directory"}><DirectoryView /></ViewSlot>
                  <ViewSlot id="devices" active={currentView === "devices"}><DevicesView /></ViewSlot>
                  <ViewSlot id="subagents" active={currentView === "subagents"}><SubagentsView /></ViewSlot>
                  <ViewSlot id="webhooks" active={currentView === "webhooks"}><WebhooksView /></ViewSlot>
                  <ViewSlot id="voicecall" active={currentView === "voicecall"}><VoiceCallView /></ViewSlot>
                  <ViewSlot id="tasks" active={currentView === "tasks"}><TasksView /></ViewSlot>
                  <ViewSlot id="approvals" active={currentView === "approvals"}><ApprovalsView /></ViewSlot>
                  <ViewSlot id="city" active={currentView === "city"}><CityView /></ViewSlot>
                </Suspense>
              </ErrorBoundary>
            </main>
          </div>
        </div>
        <CommandPalette isOpen={cmdPaletteOpen} onClose={() => setCmdPaletteOpen(false)} />
      </div>
      {showOnboarding && (
        <Onboarding
          onComplete={() => {
            localStorage.setItem("crystal_onboarded", "true");
            setShowOnboarding(false);
          }}
        />
      )}
    </ToastProvider>
  );
}

function FloatingOrb() {
  const setMinimized = useAppStore(s => s.setMinimized);
  const setVoiceState = useAppStore(s => s.setVoiceState);
  const voiceState = useAppStore(s => s.voiceState);
  return (
    <div className="h-screen w-screen" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
      <button
        onClick={() => voiceState === "idle" ? setVoiceState("listening") : setMinimized(false)}
        onDoubleClick={() => setMinimized(false)}
        style={{
          width: 64, height: 64, borderRadius: "50%",
          background: "linear-gradient(135deg, rgba(59,130,246,0.5), rgba(168,85,247,0.5))",
          border: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", transition: "transform 0.2s",
        }}
      >
        <LobsterIcon size={36} />
      </button>
    </div>
  );
}

export default App;
