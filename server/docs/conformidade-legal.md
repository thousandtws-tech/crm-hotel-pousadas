# Conformidade legal — lei → implementação

Base normativa: [ctresb/leis](https://github.com/ctresb/leis) (textos oficiais em Markdown).
Este documento é também o **registro das operações de tratamento** exigido pelo art. 37 da LGPD:
cada operação lista base legal, dados envolvidos e onde o código a implementa.

## LGPD — Lei 13.709/2018

| Artigo | Exigência | Implementação |
| --- | --- | --- |
| art. 7º (bases) | Finalidade por contexto | Transacional (FNRH/cobrança) = execução de contrato; marketing = consentimento (`cliente.consent_marketing`); FNRH/fiscal = obrigação legal. `services/lgpd.rs` |
| art. 9º | Informação ao titular | Aceite da política de privacidade + cancelamento com data e IP (`reserva.termos_aceitos_em/ip`) |
| arts. 15–16 | Eliminação + conservação legal | `anonimizar_cliente` apaga PII mantendo trilha fiscal/FNRH (obrigação legal); cron diário `anonimizar_vencidos(retencao_dados_anos)` — `workers/rotinas.rs` 4h UTC |
| art. 18 | Direitos do titular | `lgpd_solicitacao` (acesso, retificação, eliminação, portabilidade, revogação); export JSON completo `GET /lgpd/solicitacoes` e `GET /clientes/{id}/lgpd-export` |
| art. 19 | Prazo de resposta (15 dias) | `solicitacoes_vencidas` + alerta diário `alertar_solicitacoes_vencidas` — `workers/rotinas.rs` 5h UTC |
| art. 37 | Registro das operações | Este documento + trilha `log` transacional por mutação |
| art. 41 | Encarregado (DPO) | `estabelecimento.dpo_email` |
| art. 46 | Medidas de segurança | Argon2id, JWT c/ rotação de refresh (hash SHA-256), rate limit, security headers, trilha `login_falha`, RBAC (`Ator`) |
| art. 48 | Incidente de segurança | `lgpd_incidente` + `POST/GET /lgpd/incidentes` + `POST /lgpd/incidentes/{id}/comunicar` (marca ANPD/titulares) |
| opt-out | Canais de comunicação | `lgpd_opt_out` por canal + palavras do bot ("sair", "parar") + link HMAC `/publico/lgpd/descadastrar`; `TEMPLATES_SUPRIMIVEIS` |

## Marco Civil da Internet — Lei 12.965/2014 + Decreto 8.771/2016

| Artigo | Exigência | Implementação |
| --- | --- | --- |
| art. 15 | Registros de acesso a aplicações ≥ 6 meses | `logacesso` (funcionário, IP, user-agent, timestamp) + `sessao_refresh` |
| Dec. art. 13 §2º | Excluir encerrado o prazo legal | `purgar_registros_acesso` — cron diário `workers/rotinas.rs` 5h UTC: `logacesso` > 6 meses e sessões mortas > 6 meses são removidos |
| Dec. art. 13, I/II | Controle de acesso aos registros | Leitura da trilha restrita a admin (`exigir_admin`); autenticação JWT + Argon2id |
| Dec. art. 13, III | Inventário dos acessos aos registros | Consulta à auditoria grava `auditoria:consulta`; export do titular grava `lgpd:exportacao`; comunicações de incidente gravam `lgpd:incidente_comunicacao` |
| Dec. art. 13, IV | Inviolabilidade dos registros | Trilha `log` append-only por contrato (só INSERT/listar — nenhuma rota de edição/remoção) |
| art. 16 | Veda guarda de registros de outras aplicações | Sistema não coleta navegação externa do usuário |

## ECA — Lei 8.069/1990

| Artigo | Exigência | Implementação |
| --- | --- | --- |
| art. 82 | Menor só hospeda c/ pais ou autorização | Check-in **bloqueado** para menor desacompanhado sem `reserva.autorizacao_menor` — `ReservaService::checkin`; registro via `POST /reservas/{id}/autorizacao-menor` |

## CDC — Lei 8.078/1990

| Artigo | Exigência | Implementação |
| --- | --- | --- |
| arts. 30/35/46 | Oferta divulgada e vinculante | `estabelecimento.politica_cancelamento` (faixas escalonadas) divulgada antes do pagamento; aceite com data + IP |

## Lei Geral do Turismo — Lei 11.771/2008 + FNRH (Dec. 1.394/1977)

| Exigência | Implementação |
| --- | --- |
| Cadastur | `estabelecimento.cadastur` |
| Ficha de registro de hóspedes | `fnrh` com snapshot JSON imutável (cliente + reserva + acompanhantes) + assinatura digital; campos FNRH em `cliente` (nacionalidade, naturalidade, profissão, endereço completo) e `acompanhante` |
| art. 23 §4º — diária = 24h | `entradaprevista`/`saidaprevista` + configurações de check-in/check-out; `early_checkin`/`late_checkout` contratáveis |
| art. 26 — dados ao MTur | Relatórios de ocupação (`relatorios`) respeitando privacidade do hóspede |

## Código Civil — Lei 10.406/2002

| Artigo | Exigência | Implementação |
| --- | --- | --- |
| arts. 649–651 | Responsabilidade por bagagens | Conta de consumo + observações operacionais; seguro/documentação é processo da pousada |
| art. 1.468 | Penhor por dívida de hospedagem | Saldo devedor rastreado na conta (`consumo`) até quitação |

## Prazos legais em código

| Registro | Piso | Ação automática |
| --- | --- | --- |
| `logacesso` | 6 meses (Marco Civil art. 15) | Purga diária > 6 meses |
| `sessao_refresh` (morta) | 6 meses | Purga diária > 6 meses |
| Dados do titular | `retencao_dados_anos` (default 5a — trilha fiscal) | Anonimização diária |
| Resposta ao titular | 15 dias (LGPD art. 19) | Alerta diário de vencidas |
