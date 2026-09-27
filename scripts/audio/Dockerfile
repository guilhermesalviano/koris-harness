FROM python:3.11-slim

# Install system dependencies: ffmpeg for audio decoding (OGG, WebM, MP3, etc.),
# espeak-ng for Piper phonemization, and curl for health checks
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    espeak-ng \
    espeak-ng-data \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application server
COPY server.py .

# Configuration defaults
ENV PORT=6006
ENV HOST=0.0.0.0
ENV SHERPA_NUM_THREADS=2
ENV SHERPA_MODEL_DIR=/app/models
ENV PIPER_VOICE_DIR=/app/models/piper
ENV PIPER_DEFAULT_VOICE=en_US-lessac-medium

EXPOSE 6006

CMD ["python", "server.py"]
