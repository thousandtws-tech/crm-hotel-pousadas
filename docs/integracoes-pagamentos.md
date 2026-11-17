# Integrações de pagamento — arquitetura e operação

Módulo **Configurações → Integrações** (`/configuracoes/integracoes`) para
credenciais, habilitação, teste de conexão, saúde de webhooks e provedor
padrão de cobranças do site. Provedores: **Stripe**, **PagBank**,
**Mercado Pago** — checkout hospedado em todos (PAN/CVV nunca passa pela API).

## Decisões de design (plano)

| Decisão | Escolha | Motivo |
| --- | --- | --- |
| Produto PagBank | **Checkout PagBank** (`POST /checkouts`, `GET /checkouts/{id}`, `activate`/`deactivate`) | Único produto hospedado oficial; redirect pela link `PAY` |
| Produto Mercado Pago | **Checkout Pro via Preferences** (`POST /checkout/preferences`, `GET /v1/payments/{id}`) | Hosted checkout documentado; `external_reference` carrega nossa correlação |
| Produto Stripe | **Checkout Sessions** (existente, preservado) | Legado em produção — compatível retroativamente |
| Auth PagBank | Bearer token | Oficial |
| Auth MP | Bearer access token | Oficial |
| Webhook Stripe | `Stripe-Signature` HMAC sobre corpo bruto (existente) | Oficial |
| Webhook PagBank | `x-authenticity-token` (quando configurado) **+ fetch-back** `GET /orders/{id}` | Fetch-back é o modelo de autenticidade documentado — estado só vem da API, nunca do payload |
| Webhook MP | `x-signature` HMAC-SHA256 sobre `id:{data.id};request-id:{x-request-id};ts:{ts};` com tolerância **+ fetch-back** `GET /v1/payments/{id}` | Mecanismo oficial assinado; consulta confirma estado |
| Segredos | AES-256-GCM por campo (`integracao_segredo`), chave-mestra `INTEGRACOES_MASTER_KEY` (env, 32B hex), AAD = `provedor\|ambiente\|campo\|idintegracao` | Envelope versionado, troca de chave sem rewrite |
| Resolução runtime | `GatewayResolver` lê `integracao` a cada chamada e reconstrói adapter só quando `versao` muda (cache em memória) | Propagação imediata e coerente entre réplicas — versão no banco é a fonte de verdade, sem dependência de NOTIFY |
| Fallback env | `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` valem **enquanto não existir linha** `integracao(stripe,producao)` | Preserva produção atual; desativação explícita cria linha `habilitado=false` e bloqueia o env (não há fallback silencioso) |

## Modelo de dados (migration 0043)

- `integracao(provedor, ambiente)` UNIQUE — status `ativa|pendente|falha|desativada`,
  `habilitado`, `capabilities` JSONB, `webhook_url`, `ultima_verificacao_*`,
  `versao` (optimistic lock + invalidação de verificação).
- `integracao_segredo` — `valor_enc BYTEA` (nonce ‖ AES-GCM ct‖tag) por campo
  (`secret_key`, `access_token`, `webhook_secret`, `public_key`…).
- `integracao_padrao(escopo)` — escopo `pagamentos_site`.
- `pagamento` + `provedor`, `ambiente` (NULL = legado não determinável),
  `idintegracao` — identidade imutável do provedor no lançamento.
- `pagamento_webhook_evento` + `provedor`, `idintegracao` — unique vira
  `(provedor, event_id)`; legado migrado como `provedor='stripe'`.

## Precedência do estado efetivo

1. Linha `integracao` existe + `habilitado` → config persistida governa.
2. Linha existe + `!habilitado` → **desativada** (env não resgata).
3. Sem linha → `stripe/producao` pode estar `gerenciado_pelo_ambiente`
   (env); demais pares ficam `desativada`.

`rotulada` (pendente) = segredos salvos, verificação ainda não `ok`.
`verificacao_status` é invalidado a cada mudança de `versao` — teste antigo
não valida credencial nova.

## Endpoints admin (exigem `admin`)

```
GET   /api/v1/integracoes
GET   /api/v1/integracoes/{provedor}/{ambiente}
PUT   /api/v1/integracoes/{provedor}/{ambiente}        {versao, segredos?, habilitado?}
PATCH /api/v1/integracoes/{provedor}/{ambiente}/habilitacao {habilitado}
POST  /api/v1/integracoes/{provedor}/{ambiente}/testar
PUT   /api/v1/integracoes/{provedor}/{ambiente}/padrao
GET   /api/v1/integracoes/{provedor}/{ambiente}/eventos
```

Segredos nunca saem em GET/erros/logs — o PUT recebe
`segredos: {campo: "valor"}` (campo ausente = mantém, `""` = remove) e a
view devolve apenas `segredos.campos: {campo: true}` (configurado).
`versao` divergente no PUT → **409** (dois admins editando).

## Teste de conexão por provedor

- **Stripe**: `GET /v1/account` → identificação `acct_…` (leitura autenticada).
- **Mercado Pago**: `GET /users/me` → `id` da conta.
- **PagBank**: `GET /checkouts/{id-inexistente}` — `404` prova autenticação no
  produto Checkout; `401/403` = credencial inválida/sem permissão. Não cria
  objeto nem efeito financeiro.

## Webhooks

- `POST /api/v1/webhooks/pagbank` — fetch-back: extrai referência do payload
  e confirma estado via API; opcionalmente valida `x-authenticity-token`.
- `POST /api/v1/webhooks/mercadopago` — `x-signature` + `data.id` →
  `GET /v1/payments/{id}` autoritativo.
- Multi-ambiente: o receptor tenta validar o evento contra cada integração
  habilitada do provedor; a que autentica é a que processa.
- Confirmação só por evidência do provedor — `checkout.session.completed`
  verifica `payment_status='paid'`; Pix/boleto ficam `pendente` até evento
  de liquidação.

## Rotação e remoção

- Novo segredo → `versao_chave+1` + AAD novo; verificação invalidada.
- `webhook_secret_anterior` (campo adicional) aceito por janela de migração
  para não quebrar eventos assinados com o segredo antigo.
- Reembolso/conciliação sempre resolvem pelo `provedor`/`idintegracao`
  gravados no pagamento — troca de padrão não afeta histórico.

## Status de implementação

Backend completo: migration `0043`, `integracao`/`integracao_segredo`/
`integracao_padrao`, `AesCredentialVault` (AES-256-GCM + AAD por contexto),
adapters `StripeGateway`/`PagBankGateway`/`MercadoPagoGateway`,
`PgGatewayResolver` (runtime, cache por versão), `IntegracoesService`
(admin), rotas `/integracoes/*` e webhooks `/webhooks/{pagbank,mercadopago}`.
`PagamentosOnlineService` resolve dinamicamente: nova cobrança = provedor
padrão; reembolso/conciliação = provedor gravado no pagamento.

Testes: unitários nos adapters (assinaturas Stripe/MP, authenticity
PagBank, mapa de status), vault (roundtrip/AAD/Envelope corrompido) e
E2E `tests/integracoes.rs` + `tests/pagamentos_online.rs` (PG real).

## Homologação sandbox (pendências externas)

- [ ] Token PagBank sandbox (developer.pagbank.com.br) — criar checkout,
      receber notificação, consultar ordem.
- [ ] Checkout PagBank **em produção exige allowlist** — solicitar liberação
      ao PagBank antes de habilitar produção.
- [ ] Access token MP de teste + secret de webhook (painel Mercado Pago
      Developers → Webhooks).
- [ ] `INTEGRACOES_MASTER_KEY` (64 hex) provisionada nos ambientes.
