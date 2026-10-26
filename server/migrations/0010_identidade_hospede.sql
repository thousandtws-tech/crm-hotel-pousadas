-- Identidade e documentos do hóspede (padrão PMS: OPERA/Cloudbeds).
--  * `cliente` ganha os campos exigidos pela FNRH (Ficha Nacional de
--    Registro de Hóspedes — modelo oficial MTur): nacionalidade,
--    naturalidade, profissão e endereço completo;
--  * `cliente_documento` guarda múltiplos documentos por hóspede com
--    órgão/país emissor, validade e caminho do scan (binário no storage,
--    mesmo padrão da foto);
--  * `reserva_acompanhante` registra os demais ocupantes da reserva
--    (cônjuge, filhos menores) sem exigir cadastro como cliente;
--  * `fnrh` é o arquivo digital: cada emissão grava um snapshot JSONB
--    imutável da ficha (cliente + reserva + acompanhantes) para auditoria.

ALTER TABLE cliente
    ADD COLUMN nacionalidade TEXT,
    ADD COLUMN naturalidade  TEXT,
    ADD COLUMN profissao     TEXT,
    ADD COLUMN logradouro    TEXT,
    ADD COLUMN numero        TEXT,
    ADD COLUMN complemento   TEXT,
    ADD COLUMN bairro        TEXT,
    ADD COLUMN cep           TEXT,
    ADD COLUMN pais          TEXT;

CREATE TABLE cliente_documento (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idcliente     BIGINT      NOT NULL REFERENCES cliente (id) ON DELETE CASCADE,
    tipo          TEXT        NOT NULL
                  CHECK (tipo IN ('rg', 'cpf', 'cnh', 'passaporte', 'rne', 'outro')),
    numero        TEXT        NOT NULL,
    orgao_emissor TEXT,
    uf_emissor    TEXT,
    pais_emissor  TEXT,
    validade      DATE,
    -- Caminho do scan em storage_dir/documentos/ — NULL até escanear.
    scan          TEXT,
    version       BIGINT      NOT NULL DEFAULT 1,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_clidoc_cliente ON cliente_documento (idcliente);
CREATE TRIGGER trg_clidoc_version BEFORE UPDATE ON cliente_documento
    FOR EACH ROW EXECUTE FUNCTION bump_version();

CREATE TABLE reserva_acompanhante (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idreserva       BIGINT      NOT NULL REFERENCES reserva (id) ON DELETE CASCADE,
    nome            TEXT        NOT NULL,
    data_nascimento DATE,
    parentesco      TEXT,
    doc_tipo        TEXT,
    doc_numero      TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_acomp_reserva ON reserva_acompanhante (idreserva);

CREATE TABLE fnrh (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idreserva     BIGINT      NOT NULL REFERENCES reserva (id) ON DELETE CASCADE,
    idcliente     BIGINT      NOT NULL REFERENCES cliente (id),
    motivo_viagem TEXT,
    placa_veiculo TEXT,
    -- Snapshot completo da ficha no momento da emissão.
    dados         JSONB       NOT NULL,
    emitida_por   BIGINT      REFERENCES funcionario (id),
    emitida_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fnrh_reserva ON fnrh (idreserva);
CREATE INDEX idx_fnrh_cliente ON fnrh (idcliente);
