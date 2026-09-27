#!/usr/bin/env bash
#
# run.sh - Runs the audio sidecar (delegates to Docker Compose runner)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "${SCRIPT_DIR}/run_audio_sidecar.sh" "$@"
