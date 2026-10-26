-- Impressoras térmicas por setor (KOT — Kitchen Order Ticket).
-- Cada setor de produção (cozinha, churrasqueira, bar, balcão...) tem sua
-- impressora de rede; a categoria do item decide para qual impressora o
-- ticket de produção é roteado. `padrao` marca a impressora de comprovantes.
CREATE TABLE impressora (
    id        BIGSERIAL    PRIMARY KEY,
    nome      TEXT         NOT NULL UNIQUE,
    setor     TEXT         NOT NULL,
    ip        TEXT         NOT NULL,
    porta     INTEGER      NOT NULL DEFAULT 9100,
    ativa     BOOLEAN      NOT NULL DEFAULT TRUE,
    padrao    BOOLEAN      NOT NULL DEFAULT FALSE,
    criado_em TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- no máximo uma impressora padrão (comprovantes/recibos)
CREATE UNIQUE INDEX uq_impressora_padrao ON impressora (padrao) WHERE padrao;

-- roteamento: categoria do item de estoque → impressora do setor
ALTER TABLE categoria_estoque
    ADD COLUMN impressora_id BIGINT REFERENCES impressora (id) ON DELETE SET NULL;

-- migra a configuração legada de impressora única do estabelecimento
-- para a tabela de setores (como impressora padrão de comprovantes)
INSERT INTO impressora (nome, setor, ip, porta, ativa, padrao)
SELECT 'Caixa / Comprovantes', 'caixa', impressora_ip, impressora_porta,
       impressora_ativa, TRUE
FROM estabelecimento
WHERE impressora_ip IS NOT NULL AND btrim(impressora_ip) <> '';
