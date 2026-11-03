-- ============================================================================
-- 0016 — Café da Manhã
-- Registro de presença por reserva/dia: quem sentou para comer hoje.
-- Uma linha por (reserva, dia) — quantidade permite presença parcial
-- (2 de 3 hóspedes). trigger trg_delta → quadro realtime sem polling.
-- ============================================================================

CREATE TABLE cafe_presenca (
    id             BIGSERIAL PRIMARY KEY,
    idreserva      BIGINT      NOT NULL REFERENCES reserva (id) ON DELETE CASCADE,
    data           DATE        NOT NULL,
    quantidade     INTEGER     NOT NULL CHECK (quantidade > 0),
    registrado_por BIGINT      REFERENCES funcionario (id),
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
    version        BIGINT      NOT NULL DEFAULT 0,
    UNIQUE (idreserva, data)
);
CREATE INDEX idx_cafe_presenca_data    ON cafe_presenca (data);
CREATE INDEX idx_cafe_presenca_reserva ON cafe_presenca (idreserva);

CREATE TRIGGER trg_cafe_presenca_version
    BEFORE UPDATE ON cafe_presenca
    FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_delta_cafe_presenca
    AFTER INSERT OR UPDATE OR DELETE ON cafe_presenca
    FOR EACH ROW EXECUTE FUNCTION notify_delta();
