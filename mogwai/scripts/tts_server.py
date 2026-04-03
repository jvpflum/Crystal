"""
Crystal TTS Server
FastAPI server for text-to-speech using Kokoro or system TTS fallback
"""

import os
import io
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

app = FastAPI(title="Crystal TTS")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

tts_engine = None
tts_type = "none"

class TTSRequest(BaseModel):
    text: str
    voice: str = "af_heart"

@app.on_event("startup")
async def load_tts():
    global tts_engine, tts_type
    
    try:
        from kokoro import KPipeline
        tts_engine = KPipeline(lang_code="a")
        tts_type = "kokoro"
        print("Kokoro TTS loaded successfully!")
        return
    except ImportError:
        print("Kokoro not available, trying pyttsx3...")
    
    try:
        import pyttsx3
        tts_engine = pyttsx3.init()
        tts_type = "pyttsx3"
        print("pyttsx3 TTS loaded successfully!")
        return
    except ImportError:
        print("pyttsx3 not available")
    
    print("WARNING: No TTS engine available. Install kokoro or pyttsx3")

@app.get("/health")
def health():
    return {"status": "ok", "engine": tts_type, "ready": tts_engine is not None}

@app.post("/tts")
async def synthesize(request: TTSRequest):
    if tts_engine is None:
        raise HTTPException(status_code=503, detail="TTS engine not loaded")
    
    try:
        if tts_type == "kokoro":
            import soundfile as sf
            generator = tts_engine(request.text, voice=request.voice)
            
            audio_chunks = []
            for _, _, audio in generator:
                audio_chunks.append(audio)
            
            if not audio_chunks:
                raise HTTPException(status_code=500, detail="No audio generated")
            
            import numpy as np
            full_audio = np.concatenate(audio_chunks)
            
            buffer = io.BytesIO()
            sf.write(buffer, full_audio, 24000, format='WAV')
            buffer.seek(0)
            
            return StreamingResponse(
                buffer,
                media_type="audio/wav",
                headers={"Content-Disposition": "attachment; filename=speech.wav"}
            )
        
        elif tts_type == "pyttsx3":
            import tempfile
            with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
                tts_engine.save_to_file(request.text, tmp.name)
                tts_engine.runAndWait()
                
                with open(tmp.name, "rb") as f:
                    audio_data = f.read()
                
                os.unlink(tmp.name)
                
                return StreamingResponse(
                    io.BytesIO(audio_data),
                    media_type="audio/wav"
                )
        
        else:
            raise HTTPException(status_code=503, detail="No TTS engine available")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/voices")
def list_voices():
    if tts_type == "kokoro":
        return {
            "voices": [
                {"id": "af_heart", "name": "Heart (American Female)"},
                {"id": "af_bella", "name": "Bella (American Female)"},
                {"id": "af_sarah", "name": "Sarah (American Female)"},
                {"id": "am_adam", "name": "Adam (American Male)"},
                {"id": "am_michael", "name": "Michael (American Male)"},
                {"id": "bf_emma", "name": "Emma (British Female)"},
                {"id": "bm_george", "name": "George (British Male)"},
            ]
        }
    elif tts_type == "pyttsx3":
        voices = tts_engine.getProperty('voices')
        return {
            "voices": [{"id": v.id, "name": v.name} for v in voices]
        }
    return {"voices": []}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8081))
    uvicorn.run(app, host="0.0.0.0", port=port)
