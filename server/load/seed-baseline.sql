-- Seed mínimo para o baseline de carga (docs/load-baseline.md).
-- Idempotente — pode rodar quantas vezes quiser.
-- Requer migrations aplicadas (0002 já semeia forma_pagamento/tipo_acomodacao).
--
-- Uso:
--   psql "postgres://clarituz:clarituz@localhost:5432/clarituz" -f server/load/seed-baseline.sql

BEGIN;

-- Cliente adulto usado pelo ciclo admin reserva→check-in→check-out.
INSERT INTO cliente (nome, cpf, data_nascimento, email, telefone) VALUES
    ('Load Baseline', '00000000191', '1990-01-01', 'loadbaseline@example.invalid', '11900000000')
ON CONFLICT (cpf) DO NOTHING;

-- 4 acomodações ativas — espalham as reservas do ciclo e alimentam o catálogo.
INSERT INTO acomodacao (idtipo_acomodacao, nome, numero, valor, capacidade) VALUES
    (1, 'Suíte Baseline A', 901, 250.00, 2),
    (1, 'Suíte Baseline B', 902, 250.00, 2),
    (1, 'Suíte Baseline C', 903, 300.00, 3),
    (1, 'Suíte Baseline D', 904, 300.00, 4)
ON CONFLICT (numero) DO NOTHING;

-- Publicação no CMS — sem isso GET /publico/acomodacoes devolve [] e o
-- cenário browse não exerce o caminho de detalhe.
INSERT INTO acomodacao_cms (idacomodacao, slug, status, publicado_em)
SELECT a.id, 'suite-baseline-' || lower(substring(a.nome from '.$')), 'publicado', now()
FROM acomodacao a
WHERE a.numero BETWEEN 901 AND 904
ON CONFLICT (idacomodacao) DO NOTHING;

COMMIT;

-- Confere: deve listar o id do cliente 'Load Baseline' (usar em -e IDCLIENTE=…)
SELECT id, nome, cpf FROM cliente WHERE cpf = '00000000191';
SELECT a.id, a.numero, c.slug, c.status
FROM acomodacao a JOIN acomodacao_cms c ON c.idacomodacao = a.id
WHERE a.numero BETWEEN 901 AND 904 ORDER BY a.numero;
