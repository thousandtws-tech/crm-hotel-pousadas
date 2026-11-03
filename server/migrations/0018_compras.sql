-- 0018_compras.sql — Pedidos de Compra com aprovação (Maria/manual):
-- fornecedores com lead time, pedido com conta a pagar automática,
-- recebimento parcial/total com entrada de estoque e anti-duplicação.

CREATE TABLE fornecedor (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome           TEXT        NOT NULL,
    cnpj           TEXT,
    contato        TEXT,
    telefone       TEXT,
    lead_time_dias INTEGER     NOT NULL DEFAULT 2 CHECK (lead_time_dias >= 0),
    ativo          BOOLEAN     NOT NULL DEFAULT TRUE,
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_fornecedor_nome ON fornecedor (nome) WHERE ativo;

CREATE TABLE pedido_compra (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idfornecedor  BIGINT       NOT NULL REFERENCES fornecedor (id),
    data_prevista DATE         NOT NULL,
    valor_total   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (valor_total >= 0),
    status        TEXT         NOT NULL DEFAULT 'pendente'
                  CHECK (status IN ('pendente', 'parcial', 'recebido', 'cancelado')),
    origem        TEXT         NOT NULL DEFAULT 'manual'
                  CHECK (origem IN ('manual', 'maria')),
    idlancamento  BIGINT REFERENCES lancamento (id),
    criado_por    BIGINT REFERENCES funcionario (id),
    observacao    TEXT,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pedido_status ON pedido_compra (status, data_prevista);
CREATE INDEX idx_pedido_fornecedor ON pedido_compra (idfornecedor);

CREATE TABLE pedido_compra_item (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idpedido             BIGINT  NOT NULL REFERENCES pedido_compra (id) ON DELETE CASCADE,
    iditem               BIGINT  NOT NULL REFERENCES estoque (id),
    quantidade           INTEGER NOT NULL CHECK (quantidade > 0),
    quantidade_recebida  INTEGER NOT NULL DEFAULT 0 CHECK (quantidade_recebida >= 0),
    valor_unit           NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (valor_unit >= 0),
    UNIQUE (idpedido, iditem),
    CHECK (quantidade_recebida <= quantidade)
);
CREATE INDEX idx_peditem_pedido ON pedido_compra_item (idpedido);

CREATE TRIGGER trg_delta_fornecedor AFTER INSERT OR UPDATE OR DELETE ON fornecedor
    FOR EACH ROW EXECUTE FUNCTION notify_delta();
CREATE TRIGGER trg_delta_compra AFTER INSERT OR UPDATE OR DELETE ON pedido_compra
    FOR EACH ROW EXECUTE FUNCTION notify_delta();
CREATE TRIGGER trg_delta_compra_item AFTER INSERT OR UPDATE OR DELETE ON pedido_compra_item
    FOR EACH ROW EXECUTE FUNCTION notify_delta();
