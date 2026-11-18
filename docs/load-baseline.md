# Baseline de performance da API

Medição de linha de base dos endpoints quentes em **localhost** — latência
p50/p95/p99 e throughput sob carga leve (17 VUs, ~50 s). Complementa
`server/load/reservas.k6.js`, que mede o ponto de saturação (scale-out);
aqui o objetivo é o "quanto custa cada chamada no caminho feliz".

> **Nunca apontar `BASE_URL` para produção** — o cenário `ciclo_admin` e
> `reserva_site` escrevem de verdade (reservas, check-ins, check-outs,
> clientes). Somente `http://localhost:*`.

## Ferramenta

- **k6** (`k6.exe v2.3.0`) — `server/load/baseline.k6.js`
- Cenários:
  | Cenário | VUs | Duração | O que mede |
  |---|---|---|---|
  | `browse` | 10 | 50 s | `GET /publico/acomodacoes` + `GET /publico/acomodacoes/{slug}` |
  | `ciclo_admin` | 5 | 50 s | `POST /reservas` → `POST /reservas/{id}/check-in` → `POST /reservas/{id}/check-out` (JWT) |
  | `reserva_site` | ~6 req/min | 50 s | `POST /publico/reservas` (sem auth, limiter 8/min/IP) |

## Ambiente da medição (2026-11-18)

| Item | Valor |
|---|---|
| Máquina | Windows 11 Pro 10.0.26300 |
| CPU | AMD Ryzen 7 5825U (8c/16t) |
| RAM | 16 GB |
| Build | `cargo build -p clarituz-api` — **profile dev (debug, sem otimização)** |
| Banco | PostgreSQL 17.11 local (scoop), mesmo host — latência de rede ~0 |
| API | 1 instância, `DB_MAX_CONNECTIONS=10`, tracing em nível DEBUG |
| Cargo / k6 | 1.100.0 / v2.3.0 |

Os números são **conservadores**: build debug + log DEBUG por request.
Release (`cargo build --release`) e `RUST_LOG=info` devem melhorar.

## Resultados medidos

Run final: **26.426 requests em ~51 s — 517,5 req/s**, 9.365 iterações,
0 VU errors, checks 99,97%. Thresholds do script: **todos passaram**.

| Endpoint | p50 | p95 | p99 | max | req/s* |
|---|---|---|---|---|---|
| `GET /api/v1/publico/acomodacoes` (catálogo) | 7,4 ms | 11,6 ms | 15,5 ms | 21,8 ms | ~172 |
| `GET /api/v1/publico/acomodacoes/{slug}` (detalhe) | 3,9 ms | 6,8 ms | 10,0 ms | 31,1 ms | ~172 |
| `POST /api/v1/reservas` (criar reserva — admin) | 9,0 ms | 12,8 ms | 18,4 ms | 1.023 ms† | ~53 |
| `POST /api/v1/reservas/{id}/check-in` | 9,2 ms | 12,9 ms | 18,9 ms | 1.168 ms† | ~53 |
| `POST /api/v1/reservas/{id}/check-out` | 10,0 ms | 14,1 ms | 22,0 ms | 168 ms | ~53 |
| `POST /api/v1/publico/reservas` (reserva site) | 7,2 ms | 25,5 ms | 27,1 ms | 27,5 ms | ~0,1 (cap 8/min) |
| `http_req_duration` (geral) | 9,2 ms | 13,2 ms | 18,9 ms | 1.168 ms | 517,5 |

\* estimado pela participação no mix; o total medido foi 517,5 req/s.
† outliers isolados no warm-up inicial (primeira rajada); p99 já está limpo.

Erros e conflitos:
- `erros_app` (5xx ou status inesperado): **0,011 %** (3 de 26.424) — transitórios de warm-up.
- `conflitos_reserva`: 1,7 % (137/7.979) — overlap de período no INSERT (23P01 → 409). Esperado sob concorrência; é a constraint anti-overbooking trabalhando.
- `conflitos_site`: 4 de 6 chamadas → 409 — ver "Achados" abaixo.
- Pool do Postgres ao final: `clarituz_db_pool_idle 9/10` — pool longe da saturação nessa carga.

## Thresholds sugeridos (localhost, dev)

Baseados nesta medição (margem ~10× sobre o p95 observado para absorver
variação de máquina/CI):

| Endpoint | p95 sugerido |
|---|---|
| `GET /publico/acomodacoes` | < 500 ms (mantém o threshold existente de `reservas.k6.js`) |
| `POST /reservas` (admin) | < 500 ms |
| `POST /reservas/{id}/check-in` | < 500 ms |
| `POST /reservas/{id}/check-out` | < 500 ms (já está no script) |
| `POST /publico/reservas` | < 800 ms |
| geral | < 800 ms; `erros_app` < 1 % |

Em produção (Railway, rede real, TLS, pool compartilhado) re-medir — estes
números são latência de **app+DB no mesmo host**, sem rede.

## Como reproduzir

### 1. Banco de dados

Opção A — Docker (compose sobe Postgres 17 com a senha esperada):

```bash
docker compose -f server/docker-compose.yml up -d postgres
```

Opção B — Postgres local já instalado (foi o caso nesta medição):

```bash
pg_ctl -D <PGDATA> start
psql -h localhost -U postgres -c "CREATE ROLE clarituz LOGIN PASSWORD 'clarituz' SUPERUSER;"
psql -h localhost -U postgres -c "CREATE DATABASE clarituz OWNER clarituz;"
```

### 2. Configurar e subir a API

```bash
# server/.env (gitignored) — mínimo:
#   HTTP_ADDR=127.0.0.1:3000
#   DATABASE_URL=postgres://clarituz:clarituz@localhost:5432/clarituz
#   JWT_SECRET=<32+ chars>
#   DB_MAX_CONNECTIONS=10
cd server
cargo build -p clarituz-api
./target/debug/clarituz-api migrate
psql "postgres://clarituz:clarituz@localhost:5432/clarituz" -f load/seed-baseline.sql
./target/debug/clarituz-api create-admin --login loadbaseline --nome "Load" --senha "<senha>"
./target/debug/clarituz-api serve   # fica no ar em 127.0.0.1:3000
```

`seed-baseline.sql` cria (idempotente): 1 cliente adulto (retorna o `id` —
usar em `IDCLIENTE`), 4 acomodações `901–904` e a publicação no CMS
(`acomodacao_cms` `publicado`) — sem isso o catálogo público vem vazio.
`forma_pagamento`/`tipo_acomodacao` já vêm da migration `0002_seed.sql`.

### 3. Rodar o baseline

```bash
# da raiz do repo
k6 run -e BASE_URL=http://localhost:3000 \
       -e ADMIN_LOGIN=loadbaseline -e ADMIN_SENHA=<senha> \
       -e IDCLIENTE=1 \
       --summary-trend-stats="avg,min,med,max,p(90),p(95),p(99)" \
       --summary-export=/tmp/baseline-summary.json \
       server/load/baseline.k6.js
```

`--summary-trend-stats` é necessário no k6 v2 — o default não emite p(99).

### 4. Limpeza (opcional)

```sql
-- remove o que o teste gravou
DELETE FROM reserva WHERE obs LIKE '%k6%';
DELETE FROM reserva WHERE obs LIKE '%Reserva pelo Site%' AND obs LIKE '%1190000%';
DELETE FROM cliente WHERE email LIKE 'loadbaseline%@example.invalid' OR cpf = '00000000191';
DELETE FROM acomodacao_cms WHERE slug LIKE 'suite-baseline-%';
DELETE FROM acomodacao WHERE numero BETWEEN 901 AND 904;
```

## Achados durante a medição (não bloqueantes)

1. **`reserva_pos_reserva` quebrada** — `infrastructure/…/comunicacao.rs:~846`
   seleciona `r.valor_total`, coluna que **não existe** em `reserva`
   (o total vive em `consumo`). Toda reserva de site loga
   `erro de banco … column r.valor_total does not exist` (42703) e a
   sinalização pós-reserva falha silenciosamente (warn). Idem
   `comunicacao.rs:721-723` (LTV/ticket médio).
2. **409 espúrio em `POST /publico/reservas`** — o CPF sintético
   `SITE-{telefone}-{simples()[..6]}` usa os 6 primeiros hex de nanos, que
   só mudam a cada ~68 s. Mesma origem + e-mail novo dentro da janela →
   `site_upsert` não acha por e-mail → INSERT colide em `cliente.cpf`
   (23505) → `Conflito` escapa do match e vira 409 ("Registro duplicado.")
   em vez de 201 `consulta_registrada`. Borda real: mesmo telefone com
   e-mail diferente re-tentando em < ~68 s.
3. **`reservas.k6.js` desatualizado** — o cenário `reserva` (WRITE=1) não
   envia `aceito_termos`; o campo virou obrigatório (CDC) → o endpoint
   responde 422 hoje. O cenário novo `baseline.k6.js` já envia
   `aceito_termos: true`.
4. **`checkout público` não exercitável sem gateway** —
   `POST /publico/pagamentos/checkout` exige `STRIPE_SECRET_KEY` ou
   integração persistida; sem isso falha no `gateway_nova_cobranca()`.
   O checkout medido aqui é o da recepção (`POST /reservas/{id}/check-out`).

## Arquivos

- `server/load/baseline.k6.js` — cenário leve (este doc)
- `server/load/seed-baseline.sql` — seed mínimo idempotente
- `server/load/reservas.k6.js` — suite pesada de scale-out (existente)
