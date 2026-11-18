-- A 0048 adicionou o provedor 'channex' na camada de aplicação mas não
-- estendeu os CHECKs da tabela integracao — todo INSERT falhava com
-- violação de integridade (save da integração retornava 422).

ALTER TABLE integracao DROP CONSTRAINT integracao_provedor_check;
ALTER TABLE integracao ADD CONSTRAINT integracao_provedor_check
    CHECK (provedor IN ('stripe', 'pagbank', 'mercadopago', 'zapi', 'spedy', 'didit', 'channex'));

ALTER TABLE integracao DROP CONSTRAINT integracao_categoria_check;
ALTER TABLE integracao ADD CONSTRAINT integracao_categoria_check
    CHECK (categoria IN ('pagamento', 'comunicacao', 'fiscal', 'seguranca', 'distribuicao'));
