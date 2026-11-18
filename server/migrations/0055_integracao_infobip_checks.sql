-- A integração Infobip adicionou o provedor 'infobip' na camada de
-- aplicação sem estender o CHECK de integracao.provedor — todo INSERT
-- falhava com violação de integridade (save retornava 422). Mesmo
-- padrão da 0050 (channex).

ALTER TABLE integracao DROP CONSTRAINT integracao_provedor_check;
ALTER TABLE integracao ADD CONSTRAINT integracao_provedor_check
    CHECK (provedor IN ('stripe', 'pagbank', 'mercadopago', 'zapi', 'spedy', 'didit', 'channex', 'infobip'));
