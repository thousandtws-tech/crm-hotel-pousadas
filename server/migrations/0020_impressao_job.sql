-- Fila de impressão entregue pelo agente local.
-- A API (em cloud) não alcança a LAN do hotel: toda impressão vira um job
-- com o ESC/POS já renderizado; o agente faz polling e entrega via TCP
-- (impressoras de rede) ou RAW spooler do SO (USB).
CREATE TABLE impressao_job (
    id            BIGSERIAL    PRIMARY KEY,
    impressora_id BIGINT       REFERENCES impressora (id) ON DELETE SET NULL,
    -- ip da impressora de rede ou "usb:<nome da fila>"
    host          TEXT         NOT NULL,
    porta         INTEGER      NOT NULL,
    payload       BYTEA        NOT NULL,
    status        TEXT         NOT NULL DEFAULT 'pendente'
                  CHECK (status IN ('pendente', 'impresso', 'erro')),
    tentativas    INTEGER      NOT NULL DEFAULT 0,
    erro          TEXT,
    criado_em     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    impresso_em   TIMESTAMPTZ
);
CREATE INDEX ix_impressao_job_pendente ON impressao_job (id) WHERE status = 'pendente';

CREATE TRIGGER trg_delta_impressao_job
AFTER INSERT OR UPDATE OR DELETE ON impressao_job
FOR EACH ROW EXECUTE FUNCTION notify_delta();
