-- Upsell via portal do hóspede — pagamento de extras (early check-in,
-- late checkout, upgrade) com confirmação exclusiva por webhook.
-- `contexto` identifica qual extra aplicar na liquidação; o efeito na
-- reserva é idempotente (flags) ou protegido pela exclusão de overlap
-- (troca de acomodação).

ALTER TYPE pagamento_tipo ADD VALUE IF NOT EXISTS 'extra';

ALTER TABLE pagamento_online
    ADD COLUMN IF NOT EXISTS contexto JSONB;
