#!/usr/bin/env bash
#
# run_audio_sidecar.sh - Runs the sherpa-onnx audio STT sidecar via Docker Compose.
# Mirrors scripts/search/run_search_engine.sh.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"
MODELS_DIR="${SCRIPT_DIR}/models"

# 1. Check Docker and Docker Compose
if ! command -v docker &>/dev/null; then
  echo "Error: docker is required but not installed." >&2
  exit 1
fi

if ! docker compose version &>/dev/null; then
  echo "Error: docker compose is required but not available." >&2
  exit 1
fi

# 2. Check for model files, auto-download default if missing
has_model=false
if [ -d "$MODELS_DIR" ]; then
  for dir in "${MODELS_DIR}"/*; do
    if [ -d "$dir" ] && ls "${dir}"/*encoder*.onnx &>/dev/null 2>&1; then
      has_model=true
      break
    fi
  done
fi

if [ "$has_model" = "false" ]; then
  echo "==> No Whisper models found in ${MODELS_DIR}."
  echo "==> Automatically downloading default whisper-small model..."
  bash "${SCRIPT_DIR}/setup.sh" small
fi

# 2b. Check for a Piper TTS voice, auto-download the default if missing
if ! ls "${MODELS_DIR}"/piper/*.onnx &>/dev/null 2>&1; then
  echo "==> No Piper voice found in ${MODELS_DIR}/piper."
  echo "==> Automatically downloading default Piper voice..."
  bash "${SCRIPT_DIR}/setup.sh" tts
fi

# 3. Handle --restart flag
if [ "${1:-}" = "--restart" ]; then
  echo "Restarting audio sidecar container..."
  docker compose -f "${COMPOSE_FILE}" down
elif docker compose -f "${COMPOSE_FILE}" ps --services --filter "status=running" 2>/dev/null | grep -q "^audio-sidecar$"; then
  echo "Audio sidecar is already running."
  echo "API URL: http://localhost:6006"
  exit 0
fi

# 4. Start audio sidecar container
echo "Starting audio sidecar container..."
docker compose -f "${COMPOSE_FILE}" up -d --build

# 5. Wait for sidecar to become ready
echo "Waiting for audio sidecar to be ready..."
MAX_WAIT=60
ELAPSED=0

while [ ${ELAPSED} -lt ${MAX_WAIT} ]; do
  if curl -sf "http://localhost:6006/health" > /dev/null 2>&1; then
    echo "Audio sidecar is ready!"
    echo "API URL: http://localhost:6006"
    exit 0
  fi
  ELAPSED=$((ELAPSED + 1))
  sleep 1
done

echo "Warning: Audio sidecar did not become ready within ${MAX_WAIT}s, but container may still be starting."
echo "API URL: http://localhost:6006"
exit 1
