-- FNRH: assinatura desenhada opcional (flag da pousada).
ALTER TABLE estabelecimento
    ADD COLUMN IF NOT EXISTS fnrh_assinatura boolean NOT NULL DEFAULT false;
