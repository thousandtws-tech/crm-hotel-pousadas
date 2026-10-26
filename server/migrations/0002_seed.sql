-- Seeds mínimos: formas de pagamento e categorias padrão do legado.

BEGIN;

INSERT INTO forma_pagamento (nome) VALUES
    ('Dinheiro'),
    ('Pix'),
    ('Cartão de Crédito'),
    ('Cartão de Débito'),
    ('Transferência Bancária')
ON CONFLICT (nome) DO NOTHING;

INSERT INTO categoria_estoque (nome) VALUES
    ('Bebidas'),
    ('Alimentos'),
    ('Higiene'),
    ('Limpeza'),
    ('Outros')
ON CONFLICT (nome) DO NOTHING;

INSERT INTO tipo_acomodacao (nome) VALUES
    ('Standard'),
    ('Luxo'),
    ('Suíte Master')
ON CONFLICT (nome) DO NOTHING;

COMMIT;
