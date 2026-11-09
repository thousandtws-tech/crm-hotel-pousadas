-- ---------------------------------------------------------------------------
-- Pagamentos online (Stripe) — sinal/integral/saldo + webhooks + auditoria.
--
-- Dinheiro em centavos (BIGINT) — nunca float. Idempotência via chaves
-- únicas nos identificadores do provedor. Reserva ganha hold com expiração
-- e token público opaco (anti-enumeração no site).
-- ---------------------------------------------------------------------------

-- Reserva provisória com prazo: `expira_em` NULL = criada pela recepção
-- (hold permanente até check-in); NOT NULL = criada pelo site, expira se
-- não pagar. `token_publico` identifica a reserva no fluxo público sem
-- expor o id sequencial.
ALTER TABLE reserva
    ADD COLUMN expira_em      TIMESTAMPTZ,
    ADD COLUMN token_publico  UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX uq_reserva_token_publico ON reserva (token_publico);
CREATE INDEX idx_reserva_expira ON reserva (expira_em) WHERE expira_em IS NOT NULL;

-- Permissão granular de operações financeiras (reembolso, conciliação).
-- Admin (nivel=1) possui implicitamente — ver application::services::pagamentos.
ALTER TABLE funcionario
    ADD COLUMN financeiro BOOLEAN NOT NULL DEFAULT FALSE;

-- Forma de pagamento usada ao baixar consumo quitado via Stripe.
INSERT INTO forma_pagamento (nome, especie) VALUES ('Stripe', FALSE)
ON CONFLICT (nome) DO NOTHING;

CREATE TYPE pagamento_tipo   AS ENUM ('integral', 'sinal', 'saldo');
CREATE TYPE pagamento_status AS ENUM
    ('pendente', 'pago', 'expirado', 'falhou', 'cancelado',
     'reembolso_parcial', 'reembolsado');
CREATE TYPE webhook_proc_status AS ENUM ('recebido', 'processado', 'falhou', 'ignorado');
CREATE TYPE reembolso_status AS ENUM ('pendente', 'concluido', 'falhou');

-- Obrigação financeira da reserva: integral, sinal (30% default) ou saldo.
-- Uma reserva pode ter N pagamentos (sinal + saldo); cada pagamento pode
-- ter N tentativas (sessões de checkout reemitidas após expirar/falhar).
CREATE TABLE pagamento (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idreserva           BIGINT          NOT NULL REFERENCES reserva (id),
    tipo                pagamento_tipo  NOT NULL,
    status              pagamento_status NOT NULL DEFAULT 'pendente',
    valor_centavos      BIGINT          NOT NULL CHECK (valor_centavos >= 0),
    moeda               CHAR(3)         NOT NULL DEFAULT 'brl',
    -- Stripe: payment_intent — único quando presente (preenchido no webhook).
    pi_id               TEXT            UNIQUE,
    metodo              TEXT,           -- 'card' | 'pix' — do webhook, NULL até lá
    paid_em             TIMESTAMPTZ,
    criado_em           TIMESTAMPTZ     NOT NULL DEFAULT now(),
    atualizado_em       TIMESTAMPTZ     NOT NULL DEFAULT now()
);
CREATE INDEX idx_pagamento_reserva ON pagamento (idreserva);
CREATE INDEX idx_pagamento_status  ON pagamento (status);
CREATE INDEX idx_pagamento_paid    ON pagamento (paid_em) WHERE paid_em IS NOT NULL;

-- Cada sessão Stripe Checkout ligada ao pagamento (idempotente por session_id).
CREATE TABLE pagamento_tentativa (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idpagamento     BIGINT        NOT NULL REFERENCES pagamento (id),
    session_id      TEXT          NOT NULL UNIQUE,  -- cs_...
    session_url     TEXT,                            -- URL hospedada p/ reuso idempotente
    status          TEXT          NOT NULL DEFAULT 'aberta', -- aberta|expirada|paga
    expires_em      TIMESTAMPTZ   NOT NULL,
    criado_em       TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_tentativa_pagamento ON pagamento_tentativa (idpagamento);
CREATE INDEX idx_tentativa_expira    ON pagamento_tentativa (expires_em)
    WHERE status = 'aberta';

CREATE TABLE pagamento_reembolso (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idpagamento     BIGINT           NOT NULL REFERENCES pagamento (id),
    refund_id       TEXT             UNIQUE,  -- re_...
    valor_centavos  BIGINT           NOT NULL CHECK (valor_centavos > 0),
    motivo          TEXT,
    status          reembolso_status NOT NULL DEFAULT 'pendente',
    criado_em       TIMESTAMPTZ      NOT NULL DEFAULT now(),
    atualizado_em   TIMESTAMPTZ      NOT NULL DEFAULT now()
);
CREATE INDEX idx_reembolso_pagamento ON pagamento_reembolso (idpagamento);

-- Inbox de eventos Stripe — idempotência + reconciliação.
-- provider_event_id UNIQUE: evento duplicado da Stripe é no-op.
CREATE TABLE pagamento_webhook_evento (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id        TEXT                NOT NULL UNIQUE,  -- evt_...
    event_type      TEXT                NOT NULL,
    payload         JSONB               NOT NULL,
    status          webhook_proc_status NOT NULL DEFAULT 'recebido',
    tentativas      INTEGER             NOT NULL DEFAULT 0,
    ultimo_erro     TEXT,
    recebido_em     TIMESTAMPTZ         NOT NULL DEFAULT now(),
    processado_em   TIMESTAMPTZ
);
CREATE INDEX idx_webhook_pendentes ON pagamento_webhook_evento (status)
    WHERE status IN ('recebido', 'falhou');

-- Trilha imutável: quem/o quê mudou o pagamento (Stripe, funcionário, sweeper).
CREATE TABLE pagamento_auditoria (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idpagamento  BIGINT NOT NULL REFERENCES pagamento (id),
    ator_tipo    TEXT   NOT NULL, -- 'stripe' | 'funcionario' | 'sistema'
    ator_id      BIGINT,          -- idfuncionario quando aplicável
    acao         TEXT   NOT NULL, -- 'criado','pago','expirado','reembolsado',...
    dados        JSONB,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_auditoria_pagamento ON pagamento_auditoria (idpagamento);
