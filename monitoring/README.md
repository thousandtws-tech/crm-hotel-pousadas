# Observabilidade — Prometheus + Grafana (Railway)

Stack provisionada pelo IaC (`.railway/railway.ts`), tudo na rede privada
`*.railway.internal` — nada de métricas expostas publicamente.

```
api:PORT/metrics ─────┐
maria:PORT/metrics.prom ┼──► prometheus:9090 ──► grafana (dashboards + alertas)
pg-exporter:9187 ─────┘        │                        │
                               ▼                        ▼
                     TSDB (volume 2GB, 30d)   alert-webhook → Discord/Slack
```

## Serviços

| Serviço | Imagem/build | Papel |
|---|---|---|
| `prometheus` | `monitoring/prometheus/Dockerfile` (`prom/prometheus:v3.5.0`) | scrape 15s + avaliação de `alerts.yml` |
| `grafana` | `monitoring/grafana/Dockerfile` (`grafana/grafana:12.0.2`) | dashboard "Clarituz — Produção" + regras de notificação |
| `pg-exporter` | `postgres-exporter:v0.17.1` | conexões, locks e tamanho do Postgres (o gargalo real) |

## O que é coletado

- **api** (`/metrics`): `http_requests_total`, `http_requests_duration_seconds`
  (por método/rota/status) + gauges `clarituz_db_pool_connections`,
  `clarituz_db_pool_idle`, `clarituz_sse_subscribers` a cada 10s.
- **maria** (`/metrics.prom`): `maria_turnos_total`, `maria_tool_calls_total`,
  `maria_latencia_segundos`.
- **postgres** (exporter): `pg_stat_activity_count`, `pg_database_size_bytes`,
  `pg_locks_count`, `pg_up`.

## Alertas

- `prometheus/alerts.yml` — avaliação completa (API down, 5xx>2%, p95>800ms,
  pool idle=0, SSE>500, maria/PG down, PG>80 conexões).
- `grafana/provisioning/alerting/rules.yaml` — os 4 críticos que **notificam**:
  pool saturado, 5xx>2%, API down, MAR IA down. Avaliados pelo próprio
  Grafana (sem Alertmanager), via contact point `alert-webhook`.

## Setup pós-deploy (2 passos manuais)

1. **Domínio do Grafana** — service `grafana` → Settings → Networking →
   *Generate Domain* (é o único serviço da stack que precisa de acesso público).
2. **Variáveis do Grafana**:
   - `GF_SECURITY_ADMIN_USER` / `GF_SECURITY_ADMIN_PASSWORD` — login do painel.
   - `ALERT_WEBHOOK_URL` *(opcional)* — incoming webhook do Discord/Slack;
     sem ele as regras ainda disparam e aparecem em *Alerting*.

## Alvos dinâmicos

`prometheus` recebe `API_SCRAPE`/`MARIA_SCRAPE` via referências
`${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}` — o `entrypoint.sh`
substitui no template antes de subir. Se um alvo ficar inválido, o
container falha no boot com `API_SCRAPE não definido` — basta conferir a
variável no serviço.
