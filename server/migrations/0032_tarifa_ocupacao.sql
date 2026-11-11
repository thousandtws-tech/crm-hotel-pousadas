-- Tarifa por ocupação: diária varia com o nº de hóspedes, por tipo de
-- acomodação. Criança conta como hóspede (mesma regra de cobrança).
-- Resolução: maior faixa <= hospedes; sem faixa <= N, usa a menor faixa;
-- tipo sem faixa alguma cai no `acomodacao.valor` (comportamento anterior).
CREATE TABLE IF NOT EXISTS tarifa_ocupacao (
    id                  bigserial PRIMARY KEY,
    idtipo_acomodacao   bigint NOT NULL REFERENCES tipo_acomodacao(id) ON DELETE CASCADE,
    hospedes            smallint NOT NULL CHECK (hospedes BETWEEN 1 AND 20),
    valor               numeric(10,2) NOT NULL CHECK (valor > 0),
    criado_em           timestamptz NOT NULL DEFAULT now(),
    atualizado_em       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (idtipo_acomodacao, hospedes)
);

CREATE INDEX IF NOT EXISTS idx_tarifa_ocup_tipo ON tarifa_ocupacao (idtipo_acomodacao);
