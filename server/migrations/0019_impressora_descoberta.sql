-- Impressoras detectadas automaticamente na rede local / USB pelo agente
-- de impressão. Caem numa caixa de entrada; o admin confirma (vira
-- `impressora` registrada) ou ignora.
CREATE TABLE impressora_descoberta (
    id            BIGSERIAL    PRIMARY KEY,
    tipo          TEXT         NOT NULL CHECK (tipo IN ('rede', 'usb')),
    -- rede: endereço IP; usb: nome da fila no SO
    endereco      TEXT         NOT NULL,
    porta         INTEGER,
    modelo        TEXT,
    detalhes      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    -- hostname do agente que reportou
    origem        TEXT         NOT NULL DEFAULT 'agente',
    status        TEXT         NOT NULL DEFAULT 'pendente'
                  CHECK (status IN ('pendente', 'registrada', 'ignorada')),
    impressora_id BIGINT       REFERENCES impressora (id) ON DELETE SET NULL,
    visto_em      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    resolvido_em  TIMESTAMPTZ,
    criado_em     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- mesmo dispositivo re-reportado → atualiza visto_em/modelo, não duplica
CREATE UNIQUE INDEX uq_impressora_descoberta
    ON impressora_descoberta (tipo, endereco, COALESCE(porta, 0));
CREATE INDEX ix_impressora_descoberta_pendente
    ON impressora_descoberta (visto_em DESC) WHERE status = 'pendente';

CREATE TRIGGER trg_delta_impressora_descoberta
AFTER INSERT OR UPDATE OR DELETE ON impressora_descoberta
FOR EACH ROW EXECUTE FUNCTION notify_delta();
