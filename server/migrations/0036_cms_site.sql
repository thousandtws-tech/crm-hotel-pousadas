-- Site builder: seções editáveis do site institucional (hero, FAQ, SEO…).
CREATE TABLE IF NOT EXISTS cms_site (
    id            bigserial PRIMARY KEY,
    secao         text NOT NULL UNIQUE,
    dados         jsonb NOT NULL DEFAULT '{}'::jsonb,
    ordem         integer NOT NULL DEFAULT 0,
    visivel       boolean NOT NULL DEFAULT true,
    atualizado_em timestamptz NOT NULL DEFAULT now()
);
