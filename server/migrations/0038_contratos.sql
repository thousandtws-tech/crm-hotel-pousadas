-- Contratos corporativos: empresa com código público e desconto negociado.
-- O hóspede digita o código no motor → a diária exibida e cobrada já sai
-- com o desconto do contrato vigente.
CREATE TABLE IF NOT EXISTS contrato_corporativo (
    id            bigserial PRIMARY KEY,
    empresa       text NOT NULL,
    codigo        text NOT NULL UNIQUE,
    desconto_pct  numeric(5,2) NOT NULL DEFAULT 0 CHECK (desconto_pct >= 0 AND desconto_pct <= 100),
    vigente_de    date NOT NULL,
    vigente_ate   date NOT NULL,
    contato       text,
    email         text,
    ativo         boolean NOT NULL DEFAULT true,
    notas         text,
    criado_em     timestamptz NOT NULL DEFAULT now(),
    atualizado_em timestamptz NOT NULL DEFAULT now(),
    CHECK (vigente_ate >= vigente_de)
);

ALTER TABLE reserva
    ADD COLUMN IF NOT EXISTS idcontrato bigint REFERENCES contrato_corporativo(id);
CREATE INDEX IF NOT EXISTS reserva_idcontrato_idx
    ON reserva(idcontrato) WHERE idcontrato IS NOT NULL;
