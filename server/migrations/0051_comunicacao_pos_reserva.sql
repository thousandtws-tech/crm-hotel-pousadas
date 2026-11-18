
ALTER TYPE status_envio ADD VALUE IF NOT EXISTS 'suprimido';
ALTER TYPE status_envio ADD VALUE IF NOT EXISTS 'desconhecido';

ALTER TABLE fila_envio
    ADD COLUMN IF NOT EXISTS dedup_key       TEXT,
    ADD COLUMN IF NOT EXISTS template_versao INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS fila_envio_dedup_uk
    ON fila_envio (dedup_key) WHERE dedup_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fila_envio_reserva_status
    ON fila_envio (idreserva, status) WHERE idreserva IS NOT NULL;

ALTER TABLE cliente
    ADD COLUMN IF NOT EXISTS whatsapp_optin BOOLEAN NOT NULL DEFAULT false;
