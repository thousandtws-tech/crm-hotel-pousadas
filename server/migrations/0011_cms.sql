-- ============================================================================
-- CMS de quartos — conteúdo editorial do site público, por acomodação.
--
-- Modelo draft/publish (como em PMS + CMS de hotelaria):
--  * `acomodacao_cms` guarda o conteúdo de marketing (1:1 com `acomodacao`);
--  * `status = 'rascunho' | 'publicado'` — o site só enxerga `publicado`;
--  * `acomodacao_midia` guarda fotos/vídeos (metadados; o binário fica em
--    `storage_dir/cms/{idacomodacao}/`);
--  * preço exibido no site NÃO mora aqui — vem de `acomodacao.valor`
--    (diária real do PMS, já com histórico tarifário).
--
-- Realtime: os dois `notify_delta` propagam INSERT/UPDATE/DELETE para o
-- SSE — o admin vê mudanças entre abas e o site público atualiza sozinho.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- conteúdo editorial (1:1 com acomodacao)
-- ---------------------------------------------------------------------------

CREATE TABLE acomodacao_cms (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idacomodacao      BIGINT      NOT NULL UNIQUE REFERENCES acomodacao (id) ON DELETE CASCADE,
    slug              TEXT        NOT NULL UNIQUE,
    subtitulo         TEXT,
    descricao_curta   TEXT,
    descricao_longa   TEXT,
    destaque_editorial TEXT,       -- citação/frase de efeito da página de detalhe
    camas             TEXT,        -- ex.: "1 cama de casal + 1 solteiro"
    banheiros         INTEGER,
    metragem          NUMERIC(7,2) CHECK (metragem IS NULL OR metragem > 0),
    vista             TEXT,        -- ex.: "Vista para o jardim"
    andar             TEXT,        -- ex.: "Térreo"
    comodidades       JSONB        NOT NULL DEFAULT '[]'::jsonb,
    status            TEXT        NOT NULL DEFAULT 'rascunho'
                                  CHECK (status IN ('rascunho', 'publicado')),
    destaque          BOOLEAN     NOT NULL DEFAULT FALSE,
    ordem             INTEGER     NOT NULL DEFAULT 0,
    publicado_em      TIMESTAMPTZ,
    version           BIGINT      NOT NULL DEFAULT 1,
    criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_acomodacao_cms_status ON acomodacao_cms (status) WHERE status = 'publicado';

-- ---------------------------------------------------------------------------
-- mídia (fotos e vídeos)
-- ---------------------------------------------------------------------------

CREATE TABLE acomodacao_midia (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idacomodacao BIGINT      NOT NULL REFERENCES acomodacao (id) ON DELETE CASCADE,
    tipo         TEXT        NOT NULL CHECK (tipo IN ('foto', 'video')),
    caminho      TEXT        NOT NULL,      -- caminho absoluto no storage_dir
    mime         TEXT        NOT NULL,
    capa         BOOLEAN     NOT NULL DEFAULT FALSE,
    ordem        INTEGER     NOT NULL DEFAULT 0,
    version      BIGINT      NOT NULL DEFAULT 1,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_acomodacao_midia_acom ON acomodacao_midia (idacomodacao, ordem);

-- Uma capa por acomodação (quando houver capa definida).
CREATE UNIQUE INDEX idx_acomodacao_midia_capa
    ON acomodacao_midia (idacomodacao) WHERE capa;

-- ---------------------------------------------------------------------------
-- optimistic locking (mesmo padrão das demais tabelas)
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_acomodacao_cms_version   BEFORE UPDATE ON acomodacao_cms   FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_acomodacao_midia_version BEFORE UPDATE ON acomodacao_midia FOR EACH ROW EXECUTE FUNCTION bump_version();

-- ---------------------------------------------------------------------------
-- realtime — deltas para admin (abas) e site público (SSE)
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_delta_acomodacao_cms   AFTER INSERT OR UPDATE OR DELETE ON acomodacao_cms   FOR EACH ROW EXECUTE FUNCTION notify_delta();
CREATE TRIGGER trg_delta_acomodacao_midia AFTER INSERT OR UPDATE OR DELETE ON acomodacao_midia FOR EACH ROW EXECUTE FUNCTION notify_delta();

COMMIT;
