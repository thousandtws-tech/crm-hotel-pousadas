-- Captação de e-mails do rodapé do site institucional (newsletter/marketing).
-- E-mail único; reinscrição reativa em vez de duplicar.
CREATE TABLE IF NOT EXISTS newsletter_inscricao (
    id        BIGSERIAL PRIMARY KEY,
    email     TEXT NOT NULL UNIQUE,
    origem    TEXT NOT NULL DEFAULT 'site',
    ativo     BOOLEAN NOT NULL DEFAULT true,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_delta_newsletter_inscricao ON newsletter_inscricao;
CREATE TRIGGER trg_delta_newsletter_inscricao
    AFTER INSERT OR UPDATE OR DELETE ON newsletter_inscricao
    FOR EACH ROW EXECUTE FUNCTION notify_delta();
