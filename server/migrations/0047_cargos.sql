-- Cargos — título + nível de acesso configuráveis. `funcionario.nivel`
-- continua autoridade do RBAC e é sincronizado a partir do cargo escolhido;
-- `sistema` marca os três cargos-base (não removíveis, nível travado).
BEGIN;

CREATE TABLE cargo (
    id            BIGSERIAL    PRIMARY KEY,
    nome          TEXT         NOT NULL UNIQUE,
    descricao     TEXT,
    nivel         SMALLINT     NOT NULL CHECK (nivel IN (1, 2, 3)),
    ativo         BOOLEAN      NOT NULL DEFAULT true,
    sistema       BOOLEAN      NOT NULL DEFAULT false,
    criado_em     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ  NOT NULL DEFAULT now()
);

INSERT INTO cargo (nome, descricao, nivel, sistema) VALUES
    ('Administrador', 'Acesso total ao sistema', 1, true),
    ('Gerente',       'Recepção + relatórios',   2, true),
    ('Recepção',      'Opera o dia a dia',       3, true);

ALTER TABLE funcionario
    ADD COLUMN cargo_id BIGINT REFERENCES cargo (id);

UPDATE funcionario f
   SET cargo_id = c.id
  FROM cargo c
 WHERE c.nivel = f.nivel AND c.sistema;

ALTER TABLE funcionario ALTER COLUMN cargo_id SET NOT NULL;

CREATE TRIGGER trg_delta_cargo AFTER INSERT OR UPDATE OR DELETE ON cargo
    FOR EACH ROW EXECUTE FUNCTION notify_delta();

COMMIT;
