-- Pagamentos online (Stripe/PagBank/Mercado Pago) passam a espelhar no
-- financeiro: cada confirmação em `confirmar_pago` grava, na mesma tx,
-- `lancamento` receber liquidado + `baixa_lancamento` — alimenta Contas,
-- Fluxo de caixa, DRE e Conciliação. Reembolsos concluídos espelham
-- como título 'pagar' liquidado (estorno). Idempotente por
-- `lancamento.documento` = 'pagamento-{id}' / 'reembolso-{id}'.

BEGIN;

-- Formas de pagamento dos gateways (Stripe já semeado em 0023).
INSERT INTO forma_pagamento (nome, especie) VALUES
    ('PagBank',      FALSE),
    ('Mercado Pago', FALSE)
ON CONFLICT (nome) DO NOTHING;

COMMIT;
