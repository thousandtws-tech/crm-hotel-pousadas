-- Channex — gerenciador de canais (PMS → Channex → OTAs).
--
-- 1) Correção de semântica: `reserva.periodo` passa a representar as NOITES
--    ocupadas [entrada, saída) — o dia do checkout não é noite vendida. Antes
--    o range era [entrada, saída+1), bloqueando uma noite-fantasma de giro.
--    A coluna é GENERATED STORED: o ALTER recalcula todas as linhas sem
--    tocar nas datas. Giro/limpeza continua sendo bloqueio explícito.
-- 2) Tabelas da distribuição: mapeamento, revisões recebidas, vínculo de
--    reservas externas, outbox ARI, envios e pendências operacionais.
BEGIN;

ALTER TABLE reserva DROP COLUMN periodo;
ALTER TABLE reserva ADD COLUMN periodo DATERANGE GENERATED ALWAYS AS
    (daterange(entradaprevista, saidaprevista, '[)')) STORED;
CREATE INDEX idx_reserva_periodo ON reserva USING gist (periodo);

-- Mapeamento versionado acomodação → Room Type + Rate Plan da Channex.
CREATE TABLE distribuicao_mapa (
    id             BIGSERIAL   PRIMARY KEY,
    idintegracao   BIGINT      NOT NULL REFERENCES integracao (id),
    idacomodacao   BIGINT      NOT NULL REFERENCES acomodacao (id),
    room_type_id   TEXT        NOT NULL,
    rate_plan_id   TEXT        NOT NULL,
    ativo          BOOLEAN     NOT NULL DEFAULT true,
    versao         INTEGER     NOT NULL DEFAULT 1,
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (idintegracao, idacomodacao)
);

-- Revisões de booking recebidas — deduplicada por revision_id; o payload
-- completo é gravado ANTES do ACK (a Channex remove PII após o ACK).
CREATE TABLE distribuicao_revisao (
    id                   BIGSERIAL   PRIMARY KEY,
    idintegracao         BIGINT      NOT NULL REFERENCES integracao (id),
    revision_id          TEXT        NOT NULL,
    booking_id           TEXT,
    unique_id            TEXT,
    ota_name             TEXT,
    ota_reservation_code TEXT,
    status               TEXT        NOT NULL,
    property_id          TEXT        NOT NULL,
    payload              JSONB       NOT NULL,
    ack                  BOOLEAN     NOT NULL DEFAULT false,
    ack_em               TIMESTAMPTZ,
    aplicada             BOOLEAN     NOT NULL DEFAULT false,
    erro                 TEXT,
    inserted_at          TIMESTAMPTZ,
    recebido_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (idintegracao, revision_id)
);
CREATE INDEX idx_dist_revisao_booking ON distribuicao_revisao (booking_id);
CREATE INDEX idx_dist_revisao_pendente ON distribuicao_revisao (idintegracao, ack, aplicada);

-- Vínculo estável reserva local ↔ booking OTA (um booking pode ter
-- várias acomodações → várias reservas locais, uma por item).
CREATE TABLE distribuicao_reserva (
    id                   BIGSERIAL   PRIMARY KEY,
    idintegracao         BIGINT      NOT NULL REFERENCES integracao (id),
    idreserva            BIGINT      NOT NULL REFERENCES reserva (id),
    booking_id           TEXT        NOT NULL,
    ota_name             TEXT,
    ota_reservation_code TEXT,
    -- preço por noite, moeda, payment_collect/type — verdade da OTA,
    -- nunca recalculada pela diária atual do CRM.
    dados                JSONB       NOT NULL DEFAULT '{}',
    criado_em            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (idintegracao, booking_id, idreserva)
);

-- Outbox ARI — gravado NA MESMA TRANSAÇÃO da alteração de estoque/tarifa.
-- O worker coalesce por (acomodacao) e reenvia o estado atual recalculado.
CREATE TABLE distribuicao_outbox (
    id            BIGSERIAL   PRIMARY KEY,
    idintegracao  BIGINT      NOT NULL REFERENCES integracao (id),
    idacomodacao  BIGINT      NOT NULL REFERENCES acomodacao (id),
    inicio        DATE        NOT NULL,
    fim           DATE        NOT NULL,
    motivo        TEXT        NOT NULL,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dist_outbox_pendente ON distribuicao_outbox (idintegracao, idacomodacao);

-- Auditoria de envios ARI — task IDs da Channex + meta.warnings (aceite
-- parcial) ficam persistidos para rastreabilidade da certificação.
CREATE TABLE distribuicao_envio (
    id            BIGSERIAL   PRIMARY KEY,
    idintegracao  BIGINT      NOT NULL REFERENCES integracao (id),
    tipo          TEXT        NOT NULL,
    valores       JSONB       NOT NULL,
    task_ids      JSONB       NOT NULL DEFAULT '[]',
    warnings      JSONB       NOT NULL DEFAULT '[]',
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pendências operacionais: reserva OTA sem mapeamento/estoque, revisão
-- fora de ordem, falha de envio — nada é descartado silenciosamente.
CREATE TABLE distribuicao_pendencia (
    id            BIGSERIAL   PRIMARY KEY,
    idintegracao  BIGINT      NOT NULL REFERENCES integracao (id),
    tipo          TEXT        NOT NULL,
    descricao     TEXT        NOT NULL,
    revision_id   TEXT,
    dados         JSONB       NOT NULL DEFAULT '{}',
    resolvida     BOOLEAN     NOT NULL DEFAULT false,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolvido_em  TIMESTAMPTZ
);
CREATE INDEX idx_dist_pendencia_aberta ON distribuicao_pendencia (idintegracao, resolvida);

COMMIT;
