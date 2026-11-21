-- =============================================================================
-- Seed: 30 acomodações da pousada + páginas CMS publicadas (Site / Quartos)
-- Idempotente: ON CONFLICT pula o que já existir (numero/slug são UNIQUE).
-- Uso: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/scripts/seed-30-acomodacoes.sql
-- =============================================================================
BEGIN;

-- tipos de acomodação -----------------------------------------------------------
INSERT INTO tipo_acomodacao (nome) VALUES
    ('Standard'),
    ('Superior Vista Mar'),
    ('Suíte Família'),
    ('Suíte Master')
ON CONFLICT (nome) DO NOTHING;

-- Térreo: 101-110 Standard ------------------------------------------------------
INSERT INTO acomodacao (idtipo_acomodacao, nome, numero, valor, capacidade, descricao, cor, andar)
SELECT t.id, 'Standard ' || n, n, 280.00, 2,
       'Quarto aconchegante no térreo, a poucos passos da recepção e do café da manhã.',
       '#5B8A9C', 0
FROM generate_series(101, 110) AS n, tipo_acomodacao t
WHERE t.nome = 'Standard'
ON CONFLICT (numero) DO NOTHING;

-- 1º andar: 201-210 Superior Vista Mar ------------------------------------------
INSERT INTO acomodacao (idtipo_acomodacao, nome, numero, valor, capacidade, descricao, cor, andar)
SELECT t.id, 'Superior Vista Mar ' || n, n, 380.00, 3,
       'Quarto amplo no 1º andar com vista parcial para o mar.',
       '#0F4C5C', 1
FROM generate_series(201, 210) AS n, tipo_acomodacao t
WHERE t.nome = 'Superior Vista Mar'
ON CONFLICT (numero) DO NOTHING;

-- 2º andar: 301-306 Suíte Família ------------------------------------------------
INSERT INTO acomodacao (idtipo_acomodacao, nome, numero, valor, capacidade, descricao, cor, andar)
SELECT t.id, 'Suíte Família ' || n, n, 450.00, 4,
       'Suíte espaçosa no 2º andar, ideal para famílias — vista para o mar.',
       '#8A5A1E', 2
FROM generate_series(301, 306) AS n, tipo_acomodacao t
WHERE t.nome = 'Suíte Família'
ON CONFLICT (numero) DO NOTHING;

-- 2º andar: 307-310 Suíte Master -------------------------------------------------
INSERT INTO acomodacao (idtipo_acomodacao, nome, numero, valor, capacidade, descricao, cor, andar)
SELECT t.id, 'Suíte Master ' || n, n, 580.00, 2,
       'Suíte premium com varanda e vista panorâmica para o mar.',
       '#0F766E', 2
FROM generate_series(307, 310) AS n, tipo_acomodacao t
WHERE t.nome = 'Suíte Master'
ON CONFLICT (numero) DO NOTHING;

-- páginas CMS (Site / Quartos) — uma por acomodação, já publicadas ---------------
INSERT INTO acomodacao_cms (
    idacomodacao, slug, subtitulo, descricao_curta, camas, banheiros,
    metragem, vista, andar, comodidades, status, ordem, publicado_em
)
SELECT a.id,
       regexp_replace(
           translate(lower(a.nome), 'áàâãéêíóôõúüç', 'aaaaeeiooouuc'),
           '[^a-z0-9]+', '-', 'g'),
       c.sub, a.descricao, c.camas, 1, c.m2, c.vista, c.andar_txt,
       c.comodidades::jsonb, 'publicado', a.numero, now()
FROM acomodacao a
JOIN tipo_acomodacao t ON t.id = a.idtipo_acomodacao
JOIN (VALUES
    ('Standard',          'Conforto essencial a poucos passos do mar', '1 cama de casal',              18.0, 'Vista para o jardim',           'Térreo',   '["Wi-Fi","Ar-condicionado","TV Smart","Frigobar","Café da manhã incluso"]'),
    ('Superior Vista Mar','Vista parcial para o mar e mais espaço',     '1 cama de casal + 1 solteiro', 24.0, 'Vista parcial para o mar',        '1º andar', '["Wi-Fi","Ar-condicionado","TV Smart","Frigobar","Varanda","Café da manhã incluso"]'),
    ('Suíte Família',     'Espaço de sobra para toda a família',        '1 cama de casal + 2 solteiros',32.0, 'Vista para o mar',                '2º andar', '["Wi-Fi","Ar-condicionado","TV Smart","Frigobar","Sala integrada","Café da manhã incluso"]'),
    ('Suíte Master',      'Varanda com vista panorâmica do mar',        '1 cama king',                  36.0, 'Vista panorâmica para o mar',     '2º andar', '["Wi-Fi","Ar-condicionado","TV Smart","Frigobar","Varanda privativa","Banheira","Café da manhã incluso"]')
) AS c(tipo, sub, camas, m2, vista, andar_txt, comodidades) ON c.tipo = t.nome
ON CONFLICT (idacomodacao) DO NOTHING;

COMMIT;
