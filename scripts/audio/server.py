"""
sherpa-onnx Python HTTP sidecar for speech-to-text.
Optimized for CPU inference on an Intel 2018 Mac mini.
"""

import io
import os
import sys
import wave
import logging
import asyncio
import tempfile
import subprocess
from pathlib import Path
from typing import Optional, Dict
from contextlib import asynccontextmanager

import numpy as np
from pydub import AudioSegment
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, status
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

try:
    import sherpa_onnx
except ImportError:
    sherpa_onnx = None

try:
    from piper import PiperVoice
    try:
        from piper import SynthesisConfig
    except ImportError:
        SynthesisConfig = None
except ImportError:
    PiperVoice = None
    SynthesisConfig = None

# Configure logging
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("audio-sidecar")

# Environment and paths
BASE_DIR = Path(__file__).resolve().parent

def resolve_model_files(base_dir: str):
    """Locates the whisper ONNX model files and tokens.txt inside base_dir or its subdirectories."""
    p = Path(base_dir)
    candidates = [
        p,
        p / "sherpa-onnx-whisper-small",
        p / "sherpa-onnx-whisper-base",
        p / "sherpa-onnx-whisper-tiny",
        p / "whisper-small",
        p / "whisper-base",
        p / "whisper-tiny",
    ]

    encoder_names = [
        "small-encoder.int8.onnx", "base-encoder.int8.onnx", "tiny-encoder.int8.onnx",
        "encoder.int8.onnx",
        "small-encoder.onnx", "base-encoder.onnx", "tiny-encoder.onnx",
        "encoder.onnx",
    ]
    decoder_names = [
        "small-decoder.int8.onnx", "base-decoder.int8.onnx", "tiny-decoder.int8.onnx",
        "decoder.int8.onnx",
        "small-decoder.onnx", "base-decoder.onnx", "tiny-decoder.onnx",
        "decoder.onnx",
    ]
    tokens_names = [
        "small-tokens.txt", "base-tokens.txt", "tiny-tokens.txt",
        "tokens.txt",
    ]

    for candidate in candidates:
        if not candidate.is_dir():
            continue

        encoder = None
        for name in encoder_names:
            target = candidate / name
            if target.is_file() and target.stat().st_size > 0:
                encoder = str(target)
                break

        decoder = None
        for name in decoder_names:
            target = candidate / name
            if target.is_file() and target.stat().st_size > 0:
                decoder = str(target)
                break

        tokens = None
        for name in tokens_names:
            target = candidate / name
            if target.is_file() and target.stat().st_size > 0:
                tokens = str(target)
                break

        if encoder and decoder and tokens:
            return encoder, decoder, tokens

    return None, None, None

def get_default_model_dir() -> str:
    """Finds the best available model directory, prioritizing small -> base -> tiny."""
    if "SHERPA_MODEL_DIR" in os.environ:
        return os.environ["SHERPA_MODEL_DIR"]
    models_root = BASE_DIR / "models"
    for candidate_name in [
        "whisper-small", "sherpa-onnx-whisper-small",
        "whisper-base", "sherpa-onnx-whisper-base",
        "whisper-tiny", "sherpa-onnx-whisper-tiny"
    ]:
        candidate_dir = models_root / candidate_name
        if candidate_dir.is_dir():
            enc, dec, tok = resolve_model_files(str(candidate_dir))
            if enc and dec and tok:
                return str(candidate_dir)
    return str(models_root / "whisper-small")

MODEL_DIR = get_default_model_dir()

def get_num_threads() -> int:
    """Cap threads to 2-3 to prevent CPU thermal throttling on 2018 Mac mini."""
    try:
        val = int(os.getenv("SHERPA_NUM_THREADS", "2"))
        return max(1, min(val, 4))
    except ValueError:
        return 2

NUM_THREADS = get_num_threads()

# Concurrency lock to serialize transcription requests (1 at a time)
transcription_lock = asyncio.Lock()

# Cache of initialized recognizers by language
_recognizers: Dict[str, "sherpa_onnx.OfflineRecognizer"] = {}

# --- Piper text-to-speech ---------------------------------------------------
# The TTS endpoint shares this uvicorn process with STT. It has its own lock so
# the two flows stay independent, but a simultaneous transcription + synthesis
# still contends for CPU on the host.
PIPER_VOICE_DIR = os.getenv("PIPER_VOICE_DIR", str(BASE_DIR / "models" / "piper"))
PIPER_DEFAULT_VOICE = os.getenv("PIPER_DEFAULT_VOICE", "en_US-lessac-medium")

def get_piper_max_chars() -> int:
    try:
        return max(1, int(os.getenv("PIPER_MAX_CHARS", "6000")))
    except ValueError:
        return 6000

PIPER_MAX_CHARS = get_piper_max_chars()

synthesis_lock = asyncio.Lock()

# Cache of loaded Piper voices by voice name
_piper_voices: Dict[str, "PiperVoice"] = {}

# Standard Whisper language codes for validation
WHISPER_LANGUAGES = {
    "en", "zh", "de", "es", "ru", "ko", "fr", "ja", "pt", "tr", "pl", "ca", "nl",
    "ar", "sv", "it", "id", "hi", "fi", "vi", "he", "uk", "el", "ms", "cs", "ro",
    "da", "hu", "ta", "no", "th", "ur", "hr", "bg", "lt", "la", "mi", "ml", "cy",
    "sk", "te", "fa", "lv", "bn", "sr", "az", "sl", "kn", "et", "mk", "br", "eu",
    "is", "hy", "ne", "mn", "bs", "kk", "sq", "sw", "gl", "mr", "pa", "si", "km",
    "sn", "yo", "so", "af", "oc", "ka", "be", "tg", "sd", "gu", "am", "yi", "lo",
    "uz", "fo", "ht", "ps", "tk", "nn", "mt", "sa", "lb", "my", "bo", "tl", "mg",
    "as", "tt", "haw", "ln", "ha", "ba", "jw", "su", "yue",
}


def normalize_language(lang: Optional[str]) -> str:
    """Normalizes input language string. Returns empty string for auto-detection."""
    if not lang:
        return ""
    clean = lang.strip().lower()
    if clean in ("auto", "none", "null", ""):
        return ""
    if clean in WHISPER_LANGUAGES:
        return clean
    logger.warning("Requested language '%s' is not a recognized Whisper code. Defaulting to auto-detect.", clean)
    return ""


def get_recognizer(language: Optional[str] = None) -> "sherpa_onnx.OfflineRecognizer":
    """Retrieves or creates a sherpa_onnx.OfflineRecognizer for the given language."""
    if sherpa_onnx is None:
        raise RuntimeError("sherpa-onnx package is not available in Python environment")

    lang_key = normalize_language(language)
    if lang_key in _recognizers:
        return _recognizers[lang_key]

    encoder, decoder, tokens = resolve_model_files(MODEL_DIR)
    if not (encoder and decoder and tokens):
        raise FileNotFoundError(
            f"Whisper model files not found in '{MODEL_DIR}'. Please run setup.sh first."
        )

    model_label = Path(encoder).name.split("-")[0]
    logger.info(
        "Initializing OfflineRecognizer (%s int8, num_threads=%d, language='%s')",
        model_label,
        NUM_THREADS,
        lang_key or "auto",
    )
    recognizer = sherpa_onnx.OfflineRecognizer.from_whisper(
        encoder=encoder,
        decoder=decoder,
        tokens=tokens,
        num_threads=NUM_THREADS,
        decoding_method="greedy_search",
        language=lang_key,
        task="transcribe",
        provider="cpu",
    )
    _recognizers[lang_key] = recognizer
    return recognizer


def load_audio_to_pcm16_samples(file_bytes: bytes, filename: Optional[str] = None) -> np.ndarray:
    """
    Converts incoming audio bytes (OGG/Opus, WebM, MP3, M4A, WAV, etc.)
    into 16kHz mono 16-bit PCM float32 samples in range [-1.0, 1.0],
    applying volume normalization for superior Whisper feature extraction.
    """
    if not file_bytes:
        return np.array([], dtype=np.float32)

    audio = None
    # 1. Try decoding directly in-memory via pydub
    try:
        audio = AudioSegment.from_file(io.BytesIO(file_bytes))
    except Exception:
        pass

    # 2. Fall back to temp file with original extension if stream decoding fails
    if audio is None:
        ext = os.path.splitext(filename or "")[1] or ".tmp"
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp_path = tmp.name
            tmp.write(file_bytes)
            tmp.flush()
        try:
            audio = AudioSegment.from_file(tmp_path)
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

    # Normalize audio levels (raises quiet voice recordings and boosts dynamic range)
    try:
        audio = audio.normalize()
    except Exception as norm_err:
        logger.debug("Audio normalization skipped: %s", norm_err)

    # Resample to 16kHz, single channel (mono), 16-bit depth (2 bytes)
    audio = audio.set_frame_rate(16000).set_channels(1).set_sample_width(2)

    # Convert audio samples to float32 numpy array normalized to [-1.0, 1.0]
    samples_int16 = np.array(audio.get_array_of_samples(), dtype=np.int16)
    samples_float32 = samples_int16.astype(np.float32) / 32768.0
    return samples_float32


def run_transcription(samples: np.ndarray, language: Optional[str] = None) -> str:
    """Synchronous CPU transcription run inside a worker thread."""
    recognizer = get_recognizer(language)
    stream = recognizer.create_stream()
    stream.accept_waveform(16000, samples)
    recognizer.decode_stream(stream)
    return stream.result.text.strip()


def resolve_piper_voice(name: str):
    """Locates the Piper voice .onnx + .onnx.json pair for the given voice name."""
    safe = os.path.basename((name or "").strip()) or PIPER_DEFAULT_VOICE
    onnx = Path(PIPER_VOICE_DIR) / f"{safe}.onnx"
    config_json = Path(PIPER_VOICE_DIR) / f"{safe}.onnx.json"
    if onnx.is_file() and onnx.stat().st_size > 0 and config_json.is_file():
        return str(onnx), str(config_json)
    raise FileNotFoundError(
        f"Piper voice '{safe}' not found in '{PIPER_VOICE_DIR}'. Run 'pnpm audio:setup:tts' first."
    )


def get_piper_voice(name: Optional[str] = None) -> "PiperVoice":
    """Retrieves or loads a PiperVoice for the given voice name."""
    if PiperVoice is None:
        raise RuntimeError("piper-tts package is not available in Python environment")

    voice_name = (name or "").strip() or PIPER_DEFAULT_VOICE
    if voice_name in _piper_voices:
        return _piper_voices[voice_name]

    onnx, config_json = resolve_piper_voice(voice_name)
    logger.info("Loading Piper voice '%s'", voice_name)
    voice = PiperVoice.load(onnx, config_path=config_json)
    _piper_voices[voice_name] = voice
    return voice


def run_synthesis(text: str, voice_name: Optional[str] = None, speed: float = 1.0) -> bytes:
    """Synchronous CPU synthesis run inside a worker thread. Returns WAV bytes."""
    voice = get_piper_voice(voice_name)
    length_scale = 1.0 / speed if speed and speed > 0 else 1.0

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        if hasattr(voice, "synthesize_wav"):
            kwargs = {}
            if SynthesisConfig is not None:
                kwargs["syn_config"] = SynthesisConfig(length_scale=length_scale)
            voice.synthesize_wav(text, wav_file, **kwargs)
        else:
            voice.synthesize(text, wav_file, length_scale=length_scale)
    return buf.getvalue()


def wav_duration_seconds(wav_bytes: bytes) -> float:
    """Reads the duration of a WAV blob from its header."""
    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as w:
            frames = w.getnframes()
            rate = w.getframerate()
            return round(frames / rate, 3) if rate else 0.0
    except Exception:
        return 0.0


def transcode_wav_to_ogg(wav_bytes: bytes) -> bytes:
    """Transcodes WAV bytes to OGG/Opus via ffmpeg (bundled in the container).
    OGG/Opus is what WhatsApp expects for a push-to-talk voice note."""
    proc = subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-i", "pipe:0",
            "-c:a", "libopus", "-b:a", "24k", "-application", "voip",
            "-f", "ogg", "pipe:1",
        ],
        input=wav_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    )
    return proc.stdout


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    encoder, decoder, tokens = resolve_model_files(MODEL_DIR)
    if encoder and decoder and tokens and sherpa_onnx is not None:
        try:
            logger.info("Pre-warming default recognizer...")
            get_recognizer("")
            logger.info("Default recognizer pre-warmed successfully.")
        except Exception as e:
            logger.warning("Failed to pre-warm recognizer on startup: %s", e)
    else:
        logger.warning(
            "Model files not found in '%s'. Run setup.sh to download whisper-tiny int8 model.",
            MODEL_DIR,
        )

    if PiperVoice is not None:
        try:
            resolve_piper_voice(PIPER_DEFAULT_VOICE)
            logger.info("Pre-warming default Piper voice '%s'...", PIPER_DEFAULT_VOICE)
            get_piper_voice(PIPER_DEFAULT_VOICE)
            logger.info("Default Piper voice loaded successfully.")
        except FileNotFoundError:
            logger.warning(
                "Piper voice '%s' not found in '%s'. Run 'pnpm audio:setup:tts' to enable TTS.",
                PIPER_DEFAULT_VOICE,
                PIPER_VOICE_DIR,
            )
        except Exception as e:
            logger.warning("Failed to pre-warm Piper voice on startup: %s", e)
    else:
        logger.warning("piper-tts not installed; the /v1/audio/speech endpoint is disabled.")

    yield
    # Shutdown
    _recognizers.clear()
    _piper_voices.clear()


# FastAPI App
app = FastAPI(
    title="Koris Audio Transcription Sidecar",
    description="Sherpa-onnx Whisper speech-to-text service optimized for 2018 Intel Mac mini",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", summary="Health check and model info")
async def health_check():
    encoder, decoder, tokens = resolve_model_files(MODEL_DIR)
    files_present = bool(encoder and decoder and tokens)
    is_loaded = "" in _recognizers or any(_recognizers.values())

    status_str = "ok" if (files_present and is_loaded) else ("ready" if files_present else "missing_model")

    piper_available = PiperVoice is not None
    try:
        resolve_piper_voice(PIPER_DEFAULT_VOICE)
        piper_voice_present = True
    except FileNotFoundError:
        piper_voice_present = False

    return {
        "status": status_str,
        "model": {
            "name": "whisper-tiny-int8",
            "model_dir": MODEL_DIR,
            "encoder": encoder,
            "decoder": decoder,
            "tokens": tokens,
            "threads": NUM_THREADS,
            "loaded": is_loaded,
            "cached_languages": list(_recognizers.keys()),
        },
        "tts": {
            "engine": "piper",
            "available": piper_available,
            "voice_dir": PIPER_VOICE_DIR,
            "default_voice": PIPER_DEFAULT_VOICE,
            "voice_present": piper_voice_present,
            "loaded_voices": list(_piper_voices.keys()),
            "max_chars": PIPER_MAX_CHARS,
        },
        "device": "cpu",
        "lock_acquired": transcription_lock.locked(),
        "synthesis_lock_acquired": synthesis_lock.locked(),
    }


async def transcribe_handler(
    file: Optional[UploadFile] = None,
    audio: Optional[UploadFile] = None,
    model: Optional[str] = Form(None),
    language: Optional[str] = Form(None),
    temperature: Optional[float] = Form(None),
    response_format: Optional[str] = Form(None),
):
    upload_file = file or audio
    if upload_file is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Missing required multipart audio file field ('file' or 'audio')",
        )

    try:
        file_bytes = await upload_file.read()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to read uploaded file: {e}",
        )

    if not file_bytes:
        return PlainTextResponse("") if response_format == "text" else {"text": ""}

    # Serialize transcription calls to prevent CPU overload on 2018 Mac Mini
    async with transcription_lock:
        try:
            samples = await asyncio.to_thread(
                load_audio_to_pcm16_samples, file_bytes, upload_file.filename
            )
        except Exception as e:
            logger.error("Audio processing failed: %s", e, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Audio decoding failed: {e}",
            )

        if len(samples) == 0:
            return PlainTextResponse("") if response_format == "text" else {"text": ""}

        try:
            text = await asyncio.to_thread(run_transcription, samples, language)
        except FileNotFoundError as e:
            logger.error("Model files missing: %s", e)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(e),
            )
        except Exception as e:
            logger.error("Recognition error: %s", e, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Transcription failed: {e}",
            )

    if response_format == "text":
        return PlainTextResponse(text)
    return {"text": text}


@app.post("/v1/audio/transcriptions", summary="OpenAI-compatible audio transcription")
async def post_transcriptions(
    file: Optional[UploadFile] = File(None),
    audio: Optional[UploadFile] = File(None),
    model: Optional[str] = Form(None),
    language: Optional[str] = Form(None),
    temperature: Optional[float] = Form(None),
    response_format: Optional[str] = Form(None),
):
    return await transcribe_handler(file, audio, model, language, temperature, response_format)


@app.post("/transcribe", summary="Transcription alias")
async def post_transcribe(
    file: Optional[UploadFile] = File(None),
    audio: Optional[UploadFile] = File(None),
    model: Optional[str] = Form(None),
    language: Optional[str] = Form(None),
    temperature: Optional[float] = Form(None),
    response_format: Optional[str] = Form(None),
):
    return await transcribe_handler(file, audio, model, language, temperature, response_format)


class SpeechRequest(BaseModel):
    input: str
    model: Optional[str] = None
    voice: Optional[str] = None
    response_format: Optional[str] = None
    speed: Optional[float] = None


async def speech_handler(req: SpeechRequest) -> Response:
    if PiperVoice is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="piper-tts is not installed in the sidecar Python environment.",
        )

    text = (req.input or "").strip()
    if not text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing required 'input' text field",
        )

    if len(text) > PIPER_MAX_CHARS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Input text exceeds maximum length of {PIPER_MAX_CHARS} characters.",
        )

    speed = req.speed if (req.speed and req.speed > 0) else 1.0
    fmt = (req.response_format or "wav").lower()

    # Serialize synthesis calls to prevent CPU overload
    async with synthesis_lock:
        try:
            wav_bytes = await asyncio.to_thread(run_synthesis, text, req.voice, speed)
        except FileNotFoundError as e:
            logger.error("Piper voice missing: %s", e)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(e),
            )
        except Exception as e:
            logger.error("Synthesis error: %s", e, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Synthesis failed: {e}",
            )

    headers = {"X-Audio-Duration-Seconds": str(wav_duration_seconds(wav_bytes))}

    if fmt in ("ogg", "opus"):
        try:
            ogg_bytes = await asyncio.to_thread(transcode_wav_to_ogg, wav_bytes)
        except FileNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="ffmpeg is not available for OGG transcoding.",
            )
        except subprocess.CalledProcessError as e:
            logger.error("ffmpeg transcode failed: %s", e.stderr.decode(errors="replace"))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="OGG transcoding failed.",
            )
        return Response(content=ogg_bytes, media_type="audio/ogg", headers=headers)

    return Response(content=wav_bytes, media_type="audio/wav", headers=headers)


@app.post("/v1/audio/speech", summary="OpenAI-compatible text-to-speech")
async def post_speech(req: SpeechRequest) -> Response:
    return await speech_handler(req)


@app.post("/synthesize", summary="Synthesis alias")
async def post_synthesize(req: SpeechRequest) -> Response:
    return await speech_handler(req)


if __name__ == "__main__":
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "6006"))
    logger.info("Starting audio sidecar on %s:%d (threads=%d)...", host, port, NUM_THREADS)
    uvicorn.run(app, host=host, port=port)
