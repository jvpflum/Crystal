"""
Mogwai Whisper STT Server
FastAPI server for speech-to-text using faster-whisper
"""

import os
import sys
import tempfile
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Mogwai Whisper STT")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

model = None
model_name = os.environ.get("WHISPER_MODEL", "large-v3")

@app.on_event("startup")
async def load_model():
    global model
    from faster_whisper import WhisperModel
    print(f"Loading Whisper model: {model_name}...")
    model = WhisperModel(model_name, device="cuda", compute_type="float16")
    print("Model loaded successfully!")

@app.get("/health")
def health():
    return {"status": "ok", "model": model_name, "ready": model is not None}

@app.post("/inference")
async def inference(file: UploadFile = File(...)):
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    suffix = ".webm"
    if file.filename:
        suffix = os.path.splitext(file.filename)[1] or suffix
    
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name
    
    try:
        segments, info = model.transcribe(tmp_path, beam_size=5)
        text = " ".join([segment.text for segment in segments])
        return {
            "text": text.strip(),
            "language": info.language,
            "duration": info.duration
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            os.unlink(tmp_path)
        except:
            pass

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)
