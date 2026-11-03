-- ============================================================================
-- 0015 — KDS (Kitchen Display System)
-- Novos estados do item da comanda: pendente → em_preparo → pronto → entregue.
-- Os triggers trg_delta_pdv_item/pdv_comanda já publicam cada mudança no
-- canal clarituz_delta — a tela da cozinha é 100% realtime sem polling.
-- ============================================================================

ALTER TYPE pdv_item_status ADD VALUE IF NOT EXISTS 'em_preparo' AFTER 'pendente';
ALTER TYPE pdv_item_status ADD VALUE IF NOT EXISTS 'pronto'     AFTER 'em_preparo';
