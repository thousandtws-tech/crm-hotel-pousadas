-- Concorrência otimista (modelo Dataverse `rowversion`):
--  * `version BIGINT` em cada tabela editável, incrementada por trigger em
--    todo UPDATE — inclusive PATCHes de status — para invalidar formulários
--    obsoletos;
--  * PUTs de edição comparam `version` enviada pelo cliente: mismatch →
--    409 CONFLITO ("registro alterado por outro usuário");
--  * opt-in por requisição (como `IfRowVersionMatches`): quem não envia
--    `version` segue last-write-wins.

ALTER TABLE cliente               ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE funcionario           ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE tipo_acomodacao       ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE acomodacao            ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE quarto                ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE estacionamento        ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE categoria_estoque     ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE estoque               ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE frigobar              ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE item_frigobar         ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE forma_pagamento       ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE impressora            ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE estabelecimento       ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE endereco_estabelecimento ADD COLUMN version BIGINT NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION bump_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.version := OLD.version + 1;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cliente_version        BEFORE UPDATE ON cliente               FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_funcionario_version    BEFORE UPDATE ON funcionario           FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_tipoacom_version       BEFORE UPDATE ON tipo_acomodacao       FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_acomodacao_version     BEFORE UPDATE ON acomodacao            FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_quarto_version         BEFORE UPDATE ON quarto                FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_estacionamento_version BEFORE UPDATE ON estacionamento        FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_categoria_version      BEFORE UPDATE ON categoria_estoque     FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_estoque_version        BEFORE UPDATE ON estoque               FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_frigobar_version       BEFORE UPDATE ON frigobar              FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_itemfrigobar_version   BEFORE UPDATE ON item_frigobar         FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_formapag_version       BEFORE UPDATE ON forma_pagamento       FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_impressora_version     BEFORE UPDATE ON impressora            FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_estabelecimento_version BEFORE UPDATE ON estabelecimento      FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_endereco_version       BEFORE UPDATE ON endereco_estabelecimento FOR EACH ROW EXECUTE FUNCTION bump_version();
