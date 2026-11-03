-- ============================================================================
-- Financeiro completo: contas a pagar/receber, fluxo de caixa, conciliação
-- bancária, DRE e split payment IBS/CBS (Reforma Tributária — LC 214/2025).
--
-- Decisões-chave:
--  * Dinheiro sempre NUMERIC(12,2) — nunca ponto flutuante.
--  * `lancamento.competencia` ancora o regime de competência do DRE;
--    `baixa_lancamento.data` ancora o regime de caixa do fluxo de caixa.
--    Separar os dois eixos é o que torna DRE e fluxo consistentes.
--  * Dedup de extrato por (conta, fit_id): reimportar OFX é idempotente.
--  * Split payment é provisionado por evento de caixa (consumo fechado ou
--    baixa de recebimento) com UNIQUE(origem, idorigem) — backfill seguro.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- tipos enumerados
-- ---------------------------------------------------------------------------

CREATE TYPE lancamento_tipo      AS ENUM ('pagar', 'receber');
CREATE TYPE lancamento_status    AS ENUM ('aberto', 'parcial', 'liquidado', 'cancelado');
CREATE TYPE conta_financeira_tipo AS ENUM ('caixa', 'banco', 'aplicacao');
CREATE TYPE extrato_status       AS ENUM ('pendente', 'conciliado', 'ignorado');
CREATE TYPE split_status         AS ENUM ('provisionado', 'segregado', 'recolhido');
CREATE TYPE dre_grupo AS ENUM (
    'receita_bruta',
    'deducoes',
    'custos',
    'despesas_operacionais',
    'resultado_financeiro',
    'outras'
);

-- ---------------------------------------------------------------------------
-- plano de contas — classifica lançamentos e alimenta o DRE
-- ---------------------------------------------------------------------------

CREATE TABLE plano_conta (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo      TEXT        NOT NULL UNIQUE,
    nome        TEXT        NOT NULL,
    tipo        lancamento_tipo NOT NULL,
    grupo_dre   dre_grupo   NOT NULL,
    ativo       BOOLEAN     NOT NULL DEFAULT TRUE,
    -- contas de sistema nascem no seed: não podem ser excluídas
    -- (integridade dos lançamentos históricos)
    sistema     BOOLEAN     NOT NULL DEFAULT FALSE,
    version     BIGINT      NOT NULL DEFAULT 1,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_planoconta_tipo ON plano_conta (tipo, ativo);
CREATE TRIGGER trg_planoconta_version BEFORE UPDATE ON plano_conta
    FOR EACH ROW EXECUTE FUNCTION bump_version();

-- ---------------------------------------------------------------------------
-- contas financeiras — caixa físico, contas bancárias, aplicações
-- ---------------------------------------------------------------------------

CREATE TABLE conta_financeira (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome             TEXT        NOT NULL UNIQUE,
    tipo             conta_financeira_tipo NOT NULL DEFAULT 'banco',
    banco            TEXT,
    agencia          TEXT,
    conta            TEXT,
    saldo_inicial    NUMERIC(12,2) NOT NULL DEFAULT 0,
    saldo_inicial_em DATE        NOT NULL DEFAULT CURRENT_DATE,
    ativo            BOOLEAN     NOT NULL DEFAULT TRUE,
    version          BIGINT      NOT NULL DEFAULT 1,
    criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_contafin_version BEFORE UPDATE ON conta_financeira
    FOR EACH ROW EXECUTE FUNCTION bump_version();

-- ---------------------------------------------------------------------------
-- lançamentos (títulos a pagar / a receber)
-- ---------------------------------------------------------------------------

CREATE TABLE lancamento (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tipo               lancamento_tipo NOT NULL,
    descricao          TEXT        NOT NULL,
    idplano_conta      BIGINT      REFERENCES plano_conta (id),
    idconta_financeira BIGINT      REFERENCES conta_financeira (id),
    favorecido         TEXT,                 -- fornecedor ou cliente (texto livre)
    documento          TEXT,                 -- NF-e, boleto, nº doc
    idcliente          BIGINT      REFERENCES cliente (id),
    idreserva          BIGINT      REFERENCES reserva (id),
    valor              NUMERIC(12,2) NOT NULL CHECK (valor > 0),
    valor_liquidado    NUMERIC(12,2) NOT NULL DEFAULT 0
                       CHECK (valor_liquidado >= 0),
    emissao            DATE        NOT NULL DEFAULT CURRENT_DATE,
    vencimento         DATE        NOT NULL,
    -- regime de competência do DRE (default: vencimento)
    competencia        DATE,
    status             lancamento_status NOT NULL DEFAULT 'aberto',
    observacao         TEXT,
    idfuncionario      BIGINT      REFERENCES funcionario (id),
    version            BIGINT      NOT NULL DEFAULT 1,
    criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (valor_liquidado <= valor)
);
CREATE INDEX idx_lancamento_tipo_status ON lancamento (tipo, status);
CREATE INDEX idx_lancamento_vencimento ON lancamento (vencimento)
    WHERE status IN ('aberto', 'parcial');
CREATE INDEX idx_lancamento_competencia ON lancamento (competencia);
CREATE TRIGGER trg_lancamento_version BEFORE UPDATE ON lancamento
    FOR EACH ROW EXECUTE FUNCTION bump_version();

-- baixas: cada liquidação (total ou parcial) é um evento de caixa datado.
-- Manter eventos separados (em vez de um único "pago_em") é o que permite
-- fluxo de caixa diário, conciliação por valor/data e auditoria de baixas.
CREATE TABLE baixa_lancamento (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idlancamento       BIGINT      NOT NULL REFERENCES lancamento (id),
    idconta_financeira BIGINT      NOT NULL REFERENCES conta_financeira (id),
    valor              NUMERIC(12,2) NOT NULL CHECK (valor > 0),
    data               DATE        NOT NULL DEFAULT CURRENT_DATE,
    idforma_pagamento  BIGINT      REFERENCES forma_pagamento (id),
    observacao         TEXT,
    idfuncionario      BIGINT      REFERENCES funcionario (id),
    criado_em          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_baixa_lancamento ON baixa_lancamento (idlancamento);
CREATE INDEX idx_baixa_conta_data ON baixa_lancamento (idconta_financeira, data);
CREATE INDEX idx_baixa_data ON baixa_lancamento (data);

-- ---------------------------------------------------------------------------
-- conciliação bancária
-- ---------------------------------------------------------------------------

-- linhas do extrato importado (OFX/CSV). `valor` com sinal:
--   > 0 crédito · < 0 débito. `fit_id` = chave de deduplicação do banco.
CREATE TABLE extrato_item (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idconta_financeira BIGINT      NOT NULL REFERENCES conta_financeira (id),
    data               DATE        NOT NULL,
    descricao          TEXT        NOT NULL,
    documento          TEXT,
    valor              NUMERIC(12,2) NOT NULL,
    fit_id             TEXT,
    origem             TEXT        NOT NULL DEFAULT 'ofx' CHECK (origem IN ('ofx', 'csv')),
    status             extrato_status NOT NULL DEFAULT 'pendente',
    -- baixa vinculada pela conciliação (NULL até conciliar)
    idbaixa            BIGINT      REFERENCES baixa_lancamento (id),
    importado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- dedup de reimportação: mesmo FITID na mesma conta = mesmo item
CREATE UNIQUE INDEX idx_extrato_fitid ON extrato_item (idconta_financeira, fit_id)
    WHERE fit_id IS NOT NULL;
CREATE INDEX idx_extrato_status ON extrato_item (idconta_financeira, status, data);

-- registro de cada match extrato ↔ baixa (quem, quando, qual critério)
CREATE TABLE conciliacao (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idextrato_item BIGINT      NOT NULL REFERENCES extrato_item (id),
    idbaixa        BIGINT      NOT NULL REFERENCES baixa_lancamento (id),
    score          NUMERIC(5,2) NOT NULL DEFAULT 100,
    tipo           TEXT        NOT NULL DEFAULT 'manual'
                   CHECK (tipo IN ('exato', 'proximo', 'manual', 'classificado')),
    idfuncionario  BIGINT      REFERENCES funcionario (id),
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (idextrato_item)
);
-- uma baixa só pode conciliar com UMA linha de extrato
CREATE UNIQUE INDEX idx_conciliacao_baixa ON conciliacao (idbaixa);

-- ---------------------------------------------------------------------------
-- split payment IBS/CBS — Reforma Tributária (EC 132/2023, LC 214/2025)
-- ---------------------------------------------------------------------------

-- alíquotas vigentes por período — histórico preservado porque a regra muda
-- ano a ano durante a transição (2026: CBS 0,9% + IBS 0,1% piloto).
CREATE TABLE tributo_config (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    aliq_ibs      NUMERIC(7,4) NOT NULL DEFAULT 0 CHECK (aliq_ibs >= 0),
    aliq_cbs      NUMERIC(7,4) NOT NULL DEFAULT 0 CHECK (aliq_cbs >= 0),
    regime        TEXT         NOT NULL DEFAULT 'split' CHECK (regime IN ('split', 'destaque')),
    vigente_desde DATE         NOT NULL DEFAULT CURRENT_DATE,
    idfuncionario BIGINT       REFERENCES funcionario (id),
    criado_em     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_tributo_vigencia ON tributo_config (vigente_desde DESC);

-- tributo segregado por evento de caixa. `origem`:
--   'consumo' → idorigem = consumo.id (receita de hospedagem/consumo)
--   'baixa'   → idorigem = baixa_lancamento.id (recebimento avulso)
CREATE TABLE split_payment (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    origem        TEXT         NOT NULL CHECK (origem IN ('consumo', 'baixa')),
    idorigem      BIGINT       NOT NULL,
    base          NUMERIC(12,2) NOT NULL,
    aliq_ibs      NUMERIC(7,4) NOT NULL,
    aliq_cbs      NUMERIC(7,4) NOT NULL,
    valor_ibs     NUMERIC(12,2) NOT NULL,
    valor_cbs     NUMERIC(12,2) NOT NULL,
    valor_liquido NUMERIC(12,2) NOT NULL,
    -- primeiro dia do mês de apuração
    competencia   DATE         NOT NULL,
    status        split_status NOT NULL DEFAULT 'provisionado',
    criado_em     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (origem, idorigem)
);
CREATE INDEX idx_split_competencia ON split_payment (competencia, status);

-- fechamento mensal: marca todos os provisionamentos do mês como recolhidos
CREATE TABLE tributo_apuracao (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    competencia   DATE         NOT NULL UNIQUE,
    valor_ibs     NUMERIC(12,2) NOT NULL,
    valor_cbs     NUMERIC(12,2) NOT NULL,
    status        TEXT         NOT NULL DEFAULT 'recolhida' CHECK (status IN ('recolhida')),
    recolhido_em  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    idfuncionario BIGINT       REFERENCES funcionario (id),
    criado_em     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- seeds
-- ---------------------------------------------------------------------------

-- conta padrão: caixa físico da recepção
INSERT INTO conta_financeira (nome, tipo, saldo_inicial) VALUES
    ('Caixa da Recepção', 'caixa', 0),
    ('Conta Bancária Principal', 'banco', 0);

-- plano de contas enxuto de pousada, já mapeado para grupos do DRE
INSERT INTO plano_conta (codigo, nome, tipo, grupo_dre, sistema) VALUES
    -- receitas (somam na receita bruta do DRE)
    ('1.01', 'Hospedagem e diárias',        'receber', 'receita_bruta', TRUE),
    ('1.02', 'Alimentos e bebidas',         'receber', 'receita_bruta', TRUE),
    ('1.03', 'Serviços (lavanderia, passeios)', 'receber', 'receita_bruta', TRUE),
    ('1.04', 'Eventos e locações',          'receber', 'receita_bruta', TRUE),
    ('1.99', 'Outras receitas',             'receber', 'receita_bruta', TRUE),
    -- deduções da receita (descontos, tributos, devoluções)
    ('2.01', 'Descontos e abatimentos',     'pagar',   'deducoes', TRUE),
    ('2.02', 'Tributos sobre receita (IBS/CBS)', 'pagar', 'deducoes', TRUE),
    -- custos diretos da operação
    ('3.01', 'Custo de mercadorias vendidas (CMV)', 'pagar', 'custos', TRUE),
    ('3.02', 'Comissões de OTAs e agências', 'pagar',  'custos', TRUE),
    -- despesas operacionais
    ('4.01', 'Pessoal e encargos',          'pagar',   'despesas_operacionais', TRUE),
    ('4.02', 'Energia, água e utilidades',  'pagar',   'despesas_operacionais', TRUE),
    ('4.03', 'Manutenção e reparos',        'pagar',   'despesas_operacionais', TRUE),
    ('4.04', 'Limpeza e lavanderia',        'pagar',   'despesas_operacionais', TRUE),
    ('4.05', 'Marketing e vendas',          'pagar',   'despesas_operacionais', TRUE),
    ('4.06', 'Administrativo e escritório', 'pagar',   'despesas_operacionais', TRUE),
    ('4.07', 'Internet, TV e telefonia',    'pagar',   'despesas_operacionais', TRUE),
    -- resultado financeiro (juros, tarifas, rendimentos)
    ('5.01', 'Juros e multas',              'pagar',   'resultado_financeiro', TRUE),
    ('5.02', 'Tarifas bancárias',           'pagar',   'resultado_financeiro', TRUE),
    ('5.03', 'Receitas financeiras',        'receber', 'resultado_financeiro', TRUE),
    -- outras
    ('6.01', 'Outras despesas',             'pagar',   'outras', TRUE),
    ('6.02', 'Outras receitas não operacionais', 'receber', 'outras', TRUE);

-- alíquotas do ano piloto da Reforma Tributária (2026): CBS 0,9% + IBS 0,1%
INSERT INTO tributo_config (aliq_ibs, aliq_cbs, regime, vigente_desde)
VALUES (0.1, 0.9, 'split', '2026-01-01');

COMMIT;
