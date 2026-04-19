import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { escapeShellArg, quotePowerShellSingleQuoted } from "@/lib/tools";
import { openclawClient } from "@/lib/openclaw";
import { useDataStore, invalidateCronJobsCliCache } from "@/stores/dataStore";
import { useAppStore, type CommandCenterTabId } from "@/stores/appStore";
import { BUILTIN_WORKFLOWS, CATEGORY_COLORS, loadCustomWorkflows, saveCustomWorkflows, type WorkflowDefinition, type WorkflowStep } from "@/lib/workflows";
import {
  Calendar as CalendarIcon, Workflow, Clock, Plus, Play, Trash2,
  RefreshCw, Loader2, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Copy,
  Shield, Save, Layers, Heart, HeartPulse,
  Sun, Mail, HardDrive, Activity, XCircle, X,
  History, Send, Zap, Stethoscope, ShieldAlert, Database,
} from "lucide-react";
import { EASE, SPRING, glowCard, hoverLift, hoverReset, pressDown, pressUp, innerPanel, sectionLabel, mutedCaption, inputStyle, btnPrimary, btnSecondary, headerRow, badge, emptyState, tab as tabStyle, tabBar, MONO } from "@/styles/viewStyles";

/* ── Shared Types ── */

interface CronJob {
  id: string;
  name?: string;
  schedule: string;
  message: string;
  agent: string;
  enabled: boolean;
  nextRun?: string;
  scheduleKind?: "cron" | "every" | "at" | "unknown";
  everyMs?: number;
  atIso?: string;
  deliveryChannel?: string;
  deliveryTarget?: string;
  duplicateGroupSize?: number;
  duplicateIndex?: number;
}

type WorkflowDef = WorkflowDefinition;
interface StepResult { stepId: string; output: string; success: boolean; }

type TabId = CommandCenterTabId;

/* ── Constants ── */

const TABS: { id: TabId; icon: React.ElementType; label: string }[] = [
  { id: "calendar", icon: CalendarIcon, label: "Calendar" },
  { id: "workflows", icon: Workflow, label: "Workflows" },
  { id: "scheduled", icon: Clock, label: "Scheduled" },
  { id: "heartbeat", icon: HeartPulse, label: "Heartbeat" },
];

const QUICK_TEMPLATES = [
  { icon: Sun, name: "Morning Briefing", schedule: "0 8 * * *", message: "Give me a morning briefing: today's date, weather outlook, top priorities, and any alerts.", color: "#fbbf24", desc: "Daily at 8 AM" },
  { icon: Shield, name: "Security Scan", schedule: "0 2 * * 0", message: "Run a full security audit on my system. Check for vulnerabilities, outdated packages, and suspicious activity.", color: "#f87171", desc: "Sundays at 2 AM" },
  { icon: HardDrive, name: "Disk Cleanup", schedule: "0 3 * * 6", message: "Check disk usage, identify large temporary files, and suggest cleanup actions.", color: "#3B82F6", desc: "Saturdays at 3 AM" },
  { icon: Mail, name: "Email Digest", schedule: "0 18 * * 1-5", message: "Summarize my emails and messages from today. Highlight action items and urgent matters.", color: "#a855f7", desc: "Weekdays at 6 PM" },
  { icon: Activity, name: "Health Check", schedule: "*/30 * * * *", message: "Check all services status: gateway, LLM, and system resources. Alert if anything is down.", color: "#06b6d4", desc: "Every 30 min" },
];


/* ── Helpers ── */

function parseCronJob(raw: Record<string, unknown>): CronJob {
  const sched = raw.schedule as Record<string, unknown> | string | undefined;
  let scheduleStr = "";
  let scheduleKind: CronJob["scheduleKind"] = "unknown";
  let everyMs: number | undefined;
  let atIso: string | undefined;

  if (typeof sched === "string") {
    scheduleStr = sched;
    scheduleKind = sched.trim().split(/\s+/).length === 5 ? "cron" : "unknown";
  } else if (sched && typeof sched === "object") {
    if (sched.cron || (sched.kind === "cron" && sched.expr)) {
      scheduleStr = String(sched.cron || sched.expr);
      scheduleKind = "cron";
    } else if (sched.kind === "every") {
      everyMs = Number(sched.everyMs || sched.intervalMs || sched.ms) || 0;
      scheduleStr = `every ${Math.round(everyMs / 60000)}m`;
      scheduleKind = "every";
    } else if (sched.kind === "at") {
      atIso = String(sched.atIso || sched.at || "");
      scheduleStr = `once at ${atIso}`;
      scheduleKind = "at";
    } else {
      scheduleStr = JSON.stringify(sched);
    }
  }
  const payload = raw.payload as Record<string, unknown> | undefined;
  const message = payload?.message ? String(payload.message) : String(raw.message || "");
  const state = raw.state as Record<string, unknown> | undefined;
  const nextRunMs = state?.nextRunAtMs ? Number(state.nextRunAtMs) : undefined;
  const delivery = raw.delivery as Record<string, unknown> | undefined;
  const idRaw = raw.id ?? raw.jobId;
  const id = typeof idRaw === "string" ? idRaw.trim() : String(idRaw ?? "").trim();
  return {
    id, name: raw.name ? String(raw.name) : undefined,
    schedule: scheduleStr, message, agent: String(raw.agentId || raw.agent || "main"),
    enabled: raw.enabled !== false,
    nextRun: nextRunMs ? new Date(nextRunMs).toLocaleString() : undefined,
    scheduleKind, everyMs, atIso,
    deliveryChannel: delivery?.channel ? String(delivery.channel) : undefined,
    deliveryTarget: delivery?.to ? String(delivery.to) : delivery?.threadId ? `thread:${delivery.threadId}` : undefined,
  };
}

function withDuplicateMetaScheduled(jobs: CronJob[]): CronJob[] {
  const key = (j: CronJob) =>
    `${(j.name ?? "").trim().toLowerCase()}|${j.schedule}|${j.message.trim()}`;
  const buckets = new Map<string, CronJob[]>();
  for (const j of jobs) {
    const k = key(j);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(j);
  }
  const counters = new Map<string, number>();
  return jobs.map(j => {
    const list = buckets.get(key(j))!;
    if (list.length < 2) return { ...j };
    const k = key(j);
    const next = (counters.get(k) ?? 0) + 1;
    counters.set(k, next);
    return { ...j, duplicateGroupSize: list.length, duplicateIndex: next };
  });
}

const THREAD_NAMES: Record<number, string> = {
  16: "Finance", 17: "Home", 38: "System", 89: "Neighborhood", 1195: "Factory",
};

function deliveryLabel(target: string): string {
  const m = target.match(/^thread:(\d+)$/);
  if (m) {
    const id = Number(m[1]);
    return THREAD_NAMES[id] ? `${THREAD_NAMES[id]} (#${id})` : target;
  }
  return target;
}

function cronToReadable(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hr, , , dow] = parts;
  if (expr.startsWith("*/")) return `Every ${parts[0].slice(2)} min`;
  const h = parseInt(hr), m = parseInt(min);
  const time = `${h > 12 ? h - 12 : h || 12}:${m.toString().padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
  if (dow === "*") return `Daily at ${time}`;
  if (dow === "1-5") return `Weekdays at ${time}`;
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (/^\d$/.test(dow)) return `${dayNames[parseInt(dow)]}s at ${time}`;
  return `${time} (${expr})`;
}

function getWeekDays(baseDate: Date): Date[] {
  const start = new Date(baseDate);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function cronFieldMatches(field: string, value: number): boolean {
  if (field === "*") return true;
  return field.split(",").some(part => {
    if (part.includes("-")) {
      const [lo, hi] = part.split("-").map(Number);
      return !isNaN(lo) && !isNaN(hi) && value >= lo && value <= hi;
    }
    if (part.startsWith("*/")) {
      const step = parseInt(part.slice(2));
      return !isNaN(step) && step > 0 && value % step === 0;
    }
    return parseInt(part) === value;
  });
}

function cronMatchesDay(expr: string, day: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [, , dom, mon, dow] = parts;
  const d = day.getDay(), dd = day.getDate(), mm = day.getMonth() + 1;
  if (!cronFieldMatches(mon, mm)) return false;
  if (!cronFieldMatches(dom, dd)) return false;
  if (!cronFieldMatches(dow, d)) return false;
  return true;
}

/* ══════════════════════════════════════════════════════════════
   COMMAND CENTER — Main Component
   ══════════════════════════════════════════════════════════════ */

export function CommandCenterView() {
  const pendingTab = useAppStore(s => s.pendingCommandCenterTab);
  const clearPendingCommandCenterTab = useAppStore(s => s.clearPendingCommandCenterTab);
  const [tab, setTab] = useState<TabId>(() => useAppStore.getState().pendingCommandCenterTab ?? "calendar");

  useLayoutEffect(() => {
    if (pendingTab) {
      setTab(pendingTab);
      clearPendingCommandCenterTab();
    }
  }, [pendingTab, clearPendingCommandCenterTab]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Tab Bar */}
      <div style={{ ...tabBar, padding: "10px 20px 0", borderBottom: "1px solid var(--border)", flexShrink: 0, borderRadius: 0, border: "none", background: "transparent" }}>
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              ...tabStyle(active),
              display: "flex", alignItems: "center", gap: 6,
              borderRadius: "8px 8px 0 0",
              borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
              color: active ? "var(--accent)" : "var(--text-muted)",
            }}>
              <Icon style={{ width: 14, height: 14 }} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {tab === "calendar" && <CalendarTab />}
        {tab === "workflows" && <WorkflowsTab />}
        {tab === "scheduled" && <ScheduledTab />}
        {tab === "heartbeat" && <HeartbeatTab />}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes thinking-dot { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes indeterminate-bar { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }
      `}</style>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB 1 — Calendar
   ══════════════════════════════════════════════════════════════ */

function CalendarTab() {
  const [selectedDay, setSelectedDay] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d;
  });
  const [jobs, setJobs] = useState<CronJob[]>(() => {
    const cached = useDataStore.getState().cronJobs?.data;
    return Array.isArray(cached) ? withDuplicateMetaScheduled(cached.map(parseCronJob)) : [];
  });
  const [loading, setLoading] = useState(() => !useDataStore.getState().cronJobs?.data);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSchedule, setNewSchedule] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const getCronJobs = useDataStore(s => s.getCronJobs);

  const loadJobs = useCallback(async (force = false) => {
    try {
      const raw = await getCronJobs(force);
      setJobs(withDuplicateMetaScheduled(raw.map(parseCronJob)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load jobs");
    }
    setLoading(false);
  }, [getCronJobs]);

  useEffect(() => {
    loadJobs();
    const interval = setInterval(() => loadJobs(true), 30_000);
    return () => clearInterval(interval);
  }, [loadJobs]);

  const days = getWeekDays(weekStart);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const nowHour = new Date().getHours();

  const prevWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d); setSelectedDay(d); };
  const nextWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d); setSelectedDay(d); };
  const goToday = () => {
    const d = new Date(); d.setHours(0, 0, 0, 0); setSelectedDay(d);
    const ws = new Date(d); ws.setDate(ws.getDate() - ws.getDay()); setWeekStart(ws);
  };

  const jobMatchesDay = (job: CronJob, day: Date): boolean => {
    if (!job.enabled) return false;
    if (job.scheduleKind === "cron") return cronMatchesDay(job.schedule, day);
    if (job.scheduleKind === "every") return true;
    if (job.scheduleKind === "at" && job.atIso) {
      try {
        const atDate = new Date(job.atIso);
        return atDate.getFullYear() === day.getFullYear()
          && atDate.getMonth() === day.getMonth()
          && atDate.getDate() === day.getDate();
      } catch { return false; }
    }
    return cronMatchesDay(job.schedule, day);
  };

  const getJobsForDay = (day: Date) => jobs.filter(j => jobMatchesDay(j, day));

  const getJobHours = (job: CronJob): number[] => {
    if (job.scheduleKind === "every" && job.everyMs) {
      const intervalHours = job.everyMs / 3_600_000;
      if (intervalHours >= 1) {
        const hours: number[] = [];
        for (let h = 0; h < 24; h += intervalHours) hours.push(Math.floor(h));
        return hours.length > 0 ? hours : [0];
      }
      return Array.from({ length: 24 }, (_, i) => i);
    }
    if (job.scheduleKind === "at" && job.atIso) {
      try { return [new Date(job.atIso).getHours()]; } catch { return []; }
    }
    const parts = job.schedule.trim().split(/\s+/);
    if (parts.length < 2) return [];
    const hourField = parts[1];
    const hours: number[] = [];
    for (let h = 0; h < 24; h++) {
      if (cronFieldMatches(hourField, h)) hours.push(h);
    }
    return hours;
  };

  const addJobFromCalendar = async () => {
    if (!newSchedule.trim() || !newMessage.trim()) return;
    setAdding(true);
    try {
      const escaped = escapeShellArg(newMessage);
      const escapedSched = escapeShellArg(newSchedule);
      const namePart = newName.trim() ? ` --name "${escapeShellArg(newName)}"` : "";
      await invoke("execute_command", {
        command: `openclaw cron add --cron "${escapedSched}" --message "${escaped}" --agent main${namePart}`,
        cwd: null,
      });
      setNewSchedule(""); setNewMessage(""); setNewName(""); setShowAddModal(false);
      invalidateCronJobsCliCache();
      await loadJobs(true);
    } catch { /* ignore */ }
    setAdding(false);
  };

  const selectedDayJobs = getJobsForDay(selectedDay);
  const isToday = selectedDay.getTime() === today.getTime();

  const hourGroups = new Map<number, CronJob[]>();
  for (const job of selectedDayJobs) {
    for (const h of getJobHours(job)) {
      if (!hourGroups.has(h)) hourGroups.set(h, []);
      const group = hourGroups.get(h)!;
      if (!group.some(existing => existing.id === job.id)) group.push(job);
    }
  }

  const hourCounts = Array.from({ length: 24 }, (_, h) => hourGroups.get(h)?.length ?? 0);
  const maxHourCount = Math.max(...hourCounts, 1);

  const JOB_COLORS: Record<string, string> = {
    heartbeat: "#a855f7", security: "#f87171", briefing: "#fbbf24", cleanup: "#3b82f6",
    health: "#06b6d4", email: "#a855f7", digest: "#ec4899", backup: "#10b981",
  };
  const jobColor = (j: CronJob) => {
    const n = (j.name || j.message).toLowerCase();
    for (const [key, color] of Object.entries(JOB_COLORS)) { if (n.includes(key)) return color; }
    return "var(--accent)";
  };

  const weekLabel = `${days[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} — ${days[6].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  const fmtHour = (h: number) => `${h > 12 ? h - 12 : h || 12}:00 ${h >= 12 ? "PM" : "AM"}`;

  const activeHours = Array.from(hourGroups.keys()).sort((a, b) => a - b);
  const enabledCount = jobs.filter(j => j.enabled).length;
  const disabledCount = jobs.length - enabledCount;
  const everyJobs = jobs.filter(j => j.scheduleKind === "every").length;
  const dailyJobs = jobs.filter(j => j.scheduleKind === "cron" && j.schedule.match(/^\d+ \d+ \* \* \*/)).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button aria-label="Previous week" onClick={prevWeek} style={navBtnStyle}><ChevronLeft style={{ width: 14, height: 14 }} /></button>
          <button onClick={goToday} style={{ ...navBtnStyle, padding: "4px 12px", fontSize: 11 }}>Today</button>
          <button aria-label="Next week" onClick={nextWeek} style={navBtnStyle}><ChevronRight style={{ width: 14, height: 14 }} /></button>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginLeft: 8 }}>{weekLabel}</span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
            {enabledCount} active{disabledCount > 0 ? ` · ${disabledCount} paused` : ""}
          </span>
          <button aria-label="Refresh" onClick={() => loadJobs(true)} disabled={loading} style={navBtnStyle}>
            <RefreshCw style={{ width: 12, height: 12, ...(loading ? { animation: "spin 1s linear infinite" } : {}) }} />
          </button>
          <button onClick={() => { setNewSchedule("0 8 * * *"); setShowAddModal(true); }}
            style={{ ...navBtnStyle, background: "var(--accent-bg)", color: "var(--accent)", padding: "4px 10px", gap: 4, display: "flex", alignItems: "center" }}>
            <Plus style={{ width: 12, height: 12 }} /> Add Job
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "0 20px 20px" }}>
        {error && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", marginBottom: 12 }}>
            <AlertTriangle style={{ width: 14, height: 14, color: "#f87171" }} />
            <span style={{ fontSize: 11, color: "#f87171", flex: 1 }}>{error}</span>
            <button aria-label="Close" onClick={() => setError(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 14, cursor: "pointer" }}>×</button>
          </div>
        )}

        {/* Day Picker Row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginBottom: 16 }}>
          {days.map((day, i) => {
            const isSel = day.getTime() === selectedDay.getTime();
            const isTd = day.getTime() === today.getTime();
            const count = getJobsForDay(day).length;
            return (
              <button key={i} onClick={() => setSelectedDay(day)}
                style={{
                  padding: "10px 6px", borderRadius: 10, border: isSel ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: isSel ? "var(--accent-bg)" : "var(--bg-elevated)", cursor: "pointer",
                  display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 4,
                  transition: `all 0.18s ${EASE}`, position: "relative" as const,
                }}
                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = "var(--bg-elevated)"; e.currentTarget.style.transform = "none"; }}>
                <span style={{ fontSize: 9, color: isSel ? "var(--accent)" : "var(--text-muted)", textTransform: "uppercase" as const, letterSpacing: 0.5, fontWeight: 600 }}>{DAY_NAMES[i]}</span>
                <span style={{
                  fontSize: 18, fontWeight: 700, lineHeight: 1,
                  color: isSel ? "var(--accent)" : isTd ? "var(--text)" : "var(--text-secondary)",
                  ...(isTd && !isSel ? { width: 28, height: 28, borderRadius: "50%", border: "2px solid var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 } : {}),
                }}>
                  {day.getDate()}
                </span>
                {count > 0 && (
                  <span style={{
                    fontSize: 9, fontWeight: 600, color: isSel ? "var(--accent)" : "var(--text-muted)",
                    fontFamily: MONO,
                  }}>
                    {count} job{count !== 1 ? "s" : ""}
                  </span>
                )}
                {count === 0 && <span style={{ fontSize: 9, color: "var(--text-muted)", opacity: 0.4 }}>—</span>}
              </button>
            );
          })}
        </div>

        {/* 24-Hour Activity Heatmap */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={sectionLabel}>24-Hour Activity</span>
            <span style={{ fontSize: 9, color: "var(--text-muted)" }}>
              {selectedDayJobs.length} job{selectedDayJobs.length !== 1 ? "s" : ""} on {selectedDay.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
            </span>
          </div>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 2, borderRadius: 8,
            overflow: "hidden", background: "var(--bg-elevated)", border: "1px solid var(--border)", padding: 3,
          }}>
            {hourCounts.map((count, h) => {
              const intensity = maxHourCount > 0 ? count / maxHourCount : 0;
              const isNow = isToday && h === nowHour;
              return (
                <div key={h} title={`${fmtHour(h)}: ${count} job${count !== 1 ? "s" : ""}`}
                  style={{
                    height: 32, borderRadius: 4, position: "relative" as const, cursor: "default",
                    background: count === 0
                      ? "var(--bg-surface)"
                      : `rgba(59, 130, 246, ${0.12 + intensity * 0.55})`,
                    border: isNow ? "2px solid var(--accent)" : "1px solid transparent",
                    boxShadow: isNow ? "0 0 8px rgba(59,130,246,0.4)" : count > 0 ? `0 0 ${intensity * 6}px rgba(59,130,246,${intensity * 0.3})` : "none",
                    transition: `all 0.2s ${EASE}`,
                    display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center",
                  }}>
                  <span style={{ fontSize: 7, color: count > 0 ? "#fff" : "var(--text-muted)", fontWeight: 600, opacity: count > 0 ? 1 : 0.5 }}>
                    {h > 12 ? h - 12 : h || 12}{h >= 12 ? "p" : "a"}
                  </span>
                  {count > 0 && (
                    <span style={{ fontSize: 8, fontWeight: 700, color: "#fff", lineHeight: 1 }}>{count}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Stats bar */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {[
            { label: "Total Jobs", value: jobs.length, color: "var(--accent)" },
            { label: "Fires Today", value: selectedDayJobs.length, color: "#4ade80" },
            { label: "Active Hours", value: activeHours.length, color: "#fbbf24" },
            { label: "Recurring", value: everyJobs, color: "#a855f7" },
            { label: "Daily", value: dailyJobs, color: "#06b6d4" },
          ].map(s => (
            <div key={s.label} style={{
              flex: "1 1 80px", padding: "8px 12px", borderRadius: 8,
              background: "var(--bg-elevated)", border: "1px solid var(--border)",
              display: "flex", alignItems: "center", gap: 8, minWidth: 80,
            }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: s.color, fontFamily: MONO }}>{s.value}</span>
              <span style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase" as const, letterSpacing: 0.3 }}>{s.label}</span>
            </div>
          ))}
        </div>

        {/* Agenda: jobs grouped by hour */}
        <div style={{ ...sectionLabel, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
          <span>Agenda</span>
          {isToday && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "var(--accent-bg)", color: "var(--accent)", fontWeight: 600 }}>TODAY</span>}
        </div>

        {activeHours.length === 0 ? (
          <div style={{ ...innerPanel, textAlign: "center" as const, padding: "30px 20px", borderRadius: 12 }}>
            <CalendarIcon style={{ width: 28, height: 28, color: "var(--text-muted)", opacity: 0.3, margin: "0 auto 8px" }} />
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>No jobs scheduled for this day</p>
            <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "4px 0 0", opacity: 0.6 }}>Select a different day or add a new job</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {activeHours.map(hour => {
              const jobsAtHour = hourGroups.get(hour) || [];
              const isPast = isToday && hour < nowHour;
              const isCurrent = isToday && hour === nowHour;
              return (
                <div key={hour} style={{ display: "flex", gap: 0, position: "relative" as const }}>
                  {/* Time gutter */}
                  <div style={{
                    width: 64, flexShrink: 0, padding: "10px 8px 10px 0", textAlign: "right" as const,
                    display: "flex", flexDirection: "column" as const, alignItems: "flex-end", gap: 2,
                  }}>
                    <span style={{
                      fontSize: 12, fontWeight: 600, fontFamily: MONO,
                      color: isCurrent ? "var(--accent)" : isPast ? "var(--text-muted)" : "var(--text-secondary)",
                    }}>
                      {fmtHour(hour)}
                    </span>
                    {isCurrent && (
                      <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 4, background: "var(--accent)", color: "#fff", fontWeight: 600 }}>NOW</span>
                    )}
                  </div>

                  {/* Timeline connector */}
                  <div style={{
                    width: 20, flexShrink: 0, display: "flex", flexDirection: "column" as const, alignItems: "center",
                    position: "relative" as const,
                  }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: "50%", flexShrink: 0, marginTop: 12,
                      background: isCurrent ? "var(--accent)" : isPast ? "var(--text-muted)" : "var(--border)",
                      boxShadow: isCurrent ? "0 0 8px var(--accent)" : "none",
                      border: `2px solid ${isCurrent ? "var(--accent)" : "var(--bg)"}`,
                      zIndex: 1,
                    }} />
                    <div style={{
                      width: 2, flex: 1, background: "var(--border)",
                      opacity: isPast ? 0.3 : 0.6,
                    }} />
                  </div>

                  {/* Job cards */}
                  <div style={{ flex: 1, padding: "6px 0 6px 8px", display: "flex", flexDirection: "column" as const, gap: 4 }}>
                    {jobsAtHour.map(job => {
                      const color = jobColor(job);
                      const isHb = job.name?.toLowerCase().includes("heartbeat") ?? false;
                      const isExpanded = expandedJobId === job.id;
                      return (
                        <div key={job.id}
                          onClick={() => setExpandedJobId(isExpanded ? null : job.id)}
                          style={{
                            padding: "8px 12px", borderRadius: 8, cursor: "pointer",
                            background: `color-mix(in srgb, ${color} 8%, transparent)`,
                            border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
                            opacity: isPast ? 0.6 : 1,
                            transition: `all 0.18s ${EASE}`,
                          }}
                          onMouseEnter={e => { e.currentTarget.style.transform = "translateX(4px)"; e.currentTarget.style.borderColor = `color-mix(in srgb, ${color} 40%, transparent)`; }}
                          onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.borderColor = `color-mix(in srgb, ${color} 20%, transparent)`; }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{
                              width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                              background: color,
                              boxShadow: `0 0 6px ${color}`,
                            }} />
                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                              {isHb ? "💜 " : ""}{job.name || "Unnamed Job"}
                            </span>
                            <span style={{ ...badge(color), fontFamily: MONO, fontSize: 9 }}>{job.schedule}</span>
                            <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{cronToReadable(job.schedule)}</span>
                            {isExpanded
                              ? <ChevronUp style={{ width: 12, height: 12, color: "var(--text-muted)", flexShrink: 0 }} />
                              : <ChevronDown style={{ width: 12, height: 12, color: "var(--text-muted)", flexShrink: 0 }} />
                            }
                          </div>
                          {isExpanded && (
                            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid color-mix(in srgb, ${color} 15%, transparent)` }}>
                              <p style={{ margin: "0 0 6px", fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5 }}>{job.message}</p>
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const, fontSize: 9 }}>
                                <span style={{ color: "var(--text-muted)" }}>Agent: <strong style={{ color: "var(--text)" }}>{job.agent}</strong></span>
                                {job.nextRun && <span style={{ color: "var(--text-muted)" }}>Next: <strong style={{ color: "var(--text)" }}>{job.nextRun}</strong></span>}
                                {job.deliveryChannel && (
                                  <span style={{ ...badge("var(--accent)"), fontSize: 9 }}>
                                    → {job.deliveryChannel}{job.deliveryTarget ? ` · ${deliveryLabel(job.deliveryTarget)}` : ""}
                                  </span>
                                )}
                                {!job.enabled && <span style={{ ...badge("#f87171"), fontSize: 9 }}>PAUSED</span>}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Frequency breakdown */}
        {jobs.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <span style={{ ...sectionLabel, display: "block", marginBottom: 8 }}>By Frequency</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
              {Object.entries(
                jobs.reduce<Record<string, number>>((acc, j) => {
                  const label = cronToReadable(j.schedule);
                  acc[label] = (acc[label] || 0) + 1;
                  return acc;
                }, {})
              ).sort((a, b) => b[1] - a[1]).map(([freq, count]) => (
                <div key={freq} style={{
                  padding: "6px 10px", borderRadius: 6, background: "var(--bg-elevated)",
                  border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 6,
                }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)", fontFamily: MONO }}>{count}</span>
                  <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>{freq}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Add Job Modal */}
      {showAddModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
        }} onClick={() => setShowAddModal(false)}>
          <div style={{
            ...glowCard("var(--accent)", { padding: 24, width: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }),
          }} onClick={e => e.stopPropagation()}>
            <div style={{ ...headerRow, marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 15, color: "var(--text)", fontWeight: 600 }}>Schedule Job</h3>
              <button aria-label="Close" onClick={() => setShowAddModal(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", transition: `color 0.2s ${EASE}` }}>
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Name (optional)</label>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Morning Briefing"
                style={inputStyle} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Cron Schedule</label>
              <input value={newSchedule} onChange={e => setNewSchedule(e.target.value)} placeholder="0 8 * * *"
                style={{ ...inputStyle, fontFamily: MONO }} />
              <span style={{ ...mutedCaption, marginTop: 4, display: "block" }}>
                {cronToReadable(newSchedule)}
              </span>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Task / Prompt</label>
              <textarea value={newMessage} onChange={e => setNewMessage(e.target.value)} placeholder="What should the agent do?"
                rows={3} style={{ ...inputStyle, resize: "vertical", minHeight: 60, fontFamily: "inherit" }} />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowAddModal(false)} style={btnSecondary}>Cancel</button>
              <button onClick={addJobFromCalendar} disabled={adding || !newSchedule.trim() || !newMessage.trim()}
                style={{ ...btnPrimary, opacity: adding || !newSchedule.trim() || !newMessage.trim() ? 0.5 : 1, display: "flex", alignItems: "center", gap: 6 }}>
                {adding && <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />}
                <CalendarIcon style={{ width: 12, height: 12 }} /> Schedule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB 2 — Workflows
   ══════════════════════════════════════════════════════════════ */

function safeParse(stdout: string) {
  const start = stdout.indexOf("{");
  if (start === -1) return null;
  try { return JSON.parse(stdout.slice(start)); } catch { return null; }
}

function WorkflowsTab() {
  const setView = useAppStore(s => s.setView);
  const [customWorkflows, setCustomWorkflows] = useState<WorkflowDef[]>(() => loadCustomWorkflows());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [stepResults, setStepResults] = useState<StepResult[]>([]);
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());
  const [userInput, setUserInput] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState<WorkflowDef | null>(null);
  const [scheduleCron, setScheduleCron] = useState("0 8 * * *");
  const [scheduling, setScheduling] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  const [qaRunning, setQaRunning] = useState<string | null>(null);
  const [qaResult, setQaResult] = useState<string | null>(null);

  const runQa = async (id: string, fn: () => Promise<string>) => {
    setQaRunning(id); setQaResult(null);
    try { setQaResult(await fn()); } catch (e) { setQaResult(`Error: ${e instanceof Error ? e.message : "Unknown"}`); } finally { setQaRunning(null); }
  };

  const quickActions: { id: string; icon: React.ElementType; label: string; desc: string; color: string; action: () => void }[] = [
    {
      id: "briefing", icon: Sun, label: "Morning Briefing", desc: "Get today's summary", color: "#fbbf24",
      action: () => runQa("briefing", async () => {
        const r = await invoke<{ stdout: string }>("execute_command", {
          command: 'openclaw agent --agent main --message "Give me a morning briefing: today\'s date, top priorities, and any alerts." --json', cwd: null,
        });
        return safeParse(r.stdout)?.response ?? r.stdout;
      }),
    },
    {
      id: "heartbeat", icon: Zap, label: "Heartbeat", desc: "Trigger heartbeat", color: "#a855f7",
      action: () => runQa("heartbeat", async () => {
        if (!openclawClient.isGatewayConnected()) return "Gateway not connected";
        const r = await openclawClient.triggerHeartbeat();
        return JSON.stringify(r.payload, null, 2);
      }),
    },
    {
      id: "security", icon: ShieldAlert, label: "Security Scan", desc: "Run full audit", color: "#f87171",
      action: () => setView("security"),
    },
    {
      id: "doctor", icon: Stethoscope, label: "Health Check", desc: "Diagnose issues", color: "#4ade80",
      action: () => setView("doctor"),
    },
    {
      id: "backup", icon: Database, label: "Backup", desc: "Create state backup", color: "#06b6d4",
      action: () => runQa("backup", async () => {
        const r = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
          command: "openclaw backup create", cwd: null,
        });
        return r.stdout?.trim() || r.stderr?.trim() || "Backup complete";
      }),
    },
    {
      id: "update", icon: RefreshCw, label: "Check Updates", desc: "Check for new version", color: "#8b5cf6",
      action: () => runQa("update", async () => {
        const r = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
          command: "openclaw update status", cwd: null,
        });
        return r.stdout?.trim() || r.stderr?.trim() || "Up to date";
      }),
    },
  ];

  const [newName, setNewName] = useState(""); const [newDesc, setNewDesc] = useState("");
  const [newCategory, setNewCategory] = useState<WorkflowDef["category"]>("Productivity");
  const [newSteps, setNewSteps] = useState<{ message: string; parallel?: boolean }[]>([{ message: "" }]);
  const [newNeedsInput, setNewNeedsInput] = useState(false);
  const [newInputLabel, setNewInputLabel] = useState("");

  const allWorkflows = [...BUILTIN_WORKFLOWS, ...customWorkflows];
  const selected = allWorkflows.find(w => w.id === selectedId) ?? null;

  const pickAgent = (msg: string): string => {
    const lower = msg.toLowerCase();
    if (lower.includes("security") || lower.includes("audit") || lower.includes("vulnerabilit"))
      return "main";
    if (lower.includes("code") || lower.includes("project") || lower.includes("codebase") || lower.includes("review"))
      return "main";
    return "main";
  };

  const executeStep = async (step: WorkflowStep, msg: string): Promise<StepResult> => {
    const agentId = pickAgent(msg);
    try {
      const result = await openclawClient.dispatchToAgent(agentId, msg);
      const output = result.stdout?.trim() || result.stderr?.trim() || "(no output)";
      return { stepId: step.id, output, success: result.code === 0 };
    } catch (e) {
      return { stepId: step.id, output: String(e), success: false };
    }
  };

  const runWorkflow = async (wf: WorkflowDef) => {
    if (wf.needsInput && !userInput.trim()) return;
    setRunningId(wf.id); setSelectedId(wf.id); setCurrentStep(0); setStepResults([]);
    setExpandedResults(new Set(wf.steps.map(s => s.id)));
    const collected: StepResult[] = [];

    const groups: { steps: { step: WorkflowStep; idx: number }[]; parallel: boolean }[] = [];
    for (let i = 0; i < wf.steps.length; i++) {
      const step = wf.steps[i];
      if (step.parallel && groups.length > 0 && groups[groups.length - 1].parallel) {
        groups[groups.length - 1].steps.push({ step, idx: i });
      } else {
        groups.push({ steps: [{ step, idx: i }], parallel: !!step.parallel });
      }
    }

    for (const group of groups) {
      setCurrentStep(group.steps[0].idx);

      if (group.parallel && group.steps.length > 1) {
        const promises = group.steps.map(({ step }) => {
          const msg = step.message.replace(/\{\{INPUT\}\}/g, userInput.trim());
          return executeStep(step, msg);
        });
        const results = await Promise.all(promises);
        for (const sr of results) {
          collected.push(sr);
          setStepResults(prev => [...prev, sr]);
        }
        setCurrentStep(group.steps[group.steps.length - 1].idx);
      } else {
        for (const { step, idx } of group.steps) {
          setCurrentStep(idx);
          let msg = step.message.replace(/\{\{INPUT\}\}/g, userInput.trim());
          if (collected.length > 0) {
            const ctx = collected.map((r, ci) => `[Step ${ci + 1} result]: ${r.output}`).join("\n\n");
            msg = `Context from previous steps:\n${ctx}\n\nNow do: ${msg}`;
          }
          const sr = await executeStep(step, msg);
          collected.push(sr);
          setStepResults(prev => [...prev, sr]);
        }
      }

      setTimeout(() => { resultsRef.current?.scrollTo({ top: resultsRef.current.scrollHeight, behavior: "smooth" }); }, 100);
    }

    setCurrentStep(wf.steps.length); setRunningId(null);
  };

  const scheduleWorkflow = async (wf: WorkflowDef) => {
    setScheduling(true);
    const allSteps = wf.steps.map((s, i) => `Step ${i + 1}: ${s.message}`).join(". ");
    const prompt = `Run this multi-step workflow called "${wf.name}": ${allSteps}. Execute each step in order and provide results.`;
    try {
      const escaped = escapeShellArg(prompt);
      const escapedSched = escapeShellArg(scheduleCron);
      const escapedName = escapeShellArg(`Workflow: ${wf.name}`);
      await invoke("execute_command", {
        command: `openclaw cron add --cron "${escapedSched}" --message "${escaped}" --agent main --name "${escapedName}"`,
        cwd: null,
      });
    } catch { /* ignore */ }
    setScheduling(false); setShowScheduleModal(null);
  };

  const saveWorkflow = () => {
    const validSteps = newSteps.filter(s => s.message.trim());
    if (!newName.trim() || validSteps.length === 0) return;
    const wf: WorkflowDef = {
      id: `custom-${Date.now()}`, name: newName.trim(), description: newDesc.trim() || "Custom workflow",
      icon: "⚡", category: newCategory, estimatedTime: `~${validSteps.length} min`, isBuiltIn: false,
      needsInput: newNeedsInput, inputLabel: newInputLabel.trim() || "Input",
      steps: validSteps.map((s, i) => ({ id: `step-${i}`, message: s.message.trim(), ...(s.parallel ? { parallel: true } : {}) })),
    };
    const updated = [...customWorkflows, wf];
    setCustomWorkflows(updated); saveCustomWorkflows(updated);
    setNewName(""); setNewDesc(""); setNewSteps([{ message: "" }]); setNewNeedsInput(false); setNewInputLabel("");
    setShowCreate(false); setSelectedId(wf.id);
  };

  const deleteWorkflow = (id: string) => {
    const updated = customWorkflows.filter(w => w.id !== id);
    setCustomWorkflows(updated); saveCustomWorkflows(updated);
    if (selectedId === id) setSelectedId(null);
  };

  const grouped = { Productivity: allWorkflows.filter(w => w.category === "Productivity"), Development: allWorkflows.filter(w => w.category === "Development"), System: allWorkflows.filter(w => w.category === "System") };

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Sidebar */}
      <div style={{ width: 260, flexShrink: 0, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "12px 14px 8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
            {BUILTIN_WORKFLOWS.length + customWorkflows.length} workflows
          </span>
          <button aria-label="New workflow" onClick={() => setShowCreate(!showCreate)} style={{ background: "var(--accent-bg)", border: "none", borderRadius: 6, padding: "4px 6px", cursor: "pointer", color: "var(--accent)", display: "flex", alignItems: "center" }}>
            <Plus style={{ width: 12, height: 12 }} />
          </button>
        </div>

        {showCreate && (
          <div style={{ ...innerPanel, margin: "0 8px 8px", padding: 10 }}>
            <input placeholder="Workflow name" value={newName} onChange={e => setNewName(e.target.value)} style={{ ...inputStyle, marginBottom: 6 }} />
            <input placeholder="Description" value={newDesc} onChange={e => setNewDesc(e.target.value)} style={{ ...inputStyle, marginBottom: 6 }} />
            <select value={newCategory} onChange={e => setNewCategory(e.target.value as WorkflowDef["category"])} style={{ ...inputStyle, marginBottom: 6 }}>
              <option value="Productivity">Productivity</option>
              <option value="Development">Development</option>
              <option value="System">System</option>
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "var(--text-secondary)", marginBottom: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={newNeedsInput} onChange={e => setNewNeedsInput(e.target.checked)} />
              Requires input ({"{{INPUT}}"})
            </label>
            {newNeedsInput && <input placeholder="Input label" value={newInputLabel} onChange={e => setNewInputLabel(e.target.value)} style={{ ...inputStyle, marginBottom: 6 }} />}
            {newSteps.map((s, i) => (
              <div key={i} style={{ display: "flex", gap: 4, marginBottom: 4, alignItems: "center" }}>
                <span style={{ width: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "var(--text-muted)" }}>{i + 1}</span>
                <input placeholder={`Step ${i + 1}...`} value={s.message} onChange={e => { const u = [...newSteps]; u[i] = { ...u[i], message: e.target.value }; setNewSteps(u); }} style={{ ...inputStyle, flex: 1, fontSize: 10, padding: "4px 6px" }} />
                <button aria-label="Toggle parallel step" onClick={() => { const u = [...newSteps]; u[i] = { ...u[i], parallel: !u[i].parallel }; setNewSteps(u); }}
                  title={s.parallel ? "Parallel (runs with other parallel steps)" : "Sequential (waits for previous steps)"}
                  style={{ ...iconBtnStyle, background: s.parallel ? "rgba(139,92,246,0.15)" : undefined, color: s.parallel ? "#8b5cf6" : undefined }}>
                  <Layers style={{ width: 9, height: 9 }} />
                </button>
                {newSteps.length > 1 && <button aria-label="Remove step" onClick={() => setNewSteps(newSteps.filter((_, j) => j !== i))} style={iconBtnStyle}><Trash2 style={{ width: 9, height: 9 }} /></button>}
              </div>
            ))}
            <button onClick={() => setNewSteps([...newSteps, { message: "", parallel: false }])} style={{ width: "100%", padding: "3px 0", borderRadius: 6, border: "1px dashed var(--border)", background: "transparent", color: "var(--text-muted)", fontSize: 9, cursor: "pointer", marginBottom: 8 }}>+ Add Step</button>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={saveWorkflow} style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: "none", fontSize: 10, cursor: "pointer", background: "rgba(74,222,128,0.15)", color: "#4ade80", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}><Save style={{ width: 10, height: 10 }} /> Save</button>
              <button onClick={() => setShowCreate(false)} style={{ padding: "5px 10px", borderRadius: 6, border: "none", fontSize: 10, cursor: "pointer", background: "var(--bg-hover)", color: "var(--text-muted)" }}>Cancel</button>
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>
          {(Object.entries(grouped) as [string, WorkflowDef[]][]).map(([cat, wfs]) => wfs.length > 0 && (
            <div key={cat}>
              <p style={{ fontSize: 9, textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: 1, padding: "8px 8px 3px", fontWeight: 600, margin: 0 }}>
                <span style={{ color: CATEGORY_COLORS[cat] }}>●</span> {cat}
              </p>
              {wfs.map(wf => (
                <button key={wf.id} onClick={() => { setSelectedId(wf.id); setStepResults([]); setUserInput(""); }}
                  style={{
                    width: "100%", textAlign: "left", padding: "6px 10px", borderRadius: 6, border: "none", cursor: "pointer", marginBottom: 1,
                    display: "flex", alignItems: "center", gap: 8,
                    background: selectedId === wf.id ? "var(--accent-bg)" : "transparent",
                    transition: `all 0.2s ${EASE}`,
                  }}>
                  <span style={{ fontSize: 14 }}>{wf.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 11, color: "var(--text)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{wf.name}</span>
                    <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{wf.steps.length} steps{wf.steps.some(s => s.parallel) ? " · parallel" : ""}</span>
                  </div>
                  {runningId === wf.id && <Loader2 style={{ width: 11, height: 11, color: "var(--accent)", animation: "spin 1s linear infinite" }} />}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Detail */}
      <div style={{ flex: 1, overflow: "auto", padding: "14px 20px 20px" }} ref={resultsRef}>
        {selected ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: `${CATEGORY_COLORS[selected.category]}15`, border: `1px solid ${CATEGORY_COLORS[selected.category]}25`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{selected.icon}</div>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, fontSize: 15, color: "var(--text)", fontWeight: 600 }}>{selected.name}</h3>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: `${CATEGORY_COLORS[selected.category]}18`, color: CATEGORY_COLORS[selected.category], fontWeight: 500 }}>{selected.category}</span>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{selected.steps.length} steps · {selected.estimatedTime}</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => { setScheduleCron("0 8 * * *"); setShowScheduleModal(selected); }}
                  style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", fontSize: 11 }}>
                  <Clock style={{ width: 12, height: 12 }} /> Schedule
                </button>
                {!selected.isBuiltIn && <button aria-label="Delete workflow" onClick={() => deleteWorkflow(selected.id)} style={{ padding: "6px 10px", borderRadius: 8, border: "none", background: "rgba(248,113,113,0.15)", color: "#f87171", cursor: "pointer", display: "flex", alignItems: "center" }}><Trash2 style={{ width: 12, height: 12 }} /></button>}
              </div>
            </div>

            <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 14px" }}>{selected.description}</p>

            {selected.needsInput && (
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>{selected.inputLabel || "Input"}</label>
                <textarea value={userInput} onChange={e => setUserInput(e.target.value)} placeholder={selected.inputPlaceholder || "Enter input..."}
                  rows={3} style={{ ...inputStyle, resize: "vertical", minHeight: 50, maxHeight: 180, fontFamily: "inherit" }} />
              </div>
            )}

            <button onClick={() => runWorkflow(selected)} disabled={runningId !== null || (selected.needsInput && !userInput.trim())}
              style={{ ...btnPrimary, display: "flex", alignItems: "center", gap: 6, cursor: runningId ? "not-allowed" : "pointer", background: runningId ? "var(--bg-hover)" : "var(--accent)", opacity: runningId || (selected.needsInput && !userInput.trim()) ? 0.5 : 1, marginBottom: 14 }}>
              {runningId === selected.id ? <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} /> : <Play style={{ width: 14, height: 14 }} />}
              {runningId === selected.id ? "Running..." : "Run Workflow"}
            </button>

            {runningId === selected.id && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Step {Math.min(currentStep + 1, selected.steps.length)} of {selected.steps.length}</span>
                  <span style={{ fontSize: 10, color: "var(--accent)" }}>{Math.round((currentStep / selected.steps.length) * 100)}%</span>
                </div>
                <div style={{ height: 4, borderRadius: 2, background: "var(--bg-hover)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(currentStep / selected.steps.length) * 100}%`, background: "var(--accent)", borderRadius: 2, transition: "width 0.3s" }} />
                </div>
              </div>
            )}

            {selected.steps.map((step, i) => {
              const result = stepResults.find(r => r.stepId === step.id);
              const nextIsParallel = i + 1 < selected.steps.length && selected.steps[i + 1].parallel;
              const prevIsParallel = i > 0 && selected.steps[i - 1].parallel;
              const isParallelGroup = step.parallel;
              const isFirstInGroup = isParallelGroup && !prevIsParallel;
              const isRunning = runningId === selected.id && currentStep === i;
              const isParallelRunning = isParallelGroup && runningId === selected.id && currentStep <= i && !result;
              const isDone = result !== undefined;
              const isExpanded = expandedResults.has(step.id);
              return (
                <div key={step.id}>
                  {isFirstInGroup && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 12px 2px", marginTop: i > 0 ? 6 : 0 }}>
                      <Layers style={{ width: 10, height: 10, color: "#8b5cf6" }} />
                      <span style={{ fontSize: 9, color: "#8b5cf6", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Parallel</span>
                      <div style={{ flex: 1, height: 1, background: "rgba(139,92,246,0.2)" }} />
                    </div>
                  )}
                  <div style={{ marginBottom: isParallelGroup && nextIsParallel ? 2 : 6, marginLeft: isParallelGroup ? 12 : 0, borderLeft: isParallelGroup ? "2px solid rgba(139,92,246,0.2)" : "none", paddingLeft: isParallelGroup ? 8 : 0 }}>
                    <div onClick={() => isDone && setExpandedResults(prev => { const n = new Set(prev); n.has(step.id) ? n.delete(step.id) : n.add(step.id); return n; })}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, background: (isRunning || isParallelRunning) ? "var(--accent-bg)" : isDone ? "var(--bg-elevated)" : "var(--bg-surface)", border: (isRunning || isParallelRunning) ? "1px solid var(--accent)" : "1px solid var(--border)", cursor: isDone ? "pointer" : "default" }}>
                      <div style={{ width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: (isRunning || isParallelRunning) ? "var(--accent-bg)" : isDone ? (result.success ? "rgba(74,222,128,0.15)" : "rgba(248,113,113,0.15)") : "var(--bg-hover)" }}>
                        {(isRunning || isParallelRunning) ? <Loader2 style={{ width: 11, height: 11, color: "var(--accent)", animation: "spin 1s linear infinite" }} /> : isDone ? (result.success ? <CheckCircle2 style={{ width: 11, height: 11, color: "#4ade80" }} /> : <XCircle style={{ width: 11, height: 11, color: "#f87171" }} />) : <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }}>{i + 1}</span>}
                      </div>
                      <span style={{ flex: 1, fontSize: 11, color: (isRunning || isParallelRunning) ? "var(--accent)" : isDone ? "var(--text-secondary)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {step.message.replace(/\{\{INPUT\}\}/g, userInput.trim() || "(input)")}
                      </span>
                      {isDone && (isExpanded ? <ChevronDown style={{ width: 12, height: 12, color: "var(--text-muted)" }} /> : <ChevronUp style={{ width: 12, height: 12, color: "var(--text-muted)" }} />)}
                    </div>
                    {isDone && isExpanded && (
                      <div style={{ margin: "4px 0 0 30px", padding: 12, borderRadius: 8, background: "var(--bg-base)", border: result.success ? "1px solid rgba(74,222,128,0.1)" : "1px solid rgba(248,113,113,0.1)" }}>
                        <pre style={{ margin: 0, fontSize: 11, fontFamily: "'Segoe UI', sans-serif", color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 300, overflowY: "auto", lineHeight: 1.5 }}>{result.output || "(no output)"}</pre>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {stepResults.length === selected.steps.length && runningId !== selected.id && stepResults.length > 0 && (
              <div style={{ padding: 14, borderRadius: 10, background: stepResults.every(r => r.success) ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)", border: stepResults.every(r => r.success) ? "1px solid rgba(74,222,128,0.15)" : "1px solid rgba(248,113,113,0.15)", marginTop: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {stepResults.every(r => r.success) ? <CheckCircle2 style={{ width: 16, height: 16, color: "#4ade80" }} /> : <XCircle style={{ width: 16, height: 16, color: "#f87171" }} />}
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--text)", fontWeight: 500 }}>{stepResults.every(r => r.success) ? "Workflow completed successfully" : `Completed with ${stepResults.filter(r => !r.success).length} error(s)`}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted)" }}>{stepResults.filter(r => r.success).length}/{stepResults.length} steps succeeded</p>
                  </div>
                  <button onClick={() => { const t = stepResults.map((r, i) => `--- ${selected.steps[i]?.message ?? `Step ${i + 1}`} ---\n${r.output}`).join("\n\n"); navigator.clipboard.writeText(t); }}
                    style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", fontSize: 10 }}>
                    <Copy style={{ width: 10, height: 10 }} /> Copy All
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "auto" }}>
            <div style={{ padding: "0 0 24px" }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", margin: "0 0 4px" }}>Quick Actions</p>
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 14px", lineHeight: 1.5 }}>One-tap shortcuts for common operations.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {quickActions.map(a => {
                  const Icon = a.icon;
                  const busy = qaRunning === a.id;
                  return (
                    <button key={a.id} onClick={a.action} disabled={busy}
                      data-glow={a.color}
                      style={{
                        ...glowCard(a.color, { padding: "14px 12px", cursor: busy ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 10, opacity: busy ? 0.6 : 1, textAlign: "left" as const }),
                      }}
                      onMouseEnter={hoverLift}
                      onMouseLeave={hoverReset}
                      onMouseDown={pressDown}
                      onMouseUp={pressUp}
                    >
                      <div style={{
                        width: 32, height: 32, borderRadius: 8, flexShrink: 0, display: "flex",
                        alignItems: "center", justifyContent: "center",
                        background: `color-mix(in srgb, ${a.color} 12%, transparent)`,
                      }}>
                        {busy
                          ? <Loader2 style={{ width: 14, height: 14, color: a.color, animation: "spin 1s linear infinite" }} />
                          : <Icon style={{ width: 14, height: 14, color: a.color }} />}
                      </div>
                      <div>
                        <p style={{ margin: 0, fontSize: 11, color: "var(--text)", fontWeight: 600 }}>{a.label}</p>
                        <p style={{ margin: "2px 0 0", fontSize: 9, color: "var(--text-muted)" }}>{a.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {qaResult && (
                <div style={{
                  ...innerPanel, marginTop: 12, padding: "10px 14px",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={sectionLabel}>Result</span>
                    <button onClick={() => setQaResult(null)}
                      style={{ fontSize: 10, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}>
                      Dismiss
                    </button>
                  </div>
                  <p style={{
                    fontSize: 11, color: "var(--text-secondary)", whiteSpace: "pre-wrap",
                    maxHeight: 200, overflow: "auto", margin: 0, lineHeight: 1.5,
                  }}>
                    {qaResult}
                  </p>
                </div>
              )}
            </div>

            <div style={{ ...emptyState, flex: 1 }}>
              <Layers style={{ width: 28, height: 28, color: "var(--text-muted)", opacity: 0.5 }} />
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0, textAlign: "center", maxWidth: 240, lineHeight: 1.5 }}>Select a workflow from the sidebar to run multi-step agent automations.</p>
            </div>
          </div>
        )}
      </div>

      {/* Schedule Workflow Modal */}
      {showScheduleModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setShowScheduleModal(null)}>
          <div style={glowCard("var(--accent)", { padding: 24, width: 400, boxShadow: "0 20px 60px rgba(0,0,0,0.4)" })} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 16px", fontSize: 15, color: "var(--text)", fontWeight: 600 }}>Schedule "{showScheduleModal.name}"</h3>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Cron Schedule</label>
              <input value={scheduleCron} onChange={e => setScheduleCron(e.target.value)} style={{ ...inputStyle, fontFamily: MONO }} />
              <span style={{ ...mutedCaption, marginTop: 4, display: "block" }}>{cronToReadable(scheduleCron)}</span>
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 16 }}>
              {["0 8 * * *", "0 8 * * 1-5", "0 18 * * *", "0 0 * * 0", "*/30 * * * *"].map(c => (
                <button key={c} onClick={() => setScheduleCron(c)} style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid var(--border)", background: scheduleCron === c ? "var(--accent-bg)" : "var(--bg-surface)", color: scheduleCron === c ? "var(--accent)" : "var(--text-muted)", fontSize: 9, fontFamily: MONO, cursor: "pointer", transition: `all 0.2s ${EASE}` }}>{c}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowScheduleModal(null)} style={btnSecondary}>Cancel</button>
              <button onClick={() => scheduleWorkflow(showScheduleModal)} disabled={scheduling}
                style={{ ...btnPrimary, opacity: scheduling ? 0.5 : 1, display: "flex", alignItems: "center", gap: 6 }}>
                {scheduling && <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />}
                <Clock style={{ width: 12, height: 12 }} /> Schedule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB 3 — Scheduled Jobs (Cron)
   ══════════════════════════════════════════════════════════════ */

interface CronRunEntry {
  timestamp: string;
  status: string;
  duration: string;
}

function ScheduledTab() {
  const [jobs, setJobs] = useState<CronJob[]>(() => {
    const cached = useDataStore.getState().cronJobs?.data;
    return Array.isArray(cached) ? cached.map(parseCronJob) : [];
  });
  const [loading, setLoading] = useState(() => !useDataStore.getState().cronJobs?.data);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newSchedule, setNewSchedule] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const [historyOpen, setHistoryOpen] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<Record<string, CronRunEntry[]>>({});
  const [historyLoading, setHistoryLoading] = useState<string | null>(null);
  const [eventText, setEventText] = useState("");
  const [sendingEvent, setSendingEvent] = useState(false);
  const [eventResult, setEventResult] = useState<{ ok: boolean; text: string } | null>(null);
  const getCronJobs = useDataStore(s => s.getCronJobs);

  const loadJobs = useCallback(async (force = false) => {
    try {
      const raw = await getCronJobs(force);
      setJobs(withDuplicateMetaScheduled(raw.map(parseCronJob)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load cron jobs");
    }
    setLoading(false);
  }, [getCronJobs]);

  useEffect(() => {
    loadJobs();
    const interval = setInterval(() => loadJobs(true), 30_000);
    return () => clearInterval(interval);
  }, [loadJobs]);

  const toggleJob = async (job: CronJob) => {
    if (!job.id.trim()) return;
    const qid = quotePowerShellSingleQuoted(job.id);
    const cmd = job.enabled ? "disable" : "enable";
    try {
      const r = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", { command: `openclaw cron ${cmd} ${qid}`, cwd: null });
      if (r.code !== 0) setError(r.stderr || r.stdout || `Failed to ${cmd} job`);
    } catch { return; }
    invalidateCronJobsCliCache();
    await loadJobs(true);
  };
  const runNow = async (id: string) => {
    if (!id.trim()) return;
    const qid = quotePowerShellSingleQuoted(id);
    setRunningId(id); setRunResult(null);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", { command: `openclaw cron run ${qid}`, cwd: null });
      setRunResult({ id, text: result.stdout?.trim() || result.stderr?.trim() || "Job triggered", ok: result.code === 0 });
    } catch (e) { setRunResult({ id, text: e instanceof Error ? e.message : "Failed", ok: false }); }
    setRunningId(null);
    invalidateCronJobsCliCache();
    await loadJobs(true);
  };
  const removeJob = async (id: string) => {
    if (!id.trim()) {
      setError("Missing job id — cannot remove.");
      return;
    }
    const qid = quotePowerShellSingleQuoted(id);
    setRemovingId(id);
    try {
      const r = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", { command: `openclaw cron rm ${qid}`, cwd: null });
      if (r.code !== 0) setError([r.stderr, r.stdout].filter(Boolean).join("\n").trim() || "Failed to remove job");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove job");
    }
    setRemovingId(null);
    invalidateCronJobsCliCache();
    await loadJobs(true);
  };
  const addJob = async (schedule?: string, message?: string, name?: string) => {
    const sched = schedule || newSchedule; const msg = message || newMessage;
    if (!sched.trim() || !msg.trim()) return;
    setAdding(true);
    try {
      const escaped = escapeShellArg(msg);
      const escapedSched = escapeShellArg(sched);
      const namePart = (name || newName) ? ` --name "${escapeShellArg(name || newName)}"` : "";
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", { command: `openclaw cron add --cron "${escapedSched}" --message "${escaped}" --agent main${namePart}`, cwd: null });
      if (result.code === 0) {
        setNewSchedule(""); setNewMessage(""); setNewName(""); setShowAdd(false);
        invalidateCronJobsCliCache();
        await loadJobs(true);
      }
      else setError(result.stderr || "Failed to add job");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to add job"); }
    setAdding(false);
  };

  const fetchHistory = async (jobId: string) => {
    if (historyOpen === jobId) { setHistoryOpen(null); return; }
    setHistoryOpen(jobId);
    setHistoryLoading(jobId);
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: `openclaw cron runs --id ${quotePowerShellSingleQuoted(jobId)} --json --limit 5`, cwd: null,
      });
      if (result.code === 0 && result.stdout.trim()) {
        const parsed = JSON.parse(result.stdout);
        const runs: CronRunEntry[] = (parsed.runs ?? parsed ?? []).map((r: Record<string, unknown>) => ({
          timestamp: String(r.timestamp ?? r.startedAt ?? r.ts ?? "—"),
          status: String(r.status ?? r.result ?? "unknown"),
          duration: String(r.duration ?? r.durationMs ? `${r.durationMs}ms` : "—"),
        }));
        setHistoryData(prev => ({ ...prev, [jobId]: runs }));
      } else {
        setHistoryData(prev => ({ ...prev, [jobId]: [] }));
      }
    } catch {
      setHistoryData(prev => ({ ...prev, [jobId]: [] }));
    }
    setHistoryLoading(null);
  };

  const sendSystemEvent = async () => {
    if (!eventText.trim()) return;
    setSendingEvent(true);
    setEventResult(null);
    try {
      const escaped = escapeShellArg(eventText);
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `openclaw system event --text "${escaped}" --mode now`, cwd: null,
      });
      setEventResult({
        ok: result.code === 0,
        text: result.stdout?.trim() || result.stderr?.trim() || "Event sent",
      });
      if (result.code === 0) setEventText("");
    } catch (e) {
      setEventResult({ ok: false, text: e instanceof Error ? e.message : "Failed to send event" });
    }
    setSendingEvent(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "12px 20px 8px", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>Scheduled Jobs ({jobs.length})</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button aria-label="Refresh" onClick={() => { setLoading(true); loadJobs(); }} disabled={loading} style={navBtnStyle}>
            <RefreshCw style={{ width: 12, height: 12, ...(loading ? { animation: "spin 1s linear infinite" } : {}) }} />
          </button>
          <button onClick={() => setShowAdd(!showAdd)} style={{ ...navBtnStyle, background: "var(--accent-bg)", color: "var(--accent)", padding: "4px 10px", gap: 4, display: "flex", alignItems: "center" }}>
            <Plus style={{ width: 12, height: 12 }} /> Add
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 20px" }}>
        {error && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", marginBottom: 12 }}>
            <AlertTriangle style={{ width: 14, height: 14, color: "#f87171" }} />
            <span style={{ fontSize: 11, color: "#f87171", flex: 1 }}>{error}</span>
            <button aria-label="Close" onClick={() => setError(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 14, cursor: "pointer" }}>×</button>
          </div>
        )}

        {showAdd && (
          <div style={{ ...innerPanel, marginBottom: 16, padding: 14 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Name (optional)</label>
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Job name" style={inputStyle} />
              </div>
              <div style={{ width: 140 }}>
                <label style={labelStyle}>Schedule</label>
                <input value={newSchedule} onChange={e => setNewSchedule(e.target.value)} placeholder="0 8 * * *" style={{ ...inputStyle, fontFamily: MONO }} />
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={labelStyle}>Task / Prompt</label>
              <input value={newMessage} onChange={e => setNewMessage(e.target.value)} placeholder="What should the agent do?" style={inputStyle} />
            </div>
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
              <button onClick={() => setShowAdd(false)} style={{ ...btnSecondary, padding: "5px 12px", fontSize: 11 }}>Cancel</button>
              <button onClick={() => addJob()} disabled={adding || !newSchedule.trim() || !newMessage.trim()} style={{ ...btnPrimary, padding: "5px 14px", fontSize: 11, opacity: adding ? 0.5 : 1, display: "flex", alignItems: "center", gap: 4 }}>
                {adding && <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />} Add Job
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
            <Loader2 style={{ width: 20, height: 20, color: "var(--text-muted)", animation: "spin 1s linear infinite" }} />
          </div>
        ) : jobs.length === 0 ? (
          <div style={emptyState}>
            <Clock style={{ width: 32, height: 32, color: "var(--text-muted)" }} />
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>No scheduled jobs</p>
            <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "4px 0 16px" }}>Add a job or use a quick template below</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
            {jobs.map((job, ji) => {
              const isHb = job.name?.toLowerCase().includes("heartbeat") ?? false;
              return (
                <div key={job.id ? `${job.id}:${ji}` : `sched-${ji}`}
                  data-glow={isHb ? "#a855f7" : "var(--accent)"}
                  onMouseEnter={hoverLift} onMouseLeave={hoverReset} onMouseDown={pressDown} onMouseUp={pressUp}
                  style={{
                    ...glowCard(isHb ? "#a855f7" : "var(--accent)", {
                      padding: "10px 14px",
                      background: isHb ? "rgba(168,85,247,0.06)" : undefined,
                      border: isHb ? "1px solid rgba(168,85,247,0.2)" : undefined,
                      opacity: job.enabled ? 1 : 0.5,
                    }),
                  }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {isHb && <Heart style={{ width: 14, height: 14, color: "#a855f7", flexShrink: 0 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2, flexWrap: "wrap" }}>
                        {job.name && <span style={{ fontSize: 12, fontWeight: 600, color: isHb ? "#a855f7" : "var(--text)" }}>{job.name}</span>}
                        {job.duplicateGroupSize != null && job.duplicateGroupSize > 1 && job.duplicateIndex != null && (
                          <span style={{
                            ...badge("#fbbf24"), fontSize: 8, textTransform: "uppercase" as const, border: "1px solid rgba(251,191,36,0.25)",
                          }} title="Separate gateway jobs with the same name/schedule — safe to delete extras">
                            Duplicate {job.duplicateIndex}/{job.duplicateGroupSize}
                          </span>
                        )}
                        {job.id && (job.duplicateGroupSize ?? 0) > 1 && (
                          <span style={{ fontSize: 9, fontFamily: "monospace", color: "var(--text-muted)" }} title={job.id}>
                            id {job.id.slice(0, 8)}…
                          </span>
                        )}
                        <span style={{ ...badge(isHb ? "#a855f7" : "var(--accent)"), fontFamily: MONO, fontSize: 10 }}>{job.schedule}</span>
                        <span style={mutedCaption}>{cronToReadable(job.schedule)}</span>
                      </div>
                      <p style={{ margin: 0, fontSize: 11, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.message}</p>
                      <div style={{ display: "flex", gap: 8, marginTop: 2, flexWrap: "wrap" }}>
                        {job.nextRun && <span style={{ fontSize: 9, color: "var(--text-muted)" }}>Next: {job.nextRun}</span>}
                        {job.deliveryChannel && (
                          <span style={{ fontSize: 9, padding: "0 4px", borderRadius: 4, background: "rgba(59,130,246,0.1)", color: "var(--accent)" }}>
                            → {job.deliveryChannel}{job.deliveryTarget ? ` · ${deliveryLabel(job.deliveryTarget)}` : ""}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                      {isHb ? (
                        <span style={{ fontSize: 9, color: "#a855f7", fontWeight: 500, padding: "4px 10px", borderRadius: 6, background: "rgba(168,85,247,0.1)" }}>Managed in Heartbeat tab</span>
                      ) : (
                        <>
                          <button aria-label="Run history" onClick={() => fetchHistory(job.id)} title="History" style={{ ...smallBtnStyle, color: historyOpen === job.id ? "var(--accent)" : "var(--text-muted)", background: historyOpen === job.id ? "var(--accent-bg)" : "var(--bg-elevated)" }}>
                            {historyLoading === job.id ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <History style={{ width: 12, height: 12 }} />}
                          </button>
                          <button aria-label="Run now" onClick={() => runNow(job.id)} disabled={runningId === job.id} title="Run now" style={smallBtnStyle}>
                            {runningId === job.id ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Play style={{ width: 12, height: 12 }} />}
                          </button>
                          <button aria-label="Remove job" onClick={() => removeJob(job.id)} disabled={removingId === job.id} title="Remove" style={{ ...smallBtnStyle, color: "#f87171", borderColor: "rgba(248,113,113,0.15)" }}>
                            {removingId === job.id ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Trash2 style={{ width: 12, height: 12 }} />}
                          </button>
                          <ToggleSwitch enabled={job.enabled} onToggle={() => toggleJob(job)} />
                        </>
                      )}
                    </div>
                  </div>
                  {runResult?.id === job.id && (
                    <div style={{ marginTop: 6, padding: "6px 10px", borderRadius: 6, fontSize: 10, fontFamily: "monospace", background: runResult.ok ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)", border: `1px solid ${runResult.ok ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`, color: runResult.ok ? "#4ade80" : "#f87171", maxHeight: 80, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {runResult.text}
                    </div>
                  )}
                  {historyOpen === job.id && (
                    <div style={{ ...innerPanel, marginTop: 6, padding: "8px 10px" }}>
                      <span style={{ ...sectionLabel, display: "block", marginBottom: 6 }}>Last Runs</span>
                      {historyLoading === job.id ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: 4 }}>
                          <Loader2 style={{ width: 10, height: 10, color: "var(--text-muted)", animation: "spin 1s linear infinite" }} />
                          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Loading...</span>
                        </div>
                      ) : (historyData[job.id] ?? []).length === 0 ? (
                        <span style={{ fontSize: 10, color: "var(--text-muted)", fontStyle: "italic" }}>No run history available</span>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          {(historyData[job.id] ?? []).map((run, ri) => (
                            <div key={ri} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 6px", borderRadius: 4, background: "var(--bg-elevated)", fontSize: 10 }}>
                              <span style={{ color: run.status === "success" || run.status === "ok" ? "#4ade80" : run.status === "running" ? "var(--accent)" : "#f87171", fontWeight: 600, minWidth: 50 }}>{run.status}</span>
                              <span style={{ color: "var(--text-secondary)", flex: 1 }}>{run.timestamp}</span>
                              <span style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: 9 }}>{run.duration}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Send System Event */}
        <div style={{ ...innerPanel, marginBottom: 16, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <Send style={{ width: 12, height: 12, color: "var(--accent)" }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>Send System Event</span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={eventText}
              onChange={e => setEventText(e.target.value)}
              placeholder="Event text to enqueue..."
              onKeyDown={e => { if (e.key === "Enter") sendSystemEvent(); }}
              style={inputStyle}
            />
            <button onClick={sendSystemEvent} disabled={sendingEvent || !eventText.trim()}
              style={{ ...btnPrimary, padding: "6px 14px", fontSize: 11, opacity: sendingEvent || !eventText.trim() ? 0.5 : 1, flexShrink: 0, display: "flex", alignItems: "center", gap: 4 }}>
              {sendingEvent ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Send style={{ width: 12, height: 12 }} />}
              Send
            </button>
          </div>
          {eventResult && (
            <div style={{ marginTop: 6, padding: "5px 8px", borderRadius: 6, fontSize: 10, background: eventResult.ok ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)", border: `1px solid ${eventResult.ok ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`, color: eventResult.ok ? "#4ade80" : "#f87171" }}>
              {eventResult.text}
            </div>
          )}
        </div>

        {/* Quick Templates */}
        <span style={{ ...sectionLabel, display: "block", marginBottom: 8 }}>Quick Templates</span>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {QUICK_TEMPLATES.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.name} onClick={() => addJob(t.schedule, t.message, t.name)} disabled={adding}
                data-glow={t.color}
                style={{ ...glowCard(t.color, { textAlign: "left" as const, padding: "10px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }) }}
                onMouseEnter={hoverLift}
                onMouseLeave={hoverReset}
                onMouseDown={pressDown}
                onMouseUp={pressUp}>
                <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: `color-mix(in srgb, ${t.color} 12%, transparent)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon style={{ width: 14, height: 14, color: t.color }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 11, color: "var(--text)", fontWeight: 600, display: "block" }}>{t.name}</span>
                  <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{t.desc}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB 4 — Heartbeat (Autonomous Monitoring)
   ══════════════════════════════════════════════════════════════ */

const HEARTBEAT_INTERVALS = [
  { label: "5 min", minutes: 5 },
  { label: "15 min", minutes: 15 },
  { label: "30 min", minutes: 30 },
  { label: "1 hr", minutes: 60 },
  { label: "2 hr", minutes: 120 },
  { label: "4 hr", minutes: 240 },
] as const;

const HEARTBEAT_PRESETS = [
  "# Heartbeat checklist\n\n- Check inbox for urgent messages\n- Review calendar for events in next 2 hours\n- If a background task finished, summarize results",
  "# Heartbeat checklist\n\n- Check GitHub for new issues and PRs\n- Monitor CI/CD pipeline status\n- Review any failed deployments",
  "# Heartbeat checklist\n\n- Check system health and resource usage\n- Monitor disk space and alert if > 90%\n- Review running processes for anomalies",
  "# Heartbeat checklist\n\n- Scan for new security advisories\n- Check dependency update status\n- Review any pending approvals",
];

interface HeartbeatStatus {
  enabled: boolean;
  every: string;
  prompt: string;
  target: string;
  lastRun?: string;
  activeHours?: { start: string; end: string };
  lightContext?: boolean;
  isolatedSession?: boolean;
}

function HeartbeatTab() {
  const [status, setStatus] = useState<HeartbeatStatus>({
    enabled: false, every: "30m", prompt: "", target: "none",
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [editInterval, setEditInterval] = useState(30);
  const [editTarget, setEditTarget] = useState("none");
  const [activeHoursOn, setActiveHoursOn] = useState(false);
  const [ahStart, setAhStart] = useState("08:00");
  const [ahEnd, setAhEnd] = useState("22:00");

  const [instructions, setInstructions] = useState("");
  const [instructionsDirty, setInstructionsDirty] = useState(false);

  const hbPath = useRef("");

  const resolvePath = useCallback(async () => {
    try {
      const { homeDir, join } = await import("@tauri-apps/api/path");
      const home = await homeDir();
      hbPath.current = await join(home, ".openclaw", "workspace", "HEARTBEAT.md");
    } catch {
      hbPath.current = "";
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const r = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: "openclaw config get agents.defaults.heartbeat --json", cwd: null,
      });
      if (r.code === 0 && r.stdout.trim()) {
        const cfg = JSON.parse(r.stdout);
        const every = cfg.every || "30m";
        const m = every.match(/^(\d+)/);
        const minutes = m ? parseInt(m[1]) : 30;
        setEditInterval(minutes);
        setEditTarget(cfg.target || "none");
        if (cfg.activeHours) {
          setActiveHoursOn(true);
          setAhStart(cfg.activeHours.start || "08:00");
          setAhEnd(cfg.activeHours.end || "22:00");
        }
        setStatus(prev => ({
          ...prev, every, prompt: cfg.prompt || "", target: cfg.target || "none",
          activeHours: cfg.activeHours, lightContext: cfg.lightContext,
          isolatedSession: cfg.isolatedSession,
        }));
      }
    } catch { /* config may not exist yet */ }
  }, []);

  const fetchLast = useCallback(async () => {
    try {
      const r = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: "openclaw system heartbeat last --json", cwd: null,
      });
      if (r.code === 0 && r.stdout.trim()) {
        const p = JSON.parse(r.stdout);
        const ts = p.timestamp ?? p.ts ?? p.lastRun ?? p.last;
        if (ts) setStatus(prev => ({ ...prev, lastRun: ts }));
        if (typeof p.enabled === "boolean") setStatus(prev => ({ ...prev, enabled: p.enabled }));
      }
    } catch { /* may not have run yet */ }
  }, []);

  const loadInstructions = useCallback(async () => {
    if (!hbPath.current) return;
    try {
      const content = await invoke<string>("read_file", { path: hbPath.current });
      setInstructions(content || "");
    } catch { setInstructions(""); }
  }, []);

  useEffect(() => {
    (async () => {
      await resolvePath();
      await Promise.all([fetchConfig(), fetchLast()]);
      await loadInstructions();
      setLoading(false);
    })();
  }, [resolvePath, fetchConfig, fetchLast, loadInstructions]);

  const toggleHeartbeat = async () => {
    const was = status.enabled;
    setStatus(prev => ({ ...prev, enabled: !was }));
    setBusy("toggle");
    try {
      await invoke("execute_command", {
        command: was ? "openclaw system heartbeat disable" : "openclaw system heartbeat enable",
        cwd: null,
      });
    } catch { setStatus(prev => ({ ...prev, enabled: was })); }
    finally { setBusy(null); }
  };

  const saveAll = async () => {
    setBusy("save");
    try {
      await invoke("execute_command", {
        command: `openclaw config set agents.defaults.heartbeat.every "${editInterval}m"`, cwd: null,
      });
      await invoke("execute_command", {
        command: `openclaw config set agents.defaults.heartbeat.prompt "Follow the instructions in HEARTBEAT.md"`, cwd: null,
      });
      await invoke("execute_command", {
        command: `openclaw config set agents.defaults.heartbeat.target "${editTarget}"`, cwd: null,
      });
      if (activeHoursOn) {
        const ahJson = JSON.stringify({ start: ahStart, end: ahEnd });
        const escaped = ahJson.replace(/"/g, '\\"');
        await invoke("execute_command", {
          command: `openclaw config set agents.defaults.heartbeat.activeHours "${escaped}"`, cwd: null,
        });
      }
      if (hbPath.current) {
        await invoke("write_file", { path: hbPath.current, content: instructions });
      }
      setStatus(prev => ({
        ...prev, every: `${editInterval}m`, target: editTarget,
        activeHours: activeHoursOn ? { start: ahStart, end: ahEnd } : undefined,
      }));
      setInstructionsDirty(false);
      setSaved("all"); setTimeout(() => setSaved(null), 2000);
    } catch { /* ignore */ }
    finally { setBusy(null); }
  };

  const triggerNow = async () => {
    setBusy("trigger");
    try {
      await invoke("execute_command", {
        command: `openclaw system event --text "Manual heartbeat check" --mode now`, cwd: null,
      });
    } catch { /* ignore */ }
    finally { setBusy(null); }
  };

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", gap: 8 }}>
        <Loader2 style={{ width: 16, height: 16, color: "var(--accent)", animation: "spin 1s linear infinite" }} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading heartbeat config...</span>
      </div>
    );
  }

  const isEnabled = status.enabled;

  return (
    <div style={{ height: "100%", overflow: "auto", padding: "20px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
        <div style={{
          ...glowCard(isEnabled ? "#a855f7" : "var(--text-muted)", {
            width: 48, height: 48, borderRadius: 14,
            background: isEnabled ? "rgba(168,85,247,0.12)" : "var(--bg-hover)",
            border: isEnabled ? "1px solid rgba(168,85,247,0.25)" : "1px solid var(--border)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }),
        }}>
          <Heart style={{
            width: 24, height: 24,
            color: isEnabled ? "#a855f7" : "var(--text-muted)",
            animation: isEnabled ? "heartbeat-pulse 2s ease-in-out infinite" : "none",
          }} />
        </div>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
            Autonomous Heartbeat
          </h2>
          <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
            {isEnabled ? (
              <>
                <span style={{ color: "#a855f7", fontWeight: 600 }}>Active</span>
                {" "}&middot; Every {status.every}
                {status.lastRun && <> &middot; Last: {status.lastRun}</>}
                {status.activeHours && <> &middot; {status.activeHours.start}–{status.activeHours.end}</>}
              </>
            ) : "Disabled — enable to start autonomous monitoring"}
          </p>
        </div>
        <button onClick={triggerNow} disabled={busy === "trigger"}
          style={{
            ...btnSecondary, display: "flex", alignItems: "center", gap: 6,
            padding: "8px 14px", fontSize: 11,
          }}>
          {busy === "trigger"
            ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />
            : <Play style={{ width: 12, height: 12 }} />}
          Run Now
        </button>
        <button onClick={toggleHeartbeat} disabled={busy === "toggle"}
          style={{
            ...btnPrimary,
            padding: "8px 18px",
            background: isEnabled ? "rgba(248,113,113,0.15)" : "#a855f7",
            color: isEnabled ? "#f87171" : "#fff",
            display: "flex", alignItems: "center", gap: 6,
            opacity: busy === "toggle" ? 0.7 : 1,
          }}>
          {busy === "toggle" && <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />}
          {isEnabled ? "Disable" : "Enable"}
        </button>
      </div>

      {/* Settings row */}
      <div style={{ display: "flex", gap: 20, marginBottom: 20, flexWrap: "wrap" }}>
        <div>
          <label style={labelStyle}>Interval</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {HEARTBEAT_INTERVALS.map(({ label, minutes }) => {
              const active = editInterval === minutes;
              return (
                <button key={minutes} onClick={() => setEditInterval(minutes)}
                  style={{
                    padding: "6px 14px", borderRadius: 8, fontSize: 11, cursor: "pointer",
                    border: active ? "1px solid #a855f7" : "1px solid var(--border)",
                    background: active ? "rgba(168,85,247,0.15)" : "var(--bg-elevated)",
                    color: active ? "#c084fc" : "var(--text-secondary)",
                    fontWeight: active ? 600 : 400, transition: `all 0.2s ${EASE}`,
                  }}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label style={labelStyle}>Delivery</label>
          <div style={{ display: "flex", gap: 6 }}>
            {(["none", "last"] as const).map(t => (
              <button key={t} onClick={() => setEditTarget(t)}
                style={{
                  padding: "6px 14px", borderRadius: 8, fontSize: 11, cursor: "pointer",
                  border: editTarget === t ? "1px solid #a855f7" : "1px solid var(--border)",
                  background: editTarget === t ? "rgba(168,85,247,0.15)" : "var(--bg-elevated)",
                  color: editTarget === t ? "#c084fc" : "var(--text-secondary)",
                  fontWeight: editTarget === t ? 600 : 400,
                }}>
                {t === "none" ? "Silent" : "Last conversation"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, cursor: "pointer" }}
            onClick={() => setActiveHoursOn(!activeHoursOn)}>
            <input type="checkbox" checked={activeHoursOn}
              onChange={e => setActiveHoursOn(e.target.checked)} style={{ margin: 0 }} />
            <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500 }}>Active Hours</span>
          </div>
          {activeHoursOn && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="time" value={ahStart} onChange={e => setAhStart(e.target.value)}
                style={{ ...inputStyle, width: 110, padding: "5px 8px" }} />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>to</span>
              <input type="time" value={ahEnd} onChange={e => setAhEnd(e.target.value)}
                style={{ ...inputStyle, width: 110, padding: "5px 8px" }} />
            </div>
          )}
        </div>
      </div>

      {/* Instructions — single source of truth: HEARTBEAT.md */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div>
            <label style={{ ...labelStyle, marginBottom: 0 }}>Heartbeat Instructions</label>
            <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted)" }}>
              Saved to <span style={{ fontFamily: MONO, fontSize: 9, color: "var(--accent)" }}>~/.openclaw/workspace/HEARTBEAT.md</span> — the agent reads this file each heartbeat cycle
            </p>
          </div>
          {instructionsDirty && <span style={{ fontSize: 9, color: "#fbbf24", fontWeight: 500 }}>unsaved changes</span>}
        </div>
        <textarea value={instructions}
          onChange={e => { setInstructions(e.target.value); setInstructionsDirty(true); }}
          placeholder={"# Heartbeat checklist\n\n- Check inbox for urgent messages\n- Review calendar for events in next 2 hours\n- If a background task finished, summarize results\n- Check system health"}
          rows={10}
          style={{
            ...inputStyle, resize: "vertical", minHeight: 180, maxHeight: 400,
            fontFamily: MONO, fontSize: 11, lineHeight: 1.6,
          }} />
      </div>

      {/* Presets */}
      <div style={{ marginBottom: 20 }}>
        <label style={labelStyle}>Quick Presets</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {HEARTBEAT_PRESETS.map((preset, i) => {
            const title = preset.split("\n")[0].replace(/^#\s*/, "");
            const itemCount = preset.split("\n").filter(l => l.startsWith("- ")).length;
            return (
              <button key={i} onClick={() => { setInstructions(preset); setInstructionsDirty(true); }}
                data-glow="#a855f7"
                onMouseEnter={hoverLift} onMouseLeave={hoverReset} onMouseDown={pressDown} onMouseUp={pressUp}
                style={{
                  ...innerPanel, textAlign: "left" as const, padding: "8px 14px",
                  color: "var(--text-secondary)", fontSize: 10, cursor: "pointer",
                  flex: "1 1 200px", minWidth: 180,
                }}>
                <span style={{ fontWeight: 500 }}>{title}</span>
                <span style={{ display: "block", fontSize: 9, color: "var(--text-muted)", marginTop: 2 }}>
                  {itemCount} item{itemCount !== 1 ? "s" : ""}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Save all */}
      <button onClick={saveAll} disabled={busy === "save"}
        style={{
          ...btnPrimary,
          padding: "10px 24px",
          background: saved === "all" ? "rgba(74,222,128,0.15)" : "#a855f7",
          color: saved === "all" ? "#4ade80" : "#fff",
          display: "flex", alignItems: "center", gap: 6,
          opacity: busy === "save" ? 0.6 : 1,
        }}>
        {busy === "save" ? <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />
          : saved === "all" ? <CheckCircle2 style={{ width: 14, height: 14 }} />
          : <Save style={{ width: 14, height: 14 }} />}
        {saved === "all" ? "Saved!" : "Save Heartbeat Config"}
      </button>

      {status.lastRun && (
        <div style={{
          ...innerPanel, marginTop: 20, padding: "12px 16px",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <Clock style={{ width: 14, height: 14, color: "var(--text-muted)", flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: "var(--text)" }}>
            Last heartbeat: <span style={{ color: "#a855f7", fontWeight: 500 }}>{status.lastRun}</span>
          </span>
        </div>
      )}

      <style>{`
        @keyframes heartbeat-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.15); }
        }
      `}</style>
    </div>
  );
}

/* ── Shared UI Components ── */

function ToggleSwitch({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} style={{ width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer", position: "relative", background: enabled ? "var(--accent)" : "var(--bg-hover)", transition: `background 0.25s ${SPRING}`, flexShrink: 0 }}>
      <span style={{ position: "absolute", top: 2, left: enabled ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "white", transition: `left 0.25s ${SPRING}`, boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
    </button>
  );
}

/* ── Style constants ── */

const navBtnStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-muted)", fontSize: 11, cursor: "pointer", transition: `all 0.2s ${EASE}` };
const labelStyle: React.CSSProperties = { ...sectionLabel, fontSize: 10, fontWeight: 500, display: "block", marginBottom: 4, textTransform: "none" as const, letterSpacing: "normal" };
const smallBtnStyle: React.CSSProperties = { width: 28, height: 28, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text-muted)", transition: `all 0.2s ${EASE}` };
const iconBtnStyle: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2, display: "flex", alignItems: "center", transition: `all 0.2s ${EASE}` };
