-- Foto do cliente (captura por webcam na recepção, como nos PMS de hotel).
--  * `foto TEXT` guarda apenas o caminho do arquivo em `storage_dir/clientes/`;
--  * o binário NÃO fica no banco — upload/serve via PUT/GET/DELETE
--    /clientes/{id}/foto (mesmo padrão da logo do estabelecimento);
--  * nullable — foto é opcional no cadastro.

ALTER TABLE cliente ADD COLUMN foto TEXT;
