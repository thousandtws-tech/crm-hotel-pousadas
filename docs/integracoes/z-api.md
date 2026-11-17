# Integração Z-API — arquitetura e operação

Módulo **Configurações → Integrações → Comunicação → Z-API** para WhatsApp
Business via Z-API. Reutiliza o cofre de credenciais, a fila persistente e
os fluxos de concierge/atendimento existentes.

## Decisões de design

| Decisão | Escolha | Motivo |
| --- | --- | --- |
| Config | `integracao(provedor='zapi', ambiente='producao', categoria='comunicacao')` | Z-API não tem sandbox — não inventar |
| `instance_id` | `integracao.config` JSONB (não-segredo, visível no GET) | É identificador, não credencial |
| `instance_token` / `client_token` | `integracao_segredo` AES-256-GCM | Credenciais permanentes |
| Auth de callback | header `Client-Token` (CT-compare) + `instancia` do path deve bater com `config.instance_id` | Z-API não assina webhooks; o header Client-Token é o bearer nativo |
| Cliente | `ZApiCliente` infra — `api.z-api.io/instances/{id}/token/{tok}/…` + header `Client-Token` | Contrato oficial |
| Sanitização | helper `erro_status` próprio — só o código HTTP + classe; nunca path (carrega token) nem corpo | URL carrega segredo |
| Emissor | `ZApiEmissor: Emissor` + `provedor()='zapi'` | `Emissor` ganha `provedor()`; dispatcher filtra |
| Seleção | `fila_envio.provedor` persiste quem envia; nulo → `integracao_padrao(escopo='whatsapp')` → env legado (meta) | Seleção explícita; retry nunca troca de provedor |
| Inbox | `comunicacao_evento(provedor, event_id, tipo, payload, idintegracao, status)` UNIQUE(provedor, event_id) | ACK só após gravar — dedup **antes** dos efeitos |
| Estados | `fila_envio` + `aceito_em`, `entregue_em`, `lido_em` (monotônicos) | aceite/entrega/leitura são marcos separados |
| Telefone | dígitos completos com/sem DDI 55; sem sufixo | `right(8)` colide entre pessoas de DDDs diferentes |

## Endpoints admin (`/api/v1/integracoes`, admin-only)

O catálogo agrupa por `categoria`: Pagamentos (3×2) e Comunicação
(Z-API, só `producao`). Além das operações genéricas (salvar, habilitar,
padrão, testar, eventos):

```
POST /api/v1/integracoes/zapi/producao/qr-code      → {tipo:'imagem',valor}|{tipo:'assistido'}
POST /api/v1/integracoes/zapi/producao/webhooks     → {callbacks_configurados}
POST /api/v1/integracoes/zapi/producao/teste-msg    → {telefone, texto} — 1 envio, sem retry
POST /api/v1/integracoes/zapi/producao/desconectar  → logout remoto explícito
```

## Webhooks Z-API

- `POST /api/v1/webhooks/zapi/{instancia}` — `instancia` deve bater com
  `config.instance_id` e o header `Client-Token` com o segredo salvo.
- Tipos: `ReceivedCallback` (→ concierge), `DeliveryCallback` e
  `MessageStatusCallback` (→ marcos entregue/lido), `ConnectedCallback`/
  `DisconnectedCallback` (→ `config.sessao` via `mesclar_config`).
- Filtros antes dos efeitos: `fromMe`, `waitingMessage`, grupos,
  newsletter/broadcast, remetentes `@lid`/`@g.us`.
- ACK 200 só depois do insert na inbox; processamento no mesmo request +
  sweeper (`spawn_zapi_eventos`, 60s) reprocessa `pendente`/`falha`.

## Status

| Item | Estado |
| --- | --- |
| Catálogo/cofre/segredos/versão | Implementado + testado (e2e `integracoes.rs`) |
| Cliente (status, QR, send-text, webhooks, disconnect) | Implementado; **pendente homologação** com instância real |
| Envio pela fila + seleção explícita | Implementado |
| Webhooks + inbox + marcos | Implementado; dedup/dispatch testado em unit (`zapi.rs` services) |
| Sweeper de eventos | Implementado |
| Fix telefone (dígitos completos) | Implementado em `reserva_por_telefone` + `opt_out_telefone` |
| Pareamento QR real | **Pendente** — exige credenciais de instância |

## Pendências externas

- Credenciais reais (instance_id + tokens) para homologação.
- Homologar QR/pareamento com número dedicado — fluxo assistido.
- `PUBLIC_API_URL` deve apontar para a origem HTTPS pública da API para
  "Configurar webhooks" registrar callbacks válidos.
