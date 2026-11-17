# Integração Didit — verificação de identidade (KYC) de funcionários

A Didit verifica a identidade dos **operadores do painel admin** (KYC completo:
documento + biometria facial + AML, conforme o workflow configurado). Quando o
portão está ligado (`exigir_verificacao`), funcionários não verificados ficam
bloqueados em uma tela obrigatória até aprovarem a verificação.

## Arquitetura

```
Funcionário bloqueado
  → POST /verificacao/minha/sessao   (cria/recupera sessão Didit, link hospedado)
  → abre o link, faz o KYC na Didit
  → Didit chama POST /webhooks/didit/{ambiente}   (assinatura obrigatória)
  → status 'aprovada' gravado → próximo request libera
```

- **Portão no backend**: o extractor `Ator` valida JWT **e** consulta
  `VerificacaoService::acesso_permitido` — bloqueado recebe `403
  VERIFICACAO_PENDENTE` em toda rota protegida. Não é só guard de tela.
- **`AtorBasico`** (só JWT): rotas que o bloqueado precisa continuar usando —
  `GET /verificacao/minha` e `POST /verificacao/minha/sessao`.
- **Bypass de emergência**: `nivel == 1` (admin) nunca é bloqueado — garante
  que sempre exista alguém capaz de entrar e desligar o portão.
- **Fail-open**: se o banco falhar na checagem, o request passa com log de
  degrade — infra indisponível não pode derrubar o painel inteiro.
- O portão olha apenas a integração de **produção**; sandbox nunca bloqueia.

## Webhook

`POST /api/v1/webhooks/didit/{producao|teste}`

- `X-Signature` (HMAC-SHA256 do corpo cru) + `X-Timestamp` ±5 min, ambos
  obrigatórios; sem segredo configurado → `401` antes de qualquer parse.
- Evento **persistido antes de processar** (`verificacao_evento`), dedup por
  `event_id`; entrega fora de ordem não regride status terminal.
- `status.remoto` desconhecido é preservado cru — nunca vira `aprovada`.

## Configuração (Integrações → Segurança → Didit)

Credenciais (write-only, cifradas no vault):

| Campo | Origem |
|---|---|
| `api_key` | Console Didit → API Keys (`sk_test_…` sandbox / `sk_live_…` live) |
| `webhook_secret` | `secret_shared_key` retornado ao registrar o destino — preenchido sozinho pelo botão **Registrar webhook**, ou colado manualmente |

Config (não-secreta):

| Campo | Efeito |
|---|---|
| `workflow_id` | Workflow KYC do console Didit — **obrigatório** para criar sessões |
| `callback_url` | Opcional — URL de retorno pós-verificação |
| `exigir_verificacao` | **Portão de login** — só pode ligar com `workflow_id` preenchido |

## Rollout seguro

1. Salve `api_key` de **teste** em Teste → **Testar conexão** → **Registrar webhook**.
2. Preencha `workflow_id` (sandbox). Gere um link pela página Funcionários
   (ícone de link na coluna **Identidade**) e complete um KYC de teste.
3. Repita em **Produção** com `sk_live_…` + workflow live.
4. Verifique cada funcionário **antes** de ligar o portão: quem não estiver
   `Verificado` será bloqueado no próximo request.
5. Só então ligue **Exigir verificação no login** em Produção.

Desligar o portão em emergência: qualquer admin entra (bypass) e desmarca
`exigir_verificacao` — efeito imediato.

## Status possíveis

`nao_iniciada → pendente/em_andamento → aprovada | recusada | em_revisao |
expirada | abandonada | kyc_expirada`. Terminal: aprovada/recusada/expirada/
abandonada/kyc_expirada — nunca regride por webhook tardio.

## Custos

KYC completo ≈ US$ 0,33/verificação (lista Didit). Sessões reutilizam a viva —
não geram cobrança nova.
