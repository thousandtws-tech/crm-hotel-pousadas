-- Operadoras & consolidadoras (B2B): parceiros que vendem a tarifa net.
CREATE TABLE IF NOT EXISTS operadora (
    id             bigserial PRIMARY KEY,
    nome           text NOT NULL,
    contato        text,
    email          text,
    telefone       text,
    comissao_pct   numeric(5,2) NOT NULL DEFAULT 0 CHECK (comissao_pct >= 0 AND comissao_pct <= 100),
    token_extranet text NOT NULL UNIQUE,
    ativa          boolean NOT NULL DEFAULT true,
    notas          text,
    criado_em      timestamptz NOT NULL DEFAULT now(),
    atualizado_em  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reserva
    ADD COLUMN IF NOT EXISTS idoperadora bigint REFERENCES operadora(id);
CREATE INDEX IF NOT EXISTS reserva_idoperadora_idx
    ON reserva(idoperadora) WHERE idoperadora IS NOT NULL;
