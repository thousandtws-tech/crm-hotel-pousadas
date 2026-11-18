-- Restaura a invariante anti-overbooking perdida na 0048.
--
-- `ALTER TABLE reserva DROP COLUMN periodo` derrubou em cascata a
-- constraint `excl_reserva_sem_overlap` (GiST em idacomodacao + periodo).
-- Sem ela, duas reservas sobrepostas na mesma acomodação gravam sem erro
-- — overbooking real em produção. Recria a constraint sobre a nova
-- semântica [entrada, saída): o dia do checkout não é noite ocupada e
-- uma janela iniciada no checkout do anterior não conflita.
BEGIN;

ALTER TABLE reserva
    ADD CONSTRAINT excl_reserva_sem_overlap
    EXCLUDE USING gist (
        idacomodacao WITH =,
        periodo WITH &&
    )
    WHERE (status IN ('p', 'i'));

COMMIT;
