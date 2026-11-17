-- 0044 — Integração Z-API (WhatsApp) no módulo de Integrações
-- Estende o catálogo para provedores de comunicação e a fila de envio
-- para transportar identidade do provedor e marcos de entrega/leitura.

-- Z-API entra no catálogo como provedor válido.
ALTER TABLE integracao DROP CONSTRAINT integracao_provedor_check;
ALTER TABLE integracao ADD CONSTRAINT integracao_provedor_check
    CHECK (provedor IN ('stripe', 'pagbank', 'mercadopago', 'zapi'));

-- Categoria agrupa os cards na UI ('pagamento' | 'comunicacao').
ALTER TABLE integracao
    ADD COLUMN categoria TEXT NOT NULL DEFAULT 'pagamento'
        CHECK (categoria IN ('pagamento', 'comunicacao'));

-- Config não-secreta por provedor — Z-API guarda aqui o instance_id
-- (identificador visível, não credencial) e metadados da sessão.
ALTER TABLE integracao
    ADD COLUMN config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Fila: provedor que efetivamente enviou + marcos de entrega/leitura
-- (status='enviado' continua significando "aceito pelo provedor").
ALTER TABLE fila_envio ADD COLUMN provedor      TEXT;
ALTER TABLE fila_envio ADD COLUMN idintegracao  BIGINT
    REFERENCES integracao(idintegracao) ON DELETE SET NULL;
ALTER TABLE fila_envio ADD COLUMN entregue_em   TIMESTAMPTZ;
ALTER TABLE fila_envio ADD COLUMN lido_em       TIMESTAMPTZ;

CREATE INDEX idx_fila_envio_provider ON fila_envio (provedor, provider_msg_id)
    WHERE provider_msg_id IS NOT NULL;

-- Inbox de eventos de comunicação — ACK do webhook só depois desta
-- gravação; dedup por (provedor, event_id) antes de qualquer efeito.
CREATE TABLE comunicacao_evento (
    id             BIGSERIAL PRIMARY KEY,
    provedor       TEXT NOT NULL,
    event_id       TEXT NOT NULL,
    tipo           TEXT NOT NULL,
    payload        JSONB NOT NULL,
    idintegracao   BIGINT REFERENCES integracao(idintegracao) ON DELETE SET NULL,
    status         TEXT NOT NULL DEFAULT 'recebido'
        CHECK (status IN ('recebido', 'processado', 'falhou', 'descartado')),
    tentativas     INT  NOT NULL DEFAULT 0,
    ultimo_erro    TEXT,
    recebido_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
    processado_em  TIMESTAMPTZ,
    UNIQUE (provedor, event_id)
);
CREATE INDEX idx_comunicacao_evento_pendente ON comunicacao_evento (recebido_em)
    WHERE status IN ('recebido', 'falhou');
