-- ============================================================================
-- Comunicação com hóspedes, reputação e fidelidade.
--
-- fila_envio          — outbox persistente: todo e-mail/WhatsApp/push sai por
--                       ela (retry/backoff, rastreio por reserva/cliente).
-- email_supressao     — bounces/complaints nunca mais recebem envio (Resend).
-- notificacao_matriz  — evento × canal × papel: quem recebe cada alerta.
-- push_subscription   — endpoints VAPID do PWA admin (tickle push).
-- avaliacao           — pesquisa pós-estadia pública (token) + NPS + OTAs.
-- fidelidade_*        — níveis editáveis + ledger de pontos do hóspede.
-- reserva.fnrh_*      — pré-ficha preenchida pelo hóspede via link público.
-- ============================================================================

CREATE TYPE canal_envio AS ENUM ('email', 'whatsapp', 'push', 'inbox');
CREATE TYPE status_envio AS ENUM ('pendente', 'enviando', 'enviado', 'falhou', 'cancelado');
CREATE TYPE status_avaliacao AS ENUM ('pendente', 'respondida', 'expirada');

-- fila de envio -----------------------------------------------------------

CREATE TABLE fila_envio (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    canal          canal_envio  NOT NULL,
    destino        TEXT         NOT NULL,        -- e-mail | +55… | endpoint hash
    template       TEXT         NOT NULL,        -- nome lógico do template
    payload        JSONB        NOT NULL,
    idreserva      BIGINT       REFERENCES reserva (id) ON DELETE SET NULL,
    idcliente      BIGINT       REFERENCES cliente (id) ON DELETE SET NULL,
    idfuncionario  BIGINT       REFERENCES funcionario (id) ON DELETE SET NULL,
    agendado_para  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    tentativas     SMALLINT     NOT NULL DEFAULT 0,
    ultimo_erro    TEXT,
    provider_msg_id TEXT,                        -- id do Resend/Meta/push
    status         status_envio NOT NULL DEFAULT 'pendente',
    criado_em      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    enviado_em     TIMESTAMPTZ
);
CREATE INDEX idx_fila_envio_pendente
    ON fila_envio (agendado_para) WHERE status = 'pendente';
CREATE INDEX idx_fila_envio_reserva ON fila_envio (idreserva);

CREATE TABLE email_supressao (
    email     TEXT        PRIMARY KEY,           -- normalizado (lower/trim)
    motivo    TEXT        NOT NULL,              -- bounced | complained | unsubscribed
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- matriz evento × canal × papel ------------------------------------------
-- papel: 1=admin, 2=gerente/financeiro, 3=recepção (mesmo semântico de
-- notificacao.ate_nivel — herda a granularidade existente).
CREATE TABLE notificacao_matriz (
    evento TEXT       NOT NULL,                  -- ex.: reserva.criada
    canal  canal_envio NOT NULL,
    papel  SMALLINT    NOT NULL,
    ativo  BOOLEAN     NOT NULL DEFAULT TRUE,
    PRIMARY KEY (evento, canal, papel)
);

-- Defaults conservadores: a equipe já recebe inbox via notificacao/EventBus;
-- matriz cobre canais externos. Sem linhas ativas de e-mail por padrão —
-- o admin liga por evento na tela da matriz.
INSERT INTO notificacao_matriz (evento, canal, papel) VALUES
    ('pagamento.confirmado',   'inbox', 3),
    ('pagamento.falhou',       'inbox', 3),
    ('avaliacao.critica',      'inbox', 2),
    ('avaliacao.critica',      'email', 1),
    ('reserva.fnrh_pendente',  'inbox', 3);

-- push --------------------------------------------------------------------

CREATE TABLE push_subscription (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idfuncionario BIGINT      NOT NULL REFERENCES funcionario (id) ON DELETE CASCADE,
    endpoint      TEXT        NOT NULL UNIQUE,
    p256dh        TEXT        NOT NULL,
    auth          TEXT        NOT NULL,
    user_agent    TEXT,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- avaliações --------------------------------------------------------------

CREATE TABLE avaliacao (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idreserva        BIGINT       NOT NULL REFERENCES reserva (id) ON DELETE CASCADE,
    idcliente        BIGINT       NOT NULL REFERENCES cliente (id),
    token            UUID         NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    plataforma       TEXT         NOT NULL DEFAULT 'direto',  -- direto|booking|airbnb|google|…
    -- notas 1–5 por categoria; nps 0–10 (recomendação)
    nota_geral       SMALLINT CHECK (nota_geral BETWEEN 1 AND 5),
    nota_limpeza     SMALLINT CHECK (nota_limpeza BETWEEN 1 AND 5),
    nota_atendimento SMALLINT CHECK (nota_atendimento BETWEEN 1 AND 5),
    nota_custo       SMALLINT CHECK (nota_custo BETWEEN 1 AND 5),
    nota_localizacao SMALLINT CHECK (nota_localizacao BETWEEN 1 AND 5),
    nps              SMALLINT CHECK (nps BETWEEN 0 AND 10),
    comentario       TEXT,
    resposta         TEXT,
    respondida_por   BIGINT REFERENCES funcionario (id),
    respondida_em    TIMESTAMPTZ,
    status           status_avaliacao NOT NULL DEFAULT 'pendente',
    enviado_em       TIMESTAMPTZ,              -- 1º envio da pesquisa
    lembrete_em      TIMESTAMPTZ,              -- reenvio +3d
    criado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_avaliacao_status ON avaliacao (status, criado_em DESC);
CREATE INDEX idx_avaliacao_cliente ON avaliacao (idcliente);

-- fidelidade ----------------------------------------------------------------

CREATE TABLE fidelidade_nivel (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome          TEXT     NOT NULL UNIQUE,      -- Bronze/Prata/Ouro…
    min_diarias   INT      NOT NULL DEFAULT 0,   -- noites acumuladas p/ o nível
    desconto_pct  NUMERIC(5,2) NOT NULL DEFAULT 0,
    beneficios    TEXT,
    ordem         SMALLINT NOT NULL DEFAULT 0,
    ativo         BOOLEAN  NOT NULL DEFAULT TRUE
);
INSERT INTO fidelidade_nivel (nome, min_diarias, desconto_pct, ordem) VALUES
    ('Bronze', 0,  0,  1),
    ('Prata',  7,  5,  2),
    ('Ouro',   20, 10, 3);

CREATE TABLE cliente_fidelidade (
    idcliente     BIGINT       PRIMARY KEY REFERENCES cliente (id) ON DELETE CASCADE,
    diarias       INT          NOT NULL DEFAULT 0,
    gasto_total   BIGINT       NOT NULL DEFAULT 0,   -- centavos (LTV cash)
    idnivel       BIGINT       REFERENCES fidelidade_nivel (id),
    atualizado_em TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- pré-ficha FNRH do hóspede (link público antes do check-in) ----------------

ALTER TABLE reserva
    ADD COLUMN fnrh_hospede        JSONB,
    ADD COLUMN fnrh_preenchida_em  TIMESTAMPTZ;

-- cliente: preferências do hóspede + observações livres do perfil -----------

ALTER TABLE cliente
    ADD COLUMN preferencias JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN observacoes  TEXT;
