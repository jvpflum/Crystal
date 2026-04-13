"""
Crystal Voice Gateway — Unified voice API that sits between OpenClaw/UI and
the NVIDIA speech services (Parakeet STT, Magpie TTS).

Architecture:
  OpenClaw / UI  ──HTTP/WS──▶  Voice Gateway (:6500)  ──HTTP/WS──▶  NVIDIA STT (:8090)
                                                        ──HTTP────▶  NVIDIA TTS (:8091)

The gateway:
  - Exposes a single clean API surface for all voice operations
  - Hides backend-specific protocols and ports
  - Provides a normalized event model with provider/latency metadata
  - Reports capabilities and readiness

Endpoints:
  POST /stt/transcribe       — batch transcription (upload audio file)
  WS   /stt/realtime         — streaming STT (push PCM, receive partials/finals)
  POST /tts/speak            — batch synthesis (text in, WAV out)
  WS   /tts/realtime         — streaming TTS (text in, audio chunks out)
  GET  /health               — gateway health + backend statuses
  GET  /ready                — readiness probe (are models loaded?)
  GET  /capabilities         — available providers, voices, languages

Usage:
  python scripts/voice_gateway.py
  VOICE_GATEWAY_PORT=6500 python scripts/voice_gateway.py
"""

import os
import json
import time
import asyncio
import logging
import httpx
from enum import Enum
from typing import Optional
from datetime import datetime

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="[VoiceGateway] %(levelname)s %(message)s")
log = logging.getLogger("voice_gateway")

PORT = int(os.environ.get("VOICE_GATEWAY_PORT", "6500"))

# ── Backend Configuration ────────────────────────────────────────

class BackendConfig:
    """URLs for each speech backend. Configurable via env vars."""

    NVIDIA_STT_URL = os.environ.get("NVIDIA_STT_URL", "http://127.0.0.1:8090")
    NVIDIA_TTS_URL = os.environ.get("NVIDIA_TTS_URL", "http://127.0.0.1:8091")

    NVIDIA_STT_WS = os.environ.get(
        "NVIDIA_STT_WS_URL",
        NVIDIA_STT_URL.replace("http://", "ws://").replace("https://", "wss://") + "/ws",
    )

# ── Normalized Event Model ───────────────────────────────────────

class SttProvider(str, Enum):
    nvidia_parakeet = "nvidia-parakeet"
    none = "none"

class TtsProvider(str, Enum):
    nvidia_magpie = "nvidia-magpie"
    none = "none"

class SttEvent(BaseModel):
    """Provider-agnostic speech-to-text event."""
    provider: str
    model: Optional[str] = None
    language: str = "en"
    text: str
    is_final: bool
    confidence: float = 0.0
    duration: Optional[float] = None
    latency_ms: Optional[float] = None
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    error: Optional[str] = None
    error_code: Optional[str] = None

class TtsRequest(BaseModel):
    """TTS synthesis request."""
    text: str
    voice: str = "sofia"
    language: str = "en"
    speed: float = 1.0
    sample_rate: int = 22050
    format: str = "wav"

class TtsEvent(BaseModel):
    """Provider-agnostic TTS event for streaming."""
    provider: str
    model: Optional[str] = None
    audio_format: str = "wav"
    sample_rate: int = 22050
    chunk_index: int = 0
    is_final: bool = False
    latency_ms: Optional[float] = None
    error: Optional[str] = None

class BackendStatus(BaseModel):
    """Health status for a single backend."""
    name: str
    url: str
    available: bool
    ready: bool = False
    model: Optional[str] = None
    detail: Optional[str] = None

class GatewayHealth(BaseModel):
    status: str
    uptime_seconds: float
    backends: dict[str, BackendStatus]

class GatewayReadiness(BaseModel):
    ready: bool
    stt_available: bool
    tts_available: bool
    preferred_stt: str
    preferred_tts: str

class GatewayCapabilities(BaseModel):
    stt_providers: list[dict]
    tts_providers: list[dict]
    voices: list[dict]
    languages: list[str]

# ── Backend Health Checker ───────────────────────────────────────

class BackendRegistry:
    """Tracks health and readiness of all speech backends."""

    def __init__(self):
        self._start_time = time.time()
        self._statuses: dict[str, BackendStatus] = {}
        self._last_check = 0.0
        self._cache_ttl = 3.0  # seconds

    @property
    def uptime(self) -> float:
        return time.time() - self._start_time

    async def check_backend(self, name: str, url: str) -> BackendStatus:
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(f"{url}/health")
                if resp.status_code == 200:
                    data = resp.json()
                    return BackendStatus(
                        name=name,
                        url=url,
                        available=True,
                        ready=data.get("ready", True),
                        model=data.get("model"),
                        detail=data.get("backend"),
                    )
                return BackendStatus(name=name, url=url, available=False, detail=f"HTTP {resp.status_code}")
        except Exception as e:
            return BackendStatus(name=name, url=url, available=False, detail=str(e))

    async def refresh(self, force: bool = False) -> dict[str, BackendStatus]:
        now = time.time()
        if not force and (now - self._last_check) < self._cache_ttl:
            return self._statuses

        results = await asyncio.gather(
            self.check_backend("nvidia-stt", BackendConfig.NVIDIA_STT_URL),
            self.check_backend("nvidia-tts", BackendConfig.NVIDIA_TTS_URL),
            return_exceptions=True,
        )

        self._statuses = {}
        for r in results:
            if isinstance(r, BackendStatus):
                self._statuses[r.name] = r

        self._last_check = now
        return self._statuses

    def resolve_stt(self) -> tuple[str, str]:
        """Return (provider_name, base_url) for the NVIDIA STT backend."""
        s = self._statuses.get("nvidia-stt")
        if s and s.available:
            return "nvidia-stt", BackendConfig.NVIDIA_STT_URL
        return "none", ""

    def resolve_tts(self) -> tuple[str, str]:
        """Return (provider_name, base_url) for the NVIDIA TTS backend."""
        s = self._statuses.get("nvidia-tts")
        if s and s.available:
            return "nvidia-tts", BackendConfig.NVIDIA_TTS_URL
        return "none", ""


registry = BackendRegistry()

# ── FastAPI Application ──────────────────────────────────────────

app = FastAPI(
    title="Crystal Voice Gateway",
    description="Unified voice API for STT and TTS, routing to NVIDIA Parakeet/Magpie with fallbacks.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    log.info("Starting Voice Gateway, checking backends...")
    await registry.refresh(force=True)
    statuses = registry._statuses
    for name, s in statuses.items():
        status_str = "READY" if s.ready else ("AVAILABLE" if s.available else "DOWN")
        log.info(f"  {name}: {status_str} ({s.url})")


# ── Health / Ready / Capabilities ────────────────────────────────

@app.get("/health", response_model=GatewayHealth)
async def health():
    statuses = await registry.refresh()
    any_up = any(s.available for s in statuses.values())
    return GatewayHealth(
        status="ok" if any_up else "degraded",
        uptime_seconds=round(registry.uptime, 1),
        backends=statuses,
    )


@app.get("/ready", response_model=GatewayReadiness)
async def ready():
    statuses = await registry.refresh()
    stt_name, _ = registry.resolve_stt()
    tts_name, _ = registry.resolve_tts()
    return GatewayReadiness(
        ready=stt_name != "none" and tts_name != "none",
        stt_available=stt_name != "none",
        tts_available=tts_name != "none",
        preferred_stt=stt_name,
        preferred_tts=tts_name,
    )


@app.get("/capabilities", response_model=GatewayCapabilities)
async def capabilities():
    statuses = await registry.refresh()

    stt_providers = []
    s = statuses.get("nvidia-stt")
    stt_providers.append({
        "id": "nvidia-stt",
        "name": "NVIDIA Parakeet",
        "available": bool(s and s.available),
        "ready": bool(s and s.ready),
        "model": s.model if s else None,
        "streaming": True,
    })

    tts_providers = []
    voices: list[dict] = []
    s = statuses.get("nvidia-tts")
    tts_providers.append({
        "id": "nvidia-tts",
        "name": "NVIDIA Magpie",
        "available": bool(s and s.available),
        "ready": bool(s and s.ready),
        "model": s.model if s else None,
        "streaming": True,
    })

    # Fetch voices from the active TTS backend
    tts_name, tts_url = registry.resolve_tts()
    if tts_url:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{tts_url}/voices")
                if resp.status_code == 200:
                    voices = resp.json().get("voices", [])
        except Exception:
            pass

    return GatewayCapabilities(
        stt_providers=stt_providers,
        tts_providers=tts_providers,
        voices=voices,
        languages=["en", "es", "de", "fr", "vi", "it", "zh", "hi", "ja"],
    )


# ── STT Endpoints ────────────────────────────────────────────────

@app.post("/stt/transcribe", response_model=SttEvent)
async def stt_transcribe(file: UploadFile = File(...)):
    """
    Batch STT: upload an audio file, receive a normalized transcript event.
    Routes to NVIDIA Parakeet STT backend.
    """
    await registry.refresh()
    stt_name, stt_url = registry.resolve_stt()

    if stt_name == "none":
        raise HTTPException(status_code=503, detail="No STT backend available")

    audio_data = await file.read()
    if not audio_data:
        raise HTTPException(status_code=400, detail="Empty audio file")

    t0 = time.time()

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            endpoint = "/transcribe"
            files = {"file": (file.filename or "audio.wav", audio_data, file.content_type or "audio/wav")}
            resp = await client.post(f"{stt_url}{endpoint}", files=files)

            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail=resp.text)

            data = resp.json()
            latency = (time.time() - t0) * 1000

            return SttEvent(
                provider=stt_name,
                model=data.get("model"),
                language=data.get("language", "en"),
                text=data.get("text", ""),
                is_final=True,
                confidence=data.get("confidence", 0.0),
                duration=data.get("duration"),
                latency_ms=round(latency, 1),
            )

    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"STT backend error: {e}")
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"STT backend returned invalid JSON: {e}")


@app.websocket("/stt/realtime")
async def stt_realtime(ws: WebSocket):
    """
    Streaming STT via WebSocket. Proxies to the NVIDIA STT WebSocket backend
    with normalized event wrapping.

    Client protocol (same as direct NVIDIA, but responses are SttEvent-shaped):
      1. Send JSON: { "type": "start", "config": { "sample_rate": 16000 } }
      2. Send binary PCM int16 chunks
      3. Receive JSON SttEvent: { "provider": "nvidia-stt", "text": "...", "is_final": false, ... }
      4. Send JSON: { "type": "end" }
      5. Receive final SttEvent: { ..., "is_final": true }
    """
    await ws.accept()
    await registry.refresh()
    stt_name, _ = registry.resolve_stt()

    if stt_name == "none" or stt_name != "nvidia-stt":
        await ws.send_json(SttEvent(
            provider="none",
            text="",
            is_final=True,
            error="No streaming STT backend available",
            error_code="NO_STT_BACKEND",
        ).model_dump())
        await ws.close(code=1013)
        return

    import websockets

    backend_ws_url = BackendConfig.NVIDIA_STT_WS
    t_session_start = time.time()

    try:
        async with websockets.connect(backend_ws_url) as backend_ws:
            async def client_to_backend():
                """Forward client messages to NVIDIA STT backend."""
                try:
                    while True:
                        message = await ws.receive()
                        if message["type"] == "websocket.disconnect":
                            break
                        if "bytes" in message and message["bytes"]:
                            await backend_ws.send(message["bytes"])
                        elif "text" in message and message["text"]:
                            await backend_ws.send(message["text"])
                except WebSocketDisconnect:
                    pass
                except Exception as e:
                    log.warning(f"STT client→backend relay error: {e}")

            async def backend_to_client():
                """Forward NVIDIA STT responses to client as normalized SttEvents."""
                try:
                    async for raw in backend_ws:
                        if isinstance(raw, str):
                            try:
                                data = json.loads(raw)
                            except json.JSONDecodeError as e:
                                log.warning(f"STT backend sent invalid JSON: {e}")
                                continue
                            msg_type = data.get("type", "")

                            if msg_type in ("partial", "final"):
                                latency = (time.time() - t_session_start) * 1000
                                event = SttEvent(
                                    provider="nvidia-stt",
                                    model="parakeet-ctc-0.6b",
                                    text=data.get("text", ""),
                                    is_final=msg_type == "final",
                                    confidence=data.get("confidence", 0.0),
                                    duration=data.get("duration"),
                                    latency_ms=round(latency, 1),
                                )
                                await ws.send_json(event.model_dump())

                            elif msg_type == "ready":
                                await ws.send_json({"type": "ready"})

                            elif msg_type == "error":
                                event = SttEvent(
                                    provider="nvidia-stt",
                                    text="",
                                    is_final=True,
                                    error=data.get("message", "Unknown error"),
                                    error_code="BACKEND_ERROR",
                                )
                                await ws.send_json(event.model_dump())
                except Exception as e:
                    log.warning(f"STT backend→client relay error: {e}")
                    try:
                        await ws.send_json(SttEvent(
                            provider="nvidia-stt", text="", is_final=True,
                            error=str(e), error_code="RELAY_ERROR",
                        ).model_dump())
                    except Exception:
                        pass

            await asyncio.gather(client_to_backend(), backend_to_client())

    except Exception as e:
        log.error(f"STT realtime error: {e}")
        try:
            await ws.send_json(SttEvent(
                provider="nvidia-stt",
                text="",
                is_final=True,
                error=str(e),
                error_code="CONNECTION_ERROR",
            ).model_dump())
        except Exception:
            pass


# ── TTS Endpoints ────────────────────────────────────────────────

@app.post("/tts/speak")
async def tts_speak(request: TtsRequest):
    """
    Batch TTS: send text, receive WAV audio.
    Routes to NVIDIA Magpie TTS backend.
    """
    await registry.refresh()
    tts_name, tts_url = registry.resolve_tts()

    if tts_name == "none":
        raise HTTPException(status_code=503, detail="No TTS backend available")

    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Empty text")

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            payload = {
                "text": request.text,
                "voice": request.voice,
                "language": request.language,
                "speed": request.speed,
                "sample_rate": request.sample_rate,
            }
            resp = await client.post(f"{tts_url}/synthesize", json=payload)

            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail=resp.text)

            return Response(
                content=resp.content,
                media_type="audio/wav",
                headers={
                    "X-Voice-Provider": tts_name,
                    "Content-Disposition": "attachment; filename=speech.wav",
                },
            )

    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"TTS backend error: {e}")


@app.websocket("/tts/realtime")
async def tts_realtime(ws: WebSocket):
    """
    Streaming TTS via WebSocket.

    Client sends JSON: { "text": "...", "voice": "sofia", "language": "en" }
    Server sends binary audio chunks + JSON TtsEvent metadata.
    """
    await ws.accept()
    await registry.refresh()
    tts_name, tts_url = registry.resolve_tts()

    if tts_name == "none":
        await ws.send_json(TtsEvent(
            provider="none",
            is_final=True,
            error="No TTS backend available",
        ).model_dump())
        await ws.close(code=1013)
        return

    try:
        while True:
            message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                break

            if "text" not in message or not message["text"]:
                continue

            try:
                request = json.loads(message["text"])
            except json.JSONDecodeError:
                continue

            text = request.get("text", "").strip()
            if not text:
                continue

            voice = request.get("voice", "sofia")
            language = request.get("language", "en")
            speed = request.get("speed", 1.0)
            t0 = time.time()

            try:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    if "nvidia" in tts_name:
                        payload = {
                            "text": text,
                            "voice": voice,
                            "language": language,
                            "speed": speed,
                            "stream": True,
                        }
                        async with client.stream("POST", f"{tts_url}/synthesize/stream", json=payload) as resp:
                            chunk_idx = 0
                            async for chunk in resp.aiter_bytes(chunk_size=4096):
                                await ws.send_bytes(chunk)
                                chunk_idx += 1
                    else:
                        payload = {"text": text, "voice": voice}
                        resp = await client.post(f"{tts_url}/tts", json=payload)
                        if resp.status_code == 200:
                            await ws.send_bytes(resp.content)

                latency = (time.time() - t0) * 1000
                await ws.send_json(TtsEvent(
                    provider=tts_name,
                    is_final=True,
                    latency_ms=round(latency, 1),
                ).model_dump())

            except Exception as e:
                await ws.send_json(TtsEvent(
                    provider=tts_name,
                    is_final=True,
                    error=str(e),
                ).model_dump())

    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.error(f"TTS realtime error: {e}")


# ── Root ─────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {
        "service": "Crystal Voice Gateway",
        "version": "1.0.0",
        "docs": f"http://127.0.0.1:{PORT}/docs",
        "endpoints": {
            "POST /stt/transcribe": "Upload audio file for batch transcription",
            "WS /stt/realtime": "WebSocket streaming STT",
            "POST /tts/speak": "Text-to-speech synthesis",
            "WS /tts/realtime": "WebSocket streaming TTS",
            "GET /health": "Gateway and backend health",
            "GET /ready": "Readiness probe",
            "GET /capabilities": "Available providers, voices, languages",
        },
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
