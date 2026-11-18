# Disaster Recovery — Backup e Restore do Postgres

Runbook operacional do banco de produção (serviço `Postgres`, projeto
`projeto-espirito-do-mar`, Railway, região `ams`). Todo o estado do sistema
vive nesse banco: se ele se perde, o sistema inteiro se perde junto.

> **Regra de ouro: nunca se restaura por cima de produção.**
> Restore sempre em banco **novo** (serviço irmão no Railway, staging ou
> local), valida, e só então reponta os serviços. A exceção controlada é o
> restore de *volume backup* pelo dashboard, que o próprio Railway executa
> de forma *staged* (o volume antigo é preservado desmontado).

Último drill executado: **2026-11-18** — procedimento da seção
[Restore testado](#4-restore-testado--passo-a-passo) validado ponta a ponta
contra o schema real (51 migrations). Resultados na seção
[Evidência do último drill](#evidência-do-último-drill).

---

## 1. Inventário — o que é dado crítico

Um único Postgres concentra tudo (106 objetos em `public`, 51 migrations
sqlx). Por ordem de impacto na operação da pousada:

| Domínio | Tabelas principais | Perda significa |
| --- | --- | --- |
| Reservas | `reserva` (invariante anti-overbooking `excl_reserva_sem_overlap`), `pre_reserva`, `grupo*`, `reserva_acompanhante` | Mapa de ocupação, check-ins do dia, receita futura |
| Hóspedes | `cliente`, `cliente_documento`, `cliente_fidelidade`, `fnrh`, `avaliacao` | Cadastro, FNRH (obrigação legal), fidelidade |
| Fiscal NFS-e | `fiscal_documento` (intenção durável + idempotência por `integration_id`), `fiscal_evento` (inbox de webhook), `estoque_nfe`, `tributo_*` | Notas emitidas/em aberto — obrigação com a prefeitura |
| Outbox de mensagens | `fila_envio` (worker drena a cada 30s — e-mail/WhatsApp/push), `distribuicao_outbox` (ARI p/ Channex), `distribuicao_pendencia`, `comunicacao_evento`, `notificacao*` | Confirmações de reserva, lembretes, sincronia com OTAs |
| Pagamentos | `pagamento`, `pagamento_tentativa`, `pagamento_webhook_evento` (inbox dedup), `pagamento_auditoria`, `pagamento_reembolso`, `reembolso`, `split_payment`, `conciliacao`, `extrato_item` | Cobranças, sinais online, conciliação |
| **Credenciais de integração** | `integracao`, `integracao_segredo` (envelope AES-256-GCM), `integracao_padrao` | Stripe/PagBank/MP, Z-API, Spedy, Didit, Channex — **ilegíveis sem `INTEGRACOES_MASTER_KEY`** |
| Operação diária | `consumo`, `item_consumido`, `caixa_*`, `pdv_*`, `estoque`, `movimento_estoque`, `frigobar*`, `estacionamento`, `enxoval_mov`, `lavanderia_lote`, `manutencao_ordem`, `governanca_tarefa` | Conta do hóspede, caixa aberto, estoque |
| Acesso e auditoria | `funcionario`, `cargo`, `sessao_refresh`, `logacesso`, `log` (auditoria, mesma transação da mutação), `lgpd_*` | Quem pode operar + rastro legal (LGPD art. 37 — ver `server/docs/conformidade-legal.md`) |
| Site/CMS | `cms_site`, `acomodacao_cms`, `acomodacao_midia`, `newsletter_inscricao` | Conteúdo público editável |
| Integrações diversas | `verificacao_identidade`, `verificacao_evento` (Didit), `operadora`, `contrato_corporativo`, `distribuicao_*` | Verificação de identidade, operadoras de cartão, channel manager |

### O que NÃO está no banco (cofre separado — guardar fora do Railway)

Sem estes valores o banco restaura, mas o sistema não volta por completo:

| Segredo (env) | Efeito se perdido |
| --- | --- |
| `INTEGRACOES_MASTER_KEY` | **`integracao_segredo` restaura como lixo** — todas as credenciais de integração precisam ser re-cadastradas na tela Configurações → Integrações |
| `JWT_SECRET` | Tokens/sessões emitidas viram inválidos (todos re-logam) |
| `STRIPE_*`, `RESEND_API_KEY`, `WHATSAPP_*`, `VAPID_*`, `OPENAI_*`, `ELEVENLABS_*`, `MARIA_S3_*` | Integrações externas param até reconfigurar |
| Credenciais MinIO (`MINIO_ROOT_USER/PASSWORD`) | Sem acesso aos dumps guardados no bucket |

Guardar cópia desses segredos em gerenciador de senhas offline (Bitwarden,
1Password) — são env vars dos serviços Railway, exportáveis pelo dashboard
(Variables → Raw Editor).

---

## 2. Camadas de backup disponíveis

```text
L1  Volume backup (Railway, dashboard)          → mesmo serviço, staged
L2  PITR / pgBackRest (Railway, requer Pro)     → serviço Postgres NOVO
L3  Dump lógico pg_dump -Fc                     → qualquer lugar
     ├─ automático: MAR IA pg_backup → MinIO    (diário ~04:00 UTC, ativo)
     ├─ automático: serviço pg-backup           (IaC declarado, código pendente)
     └─ manual: railway run / proxy público     (sob demanda)
L4  Cópia externa (fora do Railway)             → sobrevive à perda da conta
```

| Camada | Status hoje | Cobre | Não cobre |
| --- | --- | --- | --- |
| L1 — Volume backup | **Verificar se habilitado** — não é declarado no IaC; ativa-se na aba *Backups* do serviço Postgres (requer plano Pro para agendado/manual) | Deploy ruim, dado corrompido, `DROP` acidental | Perda do projeto/volume (wipe apaga os backups junto) |
| L2 — PITR | **Pendente** — não habilitado. Recomendado: habilitar uma vez no serviço Postgres (pgBackRest → Railway Bucket, janela ~4 semanas) | Qualquer timestamp na janela — erro humano, migration ruim | Perda da conta/projeto Railway |
| L3a — MAR IA `pg_backup` | **Ativo** (se `BACKUP_DATABASE_URL` + `MARIA_S3_BUCKET` configurados) — código em `server/maria/app/infra/pg_backup.py` | Corrupção/lógica — dump portável para qualquer Postgres ≥ versão | Perda do MinIO/projeto (dump fica no mesmo Railway) |
| L3b — `pg-backup` dedicado | **Pendente** — serviço já declarado em `.railway/railway.ts` (env fia `Postgres.*` + `Bucket.MINIO_*`) e stage pronto no `Jenkinsfile`, mas `ops/pg-backup/` não existe no repo | Idem L3a, redundância independente da MAR IA | Idem |
| L3c — Manual | Sempre disponível (seção 3) | Resgate imediato, migração, drill | — |
| L4 — Externa | **Pendente** — sincronizar `s3://<bucket>/backups/pg/` para bucket externo (S3/GCS) ou workflow GHA (seção 7) | Perda da conta Railway inteira | — |

### Detalhes que importam

- **L1 (volume backup)**: serviço `Postgres` → aba **Backups** → agendar
  *Daily* (mantém 6 dias), opcionalmente *Weekly* (1 mês) e *Monthly*
  (3 meses). Restore é staged: o Railway monta um **novo** volume com o
  snapshot e desmonta o antigo (que fica retido). Limites: backup manual ≤
  50% do tamanho do volume; **wipe do volume apaga todos os backups**.
- **L2 (PITR)**: uma vez habilitado, o Postgres arquiva WAL continuamente
  para um Railway Bucket. Restore cria um **serviço irmão novo** — a origem
  nunca é tocada — via dashboard ou:
  `railway postgres pitr restore --service Postgres --at "2026-11-18T03:00:00Z"`
- **L3a (MAR IA)**: todo dia ~04:00 UTC (~01:00 em SP) roda
  `pg_dump --format=custom --no-owner --no-acl` → gzip →
  `s3://<MARIA_S3_BUCKET>/backups/pg/maria-pg-<AAAAMMDD-HHMMSS>.dump.gz`;
  mantém os últimos `MARIA_BACKUP_RETAIN` (default 14) dumps. Falha vira
  `log.error` + métrica `backup_pg_erros` (sucesso: `backup_pg_ok`) no
  `/metrics.prom` — o Prometheus já raspa; vale alerta no Grafana se
  `backup_pg_erros` crescer. O dump é env-gated: **sem `BACKUP_DATABASE_URL`
  a task nem inicia** — conferir no dashboard que a var existe no serviço
  `inteligencia-artificial`.
- **Os dumps ficam no MinIO do próprio Railway.** Isso resolve 90% dos
  cenários (dado corrompido, tabela dropada), mas um desastre de
  conta/projeto apaga banco *e* backups juntos — por isso a L4 existe.

### Ativação (IaC) — `.railway/railway.ts`, serviço `inteligencia-artificial`

Sem segredo copiado à mão — tudo referência entre serviços:

| Var | Valor declarado |
|---|---|
| `BACKUP_DATABASE_URL` | `postgresql://${{Postgres.*}}?sslmode=disable` (rede privada) |
| `MARIA_S3_ENDPOINT` | `http://${{Bucket.MINIO_PRIVATE_HOST}}:${{Bucket.MINIO_PRIVATE_PORT}}` |
| `MARIA_S3_ACCESS_KEY` / `MARIA_S3_SECRET_KEY` | `${{Bucket.MINIO_ROOT_USER}}` / `${{Bucket.MINIO_ROOT_PASSWORD}}` |
| `MARIA_S3_BUCKET` | `backups` (criado sozinho na 1ª execução — `_garantir_bucket`) |
| `MARIA_BACKUP_ENABLED` | `true` |
| `MARIA_BACKUP_INTERVAL_H` / `MARIA_BACKUP_RETAIN` / `MARIA_S3_PREFIX` / `MARIA_S3_REGION` | `preserve()` — tuning livre no dashboard |

### Gatilho manual e status (novo — `POST /backup/*`, só admin)

```bash
# conferir gates sem disparar nada (bucket, endpoint, retain, dsn setada)
curl -H "Authorization: Bearer <JWT admin>" $MARIA_URL/backup/status

# dump do Postgres → s3://backups/backups/pg/ AGORA (fora da janela)
curl -X POST -H "Authorization: Bearer <JWT admin>" $MARIA_URL/backup/pg

# export do store MARIA + data/ → s3://backups/maria/<dia>/ AGORA
curl -X POST -H "Authorization: Bearer <JWT admin>" $MARIA_URL/backup/dados
```

Respostas: `200` + stats (`chave`, `bytes`, `podados`) ou `503` com o
motivo (`backup pg desabilitado`, falha de upload). 401/403 = JWT
ausente ou não-admin. É o caminho para **validar credenciais MinIO sem
esperar a janela das 04:00 UTC** — primeiro passo do drill de ativação.

---

## 3. Procedimento de dump (manual, sob demanda)

Pré-requisito local: cliente PostgreSQL **≥ versão majoritária do servidor**
— confira com `select version();` (docker-compose/CI pinam PG 17; a MAR IA
instala `postgresql-client-18` justamente pela margem). No Windows:
`scoop install postgresql` (inclui `pg_dump`/`pg_restore`/`psql`).

### Opção A — via `railway run` (credenciais injetadas do serviço)

```bash
# uma vez: vincular o shell ao projeto/ambiente
railway link        # projeto projeto-espirito-do-mar · environment production

# $DATABASE_URL precisa expandir DENTRO do env do serviço — por isso bash -c:
railway run --service Postgres --environment production bash -c \
  'pg_dump --format=custom --no-owner --no-acl \
     --file=clarituz-$(date +%Y%m%d-%H%M).dump "$DATABASE_URL"'
```

Sem `bash -c`, o `$DATABASE_URL` expande no shell local (vazio) e o dump
falha. No PowerShell, prefira a Opção B.

### Opção B — conexão direta via proxy público

Copie a `DATABASE_URL` **pública** do serviço Postgres (dashboard → Postgres
→ aba *Connect* ou *Variables* — é a que aponta para o proxy TCP público,
**não** `postgres.railway.internal`):

```bash
pg_dump --format=custom --no-owner --no-acl \
  --file=clarituz-$(date +%Y%m%d-%H%M).dump \
  "<RAILWAY_DATABASE_URL_PUBLICA>"
# ex.: postgres://postgres:<senha>@<host>.proxy.rlwy.net:<porta>/railway
```

> O proxy público cobra **egress** — num banco grande prefira a Opção A ou o
> backup automático (rede interna, custo zero).

### Verificação do dump (obrigatória — dump sem verificação não é backup)

```bash
pg_restore -l clarituz-20261118-0430.dump | head -20   # lista o TOC
pg_restore -l clarituz-20261118-0430.dump | wc -l      # ~1000+ entradas
ls -l clarituz-*.dump                                # tamanho > 0 e plausível
```

`pg_restore -l` falhando (`input file does not appear to be a valid
archive`) = dump corrompido ou ainda é o `.gz` — descompacte antes
(`gunzip -k arquivo.dump.gz`). **Testado**: `pg_restore` não lê `.dump.gz`
diretamente — o gzip é externo ao formato custom.

### Armazenamento

- **Nunca** commitar dumps (contêm PII + segredos cifrados — LGPD, ver
  `server/docs/conformidade-legal.md`).
- Destino recomendado: bucket externo (S3/GCS) com criptografia em repouso,
  versionamento e retenção ≥ 30 dias; ou o MinIO interno (mesmo padrão da
  MAR IA: `backups/pg/<nome>.dump.gz`).
- Upload para o MinIO interno:

```bash
aws s3 cp clarituz-20261118-0430.dump \
  "s3://<MARIA_S3_BUCKET>/backups/pg/manual-clarituz-20261118-0430.dump" \
  --endpoint-url "<MINIO_PUBLIC_ENDPOINT>" \
  --profile minio   # credenciais = MINIO_ROOT_USER / MINIO_ROOT_PASSWORD
```

---

## 4. Restore testado — passo a passo

Executado e validado em **2026-11-18** num PostgreSQL 17.11 limpo com o
schema real (51 migrations aplicadas pelo próprio `clarituz-api migrate`).
Os mesmos comandos valem para staging e para um Postgres novo no Railway.

### 4.1 — Criar o banco de destino (sempre NOVO)

**Local (drill trimestral):**

```bash
# opção docker compose (repo já traz Postgres 17)
cd server && docker compose up -d postgres
psql "postgres://clarituz:clarituz@localhost:5432/postgres" \
  -c "CREATE DATABASE clarituz_restore_test;"

# ou instância local qualquer:
createdb -h localhost -p 5432 -U postgres clarituz_restore_test
```

**Staging (drill com infra real):** o ambiente `staging` do Railway é criado
à mão (ver `.github/STAGING.md`). Dentro dele: **New → Database →
PostgreSQL** — um serviço Postgres **novo**, nunca o de produção. Use a
`DATABASE_URL` **pública** dele nos comandos abaixo.

### 4.2 — Preparar o dump

```bash
# dump da MAR IA vem gzipado — pg_restore NÃO lê .gz:
gunzip -k maria-pg-20261118-040013.dump.gz   # gera .dump
# ou: gzip -dc arquivo.dump.gz > arquivo.dump

# dump manual já está pronto; em ambos os casos confira o TOC:
pg_restore -l arquivo.dump | head -20
```

### 4.3 — Restaurar

```bash
pg_restore --no-owner --no-acl \
  -d "postgres://<user>:<senha>@<host>:<porta>/clarituz_restore_test" \
  arquivo.dump

# banco grande / pressa: paralelize (formato custom aceita -j)
pg_restore --no-owner --no-acl -j 4 -d "<DSN_DESTINO>" arquivo.dump
```

Notas confirmadas no drill:

- **`pg_restore` num banco já populado falha** (`tipo "…" já existe`) —
  para re-restaurar no mesmo banco use `--clean --if-exists` (dropa e
  recria; exit 0 mesmo assim). Testado.
- Erros de FK/constraint **aparecem durante o restore** — o formato custom
  aplica constraints depois dos dados. `pg_restore` saindo limpo já implica
  integridade referencial; as queries da 4.5 são a dupla checagem.
- O dump inclui `_sqlx_migrations` com os checksums originais do sqlx.

### 4.4 — Migrations (a API aplica no boot)

Não há passo manual: `clarituz_infrastructure::migrate` roda no boot antes
de `serve`/`migrate` (`crates/api/src/main.rs`, `persistence/db.rs` →
`sqlx::migrate!`).

```bash
cd server
DATABASE_URL="postgres://<user>:<senha>@<host>:<porta>/clarituz_restore_test" \
JWT_SECRET="<qualquer-segredo-32+-chars>" \
cargo run -p clarituz-api -- migrate
```

**Resultado esperado no restore**: `migrations aplicadas` em ~1s — no-op,
porque o dump já traz `_sqlx_migrations` na versão correta (confirmado no
drill: 51/51 já aplicadas). Se a imagem da API for **mais nova** que o
dump, ela aplica só o delta pendente — comportamento desejado.

### 4.5 — Validação

```sql
-- contagens do núcleo + watermark temporal das reservas
select (select count(*) from cliente)          as clientes,
       (select count(*) from reserva)           as reservas,
       (select max(saidaprevista) from reserva) as ultima_saida,
       (select count(*) from fila_envio where status = 'pendente')
                                                as fila_pendente,
       (select count(*) from fiscal_documento)  as fiscal_docs,
       (select count(*) from integracao_segredo)as segredos,
       (select count(*) from _sqlx_migrations where success)
                                                as migrations_ok;

-- integridade referencial por amostragem — todas devem retornar 0
select 'reserva_sem_cliente' as check_, count(*)
  from reserva r left join cliente c on c.id = r.idcliente
  where c.id is null
union all
select 'reserva_sem_acomodacao', count(*)
  from reserva r left join acomodacao a on a.id = r.idacomodacao
  where a.id is null
union all
select 'fila_sem_reserva', count(*)
  from fila_envio f left join reserva r on r.id = f.idreserva
  where f.idreserva is not null and r.id is null
union all
select 'fiscal_sem_integracao', count(*)
  from fiscal_documento fd left join integracao i
    on i.id = fd.idintegracao where i.id is null
union all
select 'segredo_sem_integracao', count(*)
  from integracao_segredo s left join integracao i
    on i.id = s.idintegracao where i.id is null;
```

E o invariante mais valioso do sistema — anti-overbooking — deve seguir
ativo (espera-se **erro 23P01**, provando que a exclusion constraint
restaurou):

```sql
-- deve FALHAR com: restrição de exclusão "excl_reserva_sem_overlap"
insert into reserva (idacomodacao, idcliente, quantidade_hospedes,
                     entradaprevista, saidaprevista, valordiaria, status)
select idacomodacao, idcliente, 2, entradaprevista + 1,
       saidaprevista + 1, valordiaria, 'p'
from reserva limit 1;
```

### 4.6 — Checklist de aceite do drill

- [ ] `pg_restore -l` lista TOC sem erro
- [ ] `pg_restore` termina sem erros (exit 0)
- [ ] `clarituz-api migrate` é no-op (ou aplica só delta conhecido)
- [ ] Counts batem com a origem (`cliente`, `reserva`, `fiscal_documento`…)
- [ ] `max(saidaprevista)` compatível com a data do dump
- [ ] Amostragem de FK = 0 em todas as linhas
- [ ] `excl_reserva_sem_overlap` rejeita sobreposição (23P01)
- [ ] Sobrando tempo: `GET /readyz` da API apontada para o banco restaurado
- [ ] Registrar o drill (data, duração, dump usado) neste doc ou em issue

### Evidência do último drill

```text
2026-11-18 · PostgreSQL 17.11 (Windows, instância temporária initdb)
origem:  schema via `clarituz-api migrate` (51/51) + dados de teste
         (5 clientes, 3 reservas, 2 fila_envio, 1 integracao+segredo,
         1 fiscal_documento)
dump:    pg_dump -Fc --no-owner --no-acl → pg_restore -l = 1013 TOC entries
restore: pg_restore → banco novo → exit 0, 106 tabelas
migrate: clarituz-api migrate → no-op (51 aplicadas)
checks:  counts idênticos; amostragem FK = 0; overbooking → 23P01 ✓
.gz:     pg_restore recusa .dump.gz direto (esperado) → gunzip primeiro
re-run:  pg_restore em banco populado falha sem --clean (esperado);
         --clean --if-exists → exit 0
```

---

## 5. RPO / RTO declarados

| Métrica | Hoje | Com PITR habilitado |
| --- | --- | --- |
| **RPO** (perda máxima tolerada) | **24 h** — dump diário ~04:00 UTC | ~minutos — WAL arquivado continuamente |
| **RTO** (tempo até operar) | **2 h** — provisionar Postgres novo + pg_restore + repontar + validar | ~1 h — restore sibling já sai pronto |

Cadências:

- **Dump**: diário automático (MAR IA), retenção 14 dumps.
- **Drill de restore**: **trimestral** — executar a seção 4 num banco novo
  e marcar o checklist. Próximo: 2026-02 (jan/mar/…).
- **Revisão deste runbook**: a cada drill ou mudança de infra relevante
  (PITR habilitado, `pg-backup` implementado, novo bounded context).

---

## 6. Resposta a incidente

### Quem decide

- **Decide**: responsável técnico do sistema (dono do repo / admin nível 1).
- **Consultar antes**: dono da pousada quando a decisão implica **perder
  dados do gap** (ex.: restaurar dump de ontem = perder as reservas de hoje)
  ou janela de indisponibilidade.
- Critérios típicos para restaurar: corrupção confirmada, deleção acidental
  irreversível por outra via, migration destrutiva, comprometimento do
  banco. **Antes de restaurar, esgotar alternativas cirúrgicas** (tabela
  única do dump via `pg_restore -t reserva` num banco auxiliar + `INSERT …
  SELECT` de volta — não precisa de DR completo).

### Linha do tempo do restore em incidente

```text
T+0    incidente detectado (alerta Grafana / operação / deploy ruim)
T+10   congelar escrita: escalar api/realtime/maria para 0 réplicas
       (dashboard → service → replicas 0) — ninguém grava enquanto restaura
T+15   escolher o ponto de recuperação:
         PITR (minutos atrás) > volume backup (diário) > dump (diário)
T+20   restaurar em serviço Postgres NOVO (seção 4 — nunca in-place manual)
T+50   validar (4.5/4.6) + pós-restore (checklist abaixo)
T+70   repontar DATABASE_URL dos serviços para o novo Postgres
       (abaixo), subir réplicas, smoke test (login, /readyz, uma reserva)
T+90   comunicar: o que voltou, o que se perdeu no gap, o que refazer
```

**Repontar sem editar variáveis**: as `DATABASE_URL` dos serviços usam o
host privado `postgres.railway.internal` (ver `server/.env.example`). Se o
novo serviço se chamar `Postgres` e receber `privateNetworkEndpoint:
"postgres"` — como o atual em `.railway/railway.ts` — basta renomear/
aposentar o antigo e o DNS interno resolve para o novo **sem tocar nas
envs**. Caminho: desligar o Postgres antigo → criar `Postgres` novo com
mesmo endpoint privado → subir réplicas. (Alternativa explícita: editar
`DATABASE_URL` em `api-server-rust`, `motor-realtime-erlang`,
`inteligencia-artificial`, `DATA_SOURCE_NAME` do `pg-exporter` e vars
`PG*`/`BACKUP_DATABASE_URL` do backup.)

### Comunicação

- **Recepção/equipe** (imediato): "sistema fora do ar / retomando a partir
  de <hora do backup>; lancem tudo em papel até o retorno". Recepcionista
  precisa saber **até quando os dados voltam** para redigitar o gap.
- **Pós-restore**: resumo do gap temporal (tudo entre o backup e o
  incidente se perdeu — reservas criadas, check-ins, consumos lançados) e
  plano de re-digitação assistida (a recepção tem FNRH papel + comprovantes).
- **Post-mortem**: abrir issue com causa-raiz, gap real, tempo de
  restauração vs. RTO, e ação preventiva. Incidente com PII → avaliar
  notificação LGPD (`lgpd_incidente` + `server/docs/conformidade-legal.md`).

### Checklist pós-restore (ordem importa — antes de subir as réplicas)

- [ ] **`fila_envio` pendente**: o worker drena a cada 30s — tudo com
      `status IN ('pendente','enviando')` **dispara na subida**. Auditar:
      `select id, canal, destino, template, agendado_para from fila_envio
      where status in ('pendente','enviando') order by agendado_para;`
      Cancelar o que já saiu por outro canal ou ficou obsoleto:
      `update fila_envio set status='cancelado' where id = any('{…}');`
- [ ] **`fiscal_documento`** em `enfileirada`/`processando`: worker fiscal
      retoma sozinho e o `integration_id` deduplica na Spedy — seguro, mas
      conferir `proxima_tentativa` e `ultimo_erro` dos pendentes.
- [ ] **`distribuicao_outbox` / `distribuicao_pendencia`**: worker de
      distribuição reenvia ARI à Channex; revisar pendências abertas.
- [ ] **Webhooks**: endpoints nos provedores apontam `PUBLIC_API_URL` —
      inalterada pelo restore. Inboxes (`pagamento_webhook_evento`,
      `fiscal_evento`, `verificacao_evento`) deduplicam reenvios —
      provedores podem re-entregar sem efeito colateral. Smoke: forçar um
      evento de teste no Stripe/Resend e ver o 2xx.
- [ ] **`sessao_refresh`**: sessões antigas seguem válidas. Se o incidente
      foi **segurança** (banco vazado/comprometido), revogar tudo:
      `update sessao_refresh set revogado_em = now() where revogado_em is null;`
- [ ] **`integracao_segredo`**: só decifra com a `INTEGRACOES_MASTER_KEY`
      original da env. Sem ela (ou se foi trocada): re-salvar cada
      credencial em Configurações → Integrações.
- [ ] **Smoke funcional**: login admin, `GET /readyz`, dashboard carrega,
      disponibilidade da semana exibe, um check-in de teste em staging de
      dados.
- [ ] **Backups no novo serviço**: recriar agendamento de volume backup /
      PITR no Postgres novo — eles **não** migram junto com o nome.

---

## 7. Automação pendente

### 7.1 — Workflow GitHub Actions (dump diário → externo)

**Status: documentado, NÃO commitado de propósito.** Motivos:

1. O CI não tem hoje nenhum secret de banco — o único secret usado é
   `OPENAI_API_KEY` (opcional, com skip gracioso em `maria.yml`). O
   `RAILWAY_TOKEN` mora nas credenciais do Jenkins, não no GitHub. Um
   workflow agendado sem `secrets.DATABASE_URL_BACKUP` falharia todo dia.
2. Dump diário **já existe** (MAR IA → MinIO). O valor real do workflow é
   a **cópia fora do Railway** — o que exige decidir onde vivem credenciais
   de produção + um bucket externo. Decisão de segurança, não de código.
3. Colocar a `DATABASE_URL` de produção no GitHub Actions abre mais uma
   superfície de acesso — precisa ser escolha consciente.

**Para ativar** (30 min): criar os secrets
`DATABASE_URL_BACKUP` (DSN do Postgres via proxy público),
`BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_ACCESS_KEY`,
`BACKUP_S3_SECRET_KEY` (MinIO interno ou S3/GCS externo) e commitar
`.github/workflows/backup.yml` com o conteúdo abaixo:

```yaml
name: backup

on:
  schedule:
    - cron: "0 7 * * *"   # 07:00 UTC — depois da janela 04:00 da MAR IA
  workflow_dispatch:       # backup manual sob demanda

jobs:
  pg-dump:
    runs-on: ubuntu-latest
    env:
      DATABASE_URL: ${{ secrets.DATABASE_URL_BACKUP }}
      AWS_ACCESS_KEY_ID: ${{ secrets.BACKUP_S3_ACCESS_KEY }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.BACKUP_S3_SECRET_KEY }}
      S3_DEST: s3://${{ secrets.BACKUP_S3_BUCKET }}/backups/pg
      S3_ENDPOINT: ${{ secrets.BACKUP_S3_ENDPOINT }}   # vazio = AWS nativo
    steps:
      - uses: actions/checkout@v4
      - name: pg client 18 (>= versão do servidor)
        run: |
          sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
          curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg
          sudo apt-get update -qq && sudo apt-get install -y -qq postgresql-client-18 awscli
      - name: gate — secrets configurados?
        run: |
          if [ -z "$DATABASE_URL" ]; then
            echo "::error::DATABASE_URL_BACKUP ausente — configure os secrets (ver docs/dr-backup.md §7)"
            exit 1
          fi
      - name: pg_dump -Fc
        run: |
          D=gha-pg-$(date -u +%Y%m%d-%H%M%S).dump
          pg_dump --format=custom --no-owner --no-acl -f "$D" "$DATABASE_URL"
          pg_restore -l "$D" | wc -l          # TOC íntegro = backup válido
          echo "DUMP=$D" >> "$GITHUB_ENV"
      - name: upload S3
        run: |
          EXTRA=""; [ -n "$S3_ENDPOINT" ] && EXTRA="--endpoint-url $S3_ENDPOINT"
          aws s3 cp "$DUMP" "$S3_DEST/$DUMP" $EXTRA
      - uses: actions/upload-artifact@v4      # cópia de conveniência (30d)
        with:
          name: ${{ env.DUMP }}
          path: ${{ env.DUMP }}
          retention-days: 30
          if-no-files-found: error
```

> **Atenção**: artifact de dump contém PII — só use o upload-artifact se o
> repo for **privado**. Público: remova o step e confie só no S3.

### 7.2 — Alternativa in-house: implementar `ops/pg-backup`

O serviço `pg-backup` **já está declarado** em `.railway/railway.ts` (env
fia `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` do `Postgres` +
`S3_ACCESS_KEY/SECRET_KEY` do MinIO) e o `Jenkinsfile` já tem o stage —
falta só `ops/pg-backup/` (imagem mínima: `postgresql-client` + `aws-cli` +
cron/script que repete o pipeline do `pg_backup.py`: dump `-Fc` → gzip →
`backups/pg/` → poda). Vantagem sobre o GHA: roda **na rede interna** (sem
egress, sem secret no GitHub) e replica o padrão já provado da MAR IA.

### 7.3 — L4: cópia externa

Com ou sem 7.1/7.2: sincronizar `s3://<bucket>/backups/pg/` para um bucket
**fora do Railway** (cron semanal `aws s3 sync`, ou lifecycle do GHA acima
apontando para S3/GCS externo). É o que transforma "perdemos a conta
Railway" de catástrofe em incômodo.

---

## Anexo — fontes e referências

| Item | Onde |
| --- | --- |
| Backup diário implementado | `server/maria/app/infra/pg_backup.py` (envs em `server/maria/.env.example`) |
| Serviço `pg-backup` declarado | `.railway/railway.ts` (grupo Ops) · stage no `Jenkinsfile` |
| Migrations no boot | `server/crates/api/src/main.rs` → `infrastructure/persistence/db.rs` |
| Ambiente staging | `.github/STAGING.md` |
| LGPD / dados pessoais | `server/docs/conformidade-legal.md` |
| Railway — volume backups | docs.railway.com/volumes/backups (Daily 6d / Weekly 1m / Monthly 3m; Pro) |
| Railway — PITR | docs.railway.com/volumes/point-in-time-recovery (~4 semanas; Pro) |
