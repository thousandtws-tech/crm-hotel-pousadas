-- Conformidade legal — LGPD 13.709/18, ECA 8.069/90, CDC 8.078/90, MTur.
--
-- LGPD: consentimento de marketing separado do transacional, opt-out por
-- canal, anonimização preservando trilha fiscal/FNRH (art. 16 — obrigação
-- legal), solicitações do titular (art. 18) e retenção configurável.
--
-- ECA: menor desacompanhado exige autorização documentada dos pais —
-- `autorizacao_menor` guarda a referência do documento no check-in.
--
-- CDC: política de cancelamento escalonada divulgada antes do pagamento
-- e aceite registrado com data+IP (art. 6º/46 — oferta vincula).

ALTER TABLE cliente
    ADD COLUMN IF NOT EXISTS consent_marketing   bool NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS consent_em          timestamptz,
    ADD COLUMN IF NOT EXISTS lgpd_opt_out        bool NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS lgpd_opt_out_em     timestamptz,
    ADD COLUMN IF NOT EXISTS lgpd_opt_out_canal  text,
    ADD COLUMN IF NOT EXISTS anonimizado_em      timestamptz;

ALTER TABLE estabelecimento
    ADD COLUMN IF NOT EXISTS cadastur              text,
    ADD COLUMN IF NOT EXISTS politica_cancelamento jsonb NOT NULL
        DEFAULT '{"faixas":[{"ate_dias":15,"pct":100},{"ate_dias":7,"pct":50},{"ate_dias":0,"pct":0}]}',
    ADD COLUMN IF NOT EXISTS retencao_dados_anos   int NOT NULL DEFAULT 5,
    ADD COLUMN IF NOT EXISTS dpo_email             text;

ALTER TABLE reserva
    ADD COLUMN IF NOT EXISTS termos_aceitos_em timestamptz,
    ADD COLUMN IF NOT EXISTS termos_aceitos_ip text,
    ADD COLUMN IF NOT EXISTS autorizacao_menor text;

CREATE TABLE IF NOT EXISTS lgpd_solicitacao (
    id             bigserial PRIMARY KEY,
    idcliente      bigint REFERENCES cliente(id),
    idreserva      bigint REFERENCES reserva(id),
    tipo           text NOT NULL CHECK (tipo IN
        ('acesso','retificacao','eliminacao','portabilidade','revogacao')),
    detalhe        text,
    canal          text NOT NULL DEFAULT 'portal',
    status         text NOT NULL DEFAULT 'aberta'
                   CHECK (status IN ('aberta','respondida','executada')),
    resposta       text,
    respondida_em  timestamptz,
    respondida_por bigint REFERENCES funcionario(id),
    criado_em      timestamptz NOT NULL DEFAULT now(),
    atualizado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_lgpd_sol_status ON lgpd_solicitacao (status, criado_em DESC);
CREATE INDEX IF NOT EXISTS ix_lgpd_sol_cliente ON lgpd_solicitacao (idcliente);
