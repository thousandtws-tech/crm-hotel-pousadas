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

export PGPASSWORD AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY"
export AWS_EC2_METADATA_DISABLED=true

s3() { aws --endpoint-url "$S3_ENDPOINT" --region us-east-1 "$@"; }

echo "[pg-backup] início — $PGHOST:$PGPORT/$PGDATABASE → $S3_ENDPOINT/$S3_BUCKET (retenção ${RETAIN_DAYS}d, intervalo ${INTERVAL_S}s)"

s3 s3 mb "s3://$S3_BUCKET" 2>/dev/null || true

while :; do
  FILE="pg-$(date -u +%F-%H%M).dump.gz"
  if pg_dump -Fc "$PGDATABASE" | gzip > "/tmp/$FILE" && s3 s3 cp "/tmp/$FILE" "s3://$S3_BUCKET/pg/$FILE"; then
    echo "[pg-backup] OK → $S3_BUCKET/pg/$FILE ($(du -h "/tmp/$FILE" | cut -f1))"
    CUTOFF=$(date -u -d "-${RETAIN_DAYS} days" +%Y-%m-%dT%H:%M:%SZ)
    s3 s3api list-objects-v2 --bucket "$S3_BUCKET" --prefix pg/ \
      --query "Contents[?LastModified<'$CUTOFF'].Key" --output text \
      | tr '\t' '\n' | while IFS= read -r KEY; do
          [ -n "$KEY" ] && [ "$KEY" != "None" ] && s3 s3 rm "s3://$S3_BUCKET/$KEY"
        done
  else
    echo "[pg-backup] FALHOU — próxima tentativa no próximo ciclo" >&2
  fi
  rm -f "/tmp/$FILE"
  sleep "$INTERVAL_S"
done
