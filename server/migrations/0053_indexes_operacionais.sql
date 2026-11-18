-- 0053 — Índices das consultas operacionais/preditivas.
--
-- Auditoria das queries quentes (preditivo, dashboard, PDV) contra o
-- catálogo de índices: três predicados sem cobertura. Todos os demais
-- já estavam servidos (pagamento.idreserva, reserva.idcliente,
-- movimento_estoque(iditem,criado_em), escala_turno.data, etc).
--
-- idx_reserva_saida     — checkouts por dia (ocupacao_14d, escala_dia):
--                         `saidaprevista = d` não usava índice algum.
-- idx_reserva_criado    — janelas do pace: `criado_em >= now() - interval`
--                         varria a tabela inteira a cada consulta.
-- idx_manut_quarto      — risco_quarto: subqueries correlacionadas por
--                         `m.idquarto = q.id` (os_90d, os_abertas).

CREATE INDEX idx_reserva_saida  ON reserva (saidaprevista);
CREATE INDEX idx_reserva_criado ON reserva (criado_em);
CREATE INDEX idx_manut_quarto   ON manutencao_ordem (idquarto);
