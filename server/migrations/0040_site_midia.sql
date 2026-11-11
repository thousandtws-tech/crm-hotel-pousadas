-- Biblioteca de mídia do site institucional: imagens/vídeos usados nas
-- seções editáveis (hero, galeria, experiências…), servidos por /site-midia/{id}.
CREATE TABLE IF NOT EXISTS site_midia (
    id         BIGSERIAL PRIMARY KEY,
    caminho    TEXT NOT NULL UNIQUE,
    mime       TEXT NOT NULL,
    tipo       TEXT NOT NULL CHECK (tipo IN ('foto', 'video')),
    nome       TEXT NOT NULL DEFAULT '',
    criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_delta_site_midia ON site_midia;
CREATE TRIGGER trg_delta_site_midia
    AFTER INSERT OR UPDATE OR DELETE ON site_midia
    FOR EACH ROW EXECUTE FUNCTION notify_delta();
