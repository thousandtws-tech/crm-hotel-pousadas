-- 0026_early_late.sql — Early check-in / late checkout com taxas
-- configuráveis. Flags na reserva alimentam o total usado no cálculo
-- do sinal (consumo.valor_estadia já inclui as taxas na criação).

ALTER TABLE reserva
    ADD COLUMN IF NOT EXISTS early_checkin BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS late_checkout BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE estabelecimento
    ADD COLUMN IF NOT EXISTS taxa_early NUMERIC(12,2) NOT NULL DEFAULT 0
        CHECK (taxa_early >= 0),
    ADD COLUMN IF NOT EXISTS taxa_late NUMERIC(12,2) NOT NULL DEFAULT 0
        CHECK (taxa_late >= 0);
