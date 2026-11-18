# Integração Infobip — SMS transacional

Módulo **Configurações → Integrações → Comunicação → Infobip** para SMS
de hóspede (avisos pós-reserva) via Infobip. Reutiliza o cofre de
credenciais, a fila persistente `fila_envio`, dedup/retry e a inbox de
eventos — mesma espinha do WhatsApp/Z-API, canal novo `sms`.

## Decisões de design

| Decisão | Escolha | Motivo |
| --- | --- | --- |
| Config | `integracao(provedor='infobip', ambiente='producao', categoria='comunicacao')` | Sem sandbox — não inventar |
| `api_key` | `integracao_segredo` AES-256-GCM | Credencial permanente |
| `webhook_secret` | gerado no backend na 1ª gravação (2 UUIDs), no cofre | Autentica o DLR no path — admin nunca digita |
| `base_url`/`remetente`/`limite_segmentos`/`eventos`/`envio_pausado`/`destinatarios_teste`/`callback_url` | `integracao.config` JSONB | Não-secretos, visíveis no GET |
| Auth DLR | segredo no path (`/webhooks/infobip/{segredo}`), CT-compare | Infobip não assina DLRs; path secret é o bearer |
| `base_url` | allowlist `*.infobip.com` + HTTPS, sem IP/localhost/credencial — validada no domain | Impede exfiltração da API key para host arbitrário |
| Cliente | `InfobipCliente` infra — `POST {base}/sms/3/messages`, `Authorization: App {key}`, timeout 15s, **redirects desligados** | Chave nunca cruza host |
| Teste de conexão | `GET {base}/sms/1/logs?limit=1` | Read-only — não gera cobrança |
| Emissor | `InfobipEmissor: Emissor` (`canal=sms`, `provedor='infobip'`) | Dispatcher por canal/provedor, igual Z-API |
| Seleção | `fila_envio.provedor`/`idintegracao` pinados no 1º envio; nulo → `integracao_padrao(escopo='sms')` | Retry nunca troca de conta |
| Segmentação | `value_objects::sms::estimar` — GSM-7 (160/153) × UCS-2 (70/67), extensão conta 2 | Custo por parte; recusa pré-envio acima do limite |
| Idempotência DLR | inbox `comunicacao_evento` por `messageId`+status; marcos monotônicos | DLR duplicado não retrocede estado |
| Falha ambígua | erro de infra pós-aceite → `desconhecido`, não retry cego | SMS cobra por envio — duplicata custa dinheiro |

## Setup do operador

1. Painel Infobip → **Settings → API keys** → criar key com escopo SMS
   → copiar também a **Base URL** da conta (`https://xxxxx.api.infobip.com`).
2. Integrações → Infobip: colar a **API key**, preencher **Base URL** e
   **Remetente** (alfanumérico ≤11 registrado na conta, ou long code
   provisionado) → *Salvar configuração*.
3. *Testar conexão* — chamada read-only; verde = credencial válida.
4. Copiar a **URL de DLR** exibida no card e cadastrar no painel
   (notification profile / delivery reports) — sem ela os status ficam
   em "aceito".
5. Marcar os **eventos com SMS** desejados e *SMS de teste* para um
   número real antes de habilitar.

## Custos e limites

SMS cobra **por parte**: 160 chars GSM-7 (acentos limitados — `ã/á/í/ó/õ`
e emoji rebaixam tudo pra UCS-2 de 70). `limite_segmentos` (padrão 3)
recusa a mensagem **antes** do envio — texto longo nunca vira cobrança
surpresa. `envio_pausado` congela o canal sem desabilitar a integração.

`destinatarios_teste` (opcional): quando preenchida, o SMS de teste
admin só sai para números da lista — impede envio acidental a hóspede.

## Endpoints

```
POST /api/v1/integracoes/infobip/producao/teste-msg  → {telefone,texto?} — allowlist, sem retry
POST /api/v1/webhooks/infobip/{segredo}              → DLR — valida path, dedup por messageId
```

Sweeper `spawn_infobip_eventos` (60s) reprocessa DLRs `pendente`/`falha`.

## Status

| Item | Estado |
| --- | --- |
| Canal `sms` / provedor / migration 0054 | Implementado |
| Adapter (envio, DLR, URL allowlist, sem redirects) | Implementado + unit tests (`infobip_url`, `sms`) |
| Resolver/fila/dedup/supressão/ambiguidade | Implementado — pin de conta no 1º envio |
| Webhook DLR + inbox + sweeper | Implementado |
| UI dedicada (config, toggles, teste, DLR URL) | Implementado |
| Homologação com conta real | **Pendente** — exige API key + remetente aprovado |
