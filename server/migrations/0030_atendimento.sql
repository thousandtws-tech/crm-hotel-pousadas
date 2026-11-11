-- Roteamento inteligente — protocolos de atendimento por setor com SLA.
-- Escalada da Inná (portal/WhatsApp) abre protocolo; worker escala o que
-- vencer o prazo de aceite. Urgências alertam recepção+gerência na hora.

CREATE TABLE IF NOT EXISTS atendimento (
    id            bigserial PRIMARY KEY,
    protocolo     text NOT NULL UNIQUE,
    origem        text NOT NULL CHECK (origem IN ('whatsapp','portal','interno')),
    setor         text NOT NULL CHECK (setor IN ('recepcao','governanca','manutencao','gerencia')),
    prioridade    text NOT NULL DEFAULT 'normal' CHECK (prioridade IN ('normal','urgente')),
    status        text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','em_atendimento','escalado','resolvido','encerrado')),
    telefone      text,
    idreserva     bigint,
    idcliente     bigint,
    assunto       text NOT NULL,
    ultima_msg    text,
    motivo        text,
    idfuncionario bigint,
    prazo_aceite  timestamptz NOT NULL,
    criado_em     timestamptz NOT NULL DEFAULT now(),
    atribuido_em  timestamptz,
    escalado_em   timestamptz,
    resolvido_em  timestamptz
);

CREATE INDEX IF NOT EXISTS atendimento_fila_idx ON atendimento (status, setor);
CREATE INDEX IF NOT EXISTS atendimento_prazo_idx ON atendimento (prazo_aceite) WHERE status IN ('aberto','escalado');
