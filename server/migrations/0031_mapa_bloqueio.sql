-- Mapa por andar + bloqueio formal de acomodação.
-- `andar` agrupa quartos por pavimento; `bloqueio` tira a unidade de
-- qualquer disponibilidade (motor, recepção, pré-reserva) no período.

ALTER TABLE acomodacao ADD COLUMN IF NOT EXISTS andar INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS bloqueio (
    id           BIGSERIAL PRIMARY KEY,
    idacomodacao BIGINT NOT NULL REFERENCES acomodacao (id) ON DELETE CASCADE,
    inicio       DATE NOT NULL,
    fim          DATE NOT NULL,
    motivo       TEXT NOT NULL,
    criado_por   BIGINT REFERENCES funcionario (id) ON DELETE SET NULL,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (fim >= inicio)
);
CREATE INDEX IF NOT EXISTS bloqueio_periodo_idx ON bloqueio (idacomodacao, inicio, fim);
