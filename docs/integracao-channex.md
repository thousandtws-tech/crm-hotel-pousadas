# Integração Channex — Channel Manager

PMS → Channex → OTAs (Booking.com, Airbnb, Expedia…). O CRM publica
disponibilidade/tarifas/restrições (ARI) e recebe reservas, modificações
e cancelamentos por **feed de revisões** (fonte primária) + **webhook**
(sinal antecipado assinado por HMAC).

## Configuração

1. Integrações → Distribuição → **Channex** → ambiente (teste usa
   `staging.channex.io`; produção, `app.channex.io` — o host segue a
   *user-api-key* da conta, sem config extra).
2. **API key**: Channex → Settings → API access. Salvar credenciais →
   *Testar conexão*.
3. **Vincular propriedade**: *Listar propriedades da conta* → *Vincular*.
4. **Registrar webhook assinado**: cria o webhook + signing key na
   Channex e guarda o segredo no vault (visível uma única vez).
5. **Mapear** cada acomodação → Room Type + Rate Plan.
6. *Integração habilitada* → *Sincronizar 90 dias* para a primeira carga.

## Semântica de inventário

Migration `0048`: `reserva.periodo` passa a `[entrada, saida)` — o dia
do checkout **não** é noite ocupada (alinhado às OTAs; giro/limpeza
continua sendo bloqueio explícito). Disponibilidade publicada = 1 quando
não há reserva `pendente`/`iniciada` nem bloqueio cobrindo a noite.

## Fluxos

**Outbound (ARI)** — mutações locais (reserva criada/cancelada, bloqueio)
enfileiram `distribuicao_outbox` no mesmo commit. O worker (10s)
coalesce por acomodação e envia o estado **recalculado** — um job velho
nunca sobrescreve um mais novo. `POST /availability` e
`POST /restrictions` são assíncronos: 200 devolve `task_ids`, que ficam
em `distribuicao_envio` junto de `meta.warnings` (aceite parcial vira
pendência). Limites Channex: 10 req/min por propriedade por endpoint —
falhas de rate-limit/timeout voltam à outbox com contador (teto 10 →
pendência).

**Inbound (reservas)** — worker (30s) puxa `GET /booking_revisions/feed`;
o webhook é só o sinal (sempre relê a revisão via API). Ordem: gravar
payload → dedup por `revision_id` → checar staleness (`inserted_at`)
→ aplicar → **só então** `POST …/ack`. PII do hóspede é persistida antes
do ack porque a Channex a remove depois. `new`/`modified`/`cancelled`
criam ou cancelam reservas locais via `reserva.criar/cancelar`
transacionais — a constraint de overlap garante exatidão do inventário;
`modified` cancela os vínculos e reimporta.

**Conflitos** — reserva OTA sem mapeamento ou competindo com reserva
local nunca é descartada: vira `distribuicao_pendencia` (operador decide:
mapear, realocar ou acionar a OTA) e o botão *Reprocessar* reaplica a
revisão gravada. Cancelamento de reserva em estadia vira pendência —
a OTA nunca desfaz um check-in.

**Pausa/retomada** — *Pausar publicação* congela os envios (recebimento
segue). Retomar exige *Reconciliar*: republica a janela de 370 dias e
puxa o feed — perdas de outbox durante a pausa são refeitas.

## Segurança

- `user-api-key` e signing secret no vault cifrado (AAD `channex|amb|campo|id`).
- Webhook público valida `x-hmac-timestamp` (±5 min) + `x-hmac-signature-256`
  (hex, CSV para rotação) sobre `{ts}.{corpo cru}` **antes** de parsear.
- Rotas `/distribuicao/*`: gerencial+ (vínculo/webhook: admin).
- Dados de cartão da revisão não são persistidos além do payload bruto
  de auditoria — PCI da Channex mantém cartões fora do escopo do PMS.

## Operação

- Tela: `/integracoes/channex/{ambiente}` — credenciais, propriedade,
  mapeamento, sincronização, revisões (reprocessar), pendências (resolver).
- Falha após commit local com ack perdido → o próximo poll reenvia o ack
  (dedup-hit com `ack=false`).
- Channex reenvia revisão não-ack por ~30 min e alerta por e-mail — o
  alarme certo para pendências de mapeamento/conflito.
- Logs: `channex: outbox drenada`, `channex: revisões importadas`,
  `channex: ack falhou`, `channex: feed falhou`.
