"""Download NVIDIA speech models for Crystal.

STT: nvidia/parakeet-ctc-0.6b (Parakeet CTC ASR)
TTS: nvidia/magpie_tts_multilingual_357m (Magpie TTS + NanoCodec)
"""
import sys
import torch

print(f"Python:  {sys.version}")
print(f"PyTorch: {torch.__version__}")
print(f"CUDA:    {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"GPU:     {torch.cuda.get_device_name(0)}")
    props = torch.cuda.get_device_properties(0)
    print(f"VRAM:    {props.total_memory / 1024**3:.1f} GB")

# ── STT: Parakeet CTC 0.6B ──────────────────────────────────────
print("\n=== Downloading NVIDIA Parakeet ASR model ===")
try:
    import nemo.collections.asr as nemo_asr

    model_name = "nvidia/parakeet-ctc-0.6b"
    print(f"Model: {model_name}")
    print("(First run downloads ~1.2 GB from HuggingFace...)")

    model = nemo_asr.models.ASRModel.from_pretrained(model_name)
    print(f"  Class:  {type(model).__name__}")
    print(f"  Params: {sum(p.numel() for p in model.parameters()) / 1e6:.1f}M")

    model.eval()
    if torch.cuda.is_available():
        model = model.cuda()
        print("  GPU:    loaded on CUDA")

    print("STT model READY")

except Exception as e:
    print(f"STT FAILED: {e}")
    import traceback; traceback.print_exc()

# ── TTS: Magpie TTS 357M ────────────────────────────────────────
print("\n=== Downloading NVIDIA Magpie TTS model ===")
CODEC_MODEL_PATH = "nvidia/nemo-nano-codec-22khz-1.89kbps-21.5fps"

try:
    from huggingface_hub import hf_hub_download
    from nemo.collections.tts.modules.magpietts_inference.utils import (
        ModelLoadConfig,
        load_magpie_model,
    )

    repo_id = "nvidia/magpie_tts_multilingual_357m"
    nemo_file = "magpie_tts_multilingual_357m.nemo"

    print(f"Model:   {repo_id}")
    print(f"Codec:   {CODEC_MODEL_PATH}")
    print("(First run downloads ~1.4 GB from HuggingFace...)")

    checkpoint_path = hf_hub_download(repo_id=repo_id, filename=nemo_file)
    print(f"  Checkpoint cached at: {checkpoint_path}")

    config = ModelLoadConfig(
        nemo_file=checkpoint_path,
        codecmodel_path=CODEC_MODEL_PATH,
        legacy_codebooks=False,
        legacy_text_conditioning=False,
        hparams_from_wandb=None,
    )

    magpie_model, _ = load_magpie_model(config)
    magpie_model.eval()
    if torch.cuda.is_available():
        magpie_model.cuda()
        print("  GPU:    loaded on CUDA")

    print(f"  Class:  {type(magpie_model).__name__}")
    print(f"  Rate:   {magpie_model.sample_rate} Hz")

    # Quick smoke test
    print("  Running quick synthesis test...")
    audio, audio_len = magpie_model.do_tts(
        "Hello, Crystal is online.",
        language="en",
        apply_TN=False,
        speaker_index=1,  # Sofia
    )
    print(f"  Output: {audio.shape} samples, {audio_len[0]} length")
    print("TTS model READY")

    SPEAKERS = {0: "John", 1: "Sofia", 2: "Aria", 3: "Jason", 4: "Leo"}
    print(f"  Speakers: {SPEAKERS}")

except ImportError as e:
    print(f"TTS IMPORT FAILED: {e}")
    print("Make sure nemo_toolkit and huggingface_hub are installed.")
    import traceback; traceback.print_exc()
except Exception as e:
    print(f"TTS FAILED: {e}")
    import traceback; traceback.print_exc()

print("\n=== Summary ===")
print("Models are cached in ~/.cache/huggingface/hub/ for future use.")
print("The Python workers (nvidia_stt_worker.py, nvidia_tts_worker.py)")
print("will load these cached models on startup.")
