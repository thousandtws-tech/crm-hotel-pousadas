-- ============================================================================
-- Clarituz — schema inicial (PostgreSQL 16)
-- Substitui o MySQL do legado (innjoy_1_0_0).
--
-- Decisões-chave:
--  * EXCLUDE USING gist em `reserva` torna overbooking impossível por
--    construção — substitui o GET_LOCK/RELEASE_LOCK do legado (que era
--    cooperação voluntária entre threads, não invariante de storage).
--  * Enums nativos preservam os discriminantes do legado ('p','i','c','f').
--  * Dinheiro sempre NUMERIC(12,2) — nunca ponto flutuante.
--  * Timestamps TIMESTAMPTZ; datas de estadia DATE.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- tipos enumerados
-- ---------------------------------------------------------------------------

CREATE TYPE reserva_status AS ENUM ('p', 'i', 'c', 'f');
CREATE TYPE consumo_status AS ENUM ('pendente', 'concluido', 'cancelado', 'reembolsado');
CREATE TYPE tipo_movimento AS ENUM ('entrada', 'saida');

-- ---------------------------------------------------------------------------
-- pessoas
-- ---------------------------------------------------------------------------

CREATE TABLE funcionario (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome            TEXT        NOT NULL,
    login           TEXT        NOT NULL UNIQUE,
    senha_hash      TEXT        NOT NULL,
    cpf             TEXT,
    data_nascimento DATE,
    nivel           SMALLINT    NOT NULL DEFAULT 3 CHECK (nivel BETWEEN 1 AND 3),
    ativo           BOOLEAN     NOT NULL DEFAULT TRUE,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_funcionario_ativo ON funcionario (ativo) WHERE ativo;

CREATE TABLE logacesso (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idfuncionario BIGINT      NOT NULL REFERENCES funcionario (id),
    ip            TEXT,
    user_agent    TEXT,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_logacesso_func ON logacesso (idfuncionario, criado_em DESC);

CREATE TABLE sessao_refresh (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    idfuncionario BIGINT      NOT NULL REFERENCES funcionario (id) ON DELETE CASCADE,
    token_hash    TEXT        NOT NULL UNIQUE,
    expira_em     TIMESTAMPTZ NOT NULL,
    revogado_em   TIMESTAMPTZ,
    ip            TEXT,
    user_agent    TEXT,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessao_ativa ON sessao_refresh (idfuncionario) WHERE revogado_em IS NULL;

CREATE TABLE cliente (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome            TEXT        NOT NULL,
    cpf             TEXT        NOT NULL UNIQUE,
    data_nascimento DATE        NOT NULL,
    email           TEXT,
    telefone        TEXT,
    estado          TEXT,
    cidade          TEXT,
    ativo           BOOLEAN     NOT NULL DEFAULT TRUE,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cliente_nome ON cliente (nome);
CREATE UNIQUE INDEX idx_cliente_email_uniq ON cliente (email) WHERE email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- catálogo
-- ---------------------------------------------------------------------------

CREATE TABLE tipo_acomodacao (
    id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome      TEXT        NOT NULL UNIQUE,
    ativo     BOOLEAN     NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE acomodacao (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idtipo_acomodacao BIGINT      REFERENCES tipo_acomodacao (id),
    nome              TEXT        NOT NULL,
    numero            INTEGER     NOT NULL UNIQUE,
    valor             NUMERIC(12,2) NOT NULL CHECK (valor >= 0),
    capacidade        INTEGER     NOT NULL CHECK (capacidade > 0),
    descricao         TEXT,
    cor               TEXT        NOT NULL DEFAULT '#4472C4',
    ativo             BOOLEAN     NOT NULL DEFAULT TRUE,
    criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_acomodacao_ativo ON acomodacao (ativo) WHERE ativo;

CREATE TABLE tarifa_historico (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idacomodacao  BIGINT        NOT NULL REFERENCES acomodacao (id),
    valor         NUMERIC(12,2) NOT NULL CHECK (valor >= 0),
    vigente_desde DATE          NOT NULL DEFAULT CURRENT_DATE,
    vigente_ate   DATE,
    idfuncionario BIGINT        REFERENCES funcionario (id),
    criado_em     TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_tarifa_acom ON tarifa_historico (idacomodacao, vigente_desde DESC);
CREATE UNIQUE INDEX idx_tarifa_vigente ON tarifa_historico (idacomodacao) WHERE vigente_ate IS NULL;

CREATE TABLE quarto (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idacomodacao BIGINT      NOT NULL REFERENCES acomodacao (id),
    numero       TEXT        NOT NULL,
    ativo        BOOLEAN     NOT NULL DEFAULT TRUE,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (idacomodacao, numero)
);

CREATE TABLE estacionamento (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idacomodacao BIGINT      REFERENCES acomodacao (id),
    numero       TEXT        NOT NULL UNIQUE,
    ativo        BOOLEAN     NOT NULL DEFAULT TRUE,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- estoque
-- ---------------------------------------------------------------------------

CREATE TABLE categoria_estoque (
    id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome      TEXT        NOT NULL UNIQUE,
    ativo     BOOLEAN     NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE estoque (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome           TEXT          NOT NULL,
    idcategoria    BIGINT        REFERENCES categoria_estoque (id),
    quantidade     INTEGER       NOT NULL DEFAULT 0 CHECK (quantidade >= 0),
    valor_unitario NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (valor_unitario >= 0),
    ativo          BOOLEAN       NOT NULL DEFAULT TRUE,
    criado_em      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    atualizado_em  TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_estoque_nome ON estoque (nome) WHERE ativo;
CREATE INDEX idx_estoque_cat ON estoque (idcategoria);

CREATE TABLE movimento_estoque (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    iditem        BIGINT         NOT NULL REFERENCES estoque (id),
    tipo          tipo_movimento NOT NULL,
    quantidade    INTEGER        NOT NULL CHECK (quantidade > 0),
    idfuncionario BIGINT         REFERENCES funcionario (id),
    motivo        TEXT           NOT NULL,
    criado_em     TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX idx_movestoque_item ON movimento_estoque (iditem, criado_em DESC);

-- ---------------------------------------------------------------------------
-- frigobar
-- ---------------------------------------------------------------------------

CREATE TABLE frigobar (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idacomodacao BIGINT      NOT NULL REFERENCES acomodacao (id),
    modelo       TEXT,
    patrimonio   TEXT,
    ativo        BOOLEAN     NOT NULL DEFAULT TRUE,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_frigobar_acom ON frigobar (idacomodacao) WHERE ativo;

CREATE TABLE item_frigobar (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idfrigobar  BIGINT      NOT NULL REFERENCES frigobar (id),
    iditem      BIGINT      NOT NULL REFERENCES estoque (id),
    quantidade  INTEGER     NOT NULL DEFAULT 0 CHECK (quantidade >= 0),
    ativo       BOOLEAN     NOT NULL DEFAULT TRUE,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (idfrigobar, iditem)
);

-- ---------------------------------------------------------------------------
-- reservas (agregado central)
-- ---------------------------------------------------------------------------

CREATE TABLE forma_pagamento (
    id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome      TEXT        NOT NULL UNIQUE,
    ativo     BOOLEAN     NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reserva (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idacomodacao        BIGINT        NOT NULL REFERENCES acomodacao (id),
    idcliente           BIGINT        NOT NULL REFERENCES cliente (id),
    idquarto            BIGINT        REFERENCES quarto (id),
    quantidade_hospedes INTEGER       NOT NULL CHECK (quantidade_hospedes > 0),
    entradaprevista     DATE          NOT NULL,
    saidaprevista       DATE          NOT NULL,
    checkin_em          TIMESTAMPTZ,
    checkout_em         TIMESTAMPTZ,
    obs                 TEXT,
    status              reserva_status NOT NULL DEFAULT 'p',
    valordiaria         NUMERIC(12,2) NOT NULL CHECK (valordiaria >= 0),
    -- período como range contínuo [entrada, saída+1) para a constraint
    periodo             DATERANGE GENERATED ALWAYS AS
                            (daterange(entradaprevista, saidaprevista + 1, '[)')) STORED,
    criado_em           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    atualizado_em       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CHECK (saidaprevista >= entradaprevista)
);
CREATE INDEX idx_reserva_cliente ON reserva (idcliente);
CREATE INDEX idx_reserva_status ON reserva (status);
CREATE INDEX idx_reserva_periodo ON reserva USING gist (periodo);
CREATE INDEX idx_reserva_entrada ON reserva (entradaprevista);

-- INVARIANTE CENTRAL: mesma acomodação nunca tem dois períodos sobrepostos
-- em status ocupante ('p','i'). Substitui GET_LOCK + SELECT do legado —
-- a garantia agora vive no storage e resiste a races reais.
ALTER TABLE reserva
    ADD CONSTRAINT excl_reserva_sem_overlap
    EXCLUDE USING gist (
        idacomodacao WITH =,
        periodo WITH &&
    )
    WHERE (status IN ('p', 'i'));

CREATE TABLE consumo (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idreserva         BIGINT         NOT NULL UNIQUE REFERENCES reserva (id),
    valor_estadia     NUMERIC(12,2)  NOT NULL DEFAULT 0 CHECK (valor_estadia >= 0),
    valor_itens       NUMERIC(12,2)  NOT NULL DEFAULT 0 CHECK (valor_itens >= 0),
    valor_adicional   NUMERIC(12,2)  NOT NULL DEFAULT 0 CHECK (valor_adicional >= 0),
    total_desconto    NUMERIC(12,2)  NOT NULL DEFAULT 0 CHECK (total_desconto >= 0),
    valor_final       NUMERIC(12,2),
    idforma_pagamento BIGINT         REFERENCES forma_pagamento (id),
    comprovante       TEXT,
    status            consumo_status NOT NULL DEFAULT 'pendente',
    fechado_em        TIMESTAMPTZ,
    criado_em         TIMESTAMPTZ    NOT NULL DEFAULT now(),
    atualizado_em     TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX idx_consumo_fechado ON consumo (fechado_em) WHERE status = 'concluido';

CREATE TABLE item_consumido (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idconsumo   BIGINT        NOT NULL REFERENCES consumo (id),
    iditem      BIGINT        NOT NULL REFERENCES estoque (id),
    nome        TEXT          NOT NULL,
    quantidade  INTEGER       NOT NULL CHECK (quantidade > 0),
    valor_total NUMERIC(12,2) NOT NULL CHECK (valor_total >= 0),
    criado_em   TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_itemcons_consumo ON item_consumido (idconsumo);

CREATE TABLE adicional_consumo (
    id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idconsumo BIGINT        NOT NULL REFERENCES consumo (id),
    motivo    TEXT          NOT NULL,
    valor     NUMERIC(12,2) NOT NULL CHECK (valor > 0),
    criado_em TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_adicional_consumo ON adicional_consumo (idconsumo);

CREATE TABLE reembolso (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idconsumo     BIGINT        NOT NULL REFERENCES consumo (id),
    idreserva     BIGINT        NOT NULL REFERENCES reserva (id),
    idfuncionario BIGINT        REFERENCES funcionario (id),
    valor         NUMERIC(12,2) NOT NULL CHECK (valor > 0),
    motivo        TEXT,
    criado_em     TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_reembolso_reserva ON reembolso (idreserva);

-- ---------------------------------------------------------------------------
-- estabelecimento
-- ---------------------------------------------------------------------------

CREATE TABLE estabelecimento (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cnpj          TEXT,
    razao_social  TEXT,
    site          TEXT,
    email         TEXT,
    telefone      TEXT,
    celular       TEXT,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE endereco_estabelecimento (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idestabelecimento BIGINT      NOT NULL REFERENCES estabelecimento (id),
    logradouro      TEXT,
    numero          TEXT,
    complemento     TEXT,
    bairro          TEXT,
    cidade          TEXT,
    cep             TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE logo_estabelecimento (
    id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome      TEXT        NOT NULL,
    caminho   TEXT        NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- auditoria
-- ---------------------------------------------------------------------------

CREATE TABLE log (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idfuncionario BIGINT      REFERENCES funcionario (id),
    acao          TEXT        NOT NULL,
    obs           TEXT,
    tabela        TEXT,
    idtabela      BIGINT,
    dados         JSONB,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_log_tabela ON log (tabela, idtabela);
CREATE INDEX idx_log_tempo ON log (criado_em DESC);
CREATE INDEX idx_log_func ON log (idfuncionario);

COMMIT;
