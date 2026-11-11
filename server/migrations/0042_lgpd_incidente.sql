-- Registro de incidentes de segurança — LGPD 13.709/18, art. 48.
--
-- Incidente que possa acarretar risco ou dano relevante aos titulares
-- deve ser comunicado à ANPD e ao titular. Esta tabela é a trilha
-- documental do incidente e das comunicações efetuadas.
CREATE TABLE IF NOT EXISTS lgpd_incidente (
    id                      BIGSERIAL PRIMARY KEY,
    descricao               TEXT NOT NULL,
    -- classes de dados afetados (ex.: 'contato,documento,financeiro')
    tipos_dados             TEXT,
    titulares_estimados     INT,
    risco                   TEXT NOT NULL DEFAULT 'medio'
                            CHECK (risco IN ('baixo','medio','alto')),
    -- medidas corretivas/mitigadoras adotadas
    medidas                 TEXT,
    status                  TEXT NOT NULL DEFAULT 'aberto'
                            CHECK (status IN ('aberto','em_tratamento','encerrado')),
    comunicado_anpd_em      TIMESTAMPTZ,
    comunicado_titulares_em TIMESTAMPTZ,
    criado_por              BIGINT REFERENCES funcionario (id),
    criado_em               TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_lgpd_incidente_status
    ON lgpd_incidente (status, criado_em DESC);
