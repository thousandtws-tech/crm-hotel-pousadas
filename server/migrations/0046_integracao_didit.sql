-- Integração Didit — verificação de identidade (KYC) de funcionários.
-- Categoria 'seguranca', sessões hospedadas por funcionário e inbox de
-- eventos de webhook com deduplicação.
BEGIN;

ALTER TABLE integracao DROP CONSTRAINT integracao_provedor_check;
ALTER TABLE integracao ADD CONSTRAINT integracao_provedor_check
    CHECK (provedor IN ('stripe', 'pagbank', 'mercadopago', 'zapi', 'spedy', 'didit'));

ALTER TABLE integracao DROP CONSTRAINT integracao_categoria_check;
ALTER TABLE integracao ADD CONSTRAINT integracao_categoria_check
    CHECK (categoria IN ('pagamento', 'comunicacao', 'fiscal', 'seguranca'));

-- Sessão de verificação hospedada (uma por tentativa). `status` é o nosso
-- mapeamento estável; `status_remoto` guarda o valor exato do provedor.
CREATE TABLE verificacao_identidade (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integracao_id  BIGINT      NOT NULL REFERENCES integracao (id),
    funcionario_id BIGINT      NOT NULL REFERENCES funcionario (id) ON DELETE CASCADE,
    session_id     TEXT        NOT NULL UNIQUE,
    url            TEXT        NOT NULL,
    vendor_data    TEXT        NOT NULL,
    status         TEXT        NOT NULL DEFAULT 'nao_iniciada'
        CHECK (status IN ('nao_iniciada', 'em_andamento', 'aguardando_usuario',
                          'em_revisao', 'reenviada', 'aprovada', 'recusada',
                          'expirada', 'abandonada', 'kyc_expirada', 'desconhecido')),
    status_remoto  TEXT,
    resumo         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    decidido_em    TIMESTAMPTZ,
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uma sessão viva por funcionário: links novos reutilizam a sessão aberta
-- em vez de criar verificações concorrentes na Didit.
CREATE UNIQUE INDEX uq_verificacao_viva
    ON verificacao_identidade (funcionario_id)
    WHERE status NOT IN ('aprovada', 'recusada', 'expirada', 'abandonada', 'kyc_expirada');
CREATE INDEX idx_verificacao_func
    ON verificacao_identidade (funcionario_id, criado_em DESC);
CREATE INDEX idx_verificacao_status
    ON verificacao_identidade (status) WHERE status NOT IN ('aprovada', 'recusada');

-- Inbox de webhook — persistir antes de processar, dedup por event_id
-- (a Didit reenvia entregas falhas; ordem não é garantida).
CREATE TABLE verificacao_evento (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id      TEXT        NOT NULL UNIQUE,
    session_id    TEXT,
    webhook_type  TEXT,
    payload       JSONB       NOT NULL,
    processado_em TIMESTAMPTZ,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_verificacao_evento_sess ON verificacao_evento (session_id);

COMMIT;
