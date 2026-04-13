"""
Crystal NVIDIA TTS Worker
HTTP server for text-to-speech using NVIDIA Magpie TTS.

Model:  nvidia/magpie_tts_multilingual_357m
Codec:  nvidia/nemo-nano-codec-22khz-1.89kbps-21.5fps
Method: model.do_tts() → autoregressive transformer → NanoCodec → waveform

Endpoints:
  POST /synthesize        — full synthesis, returns WAV audio
  POST /synthesize/stream — chunked streaming synthesis
  GET  /voices            — list available voices/speakers
  GET  /health            — health check
"""

import os
import re
import struct
import logging
import numpy as np

logging.basicConfig(level=logging.INFO, format="[MagpieTts] %(levelname)s %(message)s")
log = logging.getLogger("magpie_tts")

PORT = int(os.environ.get("NVIDIA_TTS_PORT", "8091"))
REPO_ID = "nvidia/magpie_tts_multilingual_357m"
NEMO_FILE = "magpie_tts_multilingual_357m.nemo"
CODEC_MODEL = "nvidia/nemo-nano-codec-22khz-1.89kbps-21.5fps"

SPEAKERS = {
    "john":  0,
    "sofia": 1,
    "aria":  2,
    "jason": 3,
    "leo":   4,
}
DEFAULT_SPEAKER = "sofia"
SUPPORTED_LANGUAGES = ["en", "es", "de", "fr", "vi", "it", "zh", "hi", "ja"]

# ── Model Loading ───────────────────────────────────────────────

magpie_model = None
model_ready = False
model_loading = False
sample_rate = 22050


def load_model():
    global magpie_model, model_ready, model_loading, sample_rate
    model_loading = True

    try:
        import torch
        from huggingface_hub import hf_hub_download
        from nemo.collections.tts.modules.magpietts_inference.utils import (
            ModelLoadConfig,
            load_magpie_model,
        )

        log.info(f"Downloading checkpoint: {REPO_ID}/{NEMO_FILE}")
        checkpoint_path = hf_hub_download(repo_id=REPO_ID, filename=NEMO_FILE)
        log.info(f"Checkpoint cached at: {checkpoint_path}")

        config = ModelLoadConfig(
            nemo_file=checkpoint_path,
            codecmodel_path=CODEC_MODEL,
            legacy_codebooks=False,
            legacy_text_conditioning=False,
            hparams_from_wandb=None,
        )

        log.info("Loading Magpie TTS model...")
        magpie_model, _ = load_magpie_model(config)
        magpie_model.eval()

        if torch.cuda.is_available():
            magpie_model.cuda()
            log.info(f"Model on GPU: {torch.cuda.get_device_name(0)}")
        else:
            log.warning("CUDA not available — running on CPU (will be slow)")

        sample_rate = getattr(magpie_model, "sample_rate", 22050)
        model_ready = True
        log.info(f"Magpie TTS ready — {sample_rate} Hz, {len(SPEAKERS)} speakers")

    except ImportError as e:
        log.error(f"Missing dependency: {e}")
        log.error("Install with: pip install nemo_toolkit[tts] huggingface_hub")
        model_ready = False

    except Exception as e:
        log.error(f"Failed to load Magpie TTS: {e}")
        import traceback; traceback.print_exc()
        model_ready = False

    model_loading = False


def synthesize_speech(
    text: str,
    speaker: str = DEFAULT_SPEAKER,
    language: str = "en",
    apply_tn: bool = True,
) -> np.ndarray:
    """Run Magpie TTS inference. Returns float32 numpy waveform."""
    import torch

    speaker_idx = SPEAKERS.get(speaker.lower(), SPEAKERS[DEFAULT_SPEAKER])

    # Magpie expects text ending with punctuation
    text = text.strip()
    if text and not text[-1] in ".!?":
        text += "."

    with torch.no_grad():
        audio, audio_len = magpie_model.do_tts(
            text,
            language=language,
            apply_TN=apply_tn,
            speaker_index=speaker_idx,
        )

    audio_np = audio[0, :audio_len[0]].cpu().numpy()
    return audio_np


def generate_placeholder(text: str, sr: int = 22050) -> np.ndarray:
    """Scaffold beep when model isn't loaded."""
    duration = min(len(text) * 0.05, 3.0)
    t = np.linspace(0, duration, int(sr * duration), dtype=np.float32)
    audio = 0.3 * np.sin(2 * np.pi * 440.0 * t).astype(np.float32)
    fade = min(int(sr * 0.05), len(audio) // 4)
    if fade > 0:
        audio[:fade] *= np.linspace(0, 1, fade, dtype=np.float32)
        audio[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)
    return audio


def audio_to_wav_bytes(audio_np: np.ndarray, sr: int = 22050) -> bytes:
    """Convert float32 numpy to WAV bytes."""
    audio_np = np.clip(audio_np, -1.0, 1.0)
    pcm = (audio_np * 32767).astype(np.int16)
    data = pcm.tobytes()
    data_len = len(data)

    header = bytearray(44)
    header[0:4] = b"RIFF"
    struct.pack_into("<I", header, 4, 36 + data_len)
    header[8:12] = b"WAVE"
    header[12:16] = b"fmt "
    struct.pack_into("<I", header, 16, 16)
    struct.pack_into("<H", header, 20, 1)     # PCM
    struct.pack_into("<H", header, 22, 1)     # mono
    struct.pack_into("<I", header, 24, sr)
    struct.pack_into("<I", header, 28, sr * 2)
    struct.pack_into("<H", header, 32, 2)
    struct.pack_into("<H", header, 34, 16)
    header[36:40] = b"data"
    struct.pack_into("<I", header, 40, data_len)

    return bytes(header) + data


# ── FastAPI Application ─────────────────────────────────────────

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel
from typing import Optional

app = FastAPI(title="Crystal Magpie TTS Worker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SynthesizeRequest(BaseModel):
    text: str
    voice: str = DEFAULT_SPEAKER
    language: str = "en"
    speed: float = 1.0
    sample_rate: int = 22050
    stream: bool = False
    apply_tn: bool = True


@app.on_event("startup")
async def startup():
    import asyncio
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, load_model)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "ready": model_ready,
        "loading": model_loading,
        "model": REPO_ID,
        "codec": CODEC_MODEL,
        "backend": "magpie" if model_ready else ("loading" if model_loading else "scaffold"),
        "sample_rate": sample_rate,
        "speakers": list(SPEAKERS.keys()),
        "languages": SUPPORTED_LANGUAGES,
    }


@app.post("/synthesize")
async def synthesize(request: SynthesizeRequest):
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Empty text")

    try:
        if model_ready and magpie_model is not None:
            audio_np = synthesize_speech(
                request.text,
                speaker=request.voice,
                language=request.language,
                apply_tn=request.apply_tn,
            )
        else:
            audio_np = generate_placeholder(request.text, request.sample_rate)

        wav_bytes = audio_to_wav_bytes(audio_np, sample_rate if model_ready else request.sample_rate)

        return Response(
            content=wav_bytes,
            media_type="audio/wav",
            headers={"Content-Disposition": "attachment; filename=speech.wav"},
        )
    except Exception as e:
        log.error(f"Synthesis error: {e}")
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/synthesize/stream")
async def synthesize_stream(request: SynthesizeRequest):
    """Streaming synthesis — splits text into sentences, yields WAV chunks."""
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Empty text")

    def generate():
        all_audio = []
        sentences = split_sentences(request.text)
        for sentence in sentences:
            if not sentence.strip():
                continue
            try:
                if model_ready and magpie_model is not None:
                    audio_np = synthesize_speech(
                        sentence,
                        speaker=request.voice,
                        language=request.language,
                        apply_tn=request.apply_tn,
                    )
                else:
                    audio_np = generate_placeholder(sentence, request.sample_rate)

                all_audio.append(audio_np)
            except Exception as e:
                log.error(f"Stream chunk error: {e}")

        if all_audio:
            sr = sample_rate if model_ready else request.sample_rate
            combined = np.concatenate(all_audio)
            yield audio_to_wav_bytes(combined, sr)

    return StreamingResponse(generate(), media_type="audio/wav")


@app.get("/voices")
def list_voices():
    voices = [
        {"id": name, "name": name.capitalize(), "speaker_index": idx, "languages": SUPPORTED_LANGUAGES}
        for name, idx in SPEAKERS.items()
    ]
    return {"voices": voices}


def split_sentences(text: str) -> list:
    """Split text at sentence boundaries for streaming."""
    sentences = re.split(r'(?<=[.!?])\s+', text)
    return [s for s in sentences if s.strip()]


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
