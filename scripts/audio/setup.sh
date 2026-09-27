#!/usr/bin/env bash
#
# setup.sh - Setup environment and models for sherpa-onnx STT audio sidecar
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${SCRIPT_DIR}/.venv"
REQ_FILE="${SCRIPT_DIR}/requirements.txt"
OS_NAME="$(uname -s)"

# TTS mode: download a Piper voice pair (.onnx + .onnx.json) and exit.
# No virtualenv or Whisper model is needed for this — the voice files are
# consumed by piper-tts inside the sidecar container.
if [ "${1:-}" = "tts" ]; then
  VOICE_NAME="${2:-en_US-lessac-medium}"
  PIPER_DIR="${SCRIPT_DIR}/models/piper"

  case "$VOICE_NAME" in
    en_US-lessac-medium) HF_SUBPATH="en/en_US/lessac/medium" ;;
    en_US-amy-medium)    HF_SUBPATH="en/en_US/amy/medium" ;;
    en_GB-alba-medium)   HF_SUBPATH="en/en_GB/alba/medium" ;;
    pt_BR-cadu-medium)   HF_SUBPATH="pt/pt_BR/cadu/medium" ;;
    pt_BR-faber-medium)  HF_SUBPATH="pt/pt_BR/faber/medium" ;;
    pt_BR-edresson-low)  HF_SUBPATH="pt/pt_BR/edresson/low" ;;
    *)
      echo "Unknown Piper voice '${VOICE_NAME}'." >&2
      echo "Add its Hugging Face subpath to scripts/audio/setup.sh, or place" >&2
      echo "${VOICE_NAME}.onnx and ${VOICE_NAME}.onnx.json into ${PIPER_DIR}/ manually." >&2
      exit 1
      ;;
  esac

  BASE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/${HF_SUBPATH}"
  mkdir -p "$PIPER_DIR"

  echo "=== Koris Audio Sidecar Setup (Piper voice: ${VOICE_NAME}) ==="

  for ext in onnx onnx.json; do
    TARGET="${PIPER_DIR}/${VOICE_NAME}.${ext}"
    if [ -s "$TARGET" ]; then
      echo "==> ${VOICE_NAME}.${ext} already exists in ${PIPER_DIR}. Skipping download."
      continue
    fi
    URL="${BASE_URL}/${VOICE_NAME}.${ext}"
    echo "==> Downloading ${URL}"
    if command -v curl &>/dev/null; then
      curl -fSL --progress-bar -o "$TARGET" "$URL"
    elif command -v wget &>/dev/null; then
      wget -q --show-progress -O "$TARGET" "$URL"
    else
      echo "Error: curl or wget is required to download voice files." >&2
      exit 1
    fi
    if [ ! -s "$TARGET" ]; then
      rm -f "$TARGET"
      echo "Error: Failed to download ${URL}" >&2
      exit 1
    fi
  done

  echo ""
  echo "=== Piper voice ready in ${PIPER_DIR} ==="
  echo "Enable TTS by setting audio.tts.enabled = true in koris.json, then: pnpm audio:start"
  exit 0
fi

# Model selection: small (recommended for Portuguese), base, or tiny
MODEL_SIZE="${1:-small}"
case "$MODEL_SIZE" in
  small)
    ARCHIVE_NAME="sherpa-onnx-whisper-small.tar.bz2"
    MODEL_DIR="${SCRIPT_DIR}/models/whisper-small"
    MODEL_PREFIX="small"
    FALLBACK_URL="https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small/resolve/main/${ARCHIVE_NAME}"
    ;;
  base)
    ARCHIVE_NAME="sherpa-onnx-whisper-base.tar.bz2"
    MODEL_DIR="${SCRIPT_DIR}/models/whisper-base"
    MODEL_PREFIX="base"
    FALLBACK_URL="https://huggingface.co/csukuangfj/sherpa-onnx-whisper-base/resolve/main/${ARCHIVE_NAME}"
    ;;
  tiny)
    ARCHIVE_NAME="sherpa-onnx-whisper-tiny.tar.bz2"
    MODEL_DIR="${SCRIPT_DIR}/models/whisper-tiny"
    MODEL_PREFIX="tiny"
    FALLBACK_URL="https://huggingface.co/csukuangfj/sherpa-onnx-whisper-tiny/resolve/main/${ARCHIVE_NAME}"
    ;;
  *)
    echo "Usage: $0 [small|base|tiny] (default: small)" >&2
    exit 1
    ;;
esac

echo "=== Koris Audio Sidecar Setup (Model: whisper-${MODEL_SIZE}) ==="

# 1. Check Python 3
if ! command -v python3 &>/dev/null; then
  echo "Error: python3 is required but not installed." >&2
  if [ "$OS_NAME" = "Darwin" ]; then
    echo "Tip for macOS: install Python via Homebrew with 'brew install python3'" >&2
  else
    echo "Tip: install python3 using your system package manager." >&2
  fi
  exit 1
fi
echo "[OK] Found python3: $(python3 --version)"

# 2. Check ffmpeg (required by pydub for non-WAV audio conversion)
if ! command -v ffmpeg &>/dev/null; then
  echo "Error: ffmpeg is required to decode audio formats (OGG, WebM, MP3, M4A)." >&2
  if [ "$OS_NAME" = "Darwin" ]; then
    echo "==> On macOS, please install ffmpeg using Homebrew:" >&2
    echo "    brew install ffmpeg" >&2
  else
    echo "==> On Linux, please install ffmpeg:" >&2
    echo "    sudo apt update && sudo apt install -y ffmpeg" >&2
  fi
  exit 1
fi
echo "[OK] Found ffmpeg: $(command -v ffmpeg)"

# 3. Create virtual environment
if [ ! -d "$VENV_DIR" ]; then
  echo "==> Creating Python virtual environment in ${VENV_DIR}..."
  python3 -m venv "$VENV_DIR"
else
  echo "==> Virtual environment already exists at ${VENV_DIR}"
fi

# 4. Install requirements
echo "==> Installing Python dependencies..."
"${VENV_DIR}/bin/pip" install --upgrade pip --quiet
"${VENV_DIR}/bin/pip" install -r "$REQ_FILE" --quiet
echo "[OK] Python dependencies installed."

# 5. Download and unpack Whisper model
mkdir -p "$MODEL_DIR"

ENCODER_FILE="${MODEL_DIR}/${MODEL_PREFIX}-encoder.int8.onnx"
DECODER_FILE="${MODEL_DIR}/${MODEL_PREFIX}-decoder.int8.onnx"
TOKENS_FILE="${MODEL_DIR}/${MODEL_PREFIX}-tokens.txt"

if [ -s "$ENCODER_FILE" ] && [ -s "$DECODER_FILE" ] && [ -s "$TOKENS_FILE" ]; then
  echo "==> Whisper ${MODEL_SIZE} int8 model files already exist in ${MODEL_DIR}. Skipping download."
else
  echo "==> Downloading sherpa-onnx-whisper-${MODEL_SIZE} int8 model..."
  TEMP_ARCHIVE="${MODEL_DIR}/${ARCHIVE_NAME}.tmp"
  PRIMARY_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${ARCHIVE_NAME}"

  DOWNLOAD_SUCCESS=false

  if command -v curl &>/dev/null; then
    echo "Downloading from GitHub releases: ${PRIMARY_URL}"
    if curl -fSL --progress-bar -o "$TEMP_ARCHIVE" "$PRIMARY_URL"; then
      DOWNLOAD_SUCCESS=true
    else
      echo "Primary download failed, trying Hugging Face mirror: ${FALLBACK_URL}"
      if curl -fSL --progress-bar -o "$TEMP_ARCHIVE" "$FALLBACK_URL"; then
        DOWNLOAD_SUCCESS=true
      fi
    fi
  elif command -v wget &>/dev/null; then
    echo "Downloading from GitHub releases: ${PRIMARY_URL}"
    if wget -q --show-progress -O "$TEMP_ARCHIVE" "$PRIMARY_URL"; then
      DOWNLOAD_SUCCESS=true
    else
      echo "Primary download failed, trying Hugging Face mirror: ${FALLBACK_URL}"
      if wget -q --show-progress -O "$TEMP_ARCHIVE" "$FALLBACK_URL"; then
        DOWNLOAD_SUCCESS=true
      fi
    fi
  else
    echo "Error: curl or wget is required to download model files." >&2
    exit 1
  fi

  if [ "$DOWNLOAD_SUCCESS" != "true" ] || [ ! -s "$TEMP_ARCHIVE" ]; then
    rm -f "$TEMP_ARCHIVE"
    echo "Error: Failed to download model archive from both primary and mirror URLs." >&2
    exit 1
  fi

  echo "==> Unpacking model archive into ${MODEL_DIR}..."
  tar -xjf "$TEMP_ARCHIVE" -C "$MODEL_DIR" --strip-components=1
  rm -f "$TEMP_ARCHIVE"
fi

# 6. Verify model files
echo "==> Verifying model files..."
for f in "$ENCODER_FILE" "$DECODER_FILE" "$TOKENS_FILE"; do
  if [ ! -s "$f" ]; then
    echo "Error: Model file $(basename "$f") is missing or empty in ${MODEL_DIR}!" >&2
    exit 1
  fi
  size_human="$(ls -lh "$f" | awk '{print $5}')"
  echo "  [OK] $(basename "$f") (${size_human})"
done

echo ""
echo "=== Setup completed successfully! ==="
echo "You can now start the sidecar using:"
echo "  pnpm audio:start"
echo "  # or: bash ${SCRIPT_DIR}/run.sh"
