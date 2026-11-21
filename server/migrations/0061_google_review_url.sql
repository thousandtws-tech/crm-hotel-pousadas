-- Reputation management: link público de avaliação do Google — enviado
-- ao hóspede promotor (nota alta) na tela pós-avaliação e por mensagem.
ALTER TABLE estabelecimento
    ADD COLUMN IF NOT EXISTS google_review_url TEXT;
