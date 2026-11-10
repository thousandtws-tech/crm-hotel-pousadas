-- Pré-reserva via WhatsApp — máquina de estados por telefone.
-- A Inná cotuca datas/preço disponibilidade real, o hóspede confirma
-- explicitamente e recebe o link oficial do sinal (Stripe) ou a chave
-- Pix conferida pela Recepção. Estado expira em 24h.

CREATE TABLE IF NOT EXISTS pre_reserva (
    telefone   text PRIMARY KEY,
    etapa      text NOT NULL CHECK (etapa IN ('datas', 'nome', 'confirmacao')),
    dados      jsonb NOT NULL DEFAULT '{}',
    criado_em  timestamptz NOT NULL DEFAULT now(),
    expira_em  timestamptz NOT NULL
);
