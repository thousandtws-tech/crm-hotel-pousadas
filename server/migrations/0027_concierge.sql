-- 0027 — Inná Concierge: dados factuais da pousada no estabelecimento
-- (o concierge responde só com o que estiver cadastrado — nunca inventa)
-- e histórico de mensagens hóspede↔Inná (portal + WhatsApp) para
-- contexto de conversa e auditoria.

ALTER TABLE estabelecimento
    ADD COLUMN IF NOT EXISTS wifi_nome        TEXT,
    ADD COLUMN IF NOT EXISTS wifi_senha       TEXT,
    ADD COLUMN IF NOT EXISTS horario_checkin  TEXT,
    ADD COLUMN IF NOT EXISTS horario_checkout TEXT,
    ADD COLUMN IF NOT EXISTS horario_cafe     TEXT,
    ADD COLUMN IF NOT EXISTS info_servicos    TEXT;

CREATE TABLE inna_mensagem (
    id            BIGSERIAL PRIMARY KEY,
    idreserva     BIGINT      NOT NULL REFERENCES reserva(id),
    canal         TEXT        NOT NULL CHECK (canal IN ('portal', 'whatsapp')),
    origem        TEXT        NOT NULL CHECK (origem IN ('hospede', 'inna')),
    texto         TEXT        NOT NULL,
    provider_id   TEXT,        -- wamid Meta → dedup do webhook
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    version       BIGINT      NOT NULL DEFAULT 0
);

-- dedup inbound: o mesmo wamid nunca processa duas vezes
CREATE UNIQUE INDEX idx_inna_msg_provider ON inna_mensagem (provider_id)
    WHERE provider_id IS NOT NULL;
CREATE INDEX idx_inna_msg_reserva ON inna_mensagem (idreserva, criado_em);

CREATE TRIGGER trg_inna_version BEFORE UPDATE ON inna_mensagem
    FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_delta_inna AFTER INSERT OR UPDATE OR DELETE ON inna_mensagem
    FOR EACH ROW EXECUTE FUNCTION notify_delta();
