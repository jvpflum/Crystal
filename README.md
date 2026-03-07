# Mogwai - Voice-First Local AI Assistant

A beautiful, voice-first AI assistant that runs 100% locally on your NVIDIA GPU. Like having your own personal Jarvis.

![Mogwai](https://img.shields.io/badge/AI-Local%20First-blue)
![GPU](https://img.shields.io/badge/GPU-NVIDIA%205090-green)
![License](https://img.shields.io/badge/License-MIT-yellow)

## Features

- **Voice-First Interaction** - Talk to your AI naturally with wake word detection
- **100% Local** - All AI processing happens on your machine, your data never leaves
- **Tool Integration** - Execute shell commands, manage files, search the web
- **Templates & Workflows** - Pre-built automation for common tasks
- **Skill Marketplace** - Extend capabilities with installable skills
- **Glass UI** - Beautiful, modern glassmorphism interface

## Requirements

- **Windows 10/11** (macOS/Linux support planned)
- **NVIDIA GPU** with 24GB+ VRAM (RTX 4090, 5090, etc.)
- **Ollama** installed with a model pulled (e.g. `ollama pull gpt-oss:20b`)
- **Node.js 18+** and pnpm
- **Rust** (for Tauri)
- **Python 3.10+** (optional, for voice features)

## Quick Start

### 1. Install Ollama & Pull a Model

```powershell
# Install Ollama from https://ollama.com
# Then pull a model:
ollama pull gpt-oss:20b
```

### 2. Install Dependencies

```bash
cd mogwai
pnpm install
```

### 3. Setup Voice (Optional)

Voice features require Python 3.10+:

```powershell
.\scripts\setup.ps1
```

### 4. Start Mogwai

```bash
pnpm tauri dev
```

Mogwai auto-starts Ollama and voice servers. No manual server management needed.

## Architecture

```
+-----------------------------------------------------+
|                    Mogwai App                        |
|  +-----------------------------------------------+  |
|  |              Tauri (Desktop)                   |  |
|  |  +-----------------------------------------+  |  |
|  |  |         React + TypeScript              |  |  |
|  |  |  - Glass UI Components                  |  |  |
|  |  |  - Voice Orb                            |  |  |
|  |  |  - Chat Interface                       |  |  |
|  |  |  - Templates & Tools                    |  |  |
|  |  +-----------------------------------------+  |  |
|  |  +-----------------------------------------+  |  |
|  |  |            Rust Backend                 |  |  |
|  |  |  - File System Access                   |  |  |
|  |  |  - Shell Execution                      |  |  |
|  |  |  - System Tray                          |  |  |
|  |  |  - Server Auto-Start                    |  |  |
|  |  +-----------------------------------------+  |  |
|  +-----------------------------------------------+  |
+-----------------------------------------------------+
                         |
                         v
+-----------------------------------------------------+
|              Local AI Services                      |
|  +-------------+  +-------------+  +-------------+  |
|  |   Ollama    |  |  Whisper    |  |    TTS      |  |
|  |  :11434     |  |   :8080     |  |   :8081     |  |
|  |             |  |             |  |             |  |
|  | gpt-oss:20b |  | large-v3    |  |  Kokoro     |  |
|  +-------------+  +-------------+  +-------------+  |
+-----------------------------------------------------+
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Space` | Toggle Mogwai window (global) |
| `Ctrl+Shift+M` | Activate voice input |

## Project Structure

```
mogwai/
├── src/                    # React frontend
│   ├── components/         # UI components
│   │   ├── shell/         # TitleBar, Navigation
│   │   ├── views/         # Main views (Chat, Settings, etc.)
│   │   └── voice/         # VoiceOrb
│   ├── hooks/             # React hooks
│   ├── lib/               # Core services
│   │   ├── agent.ts       # AI agent loop
│   │   ├── openclaw.ts    # LLM client (Ollama / LM Studio)
│   │   ├── tools.ts       # Tool definitions
│   │   ├── voice.ts       # Voice service
│   │   ├── templates.ts   # Workflow templates
│   │   └── marketplace.ts # Skills marketplace
│   └── stores/            # Zustand state
├── src-tauri/             # Rust backend
│   └── src/lib.rs         # Tauri commands + server management
├── scripts/               # Server scripts
│   ├── start-all.ps1      # Start all services (manual/debug)
│   ├── start-whisper.ps1  # Whisper STT
│   ├── start-tts.ps1      # TTS server
│   └── requirements.txt   # Python deps
└── package.json
```

## Configuration

### Changing the Model

Use the Settings view in Mogwai to switch between installed Ollama models, or pull new ones:

```powershell
ollama pull qwen2.5:32b
ollama pull gpt-oss:20b
```

### Changing Whisper Model

```powershell
.\scripts\start-whisper.ps1 -Model "medium"  # Options: tiny, base, small, medium, large-v3
```

## Troubleshooting

### "LLM not connected"
Make sure Ollama is running:
```powershell
ollama serve
```

### "Voice server offline"
Mogwai auto-starts voice servers if Python is installed. If they're still offline:
```powershell
.\scripts\setup.ps1   # Install Python deps
```

### Build errors
```bash
pnpm clean
pnpm install
pnpm tauri build
```

## License

MIT License - see LICENSE file for details.

---

Made with care by taming the Gremlin into a friendly Mogwai
