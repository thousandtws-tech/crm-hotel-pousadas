-- Impressora térmica ESC/POS do estabelecimento (rede, porta RAW 9100).
ALTER TABLE estabelecimento
    ADD COLUMN impressora_ip     TEXT,
    ADD COLUMN impressora_porta  INTEGER NOT NULL DEFAULT 9100,
    ADD COLUMN impressora_ativa  BOOLEAN NOT NULL DEFAULT FALSE;
