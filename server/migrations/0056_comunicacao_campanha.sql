-- Campanhas de marketing via WhatsApp — blast para hóspedes com
-- consent_marketing (LGPD: opt-in explícito, separado do transacional).
-- Cada destinatário vira um item fila_envio com dedup_key
-- 'campanha:{id}:cliente:{id}' — disparo repetido nunca duplica envio.

CREATE TABLE IF NOT EXISTS comunicacao_campanha (
    id           BIGSERIAL PRIMARY KEY,
    nome         TEXT NOT NULL,
    texto        TEXT NOT NULL,
    criado_por   BIGINT REFERENCES funcionario(id),
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
    disparada_em TIMESTAMPTZ
);

DROP TRIGGER IF EXISTS trg_delta_comunicacao_campanha ON comunicacao_campanha;
CREATE TRIGGER trg_delta_comunicacao_campanha
    AFTER INSERT OR UPDATE OR DELETE ON comunicacao_campanha
    FOR EACH ROW EXECUTE FUNCTION notify_delta();
