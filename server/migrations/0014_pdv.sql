-- ---------------------------------------------------------------------------
-- 0014 — PDV & Comandas: comandas por mesa/quarto/balcão, garçons com
-- comissão e baixa automática no estoque.
--
-- Fluxo:
--   abrir comanda → lançar itens (cada item dá baixa no estoque e grava um
--   movimento_estoque 'saida') → entregar/cancelar itens (cancelamento
--   devolve ao estoque com movimento 'entrada') → fechar.
--
-- Fechamento gera o espelho financeiro na mesma transação:
--   • modo 'pagar'   → lancamento receber quitado com baixa_lancamento
--                      (idforma_pagamento + idconta_financeira)
--   • modo 'faturar' → lancamento receber em aberto vinculado à reserva
--                      (hóspede paga no checkout)
-- Comissão do garçom é provisionada no fechamento e gera um lançamento a
-- pagar quando paga pelo gerente.
-- ---------------------------------------------------------------------------

CREATE TYPE pdv_comanda_tipo   AS ENUM ('mesa', 'quarto', 'balcao');
CREATE TYPE pdv_comanda_status AS ENUM ('aberta', 'fechada', 'cancelada');
CREATE TYPE pdv_item_status    AS ENUM ('pendente', 'entregue', 'cancelado');
CREATE TYPE pdv_comissao_status AS ENUM ('pendente', 'paga');

-- ---------------------------------------------------------------------------
-- mesas do salão — comanda 'mesa' exige uma mesa cadastrada
-- ---------------------------------------------------------------------------
CREATE TABLE pdv_mesa (
    id           BIGSERIAL PRIMARY KEY,
    numero       TEXT        NOT NULL UNIQUE,
    lugares      INTEGER     NOT NULL DEFAULT 4 CHECK (lugares > 0),
    ativo        BOOLEAN     NOT NULL DEFAULT TRUE,
    version      BIGINT      NOT NULL DEFAULT 0,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_pdv_mesa_version
    BEFORE UPDATE ON pdv_mesa
    FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_delta_pdv_mesa
    AFTER INSERT OR UPDATE OR DELETE ON pdv_mesa
    FOR EACH ROW EXECUTE FUNCTION notify_delta();

-- ---------------------------------------------------------------------------
-- garçons — percentual de comissão por funcionário (só cadastrados vendem)
-- ---------------------------------------------------------------------------
CREATE TABLE pdv_garcom (
    id             BIGSERIAL PRIMARY KEY,
    idfuncionario  BIGINT       NOT NULL UNIQUE REFERENCES funcionario (id),
    percentual     NUMERIC(5,2) NOT NULL DEFAULT 0
                   CHECK (percentual >= 0 AND percentual <= 100),
    ativo          BOOLEAN      NOT NULL DEFAULT TRUE,
    criado_em      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    atualizado_em  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_delta_pdv_garcom
    AFTER INSERT OR UPDATE OR DELETE ON pdv_garcom
    FOR EACH ROW EXECUTE FUNCTION notify_delta();

-- ---------------------------------------------------------------------------
-- comanda — uma aberta por mesa; quarto/balcão livres
-- ---------------------------------------------------------------------------
CREATE TABLE pdv_comanda (
    id                 BIGSERIAL PRIMARY KEY,
    tipo               pdv_comanda_tipo NOT NULL,
    idmesa             BIGINT REFERENCES pdv_mesa (id),
    idquarto           BIGINT REFERENCES quarto (id),
    idreserva          BIGINT REFERENCES reserva (id),
    idcliente          BIGINT REFERENCES cliente (id),
    idgarcom           BIGINT REFERENCES funcionario (id),
    -- rótulo livre (ex.: "Balcão — João", "Delivery")
    rotulo             TEXT,
    status             pdv_comanda_status NOT NULL DEFAULT 'aberta',
    subtotal           NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    desconto           NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (desconto >= 0),
    total              NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
    -- espelho financeiro gerado no fechamento
    idforma_pagamento  BIGINT REFERENCES forma_pagamento (id),
    idlancamento       BIGINT REFERENCES lancamento (id),
    aberto_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
    fechado_em         TIMESTAMPTZ,
    observacao         TEXT,
    version            BIGINT NOT NULL DEFAULT 0,
    criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (tipo = 'mesa'   AND idmesa  IS NOT NULL) OR
        (tipo = 'quarto' AND idquarto IS NOT NULL) OR
        (tipo = 'balcao')
    )
);
-- a mesa não admite duas comandas abertas (índice parcial)
CREATE UNIQUE INDEX pdv_comanda_mesa_aberta
    ON pdv_comanda (idmesa) WHERE status = 'aberta' AND idmesa IS NOT NULL;
CREATE INDEX idx_pdv_comanda_status  ON pdv_comanda (status);
CREATE INDEX idx_pdv_comanda_garcom  ON pdv_comanda (idgarcom);
CREATE INDEX idx_pdv_comanda_reserva ON pdv_comanda (idreserva);
CREATE INDEX idx_pdv_comanda_aberto  ON pdv_comanda (aberto_em);

CREATE TRIGGER trg_pdv_comanda_version
    BEFORE UPDATE ON pdv_comanda
    FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_delta_pdv_comanda
    AFTER INSERT OR UPDATE OR DELETE ON pdv_comanda
    FOR EACH ROW EXECUTE FUNCTION notify_delta();

-- ---------------------------------------------------------------------------
-- itens da comanda — baixa no estoque no lançamento, estorno no cancelamento
-- ---------------------------------------------------------------------------
CREATE TABLE pdv_comanda_item (
    id            BIGSERIAL PRIMARY KEY,
    idcomanda     BIGINT       NOT NULL REFERENCES pdv_comanda (id) ON DELETE CASCADE,
    iditem        BIGINT       NOT NULL REFERENCES estoque (id),
    quantidade    INTEGER      NOT NULL CHECK (quantidade > 0),
    valor_unit    NUMERIC(12,2) NOT NULL CHECK (valor_unit >= 0),
    valor_total   NUMERIC(12,2) NOT NULL CHECK (valor_total >= 0),
    status        pdv_item_status NOT NULL DEFAULT 'pendente',
    lancado_por   BIGINT REFERENCES funcionario (id),
    cancelado_por BIGINT REFERENCES funcionario (id),
    motivo_cancelamento TEXT,
    criado_em     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_pdv_item_comanda ON pdv_comanda_item (idcomanda);
CREATE INDEX idx_pdv_item_item    ON pdv_comanda_item (iditem);
CREATE TRIGGER trg_delta_pdv_item
    AFTER INSERT OR UPDATE OR DELETE ON pdv_comanda_item
    FOR EACH ROW EXECUTE FUNCTION notify_delta();

-- ---------------------------------------------------------------------------
-- comissão — uma por comanda fechada com garçom comissionado
-- ---------------------------------------------------------------------------
CREATE TABLE pdv_comissao (
    id           BIGSERIAL PRIMARY KEY,
    idgarcom     BIGINT        NOT NULL REFERENCES funcionario (id),
    idcomanda    BIGINT        NOT NULL UNIQUE REFERENCES pdv_comanda (id),
    percentual   NUMERIC(5,2)  NOT NULL CHECK (percentual >= 0),
    base         NUMERIC(12,2) NOT NULL CHECK (base >= 0),
    valor        NUMERIC(12,2) NOT NULL CHECK (valor >= 0),
    status       pdv_comissao_status NOT NULL DEFAULT 'pendente',
    idlancamento BIGINT REFERENCES lancamento (id),
    pago_em      TIMESTAMPTZ,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pdv_comissao_garcom ON pdv_comissao (idgarcom, status);
CREATE TRIGGER trg_delta_pdv_comissao
    AFTER INSERT OR UPDATE OR DELETE ON pdv_comissao
    FOR EACH ROW EXECUTE FUNCTION notify_delta();

-- conta do plano de contas para comissões de garçons (custo direto)
INSERT INTO plano_conta (codigo, nome, tipo, grupo_dre, sistema)
VALUES ('3.03', 'Comissões de garçons', 'pagar', 'custos', TRUE)
ON CONFLICT (codigo) DO NOTHING;
