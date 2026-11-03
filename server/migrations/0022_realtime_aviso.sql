-- Hub realtime (Elixir/Phoenix) — lane "aviso":
--   insert em `notificacao` emite `clarituz_aviso` com o payload
--   completo do aviso (tipo/titulo/mensagem/ate_nivel/autor/dados).
--   O hub Phoenix escuta o canal e broadcast no tópico `avisos`
--   (cada channel filtra por nivel no handle_out — mesmo contrato
--   do filtro que o SSE da API fazia).
--
-- Nada de Rust muda: o aviso persister já grava `notificacao`, então
-- a trigger converte persistência em entrega realtime — at-least-once
-- e ordenado com o histórico (o toast e a badge nascem do mesmo row).
--
-- `dados` só embarca se couber no NOTIFY (<8KB); contexto grande fica
-- no histórico e a UI busca pelo id se precisar.

CREATE OR REPLACE FUNCTION notify_aviso() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_notify(
        'clarituz_aviso',
        json_build_object(
            'id',         NEW.id,
            'tipo',       NEW.tipo,
            'titulo',     NEW.titulo,
            'mensagem',   left(NEW.mensagem, 2000),
            'ate_nivel',  NEW.ate_nivel,
            'autor_id',   NEW.autor_id,
            'autor_nome', NEW.autor_nome,
            'dados',      CASE
                            WHEN NEW.dados IS NOT NULL
                                 AND octet_length(NEW.dados::text) < 4000
                            THEN NEW.dados
                            ELSE NULL
                          END,
            'criado_em',  NEW.criado_em
        )::text
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_aviso_notificacao AFTER INSERT ON notificacao
    FOR EACH ROW EXECUTE FUNCTION notify_aviso();
