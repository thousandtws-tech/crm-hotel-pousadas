-- Tarifa por data — diária diferenciada por período (fds, feriados,
-- alta temporada). Sobrepõe a tarifa por ocupação e a tarifa base para
-- as noites cobertas: a estadia é precificada noite a noite, cada uma
-- resolvendo tarifa_periodo > tarifa_ocupacao > acomodacao.valor.
-- Períodos podem se sobrepor; `prioridade` (depois `id` mais recente)
-- desempata — ex.: "Réveillon" ganha de "Alta temporada" dentro dele.
CREATE TABLE tarifa_periodo (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idacomodacao   BIGINT NOT NULL REFERENCES acomodacao (id) ON DELETE CASCADE,
    inicio         DATE   NOT NULL,
    fim            DATE   NOT NULL,
    valor          NUMERIC(12,2) NOT NULL CHECK (valor > 0),
    rotulo         TEXT,
    prioridade     SMALLINT NOT NULL DEFAULT 0,
    idfuncionario  BIGINT REFERENCES funcionario (id),
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (fim >= inicio)
);

CREATE INDEX idx_tarifa_periodo_acom ON tarifa_periodo (idacomodacao, inicio, fim);

COMMENT ON TABLE tarifa_periodo IS
    'Diária diferenciada por período — sobrepõe tarifa_ocupacao/base nas noites cobertas.';
COMMENT ON COLUMN tarifa_periodo.prioridade IS
    'Desempate quando períodos se sobrepõem — maior vence; mesmo valor, o id maior.';

CREATE TRIGGER trg_delta_tarifa_periodo
    AFTER INSERT OR UPDATE OR DELETE ON tarifa_periodo
    FOR EACH ROW EXECUTE FUNCTION notify_delta();
