-- Motor realtime — lane "delta" (estilo Supabase Realtime):
--   triggers NOTIFY no canal `clarituz_delta` com {tabela,acao,id};
--   o backend escuta via PgListener e republica no EventBus (SSE).
-- Payload minimalista (id + acao) — nunca trafega dado da linha, então
-- não há vazamento e ficamos muito abaixo do limite de 8KB do NOTIFY.

CREATE OR REPLACE FUNCTION notify_delta() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_notify(
        'clarituz_delta',
        json_build_object(
            'tabela', TG_TABLE_NAME,
            'acao',   lower(TG_OP),
            'id',     COALESCE(NEW.id, OLD.id)
        )::text
    );
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_delta_reserva       AFTER INSERT OR UPDATE OR DELETE ON reserva             FOR EACH ROW EXECUTE FUNCTION notify_delta();
CREATE TRIGGER trg_delta_consumo       AFTER INSERT OR UPDATE OR DELETE ON consumo             FOR EACH ROW EXECUTE FUNCTION notify_delta();
CREATE TRIGGER trg_delta_itemconsumido AFTER INSERT OR UPDATE OR DELETE ON item_consumido      FOR EACH ROW EXECUTE FUNCTION notify_delta();
CREATE TRIGGER trg_delta_adicional     AFTER INSERT OR UPDATE OR DELETE ON adicional_consumo   FOR EACH ROW EXECUTE FUNCTION notify_delta();
CREATE TRIGGER trg_delta_cliente       AFTER INSERT OR UPDATE OR DELETE ON cliente             FOR EACH ROW EXECUTE FUNCTION notify_delta();
CREATE TRIGGER trg_delta_funcionario   AFTER INSERT OR UPDATE OR DELETE ON funcionario         FOR EACH ROW EXECUTE FUNCTION notify_delta();
CREATE TRIGGER trg_delta_acomodacao    AFTER INSERT OR UPDATE OR DELETE ON acomodacao          FOR EACH ROW EXECUTE FUNCTION notify_delta();
CREATE TRIGGER trg_delta_quarto        AFTER INSERT OR UPDATE OR DELETE ON quarto              FOR EACH ROW EXECUTE FUNCTION notify_delta();
CREATE TRIGGER trg_delta_tipoac        AFTER INSERT OR UPDATE OR DELETE ON tipo_acomodacao     FOR EACH ROW EXECUTE FUNCTION notify_delta();
CREATE TRIGGER trg_delta_estoque       AFTER INSERT OR UPDATE OR DELETE ON estoque             FOR EACH ROW EXECUTE FUNCTION notify_delta();
CREATE TRIGGER trg_delta_movimento     AFTER INSERT OR UPDATE OR DELETE ON movimento_estoque   FOR EACH ROW EXECUTE FUNCTION notify_delta();
CREATE TRIGGER trg_delta_categoria     AFTER INSERT OR UPDATE OR DELETE ON categoria_estoque   FOR EACH ROW EXECUTE FUNCTION notify_delta();
CREATE TRIGGER trg_delta_frigobar      AFTER INSERT OR UPDATE OR DELETE ON frigobar            FOR EACH ROW EXECUTE FUNCTION notify_delta();
CREATE TRIGGER trg_delta_itemfrigobar  AFTER INSERT OR UPDATE OR DELETE ON item_frigobar       FOR EACH ROW EXECUTE FUNCTION notify_delta();
CREATE TRIGGER trg_delta_estacionam    AFTER INSERT OR UPDATE OR DELETE ON estacionamento      FOR EACH ROW EXECUTE FUNCTION notify_delta();
CREATE TRIGGER trg_delta_formapag      AFTER INSERT OR UPDATE OR DELETE ON forma_pagamento     FOR EACH ROW EXECUTE FUNCTION notify_delta();
CREATE TRIGGER trg_delta_impressora    AFTER INSERT OR UPDATE OR DELETE ON impressora          FOR EACH ROW EXECUTE FUNCTION notify_delta();
CREATE TRIGGER trg_delta_estabelecim   AFTER INSERT OR UPDATE OR DELETE ON estabelecimento     FOR EACH ROW EXECUTE FUNCTION notify_delta();
CREATE TRIGGER trg_delta_log           AFTER INSERT ON log FOR EACH ROW EXECUTE FUNCTION notify_delta();
