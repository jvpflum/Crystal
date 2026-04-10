"""
Crystal Voice Pipeline — Unified Launcher

Starts all voice servers (NVIDIA STT + TTS) in a single process with proper
health monitoring and graceful shutdown.

Usage:
  python scripts/start_voice_servers.py
  python scripts/start_voice_servers.py --stt-only
  python scripts/start_voice_servers.py --tts-only
  python scripts/start_voice_servers.py --stt-port 8090 --tts-port 8091

Environment variables (override defaults):
  NVIDIA_STT_PORT   — STT server port (default: 8090)
  NVIDIA_TTS_PORT   — TTS server port (default: 8091)
  NVIDIA_STT_MODEL  — STT model name (default: nvidia/parakeet-ctc-0.6b)
"""

import os
import sys
import time
import signal
import argparse
import subprocess
import threading
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent
STT_SCRIPT = SCRIPTS_DIR / "nvidia_stt_worker.py"
TTS_SCRIPT = SCRIPTS_DIR / "nvidia_tts_worker.py"

DEFAULT_STT_PORT = int(os.environ.get("NVIDIA_STT_PORT", "8090"))
DEFAULT_TTS_PORT = int(os.environ.get("NVIDIA_TTS_PORT", "8091"))

processes: list[subprocess.Popen] = []
shutdown_event = threading.Event()


def start_server(script: Path, port: int, name: str) -> subprocess.Popen:
    env = os.environ.copy()
    if "STT" in name:
        env["NVIDIA_STT_PORT"] = str(port)
    else:
        env["NVIDIA_TTS_PORT"] = str(port)

    proc = subprocess.Popen(
        [sys.executable, str(script)],
        env=env,
        stdout=sys.stdout,
        stderr=sys.stderr,
    )
    print(f"[Launcher] Started {name} (PID {proc.pid}) on port {port}")
    return proc


def wait_for_health(port: int, name: str, timeout: int = 120) -> bool:
    """Poll /health until the server responds OK or timeout."""
    import urllib.request
    import urllib.error

    url = f"http://127.0.0.1:{port}/health"
    start = time.time()

    while time.time() - start < timeout:
        if shutdown_event.is_set():
            return False
        try:
            resp = urllib.request.urlopen(url, timeout=2)
            if resp.status == 200:
                print(f"[Launcher] {name} is healthy on port {port}")
                return True
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(1)

    print(f"[Launcher] WARNING: {name} did not become healthy within {timeout}s")
    return False


def signal_handler(signum, frame):
    print(f"\n[Launcher] Received signal {signum}, shutting down...")
    shutdown_event.set()
    for proc in processes:
        try:
            proc.terminate()
        except OSError:
            pass


def main():
    parser = argparse.ArgumentParser(description="Crystal Voice Pipeline Launcher")
    parser.add_argument("--stt-port", type=int, default=DEFAULT_STT_PORT)
    parser.add_argument("--tts-port", type=int, default=DEFAULT_TTS_PORT)
    parser.add_argument("--stt-only", action="store_true", help="Only start STT server")
    parser.add_argument("--tts-only", action="store_true", help="Only start TTS server")
    parser.add_argument("--no-health-check", action="store_true", help="Skip health check wait")
    args = parser.parse_args()

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    print("=" * 60)
    print("  Crystal Voice Pipeline")
    print("=" * 60)

    start_stt = not args.tts_only
    start_tts = not args.stt_only

    if start_stt:
        if not STT_SCRIPT.exists():
            print(f"[Launcher] ERROR: STT script not found: {STT_SCRIPT}")
            sys.exit(1)
        proc = start_server(STT_SCRIPT, args.stt_port, "NVIDIA STT")
        processes.append(proc)

    if start_tts:
        if not TTS_SCRIPT.exists():
            print(f"[Launcher] ERROR: TTS script not found: {TTS_SCRIPT}")
            sys.exit(1)
        proc = start_server(TTS_SCRIPT, args.tts_port, "NVIDIA TTS")
        processes.append(proc)

    if not args.no_health_check:
        health_threads = []
        if start_stt:
            t = threading.Thread(target=wait_for_health, args=(args.stt_port, "STT"))
            t.start()
            health_threads.append(t)
        if start_tts:
            t = threading.Thread(target=wait_for_health, args=(args.tts_port, "TTS"))
            t.start()
            health_threads.append(t)
        for t in health_threads:
            t.join()

    print()
    print("[Launcher] Voice pipeline ready:")
    if start_stt:
        print(f"  STT API:   http://127.0.0.1:{args.stt_port}")
        print(f"  STT Docs:  http://127.0.0.1:{args.stt_port}/docs")
        print(f"  STT WS:    ws://127.0.0.1:{args.stt_port}/ws")
    if start_tts:
        print(f"  TTS API:   http://127.0.0.1:{args.tts_port}")
        print(f"  TTS Docs:  http://127.0.0.1:{args.tts_port}/docs")
    print()

    # Wait for all child processes
    try:
        while not shutdown_event.is_set():
            for proc in processes:
                ret = proc.poll()
                if ret is not None:
                    print(f"[Launcher] Process {proc.pid} exited with code {ret}")
                    shutdown_event.set()
                    break
            if not shutdown_event.is_set():
                time.sleep(1)
    except KeyboardInterrupt:
        pass

    # Graceful shutdown
    for proc in processes:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()

    print("[Launcher] All servers stopped")


if __name__ == "__main__":
    main()
