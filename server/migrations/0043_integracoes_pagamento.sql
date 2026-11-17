-- ---------------------------------------------------------------------------
-- Integrações de pagamento (Configurações → Integrações).
--
-- Configuração persistida por (provedor, ambiente) com segredos criptografados
-- em envelope AES-256-GCM. `versao` é o optimistic lock e o invalidador de
-- verificações/adapters. A identidade do provedor gravada em `pagamento` é
-- imutável — reembolso e conciliação sempre resolvem por ela.
-- ---------------------------------------------------------------------------

CREATE TABLE integracao (
    id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    provedor               TEXT NOT NULL
                           CHECK (provedor IN ('stripe', 'pagbank', 'mercadopago')),
    ambiente               TEXT NOT NULL CHECK (ambiente IN ('teste', 'producao')),
    -- Rótulo sanitizado da conta (ex.: id retornado pelo provedor) — nunca segredo.
    nome_conta             TEXT,
    status                 TEXT NOT NULL DEFAULT 'pendente'
                           CHECK (status IN ('ativa', 'pendente', 'falha', 'desativada')),
    habilitado             BOOLEAN NOT NULL DEFAULT false,
    -- Capacidades verificadas ({"checkout":true,"reembolso":true,"checkout_expiravel":false,…}).
    capabilities           JSONB NOT NULL DEFAULT '{}'::jsonb,
    webhook_url            TEXT,
    -- Último teste de conexão — invalidado a cada nova `versao`.
    ultima_verificacao_em  TIMESTAMPTZ,
    verificacao_status     TEXT CHECK (verificacao_status IN ('ok', 'falha', 'validacao_local')),
    verificacao_erro       TEXT,   -- sanitizado — nunca contém segredos
    versao                 INTEGER NOT NULL DEFAULT 1,
    criado_por             BIGINT REFERENCES funcionario (id),
    atualizado_por         BIGINT REFERENCES funcionario (id),
    criado_em              TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provedor, ambiente)
);

-- Envelope por campo: nonce(12) ‖ ciphertext ‖ tag(16) — AES-256-GCM com
-- AAD = provedor|ambiente|campo|idintegracao. `versao_chave` permite rotação
-- da chave-mestra sem reescrita imediata.
CREATE TABLE integracao_segredo (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idintegracao  BIGINT NOT NULL REFERENCES integracao (id) ON DELETE CASCADE,
    campo         TEXT   NOT NULL,  -- 'secret_key','access_token','webhook_secret',…
    valor_enc     BYTEA  NOT NULL,
    versao_chave  INTEGER NOT NULL DEFAULT 1,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (idintegracao, campo)
);

-- Provedor padrão por escopo — hoje só 'pagamentos_site'.
CREATE TABLE integracao_padrao (
    escopo         TEXT PRIMARY KEY,
    idintegracao   BIGINT NOT NULL REFERENCES integracao (id) ON DELETE CASCADE,
    atualizado_por BIGINT REFERENCES funcionario (id),
    atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Identidade imutável do provedor no pagamento. `ambiente` NULL = pagamento
-- legado (não determinável — não inventamos).
ALTER TABLE pagamento
    ADD COLUMN provedor     TEXT NOT NULL DEFAULT 'stripe'
                          CHECK (provedor IN ('stripe', 'pagbank', 'mercadopago')),
    ADD COLUMN ambiente     TEXT CHECK (ambiente IN ('teste', 'producao')),
    -- SET NULL: remover a integração não apaga a identidade gravada.
    ADD COLUMN idintegracao BIGINT REFERENCES integracao (id) ON DELETE SET NULL;
CREATE INDEX idx_pagamento_provedor ON pagamento (provedor);

-- Inbox de webhooks generaliza por provedor: deduplicação vira
-- (provedor, event_id) — ids de provedores distintos não colidem.
ALTER TABLE pagamento_webhook_evento
    ADD COLUMN provedor      TEXT NOT NULL DEFAULT 'stripe',
    ADD COLUMN idintegracao  BIGINT REFERENCES integracao (id) ON DELETE SET NULL;
ALTER TABLE pagamento_webhook_evento
    DROP CONSTRAINT pagamento_webhook_evento_event_id_key;
CREATE UNIQUE INDEX uq_webhook_evento_provedor
    ON pagamento_webhook_evento (provedor, event_id);

DROP TRIGGER IF EXISTS trg_delta_integracao ON integracao;
CREATE TRIGGER trg_delta_integracao
    AFTER INSERT OR UPDATE OR DELETE ON integracao
    FOR EACH ROW EXECUTE FUNCTION notify_delta();
