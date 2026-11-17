# syntax=docker/dockerfile:1
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# Contexto de build = raiz do repositório (monorepo Railway).
# Local:  docker build -f server/maria/Dockerfile .   (na raiz do repo)
# Railway: railway up + variável RAILWAY_DOCKERFILE_PATH=server/maria/Dockerfile
WORKDIR /app

# libstdc++6 — exigida por onnxruntime (piper-tts) e ctranslate2
# (faster-whisper) nas imagens slim; ~1 MB, removível se os
# providers locais de voz não forem usados.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

COPY server/maria/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server/maria/app ./app
COPY server/maria/knowledge ./knowledge

# Railway injeta PORT; fallback local 8090
EXPOSE 8090
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8090}"]
