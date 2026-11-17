# Integração Spedy — Fiscal (NFS-e)

Emissão de **NFS-e de hospedagem e serviços** vinculada às reservas, via
[Spedy](https://spedy.com.br) — configurada em **Configurações → Integrações →
Fiscal**, como um provedor do catálogo existente (`provedor = 'spedy'`,
`categoria = 'fiscal'`).

## Conceitos

| Conceito | Valor |
| --- | --- |
| Autenticação | Header `X-Api-Key` — **uma chave por empresa** |
| API produção | `https://api.spedy.com.br/v1` |
| API sandbox | `https://sandbox-api.spedy.com.br/v1` |
| Emissão | `POST /service-invoices` — **assíncrona** |
| Idempotência | `integrationId` (≤36 chars) gerado e persistido antes de transmitir |
| Webhook | Standard Webhooks — `webhook-id`/`webhook-timestamp`/`webhook-signature` (HMAC-SHA256 de `id.timestamp.body`, segredo `whsec_…`) |

**Emissão assíncrona**: um `POST` 2xx significa *aceito/enfileirado*, nunca
*autorizada*. O documento fica `processando` até o webhook ou a consulta
(`GET /service-invoices/{id}`) trazer a decisão da prefeitura. **Não existe**
segunda chamada de emissão — criar a nota já a enfileira.

**Ambiente da API ≠ ambiente do modelo fiscal.** O host pode ser sandbox e o
modelo fiscal estar configurado como produção na empresa remota — nesse caso a
nota emitida é **real**. A tela alerta sempre que `fiscal_ambiente = 'producao'`
e a combinação sandbox+produção é bloqueada no backend.

## Configuração (admin → Integrações → Spedy)

1. **Credenciais** — `api_key` (obrigatória) e `webhook_secret` (`whsec_…`,
   necessário para receber eventos). Cifradas no vault (`INTEGRACOES_MASTER_KEY`),
   write-only: a API nunca devolve valores.
2. **Testar conexão** — `GET` na empresa remota (leitura, nunca emite).
3. **Empresa** — *Consultar empresa na Spedy* vincula `empresa_id`, CNPJ e razão
   social à `config` da integração. CNPJ divergente do estabelecimento é
   sinalizado — eventos de outros CNPJs são ignorados no webhook.
4. **Município de emissão** — consulta por código IBGE os provedores aceitos
   pela prefeitura; *Usar este município* grava `municipio_codigo` na `config`.
5. **Parametrização fiscal** — códigos de serviço (federal LC 116, municipal,
   CNAE, NBS, tributação, alíquota ISS, descrição) aprovados pelo contador;
   enviados em toda emissão.
6. **Webhook** — *Registrar webhook na Spedy* aponta a URL pública
   (`POST /api/v1/webhooks/spedy/{ambiente}`) para a empresa remota.
7. **Habilitar** — desabilitar bloqueia **novas** emissões; documentos já
   transmitidos seguem reconciliáveis.

## Fluxo de emissão (detalhe da reserva → Notas fiscais)

```
Emitir NFS-e → preparar (rascunho + pendências) → revisar prévia
  → Confirmar e transmitir → 'enfileirada' (intenção durável)
  → worker (SKIP LOCKED, multi-réplica seguro) → POST /service-invoices
  → 'processando' → webhook/consulta → 'autorizada' | 'rejeitada'
```

- `integration_id` único por `(idintegracao, integration_id)` — duplo clique,
  dois workers ou timeout após aceite remoto **nunca** duplicam a nota.
- Pendências fiscais (tomador sem documento, município/parametrização ausentes)
  bloqueiam a transmissão na prévia.
- `rejeitada`/`falha`/`rascunho` aceitam **retransmitir** (mesmo
  `integration_id` — o provedor deduplica).
- **Cancelar** (só em `autorizada`) solicita `cancelRequested` à prefeitura —
  pode ser recusado. **Não altera** reserva nem pagamento.
- PDF/XML baixam via `GET /fiscal/documentos/{id}/arquivo/{pdf|xml}` — rota
  autenticada, sem redirect para URL arbitrária; XML original preservado em
  `payload`/armazenamento.

### Estados locais (`status`) × `status_remoto`

`rascunho → enfileirada → processando → autorizada | rejeitada →
cancelamento_solicitado → cancelada`, mais `falha` (erro técnico, elegível a
retry com backoff em `proxima_tentativa`). `status_remoto` guarda o valor cru
do provedor — desconhecidos nunca viram `autorizada`.

## API (admin, RBAC por nível)

| Método | Rota | Uso |
| --- | --- | --- |
| POST | `/integracoes/spedy/{amb}/empresa` | Consulta/vincula empresa |
| GET | `/integracoes/spedy/{amb}/municipio/{ibge}` | Provedores do município |
| GET | `/integracoes/spedy/{amb}/settings` | Settings remotos |
| POST | `/integracoes/spedy/{amb}/webhook` | Registra webhook |
| POST | `/fiscal/nfse/{amb}/reserva/{id}/preparar` | Prévia (rascunho) |
| GET | `/fiscal/documentos` | Lista (filtros: reserva, status, datas, ambiente) |
| GET | `/fiscal/reserva/{id}` | Documentos da reserva |
| GET | `/fiscal/documentos/{id}` | Detalhe |
| POST | `/fiscal/documentos/{id}/confirmar` | Enfileira (204) |
| POST | `/fiscal/documentos/{id}/sincronizar` | Consulta ao vivo |
| POST | `/fiscal/documentos/{id}/reconciliar` | Reconsulta documento terminal |
| POST | `/fiscal/documentos/{id}/reprocessar` | Retransmite corrigido |
| POST | `/fiscal/documentos/{id}/cancelar` | `{ "motivo": "…" }` |
| GET | `/fiscal/documentos/{id}/arquivo/{pdf\|xml}` | Download protegido |

Pública: `POST /api/v1/webhooks/spedy/{ambiente}` — **persiste o evento antes
de processar**, verifica assinatura (`webhook-signature`, tolerância de
timestamp), deduplica por `(idintegracao, event_id)` e ignora payloads de
outro CNPJ. Sem segredo configurado → 401.

## Banco (`0045_integracao_spedy.sql`)

- `integracao`: `spedy` no check de provedor; `fiscal` no de categoria.
- `fiscal_documento`: intenção durável (outbox) — `integration_id` único,
  `status`/`status_remoto`, tomador/payload/valor, tentativas e
  `proxima_tentativa` (fila), número/url da nota, timestamps do ciclo.
- `fiscal_evento`: inbox de webhooks — dedup `(idintegracao, event_id)`,
  `assinatura_ok`, status de processamento.

## Variáveis de ambiente

| Variável | Uso |
| --- | --- |
| `INTEGRACOES_MASTER_KEY` | Abre o vault de credenciais (obrigatória) |
| `PUBLIC_API_URL` | Base pública montada na URL do webhook registrado |

Nenhum segredo em código/logs — `X-Api-Key` e `whsec_…` vivem só no vault.

## Validação pendente (sem credenciais reais)

Coberto em teste: idempotência por `integration_id`, dedup/expiração de
assinatura (unit tests em `spedy.rs`), mapeamento de status
(`entities/fiscal.rs`), fila `SKIP LOCKED` (repo). **Pendente com chave
sandbox:** teste de conexão real, consulta de município, emissão de NFS-e de
teste (modelo `teste` — nunca emitir nota real sem autorização), ciclo
webhook de ponta a ponta e cancelamento aceito/recusado.
