#!/usr/bin/env python3
"""Gera docs/arquitetura/planta-tecnica.drawio — 4 páginas de blueprint."""
import html

NAVY = "#1E3A5F"; TEAL = "#0E7C7B"; GOLD = "#B08D2E"
C_CLIENT = "#DAE8FC"; S_CLIENT = "#6C8EBF"
C_DATA = "#D5E8D4"; S_DATA = "#82B366"
C_EXT = "#FFF2CC"; S_EXT = "#D6B656"
C_BOX = "#F5F5F5"; S_BOX = "#999999"
C_WARN = "#F8CECC"; S_WARN = "#B85450"

F = "fontFamily=Segoe UI;"
STY_ACTOR = f"shape=actor;html=1;{F}fontSize=11;fillColor={C_CLIENT};strokeColor={S_CLIENT};"
STY_TITLE = f"text;html=1;{F}fontSize=18;fontStyle=1;fontColor={NAVY};"
STY_SUB = f"text;html=1;{F}fontSize=10;fontColor=#666666;"
STY_CLIENT = f"rounded=1;whiteSpace=wrap;html=1;{F}fontSize=11;fillColor={C_CLIENT};strokeColor={S_CLIENT};"
STY_SVC = f"rounded=1;whiteSpace=wrap;html=1;{F}fontSize=11;fillColor={NAVY};fontColor=#FFFFFF;strokeColor={NAVY};"
STY_SVC2 = f"rounded=1;whiteSpace=wrap;html=1;{F}fontSize=11;fillColor={TEAL};fontColor=#FFFFFF;strokeColor={TEAL};"
STY_DB = f"shape=cylinder3;whiteSpace=wrap;html=1;{F}fontSize=11;fillColor={C_DATA};strokeColor={S_DATA};"
STY_EXT = f"rounded=1;whiteSpace=wrap;html=1;{F}fontSize=10;fillColor={C_EXT};strokeColor={S_EXT};"
STY_LANE = f"swimlane;html=1;startSize=26;{F}fontSize=11;fontStyle=1;fillColor={C_BOX};strokeColor={S_BOX};"
STY_LANE_NAVY = f"swimlane;html=1;startSize=26;{F}fontSize=11;fontStyle=1;fillColor={NAVY};fontColor=#FFFFFF;strokeColor={NAVY};"
STY_LANE_TEAL = f"swimlane;html=1;startSize=26;{F}fontSize=11;fontStyle=1;fillColor={TEAL};fontColor=#FFFFFF;strokeColor={TEAL};"
STY_INNER = f"rounded=0;whiteSpace=wrap;html=1;{F}fontSize=10;fillColor=#FFFFFF;strokeColor={S_BOX};"
STY_INNER_NAVY = f"rounded=0;whiteSpace=wrap;html=1;{F}fontSize=10;fillColor={NAVY};fontColor=#FFFFFF;strokeColor={NAVY};"
STY_INNER_TEAL = f"rounded=0;whiteSpace=wrap;html=1;{F}fontSize=10;fillColor={TEAL};fontColor=#FFFFFF;strokeColor={TEAL};"
STY_NOTE = f"shape=note;whiteSpace=wrap;html=1;{F}fontSize=10;align=left;fillColor=#FFFFCC;strokeColor={GOLD};"
STY_WARN = f"rounded=1;whiteSpace=wrap;html=1;{F}fontSize=10;fillColor={C_WARN};strokeColor={S_WARN};"
STY_STEP = f"ellipse;whiteSpace=wrap;html=1;{F}fontSize=10;fillColor=#FFFFFF;strokeColor={S_BOX};"
STY_STEP_NAVY = f"ellipse;whiteSpace=wrap;html=1;{F}fontSize=10;fillColor={NAVY};fontColor=#FFFFFF;strokeColor={NAVY};"
STY_STEP_TEAL = f"ellipse;whiteSpace=wrap;html=1;{F}fontSize=10;fillColor={TEAL};fontColor=#FFFFFF;strokeColor={TEAL};"
EDGE = "edgeStyle=orthogonalEdgeStyle;html=1;rounded=1;fontSize=9;fontColor=#444444;endArrow=block;"
EDGE_DASH = EDGE + "dashed=1;strokeColor=#888888;"
EDGE_GOLD = EDGE + "strokeColor=" + GOLD + ";strokeWidth=2;"
EDGE_TEAL = EDGE + "strokeColor=" + TEAL + ";"

cells = []
_id = [0]
def nid():
    _id[0] += 1
    return f"c{_id[0]}"

def box(x, y, w, h, label, style, vid=None):
    i = vid or nid()
    cells.append(
        f'<mxCell id="{i}" value="{html.escape(label, quote=True)}" style="{style}" vertex="1" parent="1">'
        f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')
    return i

def text(x, y, w, h, label, size=10, color="#444444", bold=False):
    st = f"text;html=1;{F}fontSize={size};fontColor={color};align=left;verticalAlign=top;"
    if bold: st += "fontStyle=1;"
    return box(x, y, w, h, label, st)

def edge(src, tgt, label="", style=EDGE):
    i = nid()
    cells.append(
        f'<mxCell id="{i}" value="{html.escape(label, quote=True)}" style="{style}" edge="1" parent="1" source="{src}" target="{tgt}">'
        f'<mxGeometry relative="1" as="geometry"/></mxCell>')
    return i

def page(name, pid):
    global cells, _id
    body = "".join(cells)
    cells, _id = [], [0]
    return (f'<diagram name="{html.escape(name, quote=True)}" id="{pid}">'
            f'<mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" '
            f'connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="1100" '
            f'math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>{body}'
            f'</root></mxGraphModel></diagram>')

pages = []

# ═══════════════ PÁGINA 1 — VISÃO GERAL ═══════════════
text(40, 12, 900, 26, "CRM Hotel Pousadas — Arquitetura do Sistema (produção Railway, projeto espirito-do-mar)", 18, NAVY, True)
text(40, 40, 1100, 18, "Monorepo: client/ (Angular 22 + Playwright) · server/ (Rust workspace + FastAPI MAR IA + Erlang realtime) · CI GitHub Actions", 10)

# Atores
hosp = box(140, 80, 120, 70, "Hóspede&#10;(site público)", STY_ACTOR)
staff = box(560, 80, 120, 70, "Staff&#10;(recepção, cozinha,&#10;administração)", STY_ACTOR)
psp = box(980, 80, 120, 70, "Stripe&#10;(webhooks de&#10;pagamento)", STY_ACTOR)

# Frontends
web = box(60, 200, 280, 120,
    "website-institucional — Angular 22&#10;espiritodomar.com.br&#10;&#10;reserva online · blog SEO (Guia do Peró)&#10;"
    "newsletter · checkout Stripe&#10;em-breve / coming-soon", STY_CLIENT)
adm = box(440, 200, 360, 120,
    "admin — Angular 22 (standalone + signals)&#10;crm.espiritodomar.com.br&#10;&#10;"
    "25 features: dashboard · recepção · reservas · clientes · acomodações · PDV · café&#10;"
    "estacionamento · frigobares · estoque · compras · contratos · operadoras · tesouraria&#10;"
    "funcionários · escalas · governança · manutenção · comunicação · CMS · estabelecimento&#10;"
    "auditoria · pagamentos · inteligência · painel MAR IA", STY_CLIENT)
e2e = box(880, 200, 200, 60, "client/e2e — Playwright&#10;jornadas completas&#10;(API mockada)", STY_CLIENT)

# Railway container
rail = box(40, 360, 1080, 250, "Railway — us-east-1 (API migrada; latency < ams p/ BR) — réplicas sob demanda", STY_LANE)
api = box(80, 400, 280, 150,
    "api-server-rust — axum/tower ×2&#10;&#10;REST /api/v1/* (19 módulos)&#10;WS realtime (delta/aviso)&#10;"
    "JWT + refresh · rate-limit login&#10;alerta 5xx → webhook&#10;migrations no boot (sqlx)", STY_SVC)
maria = box(400, 400, 280, 150,
    "inteligencia-artificial — FastAPI&#10;&#10;MAR IA: WS texto/voz + POST /mcp&#10;~50 tools preparar_* →&#10;"
    "confirmar_acao (HITL) → REST interno&#10;Redis state · RAG híbrido&#10;pg_dump agendado ~04:00 UTC", STY_SVC2)
erl = box(720, 400, 200, 70, "motor-realtime-erlang&#10;(Phoenix channels)&#10;realtime-production", STY_SVC2)
pgb = box(720, 480, 200, 60, "pg-backup + Console&#10;jenkins (CI legado)", STY_INNER)
aux = box(940, 400, 120, 140, "auxiliares&#10;—&#10;vol: maria-volume&#10;(modelos whisper/&#10;piper, data/)", STY_INNER)

# Dados
pg = box(100, 680, 240, 110, "PostgreSQL 18&#10;domínio (42 migrations)&#10;LISTEN/NOTIFY:&#10;clarituz_delta · clarituz_aviso&#10;+ pg-exporter", STY_DB)
rds = box(400, 680, 200, 110, "Redis&#10;pend: tc: rate: budget:&#10;sessões MAR IA&#10;futuro: Pub/Sub multi-réplica", STY_DB)
s3 = box(660, 680, 200, 110, "Bucket (S3/MinIO)&#10;backups pg_dump&#10;backups MAR IA data/", STY_DB)
obs = box(920, 680, 200, 110, "Observabilidade&#10;prometheus · grafana&#10;(métricas scraping)&#10;OTel sem destino ainda", STY_INNER)

# Externos
text(1180, 180, 200, 20, "Serviços externos", 12, GOLD, True)
oai = box(1180, 210, 200, 60, "OpenAI&#10;gpt-5.2 (LLM principal)&#10;Realtime STT · whisper-1", STY_EXT)
cer = box(1180, 285, 200, 50, "Cerebras&#10;gpt-oss-120b — fallback LLM&#10;(Chat Completions)", STY_EXT)
elv = box(1180, 350, 200, 40, "ElevenLabs — TTS&#10;(default; Piper pt-BR local)", STY_EXT)
strp = box(1180, 405, 200, 40, "Stripe — checkout + webhook", STY_EXT)
rsn = box(1180, 460, 200, 40, "Resend — e-mail transacional", STY_EXT)
dsc = box(1180, 515, 200, 50, "Discord/Slack webhook&#10;ALERT_WEBHOOK_URL&#10;(alerta 5xx dedup)", STY_WARN)
gh = box(1180, 580, 200, 70, "GitHub Actions&#10;api.yml (cargo) · maria.yml&#10;(pytest/ruff) · client.yml (ng)", STY_EXT)

# Edges
edge(hosp, web, "HTTPS")
edge(staff, adm, "HTTPS")
edge(staff, e2e, "roda local")
edge(web, api, "REST público")
edge(adm, api, "REST + Bearer&#10;single-flight refresh 401", EDGE)
edge(adm, maria, "WS chat/voz&#10;JWT ?token=", EDGE_TEAL)
edge(psp, api, "POST webhook&#10;event_id dedup", EDGE_GOLD)
edge(maria, api, "REST interno&#10;X-Internal-Key", EDGE_TEAL)
edge(api, pg, "SQLx pool&#10;migrations boot")
edge(api, rds, "cotas/estado")
edge(api, s3, "object_store&#10;(docs/imagens)")
edge(api, strp, "checkout +&#10;verify webhook", EDGE_DASH)
edge(api, rsn, "e-mail", EDGE_DASH)
edge(api, dsc, "POST alerta 5xx&#10;(método+rota+status,&#10;dedup 5min, cap 20/min)", EDGE_DASH)
edge(maria, pg, "state + backup&#10;pg_dump", EDGE_TEAL)
edge(maria, rds, "state compartilhado", EDGE_TEAL)
edge(maria, s3, "upload dump", EDGE_TEAL)
edge(maria, oai, "LLM + STT")
edge(maria, cer, "fallback")
edge(maria, elv, "TTS")
edge(pg, obs, "pg-exporter")
edge(pgb, pg, "")
pages.append(page("1 — Visão Geral", "p1"))

# ═══════════════ PÁGINA 2 — API RUST ═══════════════
text(40, 12, 900, 26, "api-server-rust — Clean Architecture em workspace Cargo", 18, NAVY, True)
text(40, 40, 1100, 18, "Dependências apontam para baixo (http→application→domain) ou infra→domain. Domain não conhece axum, sqlx ou HTTP.", 10)

boot = box(120, 80, 760, 60, "bootstrap — cli.rs (subcomandos) · commands.rs · serve.rs&#10;main.rs: tracing → config → compose → serve", STY_INNER_NAVY)

http = box(120, 160, 760, 170, "http — axum/tower", STY_LANE_NAVY)
box(140, 195, 340, 120, "router.rs — 19 módulos:&#10;auth cafe caixa catalogo cms compras&#10;comunicacao estoque impressoras notificacoes&#10;operacao operadoras pagamentos_online pdv&#10;pessoas preditivo relatorios reservas tesouraria", STY_INNER)
box(500, 195, 360, 120, "middleware.rs / state.rs / extractors.rs&#10;&#10;auth JWT (roles) · ConnectInfo IP&#10;rate-limit login (janela fixa, LOGIN_RATE_LIMIT_PER_MIN&#10;default 10/60s, clamp 1–10000, 429+Retry-After)&#10;AlertaErro: 5xx → webhook async, dedup rota+status&#10;5min, path masking {id}, sem query, cap 20/min&#10;CatchPanicLayer", STY_INNER)

wrk = box(120, 350, 760, 80, "workers — tasks tokio em background&#10;atendimento · comunicacao · metricas · pagamentos · rotinas", STY_INNER_NAVY)

app = box(120, 450, 760, 100, "application — services/ (orquestração de casos de uso,&#10;transações, regras de negócio aplicadas)&#10;dto/ — contratos por domínio (25 módulos)", STY_INNER)

dom = box(120, 570, 760, 110, "domain — entities · enums/ (9 domínios, sum types com&#10;match exaustivo) · value_objects/ (cpf, email, periodo)&#10;queries/ (projeções de leitura) · events&#10;&#10;sem dependência de framework — puro", STY_INNER)

infra = box(120, 700, 760, 160, "infrastructure — adapters", STY_LANE_NAVY)
box(140, 735, 350, 110, "persistence/&#10;db.rs: pool + sqlx::migrate! no boot&#10;repositories/ — 23 repos SQLx&#10;(audit busca cafe caixa catalogo cms compras&#10;comunicacao contrato estoque impressora&#10;notificacao operacao operadora pagamento pdv&#10;pessoas preditivo reserva suporte tesouraria)", STY_INNER)
box(510, 735, 350, 110, "integrations/ maria · senders · stripe&#10;messaging/ eventos.rs LISTEN/NOTIFY&#10;storage/ object_store · s3_probe&#10;security/ jwt · password&#10;printing/ escpos · parsing/ ofx&#10;composition/ compose.rs (DI root)", STY_INNER)

sh = box(120, 880, 760, 70, "shared — config (env→struct: alert_webhook_url,&#10;login_rate_limit_per_min) · pagination · primitives (ids, money, time)", STY_INNER)

# laterais
ext2 = box(940, 160, 260, 200, "Saídas externas&#10;&#10;PostgreSQL 18 — dados + NOTIFY&#10;Redis — cotas&#10;S3 — object_store&#10;Stripe — cobrança&#10;Resend — e-mail&#10;MAR IA — cliente interno&#10;Discord — alerta 5xx", STY_EXT)
note2 = box(940, 400, 260, 150, "Invariantes&#10;&#10;· migrations rodam no boot (sqlx::migrate!)&#10;· checksum por migration — LF obrigatório&#10;· webhook pagamento: inbox por event_id,&#10;  ON CONFLICT DO NOTHING, vazio processa&#10;· panic=abort em release — CatchPanic só unwind", STY_NOTE)

edge(boot, http, "monta")
edge(http, app, "handlers → use cases")
edge(wrk, app, "consome")
edge(app, dom, "regras")
edge(app, infra, "ports → adapters", EDGE_DASH)
edge(dom, infra, "entities mapeadas", EDGE_DASH)
edge(infra, ext2, "I/O", EDGE_DASH)
edge(infra, sh, "config", EDGE_DASH)
edge(http, sh, "state/config", EDGE_DASH)
pages.append(page("2 — API Rust (camadas)", "p2"))

# ═══════════════ PÁGINA 3 — MAR IA ═══════════════
text(40, 12, 900, 26, "MAR IA (inteligencia-artificial) — agente de concierge com tools e HITL", 18, TEAL, True)
text(40, 40, 1200, 18, "FastAPI + asyncio. Turno: entrada → sessão → LLM (tool-calling) → preparar_* (staging) → confirmação humana → confirmar_acao → API REST.", 10)

# entradas
ent = box(80, 80, 1080, 80, "Entradas&#10;WS /ws (chat admin, Bearer ?token=) · WS voz (PCM16 24kHz)&#10;POST /mcp (JSON-RPC 2.0, JWT por request) · HTTP rotas_ia.py", STY_LANE_TEAL)

sess = box(300, 190, 640, 90, "runtime/session.py — MariaSession&#10;auth + contexto (reserva, hóspede) · seleciona providers STT/TTS&#10;histórico com rolling summary (não trunca cego) · semântic cache reads", STY_INNER_TEAL)

# colunas
pip = box(80, 320, 330, 260, "pipeline/ — voz (só se MARIA_VOICE_ENABLED)", STY_LANE_TEAL)
box(95, 355, 300, 210, "audio.py: PCM16, resample linear&#10;&#10;stt.py: OpenAiStt | WhisperLocalStt&#10;· faster-whisper int8, 24k→16k float32&#10;· VAD webrtcvad (resample/frame→16k)&#10;  + fallback energia · pre-roll 300ms&#10;· utterances em fila → executor&#10;&#10;sentences.py: corta TTS em frases&#10;&#10;tts.py: ElevenTts | PiperTts&#10;· pt_BR-faber-medium, ONNX, executor&#10;· resample →24k · close drena / cancel aborta", STY_INNER)

ag = box(440, 320, 330, 260, "agent/ — cérebro", STY_LANE_TEAL)
box(455, 355, 300, 210, "llm.py&#10;· OpenAI Responses API — gpt-5.2&#10;· Fallback: Cerebras Chat Completions&#10;  gpt-oss-120b (mesma tool surface)&#10;· streaming por frases p/ TTS&#10;· circuit breaker (circuitos no /healthz)&#10;&#10;prompts.py: system + 'saberes'&#10;&#10;evals 2.0: LLM-as-judge&#10;(fidelidade · voz · utilidade)", STY_INNER)

tl = box(800, 320, 330, 260, "tools/ — mãos do agente (~50)", STY_LANE_TEAL)
box(815, 355, 300, 210, "preparar_* — staging: valida input,&#10;monta DTO, guarda em pend: (Redis)&#10;NUNCA escreve no banco&#10;&#10;confirmar_acao — commit: humano&#10;confirma → executor despacha&#10;&#10;nucleo operacional pdv pessoal&#10;financeiro inteligencia acoes&#10;&#10;executor.py → api_client.py&#10;→ REST api-server X-Internal-Key", STY_INNER)

inf = box(80, 610, 700, 180, "infra/ — suporte", STY_LANE_TEAL)
box(95, 645, 670, 130, "knowledge.py: RAG híbrido (vetorial + lexical, cache por hash)&#10;memory.py: perfil/preferências do hóspede · state.py: Redis+PG&#10;guardrails.py · auth.py (JWT) · resilience.py (retry/timeout)&#10;api_client.py (REST interno) · transcripts.py&#10;pg_backup.py: scheduler ~04:00 UTC → pg_dump custom → S3&#10;backup.py/storage.py: backup data/ → S3 (24h, retain 14)", STY_INNER)

mcp = box(810, 610, 320, 80, "mcp.py — POST /mcp&#10;JSON-RPC 2.0 stateless&#10;tools/list + tools/call&#10;RBAC por JWT", STY_INNER_TEAL)
tel = box(810, 705, 320, 85, "telemetry/&#10;metrics.py (counters/timers)&#10;tracing.py (OTel, sem destino ainda)", STY_INNER)

# externos
text(1200, 80, 260, 20, "Provedores", 12, GOLD, True)
oai3 = box(1200, 110, 240, 60, "OpenAI&#10;Responses gpt-5.2 · Realtime STT", STY_EXT)
cer3 = box(1200, 185, 240, 50, "Cerebras gpt-oss-120b&#10;fallback automático", STY_EXT)
elv3 = box(1200, 250, 240, 50, "ElevenLabs — voz default&#10;Piper pt-BR — alternativa local", STY_EXT)
apir = box(1200, 315, 240, 50, "api-server-rust&#10;REST interno (X-Internal-Key)", STY_EXT)
rds3 = box(1200, 380, 240, 50, "Redis — pend: tc: rate: budget:", STY_EXT)
pg3 = box(1200, 445, 240, 50, "Postgres — estado/backup src", STY_EXT)
s33 = box(1200, 510, 240, 40, "S3 — dumps", STY_EXT)

edge(ent, sess, "")
edge(sess, pip, "voz", EDGE_TEAL)
edge(sess, ag, "turnos")
edge(sess, tl, "tool calls")
edge(tl, apir, "write via confirmar_acao", EDGE_GOLD)
edge(ag, oai3, "")
edge(ag, cer3, "fallback", EDGE_DASH)
edge(pip, oai3, "STT", EDGE_DASH)
edge(pip, elv3, "TTS", EDGE_DASH)
edge(inf, rds3, "")
edge(inf, pg3, "")
edge(inf, s33, "")
edge(mcp, tl, "mesma surface", EDGE_DASH)
pages.append(page("3 — MAR IA (agente)", "p3"))

# ═══════════════ PÁGINA 4 — FLUXOS & ALGORITMOS ═══════════════
text(40, 12, 900, 26, "Fluxos críticos e algoritmos-chave", 18, NAVY, True)

# Fluxo A — reserva
text(40, 60, 500, 20, "A. Reserva online → confirmação (idempotente)", 13, NAVY, True)
a1 = box(40, 95, 150, 60, "1. Hóspede preenche&#10;reserva no site", STY_STEP)
a2 = box(210, 95, 150, 60, "2. API cria&#10;pré-reserva&#10;(hold + expiração)", STY_STEP_NAVY)
a3 = box(380, 95, 150, 60, "3. Redireciona&#10;Stripe Checkout", STY_STEP)
a4 = box(550, 95, 150, 60, "4. Stripe cobra&#10;e dispara webhook", STY_STEP)
a5 = box(720, 95, 170, 60, "5. POST /pagamentos&#10;/webhook — verifica&#10;assinatura", STY_STEP_NAVY)
a6 = box(910, 95, 190, 60, "6. Inbox: event_id único&#10;ON CONFLICT DO NOTHING&#10;duplicado → 200 sem reprocesso&#10;event_id vazio → log + processa", STY_STEP_NAVY)
a7 = box(1120, 95, 150, 60, "7. Confirma reserva&#10;marca processado_em", STY_STEP)
a8 = box(1290, 95, 150, 60, "8. NOTIFY → admin&#10;atualiza em tempo real", STY_STEP)
for s, t in [(a1,a2),(a2,a3),(a3,a4),(a4,a5),(a5,a6),(a6,a7),(a7,a8)]:
    edge(s, t)

# Fluxo B — realtime
text(40, 200, 500, 20, "B. Realtime (LISTEN/NOTIFY → WS admin)", 13, NAVY, True)
b1 = box(40, 235, 160, 60, "1. Qualquer escrita&#10;no domínio (SQL)", STY_STEP_NAVY)
b2 = box(230, 235, 160, 60, "2. Trigger PG dispara&#10;pg_notify()", STY_STEP)
b3 = box(420, 235, 170, 60, "3. api eventos.rs&#10;LISTEN clarituz_delta&#10;clarituz_aviso", STY_STEP_NAVY)
b4 = box(620, 235, 160, 60, "4. Fan-out p/ WS&#10;dos admins conectados", STY_STEP_NAVY)
b5 = box(810, 235, 200, 60, "5. Realtime.delta('tabela')&#10;→ effect() recarrega&#10;só o que mudou", STY_STEP)
b6 = box(1040, 235, 200, 60, "⚠ gap conhecido: NOTIFY&#10;é por conexão — com >1 réplica&#10;parte dos eventos se perde.&#10;Plano: Redis Pub/Sub.", STY_WARN)
for s, t in [(b1,b2),(b2,b3),(b3,b4),(b4,b5),(b5,b6)]:
    edge(s, t)

# Fluxo C — turno de voz
text(40, 340, 500, 20, "C. Turno de voz MAR IA (quando habilitado)", 13, TEAL, True)
c1 = box(40, 375, 140, 60, "1. mic → PCM16&#10;24kHz via WS", STY_STEP)
c2 = box(200, 375, 160, 60, "2. VAD: webrtcvad&#10;(frame→16k) + energia&#10;pre-roll 300ms", STY_STEP_TEAL)
c3 = box(380, 375, 160, 60, "3. STT: resample→16k&#10;float32, faster-whisper&#10;em executor (fim da fala)", STY_STEP_TEAL)
c4 = box(560, 375, 160, 60, "4. LLM: gpt-5.2&#10;+ tools + RAG&#10;(fallback Cerebras)", STY_STEP_TEAL)
c5 = box(740, 375, 160, 60, "5. Se ação: preparar_*&#10;→ staff confirma →&#10;confirmar_acao → API", STY_STEP_NAVY)
c6 = box(920, 375, 160, 60, "6. TTS por frase&#10;(Piper/Eleven) →&#10;resample→24k", STY_STEP_TEAL)
c7 = box(1100, 375, 160, 60, "7. PCM p/ speaker&#10;+ transcript salva", STY_STEP)
for s, t in [(c1,c2),(c2,c3),(c3,c4),(c4,c5),(c5,c6),(c6,c7)]:
    edge(s, t)

# Fluxo D — ops
text(40, 480, 500, 20, "D. Rotinas de operação", 13, NAVY, True)
d1 = box(40, 515, 280, 90, "Backup Postgres (diário ~04:00 UTC)&#10;scheduler → pg_dump --format=custom&#10;(cliente 18 ≥ server) → upload S3&#10;prefixo datado → retenção por contagem", STY_INNER)
d2 = box(350, 515, 280, 90, "Alerta de erro 5xx&#10;middleware observa status → spawn async&#10;dedup (método+rota_mask+status) 5min&#10;cap global 20/60s · falha ≠ afeta resposta", STY_INNER)
d3 = box(660, 515, 280, 90, "Rate limit login&#10;IP (X-Forwarded-For→ConnectInfo)&#10;janela fixa 60s · default 10 tentativas&#10;429 + Retry-After", STY_INNER)
d4 = box(970, 515, 280, 90, "Auth refresh (admin)&#10;401 → single-flight refresh&#10;(1 chamada p/ N requests pendentes)&#10;falha → logout → /login", STY_INNER)

# Algoritmos
alg = box(40, 640, 1210, 330, "Algoritmos & invariantes-chave", STY_LANE)
text(60, 680, 1180, 280,
 "Idempotência webhook: inbox pagamento_webhook_evento com UNIQUE(event_id) + ON CONFLICT DO NOTHING — reenvios do PSP são no-op; event_id vazio não colide (guard).&#10;"
 "Migrations: sqlx::migrate! no boot com checksum por arquivo — conteúdo modificado aborta o boot (defesa). Line-ending é byte-significativo: *.sql fixado em LF via .gitattributes.&#10;"
 "RAG híbrido (knowledge.py): busca vetorial + lexical combinadas; índice por hash de arquivo — só re-embeda o que mudou.&#10;"
 "Rolling summary (session.py): histórico descartado vira resumo em vez de truncar — contexto longo sem perder início da conversa.&#10;"
 "Cache semântico de reads: respostas de tools de leitura cacheadas por sessão; invalidado após qualquer escrita.&#10;"
 "Two-phase action (HITL): preparar_* só valida + staged em Redis pend:; escrita real só via confirmar_acao do humano — LLM nunca escreve direto.&#10;"
 "VAD composto: webrtcvad exige 8/16/32/48k — cada frame 24k resampleado p/ 16k antes; fallback energia se lib indisponível; pre-roll evita clipar ataque da fala.&#10;"
 "Dedup de alerta: chave (método, rota_mask, status) com TTL 5min em memória; cap 20/min global; suprimidos logam warn.&#10;"
 "Fixed-window rate limit: bucket por IP, Retry-After = resto da janela; X-Forwarded-For → ConnectInfo fallback.&#10;"
 "Single-flight refresh: N requests 401 concorrentes → 1 chamada /auth/refresh compartilhada; fila desbloqueia junto.&#10;"
 "Sum types de domínio: enums Rust com match exaustivo — transição inválida de estado de reserva/comanda vira erro de compilação.&#10;"
 "Executor isolation: ONNX/whisper rodam em run_in_executor — event loop nunca bloqueia por inferência.&#10;"
 "Circuit breaker LLM: falhas consecutivas abrem circuito → failover Cerebras; estado visível em /healthz.", 10)

pages.append(page("4 — Fluxos & Algoritmos", "p4"))

mxfile = ('<mxfile host="app.diagrams.net" agent="Devin" version="24.0.0" type="device">'
          + "".join(pages) + "</mxfile>")

out = r"C:\Users\Vinicius Moreira\Documents\GitHub\crm-hotel-pousadas\docs\arquitetura\planta-tecnica.drawio"
import os
os.makedirs(os.path.dirname(out), exist_ok=True)
open(out, "w", encoding="utf-8").write(mxfile)
print("escrito:", out, len(mxfile), "bytes")
