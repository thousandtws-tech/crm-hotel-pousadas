-- Pré-check-in digital — foto do documento enviada pelo hóspede na
-- pré-ficha pública. A imagem fica no object store; aqui guardamos
-- apenas a chave (mesmo padrão do scan de documento do cliente).
ALTER TABLE reserva
    ADD COLUMN fnrh_documento_key TEXT;

COMMENT ON COLUMN reserva.fnrh_documento_key IS
    'Chave no object store da foto do documento enviada na pré-ficha FNRH.';
