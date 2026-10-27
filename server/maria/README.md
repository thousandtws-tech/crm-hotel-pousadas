# MAR IA — Assistente de voz da Pousada Espírito do Mar

Serviço Python (FastAPI) que conecta o admin Angular a:
- **OpenAI Realtime API** — transcrição de voz em tempo real
- **OpenAI Responses API** — raciocínio + function calling
- **ElevenLabs** — síntese de voz em streaming (pt-BR, baixa latência)
- **API do sistema** (Rust/Axum) — dados e ações reais com o JWT do usuário

## Pipeline

```
mic PCM16 → WebSocket → STT (Realtime) → Responses API (+ tools)
          → texto stream → ElevenLabs WS → PCM 24 kHz → frontend
```

## Rodando

```bash
cd server/maria
python -m venv .venv && .venv\Scripts\activate   # ou: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # preencha as chaves
uvicorn app.main:app --host 0.0.0.0 --port 8090
```

## Autenticação

O frontend conecta com `?token=<jwt do sistema>`. O serviço valida com o
mesmo `JWT_SECRET` do backend — permissões por nível continuam valendo,
pois as ferramentas chamam a API real com o Bearer do usuário.

## Ações de escrita

`preparar_reserva` / `preparar_cancelamento` devolvem resumo; a execução
só ocorre com `confirmar_acao` (botão na UI ou confirmação por voz).

## Métricas

`GET /metrics` — p50/p95 por estágio (STT, 1º token LLM, tool, 1º áudio, total).
