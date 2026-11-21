-- Menu determinístico do WhatsApp — primeiro contato recebe
-- "1-Reservas 2-Check-in 3-Atendente" antes da MARIA.
-- Registro permanente por telefone (não expira como pre_reserva):
-- 'aguardando' = menu enviado, esperando escolha;
-- 'concluido'  = já passou pelo menu — nunca mais interrompe.
-- ultimo_wamid deduplica reentrega do provedor (Meta/Z-API).

CREATE TABLE IF NOT EXISTS wa_menu (
    telefone      text        PRIMARY KEY,
    estado        text        NOT NULL DEFAULT 'aguardando',
    ultimo_wamid  text,
    criado_em     timestamptz NOT NULL DEFAULT now(),
    atualizado_em timestamptz NOT NULL DEFAULT now()
);
