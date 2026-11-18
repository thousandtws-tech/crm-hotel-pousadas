-- 0052 — Monitor de falhas operacionais.
--
-- alerta_operacional — dedup durável dos alertas do monitor: cada
-- ocorrência (item da fila_envio falho/desconhecido, documento fiscal
-- rejeitado/falha) dispara no máximo um alerta interno na vida dela,
-- entre réplicas e restarts. Funciona como watermark distribuído: em
-- vez de guardar "até onde varri", guarda "o que já alertei" — nenhuma
-- falha tardia (retry longo) escapa e nenhuma repete.
--
-- Canal de entrega: o monitor publica Aviso no EventBus → persister
-- grava em `notificacao` (sino do admin) → relay `clarituz_aviso`
-- entrega em todas as réplicas via SSE.

CREATE TABLE alerta_operacional (
    dedup_key TEXT        PRIMARY KEY,
    origem    TEXT        NOT NULL,          -- 'fila_envio' | 'fiscal_documento'
    id_origem BIGINT      NOT NULL,
    titulo    TEXT        NOT NULL,
    mensagem  TEXT        NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_alerta_operacional_origem
    ON alerta_operacional (origem, criado_em DESC);

-- Varreduras do monitor ficam baratas: falhas são um subconjunto
-- pequeno e o índice parcial evita full scan nas tabelas operacionais.
CREATE INDEX IF NOT EXISTS idx_fila_envio_falha
    ON fila_envio (id) WHERE status IN ('falhou', 'desconhecido');
CREATE INDEX IF NOT EXISTS idx_fiscal_doc_falha_monitor
    ON fiscal_documento (id) WHERE status IN ('rejeitada', 'falha');
