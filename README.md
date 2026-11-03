# CRM Hotel — Pousada Espírito do Mar

Sistema de gestão de uma pousada real em Cabo Frio (Peró, RJ), construído para a
rotina de quem trabalha na recepção: reservas, check-in/check-out, hóspedes e
FNRH, estoque, frigobar, vagas de estacionamento, financeiro e impressoras por
setor. Junto vem o site público da pousada (com reserva online e conteúdo
editável) e a **MAR IA**, uma assistente de voz em português que conversa com o
sistema inteiro — responde perguntas, executa ações com confirmação e abre telas
por comando de voz.

Tudo roda na nuvem (Railway) e foi pensado para gente que não é técnica: a
recepção opera o dia inteiro sem tocar em nada complicado.

## As peças do sistema

| Parte | Stack | Pasta |
|---|---|---|
| API | Rust · Axum · SQLx · PostgreSQL | `server/` |
| Hub realtime (WebSocket) | Elixir · Phoenix Channels | `server/realtime/` |
| Painel interno (recepção/admin) | Angular | `client/admin/` |
| Site público | Angular | `client/web/` |
| MAR IA (voz + texto) | Python · FastAPI · OpenAI · ElevenLabs | `server/maria/` |
| Mídia (fotos, docs, logo) | MinIO / S3 | Railway |
| Banco | PostgreSQL | Railway |

## Em produção

- Painel: `https://admin-production-2c55.up.railway.app`
- Site: `https://web-production-5b3105.up.railway.app`
- API: `https://api-production-19dc.up.railway.app`
- MAR IA: `https://maria-production-b5c4.up.railway.app`

## Rodando local

```bash
# API
cd server && cargo run        # precisa de DATABASE_URL no ambiente

# Hub realtime (porta 4000) — precisa do Postgres do docker-compose
cd server/realtime && mix deps.get && mix phx.server

# Painel (porta 4200)
cd client/admin && npm i && ng serve

# Site (porta 4300)
cd client/web && npm i && ng serve

# MAR IA (porta 8090)
cd server/maria && pip install -r requirements.txt
uvicorn app.main:app --port 8090
```

As variáveis de ambiente ficam em `.env` (ignorado pelo git — nunca commitar).
Cada serviço tem um `.env.example` com o que precisa.

## Deploy

Cada serviço tem seu próprio `Dockerfile` e sobe por `railway up` a partir da
pasta dele. Deploys são por serviço — não precisa subir tudo quando só mexeu no
site, por exemplo.

## Documentação

- `Manual/manual_sistema.html` — manual completo da equipe, em pt-BR
  (versão em PDF em `Manual/manual_sistema.pdf`)
- `Manual/checklist_sistema.html` — resumo executivo: o que já funciona e o que
  ainda está no caminho

## Organização do trabalho

O fluxo ágil fica nas [issues](../../issues) e [milestones](../../milestones) do
próprio repo — cards de pendências e entregas com prioridade, área e sprint.
