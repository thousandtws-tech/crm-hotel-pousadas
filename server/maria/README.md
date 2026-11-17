# MAR IA — Assistente da Pousada Espírito do Mar

A MARIA é um **agente publicado na ElevenLabs** (Conversational AI). Este
serviço Python (FastAPI) tem três papéis:

- **Sessão** — `POST /api/maria/session` emite a `signed_url` de
  conversação por funcionário autenticado (`ELEVENLABS_API_KEY` nunca
  sai do backend).
- **Ferramentas** — `POST /mcp` stateless expõe ~90 tools (leitura,
  `preparar_*`, `confirmar_acao`) autenticadas pelo JWT do usuário —
  executadas como client tools no navegador ou server tools chamando
  este endpoint; RBAC idêntico em ambos.
- **Inná** — `POST /ia/concierge` (chave interna) e
  `/ia/resposta-avaliacao`: a IA dos hóspedes, separada da MARIA.

```text
admin Angular → POST /api/maria/session (JWT) → signed_url
            → WebSocket ElevenLabs (voz STT/LLM/TTS na plataforma)
            → clientTools → POST /mcp (Bearer JWT) → API Rust
```

A orquestração local anterior (WS próprio + STT/LLM/TTS em processo)
foi removida — voz e raciocínio são do agente ElevenLabs.

## Resiliência e contexto


- **Orçamento de contexto**: histórico limita por turnos
  (`MARIA_HISTORY_MAX_TURNS`) *e* por tamanho
  (`MARIA_HISTORY_MAX_CHARS`); cada saída de ferramenta devolvida ao
  modelo é cortada em `MARIA_TOOL_RESULT_MAX_CHARS` — listas grandes
  não consomem a janela inteira.
- **Viés de vocabulário no STT**: `OPENAI_TRANSCRIPTION_PROMPT` envia
  termos do domínio (check-in, FNRH, frigobar…) para a transcrição,
  elevando a precisão em fala rápida e sotaques.
- **Cache de leituras na sessão**: a mesma tool com os mesmos args
  dentro de `MARIA_TOOL_CACHE_TTL_SECS` reutiliza o resultado — menos
  latência e menos carga na API. Qualquer escrita invalida o cache.
- **Rolling summary**: pares cortados do histórico são condensados pelo
  LLM numa nota de contexto (`MARIA_SUMMARY_ENABLED`) em vez de sumir —
  sessões longas não perdem os fatos já ditos.


## Servidor MCP (`POST /mcp`)

As tools também são expostas via **Model Context Protocol** — qualquer
cliente MCP (Claude, IDEs, outros agentes) opera o sistema com as
mesmas regras do canal de voz.

- Transporte Streamable HTTP **stateless**: JSON-RPC 2.0 em
  `POST /mcp` (`initialize`, `tools/list`, `tools/call`, `ping`,
  notificações → 202). Batches aceitos; `GET /mcp` responde 405.
- Auth: `Authorization: Bearer <jwt do sistema>` por request — cada
  chamada executa com as permissões daquele funcionário (RBAC intacto).
- Escrita: `preparar_*` → `confirmar_acao` funciona entre requests —
  pendências ficam em store por usuário com TTL de 15 min.

Exemplo (Claude Code / mcp client):

```json
{"mcpServers": {"maria": {
  "url": "https://<host>/mcp",
  "headers": {"Authorization": "Bearer <jwt>"}
}}}
```

## Evals — LLM-as-judge

`python -m evals.run_evals --judge` adiciona uma segunda opinião de
modelo por caso: **fidelidade** (só afirma o que as tools devolveram?),
**naturalidade para voz** (falável, sem markdown, concisa) e
**utilidade**. Médias saem no resumo do relatório.

`--gate` transforma eval em **gate de regressão**: exit code != 0 se a
acurácia de seleção de tools cair abaixo de `--gate-min` (default 0.9)
ou se a média de fidelidade do judge ficar abaixo de `--judge-min`
(default 3.5/5 — exige `--judge`). O workflow `maria.yml` roda o gate
quando o secret `OPENAI_API_KEY` existe no repo — sem ele, o passo é
pulado e os testes offline continuam valendo.

## Produção

### Estado distribuído (Redis)

Sem `REDIS_URL`, todo o estado vivo fica na memória do processo — ok
para uma réplica. Com 2+ réplicas atrás de um LB, configure `REDIS_URL`
(`redis://…`, `rediss://` para TLS): pendentes de confirmação, cache de
leituras, histórico de conversa e cotas passam a ser compartilhados —
qualquer réplica confirma uma ação preparada em outra, e a reconexão
do usuário retoma a conversa independente do pod que atender.

O backend é escolhido em runtime (`app/infra/state.py`): Redis quando
a URL está setada, memória caso contrário — testes e dev continuam
sem depender de infra externa. Chaves com prefixo `maria:` e TTLs
curtos (pendentes 15min, histórico `MARIA_HIST_TTL_SECS`, cotas por
janela).

### Cotas de custo

`MARIA_RATE_TURNOS_MIN` (turnos/usuário/minuto) e
`MARIA_BUDGET_TOKENS_DIA` (tokens LLM/usuário/dia). `0` = desligado.
Estourou → resposta falável explicando o limite, sem chamar o modelo —
custo zero de proteção. Com Redis, as cotas valem no cluster inteiro.

### Tracing (OpenTelemetry)

`OTEL_ENDPOINT` ativa export OTLP/HTTP (Tempo, Jaeger, Datadog,
Langfuse via gateway OTLP). Spans por turno: `maria.turno` (raiz) →
`maria.llm` (modelo, provedor, tokens, TTFT) → `maria.tool` (nome,
latência, sucesso). Desligado = custo zero, nenhum objeto criado.

### Busca híbrida na base de conhecimento

`MARIA_RAG_HYBRID` (default on) funde ranking vetorial + BM25 lexical
via Reciprocal Rank Fusion — cobre os pontos cegos dos dois mundos:
termos exatos (códigos, nomes próprios) que embedding dilui, e
sinônimos que lexical não vê. Sem embeddings indexados (cold start ou
falha na API), o lado lexical responde sozinho em vez de devolver vazio.

### Defesa ativa de injeção

`app/infra/guardrails.py` — saída de toda tool passa por sanitização
antes de entrar no contexto: padrões de prompt-injection
("ignore instruções anteriores", tags de sistema, tentativa de se
passar por developer) são neutralizados para texto inerte. Um
**canário** único por turno é embutido no prompt; se a resposta final
repetir o canário, ela é substituída por uma fala segura — sinal de
que dados de tool vazaram para a saída.

## Rodando

```bash
cd server/maria
python -m venv .venv && .venv\Scripts\activate   # ou: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # preencha as chaves
uvicorn app.main:app --host 0.0.0.0 --port 8090
```

## Autenticação

O frontend obtém a sessão em `POST /api/maria/session` e chama
`POST /mcp` com `Authorization: Bearer <jwt>`. O serviço valida com o
mesmo `JWT_SECRET` do backend — permissões por nível continuam valendo,
pois as ferramentas chamam a API real com o Bearer do usuário.
RBAC: recepção (3) não acessa financeiro/CMS/funcionários; gerente (2)
não acessa auditoria/config/CMS; admin (1) acessa tudo.

## Cobertura das ferramentas

110 tools cobrindo reservas, hóspedes, acomodações, estoque, frigobar,
estacionamento, pagamentos, **PDV** (mesas, comandas, itens, cozinha),
**café da manhã** (quadro, presenças), **caixa** (turno, movimentos,
fechamento, conferência), **tesouraria** (plano de contas, contas
financeiras, lançamentos, baixas, fluxo de caixa, DRE, extrato,
conciliação), comissões, FNRH, notificações, auditoria, funcionários,
fornecedores, compras, busca global e navegação para todas as telas.

## Ações de escrita

Toda escrita usa `preparar_*` → resumo → `confirmar_acao`. Nada é
executado sem confirmação explícita (botão na UI ou voz). Ações
preparadas expiram junto com a sessão.

## Estrutura do código

Organizado em camadas — dependência só aponta para baixo:

```text
app/
├── main.py         FastAPI — endpoints, CORS, lifecycle, persistência de métricas
├── config.py       settings (env, pydantic)
├── agent/          cérebro LLM
│   ├── llm.py          Orquestrador — loop LLM+tools, paralelismo, tokens
│   └── prompts.py      persona + regras operacionais
├── pipeline/       voz (entrada/saída)
│   ├── stt.py          Realtime API (transcrição, VAD)
│   ├── tts.py          ElevenLabs (síntese streaming)
│   └── sentences.py    SentenceBuffer (stream → unidades faláveis)
├── runtime/
│   └── session.py      sessão WS — orquestra turno, fillers, limites
├── infra/          adaptadores externos (hexagonal)
│   ├── api_client.py   httpx para a API Rust com o Bearer do usuário
│   ├── auth.py         validação JWT + níveis
│   ├── storage.py      store pluggable — JSON (dev) × SQLite (escala)
│   ├── backup.py       backup do data/ para S3/MinIO (prefixo datado)
│   ├── pg_backup.py    backup agendado do Postgres (pg_dump→gzip→S3)
│   ├── memory.py       memórias aprendidas (escopo usuário/pousada)
│   ├── transcripts.py  diário de turnos (dataset)
│   └── knowledge.py    RAG — base de conhecimento + embeddings
├── telemetry/
│   └── metrics.py      latência p50/p95 + contadores + Prometheus
└── tools/          pacote por domínio (era um único arquivo de 3,3k linhas)
    ├── registro.py     TOOLS + mapa nome→handler
    ├── executor.py     permissões, confirmação, roteamento
    ├── preparadores.py mixin dos planos preparar→confirmar
    ├── nucleo.py       leituras do sistema + compras
    ├── pdv.py          mesas, comandas, cozinha, café, comissões
    ├── financeiro.py   caixa, tesouraria, DRE, lançamentos
    ├── operacional.py  FNRH, documentos, impressoras, CMS
    ├── acoes.py        preparar_* de reservas/cadastros + navegação
    ├── pessoal.py      memória + conhecimento
    ├── constantes.py   permissões, caminhos REST, telas, campos
    └── helpers.py      datas locais e formatação

tests/   testes unitários offline (pytest)
evals/   golden set + harness de avaliação contra a OpenAI real
finetune/ pipeline de fine-tuning (curadoria → dataset SFT → jobs)
knowledge/ base de conhecimento (.md versionados)
data/    runtime gitignored — turnos, memórias, embeddings, métricas, maria.db
```

## Persistência (store)

`infra/storage.py` expõe uma porta única (`append/todos/remover/kv`)
com dois backends por `MARIA_STORAGE`:

- **`json`** (padrão) — um arquivo por coleção em `data/` (memórias em
  array atômico, turnos em JSONL com rotação). Zero migração — é o
  formato já existente.
- **`sqlite`** — `MARIA_SQLITE_FILE` (padrão `data/maria.db`):
  coleções como linhas num único banco, consultas/indexação sem ler o
  arquivo inteiro. Na primeira abertura **importa os JSONs legados
  automaticamente**. Próximo salto natural: PostgreSQL compartilhado —
  a porta já está pronta para recebê-lo.

Memórias, diário de turnos, cache de embeddings e métricas passam
todos pelo store — nenhum módulo toca disco diretamente.

### Backup (S3/MinIO)

Com `MARIA_BACKUP_ENABLED=true` + `MARIA_S3_*`, o serviço envia a cada
`MARIA_BACKUP_INTERVAL_H` horas, para `s3://BUCKET/PREFIX/<data>/`:

- `dump/` — export portável do store (memórias/turnos em JSONL,
  kv em JSON) — restaurável em qualquer backend;
- `files/` — arquivos crus de `data/` (inclui rotações do diário).

Retenção de `MARIA_BACKUP_RETAIN` dias (podas automáticas). Funciona
com MinIO (`MARIA_S3_ENDPOINT=http://minio:9000`, path-style
automático) e AWS S3 (endpoint vazio). Credenciais fora do repo.

Postgres: com `BACKUP_DATABASE_URL` preenchida (+ `MARIA_S3_*`), um
segundo loop roda `pg_dump --format=custom` na janela diária ~04:00 UTC
(depois a cada `MARIA_BACKUP_INTERVAL_H`), compacta em gzip e envia para
`s3://BUCKET/backups/pg/maria-pg-<timestamp>.dump.gz`, mantendo os
últimos `MARIA_BACKUP_RETAIN` dumps. Falhas viram log + métrica
(`backup_pg_erros`) — nunca derrubam o serviço.

## Segurança e limites

- JWT validado em `/api/maria/session` e `/mcp`; ferramentas chamam a API com o Bearer
  do próprio usuário (RBAC do backend sempre vale).
- Defense-in-depth: conjuntos `_ACOES_*`/`_LEITURAS_*` em
  `tools/constantes.py` restringem por nível antes de bater na API.
- CORS por `MARIA_CORS_ORIGINS` (allowlist — sem `*`).
- Teto de uso por sessão: `MARIA_LIMITE_TURNOS_SESSAO` e
  `MARIA_LIMITE_TOKENS_TURNO` — proteção de custo contra loops/abuso.
- Correlation id por turno (`turno` no log e no transcript).

## Memória

`lembrar`/`esquecer` guardam só o que o usuário pedir explicitamente,
com escopo `usuario` (só o autor vê) ou `pousada` (todos veem).
Persistência via store (`MARIA_STORAGE` — ver seção Persistência).

## Base de conhecimento (RAG)

Documentos `.md` em `knowledge/` (versionados) são fatiados por
seções `##`, embedados via `OPENAI_EMBED_MODEL` e recuperados por
similaridade de cosseno pela ferramenta `buscar_conhecimento`.
Cache de vetores no store (kv `embeddings`) — só o que mudou é
re-embedado. Edite `knowledge/sobre-a-pousada.md` com os dados reais
da casa (o arquivo é um template). Detalhes em `knowledge/README.md`.

Divisão de responsabilidade entre "saberes":

- **Tools** → dados ao vivo do sistema (reserva, estoque, caixa);
- **RAG** → políticas/procedimentos fixos editados pela equipe;
- **Memória** → fatos que o usuário ensina no dia a dia.

## Fine-tuning

Pipeline completo para fixar persona, estilo falado e padrão de
seleção de ferramentas — **não ensina fatos** (isso é papel das
tools e do RAG):

```bash
cd server/maria
# 1) turnos reais já estão em data/turns.jsonl (MARIA_TRANSCRIPT_*)
# 2) curadoria humana — aprova/edita/rejeita turnos → data/curated.jsonl
python -m finetune.revisar            # interativo (a/e/r/p/s)
python -m finetune.revisar --auto     # aprova turnos sem erro em lote
# 3) dataset SFT (messages + tools) → data/ft_train.jsonl / ft_valid.jsonl
python -m finetune.dataset
# 4) upload + job na OpenAI (guardas: mínimo 10, avisa < 50 exemplos)
python -m finetune.jobs pipeline
python -m finetune.jobs status <job_id>
# 5) ao concluir: OPENAI_LLM_MODEL=ft:... no .env
```

O dataset usa o formato SFT com `tool_calls` + respostas `tool` —
reconstruído dos turnos reais (por isso o log guarda o resultado das
tools, truncado e com campos sensíveis redigidos).

## Métricas e dataset

- `GET /metrics` — `{latencias, uso}`: p50/p95 por estágio (STT, 1º
  token LLM, tool, 1º áudio, total) + contadores (tokens input/output/
  cached, chamadas por ferramenta, erros, ações executadas).
- `GET /metrics.prom` — mesmas métricas no formato Prometheus
  (counters + gauges), pronto para scraping.
- **Persistência** — snapshot salvo no store a cada 60 s e no shutdown;
  restaurado no boot. Métricas não zeram mais a cada restart e o kv
  `metricas` é o ponto de agregação para multi-instância.
- **Diário de turnos** (`MARIA_TRANSCRIPT_*`) — cada turno vira um
  registro com pergunta, resposta, tools (args + resultado truncado),
  latências e tokens. É o dataset bruto para avaliação, melhoria
  contínua e fine-tuning. Campos sensíveis (senha, cpf, token) são
  redigidos.

## Testes e lint

```bash
cd server/maria
pip install -r requirements-dev.txt
ruff check .              # lint estático (mesma regra do CI)
python -m pytest tests -q
```

70+ testes, 100% offline — cobrem dispatch de tools, RBAC por nível,
fluxo preparar→confirmar, datas, memória, SentenceBuffer, transcripts,
store (contrato JSON/SQLite + migração), métricas (snapshot +
Prometheus), RAG (fatiamento + busca com embedder injetável) e o
pipeline de fine-tuning (formato SFT, dedup, split).

CI (`.github/workflows/maria.yml`): ruff → compileall → pytest em
cada push/PR que tocar `server/maria/**`.

## Avaliação (evals)

Golden set em `evals/dataset.json` (~20 casos pt-BR: leituras, escritas,
permissões, navegação, smalltalk). Roda contra a OpenAI real com a API
do sistema stubada — mede precisão de seleção de ferramentas, respeito
a permissões e latência por turno:

```bash
python -m evals.run_evals                 # relatório → evals/report.json
python -m evals.run_evals --nivel 3       # só casos de recepção
python -m evals.run_evals --limite 5      # rodada rápida
```

Use o relatório para comparar mudanças de prompt/modelo antes de
promover (`evals/report.json` guarda acurácia + latência média).
