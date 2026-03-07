<p align="center">
  <img src="public/icon.png" width="140" alt="Crystal" />
</p>

<h1 align="center">Crystal</h1>

<p align="center">
  <strong>The most complete desktop frontend for <a href="https://github.com/nichochar/open-claw">OpenClaw</a>.</strong><br/>
  A voice-first AI assistant that runs entirely on your hardware — no cloud, no subscriptions, no data leaving your machine.
</p>

<p align="center">
  <a href="#-features-at-a-glance"><img src="https://img.shields.io/badge/18-Built--In%20Views-blue?style=flat-square" /></a>
  <a href="#-pc-optimizer"><img src="https://img.shields.io/badge/12-PC%20Optimizer%20Tools-green?style=flat-square" /></a>
  <a href="#-tech-stack"><img src="https://img.shields.io/badge/Tauri-2.0-24c8db?style=flat-square&logo=tauri" /></a>
  <a href="#-requirements"><img src="https://img.shields.io/badge/GPU-NVIDIA%20RTX-76b900?style=flat-square&logo=nvidia" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" /></a>
</p>

---

## What is Crystal?

Crystal takes [OpenClaw](https://github.com/nichochar/open-claw) — an open-source autonomous AI agent framework — and wraps it in a polished desktop app with a real GUI. Instead of juggling CLI commands and config files, you get a native Windows application where everything is one click away: managing models, installing skills, automating workflows, monitoring your GPU, optimizing your PC, and talking to your AI through voice.

**Crystal vs. raw OpenClaw CLI:**

| | OpenClaw CLI | Crystal |
|---|---|---|
| Interface | Terminal only | Full desktop GUI with 18 views |
| Setup | Manual config files | One-click onboarding wizard |
| Server management | Start services manually | Auto-starts Ollama, gateway, voice servers |
| Model management | `ollama pull/rm` commands | Visual model browser with VRAM charts |
| Skills & plugins | `npx openclaw skills list` | Toggle switches, one-click Power Up |
| System monitoring | None | Live GPU, CPU, RAM, disk dashboards |
| PC maintenance | None | 12 one-click optimizer tools |
| Voice | Separate setup | Built-in wake word + STT + TTS |
| Themes | None | 5 polished themes |

---

## Why Crystal?

- **100% Local.** Your conversations, files, and system data never leave your machine. Run any open-weight model on your own GPU.
- **No Subscriptions.** No API keys, no cloud bills. You own the hardware, you own the AI.
- **Self-Contained.** Crystal auto-starts Ollama, the OpenClaw gateway, and voice servers on launch. Open the app and go.
- **Actually Useful.** This isn't a chatbot wrapper. Crystal can create files, run commands, manage your system, automate workflows, and monitor your hardware — all through natural language.

---

## Features at a Glance

### AI Chat with Tool Use
Full-featured conversation interface with Markdown rendering, syntax-highlighted code blocks, copy buttons, and a typewriter effect for responses. The AI can execute 7 built-in tools:

| Tool | What It Does |
|------|-------------|
| `shell` | Execute any shell command on your machine |
| `read_file` | Read file contents from any path |
| `write_file` | Create or overwrite files (with verification) |
| `list_directory` | Browse directory contents |
| `web_search` | Search DuckDuckGo (top 5 results) |
| `web_fetch` | Fetch and read any URL |
| `crystal_action` | Navigate views, enable plugins, run app commands |

The agent runs a multi-step tool loop (up to 5 iterations per message), so it can reason, act, observe, and act again — like a real assistant.

**21 Slash Commands** — type `/` in the chat to jump to any view, start a new conversation, clear history, trigger Power Up, or open the command palette.

**Interactive Action Buttons** — the AI can render clickable buttons in its responses (navigate to views, enable plugins, run commands, copy text) so you can act on suggestions instantly.

**8 Starter Suggestions** — new conversations show quick-start chips: "Set up everything", "What can you do?", "Create a file", "Check security", "Show my skills", "Pull a model", and more.

---

### Dashboard

The home screen gives you a bird's-eye view of your entire system:

- **Status Cards** — Gateway connection status with latency, active LLM model, OS info
- **Stats Row** — Active sessions, ready skills, token usage, memory chunks
- **Quick Actions** — Morning Briefing, Heartbeat, Security Scan, Health Check
- **Power Up** — One-click button that runs OpenClaw setup, enables all plugins, fixes security issues, and reindexes memory
- **Security Summary** — Critical and warning counts from the latest audit
- **System Monitor** — Live CPU, RAM, storage, and uptime (polled every 15s)
- **GPU Monitor** — Real-time NVIDIA GPU stats (utilization gauge, VRAM bar, temperature, power draw)

---

### PC Optimizer

12 one-click system maintenance tools built right into the dashboard:

| Tool | What It Does |
|------|-------------|
| **Max Performance** | Switches Windows power plan to Ultimate/High Performance |
| **Balanced Power** | Switches back to Balanced power plan |
| **Flush DNS** | Clears the DNS resolver cache |
| **Clear Temp Files** | Deletes temp files and reports how many MB were freed |
| **Clear Prefetch** | Cleans Windows prefetch data |
| **Memory Cleanup** | Forces .NET garbage collection to free managed memory |
| **Startup Apps** | Lists all startup programs so you can see what's slowing boot |
| **Reset Network** | Resets TCP/IP stack, Winsock, flushes DNS, releases/renews IP |
| **Disk Cleanup** | Removes Windows Update downloads, CBS logs, and browser cache |
| **Quick Scan** | Runs a Windows Defender quick scan |
| **Disable Visual FX** | Turns off Windows animations and effects for maximum performance |
| **GPU Reset** | Restarts the NVIDIA display driver without rebooting |

---

### GPU Monitor

Real-time NVIDIA GPU dashboard (via `nvidia-smi`, polled every 5s):

- GPU name (auto-formatted, e.g. "RTX 5090")
- GPU utilization — circular progress gauge with percentage
- VRAM usage — used/total GB with color-coded progress bar (blue → yellow → red as usage climbs)
- Temperature — color-coded (green under 60°C, yellow under 80°C, red above)
- Power draw — current watts vs. power limit with progress bar
- Health indicator dot (green = healthy, red = error)

---

### Model Management

Three-tab model browser:

- **OpenClaw Models** — All models registered with OpenClaw, grouped by provider. Set any model as default. Scan for new models. Auth status check.
- **Ollama Library** — Browse locally installed Ollama models. Pull new models by name. View model details (size, ID, modified date). Delete models. Visual size comparison bar chart.
- **Running Models** — Live view of currently loaded models with VRAM usage per model, processor type, and VRAM distribution chart. Auto-refreshes every 5s.

---

### Skills & Plugins Marketplace

Three-tab marketplace for extending Crystal's capabilities:

- **Skills** — Browse all 51+ OpenClaw skills. See which are ready (enabled + deps met) vs. available (missing deps). Toggle enable/disable with a switch. Expand any skill to see source, bundled status, homepage link, and missing dependency badges.
- **Plugins** — Browse OpenClaw plugins with version info and origin. Toggle enable/disable. Run `openclaw plugins doctor` for diagnostics.
- **Power Up** — One-click setup that enables every disabled plugin and skill, runs security audit with auto-fix, and reindexes memory. Shows per-step progress with expandable output.

---

### Workflow Templates

Pre-built and custom automation workflows:

**7 Built-in Workflows:**

| Workflow | Steps | Description |
|----------|-------|-------------|
| Morning Briefing | 3 | Weather, calendar summary, top news |
| Code Review | 4 | Structure analysis, issue detection, security check, summary |
| Research Topic | 4 | Overview, pros/cons, source gathering, synthesis |
| System Health | 4 | Doctor check, security audit, service status, report |
| Daily Digest | 3 | Messages, emails, compiled digest |
| Write Email | 2 | Draft and polish |
| Explain Code | 2 | Explanation and improvement suggestions |

- **Custom Workflows** — Create your own with arbitrary steps. Steps support `{{INPUT}}` template variables for parameterized automation.
- **Workflow Runner** — Progress bar, per-step expandable results, completion summary, copy-all button.

---

### Channel Integrations

Connect Crystal to 12 messaging platforms:

| Channel | Type |
|---------|------|
| WhatsApp | Web bridge |
| Telegram | Bot API |
| Discord | Bot with voice, threads, reactions |
| Slack | Workspace bot with channel access |
| Signal | End-to-end encrypted |
| iMessage | macOS integration |
| Google Chat | Workspace integration |
| Email | IMAP/SMTP monitoring |
| Matrix | Federated messaging |
| IRC | Classic IRC |
| Linear | Issue tracker |
| Nostr | Decentralized protocol |

Per-channel: add/remove, login/logout, view capabilities, configure tokens, resolve contacts/groups.

---

### Scheduled Tasks (Cron)

Schedule recurring AI tasks with cron expressions:

**6 Quick Templates:**
- Morning Briefing (daily 8 AM)
- Security Scan (weekly Sunday 2 AM)
- Disk Cleanup (weekly Saturday 3 AM)
- Email Digest (weekdays 6 PM)
- Daily Summary (daily 11 PM)
- Health Check (every 30 minutes)

Interactive cron syntax reference with 8 examples (click to auto-fill). Per-job: run now, enable/disable, remove.

---

### Security

- **Security Audit** — Standard and deep scan modes with pass/warn/fail scoring
- **Auto Fix** — One-click fix for detected security issues
- **Tool Permissions** — View allowed/denied tool policies
- **Gateway Auth** — Authentication status and configuration
- **Secrets Management** — Reload secrets from vault
- **Approval Rules** — View auto/manual execution approval policies
- **Memory Reindex** — Rebuild the memory index with stats display

---

### Browser Automation

Control a headless browser through OpenClaw's `browser-use` skill:

- Start/stop browser instance
- Navigate to URLs or open in new tabs
- View all open tabs with search/filter
- Capture screenshots
- Status display (PID, URL, running state)
- Auth token auto-loaded from config

---

### Agent Management

- List, create, and delete OpenClaw agents
- Set agent identity (name + emoji)
- Test agents with a hello prompt
- View model, workspace, and routes per agent
- Manage phone/channel bindings per agent

---

### Memory

- **Curated Memory** — View and add entries to `MEMORY.md`
- **Daily Memory** — Browse daily memory logs
- **Semantic Search** — Search across all memory entries
- Refresh and add new memory entries

---

### Activity & Logs

- **Activity Feed** — Real-time event stream from the OpenClaw gateway. Filter by type (Chat, Tool Call, Tool Result, Error, Heartbeat). Color-coded entries.
- **Gateway Logs** — Raw log viewer with auto-refresh, search with match highlighting, log level coloring (ERROR/WARN/INFO/DEBUG), line numbers, copy-all.

---

### Hooks

Event-driven lifecycle hooks for the OpenClaw agent:
- List installed hooks with enable/disable toggles
- Expandable detail panels (description, triggers, config)
- Install new hooks by spec
- Bulk update and eligibility checks

---

### Multi-Node Orchestration

Manage distributed OpenClaw nodes:
- List nodes with status indicators (running/stopped/idle)
- Run or invoke individual nodes with custom prompts
- Broadcast messages to all nodes

---

### Sessions

- Browse all active agent sessions sorted by recency
- Per-session: agent ID, model provider, model name
- Token usage stats (input, output, total)
- Context window usage bar (color-coded at 60%/85%)
- Cleanup old sessions

---

### Doctor / Diagnostics

6 diagnostic commands:

| Command | Description |
|---------|-------------|
| Doctor | Basic system check |
| Deep Scan | Comprehensive diagnostic scan |
| Auto Fix | Automatically fix detected issues |
| Status | Overall system status report |
| Gateway Health | Gateway connectivity check |
| Config Validate | Validate configuration file |

Terminal-style output with color-coded results and summary cards (Passed/Warnings/Failed).

---

### Voice

- **Wake Word** — Say "Hey Crystal" to activate
- **Speech-to-Text** — Local Whisper server (configurable: tiny, base, small, medium, large-v3)
- **Text-to-Speech** — Local Kokoro TTS engine
- **Voice Orb** — Animated 80px button with state-aware gradients and ring animations (idle → listening → processing → speaking)
- Falls back gracefully when voice servers are offline

---

### Settings

- **Themes** — 5 built-in themes with visual preview swatches
- **Gateway** — Status, latency ping, auth token (show/copy), start/restart
- **LLM Backend** — Switch between Ollama and LM Studio, model picker, connection test
- **Voice** — Whisper and TTS status, model selector, test connections
- **AI Config** — Temperature (0–2), max tokens, editable system prompt
- **Security** — Run audit, tool permissions, auth status
- **Updates** — Version display, update channel selector (stable/beta/dev)
- **OpenClaw Config** — Raw JSON editor for `~/.openclaw/openclaw.json`
- **Gateway Service** — Daemon install/uninstall/restart/stop with log output
- **Config CLI** — Get/set/unset individual config values
- **About** — Crystal version, OpenClaw version, runtime info, links

---

### Themes

| Theme | Style | Accent Color |
|-------|-------|-------------|
| **Midnight** | Deep dark | Blue |
| **SoCal** | Warm sunset | Orange |
| **Arctic** | Clean light | Sky blue |
| **Ember** | Dark with warm glow | Red |
| **Slate** | Soft light | Indigo |

---

### Onboarding

First-run wizard with 5 steps:

1. **Welcome** — Introduction with Crystal branding
2. **Prerequisites** — Auto-checks Node.js, Ollama, OpenClaw, NVIDIA GPU
3. **LLM Setup** — Pick from installed Ollama models or pull a new one
4. **Gateway** — Verify/start the OpenClaw gateway on port 18789
5. **Launch** — Summary of all checks + selected model + gateway status

---

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl + Space` | Toggle Crystal window (global hotkey) |
| `Ctrl + K` | Command palette |
| `Ctrl + N` | New conversation |
| `Ctrl + 1–9` | Switch between views |
| `Ctrl + ,` | Open Settings |
| `/` | Slash command menu (in chat) |
| `Enter` | Send message |
| `Shift + Enter` | New line in message |

---

### Performance

Crystal is optimized to feel instant:

- **Lazy-loaded views** — All 18 views use `React.lazy()` + `Suspense`. Only the active tab's code is loaded.
- **CLI response caching** — Shared cache with TTL deduplicates OpenClaw CLI calls across views.
- **Visibility-aware polling** — GPU monitor, system monitor, and model poller pause when their tab is hidden. Zero background processes when you're on a different tab.
- **Vendor bundle splitting** — React, markdown rendering, and animation libraries are cached as separate chunks.
- **Fine-grained state subscriptions** — Zustand selectors prevent unnecessary re-renders across all components.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Runtime | [Tauri 2.0](https://v2.tauri.app/) (lightweight, ~3MB runtime) |
| Frontend | React 19, TypeScript, Zustand, Tailwind CSS |
| Backend | Rust (tokio, reqwest, serde) |
| AI Agent | [OpenClaw](https://github.com/nichochar/open-claw) |
| LLM Inference | [Ollama](https://ollama.com/) (local) or LM Studio |
| Voice STT | Whisper (local, via Python server) |
| Voice TTS | Kokoro TTS (local, via Python server) |
| Icons | Lucide React |
| Markdown | react-markdown + remark-gfm + rehype-highlight |
| Animations | Framer Motion |

---

## Requirements

| Requirement | Details |
|-------------|---------|
| **OS** | Windows 10/11 (macOS/Linux planned) |
| **GPU** | NVIDIA RTX with 16GB+ VRAM (RTX 4070 Ti or better recommended) |
| **Node.js** | v18+ |
| **Package Manager** | pnpm |
| **Rust** | Latest stable toolchain |
| **Ollama** | Installed with at least one model pulled |
| **Python** | 3.10+ *(optional, for voice features)* |

---

## Quick Start

### 1. Install prerequisites

```bash
# Install Ollama: https://ollama.com/download
# Install Node.js: https://nodejs.org
# Install Rust: https://rustup.rs
# Install pnpm: npm install -g pnpm

# Pull a model
ollama pull qwen2.5:32b
```

### 2. Clone and install

```bash
git clone https://github.com/jvpflum/Crystal.git
cd Crystal
pnpm install
```

### 3. Run

```bash
pnpm tauri dev
```

Crystal auto-starts Ollama and the OpenClaw gateway on launch. The onboarding wizard walks you through the rest.

### 4. Voice setup *(optional)*

```bash
pip install -r scripts/requirements.txt
```

Crystal auto-launches Whisper STT and TTS servers on startup when Python is available.

---

## Project Structure

```
Crystal/
├── src/                             # React frontend
│   ├── components/
│   │   ├── shell/                   # TitleBar, Navigation, CommandPalette, Onboarding, Toast
│   │   ├── views/                   # 18 feature views
│   │   ├── voice/                   # VoiceOrb
│   │   └── widgets/                 # GpuMonitor
│   ├── hooks/                       # useOpenClaw, useVoice, useStorage, useKeyboardShortcuts
│   ├── lib/
│   │   ├── agent.ts                 # AI agent brain (system prompt, tool loop, action handler)
│   │   ├── openclaw.ts              # OpenClaw client (gateway, LLM, memory, channels, config)
│   │   ├── tools.ts                 # Tool implementations (shell, files, web, actions)
│   │   ├── cache.ts                 # CLI response cache with TTL + in-flight deduplication
│   │   ├── voice.ts                 # Voice service (Whisper STT, TTS)
│   │   ├── templates.ts             # Built-in workflow definitions
│   │   └── marketplace.ts           # Skill/plugin catalog
│   └── stores/
│       ├── appStore.ts              # App state (view, voice, gateway)
│       └── themeStore.ts            # Theme definitions and persistence
├── src-tauri/                       # Rust backend
│   ├── src/
│   │   ├── lib.rs                   # Tauri commands, server lifecycle, file ops, system tray
│   │   └── main.rs                  # Entry point
│   ├── icons/                       # App icons (all sizes + .ico + .icns)
│   └── tauri.conf.json              # Tauri configuration
├── scripts/                         # Voice server scripts
│   ├── whisper_server.py            # Whisper STT server
│   ├── tts_server.py                # Kokoro TTS server
│   ├── requirements.txt             # Python dependencies
│   ├── setup.ps1                    # Full setup script
│   └── start-all.ps1               # Manual service launcher
└── public/                          # Static assets
    └── icon.png                     # Crystal lobster icon
```

---

## Contributing

Contributions are welcome. Please open an issue first to discuss changes.

```bash
# Development mode with hot reload
pnpm tauri dev

# Production build
pnpm tauri build
```

---

## License

MIT

---

<p align="center">
  <sub>Built with Tauri, React, Rust, and OpenClaw.<br/>Runs on your hardware, not ours.</sub>
</p>
