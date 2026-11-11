-- Eventos & Grupos: um grupo aloca N unidades num período (rooming list)
-- e vincula reservas. `bloquear` tira as unidades de venda via `bloqueio`.
CREATE TABLE IF NOT EXISTS grupo (
    id          bigserial PRIMARY KEY,
    nome        text NOT NULL,
    contato     text,
    obs         text,
    inicio      date NOT NULL,
    fim         date NOT NULL CHECK (fim > inicio),
    criado_por  bigint REFERENCES funcionario(id),
    criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS grupo_unidade (
    id              bigserial PRIMARY KEY,
    idgrupo         bigint NOT NULL REFERENCES grupo(id) ON DELETE CASCADE,
    idacomodacao    bigint NOT NULL REFERENCES acomodacao(id) ON DELETE RESTRICT,
    UNIQUE (idgrupo, idacomodacao)
);

ALTER TABLE reserva ADD COLUMN IF NOT EXISTS idgrupo bigint REFERENCES grupo(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_reserva_grupo ON reserva (idgrupo) WHERE idgrupo IS NOT NULL;

-- bloqueio criado por grupo é liberado em cascata ao remover o grupo
ALTER TABLE bloqueio ADD COLUMN IF NOT EXISTS idgrupo bigint REFERENCES grupo(id) ON DELETE CASCADE;
