<p align="center">
  <img src="public/icon.png" width="150" alt="Crystal" />
</p>

<h1 align="center">Crystal</h1>

<p align="center">
  <strong>The most complete desktop frontend for <a href="https://github.com/nichochar/open-claw">OpenClaw</a>.</strong><br/>
  A native AI command center with 30 views, AI-powered search, 60+ slash commands, NVIDIA-accelerated voice, multi-provider LLM support, and a full agent workspace — all in a single desktop app.
</p>

<p align="center">
  <a href="#-features"><img src="https://img.shields.io/badge/30-Views-6366f1?style=flat-square" /></a>
  <a href="#-ai-chat"><img src="https://img.shields.io/badge/60+-Slash%20Commands-3b82f6?style=flat-square" /></a>
  <a href="#-voice-engine"><img src="https://img.shields.io/badge/6-Voice%20Providers-10b981?style=flat-square" /></a>
  <a href="#-multi-provider-llm"><img src="https://img.shields.io/badge/7-LLM%20Providers-f59e0b?style=flat-square" /></a>
  <a href="#-tech-stack"><img src="https://img.shields.io/badge/Tauri-2.0-24c8db?style=flat-square&logo=tauri" /></a>
  <a href="#-voice-engine"><img src="https://img.shields.io/badge/NVIDIA-RTX%20Voice-76b900?style=flat-square&logo=nvidia" /></a>
  <a href="#-themes"><img src="https://img.shields.io/badge/6-Themes-ec4899?style=flat-square" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" /></a>
</p>

<p align="center">
  <a href="#-whats-new">What's New</a> · <a href="#-features">Features</a> · <a href="#-quick-start">Quick Start</a> · <a href="#-tech-stack">Tech Stack</a> · <a href="#-contributing">Contributing</a>
</p>

---

## What's New

### April 2026 — v0.6.0.1 Dashboard Polish, Audit & Bug Fixes

- **Dashboard Redesign** — Complete visual overhaul with SVG data visualizations: ring gauges (CPU, RAM, Storage), radial burst (lifetime tokens), smooth bezier sparklines (CPU/RAM trends), mini bar charts (cron jobs), dot matrix (memory), and glow progress bars — all theme-aware.
- **Apple-Meets-Futuristic UX** — Every card lifts, scales, and glows on hover with spring-eased micro-interactions. Press-down feedback on clickable elements. Smooth cubic-bezier transitions throughout. Status dots pulse when disconnected.
- **Dual LLM Model Display** — Dashboard LLM card now shows both hosted (OpenAI with official logo) and local (Ollama) models side by side with independent status indicators and live model name from `ollama ps`.
- **GPU Monitor Redesign** — Rebuilt with ring gauge, glow bars, metric chips, NVIDIA-green branding, hover interactions, and theme-aware colors to match the new dashboard aesthetic.
- **Quick Actions Relocated** — Moved from dashboard to Command Center Workflows tab for a cleaner home screen.
- **Voice Button Cleanup** — Removed duplicate voice orb from dashboard (kept in chat).
- **8 Bug Fixes from Full Audit:**
  - CommandPalette: `selectedIndex` could go to -1 on empty lists
  - Onboarding: rejected `Promise.allSettled` branches left prereq rows stuck loading
  - AgentsView: stale closure in `loadAgents` callback
  - DataStore: five unguarded `JSON.parse` calls wrapped in try/catch
  - AppStore: invalid persisted view validated against `VALID_VIEWS` set
  - HomeView: `RingGauge` positioning fix, `RadialBurst` deterministic rendering
  - App.tsx: `FloatingOrb` accessibility — added contextual `aria-label`
- **Version Sync** — `Cargo.toml` and `tauri.conf.json` both aligned to v0.6.0.
- **CSS Animations** — Added `pulse-dot` keyframe for disconnected status indicators.

### April 2026 — v0.6.0 Sandbox, City, Memory & Performance

- **NVIDIA OpenShell Sandbox** — One-toggle sandbox mode in Settings. Agents execute inside isolated [OpenShell](https://github.com/NVIDIA/OpenShell) containers with filesystem, network, and process isolation. Auto-detects Docker, creates sandboxes from the `openclaw` community image, and reverts cleanly if anything fails. Requires Docker Desktop.
- **Crystal City — Future-Punk Visualization** — Full cyberpunk isometric city with neon buildings, holographic billboards, flying drones, electric arcs, rain, steam vents, scanlines, and shooting stars. Agents walk between buildings, display current tasks in speech bubbles, and show status rings. HUD includes activity feed, agent roster, and live clock.
- **Memory System Overhaul** — New Knowledge Base tab for browsing, viewing, and editing all workspace `.md` files (SOUL.md, USER.md, AGENTS.md, etc.). New Tiers tab visualizing HOT → WARM → COLD memory hierarchy. ClawHub memory skills (`memory-never-forget`, `elite-longterm-memory`) installed.
- **Sidebar Consolidation** — Navigation reduced from 31 to 15 items with collapsible OpenClaw section. All views remain accessible via Ctrl+K command palette.
- **Concurrency Limiter** — `cache.ts` now throttles CLI commands to 3 concurrent requests max, preventing WebSocket handshake timeouts and gateway lane stalls.
- **Batched Prefetching** — Data store prefetches in 3 sequential batches with 30s cooldown instead of flooding the gateway with 12+ parallel requests.
- **Reduced Polling** — Gateway reconnection intervals, City polling, and data refresh rates all reduced to minimize gateway load.
- **Factory Builds Tab** — Live Claude Code sub-agent builds with spawn, steer, send, and log streaming.

### April 2026 — v0.5.0 Full OpenClaw Alignment

- **Live Agent Office** — OfficeView rebuilt with real-time agent monitoring. Shows all OpenClaw agents (main/JC, research, home, finance) with live sessions, running tasks, token counts, and dispatch functionality — no more fake preset agents.
- **Skill Launcher Factory** — FactoryView rebuilt with a searchable Skills tab showing all 18+ workspace skills (bill-sweep, bounty-hunter, car-broker, etc.) with eligibility status, missing dependency details, and one-click launch. Projects tab preserved for autonomous code builds with any agent ID.
- **Skill-Based Workflows** — 12 real workflows mapped to OpenClaw skills: Bill Sweep, Bounty Scout, Car Deal Finder, Home Service Quote, Market Research, VC Evaluation, Code Review, and more — across Finance, Home, Development, System, Research, and Productivity categories.
- **AI-Powered Command Palette** — Ctrl+K now detects questions and answers them with GPT-4o-mini. Shows inline AI responses with navigation suggestions and a "Deep Dive in Chat" button for deeper exploration.
- **Telegram Topics Dashboard** — HomeView now shows all Telegram topics (Finance #16, Home #17, System #38, Neighborhood #89, Factory #1195) with cron delivery counts.
- **Cron Health Monitor** — Dashboard displays enabled/total ratio, failure count, health bar, and next firing time.
- **Delivery Target Labels** — Calendar, CronView, and Command Center all show which Telegram topic each cron job delivers to (e.g., "→ telegram · Finance (#16)").
- **Data Layer Expansion** — Added `getSkills()` and `getSessions()` caches to the data store for consistent, fast access across views.
- **Dynamic Agent Types** — Factory store no longer hardcoded to `claude-code`/`cortex` — supports any agent ID string.

### March 2026 — v0.4.0

- **Multi-Provider LLM Support** — Connect to Ollama, OpenAI, Anthropic, Google, OpenRouter, Groq, or Mistral.
- **NVIDIA RTX Voice Engine** — GPU-accelerated speech with Nemotron/Parakeet STT and Magpie TTS.
- **Software Factory** — Launch and manage coding agents with live log streaming.
- **ClawHub** — Built-in skill registry with search, install, publish, and sync.
- **Agent Workspace** — Visual editor for 9 agent identity files.
- **28 Views** — Workspace, Messaging, Directory, Sub-Agents, Devices, Webhooks, Voice Calls, and more.
- **60+ Slash Commands** — Full command coverage across all features.
- **Image Generation** — DALL·E via the `openai-image-gen` skill.
- **Voice Calls** — Notify/converse modes with expose controls and call history.
- **DNS Configuration** — Custom domain support from Settings.

---

## What is Crystal?

Crystal wraps [OpenClaw](https://github.com/nichochar/open-claw) — an open-source autonomous AI agent framework — in a native desktop application with a real GUI. Instead of terminal commands and config files, you get a polished Windows app where everything is one click (or one voice command) away.

### Crystal vs. OpenClaw CLI

| | OpenClaw CLI | Crystal |
|---|---|---|
| Interface | Terminal | Native desktop GUI with 30 views |
| Setup | Manual config files | One-click onboarding wizard |
| LLM Providers | Manual configuration | 7 providers with visual API key management |
| Server management | Start services manually | Auto-starts Ollama, gateway, and voice servers |
| Model management | `ollama pull/rm` | Visual model browser with VRAM charts |
| Skills & plugins | `npx openclaw skills list` | Toggle switches, ClawHub, one-click Power Up |
| Voice | Separate setup | 6 built-in voice providers with NVIDIA RTX acceleration |
| System monitoring | None | Live GPU, CPU, RAM, disk dashboards |
| Coding agents | Separate tools | Built-in Factory with skill launcher + any agent |
| Agent identity | Edit files manually | Visual workspace editor with presets |
| Themes | None | 6 polished themes |

---

## Why Crystal?

- **Local-First, Cloud-Optional.** Run everything on your own GPU with Ollama, or connect to OpenAI, Anthropic, Google, Groq, OpenRouter, or Mistral when you need it. Your data stays on your machine unless you choose otherwise.
- **Zero Configuration.** Crystal auto-starts Ollama, the OpenClaw gateway, and all voice servers on launch. The onboarding wizard handles the rest.
- **Actually Useful.** Crystal isn't a chatbot wrapper. It creates files, runs shell commands, manages your system, automates workflows, generates images, controls a browser, monitors hardware, and manages distributed agent nodes — through natural language or voice.
- **NVIDIA-Accelerated Voice.** GPU-powered speech recognition (Nemotron/Parakeet) and synthesis (Magpie) with automatic fallback to Whisper, Kokoro, or browser APIs.

---

## Features

### AI Chat

Full-featured conversation interface with multi-conversation sidebar, Markdown rendering, syntax-highlighted code blocks, streaming typewriter responses, live TPS counter, and thinking level control.

**6 Built-In Tools:**

| Tool | Description |
|------|-------------|
| `shell` | Execute any shell command |
| `read_file` | Read file contents from any path |
| `write_file` | Create or overwrite files |
| `list_directory` | Browse directory contents |
| `web_search` | Search the web (top 5 results) |
| `web_fetch` | Fetch and read any URL |

**60+ Slash Commands** — type `/` to access navigation, model switching, thinking levels (`/think high`, `/fast on`), session export, debug tools, sub-agent management, approval workflows, and more.

**Interactive Action Buttons** — The AI renders clickable buttons in responses (navigate views, enable plugins, run commands, copy text) so you can act on suggestions instantly.

**File Attachments** — Drag-and-drop or paste images, audio, video, documents (txt, md, code, pdf), up to 25 MB.

**Image Generation** — Ask Crystal to create images and it routes to DALL·E via the `openai-image-gen` skill.

---

### Dashboard

Futuristic bird's-eye view of your entire system with Apple-level polish and micro-interactions:

- **System Performance** — Animated SVG ring gauges for CPU, RAM, and Storage with color-coded thresholds and hover scale animations
- **Lifetime Tokens** — Radial burst visualization aggregating session token usage with hover rotation effect
- **CPU & Memory Trends** — Smooth bezier sparkline charts with gradient fills, glowing endpoints, and live percentage readouts
- **Cron Jobs** — Mini bar chart (active/disabled/failed) with one-click navigation to the scheduler
- **Stats Tiles** — Sessions, Agents, Skills, Heartbeat — each with hover lift, glow, and press feedback
- **Memory Dot Matrix** — Visual grid of stored memory chunks
- **Dual LLM Display** — Shows both hosted model (OpenAI logo + model name) and local model (Ollama logo + running model) with independent connection status dots
- **Uptime & Version** — System uptime with OpenClaw version badge
- **Telegram Topics** — Topic tags with cron delivery counts and hover highlights
- **Security** — Audit status card with glow progress bar and navigation chevron
- **PC Optimizer** — 12 one-click system optimizations with per-button hover/press animations and result indicators
- **GPU Monitor** — NVIDIA-branded card with ring gauge utilization, VRAM glow bar, temperature/power metric chips, and status indicator
- **Status Pills** — Gateway and Telegram connection indicators with pulsing dots when disconnected

---

### Voice Engine

Crystal ships with a multi-provider voice architecture that automatically selects the best available engine.

**Speech-to-Text (3 providers):**

| Provider | Engine | Details |
|----------|--------|---------|
| **NVIDIA Nemotron** | Parakeet ASR | GPU-accelerated, port 8090, lowest latency |
| **Whisper** | OpenAI Whisper | Local, configurable model (tiny → large-v3) |
| **Browser** | Web Speech API | Zero-setup fallback |

**Text-to-Speech (3 providers):**

| Provider | Engine | Details |
|----------|--------|---------|
| **NVIDIA Magpie** | Magpie TTS | GPU-accelerated, port 8091, natural voice |
| **Kokoro** | Kokoro TTS | Local, port 8081 |
| **Browser** | Web Speech API | Zero-setup fallback |

**Voice Orb** — Animated button with state-aware gradients and ring animations across 9 states: idle, listening, processing, thinking, transcribing, awaiting confirmation, executing, speaking, and error.

**Voice Calls** — Dedicated VoiceCall view with notify/converse modes, expose controls (serve/funnel/off), and call history.

---

### Multi-Provider LLM

Crystal supports 7 LLM providers. Manage API keys visually in Settings and switch models on the fly.

| Provider | Type |
|----------|------|
| **Ollama** | Local (default) |
| **OpenAI** | Cloud API |
| **Anthropic** | Cloud API |
| **Google** | Cloud API |
| **OpenRouter** | Cloud API (multi-model) |
| **Groq** | Cloud API (fast inference) |
| **Mistral** | Cloud API |

AI configuration includes temperature (0–2), max tokens, context window, system prompt editing, and thinking level control (auto, minimal, medium, high).

---

### Software Factory

Two-tab view for skills and autonomous builds:

**Skills Tab** — Browse and launch all OpenClaw workspace and bundled skills:
- Searchable grid with eligibility indicators and missing dependency details
- One-click launch with custom prompts, dispatched via OpenClaw agents
- Skill detail panel with full description, dependencies, and documentation links

**Projects Tab** — Create projects and dispatch coding agents:
- Supports any agent ID (claude-code, cortex, main, research, etc.)
- Stream live logs, cancel active runs, browse run workspace files

---

### Agent Workspace

Edit 9 agent identity and behavior files with a visual editor:

| File | Purpose |
|------|---------|
| `AGENTS.md` | Agent definitions and routing |
| `SOUL.md` | Core personality and values |
| `IDENTITY.md` | Name, role, capabilities |
| `USER.md` | User preferences and context |
| `TOOLS.md` | Available tools and permissions |
| `MEMORY.md` | Curated long-term memory |
| `BOOT.md` | Startup instructions |
| `BOOTSTRAP.md` | First-run initialization |
| `HEARTBEAT.md` | Recurring autonomous behavior |

Includes presets and standing orders with program, authority, trigger, approval gate, and escalation configuration.

---

### ClawHub & Marketplace

Four-tab marketplace for extending Crystal:

- **Skills** — Browse 51+ OpenClaw skills. Filter by status (All, Ready, No API Key). Toggle enable/disable. View source, dependencies, and homepage links. macOS-only skills auto-hidden on Windows.
- **Plugins** — Browse and toggle OpenClaw plugins. Run diagnostics with `openclaw plugins doctor`.
- **Power Up** — One-click setup: enables every disabled plugin and skill, runs security audit with auto-fix, reindexes memory. Per-step progress with expandable output.
- **ClawHub** — Search and install skills from the registry. Publish your own skills (slug, name, version, tags, path, changelog). Sync installed skills with dry-run preview.

---

### Command Center

Unified hub for workflows, scheduling, and automation:

- **Calendar** — Visual schedule overview with delivery target badges (shows which Telegram topic each job posts to)
- **Workflows** — 12 skill-based templates across 6 categories (Finance, Home, Development, System, Research, Productivity) plus custom workflow builder with `{{INPUT}}` template variables
- **Cron Jobs** — Schedule recurring AI tasks with cron expressions. 6 quick templates, interactive syntax reference, per-job run/enable/disable/remove, delivery target labels
- **Heartbeat** — Configure autonomous agent behavior

---

### Channel Integrations

Connect Crystal to 11 messaging platforms:

| Channel | Type |
|---------|------|
| WhatsApp | Web bridge |
| Telegram | Bot API |
| Discord | Bot with voice, threads, reactions |
| Slack | Workspace bot |
| Signal | End-to-end encrypted |
| Google Chat | Workspace integration |
| Email | IMAP/SMTP monitoring |
| Matrix | Federated messaging |
| IRC | Classic IRC |
| Linear | Issue tracker |
| Nostr | Decentralized protocol |

Per-channel: add/remove, login/logout, view capabilities, configure tokens, resolve contacts/groups.

---

### GPU & System Monitoring

**GPU Monitor** (via `nvidia-smi`, polled every 30s):
- NVIDIA-branded card with green accent, hover lift, and glow shadow
- GPU utilization — animated ring gauge with spring-eased hover scale
- VRAM — used/total GB with gradient glow bar (blue → yellow → red thresholds)
- Temperature — metric chip with color-coded value (green < 60°C, yellow < 80°C, red above)
- Power draw — metric chip with watts/limit and gradient progress bar
- Active/Error status indicator with pulse animation

**System Monitor** (polled every 30s):
- CPU, RAM, Storage — SVG ring gauges with animated stroke transitions
- CPU & Memory trend sparklines with bezier curves and gradient fills
- Uptime display with OpenClaw version

---

### OpenShell Sandbox

Crystal integrates [NVIDIA OpenShell](https://github.com/NVIDIA/OpenShell) for secure, sandboxed agent execution. Toggle it on/off from **Settings → OpenShell Sandbox**.

| Feature | Details |
|---------|---------|
| **One-click toggle** | Enable/disable sandbox mode without leaving Crystal |
| **Auto-provisioning** | Creates an OpenClaw sandbox from the community image on first enable |
| **Docker detection** | Pre-checks that Docker is running before creating sandboxes |
| **Graceful fallback** | If sandbox creation fails, config reverts automatically — nothing breaks |
| **Sandbox monitoring** | View active sandboxes, status indicators, and tail logs from the panel |

**Protection layers when enabled:**

| Layer | What It Does |
|-------|-------------|
| Filesystem | Agents can only access allowed paths |
| Network | All outbound blocked by default; whitelist via YAML policy |
| Process | No privilege escalation; dangerous syscalls blocked (seccomp) |
| Inference | LLM calls routed through privacy-aware proxy |

**Requirements:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) must be installed and running. Install OpenShell via `uv tool install -U openshell` or use the in-app install button.

---

### Security

- **Security Audit** — Standard and deep scan modes with pass/warn/fail scoring
- **Auto Fix** — One-click remediation for detected issues
- **Tool Permissions** — View and manage allowed/denied tool policies
- **Gateway Auth** — Authentication status and configuration
- **Secrets Management** — Reload secrets from vault
- **Approval Rules** — Auto/manual execution approval policies
- **Memory Reindex** — Rebuild the memory index

---

### Agent Management

- **Office** — Live agent dashboard showing all real OpenClaw agents with identity, emoji, model, running tasks, recent sessions, token usage, and task dispatch
- **Agents Hub** — List, create, and delete OpenClaw agents. View model, workspace, and routes per agent
- **Tasks** — Background task monitoring with filtering by status and kind. Audit and maintenance controls
- **Approvals** — Exec approval management with allowlist configuration per agent
- **Sub-Agents & ACP** — Unified view for spawning, steering, and managing sub-agents and ACP sessions (Codex, Claude Code, Gemini CLI)

---

### Memory

- **Knowledge Base** — Browse, view, and edit all workspace `.md` files (SOUL.md, USER.md, AGENTS.md, TOOLS.md, etc.) with category filtering (Identity, System, Operations, Security, Domain)
- **Tiered Memory** — Visual HOT → WARM → COLD memory hierarchy showing active context, stable facts, and long-term archive with installed memory skills
- **Curated Memory** — View, add, and delete entries in `MEMORY.md`
- **Daily Memory** — Browse daily memory logs with automatic cron capture (11 PM daily)
- **Semantic Search** — Search across all memory entries
- **Vector DB** — LanceDB configuration, similarity search, and embedding stats
- **Reindex** — Rebuild the memory index with stats

---

### Multi-Node Orchestration

Manage distributed OpenClaw nodes:
- List nodes with status indicators (running/stopped/idle)
- Run or invoke individual nodes with custom prompts
- Broadcast messages to all nodes
- Notify nodes of events

---

### Browser Automation

Control a headless browser through OpenClaw's `browser-use` skill:
- Start/stop browser instances
- Navigate URLs, open tabs
- View and filter all open tabs
- Capture screenshots
- Auth token auto-loaded from config

---

### Webhooks

- Create and manage webhook endpoints
- View incoming webhook events
- Configure webhook routing and handlers

---

### Messaging & Directory

- **Messaging** — Unified messaging view across connected channels
- **Directory** — Contact directory with search and channel resolution
- **Devices** — Connected device management

---

### Activity & Logs

- **Activity Feed** — Real-time event stream from the OpenClaw gateway. Filter by type (Chat, Tool Call, Tool Result, Error, Heartbeat). Color-coded entries.
- **Gateway Logs** — Raw log viewer with auto-refresh, search highlighting, log level coloring (ERROR/WARN/INFO/DEBUG), line numbers, copy-all.

---

### Hooks

Event-driven lifecycle hooks for the OpenClaw agent:
- List installed hooks with enable/disable toggles
- Expandable detail panels (description, triggers, config)
- Install new hooks by spec
- Bulk update and eligibility checks

---

### Doctor / Diagnostics

| Command | Description |
|---------|-------------|
| Doctor | Basic system check |
| Deep Scan | Comprehensive diagnostic |
| Auto Fix | Automatic remediation |
| Status | Overall system status |
| Gateway Health | Connectivity check |
| Config Validate | Configuration validation |

Terminal-style output with color-coded results and summary cards (Passed / Warnings / Failed).

---

### Sessions

- Browse all active agent sessions sorted by recency
- Per-session: agent ID, model provider, model name, description
- Token usage stats (input, output, total)
- Context window usage bar (color-coded at 60%/85%)
- Per-session delete and bulk cleanup

---

## Themes

6 built-in themes with visual preview swatches:

| Theme | Style | Accent |
|-------|-------|--------|
| **Midnight** | Deep dark | Blue |
| **SoCal** | Warm sunset | Orange |
| **Arctic** | Clean light | Sky blue |
| **Ember** | Dark warm glow | Red |
| **Slate** | Soft light | Indigo |
| **NVIDIA** | Dark with green | NVIDIA Green |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl + Space` | Toggle Crystal window (global) |
| `Ctrl + K` | Command palette (with AI-powered search) |
| `Ctrl + N` | New conversation |
| `Ctrl + ,` | Settings |
| `Ctrl + Shift + D` | Doctor |
| `Ctrl + Shift + S` | Security |
| `Ctrl + 1–9` | Switch between views |
| `/` | Slash command menu (in chat) |
| `Enter` | Send message |
| `Shift + Enter` | New line in message |

---

## Onboarding

First-run wizard with 5 steps:

1. **Welcome** — Introduction with Crystal branding
2. **Prerequisites** — Auto-checks Node.js, Ollama, OpenClaw, NVIDIA GPU
3. **LLM Setup** — Pick from installed models or pull a new one
4. **Gateway** — Verify/start the OpenClaw gateway on port 18789
5. **Launch** — Summary of checks, selected model, and gateway status

---

## Performance

Crystal is engineered to feel instant:

- **Lazy-loaded views** — All 30 views use `React.lazy()` + `Suspense`. Only the active view's code is loaded.
- **CLI response caching** — Shared cache with TTL deduplicates OpenClaw CLI calls across views.
- **Visibility-aware polling** — GPU monitor, system monitor, and model poller pause when hidden. Zero background work on inactive tabs.
- **Vendor bundle splitting** — React, markdown rendering, and animation libraries cached as separate chunks.
- **Fine-grained state subscriptions** — Zustand selectors prevent unnecessary re-renders across all components.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Runtime | [Tauri 2.0](https://v2.tauri.app/) (~3 MB runtime) |
| Frontend | React 19, TypeScript, Tailwind CSS 4, Zustand |
| Backend | Rust (Tokio, Reqwest, Serde) |
| AI Agent | [OpenClaw](https://github.com/nichochar/open-claw) |
| LLM (Local) | [Ollama](https://ollama.com/) |
| LLM (Cloud) | OpenAI, Anthropic, Google, OpenRouter, Groq, Mistral |
| Voice STT | NVIDIA Nemotron, Whisper, Web Speech API |
| Voice TTS | NVIDIA Magpie, Kokoro, Web Speech API |
| Image Gen | OpenAI DALL·E (via OpenClaw skill) |
| Sandbox | [NVIDIA OpenShell](https://github.com/NVIDIA/OpenShell) *(optional)* |
| Icons | Lucide React |
| Markdown | react-markdown + remark-gfm + rehype-highlight |
| Animations | Framer Motion |

---

## Requirements

| Requirement | Details |
|-------------|---------|
| **OS** | Windows 10/11 (macOS/Linux planned) |
| **GPU** | NVIDIA RTX with 16 GB+ VRAM recommended (for local LLM + voice) |
| **Node.js** | v18+ |
| **Package Manager** | pnpm |
| **Rust** | Latest stable toolchain |
| **Ollama** | Installed with at least one model pulled |
| **Python** | 3.10+ *(optional, for Whisper/Kokoro voice servers)* |
| **Docker** | Docker Desktop *(optional, required for OpenShell sandbox mode)* |

> **Cloud-only mode:** If you don't have an NVIDIA GPU, you can still use Crystal with cloud LLM providers and browser-based voice. Set your API keys in Settings and you're good to go.

---

## Quick Start

### 1. Install prerequisites

```bash
# Ollama: https://ollama.com/download
# Node.js: https://nodejs.org
# Rust:    https://rustup.rs
# pnpm:    npm install -g pnpm

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

Crystal auto-starts Ollama, the OpenClaw gateway, and voice servers on launch. The onboarding wizard walks you through everything else.

### 4. Voice setup *(optional)*

```bash
pip install -r scripts/requirements.txt
```

Crystal auto-launches Whisper STT and Kokoro TTS servers on startup when Python is available. NVIDIA Nemotron/Magpie servers start automatically if an RTX GPU is detected.

### 5. Cloud LLM setup *(optional)*

Open **Settings → API Keys** and add keys for any providers you want to use (OpenAI, Anthropic, Google, OpenRouter, Groq, Mistral).

---

## Project Structure

```
Crystal/
├── src/                              # React frontend
│   ├── components/
│   │   ├── shell/                    # TitleBar, Navigation, CommandPalette (AI-powered), Onboarding, Toast
│   │   ├── views/                    # 30 feature views
│   │   ├── voice/                    # VoiceOrb, TranscriptPanel, ConfirmationCard, EventLog
│   │   ├── factory/                  # DirectoryBrowser, FileTree, FileViewer, RunWorkspace
│   │   └── widgets/                  # GpuMonitor
│   ├── hooks/                        # useOpenClaw, useVoice, useStorage, useKeyboardShortcuts
│   ├── lib/
│   │   ├── agent.ts                  # AI agent (system prompt, tool loop, action buttons, image gen)
│   │   ├── openclaw.ts               # OpenClaw client (gateway, LLM, memory, channels, config)
│   │   ├── tools.ts                  # Tool implementations (shell, files, web)
│   │   ├── cache.ts                  # CLI response cache with TTL + deduplication
│   │   ├── factory.ts                # Factory agent runner (any agent ID)
│   │   ├── search-ai.ts              # AI-powered command palette search (GPT-4o-mini)
│   │   ├── workflows.ts              # 12 skill-based workflow definitions
│   │   ├── voice.ts                  # Voice service orchestration
│   │   ├── voice/                    # Voice provider architecture
│   │   │   ├── providers/            # NVIDIA Nemotron, Whisper, Kokoro, Magpie, Browser
│   │   │   ├── bridge/               # Speech bridge
│   │   │   ├── state-machine.ts      # 9-state voice FSM
│   │   │   ├── intent-router.ts      # Voice intent classification
│   │   │   ├── conversation-agent.ts # Voice conversation handler
│   │   │   └── session-store.ts      # Voice session persistence
│   │   ├── marketplace.ts            # Skill/plugin catalog
│   │   └── storage.ts                # Local storage abstraction
│   └── stores/
│       ├── appStore.ts               # App state (view, voice, gateway, thinking level)
│       ├── themeStore.ts             # 6 themes with CSS variable mapping
│       ├── dataStore.ts              # Data caching layer (8 cache entries: cron, agents, memory, system, tasks, channels, skills, sessions)
│       └── factoryStore.ts           # Factory project/run state (dynamic agent types)
├── src-tauri/                        # Rust backend
│   ├── src/
│   │   ├── lib.rs                    # 13 Tauri commands, server lifecycle, system tray
│   │   └── main.rs                   # Entry point
│   ├── icons/                        # App icons (all sizes + .ico + .icns)
│   └── tauri.conf.json               # Tauri configuration
├── scripts/                          # Voice server scripts
│   ├── whisper_server.py             # Whisper STT server
│   ├── tts_server.py                 # Kokoro TTS server
│   ├── requirements.txt              # Python dependencies
│   ├── setup.ps1                     # Full setup script
│   └── start-all.ps1                 # Manual service launcher
└── public/                           # Static assets
    └── icon.png                      # Crystal icon
```

---

## By the Numbers

| | Count |
|---|---|
| Views | 30 |
| Slash commands | 60+ |
| Voice providers | 6 (3 STT + 3 TTS) |
| LLM providers | 7 |
| Themes | 6 |
| Tools | 6 |
| Channel integrations | 11 |
| Workspace files | 9 |
| Workflow templates | 12 |
| Workflow categories | 6 |
| Cron templates | 6 |
| Telegram topics | 5 |
| Diagnostic commands | 6 |
| Keyboard shortcuts | 10 |
| Tauri commands | 13 |
| OpenClaw skills | 51+ |
| Data cache entries | 8 |

---

## Contributing

Contributions are welcome. Please open an issue first to discuss changes.

```bash
# Development with hot reload
pnpm tauri dev

# Production build
pnpm tauri build
```

---

## License

MIT

---

<p align="center">
  <sub>Built with Tauri, React, Rust, and OpenClaw.<br/>Local-first. Cloud-optional. Yours to own.</sub>
</p>
