-- ============================================================================
-- Canal SMS na fila de envio — adaptador Infobip.
--
-- fila_envio já carrega provedor/idintegracao/dedup_key/template_versao/
-- entregue_em — basta o valor de enum. bulkId e segmentos efetivos do
-- provedor viajam no payload do item (campos provider-específicos, mesmo
-- padrão do WhatsApp).
-- ============================================================================

ALTER TYPE canal_envio ADD VALUE IF NOT EXISTS 'sms';
