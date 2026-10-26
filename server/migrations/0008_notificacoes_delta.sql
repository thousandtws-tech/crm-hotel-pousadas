-- Convergência multi-aba/multi-dispositivo do sino:
-- insert em `notificacao` (novo aviso) e `notificacao_lida` (read receipt)
-- emitem delta no barramento → outras abas do mesmo usuário atualizam
-- o badge sem refresh manual.
--
-- `notify_delta` ganha leitura via to_jsonb com `->` (jsonb, não text):
-- `->>'id'` devolveria texto e serializaria "id":"21" (string) no
-- payload — o parser Rust espera número. `->` preserva o tipo e retorna
-- json null em tabelas sem coluna id (ex.: notificacao_lida).

CREATE OR REPLACE FUNCTION notify_delta() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_notify(
        'clarituz_delta',
        json_build_object(
            'tabela', TG_TABLE_NAME,
            'acao',   lower(TG_OP),
            'id',     COALESCE(to_jsonb(NEW) -> 'id', to_jsonb(OLD) -> 'id')
        )::text
    );
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_delta_notificacao AFTER INSERT ON notificacao
    FOR EACH ROW EXECUTE FUNCTION notify_delta();

CREATE TRIGGER trg_delta_notificacao_lida AFTER INSERT ON notificacao_lida
    FOR EACH ROW EXECUTE FUNCTION notify_delta();
