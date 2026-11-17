-- 0045 — Integração Spedy (Fiscal/NFS-e) no módulo de Integrações
-- Acrescenta o provedor ao catálogo com categoria própria e cria o
-- domínio de documentos fiscais: intenção durável de emissão (outbox),
-- eventos de webhook deduplicados e rastreabilidade por reserva.

ALTER TABLE integracao DROP CONSTRAINT integracao_provedor_check;
ALTER TABLE integracao ADD CONSTRAINT integracao_provedor_check
    CHECK (provedor IN ('stripe', 'pagbank', 'mercadopago', 'zapi', 'spedy'));

ALTER TABLE integracao DROP CONSTRAINT integracao_categoria_check;
ALTER TABLE integracao ADD CONSTRAINT integracao_categoria_check
    CHECK (categoria IN ('pagamento', 'comunicacao', 'fiscal'));

-- Documento fiscal (NFS-e hoje; `modelo` abre espaço para outros).
-- A linha É a intenção durável: criada como 'rascunho', vira 'enfileirada'
-- na confirmação e o worker a transmite. `integration_id` é estável por
-- documento (≤36 chars, contrato Spedy) e reaproveitado nas retentativas.
CREATE TABLE fiscal_documento (
    id                 BIGSERIAL PRIMARY KEY,
    idintegracao       BIGINT NOT NULL REFERENCES integracao (id),
    idreserva          BIGINT REFERENCES reserva (id) ON DELETE SET NULL,
    modelo             TEXT NOT NULL DEFAULT 'nfse' CHECK (modelo IN ('nfse')),
    integration_id     TEXT NOT NULL CHECK (char_length(integration_id) <= 36),
    remote_id          TEXT,
    status             TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN (
        'rascunho', 'enfileirada', 'processando', 'autorizada',
        'rejeitada', 'cancelamento_solicitado', 'cancelada', 'falha')),
    status_remoto      TEXT,          -- status cru do provedor, sempre preservado
    processing_detail  TEXT,          -- detalhe de processamento do provedor
    tomador            JSONB NOT NULL DEFAULT '{}'::jsonb,
    payload            JSONB NOT NULL DEFAULT '{}'::jsonb,  -- snapshot enviado
    valor_total        NUMERIC(12,2) NOT NULL DEFAULT 0,
    descricao          TEXT,
    competencia        DATE,
    motivo_cancelamento TEXT,
    numero_nota        TEXT,
    url_consulta       TEXT,
    ultimo_erro        TEXT,
    tentativas         INT  NOT NULL DEFAULT 0,
    proxima_tentativa  TIMESTAMPTZ,
    criado_por         BIGINT,
    atualizado_por     BIGINT,
    transmitido_em     TIMESTAMPTZ,
    autorizado_em      TIMESTAMPTZ,
    cancelado_em       TIMESTAMPTZ,
    criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (idintegracao, integration_id)
);
-- Um integration_id nunca repete dentro do par (integração) — previne
-- duplicidade mesmo com dois cliques ou dois workers.
CREATE UNIQUE INDEX uq_fiscal_doc_integration
    ON fiscal_documento (idintegracao, integration_id);
CREATE INDEX idx_fiscal_doc_reserva ON fiscal_documento (idreserva)
    WHERE idreserva IS NOT NULL;
CREATE INDEX idx_fiscal_doc_remote ON fiscal_documento (remote_id)
    WHERE remote_id IS NOT NULL;
CREATE INDEX idx_fiscal_doc_fila ON fiscal_documento (proxima_tentativa)
    WHERE status IN ('enfileirada', 'processando');
CREATE INDEX idx_fiscal_doc_status ON fiscal_documento (status, criado_em DESC);

-- Inbox de webhooks — persistido ANTES do 2xx; dedup por evento e
-- assinatura registrada para auditoria.
CREATE TABLE fiscal_evento (
    id             BIGSERIAL PRIMARY KEY,
    idintegracao   BIGINT REFERENCES integracao (id) ON DELETE SET NULL,
    event_id       TEXT NOT NULL,
    tipo           TEXT NOT NULL,
    payload        JSONB NOT NULL,
    assinatura_ok  BOOLEAN NOT NULL DEFAULT false,
    status         TEXT NOT NULL DEFAULT 'recebido'
        CHECK (status IN ('recebido', 'processado', 'falhou', 'descartado', 'duplicado')),
    ultimo_erro    TEXT,
    recebido_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
    processado_em  TIMESTAMPTZ,
    UNIQUE (idintegracao, event_id)
);
CREATE INDEX idx_fiscal_evento_pendente ON fiscal_evento (recebido_em)
    WHERE status IN ('recebido', 'falhou');
