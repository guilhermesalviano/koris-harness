# Koris Audio Sidecar (sherpa-onnx + Piper)

A lightweight, local HTTP sidecar for Koris providing:

- **Speech-to-text (STT)** via [`sherpa-onnx`](https://github.com/k2-fsa/sherpa-onnx) and quantized `whisper` int8 models.
- **Text-to-speech (TTS)** via [Piper](https://github.com/OHF-Voice/piper1-gpl) neural voices.

Both run in the **same container / same port** (`6006`). Optimized for CPU inference on an **Intel 2018 Mac mini** (and similar host machines), with tailored STT support for **Portuguese** and multilingual audio notes.

> **CPU note:** STT and TTS each serialize their own requests with a separate `asyncio.Lock`, but they share one uvicorn process — a transcription and a synthesis running at the same time will contend for CPU on the host.

---

## Features

- **OpenAI Compatible Endpoint**: Ingest audio at `POST /v1/audio/transcriptions` (and alias `POST /transcribe`) via `multipart/form-data`.
- **Broad Audio Format Support**: Converts any incoming audio format (OGG/Opus from WhatsApp, WebM from Web, MP3, M4A, WAV, etc.) to 16kHz mono 16-bit PCM using `pydub` and `ffmpeg`.
- **Dynamic Gain Normalization**: Automatically normalizes audio volume prior to inference, ensuring quiet voice notes from WhatsApp are clearly transcribed.
- **Model Options & Portuguese Quality**:
  - `whisper-small` (*Recommended default*): ~480MB RAM footprint. Cuts word error rate dramatically (>60% reduction over tiny) and handles Brazilian accents, slang, contractions (*tá*, *pra*, *né*). Takes ~2.5–4.0s for a 5s voice note on a 2018 Mac mini.
  - `whisper-base`: ~140MB RAM footprint. Faster alternative (~1s), good baseline accuracy.
  - `whisper-tiny`: ~70MB RAM footprint. Ultra-lightweight for low-spec embedded hardware.
- **CPU & Thermal Management**:
  - Defaults to 2 compute threads (`SHERPA_NUM_THREADS=2`) to prevent thermal throttling on Intel Core i3/i5/i7.
  - Serializes incoming transcription requests with an `asyncio.Lock()` (1 concurrent transcription at a time) to prevent CPU spikes.
- **Fast Startup & Health Checks**: `GET /health` returns service status, loaded model details, and Piper TTS voice state.
- **Text-to-Speech (Piper)**: `POST /v1/audio/speech` (and alias `POST /synthesize`) takes a JSON body and returns `audio/wav` bytes. Voices are `.onnx` + `.onnx.json` pairs from [`rhasspy/piper-voices`](https://huggingface.co/rhasspy/piper-voices), stored in `./models/piper/`. Default voice: `en_US-lessac-medium`.

---

## Prerequisites

- **Docker & Docker Compose** (Recommended for cross-platform, zero-dependency execution):
  - macOS / Windows: [Docker Desktop](https://www.docker.com/products/docker-desktop/)
  - Linux: `docker` and `docker compose` plugin (`sudo apt install docker-compose-plugin`)
- *(Optional - for running directly on host without Docker)*:
  - Python 3.9+ and `ffmpeg` (`brew install ffmpeg` or `sudo apt install ffmpeg`)

---

## Quick Start (Docker - Recommended)

### 1. Start the Container
Run the automated Docker runner (auto-builds container, mounts models, and verifies readiness):

```bash
pnpm audio:start
# Or directly:
bash scripts/audio/run_audio_sidecar.sh

# To force a full container restart / recreate:
bash scripts/audio/run_audio_sidecar.sh --restart
```

### 2. Manage Models (Optional)
By default, the setup downloads and uses `whisper-small` into `./models/whisper-small` (the sweet spot for Portuguese accuracy). You can download different model sizes onto the host at any time:

```bash
pnpm audio:setup:small   # Default & recommended for Portuguese (~480MB)
pnpm audio:setup:base    # Faster baseline (~140MB)
pnpm audio:setup:tiny    # Ultra-lightweight (~70MB)
```

The container automatically mounts `./models` and auto-detects the highest capability model present.

### 3. Download a Piper TTS Voice (Optional)
Only needed if you enable text-to-speech (`audio.tts.enabled = true` in `koris.json`). `pnpm audio:start` auto-downloads the default voice if `./models/piper/` is empty; you can also fetch it explicitly:

```bash
pnpm audio:setup:tts     # Default voice en_US-lessac-medium (~63MB)
# other known voices:
bash scripts/audio/setup.sh tts en_US-amy-medium
bash scripts/audio/setup.sh tts en_GB-alba-medium
bash scripts/audio/setup.sh tts pt_BR-cadu-medium     # Brazilian Portuguese
bash scripts/audio/setup.sh tts pt_BR-faber-medium
bash scripts/audio/setup.sh tts pt_BR-edresson-low
```

Then set `audio.tts.voice` in `koris.json` to the voice name (e.g. `pt_BR-cadu-medium`)
and restart koris. The sidecar reads `./models/piper/` as a bind mount, so a newly
downloaded voice is picked up without rebuilding the container.

Voice files land in `./models/piper/<voice>.onnx` (+ `.onnx.json`). To use a voice not in the built-in list, add its Hugging Face subpath to `scripts/audio/setup.sh`, or drop the two files into `./models/piper/` by hand.

---

## API Reference

### 1. Health Check
```bash
curl http://127.0.0.1:6006/health
```

Example response:
```json
{
  "status": "ok",
  "model": {
    "name": "whisper-tiny-int8",
    "model_dir": "/path/to/koris/scripts/audio/models/whisper-tiny",
    "encoder": "/path/to/koris/scripts/audio/models/whisper-tiny/tiny-encoder.int8.onnx",
    "decoder": "/path/to/koris/scripts/audio/models/whisper-tiny/tiny-decoder.int8.onnx",
    "tokens": "/path/to/koris/scripts/audio/models/whisper-tiny/tiny-tokens.txt",
    "threads": 2,
    "loaded": true,
    "cached_languages": [""]
  },
  "device": "cpu",
  "lock_acquired": false
}
```

### 2. OpenAI Transcription (`/v1/audio/transcriptions` or `/transcribe`)

Send an audio file using multipart form data:

```bash
curl http://127.0.0.1:6006/v1/audio/transcriptions \
  -F "file=@/path/to/voice_message.ogg" \
  -F "model=whisper-tiny"
```

Response:
```json
{
  "text": "Hello world, this is a test audio transcription."
}
```

Optional parameters:
- `language`: e.g. `"en"`, `"pt"`, `"es"`, `"fr"`. Omit or set to `"auto"` for automatic language detection.
- `temperature`: float (ignored by greedy search, accepted for OpenAI SDK compatibility).
- `response_format`: `"json"` (default, returns `{"text": ...}`) or `"text"` (returns plain text string).

### 3. OpenAI Text-to-Speech (`/v1/audio/speech` or `/synthesize`)

Send a JSON body; the response is raw `audio/wav` bytes:

```bash
curl http://127.0.0.1:6006/v1/audio/speech \
  -H 'Content-Type: application/json' \
  -d '{"input": "Hello world", "voice": "en_US-lessac-medium"}' \
  --output out.wav
```

Body fields:
- `input` (required): the text to speak. Rejected with `400` if empty or longer than `PIPER_MAX_CHARS`.
- `voice`: voice name, matching a file in `./models/piper/`. Defaults to `PIPER_DEFAULT_VOICE`.
- `speed`: `1.0` = normal, `>1.0` faster, `<1.0` slower (mapped internally to Piper `length_scale`).
- `response_format`: `"wav"` (default) or `"ogg"` / `"opus"`. `"ogg"` pipes the WAV through
  ffmpeg to OGG/Opus (`Content-Type: audio/ogg`) — the format WhatsApp needs for a
  push-to-talk voice note.
- `model`: accepted for OpenAI SDK compatibility (ignored).

Every response carries an `X-Audio-Duration-Seconds` header (read from the synthesized WAV).

Returns `503` if `piper-tts` is not installed or the requested voice files are missing.

---

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Host address to bind HTTP server |
| `PORT` | `6006` | Port to bind HTTP server |
| `SHERPA_NUM_THREADS` | `2` | Number of CPU compute threads for ONNX runtime (1–4) |
| `SHERPA_MODEL_DIR` | `scripts/audio/models/whisper-tiny` | Directory containing model `.onnx` and `tokens.txt` files |
| `PIPER_VOICE_DIR` | `scripts/audio/models/piper` | Directory containing Piper `<voice>.onnx` + `<voice>.onnx.json` pairs |
| `PIPER_DEFAULT_VOICE` | `en_US-lessac-medium` | Voice used when a request omits `voice` |
| `PIPER_MAX_CHARS` | `6000` | Max `input` length accepted by `/v1/audio/speech` |
| `LOG_LEVEL` | `INFO` | Logging level (`DEBUG`, `INFO`, `WARNING`, `ERROR`) |

---

## macOS Auto-Start (launchd)

To run the audio sidecar automatically in the background upon login on macOS:

1. Copy the plist template to `~/Library/LaunchAgents/`:
   ```bash
   cp scripts/audio/com.koris.audio-sidecar.plist ~/Library/LaunchAgents/
   ```

2. Replace the `__KORIS_ROOT__` and `__HOME__` placeholders:
   ```bash
   KORIS_DIR="$(pwd)"
   sed -i '' "s|__KORIS_ROOT__|${KORIS_DIR}|g" ~/Library/LaunchAgents/com.koris.audio-sidecar.plist
   sed -i '' "s|__HOME__|${HOME}|g" ~/Library/LaunchAgents/com.koris.audio-sidecar.plist
   ```

3. Load and start the service:
   ```bash
   launchctl load ~/Library/LaunchAgents/com.koris.audio-sidecar.plist
   ```

4. Verify service is running:
   ```bash
   launchctl list | grep koris
   curl http://127.0.0.1:6006/health
   ```

5. View service logs:
   ```bash
   tail -f ~/Library/Logs/koris-audio-sidecar.log
   tail -f ~/Library/Logs/koris-audio-sidecar.err.log
   ```

6. To stop / unload:
   ```bash
   launchctl unload ~/Library/LaunchAgents/com.koris.audio-sidecar.plist
   ```
