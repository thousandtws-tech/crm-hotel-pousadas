-- Fechamento do dia: PIN gerencial que autoriza decisão de no-show.
ALTER TABLE estabelecimento
    ADD COLUMN IF NOT EXISTS pin_fechamento text;
