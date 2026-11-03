-- ---------------------------------------------------------------------------
-- 0013 — controle de caixa: turnos por operador, sangrias, suprimentos e
-- conferência automática com identificação de quebra.
--
-- O turno amarra uma `conta_financeira` (tipo 'caixa' = gaveta física) a um
-- operador. O valor esperado no fechamento é derivado 100% do ledger:
--   saldo_inicial + suprimentos − sangrias
--   + baixas a receber na conta − baixas a pagar na conta
--   + consumos concluídos pagos em espécie durante o turno.
-- `especie` marca quais formas de pagamento movimentam dinheiro vivo.
-- ---------------------------------------------------------------------------

-- formas de pagamento que movimentam dinheiro vivo (caixa físico)
ALTER TABLE forma_pagamento ADD COLUMN especie BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE forma_pagamento SET especie = TRUE WHERE nome ILIKE 'dinheiro%';

CREATE TYPE caixa_turno_status AS ENUM ('aberto', 'fechado');
CREATE TYPE caixa_mov_tipo AS ENUM ('sangria', 'suprimento');

-- ---------------------------------------------------------------------------
-- turno de caixa — um aberto por conta (a gaveta não pode abrir duas vezes)
-- ---------------------------------------------------------------------------
CREATE TABLE caixa_turno (
    id                  BIGSERIAL PRIMARY KEY,
    idconta_financeira  BIGINT NOT NULL REFERENCES conta_financeira (id),
    idoperador          BIGINT NOT NULL REFERENCES funcionario (id),
    saldo_inicial       NUMERIC(12,2) NOT NULL CHECK (saldo_inicial >= 0),
    aberto_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    fechado_em          TIMESTAMPTZ,
    valor_contado       NUMERIC(12,2) CHECK (valor_contado >= 0),
    valor_esperado      NUMERIC(12,2),
    quebra              NUMERIC(12,2),
    status              caixa_turno_status NOT NULL DEFAULT 'aberto',
    observacao          TEXT,
    fechado_por         BIGINT REFERENCES funcionario (id),
    version             BIGINT NOT NULL DEFAULT 0,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- a gaveta só admite um turno aberto por vez (índice parcial)
CREATE UNIQUE INDEX caixa_turno_unico_aberto
    ON caixa_turno (idconta_financeira) WHERE status = 'aberto';
CREATE INDEX idx_caixa_turno_operador  ON caixa_turno (idoperador);
CREATE INDEX idx_caixa_turno_aberto_em ON caixa_turno (aberto_em);
CREATE INDEX idx_caixa_turno_status    ON caixa_turno (status);

CREATE TRIGGER trg_caixa_turno_version
    BEFORE UPDATE ON caixa_turno
    FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_delta_caixa_turno
    AFTER INSERT OR UPDATE OR DELETE ON caixa_turno
    FOR EACH ROW EXECUTE FUNCTION notify_delta();

-- ---------------------------------------------------------------------------
-- movimentos avulsos do turno — sangria (retira dinheiro) / suprimento (troco)
-- ---------------------------------------------------------------------------
CREATE TABLE caixa_movimento (
    id            BIGSERIAL PRIMARY KEY,
    idturno       BIGINT NOT NULL REFERENCES caixa_turno (id) ON DELETE CASCADE,
    tipo          caixa_mov_tipo NOT NULL,
    valor         NUMERIC(12,2) NOT NULL CHECK (valor > 0),
    motivo        TEXT NOT NULL,
    idfuncionario BIGINT NOT NULL REFERENCES funcionario (id),
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_caixa_mov_turno ON caixa_movimento (idturno);
