"""Quick GPU and dependency check."""
import sys
print(f"Python: {sys.version}")

try:
    import torch
    print(f"PyTorch: {torch.__version__}")
    print(f"CUDA available: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"CUDA version: {torch.version.cuda}")
        print(f"GPU: {torch.cuda.get_device_name(0)}")
        print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")
    else:
        print("No CUDA GPU detected")
except ImportError:
    print("PyTorch: NOT INSTALLED")

try:
    import nemo
    print(f"NeMo: {nemo.__version__}")
except ImportError:
    print("NeMo: NOT INSTALLED")

try:
    import nemo.collections.asr as nemo_asr
    print("NeMo ASR: available")
except (ImportError, Exception) as e:
    print(f"NeMo ASR: {e}")

try:
    import nemo.collections.tts as nemo_tts
    print("NeMo TTS: available")
except (ImportError, Exception) as e:
    print(f"NeMo TTS: {e}")

try:
    import faster_whisper
    print(f"faster-whisper: {faster_whisper.__version__}")
except ImportError:
    print("faster-whisper: NOT INSTALLED")

try:
    import kokoro
    print("Kokoro TTS: available")
except ImportError:
    print("Kokoro TTS: NOT INSTALLED")

print("\nDependency check for NVIDIA speech workers:")
for pkg in ["aiohttp", "websockets", "soundfile", "numpy", "fastapi", "uvicorn"]:
    try:
        mod = __import__(pkg)
        ver = getattr(mod, "__version__", "ok")
        print(f"  {pkg}: {ver}")
    except ImportError:
        print(f"  {pkg}: MISSING")
