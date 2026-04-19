# Security Policy

## Supported versions

Crystal is under active development. Security fixes are applied to the latest release only.

| Version | Supported |
|---------|-----------|
| Latest  | ✅        |
| Older   | ❌        |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, email the details to `security@juiceclaw.dev` with:

- A clear description of the vulnerability
- Steps to reproduce
- Affected version(s)
- Any suggested mitigation

We aim to acknowledge receipt within 48 hours and ship a fix within 7 days for critical issues.

## Security-conscious defaults

Crystal ships with several safeguards by default:

- **Secrets**: API keys are stored in `~/.openclaw/agents/main/agent/auth-profiles.json` and can be referenced via 1Password (`op://...`) via the 1Password CLI. Plaintext keys are supported but discouraged.
- **Gateway**: The OpenClaw gateway binds to `127.0.0.1` by default and requires a bearer token for HTTP access.
- **Sandbox**: Agent command execution can be routed through NVIDIA OpenShell sandboxes when enabled in `openclaw.json`.
- **Path safety**: Tauri file operations are restricted to the user's home directory.
- **CSP**: The app uses a strict Content-Security-Policy in Tauri configuration.

## Responsible disclosure

We credit reporters in release notes unless anonymity is requested. We ask that you:

- Do not publicly disclose until a fix is released
- Do not access, modify, or exfiltrate data that isn't yours
- Do not run denial-of-service tests against production systems

Thank you for helping keep Crystal secure.
