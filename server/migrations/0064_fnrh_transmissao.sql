-- Transmissão da FNRH ao SERPRO — painel de status + histórico.
-- A ficha só é transmitida depois de emitida pela recepção
-- (conferência dos dados) — nunca direto do celular do hóspede.

CREATE TABLE IF NOT EXISTS fnrh_transmissao (
    id             bigserial PRIMARY KEY,
    idfnrh         bigint      NOT NULL REFERENCES fnrh (id) ON DELETE CASCADE,
    idreserva      bigint      NOT NULL REFERENCES reserva (id) ON DELETE CASCADE,
    -- 'pendente' | 'transmitida' | 'erro'
    status         text        NOT NULL DEFAULT 'pendente',
    protocolo      text,
    erro           text,
    tentativas     int         NOT NULL DEFAULT 0,
    criado_em      timestamptz NOT NULL DEFAULT now(),
    transmitida_em timestamptz
);

CREATE INDEX IF NOT EXISTS idx_fnrh_tx_reserva
    ON fnrh_transmissao (idreserva, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_fnrh_tx_status
    ON fnrh_transmissao (status, criado_em);
