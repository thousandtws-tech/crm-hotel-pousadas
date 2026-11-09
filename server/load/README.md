# Load tests — prova de scale-out da API

Suite k6 que valida a API sob carga e expõe o ponto de saturação real
(o pool do Postgres é o gargalo esperado, não a CPU da réplica).

## Instalar o k6

```bash
winget install k6        # Windows
choco install k6         # Windows (alternativa)
brew install k6          # macOS
docker run --rm -i grafana/k6 run - <reservas.k6.js   # sem instalar
```

Sem k6, smoke rápido via cargo (já instalado para o workspace):

```bash
cargo install oha
oha -z 60s -c 50 http://localhost:3000/api/v1/publico/acomodacoes
```

## Rodar

```bash
# Read-only (seguro contra produção — só GETs + SSE)
k6 run -e BASE_URL=https://api-production-19dc.up.railway.app server/load/reservas.k6.js

# Completo (STAGING — cria reservas e clientes de verdade)
k6 run -e BASE_URL=https://<staging> -e WRITE=1 server/load/reservas.k6.js

# Smoke local
k6 run -e BASE_URL=http://localhost:3000 server/load/reservas.k6.js
```

## Critério de aprovação (thresholds do script)

| Métrica | Alvo |
|---|---|
| p95 do catálogo (`duracao_catalogo_ms`) | < 500 ms |
| p95 geral | < 800 ms |
| Erros de aplicação (5xx/corpo inválido) | < 1 % |
| `http_req_failed` (inclui 429s) | < 5 % |

429 no `POST /publico/reservas` e `POST /auth/login` é **comportamento
esperado** do `IpRateLimit` quando toda a carga sai de um único IP — não é
falha. Para rump distribuída de verdade use `k6 cloud` ou vários agents.

## O que observar durante o platô

`/metrics` de cada réplica expõe agora:

| Gauge | Significado |
|---|---|
| `clarituz_db_pool_connections` | Conexões abertas da réplica no Postgres |
| `clarituz_db_pool_idle` | Ociosas — **chegar a 0 sustentado = saturação** |
| `clarituz_sse_subscribers` | Assinantes do bus (≈ SSE abertas na réplica) |

## Capacidade de conexões — a conta que limita réplicas

```
N réplicas × (DB_MAX_CONNECTIONS + 1 conexão LISTEN) < max_connections do PG
```

Com `DB_MAX_CONNECTIONS=10` e `max_connections=100` do Postgres Railway:

- 2 réplicas → 22 conexões — folga enorme ✓
- 5 réplicas → 55 — ok, observando o pooler
- >6 réplicas → considerar PgBouncer/Neon pooler antes de subir

O relay realtime (`PgListener`) ocupa +1 conexão por réplica — está na conta.

## Notas

- O cenário `sse` segura conexões por ~30 s — útil para verificar que o
  graceful shutdown (SIGTERM) drena SSE sem cortar clientes no deploy.
- `WRITE=1` em produção cria lixo real: reservas 'p' + clientes
  `loadtest+*@example.invalid` — limpar depois ou usar staging.
- O `POST /publico/reservas` limita a 8 req/min/IP; o cenário roda a 6/min
  justamente para medir o caminho feliz sem bater no limiter.
