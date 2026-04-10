"""
Crystal NVIDIA STT Worker — FastAPI server for streaming speech-to-text.

Model:  nvidia/parakeet-ctc-0.6b (Nemotron/Parakeet-family ASR)
Method: NeMo ASR — streaming via WebSocket, batch via POST /transcribe

Endpoints:
  WS   /ws             — streaming STT (push PCM chunks, receive partial/final transcripts)
  POST /transcribe      — batch STT (upload WAV/audio file, receive transcript)
  GET  /health          — health check (model status, backend info)

WebSocket Protocol:
  1. Client sends JSON: { "type": "start", "config": { "sample_rate": 16000, ... } }
  2. Client sends binary frames (raw PCM int16 audio)
  3. Server sends JSON partials: { "type": "partial", "text": "..." }
  4. Client sends JSON: { "type": "end" }
  5. Server sends JSON final: { "type": "final", "text": "...", "confidence": 0.95 }
  6. Client sends JSON: { "type": "cancel" } to abort

Usage:
  python nvidia_stt_worker.py
  # or with env overrides:
  NVIDIA_STT_PORT=8090 NVIDIA_STT_MODEL=nvidia/parakeet-ctc-0.6b python nvidia_stt_worker.py
"""

import os
import json
import asyncio
import tempfile
import logging
import numpy as np
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="[NvidiaStt] %(levelname)s %(message)s")
log = logging.getLogger("nvidia_stt")

PORT = int(os.environ.get("NVIDIA_STT_PORT", "8090"))
MODEL_NAME = os.environ.get("NVIDIA_STT_MODEL", "nvidia/parakeet-ctc-0.6b")

# ── Model State ──────────────────────────────────────────────────

asr_model = None
model_ready = False
model_loading = False


def load_model():
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
    """Transcribe a float32 numpy array. Returns { text, confidence }."""
    if asr_model is not None and model_ready:
        try:
            import torch
            with torch.no_grad():
                hypotheses = asr_model.transcribe([audio_np])
                text = hypotheses[0] if hypotheses else ""
                return {"text": text.strip(), "confidence": 0.9}
        except Exception as e:
            log.error(f"Transcription error: {e}")
            return {"text": "", "confidence": 0.0, "error": str(e)}

    log.debug("Scaffold mode: returning placeholder transcription")
    return {"text": "[NeMo model not loaded — scaffold mode]", "confidence": 0.0}


# ── FastAPI Application ──────────────────────────────────────────

app = FastAPI(
    title="Crystal NVIDIA STT Worker",
    description="Streaming and batch speech-to-text using NVIDIA Nemotron/Parakeet ASR on local GPU.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class TranscribeResponse(BaseModel):
    text: str
    confidence: float = 0.0
    duration: Optional[float] = None
    error: Optional[str] = None


@app.on_event("startup")
async def startup():
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, load_model)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "ready": model_ready,
        "loading": model_loading,
        "model": MODEL_NAME,
        "backend": "nemo" if asr_model is not None else ("loading" if model_loading else "scaffold"),
        "endpoints": {
            "websocket": f"ws://127.0.0.1:{PORT}/ws",
            "transcribe": f"http://127.0.0.1:{PORT}/transcribe",
            "health": f"http://127.0.0.1:{PORT}/health",
        },
    }


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(file: UploadFile = File(...)):
    """
    Batch transcription: upload a WAV/audio file, receive the transcript.

    Accepts any audio format that soundfile can read (WAV, FLAC, OGG, etc.).
    Audio is automatically resampled to 16kHz mono for the ASR model.
    """
    audio_data = await file.read()
    if not audio_data:
        raise HTTPException(status_code=400, detail="Empty file")

    suffix = ".wav"
    if file.filename:
        ext = os.path.splitext(file.filename)[1]
        if ext:
            suffix = ext

    try:
        import soundfile as sf

        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(audio_data)
            tmp_path = tmp.name

        data, sr = sf.read(tmp_path, dtype="float32")
        os.unlink(tmp_path)

        # Resample to 16kHz if needed
        if sr != 16000:
            ratio = 16000 / sr
            new_len = int(len(data) * ratio)
            indices = np.linspace(0, len(data) - 1, new_len)
            data = np.interp(indices, np.arange(len(data)), data)
            sr = 16000

        duration = len(data) / sr
        result = transcribe_audio(data, sr)

        return TranscribeResponse(
            text=result["text"],
            confidence=result.get("confidence", 0.0),
            duration=round(duration, 2),
            error=result.get("error"),
        )

    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="soundfile not installed. Install with: pip install soundfile",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.websocket("/ws")
async def websocket_stt(ws: WebSocket):
    """
    Streaming STT via WebSocket.

    Protocol:
      1. Send JSON: { "type": "start", "config": { "sample_rate": 16000 } }
      2. Send binary PCM int16 audio chunks
      3. Receive JSON: { "type": "partial", "text": "..." }
      4. Send JSON: { "type": "end" } to finalize
      5. Receive JSON: { "type": "final", "text": "...", "confidence": 0.95 }
    """
    await ws.accept()
    log.info("New STT WebSocket session")

    audio_buffer = bytearray()
    sample_rate = 16000
    streaming = False

    try:
        while True:
            message = await ws.receive()

            if message["type"] == "websocket.disconnect":
                break

            if "bytes" in message and message["bytes"]:
                raw = message["bytes"]
                if not streaming:
                    continue
                audio_buffer.extend(raw)

                # Emit partial transcript every ~1s of audio
                chunk_threshold = sample_rate * 2  # 1 second of int16 audio
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

            elif "text" in message and message["text"]:
                try:
                    data = json.loads(message["text"])
                except json.JSONDecodeError:
                    continue

                msg_type = data.get("type", "")

                if msg_type == "start":
                    config = data.get("config", {})
                    sample_rate = config.get("sample_rate", 16000)
                    streaming = True
                    audio_buffer = bytearray()
                    await ws.send_json({"type": "ready"})
                    log.info(f"Stream started (sample_rate={sample_rate})")

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
                    log.info("Stream ended")

                elif msg_type == "cancel":
                    streaming = False
                    audio_buffer = bytearray()
                    log.info("Stream cancelled")
                    break

    except WebSocketDisconnect:
        log.info("STT WebSocket client disconnected")
    except Exception as e:
        log.error(f"STT WebSocket error: {e}")
        try:
            await ws.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass

    log.info("STT session closed")


# ── Root redirect to docs ────────────────────────────────────────

@app.get("/")
def root():
    return {
        "service": "Crystal NVIDIA STT Worker",
        "model": MODEL_NAME,
        "docs": f"http://127.0.0.1:{PORT}/docs",
        "endpoints": {
            "POST /transcribe": "Upload audio file for batch transcription",
            "WS /ws": "WebSocket endpoint for streaming STT",
            "GET /health": "Health check and model status",
        },
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
