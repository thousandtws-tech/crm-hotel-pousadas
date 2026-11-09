-- ============================================================================
-- Operação: manutenção/PMOC, governança/housekeeping, escalas e CLT.
--
-- manutencao_ordem     — ordens de serviço com prioridade, custo e materiais.
-- pmoc_registro        — checklist PMOC (Lei 13.589/2018) assinado por
--                        responsável técnico (CREA/ART); imutável após salvo.
-- governanca_tarefa    — tarefa de limpeza por quarto/dia; gerada pelo cron
--                        D-1 ou manual; dedup por (idquarto,data,tipo).
-- lavanderia_lote      — enxoval rastreável por lote/fornecedor/custo, com
--                        competência p/ fechamento mensal e conta a pagar.
-- enxoval_mov          — movimentação de peças de enxoval (origem→destino).
-- funcionario_jornada  — regime de escala (5x1, 6x1, 12x36) + horários-base.
-- escala_turno         — turno efetivo gerado/atribuído por dia (fonte do
--                        validador CLT e do staffing de governança).
-- funcionario.setor    — setor operacional p/ staffing ratios e filtros.
-- ============================================================================

CREATE TYPE prioridade_manut AS ENUM ('baixa', 'media', 'alta', 'urgente');
CREATE TYPE status_manut AS ENUM ('aberta', 'em_execucao', 'aguardando_peca', 'concluida', 'cancelada');
CREATE TYPE tipo_tarefa_gov AS ENUM ('checkout', 'stayover', 'semanal', 'area_comum', 'extra');
CREATE TYPE status_tarefa_gov AS ENUM ('pendente', 'em_andamento', 'concluida', 'cancelada');
CREATE TYPE status_lote_lav AS ENUM ('enviado', 'devolvido_parcial', 'devolvido', 'fechado');
CREATE TYPE regime_escala AS ENUM ('5x1', '6x1', '12x36');
CREATE TYPE origem_turno AS ENUM ('jornada', 'manual', 'clt_fix');

-- manutenção ------------------------------------------------------------------

CREATE TABLE manutencao_ordem (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idquarto      BIGINT       REFERENCES quarto (id) ON DELETE SET NULL,
    local         TEXT         NOT NULL,               -- quarto ou área livre
    titulo        TEXT         NOT NULL,
    descricao     TEXT         NOT NULL DEFAULT '',
    prioridade    prioridade_manut NOT NULL DEFAULT 'media',
    status        status_manut     NOT NULL DEFAULT 'aberta',
    custo_centavos BIGINT      NOT NULL DEFAULT 0,
    materiais     JSONB        NOT NULL DEFAULT '[]',  -- [{item, quantidade}]
    responsavel   TEXT,
    idfuncionario BIGINT       REFERENCES funcionario (id) ON DELETE SET NULL,
    criado_por    BIGINT       REFERENCES funcionario (id) ON DELETE SET NULL,
    aberta_em     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    concluida_em  TIMESTAMPTZ,
    version       INT          NOT NULL DEFAULT 0
);
CREATE INDEX idx_manut_abertas ON manutencao_ordem (status, prioridade) WHERE status IN ('aberta','em_execucao','aguardando_peca');
COMMENT ON COLUMN manutencao_ordem.idquarto IS 'NULL = área comum; quarto vinculado pode ser bloqueado manualmente via quarto.ativo.';

-- PMOC — Lei 13.589/2018 (climatização) ---------------------------------------

CREATE TABLE pmoc_registro (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    referente_a     DATE         NOT NULL,            -- competência da auditoria
    itens           JSONB        NOT NULL,            -- [{item, conforme, obs}] — 10 itens
    conformes       SMALLINT     NOT NULL,            -- 0..10 (cache p/ dashboard)
    responsavel_nome TEXT        NOT NULL,
    responsavel_crea TEXT        NOT NULL,            -- CREA do responsável técnico
    responsavel_art  TEXT        NOT NULL,            -- ART do serviço
    observacoes     TEXT         NOT NULL DEFAULT '',
    proxima_data    DATE,
    criado_por      BIGINT       REFERENCES funcionario (id) ON DELETE SET NULL,
    criado_em       TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- Um registro por competência — auditoria não se reescreve.
CREATE UNIQUE INDEX uq_pmoc_competencia ON pmoc_registro (referente_a);

-- governança / housekeeping ----------------------------------------------------

CREATE TABLE governanca_tarefa (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idquarto      BIGINT       REFERENCES quarto (id) ON DELETE CASCADE,
    data          DATE         NOT NULL,
    tipo          tipo_tarefa_gov   NOT NULL,
    status        status_tarefa_gov NOT NULL DEFAULT 'pendente',
    estimado_min  SMALLINT     NOT NULL DEFAULT 45,
    idfuncionario BIGINT       REFERENCES funcionario (id) ON DELETE SET NULL,
    origem        TEXT         NOT NULL DEFAULT 'manual',  -- 'd1' = cron véspera
    observacao    TEXT         NOT NULL DEFAULT '',
    concluida_em  TIMESTAMPTZ,
    criado_em     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    version       INT          NOT NULL DEFAULT 0
);
-- D-1 idempotente: mesmo quarto/data/tipo nunca duplica.
CREATE UNIQUE INDEX uq_gov_tarefa ON governanca_tarefa (idquarto, data, tipo)
    WHERE idquarto IS NOT NULL;
CREATE INDEX idx_gov_dia ON governanca_tarefa (data, status);
COMMENT ON COLUMN governanca_tarefa.estimado_min IS 'Base da previsão: checkout=60, stayover=30, semanal=45 por padrão.';

CREATE TABLE lavanderia_lote (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fornecedor    TEXT         NOT NULL,
    competencia   DATE         NOT NULL,             -- 1º do mês p/ fechamento
    enviado_em    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    devolvido_em  TIMESTAMPTZ,
    qtd_itens     INT          NOT NULL,
    qtd_devolvida INT          NOT NULL DEFAULT 0,
    custo_centavos BIGINT      NOT NULL DEFAULT 0,
    status        status_lote_lav NOT NULL DEFAULT 'enviado',
    idlancamento  BIGINT       REFERENCES lancamento (id) ON DELETE SET NULL,
    observacao    TEXT         NOT NULL DEFAULT ''
);
CREATE INDEX idx_lav_competencia ON lavanderia_lote (competencia, status);

CREATE TABLE enxoval_mov (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tipo_item   TEXT         NOT NULL,               -- 'lençol casal', 'toalha banho'…
    quantidade  INT          NOT NULL CHECK (quantidade > 0),
    origem      TEXT         NOT NULL,               -- 'estoque','quarto','lavanderia','descarte'
    destino     TEXT         NOT NULL,
    idlote      BIGINT       REFERENCES lavanderia_lote (id) ON DELETE SET NULL,
    idquarto    BIGINT       REFERENCES quarto (id) ON DELETE SET NULL,
    data        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    registrado_por BIGINT    REFERENCES funcionario (id) ON DELETE SET NULL
);
CREATE INDEX idx_enxoval_item ON enxoval_mov (tipo_item, data);

-- escalas & jornada ------------------------------------------------------------

ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS setor TEXT NOT NULL DEFAULT 'recepcao';
COMMENT ON COLUMN funcionario.setor IS 'recepcao | governanca | cozinha | manutencao | administrativo — base do staffing.';

CREATE TABLE funcionario_jornada (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idfuncionario BIGINT       NOT NULL UNIQUE REFERENCES funcionario (id) ON DELETE CASCADE,
    regime        regime_escala NOT NULL,
    entrada       TIME         NOT NULL,             -- horário-base do turno
    saida         TIME         NOT NULL,
    almoco_min    SMALLINT     NOT NULL DEFAULT 60,  -- intervalo intrajornada
    ancora        DATE         NOT NULL,             -- 1º dia trabalhado do ciclo
    ativo         BOOLEAN      NOT NULL DEFAULT true
);
COMMENT ON COLUMN funcionario_jornada.ancora IS 'Dia 1 trabalhado do ciclo (5x1/6x1/12x36) — a escala deriva dele.';

CREATE TABLE escala_turno (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idfuncionario BIGINT       NOT NULL REFERENCES funcionario (id) ON DELETE CASCADE,
    data          DATE         NOT NULL,
    inicio        TIMESTAMPTZ  NOT NULL,
    fim           TIMESTAMPTZ  NOT NULL,
    almoco_min    SMALLINT     NOT NULL DEFAULT 60,
    origem        origem_turno NOT NULL DEFAULT 'jornada',
    version       INT          NOT NULL DEFAULT 0,
    UNIQUE (idfuncionario, data)
);
CREATE INDEX idx_turno_data ON escala_turno (data, idfuncionario);
COMMENT ON TABLE escala_turno IS 'Turno efetivo por dia — o validador CLT e o staffing de governança leem daqui.';

-- version + realtime -----------------------------------------------------------

CREATE TRIGGER trg_manut_version BEFORE UPDATE ON manutencao_ordem
    FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_delta_manut AFTER INSERT OR UPDATE OR DELETE ON manutencao_ordem
    FOR EACH ROW EXECUTE FUNCTION notify_delta();
CREATE TRIGGER trg_gov_version BEFORE UPDATE ON governanca_tarefa
    FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_delta_gov AFTER INSERT OR UPDATE OR DELETE ON governanca_tarefa
    FOR EACH ROW EXECUTE FUNCTION notify_delta();
CREATE TRIGGER trg_turno_version BEFORE UPDATE ON escala_turno
    FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_delta_turno AFTER INSERT OR UPDATE OR DELETE ON escala_turno
    FOR EACH ROW EXECUTE FUNCTION notify_delta();
