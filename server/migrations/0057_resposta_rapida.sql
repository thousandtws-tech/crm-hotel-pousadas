-- Respostas rápidas — textos prontos que o atendente expande digitando
-- '/atalho' nos campos de resposta (avaliações, LGPD, atendimento).
-- Gerência mantém o catálogo; atendentes só leem/usam.

CREATE TABLE comunicacao_resposta_rapida (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atalho     TEXT     NOT NULL UNIQUE,    -- 'wifi' — digitado após '/'
    titulo     TEXT     NOT NULL,           -- rótulo exibido no autocomplete
    texto      TEXT     NOT NULL,           -- corpo que substitui '/atalho'
    ordem      SMALLINT NOT NULL DEFAULT 0, -- ordem de exibição no menu
    ativo      BOOLEAN  NOT NULL DEFAULT TRUE,
    criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_resposta_rapida_ativa ON comunicacao_resposta_rapida (ativo, ordem);

-- Sementes de partida — campos entre [colchetes] são placeholders pra
-- gerência personalizar (evita inventar fato errado pro hóspede).
INSERT INTO comunicacao_resposta_rapida (atalho, titulo, texto, ordem) VALUES
    ('boasvindas',  'Boas-vindas',        'Olá! Seja bem-vindo(a) à Pousada Espírito do Mar. Como posso ajudar?', 1),
    ('checkin',     'Horário de check-in','O check-in é a partir das [14h]. Chegando mais cedo, nos avise que verificamos a disponibilidade de early check-in.', 2),
    ('checkout',    'Horário de check-out','O check-out é até as [12h]. Precisando de late check-out, é só consultar a recepção.', 3),
    ('wifi',        'Wi-Fi',              'A rede Wi-Fi da pousada é [nome-da-rede] e a senha é [senha].', 4),
    ('cafe',        'Café da manhã',      'O café da manhã é servido das [07h] às [10h] no [local].', 5),
    ('estacionamento','Estacionamento',   'Temos estacionamento [interno/parceiro] — [instruções de acesso ou valores].', 6),
    ('localizacao', 'Localização',        'Estamos na [endereço completo] — [ponto de referência / distância da praia].', 7),
    ('agradecimento','Agradecimento',     'Muito obrigado pela preferência! Será um prazer recebê-lo(a) novamente. — Equipe Pousada Espírito do Mar', 8),
    ('desculpa',    'Desculpa',           'Pedimos sinceras desculpas pelo inconveniente. Já estamos verificando e retornamos em instantes.', 9);

DROP TRIGGER IF EXISTS trg_delta_comunicacao_resposta_rapida ON comunicacao_resposta_rapida;
CREATE TRIGGER trg_delta_comunicacao_resposta_rapida
    AFTER INSERT OR UPDATE OR DELETE ON comunicacao_resposta_rapida
    FOR EACH ROW EXECUTE FUNCTION notify_delta();
