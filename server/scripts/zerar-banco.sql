-- ============================================================================
-- zerar-banco.sql — zera TODOS os dados do banco preservando APENAS:
--   · integracao  (+ integracao_segredo, integracao_padrao)
--   · _sqlx_migrations (histórico — o schema não é recriado)
--
-- Ao final, os seeds de instalação das migrations são reexecutados
-- (cargos, plano de contas, formas de pagamento, ...) — o banco volta
-- ao estado pós-instalação com as integrações intactas. Cada seed só
-- roda se a tabela existir (bancos atrás de migration pulam o que
-- ainda não existe — a própria migration cria+sêmea depois).
--
-- O primeiro usuário sai zerado junto; recrie o admin com:
--   cargo run -p clarituz-api -- create-admin \
--       --login admin --nome "Administrador" --senha "<senha-forte>"
-- (na produção: railway run -- cargo run -p clarituz-api -- create-admin ...)
--
-- USO:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f zerar-banco.sql
-- ============================================================================

BEGIN;

-- Atores de auditoria que `integracao` guarda em `funcionario` — solta
-- antes do wipe para a integração sobreviver sem depender de dados
-- que serão apagados.
UPDATE integracao        SET criado_por = NULL, atualizado_por = NULL;
UPDATE integracao_padrao SET atualizado_por = NULL;

-- FKs e triggers desligados durante o wipe: permite apagar em qualquer
-- ordem e impede que qualquer cascade alcance as tabelas preservadas.
SET LOCAL session_replication_role = 'replica';

DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN
        SELECT tablename
          FROM pg_tables
         WHERE schemaname = 'public'
           AND tablename NOT IN (
               'integracao', 'integracao_segredo', 'integracao_padrao',
               '_sqlx_migrations')
    LOOP
        EXECUTE format('DELETE FROM %I', t.tablename);
    END LOOP;
END $$;

-- Identidades reiniciam — EXCETO as das tabelas preservadas (restart
-- faria o próximo id colidir com a integração existente).
DO $$
DECLARE
    s RECORD;
BEGIN
    FOR s IN
        SELECT c.relname AS seq
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind = 'S'
           AND n.nspname = 'public'
           AND c.relname NOT IN
               ('integracao_id_seq', 'integracao_segredo_id_seq')
    LOOP
        EXECUTE format('ALTER SEQUENCE %I RESTART', s.seq);
    END LOOP;
END $$;

SET LOCAL session_replication_role = 'origin';

-- ============================================================================
-- Replay dos seeds de instalação (verbatim das migrations) — cada um
-- só roda quando a tabela existe neste banco.
-- ============================================================================

DO $$
DECLARE
    seeds TEXT[] := ARRAY[
        -- 0002 — seeds mínimos do legado
        $s$INSERT INTO forma_pagamento (nome) VALUES
            ('Dinheiro'), ('Pix'), ('Cartão de Crédito'),
            ('Cartão de Débito'), ('Transferência Bancária')
           ON CONFLICT (nome) DO NOTHING$s$,
        $s$INSERT INTO categoria_estoque (nome) VALUES
            ('Bebidas'), ('Alimentos'), ('Higiene'), ('Limpeza'), ('Outros')
           ON CONFLICT (nome) DO NOTHING$s$,
        $s$INSERT INTO tipo_acomodacao (nome) VALUES
            ('Standard'), ('Luxo'), ('Suíte Master')
           ON CONFLICT (nome) DO NOTHING$s$,

        -- 0004 — impressora padrão a partir do estabelecimento
        $s$INSERT INTO impressora (nome, setor, ip, porta, ativa, padrao)
           SELECT 'Caixa / Comprovantes', 'caixa', impressora_ip,
                  impressora_porta, impressora_ativa, TRUE
             FROM estabelecimento
            WHERE impressora_ip IS NOT NULL AND btrim(impressora_ip) <> ''$s$,

        -- 0012 — contas padrão + plano de contas + tributos
        $s$INSERT INTO conta_financeira (nome, tipo, saldo_inicial) VALUES
            ('Caixa da Recepção', 'caixa', 0),
            ('Conta Bancária Principal', 'banco', 0)$s$,
        $s$INSERT INTO plano_conta (codigo, nome, tipo, grupo_dre, sistema) VALUES
            ('1.01', 'Hospedagem e diárias',        'receber', 'receita_bruta', TRUE),
            ('1.02', 'Alimentos e bebidas',         'receber', 'receita_bruta', TRUE),
            ('1.03', 'Serviços (lavanderia, passeios)', 'receber', 'receita_bruta', TRUE),
            ('1.04', 'Eventos e locações',          'receber', 'receita_bruta', TRUE),
            ('1.99', 'Outras receitas',             'receber', 'receita_bruta', TRUE),
            ('2.01', 'Descontos e abatimentos',     'pagar',   'deducoes', TRUE),
            ('2.02', 'Tributos sobre receita (IBS/CBS)', 'pagar', 'deducoes', TRUE),
            ('3.01', 'Custo de mercadorias vendidas (CMV)', 'pagar', 'custos', TRUE),
            ('3.02', 'Comissões de OTAs e agências', 'pagar',  'custos', TRUE),
            ('4.01', 'Pessoal e encargos',          'pagar',   'despesas_operacionais', TRUE),
            ('4.02', 'Energia, água e utilidades',  'pagar',   'despesas_operacionais', TRUE),
            ('4.03', 'Manutenção e reparos',        'pagar',   'despesas_operacionais', TRUE),
            ('4.04', 'Limpeza e lavanderia',        'pagar',   'despesas_operacionais', TRUE),
            ('4.05', 'Marketing e vendas',          'pagar',   'despesas_operacionais', TRUE),
            ('4.06', 'Administrativo e escritório', 'pagar',   'despesas_operacionais', TRUE),
            ('4.07', 'Internet, TV e telefonia',    'pagar',   'despesas_operacionais', TRUE),
            ('5.01', 'Juros e multas',              'pagar',   'resultado_financeiro', TRUE),
            ('5.02', 'Tarifas bancárias',           'pagar',   'resultado_financeiro', TRUE),
            ('5.03', 'Receitas financeiras',        'receber', 'resultado_financeiro', TRUE),
            ('6.01', 'Outras despesas',             'pagar',   'outras', TRUE),
            ('6.02', 'Outras receitas não operacionais', 'receber', 'outras', TRUE)$s$,
        $s$INSERT INTO tributo_config (aliq_ibs, aliq_cbs, regime, vigente_desde)
           VALUES (0.1, 0.9, 'split', '2026-01-01')$s$,

        -- 0014 / 0017 — acréscimos do PDV e insumos ao plano de contas
        $s$INSERT INTO plano_conta (codigo, nome, tipo, grupo_dre, sistema)
           VALUES ('3.03', 'Comissões de garçons', 'pagar', 'custos', TRUE)
           ON CONFLICT (codigo) DO NOTHING$s$,
        $s$INSERT INTO plano_conta (codigo, nome, tipo, grupo_dre, sistema)
           VALUES ('3.04', 'Compras de insumos (NF-e)', 'pagar', 'custos', TRUE)
           ON CONFLICT (codigo) DO NOTHING$s$,

        -- 0023 / 0066 — formas de pagamento dos gateways
        $s$INSERT INTO forma_pagamento (nome, especie) VALUES ('Stripe', FALSE)
           ON CONFLICT (nome) DO NOTHING$s$,
        $s$INSERT INTO forma_pagamento (nome, especie) VALUES
            ('PagBank', FALSE), ('Mercado Pago', FALSE)
           ON CONFLICT (nome) DO NOTHING$s$,

        -- 0024 — matriz de notificações + níveis de fidelidade
        $s$INSERT INTO notificacao_matriz (evento, canal, papel) VALUES
            ('pagamento.confirmado',   'inbox', 3),
            ('pagamento.falhou',       'inbox', 3),
            ('avaliacao.critica',      'inbox', 2),
            ('avaliacao.critica',      'email', 1),
            ('reserva.fnrh_pendente',  'inbox', 3)$s$,
        $s$INSERT INTO fidelidade_nivel (nome, min_diarias, desconto_pct, ordem) VALUES
            ('Bronze', 0,  0,  1),
            ('Prata',  7,  5,  2),
            ('Ouro',   20, 10, 3)$s$,

        -- 0047 — cargos (necessário para recriar o admin via create-admin)
        $s$INSERT INTO cargo (nome, descricao, nivel, sistema) VALUES
            ('Administrador', 'Acesso total ao sistema', 1, true),
            ('Gerente',       'Recepção + relatórios',   2, true),
            ('Recepção',      'Opera o dia a dia',       3, true)$s$,

        -- 0057 — respostas rápidas da central de comunicação
        $s$INSERT INTO comunicacao_resposta_rapida (atalho, titulo, texto, ordem) VALUES
            ('boasvindas',  'Boas-vindas',        'Olá! Seja bem-vindo(a) à Pousada Espírito do Mar. Como posso ajudar?', 1),
            ('checkin',     'Horário de check-in','O check-in é a partir das [14h]. Chegando mais cedo, nos avise que verificamos a disponibilidade de early check-in.', 2),
            ('checkout',    'Horário de check-out','O check-out é até as [12h]. Precisando de late check-out, é só consultar a recepção.', 3),
            ('wifi',        'Wi-Fi',              'A rede Wi-Fi da pousada é [nome-da-rede] e a senha é [senha].', 4),
            ('cafe',        'Café da manhã',      'O café da manhã é servido das [07h] às [10h] no [local].', 5),
            ('estacionamento','Estacionamento',   'Temos estacionamento [interno/parceiro] — [instruções de acesso ou valores].', 6),
            ('localizacao', 'Localização',        'Estamos na [endereço completo] — [ponto de referência / distância da praia].', 7),
            ('agradecimento','Agradecimento',     'Muito obrigado pela preferência! Será um prazer recebê-lo(a) novamente. — Equipe Pousada Espírito do Mar', 8),
            ('desculpa',    'Desculpa',           'Pedimos sinceras desculpas pelo inconveniente. Já estamos verificando e retornamos em instantes.', 9)$s$
    ];
    stmt  TEXT;
    alvo  TEXT;
BEGIN
    FOREACH stmt IN ARRAY seeds LOOP
        -- tabela-alvo = primeiro identificador após "INSERT INTO"
        alvo := substring(stmt from 'INSERT INTO ([a-z_]+)');
        IF alvo IS NOT NULL AND EXISTS (
            SELECT 1 FROM pg_tables
             WHERE schemaname = 'public' AND tablename = alvo
        ) THEN
            EXECUTE stmt;
        END IF;
    END LOOP;
END $$;

COMMIT;

-- Relatório do que sobreviveu e do que zerou
SELECT 'integracao'        AS tabela, COUNT(*) AS linhas FROM integracao
UNION ALL
SELECT 'integracao_segredo',        COUNT(*) FROM integracao_segredo
UNION ALL
SELECT 'integracao_padrao',         COUNT(*) FROM integracao_padrao
UNION ALL
SELECT 'cargo',                     COUNT(*) FROM cargo
UNION ALL
SELECT 'plano_conta',               COUNT(*) FROM plano_conta
UNION ALL
SELECT 'forma_pagamento',           COUNT(*) FROM forma_pagamento
UNION ALL
SELECT 'funcionario',               COUNT(*) FROM funcionario
UNION ALL
SELECT 'reserva',                   COUNT(*) FROM reserva
UNION ALL
SELECT 'cliente',                   COUNT(*) FROM cliente
UNION ALL
SELECT 'lancamento',                COUNT(*) FROM lancamento
UNION ALL
SELECT 'pagamento',                 COUNT(*) FROM pagamento
ORDER BY tabela;
