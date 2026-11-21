-- A integração SERPRO (FNRH/API v2) entra no módulo de Integrações —
-- credenciais no cofre, ambientes teste (homologação) e produção.
-- Mesmo padrão da 0055 (infobip): estende o CHECK de integracao.provedor.

ALTER TABLE integracao DROP CONSTRAINT integracao_provedor_check;
ALTER TABLE integracao ADD CONSTRAINT integracao_provedor_check
    CHECK (provedor IN ('stripe', 'pagbank', 'mercadopago', 'zapi', 'spedy', 'didit', 'channex', 'infobip', 'serpro'));
