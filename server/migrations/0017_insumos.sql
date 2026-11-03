-- 0017_insumos.sql — Estoque & Insumos: unidades, mínimo, ficha técnica,
-- conversões de unidade de compra e importação de NF-e.

-- unidade base do item (un, g, ml, kg, L, ...) — quantidade sempre na unidade base
ALTER TABLE estoque ADD COLUMN unidade TEXT NOT NULL DEFAULT 'un';
ALTER TABLE estoque ADD COLUMN estoque_minimo INTEGER NOT NULL DEFAULT 0 CHECK (estoque_minimo >= 0);
ALTER TABLE estoque ADD COLUMN eh_insumo BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_estoque_baixo ON estoque (id) WHERE ativo AND estoque_minimo > 0;

-- ficha técnica: produto vendável composto por insumos (quantidade na unidade base do insumo)
CREATE TABLE ficha_tecnica (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idproduto  BIGINT NOT NULL REFERENCES estoque (id) ON DELETE CASCADE,
    idinsumo   BIGINT NOT NULL REFERENCES estoque (id),
    quantidade INTEGER NOT NULL CHECK (quantidade > 0),
    criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (idproduto, idinsumo),
    CHECK (idproduto <> idinsumo)
);

-- conversões de unidade de compra → unidade base (1 unidade_compra = fator base)
CREATE TABLE estoque_conversao (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    iditem         BIGINT NOT NULL REFERENCES estoque (id) ON DELETE CASCADE,
    unidade_compra TEXT    NOT NULL,
    fator          INTEGER NOT NULL CHECK (fator > 0),
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (iditem, unidade_compra)
);

-- notas fiscais de entrada importadas (NF-e XML)
CREATE TABLE estoque_nfe (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    chave         TEXT NOT NULL UNIQUE,
    numero        TEXT,
    emitente      TEXT,
    cnpj          TEXT,
    emissao       DATE,
    total         NUMERIC(12,2) NOT NULL CHECK (total >= 0),
    idlancamento  BIGINT REFERENCES lancamento (id),
    importado_por BIGINT REFERENCES funcionario (id),
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_delta_ficha     AFTER INSERT OR UPDATE OR DELETE ON ficha_tecnica     FOR EACH ROW EXECUTE FUNCTION notify_delta();
CREATE TRIGGER trg_delta_conversao AFTER INSERT OR UPDATE OR DELETE ON estoque_conversao FOR EACH ROW EXECUTE FUNCTION notify_delta();
CREATE TRIGGER trg_delta_nfe       AFTER INSERT OR UPDATE OR DELETE ON estoque_nfe       FOR EACH ROW EXECUTE FUNCTION notify_delta();

INSERT INTO plano_conta (codigo, nome, tipo, grupo_dre, sistema)
VALUES ('3.04', 'Compras de insumos (NF-e)', 'pagar', 'custos', TRUE)
ON CONFLICT (codigo) DO NOTHING;
