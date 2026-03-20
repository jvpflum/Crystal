"""
Crystal NVIDIA STT Worker
WebSocket server for streaming speech-to-text using NVIDIA Nemotron/Parakeet ASR.

Target model: nvidia/nemotron-speech-streaming-en-0.6b
Framework: NVIDIA NeMo

This worker runs on the local NVIDIA GPU and provides streaming transcription
to the Crystal TypeScript app via WebSocket on port 8090.

Protocol:
  1. Client opens WS connection
  2. Client sends JSON: { "type": "start", "config": { "sample_rate": 16000, ... } }
  3. Client sends binary frames (raw PCM int16 audio)
  4. Server sends JSON partials: { "type": "partial", "text": "..." }
  5. Client sends JSON: { "type": "end" }
  6. Server sends JSON final: { "type": "final", "text": "...", "confidence": 0.95 }
  7. Client sends JSON: { "type": "cancel" } to abort

Also exposes HTTP /health and /transcribe endpoints for health checks and batch mode.
"""

import os
import sys
import json
import asyncio
import signal
import struct
import logging
import tempfile
import numpy as np
from pathlib import Path
from aiohttp import web

logging.basicConfig(level=logging.INFO, format="[NvidiaStt] %(levelname)s %(message)s")
log = logging.getLogger("nvidia_stt")

PORT = int(os.environ.get("NVIDIA_STT_PORT", "8090"))
MODEL_NAME = os.environ.get(
    "NVIDIA_STT_MODEL", "nvidia/parakeet-ctc-0.6b"
)

# ── Model Loading ───────────────────────────────────────────────

asr_model = None
model_ready = False
model_loading = False


def load_model():
    """
    Load the NVIDIA Nemotron/Parakeet ASR model using NeMo.

    TODO: Replace this scaffolding with actual model loading once NeMo is installed.
    The target workflow is:

        import nemo.collections.asr as nemo_asr
        model = nemo_asr.models.ASRModel.from_pretrained(MODEL_NAME)
        model.eval()
        model.cuda()

    For streaming inference, use the model's streaming/buffered transcription API:

        from nemo.collections.asr.parts.utils.streaming_utils import FrameBatchASR
        streaming_asr = FrameBatchASR(
            asr_model=model,
            frame_len=1.6,     # seconds per frame
            total_buffer=4.0,  # total buffer in seconds
            batch_size=1,
        )

    Alternative: If running via Triton Inference Server, connect as a gRPC client
    instead of loading the model directly.
    """
    global asr_model, model_ready, model_loading
    model_loading = True

    try:
        import nemo.collections.asr as nemo_asr

        log.info(f"Loading NeMo ASR model: {MODEL_NAME}")
        asr_model = nemo_asr.models.ASRModel.from_pretrained(MODEL_NAME)
        asr_model.eval()
        if hasattr(asr_model, "cuda"):
            asr_model.cuda()
        model_ready = True
        log.info("NeMo ASR model loaded successfully on GPU")

    except ImportError:
        log.warning(
            "NeMo not installed. Running in scaffold mode. "
            "Install with: pip install nemo_toolkit[asr]"
        )
        asr_model = None
        model_ready = False

    except Exception as e:
        log.error(f"Failed to load NeMo ASR model: {e}")
        asr_model = None
        model_ready = False

    model_loading = False


def transcribe_audio(audio_np: np.ndarray, sample_rate: int = 16000) -> dict:
    """
    Transcribe a numpy audio array using the loaded ASR model.

    TODO: Wire actual NeMo inference here:

        with torch.no_grad():
            hypotheses = asr_model.transcribe([audio_np])
            text = hypotheses[0] if hypotheses else ""

    For streaming partial results, use FrameBatchASR:

        streaming_asr.reset()
        streaming_asr.read_audio_buffer(audio_np, delay=0)
        text = streaming_asr.transcribe(tokens_per_chunk=..., delay=...)
    """
    if asr_model is not None and model_ready:
        try:
            import torch

            with torch.no_grad():
                # NeMo expects a list of numpy arrays or file paths
                hypotheses = asr_model.transcribe([audio_np])
                text = hypotheses[0] if hypotheses else ""
                return {"text": text.strip(), "confidence": 0.9}
        except Exception as e:
            log.error(f"Transcription error: {e}")
            return {"text": "", "confidence": 0.0, "error": str(e)}

    # Scaffold mode: return placeholder
    log.debug("Scaffold mode: returning placeholder transcription")
    return {
        "text": "[NeMo model not loaded — scaffold mode]",
        "confidence": 0.0,
    }


# ── WebSocket Server ────────────────────────────────────────────

async def handle_stt_session(websocket):
    """Handle one STT WebSocket session."""
    audio_buffer = bytearray()
    sample_rate = 16000
    streaming = False

    log.info(f"New STT session from {websocket.remote_address}")

    try:
        async for message in websocket:
            if isinstance(message, bytes):
                if not streaming:
                    continue
                audio_buffer.extend(message)

                # Send partial transcription every ~0.5s of audio (16000 samples * 2 bytes)
                chunk_threshold = sample_rate * 2  # 1 second of int16 audio
                if len(audio_buffer) >= chunk_threshold:
                    audio_np = np.frombuffer(
                        bytes(audio_buffer), dtype=np.int16
                    ).astype(np.float32) / 32768.0

                    result = transcribe_audio(audio_np, sample_rate)
                    await websocket.send(json.dumps({
                        "type": "partial",
                        "text": result["text"],
                        "confidence": result.get("confidence", 0.0),
                    }))

            elif isinstance(message, str):
                try:
                    msg = json.loads(message)
                except json.JSONDecodeError:
                    continue

                msg_type = msg.get("type", "")

                if msg_type == "start":
                    config = msg.get("config", {})
                    sample_rate = config.get("sample_rate", 16000)
                    streaming = True
                    audio_buffer = bytearray()
                    await websocket.send(json.dumps({"type": "ready"}))
                    log.info(f"Stream started (sample_rate={sample_rate})")

                elif msg_type == "end":
                    streaming = False
                    if len(audio_buffer) > 0:
                        audio_np = np.frombuffer(
                            bytes(audio_buffer), dtype=np.int16
                        ).astype(np.float32) / 32768.0

                        result = transcribe_audio(audio_np, sample_rate)
                        duration = len(audio_np) / sample_rate

                        await websocket.send(json.dumps({
                            "type": "final",
                            "text": result["text"],
                            "confidence": result.get("confidence", 0.0),
                            "duration": round(duration, 2),
                        }))
                    else:
                        await websocket.send(json.dumps({
                            "type": "final",
                            "text": "",
                            "confidence": 0.0,
                            "duration": 0.0,
                        }))

                    audio_buffer = bytearray()
                    log.info("Stream ended")

                elif msg_type == "cancel":
                    streaming = False
                    audio_buffer = bytearray()
                    log.info("Stream cancelled")
                    break

    except Exception as e:
        log.error(f"Session error: {e}")
        try:
            await websocket.send(json.dumps({
                "type": "error",
                "message": str(e),
            }))
        except Exception:
            pass

    log.info("STT session closed")


# ── CORS Middleware ──────────────────────────────────────────────

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


@web.middleware
async def cors_middleware(request, handler):
    if request.method == "OPTIONS":
        return web.Response(status=204, headers=CORS_HEADERS)
    resp = await handler(request)
    resp.headers.update(CORS_HEADERS)
    return resp


# ── HTTP Endpoints (via aiohttp for health + batch) ─────────────

async def handle_http(request):
    """Simple HTTP router for /health and /transcribe."""
    path = request.path

    if path == "/health":
        return web.json_response({
            "status": "ok",
            "ready": model_ready,
            "loading": model_loading,
            "model": MODEL_NAME,
            "backend": "nemo" if asr_model is not None else ("loading" if model_loading else "scaffold"),
        })

    elif path == "/transcribe" and request.method == "POST":
        reader = await request.multipart()
        field = await reader.next()
        if field is None:
            return web.json_response({"error": "No file uploaded"}, status=400)

        audio_data = await field.read()
        try:
            import soundfile as sf

            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp.write(audio_data)
                tmp_path = tmp.name

            data, sr = sf.read(tmp_path, dtype="float32")
            os.unlink(tmp_path)

            if sr != 16000:
                ratio = 16000 / sr
                new_len = int(len(data) * ratio)
                indices = np.linspace(0, len(data) - 1, new_len)
                data = np.interp(indices, np.arange(len(data)), data)

            result = transcribe_audio(data, 16000)
            return web.json_response(result)

        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    return web.json_response({"error": "Not found"}, status=404)


# ── Main ────────────────────────────────────────────────────────

async def main():
    # Unified handler: WebSocket upgrades + normal HTTP
    async def unified_handler(request):
        if request.headers.get("Upgrade", "").lower() == "websocket":
            ws = web.WebSocketResponse()
            await ws.prepare(request)
            await handle_aiohttp_ws(ws)
            return ws
        return await handle_http(request)

    app = web.Application(middlewares=[cors_middleware])
    app.router.add_get("/health", handle_http)
    app.router.add_post("/transcribe", handle_http)
    app.router.add_get("/ws", unified_handler)
    app.router.add_get("/", unified_handler)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", PORT)
    await site.start()

    log.info(f"NVIDIA STT Worker listening on port {PORT}")
    log.info(f"  WebSocket: ws://127.0.0.1:{PORT}/")
    log.info(f"  HTTP:      http://127.0.0.1:{PORT}/health")

    # Load model in background so health endpoint is available immediately
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, load_model)

    log.info("Model loading complete, ready for inference")

    # Keep running until interrupted
    stop_event = asyncio.Event()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop_event.set)
        except NotImplementedError:
            pass

    try:
        await stop_event.wait()
    except (KeyboardInterrupt, SystemExit):
        pass

    await runner.cleanup()
    log.info("STT Worker shut down")


async def handle_aiohttp_ws(ws):
    """Handle a WebSocket session via aiohttp WebSocketResponse."""
    from aiohttp import WSMsgType

    audio_buffer = bytearray()
    sample_rate = 16000
    streaming = False

    log.info("New STT session (aiohttp WS)")

    async for msg in ws:
        if msg.type == WSMsgType.BINARY:
            if not streaming:
                continue
            audio_buffer.extend(msg.data)

            chunk_threshold = sample_rate * 2
            if len(audio_buffer) >= chunk_threshold:
                audio_np = np.frombuffer(
                    bytes(audio_buffer), dtype=np.int16
                ).astype(np.float32) / 32768.0

                result = transcribe_audio(audio_np, sample_rate)
                await ws.send_json({
                    "type": "partial",
                    "text": result["text"],
                    "confidence": result.get("confidence", 0.0),
                })

        elif msg.type == WSMsgType.TEXT:
            try:
                data = json.loads(msg.data)
            except json.JSONDecodeError:
                continue

            msg_type = data.get("type", "")

            if msg_type == "start":
                config = data.get("config", {})
                sample_rate = config.get("sample_rate", 16000)
                streaming = True
                audio_buffer = bytearray()
                await ws.send_json({"type": "ready"})

            elif msg_type == "end":
                streaming = False
                if len(audio_buffer) > 0:
                    audio_np = np.frombuffer(
                        bytes(audio_buffer), dtype=np.int16
                    ).astype(np.float32) / 32768.0

                    result = transcribe_audio(audio_np, sample_rate)
                    duration = len(audio_np) / sample_rate

                    await ws.send_json({
                        "type": "final",
                        "text": result["text"],
                        "confidence": result.get("confidence", 0.0),
                        "duration": round(duration, 2),
                    })
                else:
                    await ws.send_json({
                        "type": "final",
                        "text": "",
                        "confidence": 0.0,
                        "duration": 0.0,
                    })
                audio_buffer = bytearray()

            elif msg_type == "cancel":
                streaming = False
                audio_buffer = bytearray()
                break

        elif msg.type in (WSMsgType.ERROR, WSMsgType.CLOSE):
            break

    log.info("STT session closed")


if __name__ == "__main__":
    asyncio.run(main())
