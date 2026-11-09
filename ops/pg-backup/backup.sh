#!/bin/sh
# Backup diário do Postgres → MinIO (bucket `backups`, prefixo pg/, retenção RETAIN_DAYS).
# Roda na rede privada do Railway: PGHOST/MinIO internos.
set -eu

: "${PGHOST:=postgres.railway.internal}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=railway}"
: "${S3_ENDPOINT:=http://bucket.railway.internal:9000}"
: "${S3_BUCKET:=backups}"
: "${RETAIN_DAYS:=30}"
: "${INTERVAL_S:=86400}"

# pg_dump pede a senha via env
export PGPASSWORD="$PGPASSWORD"

echo "[pg-backup] início — alvo $PGHOST:$PGPORT/$PGDATABASE → $S3_ENDPOINT/$S3_BUCKET (retenção ${RETAIN_DAYS}d, intervalo ${INTERVAL_S}s)"

mc alias set local "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null
mc mb -p "local/$S3_BUCKET" 2>/dev/null || true

while :; do
  FILE="pg-$(date -u +%F-%H%M).dump.gz"
  if pg_dump -Fc "$PGDATABASE" | gzip > "/tmp/$FILE" && mc cp "/tmp/$FILE" "local/$S3_BUCKET/pg/$FILE"; then
    echo "[pg-backup] OK → $S3_BUCKET/pg/$FILE ($(du -h "/tmp/$FILE" | cut -f1))"
    mc rm --recursive --force --older-than "${RETAIN_DAYS}d" "local/$S3_BUCKET/pg/" 2>/dev/null || true
  else
    echo "[pg-backup] FALHOU — próxima tentativa no próximo ciclo" >&2
  fi
  rm -f "/tmp/$FILE"
  sleep "$INTERVAL_S"
done
