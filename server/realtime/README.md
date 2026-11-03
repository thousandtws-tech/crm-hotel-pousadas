# Realtime — hub central de comunicação (Elixir/Phoenix)

Central realtime do sistema: **tudo que é tempo real passa por aqui** —
CRM (admin), site público e serviços internos (API Rust, MAR IA, agente
de impressão). Phoenix Channels sobre WebSocket; nada de polling.

```text
┌─ triggers PG ─ LISTEN clarituz_delta ─┐
│                                        │
├─ trg_aviso_notificacao ─ clarituz_aviso ┤   ┌────────────┐   ┌──────────────┐
│                                        ├──▶│ PgListener │──▶│ Phoenix.PubSub│──▶ channels
└─ serviços ─ POST /api/ingest ───────────┘   └────────────┘   └──────────────┘
```

## Protocolo

### Socket autenticado — `ws(s)://host/socket` (CRM)

Handshake com `?token=<jwt>` (mesmo JWT HS256 da API, `iss=clarituz-api`).
O socket carrega `funcionario_id`, `nivel`, `nome` do token.

| Tópico | Evento | Payload | Nota |
|---|---|---|---|
| `deltas` | `delta` | `{tabela,acao,id}` | todas as tabelas (equivale ao SSE antigo) |
| `delta:<tabela>` | `delta` | `{tabela,acao,id}` | assinatura granular por tabela |
| `avisos` | `aviso` | `{id,tipo,titulo,mensagem,ate_nivel,autor_id,autor_nome,dados}` | filtrado por `nivel` no `handle_out` |
| `presenca` | `presence_state`/`presence_diff` | Phoenix.Presence | quem está online |

### Socket público — `ws(s)://host/socket/site` (site)

Sem auth, somente `site:deltas`: deltas das tabelas da whitelist pública
(`acomodacao`, `acomodacao_cms`, `acomodacao_midia`) — mesma whitelist do
SSE `/publico/stream` da API.

### Ingest (serviços → hub)

```
POST /api/ingest
X-Ingest-Token: <INGEST_TOKEN>
{"topic": "avisos", "event": "aviso", "payload": {...}}
```

Tópicos permitidos: `deltas`, `avisos`, `site:deltas`, `presenca`, `ext:*`.
Payload ≤ 7KB. Responde `202`.

### Health

`GET /health` → `{"status":"ok"}` — para o health check do Railway.

## Origem dos eventos

* **deltas** — `PgListener` escuta `clarituz_delta` (emitido pelas
  triggers `notify_delta` de todas as tabelas — ver `migrations/0006`).
* **avisos** — a migration `0022_realtime_aviso.sql` cria
  `trg_aviso_notificacao`: todo aviso persistido pela API vira NOTIFY em
  `clarituz_aviso` com payload completo. **A API Rust não muda** — o
  persister grava `notificacao` e a trigger entrega ao hub, at-least-once
  e ordenado com o histórico.
* **ingest** — qualquer serviço publica direto no hub sem passar pelo
  banco (eventos efêmeros, progresso, comandos).

## Variáveis de ambiente

| Var | Obrigatória (prod) | Descrição |
|---|---|---|
| `JWT_SECRET` | sim | **mesmo segredo da clarituz-api** — valida os tokens dos sockets |
| `DATABASE_URL` | sim | conexão PG para `Postgrex.Notifications` |
| `INGEST_TOKEN` | sim | token compartilhado do `POST /api/ingest` |
| `CHECK_ORIGIN` | sim | origens dos frontends separadas por vírgula |
| `SECRET_KEY_BASE` | sim | `mix phx.gen.secret` |
| `PHX_HOST` | sim | host público do serviço |
| `PORT` | não (default 4000) | porta HTTP |

## Rodando

```bash
cd server/realtime
mix deps.get
mix phx.server          # http://localhost:4000
mix test                # 19 testes (jwt, channels, ingest)
```

Com banco local: `docker compose up postgres realtime` (na pasta `server/`).

## Deploy (Railway)

Cada serviço sobe por `railway up` a partir de `server/realtime`
(Dockerfile multi-stage: build release OTP → runner Debian slim).
Depois do deploy, apontar `realtimeUrl` nos `environment.*` dos frontends
(`wss://<serviço>.up.railway.app/socket` e `.../socket/site`).
