-- Histórico de notificações (inbox estilo Facebook/GitHub):
--   `notificacao`        — 1 linha por evento (broadcast por nível, sem
--                          fan-out de linhas — a equipe é pequena);
--   `notificacao_lida`   — read receipt por funcionário; badge =
--                          COUNT(*) WHERE sem recibo.
-- Avisos publicados no EventBus são persistidos por um consumer
-- (spawn_aviso_persister) — desacoplado do caminho crítico do request.

CREATE TABLE notificacao (
    id          BIGSERIAL PRIMARY KEY,
    tipo        TEXT NOT NULL,          -- info | sucesso | alerta
    titulo      TEXT NOT NULL,
    mensagem    TEXT NOT NULL,
    ate_nivel   SMALLINT NOT NULL DEFAULT 3,   -- 1=só admin, 3=todos
    autor_id    BIGINT,
    autor_nome  TEXT,
    dados       JSONB,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notificacao_inbox ON notificacao (ate_nivel, id DESC);

CREATE TABLE notificacao_lida (
    idnotificacao BIGINT NOT NULL REFERENCES notificacao(id) ON DELETE CASCADE,
    idfuncionario BIGINT NOT NULL REFERENCES funcionario(id) ON DELETE CASCADE,
    lida_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (idnotificacao, idfuncionario)
);
