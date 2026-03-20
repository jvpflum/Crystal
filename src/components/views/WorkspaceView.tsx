import { useState, useEffect, useCallback, useRef, type CSSProperties } from "react";
import {
  FileText, Save, RefreshCw, Trash2, Plus, ChevronRight, ChevronLeft,
  BookOpen, Loader2, CheckCircle2, AlertTriangle, FolderOpen, Clock,
  HardDrive, Copy, Zap, X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";

/* ── Types ── */

type WorkspaceFile =
  | "AGENTS.md"
  | "SOUL.md"
  | "IDENTITY.md"
  | "USER.md"
  | "TOOLS.md"
  | "MEMORY.md"
  | "BOOT.md"
  | "BOOTSTRAP.md"
  | "HEARTBEAT.md";

type FileStatus = "saved" | "modified" | "not-found" | "loading" | "error";

interface FileState {
  content: string;
  original: string;
  status: FileStatus;
  size: number | null;
  lastModified: string | null;
}

interface StandingOrderForm {
  program: string;
  authority: string;
  trigger: string;
  approvalGate: string;
  escalation: string;
}

/* ── Constants ── */

const WORKSPACE_FILES: WorkspaceFile[] = [
  "AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md",
  "TOOLS.md", "MEMORY.md", "BOOT.md", "BOOTSTRAP.md", "HEARTBEAT.md",
];

const FILE_DESCRIPTIONS: Record<WorkspaceFile, string> = {
  "AGENTS.md": "Agent instructions & standing orders",
  "SOUL.md": "Personality, tone & communication style",
  "IDENTITY.md": "Who the agent is",
  "USER.md": "Who the user is",
  "TOOLS.md": "Tool usage policies",
  "MEMORY.md": "Persistent memory context",
  "BOOT.md": "First-session bootstrap",
  "BOOTSTRAP.md": "Extended bootstrap content",
  "HEARTBEAT.md": "Heartbeat checklist",
};

const PRESETS: Record<WorkspaceFile, string> = {
  "AGENTS.md": `# Agent Operating Instructions

## Standing Orders

### Program: Daily Monitoring
**Authority:** Check system health, review inbox, summarize updates
**Trigger:** Every morning at 8 AM (enforced via cron job)
**Approval gate:** None for monitoring. Flag anomalies for human review.
**Escalation:** If any system is down or metrics are unusual

### Execution Rules
- Every task follows Execute-Verify-Report. No exceptions.
- "I'll do that" is not execution. Do it, then report.
- Never retry indefinitely — 3 attempts max, then escalate.

## Behavioral Guidelines
- Be concise and direct
- Prioritize accuracy over speed
- Ask for clarification when instructions are ambiguous
- Log all significant actions to memory
`,
  "SOUL.md": `# Soul

You are a thoughtful, capable assistant. You communicate clearly and concisely.
You prefer action over discussion. When given a task, you execute it immediately
and report results, rather than describing what you would do.

## Communication Style
- Direct and clear
- No unnecessary pleasantries in task execution
- Detailed when reporting results
- Honest about limitations and uncertainties

## Values
- Accuracy over speed
- Transparency in reasoning
- Proactive problem identification
- Continuous improvement
`,
  "IDENTITY.md": `# Identity

Name: Crystal
Role: Personal AI Assistant & System Manager
Platform: OpenClaw Gateway

## Capabilities
- Task execution and automation
- System monitoring and health checks
- Content creation and analysis
- Code review and development support
- Research and information gathering
`,
  "USER.md": `# User Profile

## Preferences
- Communication: Direct, no fluff
- Updates: Summarized, with details available on request
- Notifications: Only for important items
- Work hours: 8 AM - 6 PM local time

## Context
- [Add your background, role, and interests here]
- [Add your current projects and priorities]
`,
  "TOOLS.md": `# Tool Usage Policies

## General Rules
- Prefer non-destructive operations
- Always verify before deleting files
- Use sandbox for untrusted code execution
- Log all file system modifications

## Exec Policy
- Ask before running commands that modify system state
- Background long-running tasks
- Capture output for all commands

## Browser Policy
- Do not store credentials
- Close tabs when done
- Screenshot before and after important actions
`,
  "MEMORY.md": `# Memory Context

## Key Facts
- [Important facts the agent should always remember]

## Ongoing Projects
- [List active projects and their status]

## Preferences Learned
- [Things learned from interactions]
`,
  "BOOT.md": `# Boot Instructions

On first session startup:
1. Check system health
2. Review pending tasks
3. Check for new messages across channels
4. Summarize what happened since last session
`,
  "BOOTSTRAP.md": `# Extended Bootstrap

## Environment Setup
- Verify all required services are running
- Check API connectivity
- Load user preferences from workspace

## First-Run Checklist
- [ ] Introduce yourself to the user
- [ ] Confirm preferred communication style
- [ ] Review workspace files for context
- [ ] Check for pending tasks or messages
`,
  "HEARTBEAT.md": `# Heartbeat Checklist

## Every Check
- [ ] System health status
- [ ] Pending notifications
- [ ] Inbox summary
- [ ] Calendar events (next 4 hours)

## Daily (Morning)
- [ ] Weather briefing
- [ ] News summary (tech + general)
- [ ] Project status updates
`,
};

/* ── Keyframes ── */

const KEYFRAMES = `
@keyframes ws-spin { to { transform: rotate(360deg) } }
@keyframes ws-fade-in { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: translateY(0) } }
@keyframes ws-pulse { 0%,100% { opacity: 1 } 50% { opacity: .5 } }
`;

/* ── Shared style tokens ── */

const MONO: CSSProperties = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" };

const BTN_BASE: CSSProperties = {
  padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 500,
  border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center",
  gap: 5, transition: "opacity .15s, background .15s",
};

const ICON_SM: CSSProperties = { width: 13, height: 13 };
const ICON_XS: CSSProperties = { width: 11, height: 11 };

/* ── File I/O helpers ── */

async function resolveWorkspacePath(filename: string): Promise<string> {
  const home = await homeDir();
  const sep = home.includes("\\") ? "\\" : "/";
  const base = home.endsWith(sep) ? home.slice(0, -1) : home;
  return `${base}${sep}.openclaw${sep}workspace${sep}${filename}`;
}

async function readWorkspaceFile(filename: string): Promise<{ content: string; size: number; lastModified: string | null } | null> {
  const path = await resolveWorkspacePath(filename);
  try {
    const content = await invoke<string>("read_file", { path });
    return { content, size: new Blob([content]).size, lastModified: null };
  } catch {
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `Get-Content -Path "${path}" -Raw -ErrorAction Stop`,
        cwd: null,
      });
      if (result.code === 0 && result.stdout != null) {
        const c = result.stdout;
        return { content: c, size: new Blob([c]).size, lastModified: null };
      }
    } catch { /* file doesn't exist */ }
  }
  return null;
}

async function writeWorkspaceFile(filename: string, content: string): Promise<boolean> {
  const path = await resolveWorkspacePath(filename);
  try {
    await invoke("write_file", { path, content });
    return true;
  } catch {
    try {
      const escaped = content.replace(/'/g, "''");
      const result = await invoke<{ code: number }>("execute_command", {
        command: `$d = Split-Path "${path}"; if (!(Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }; Set-Content -Path "${path}" -Value '${escaped}' -Encoding UTF8 -NoNewline`,
        cwd: null,
      });
      return result.code === 0;
    } catch { return false; }
  }
}

async function deleteWorkspaceFile(filename: string): Promise<boolean> {
  const path = await resolveWorkspacePath(filename);
  try {
    const result = await invoke<{ code: number }>("execute_command", {
      command: `Remove-Item -Path "${path}" -Force -ErrorAction Stop`,
      cwd: null,
    });
    return result.code === 0;
  } catch { return false; }
}

async function ensureWorkspaceDir(): Promise<void> {
  const path = await resolveWorkspacePath("");
  await invoke("execute_command", {
    command: `if (!(Test-Path "${path}")) { New-Item -ItemType Directory -Path "${path}" -Force | Out-Null }`,
    cwd: null,
  });
}

async function getFileInfo(filename: string): Promise<{ size: number; lastModified: string } | null> {
  const path = await resolveWorkspacePath(filename);
  try {
    const result = await invoke<{ stdout: string; code: number }>("execute_command", {
      command: `if (Test-Path "${path}") { $f = Get-Item "${path}"; Write-Output "$($f.Length)|$($f.LastWriteTime.ToString('o'))" } else { Write-Output "NOTFOUND" }`,
      cwd: null,
    });
    if (result.code === 0 && result.stdout && !result.stdout.includes("NOTFOUND")) {
      const [sizeStr, dateStr] = result.stdout.trim().split("|");
      return { size: parseInt(sizeStr, 10) || 0, lastModified: dateStr || "" };
    }
  } catch { /* ignore */ }
  return null;
}

/* ── Component ── */

export function WorkspaceView() {
  const [activeTab, setActiveTab] = useState<WorkspaceFile>("AGENTS.md");
  const [files, setFiles] = useState<Record<WorkspaceFile, FileState>>(() => {
    const init: Record<string, FileState> = {};
    for (const f of WORKSPACE_FILES) {
      init[f] = { content: "", original: "", status: "loading", size: null, lastModified: null };
    }
    return init as Record<WorkspaceFile, FileState>;
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [orderForm, setOrderForm] = useState<StandingOrderForm>({
    program: "", authority: "", trigger: "", approvalGate: "", escalation: "",
  });
  const [creatingCron, setCreatingCron] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const currentFile = files[activeTab];
  const isDirty = currentFile.content !== currentFile.original;

  const flash = useCallback((type: "success" | "error", msg: string) => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    setFeedback({ type, msg });
    feedbackTimer.current = setTimeout(() => setFeedback(null), 3000);
  }, []);

  const loadFile = useCallback(async (filename: WorkspaceFile) => {
    setFiles(prev => ({ ...prev, [filename]: { ...prev[filename], status: "loading" } }));
    const data = await readWorkspaceFile(filename);
    const info = await getFileInfo(filename);
    if (data) {
      setFiles(prev => ({
        ...prev,
        [filename]: {
          content: data.content,
          original: data.content,
          status: "saved",
          size: info?.size ?? data.size,
          lastModified: info?.lastModified ?? null,
        },
      }));
    } else {
      setFiles(prev => ({
        ...prev,
        [filename]: { content: "", original: "", status: "not-found", size: null, lastModified: null },
      }));
    }
  }, []);

  const loadAllFiles = useCallback(async () => {
    await ensureWorkspaceDir();
    await Promise.all(WORKSPACE_FILES.map(f => loadFile(f)));
  }, [loadFile]);

  useEffect(() => { loadAllFiles(); }, [loadAllFiles]);

  const handleSave = useCallback(async () => {
    if (!isDirty && currentFile.status === "saved") return;
    setSaving(true);
    const ok = await writeWorkspaceFile(activeTab, currentFile.content);
    if (ok) {
      const info = await getFileInfo(activeTab);
      setFiles(prev => ({
        ...prev,
        [activeTab]: {
          ...prev[activeTab],
          original: prev[activeTab].content,
          status: "saved",
          size: info?.size ?? new Blob([prev[activeTab].content]).size,
          lastModified: info?.lastModified ?? new Date().toISOString(),
        },
      }));
      flash("success", `${activeTab} saved`);
    } else {
      setFiles(prev => ({ ...prev, [activeTab]: { ...prev[activeTab], status: "error" } }));
      flash("error", `Failed to save ${activeTab}`);
    }
    setSaving(false);
  }, [activeTab, currentFile, isDirty, flash]);

  const handleReload = useCallback(async () => {
    await loadFile(activeTab);
    flash("success", `${activeTab} reloaded`);
  }, [activeTab, loadFile, flash]);

  const handleCreate = useCallback(async () => {
    const preset = PRESETS[activeTab] || `# ${activeTab.replace(".md", "")}\n\n`;
    const ok = await writeWorkspaceFile(activeTab, preset);
    if (ok) {
      await loadFile(activeTab);
      flash("success", `${activeTab} created`);
    } else {
      flash("error", `Failed to create ${activeTab}`);
    }
  }, [activeTab, loadFile, flash]);

  const handleDelete = useCallback(async () => {
    const ok = await deleteWorkspaceFile(activeTab);
    if (ok) {
      setFiles(prev => ({
        ...prev,
        [activeTab]: { content: "", original: "", status: "not-found", size: null, lastModified: null },
      }));
      flash("success", `${activeTab} deleted`);
    } else {
      flash("error", `Failed to delete ${activeTab}`);
    }
    setShowDeleteConfirm(false);
  }, [activeTab, flash]);

  const handleApplyPreset = useCallback(() => {
    const preset = PRESETS[activeTab];
    if (!preset) return;
    setFiles(prev => ({
      ...prev,
      [activeTab]: { ...prev[activeTab], content: preset, status: prev[activeTab].status === "not-found" ? "not-found" : "modified" },
    }));
  }, [activeTab]);

  const handleContentChange = useCallback((value: string) => {
    setFiles(prev => ({
      ...prev,
      [activeTab]: {
        ...prev[activeTab],
        content: value,
        status: value !== prev[activeTab].original
          ? (prev[activeTab].status === "not-found" ? "not-found" : "modified")
          : "saved",
      },
    }));
  }, [activeTab]);

  const handleAddStandingOrder = useCallback(() => {
    const { program, authority, trigger, approvalGate, escalation } = orderForm;
    if (!program.trim()) return;
    const block = [
      `\n### Program: ${program}`,
      `**Authority:** ${authority || "TBD"}`,
      `**Trigger:** ${trigger || "Manual"}`,
      `**Approval gate:** ${approvalGate || "None"}`,
      `**Escalation:** ${escalation || "Escalate to user"}`,
      "",
    ].join("\n");

    setFiles(prev => {
      const curr = prev["AGENTS.md"];
      const updated = curr.content.trimEnd() + "\n" + block;
      return {
        ...prev,
        "AGENTS.md": { ...curr, content: updated, status: updated !== curr.original ? "modified" : "saved" },
      };
    });

    setOrderForm({ program: "", authority: "", trigger: "", approvalGate: "", escalation: "" });
    setShowOrderForm(false);
    if (activeTab !== "AGENTS.md") setActiveTab("AGENTS.md");
    flash("success", `Standing order "${program}" added`);
  }, [orderForm, activeTab, flash]);

  const handleCreateCron = useCallback(async () => {
    const { program, trigger } = orderForm;
    if (!trigger.trim()) return;
    setCreatingCron(true);
    try {
      await invoke("execute_command", {
        command: `openclaw cron add --name "${program}" --schedule "${trigger}" --command "openclaw system event --text '${program} triggered'"`,
        cwd: null,
      });
      flash("success", `Cron job created for "${program}"`);
    } catch {
      flash("error", "Failed to create cron job");
    }
    setCreatingCron(false);
  }, [orderForm, flash]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  const statusColor = (s: FileStatus): string => {
    switch (s) {
      case "saved": return "var(--success, #4ade80)";
      case "modified": return "var(--warning, #fbbf24)";
      case "not-found": return "var(--text-muted, #666)";
      case "loading": return "var(--accent)";
      case "error": return "var(--error, #f87171)";
    }
  };

  const statusLabel = (s: FileStatus): string => {
    switch (s) {
      case "saved": return "Saved";
      case "modified": return "Modified";
      case "not-found": return "File not found";
      case "loading": return "Loading...";
      case "error": return "Error";
    }
  };

  const formatSize = (bytes: number | null): string => {
    if (bytes === null) return "";
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  const formatDate = (iso: string | null): string => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch { return ""; }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <style>{KEYFRAMES}</style>

      {/* ── Header ── */}
      <div style={{
        padding: "14px 20px 0", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <FolderOpen style={{ width: 16, height: 16, color: "var(--accent)" }} />
          <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Workspace</h2>
          <span style={{ fontSize: 11, color: "var(--text-muted)", ...MONO }}>~/.openclaw/workspace/</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {feedback && (
            <div style={{
              display: "flex", alignItems: "center", gap: 4, padding: "3px 10px",
              borderRadius: 6, fontSize: 11, fontWeight: 500,
              animation: "ws-fade-in .2s ease",
              background: feedback.type === "success" ? "rgba(74,222,128,0.12)" : "rgba(248,113,113,0.12)",
              color: feedback.type === "success" ? "var(--success, #4ade80)" : "var(--error, #f87171)",
            }}>
              {feedback.type === "success"
                ? <CheckCircle2 style={ICON_XS} />
                : <AlertTriangle style={ICON_XS} />}
              {feedback.msg}
            </div>
          )}
          <span style={{
            fontSize: 10, padding: "2px 8px", borderRadius: 4,
            background: `${statusColor(isDirty ? "modified" : currentFile.status)}18`,
            color: statusColor(isDirty ? "modified" : currentFile.status),
            fontWeight: 500,
          }}>
            {isDirty ? "Modified" : statusLabel(currentFile.status)}
          </span>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div style={{
        display: "flex", gap: 1, padding: "10px 20px 0",
        overflowX: "auto", flexShrink: 0,
        borderBottom: "1px solid var(--border)",
      }}>
        {WORKSPACE_FILES.map(f => {
          const isActive = f === activeTab;
          const exists = files[f].status !== "not-found" && files[f].status !== "loading";
          const isModified = files[f].content !== files[f].original;
          return (
            <button
              key={f}
              onClick={() => setActiveTab(f)}
              style={{
                ...BTN_BASE,
                padding: "6px 12px 8px",
                borderRadius: "6px 6px 0 0",
                border: "none",
                borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                background: isActive ? "var(--bg-elevated)" : "transparent",
                color: isActive ? "var(--text)" : "var(--text-muted)",
                fontSize: 11,
                fontWeight: isActive ? 600 : 400,
                position: "relative",
                whiteSpace: "nowrap",
              }}
            >
              <FileText style={{ ...ICON_XS, opacity: 0.7 }} />
              {f.replace(".md", "")}
              {exists && (
                <span style={{
                  width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
                  background: isModified ? "var(--warning, #fbbf24)" : "var(--success, #4ade80)",
                }} />
              )}
              {!exists && files[f].status !== "loading" && (
                <span style={{
                  width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
                  background: "var(--text-muted)", opacity: 0.3,
                }} />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Toolbar ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 20px", flexShrink: 0,
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-surface)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {currentFile.status === "not-found" ? (
            <button onClick={handleCreate} style={actionBtn("var(--accent)")}>
              <Plus style={ICON_SM} /> Create File
            </button>
          ) : (
            <>
              <button
                onClick={handleSave}
                disabled={saving || (!isDirty && currentFile.status === "saved")}
                style={{
                  ...actionBtn(isDirty ? "var(--accent)" : "var(--text-muted)"),
                  opacity: (saving || (!isDirty && currentFile.status === "saved")) ? 0.5 : 1,
                  cursor: (saving || (!isDirty && currentFile.status === "saved")) ? "default" : "pointer",
                }}
              >
                {saving
                  ? <Loader2 style={{ ...ICON_SM, animation: "ws-spin .8s linear infinite" }} />
                  : <Save style={ICON_SM} />}
                {saving ? "Saving..." : "Save"}
              </button>
              <button onClick={handleReload} style={actionBtn("var(--text-secondary)")}>
                <RefreshCw style={ICON_SM} /> Reload
              </button>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                style={actionBtn("var(--error, #f87171)")}
              >
                <Trash2 style={ICON_SM} /> Delete
              </button>
            </>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {currentFile.size !== null && (
            <span style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
              <HardDrive style={{ width: 10, height: 10 }} />
              {formatSize(currentFile.size)}
            </span>
          )}
          {currentFile.lastModified && (
            <span style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
              <Clock style={{ width: 10, height: 10 }} />
              {formatDate(currentFile.lastModified)}
            </span>
          )}
          <button
            onClick={() => setSidebarOpen(o => !o)}
            style={{
              ...BTN_BASE, padding: "4px 8px",
              background: sidebarOpen ? "var(--accent-bg, rgba(59,130,246,0.12))" : "transparent",
              color: sidebarOpen ? "var(--accent)" : "var(--text-muted)",
              border: "1px solid var(--border)",
            }}
            title="Templates & Presets"
          >
            <BookOpen style={ICON_SM} />
            {sidebarOpen ? <ChevronRight style={ICON_XS} /> : <ChevronLeft style={ICON_XS} />}
          </button>
        </div>
      </div>

      {/* ── Delete confirmation ── */}
      {showDeleteConfirm && (
        <div style={{
          padding: "10px 20px", flexShrink: 0,
          background: "rgba(248,113,113,0.08)",
          borderBottom: "1px solid rgba(248,113,113,0.2)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          animation: "ws-fade-in .15s ease",
        }}>
          <span style={{ fontSize: 12, color: "var(--error, #f87171)" }}>
            Delete <strong>{activeTab}</strong>? This cannot be undone.
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={handleDelete} style={{ ...BTN_BASE, background: "rgba(248,113,113,0.15)", color: "#f87171" }}>
              Delete
            </button>
            <button onClick={() => setShowDeleteConfirm(false)} style={{ ...BTN_BASE, background: "transparent", color: "var(--text-muted)" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Main content area ── */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        {/* Editor */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
          {currentFile.status === "loading" ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Loader2 style={{ width: 16, height: 16, color: "var(--accent)", animation: "ws-spin 1s linear infinite" }} />
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading {activeTab}...</span>
            </div>
          ) : currentFile.status === "not-found" && !currentFile.content ? (
            <div style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 12,
            }}>
              <FileText style={{ width: 32, height: 32, color: "var(--text-muted)", opacity: 0.3 }} />
              <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
                {activeTab} doesn't exist yet
              </p>
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0, opacity: 0.6 }}>
                {FILE_DESCRIPTIONS[activeTab]}
              </p>
              <button onClick={handleCreate} style={actionBtn("var(--accent)")}>
                <Plus style={ICON_SM} /> Create with template
              </button>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={currentFile.content}
              onChange={e => handleContentChange(e.target.value)}
              spellCheck={false}
              style={{
                flex: 1, width: "100%", resize: "none",
                background: "var(--bg-base)",
                color: "var(--text)",
                border: "none", outline: "none",
                padding: "16px 20px",
                fontSize: 13, lineHeight: 1.7,
                ...MONO,
                caretColor: "var(--accent)",
              }}
              placeholder={`Start writing ${activeTab}...`}
            />
          )}

          {/* ── Standing Orders Helper (AGENTS.md only) ── */}
          {activeTab === "AGENTS.md" && currentFile.status !== "not-found" && (
            <div style={{
              flexShrink: 0, borderTop: "1px solid var(--border)",
              background: "var(--bg-surface)",
            }}>
              <button
                onClick={() => setShowOrderForm(o => !o)}
                style={{
                  ...BTN_BASE, width: "100%", justifyContent: "space-between",
                  padding: "10px 20px", borderRadius: 0,
                  background: "transparent", color: "var(--text-secondary)",
                  fontSize: 11, fontWeight: 600, letterSpacing: 0.5,
                  textTransform: "uppercase",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Zap style={{ ...ICON_XS, color: "var(--accent)" }} />
                  Standing Orders Helper
                </span>
                {showOrderForm
                  ? <X style={ICON_XS} />
                  : <Plus style={ICON_XS} />}
              </button>

              {showOrderForm && (
                <div style={{
                  padding: "12px 20px 16px",
                  display: "flex", flexDirection: "column", gap: 8,
                  animation: "ws-fade-in .15s ease",
                }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <OrderField label="Program Name" value={orderForm.program}
                      onChange={v => setOrderForm(p => ({ ...p, program: v }))}
                      placeholder="e.g. Daily Monitoring" />
                    <OrderField label="Trigger" value={orderForm.trigger}
                      onChange={v => setOrderForm(p => ({ ...p, trigger: v }))}
                      placeholder="e.g. 0 8 * * * or 'on message'" />
                    <OrderField label="Authority" value={orderForm.authority}
                      onChange={v => setOrderForm(p => ({ ...p, authority: v }))}
                      placeholder="What the agent can do" />
                    <OrderField label="Approval Gate" value={orderForm.approvalGate}
                      onChange={v => setOrderForm(p => ({ ...p, approvalGate: v }))}
                      placeholder="What needs human sign-off" />
                  </div>
                  <OrderField label="Escalation Rules" value={orderForm.escalation}
                    onChange={v => setOrderForm(p => ({ ...p, escalation: v }))}
                    placeholder="When to escalate to human" />
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    <button
                      onClick={handleAddStandingOrder}
                      disabled={!orderForm.program.trim()}
                      style={{
                        ...actionBtn("var(--accent)"),
                        opacity: orderForm.program.trim() ? 1 : 0.4,
                        cursor: orderForm.program.trim() ? "pointer" : "default",
                      }}
                    >
                      <Plus style={ICON_XS} /> Add to AGENTS.md
                    </button>
                    {orderForm.trigger.trim() && (
                      <button
                        onClick={handleCreateCron}
                        disabled={creatingCron}
                        style={actionBtn("#a855f7")}
                      >
                        {creatingCron
                          ? <Loader2 style={{ ...ICON_XS, animation: "ws-spin .8s linear infinite" }} />
                          : <Clock style={ICON_XS} />}
                        Create Cron Job
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Sidebar: Templates & Presets ── */}
        {sidebarOpen && (
          <div style={{
            width: 280, flexShrink: 0, borderLeft: "1px solid var(--border)",
            background: "var(--bg-surface)",
            display: "flex", flexDirection: "column",
            animation: "ws-fade-in .15s ease",
            overflow: "hidden",
          }}>
            <div style={{
              padding: "12px 14px 10px",
              borderBottom: "1px solid var(--border)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                Templates
              </span>
              <button onClick={() => setSidebarOpen(false)} style={{ ...BTN_BASE, padding: 4, background: "transparent", color: "var(--text-muted)" }}>
                <X style={ICON_XS} />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px" }}>
              {/* Preset for current file */}
              <div style={{ marginBottom: 16 }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", margin: "0 0 4px" }}>
                  {activeTab}
                </p>
                <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "0 0 8px" }}>
                  {FILE_DESCRIPTIONS[activeTab]}
                </p>
                <button onClick={handleApplyPreset} style={actionBtn("var(--accent)")}>
                  <Copy style={ICON_XS} /> Load Preset
                </button>
              </div>

              {/* Preview of preset */}
              <div style={{
                background: "var(--bg-base)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "10px 12px",
                maxHeight: 320,
                overflowY: "auto",
              }}>
                <pre style={{
                  margin: 0, fontSize: 10, lineHeight: 1.6,
                  color: "var(--text-muted)", whiteSpace: "pre-wrap", wordBreak: "break-word",
                  ...MONO,
                }}>
                  {PRESETS[activeTab] || "No preset available"}
                </pre>
              </div>

              {/* Quick apply other presets */}
              <div style={{ marginTop: 20 }}>
                <p style={{
                  fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                  letterSpacing: 1, color: "var(--text-muted)", margin: "0 0 8px",
                }}>
                  Other Files
                </p>
                {WORKSPACE_FILES.filter(f => f !== activeTab).map(f => {
                  const exists = files[f].status !== "not-found" && files[f].status !== "loading";
                  return (
                    <button
                      key={f}
                      onClick={() => setActiveTab(f)}
                      style={{
                        ...BTN_BASE, width: "100%", justifyContent: "flex-start",
                        padding: "6px 8px", borderRadius: 6,
                        background: "transparent", color: "var(--text-secondary)",
                        fontSize: 11, marginBottom: 2,
                      }}
                    >
                      <span style={{
                        width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
                        background: exists ? "var(--success, #4ade80)" : "var(--text-muted)",
                        opacity: exists ? 1 : 0.3,
                      }} />
                      {f.replace(".md", "")}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function OrderField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div>
      <label style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500, marginBottom: 3, display: "block" }}>
        {label}
      </label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%", padding: "5px 8px",
          background: "var(--bg-base)", color: "var(--text)",
          border: "1px solid var(--border)", borderRadius: 5,
          fontSize: 11, outline: "none",
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

/* ── Style helpers ── */

function actionBtn(color: string): CSSProperties {
  return {
    ...BTN_BASE,
    background: `color-mix(in srgb, ${color} 12%, transparent)`,
    color,
  };
}
