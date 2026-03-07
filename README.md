<p align="center">
  <img src="public/icon.png" width="120" alt="Crystal Logo" />
</p>

<h1 align="center">Crystal</h1>

<p align="center">
  <strong>Your personal AI that runs entirely on your machine.</strong><br/>
  The most complete desktop frontend for <a href="https://github.com/nichochar/open-claw">OpenClaw</a> — voice-first, GPU-accelerated, zero cloud dependency.
</p>

<p align="center">
  <a href="#features"><img src="https://img.shields.io/badge/Views-18%20Built--In-blue?style=flat-square" alt="Views" /></a>
  <a href="#requirements"><img src="https://img.shields.io/badge/GPU-NVIDIA%20RTX-76b900?style=flat-square&logo=nvidia" alt="NVIDIA" /></a>
  <a href="#tech-stack"><img src="https://img.shields.io/badge/Tauri-2.0-24c8db?style=flat-square&logo=tauri" alt="Tauri" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT" /></a>
</p>

---

## Why Crystal?

Most AI tools send your data to someone else's server. Crystal doesn't. It's a native desktop app that connects your local LLM (via Ollama) to OpenClaw's autonomous agent framework — giving you a personal AI assistant that can actually *do things* on your computer, not just chat.

- **Nothing leaves your machine.** Your conversations, files, and system data stay local.
- **No subscriptions.** Run any open-weight model on your own GPU.
- **One-click everything.** Crystal auto-starts Ollama, the OpenClaw gateway, and voice servers. Open the app and go.

---

## Features

### AI Chat with Tool Use
Markdown-rendered conversations with an agent that can create files, run shell commands, search your memory, and execute multi-step workflows — all through natural language.

### OpenClaw Integration
Full frontend for the OpenClaw agent framework. Manage skills, plugins, agents, channels, sessions, memory, hooks, cron jobs, security, and nodes — all from one UI.

### System Dashboard & PC Optimizer
Live GPU, CPU, RAM, and disk monitoring. One-click system optimization: flush DNS, clear temp files, manage startup apps, reset network stack, run Defender scans, and more.

### Voice-First
Wake word detection, speech-to-text (Whisper), and text-to-speech — all running locally. Talk to Crystal like Jarvis.

### 18 Specialized Views

| View | What it does |
|------|-------------|
| **Home** | Dashboard with system stats, GPU monitor, quick actions, PC optimizer |
| **Chat** | AI conversation with tool use, slash commands, markdown rendering |
| **Models** | Browse, pull, delete, and benchmark Ollama models |
| **Marketplace** | Install and manage OpenClaw skills and plugins |
| **Templates** | Pre-built and custom automation workflows |
| **Agents** | Configure and manage OpenClaw agents |
| **Channels** | Connect WhatsApp, Telegram, Discord, Slack, Signal, and more |
| **Memory** | View and search the agent's curated + daily memory |
| **Sessions** | Browse and manage conversation sessions |
| **Tools** | View all registered tools and their schemas |
| **Activity** | Real-time agent activity log with auto-refresh |
| **Cron** | Schedule recurring agent tasks with templates |
| **Security** | Audit, approvals, secrets management |
| **Hooks** | Manage event-driven agent hooks |
| **Browser** | OpenClaw browser automation (browser-use) |
| **Nodes** | Multi-node agent orchestration |
| **Doctor** | Diagnostics and health checks |
| **Settings** | LLM config, themes, gateway token, system prompt |

### Performance Optimized
- **Lazy-loaded views** — only the active tab's code is loaded
- **CLI response caching** — repeated OpenClaw commands return cached results
- **Visibility-aware polling** — background monitors pause when their tab is hidden
- **Vendor bundle splitting** — React, markdown, and animation libraries cached separately

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Runtime | [Tauri 2.0](https://v2.tauri.app/) |
| Frontend | React 19, TypeScript, Zustand, Tailwind CSS |
| Backend | Rust (tokio, reqwest, serde) |
| AI Agent | [OpenClaw](https://github.com/nichochar/open-claw) |
| LLM Inference | [Ollama](https://ollama.com/) (local) |
| Voice STT | Whisper (local, optional) |
| Voice TTS | Kokoro TTS (local, optional) |

---

## Requirements

- **Windows 10/11** (macOS/Linux planned)
- **NVIDIA GPU** with 16GB+ VRAM (RTX 4070 Ti or better recommended)
- **Node.js 18+** and **pnpm**
- **Rust** toolchain (for Tauri)
- **Ollama** installed with at least one model
- **Python 3.10+** *(optional — for voice features)*

---

## Quick Start

### 1. Install Ollama and pull a model

```bash
# https://ollama.com/download
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

Crystal auto-starts Ollama and the OpenClaw gateway. No manual server management needed.

### 4. Voice setup *(optional)*

```powershell
pip install -r scripts/requirements.txt
```

Crystal auto-launches Whisper and TTS servers on startup if Python is available.

---

## Project Structure

```
Crystal/
├── src/                        # React frontend
│   ├── components/
│   │   ├── shell/              # TitleBar, Navigation, CommandPalette
│   │   ├── views/              # 18 feature views
│   │   ├── voice/              # VoiceOrb component
│   │   └── widgets/            # GpuMonitor, etc.
│   ├── hooks/                  # useOpenClaw, useVoice, useStorage
│   ├── lib/                    # Agent brain, OpenClaw client, tools, cache
│   └── stores/                 # Zustand state (app, theme)
├── src-tauri/                  # Rust backend
│   └── src/lib.rs              # Commands, server lifecycle, file ops
├── scripts/                    # Voice server scripts
│   ├── whisper_server.py       # Whisper STT server
│   ├── tts_server.py           # Kokoro TTS server
│   └── requirements.txt        # Python dependencies
└── public/                     # Static assets (icon, etc.)
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl + Space` | Toggle Crystal window (global) |
| `Ctrl + K` | Command palette |
| `Ctrl + Shift + M` | Activate voice input |

---

## Configuration

### Switch models
Use the **Models** tab to browse, pull, and set your active model — or from the terminal:

```bash
ollama pull llama3.1:70b
```

### Themes
Crystal ships with 5 built-in themes. Switch in **Settings > Appearance**.

### System prompt
Customize the agent's personality and instructions in **Settings > System Prompt**.

---

## Contributing

Contributions welcome. Please open an issue first to discuss what you'd like to change.

```bash
# Dev mode with hot reload
pnpm tauri dev
```

---

## License

MIT

---

<p align="center">
  <sub>Built with Tauri, React, Rust, and OpenClaw. Runs on your hardware, not ours.</sub>
</p>
