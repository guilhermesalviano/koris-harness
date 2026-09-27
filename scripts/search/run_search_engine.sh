#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEARXNG_DIR="${SCRIPT_DIR}/searxng"
COMPOSE_FILE="${SEARXNG_DIR}/docker-compose.yml"
# Must match docker-compose.yml's `../config` volume mount, resolved relative
# to the compose file's own directory (Compose's project-directory default
# when invoked with an explicit -f and no --project-directory). A prior
# version of this script pointed at the wrong directory, silently writing
# settings nothing ever read, which left the container running on SearXNG's
# bare defaults (no `search.formats: json`) and made every `search_engine`
# tool call fail with HTTP 403.
CONFIG_DIR="$(cd "${SEARXNG_DIR}/.." && pwd)/config"
SETTINGS_EXAMPLE="${SEARXNG_DIR}/settings.example.yml"
SETTINGS_FILE="${CONFIG_DIR}/settings.yml"

# Ensure config directory exists
mkdir -p "${CONFIG_DIR}"

# Populate settings.yml from the template on first run; never overwrite an
# existing (possibly customized) one.
if [ -f "${SETTINGS_EXAMPLE}" ]; then
  if [ ! -f "${SETTINGS_FILE}" ]; then
    cp "${SETTINGS_EXAMPLE}" "${SETTINGS_FILE}"
    echo "Copied ${SETTINGS_EXAMPLE} -> ${SETTINGS_FILE}"
  fi
  SOURCE_SETTINGS="${SETTINGS_EXAMPLE}"
else
  SOURCE_SETTINGS=""
fi

# Generate secret_key if placeholder exists
if grep -q 'REPLACE_WITH_OUTPUT' "${SETTINGS_FILE}" 2>/dev/null; then
  SECRET_KEY=$(openssl rand -hex 32)
  sed -i 's/secret_key: "REPLACE_WITH_OUTPUT.*"/secret_key: "'"${SECRET_KEY}"'"/' "${SETTINGS_FILE}" 2>/dev/null || \
    sed -i 's/^  secret_key: "REPLACE_WITH_OUTPUT.*"/  secret_key: "'"${SECRET_KEY}"'"/' "${SETTINGS_FILE}"
  echo "Generated secret_key in ${SETTINGS_FILE}"
elif [ "$SOURCE_SETTINGS" != "" ] && [ ! -f "${SETTINGS_FILE}" ]; then
  # If we just copied from a source that has a placeholder, also handle it
  SECRET_KEY=$(openssl rand -hex 32)
  sed -i 's/secret_key: "REPLACE_WITH_OUTPUT.*"/secret_key: "'"${SECRET_KEY}"'"/' "${SETTINGS_FILE}" 2>/dev/null || \
    sed -i 's/^  secret_key: "REPLACE_WITH_OUTPUT.*"/  secret_key: "'"${SECRET_KEY}"'"/' "${SETTINGS_FILE}"
  echo "Generated secret_key in ${SETTINGS_FILE}"
fi

# `--restart` forces a full recreate (down + up) even if a container is
# already running — needed when it's up but misconfigured (e.g. its bind
# mount pointed at a stale path and it fell back to SearXNG's bare defaults,
# which silently disables the JSON API and causes HTTP 403s). Without this
# flag, an already-running container is left untouched, since a plain restart
# isn't needed in the common case.
if [ "${1:-}" = "--restart" ]; then
  echo "Restarting SearXNG container..."
  # set -e means a failing `down` aborts here rather than falling through to
  # `up -d` — a failed stop is reported as a failure, not silently retried.
  docker compose -f "${COMPOSE_FILE}" down
elif docker compose -f "${COMPOSE_FILE}" ps --services --filter "status=running" | grep -q "^searxng$"; then
  echo "SearXNG is already running."
  echo "API URL: http://localhost:8080"
  exit 0
fi

# Start SearXNG container
echo "Starting SearXNG container..."
docker compose -f "${COMPOSE_FILE}" up -d

# Wait for SearXNG to be ready
echo "Waiting for SearXNG to be ready..."
MAX_WAIT=60
ELAPSED=0

while [ ${ELAPSED} -lt ${MAX_WAIT} ]; do
  if curl -sf "http://localhost:8080/search?format=json&q=test" > /dev/null 2>&1; then
    echo "SearXNG is ready!"
    echo "API URL: http://localhost:8080"
    exit 0
  fi
  ELAPSED=$((ELAPSED + 1))
  sleep 1
done

echo "Warning: SearXNG did not become ready within ${MAX_WAIT}s, but container may still be starting."
echo "API URL: http://localhost:8080"
exit 1