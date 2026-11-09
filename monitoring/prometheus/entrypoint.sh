#!/bin/sh
set -eu

# Alvos vêm do Railway: ${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}} etc.
sed -e "s|__API_SCRAPE__|${API_SCRAPE:?API_SCRAPE não definido}|g" \
    -e "s|__MARIA_SCRAPE__|${MARIA_SCRAPE:?MARIA_SCRAPE não definido}|g" \
    /etc/prometheus/prometheus.yml.tpl > /tmp/prometheus.yml

exec /bin/prometheus \
    --config.file=/tmp/prometheus.yml \
    --storage.tsdb.path=/prometheus \
    --storage.tsdb.retention.time=30d \
    --web.enable-lifecycle
