# Pagamentos Online — Stripe

Integração de pagamentos do site `espiritodomar.com.br` ao CRM, via
**Stripe Checkout hospedado** (cartão e Pix). Nenhum dado de cartão
transita pelos nossos servidores — o hóspede paga na página do Stripe.

## Arquitetura

```
site ── POST /publico/reservas ──────────► reserva 'p' + expira_em (30min) + token público
     ── POST /publico/pagamentos/checkout ► Stripe Checkout Session ─► hóspede redirecionado
Stripe ── POST /api/v1/webhooks/stripe ───► inbox idempotente ─► pagamento 'pago' ─► recepção (SSE)
sweeper (5min) ── conciliar() ──► expira holds · reprocessa eventos · consulta PIs pendentes
```

- **Valores sempre no servidor** — o site envia apenas `token` + `tipo`
  (`integral` | `sinal` | `saldo`); o serviço recalcula o valor.
- **Página de sucesso não confirma** — ela consulta
  `GET /publico/pagamentos/status?token=` que reflete apenas o estado
  persistido pelo webhook.
- **Idempotência** — `pagamento_webhook_evento.event_id UNIQUE`;
  duplicados respondem 200 sem reprocessar. `confirmar_pago` usa
  `WHERE status != 'pago'` — evento fora de ordem não regride.
- **Conciliação** — a cada 5 min: holds expirados liberam a acomodação,
  eventos `falhou` são reprocessados, pagamentos `pendente` com PI são
  consultados direto na API Stripe.
- **Permissão** — reembolso exige `financeiro` no JWT (admin implícito);
  consulta do painel exige nível gerencial.

## Variáveis de ambiente

| Variável | Obrigatória | Default | Descrição |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | para ativar | — | `sk_test_…`/`sk_live_…`. Ausente = API sobe sem checkout |
| `STRIPE_WEBHOOK_SECRET` | para webhook | — | `whsec_…` do endpoint criado no Dashboard |
| `STRIPE_SUCCESS_URL` | não | `…/reserva/pagamento/sucesso` | retorno pós-pagamento |
| `STRIPE_CANCEL_URL` | não | `…/reserva/pagamento/cancelado` | retorno se o hóspede desiste |
| `SINAL_PERCENTUAL` | não | `30` | percentual do sinal (clamp 0–100) |
| `HOLD_MINUTOS` | não | `30` | duração da reserva provisória (30–1440) |

Segredos apenas no serviço `api-server-rust` (Railway → Variables).
**Nunca** no código, no git ou em logs.

## Configuração no Stripe Dashboard

1. **Modo teste**: Developers → API keys → copiar `sk_test_…` → `STRIPE_SECRET_KEY`
2. **Métodos**: Settings → Payment methods → habilitar `card` + `pix`
   (Pix exige conta BR habilitada — confirmada pelo usuário)
3. **Webhook**: Developers → Webhooks → Add endpoint:
   - URL: `https://<domínio-api>/api/v1/webhooks/stripe`
   - Eventos: `checkout.session.completed`, `checkout.session.expired`,
     `payment_intent.payment_failed`, `charge.refunded`
4. Copiar `Signing secret` → `STRIPE_WEBHOOK_SECRET`
5. Testar local: `stripe listen --forward-to localhost:8080/api/v1/webhooks/stripe`
   + `stripe trigger checkout.session.completed`

## Tabelas (migration `0023_pagamentos.sql`)

| Tabela | Papel |
|---|---|
| `pagamento` | pagamento por reserva (valor em centavos, tipo, status, PI id) |
| `pagamento_tentativa` | sessões de checkout (1:N) — cada retentativa nova sessão |
| `pagamento_reembolso` | reembolsos integrais/parciais |
| `pagamento_webhook_evento` | inbox idempotente + retry |
| `pagamento_auditoria` | trilha imutável (ator, ação, payload) |
| `reserva.expira_em` / `reserva.token_publico` | hold 30min + id opaco anti-enumeração |
| `funcionario.financeiro` | permissão granular de reembolso |

## Endpoints

| Método/Rota | Acesso | Descrição |
|---|---|---|
| `POST /publico/pagamentos/checkout` | público (token) | cria sessão Stripe |
| `GET /publico/pagamentos/status` | público (token) | status da reserva/pagamentos |
| `POST /api/v1/webhooks/stripe` | assinatura Stripe | inbox + processamento |
| `GET /pagamentos` | auth | listagem filtrada/paginada |
| `GET /reservas/{id}/pagamentos` | auth | histórico da reserva |
| `GET /financeiro/pagamentos/resumo` | gerencial | indicadores do período |
| `GET /financeiro/pagamentos/receita-acomodacoes` | gerencial | receita por quarto |
| `POST /pagamentos/{id}/reembolsos` | `financeiro` | reembolso integral/parcial |

## Métricas (Prometheus)

`clarituz_pagamentos_checkout_criado_total`,
`_confirmados_total`, `_recusados_total`, `_reembolsos_total`,
`_webhook_recebidos_total`, `_webhook_duplicados_total`,
`_webhook_processados_total`, `_webhook_falhas_total`.

Alerta sugerido: `rate(clarituz_pagamentos_webhook_falhas_total[15m]) > 0`
sustentado → verificar secret/conectividade.

## Deploy & rollback

- **Migration é aditiva** — nenhuma tabela/dado existente alterado;
  `reserva` ganha colunas `NULL` (reservas atuais seguem válidas).
- Deploy normal via Jenkins (changeset `server/**` → build → `railway up`).
- Rollback: redeploy da imagem anterior. As tabelas novas podem ficar
  (não quebram versões antigas) — para remover, migration manual.
- **Não ativar `sk_live_` sem autorização expressa da pousada.**

## LGPD / segurança

- Nenhum PAN/CVV armazenado — Checkout hospedado no Stripe.
- `pagamento` retém apenas: valor, moeda, status, método, ids Stripe.
- Payload do webhook (`jsonb`) pode conter nome/e-mail do pagador —
  retenção alinhada à política de auditoria (recomendado: 90 dias pós-
  processamento, via limpeza agendada se exigido).
- Token público UUID impede enumeração de reservas.
- Rate limit nas rotas públicas de checkout (mesmo middleware do login).
- Trilha `pagamento_auditoria` registra quem reembolsou, quando, motivo.

## Homologação (checklist)

- [ ] Checkout integral cartão teste `4242 4242 4242 4242` → webhook → pago
- [ ] Sinal 30% → saldo posterior
- [ ] Pix teste → estado `pendente` → confirmação assíncrona
- [ ] Expiração de sessão → hold liberado
- [ ] Webhook duplicado → 200, sem efeito
- [ ] Reembolso parcial + integral + rejeitado sem permissão
- [ ] Métricas visíveis no Grafana
