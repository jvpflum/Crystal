# Contributing to Crystal

Thanks for your interest in contributing to Crystal — the desktop home base for long-running AI agents. This document covers the fastest paths to a productive contribution.

## Ways to help

- **File a bug** — open an issue with reproduction steps, logs, and your OS/GPU/driver versions
- **Suggest a feature** — open a discussion before spending time on a large PR
- **Fix a bug** — grab an issue labeled `good first issue` or `help wanted`
- **Add a skill** — Crystal ships with OpenClaw skill support; publish your skill to ClawHub
- **Improve docs** — typo fixes and clarifications are always welcome

## Development setup

### Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io) 10+
- [Rust](https://rustup.rs) stable (for the Tauri backend)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for local vLLM)
- NVIDIA GPU with 16GB+ VRAM (recommended; CPU/cloud path also supported)
- Python 3.11+ (optional; only needed for voice workers)

### Getting started

```powershell
git clone https://github.com/jvpflum/Crystal.git
cd Crystal
pnpm install
pnpm tauri dev
```

The Tauri dev server runs the frontend on port 1420 and boots the Rust backend alongside. On first launch, Crystal will attempt to start the OpenClaw gateway and vLLM container automatically.

### Useful scripts

- `pnpm tauri dev` — run the app in dev mode (hot reload)
- `pnpm tauri build` — produce a production `.msi` / installer
- `pnpm exec tsc --noEmit` — type-check the whole codebase
- `pnpm exec eslint src` — lint the frontend
- `cargo fmt` inside `src-tauri/` — format Rust code
- `cargo clippy` inside `src-tauri/` — lint Rust code

## Branch and commit conventions

- Branch off `main` with a descriptive name: `feat/voice-orb-redesign`, `fix/gateway-reconnect`
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`
- Keep PRs focused — one logical change per PR

## Code style

- **TypeScript**: strict mode on; no `any` unless you have a good reason; prefer narrow types
- **React**: function components + hooks; no class components
- **Rust**: idiomatic; prefer `Result` over `unwrap`; handle errors explicitly
- **Tests**: add them when you fix a regression or ship a new primitive

## Submitting a PR

1. Fork the repo
2. Create a feature branch
3. Make your changes with tests/docs as needed
4. Run the checks: `pnpm exec tsc --noEmit && pnpm exec eslint src`
5. Open a PR against `main` with a clear description — "what + why"

## Questions?

- Open a [discussion](https://github.com/jvpflum/Crystal/discussions)
- Ping on the OpenClaw Discord
- Reach out on X: [@juiceclaw](https://x.com/juiceclaw)

Thanks for helping build Crystal.
