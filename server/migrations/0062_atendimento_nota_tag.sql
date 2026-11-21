-- Notas internas e etiquetas no protocolo de atendimento.
-- Nota = contexto interno entre turnos (nunca vai ao hóspede);
-- tag = classificação livre (reclamação, elogio, upsell…).

ALTER TABLE atendimento
    ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS atendimento_nota (
    id            bigserial PRIMARY KEY,
    idatendimento bigint      NOT NULL REFERENCES atendimento (id) ON DELETE CASCADE,
    idfuncionario bigint      REFERENCES funcionario (id) ON DELETE SET NULL,
    texto         text        NOT NULL,
    criado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_atend_nota_atend
    ON atendimento_nota (idatendimento, criado_em);
