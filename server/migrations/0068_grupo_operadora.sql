-- Grupo/evento vinculado à operadora B2B de origem (excursões) — opcional.
-- SET NULL: remover a operadora não apaga o grupo.
ALTER TABLE grupo
    ADD COLUMN IF NOT EXISTS idoperadora bigint REFERENCES operadora(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_grupo_operadora ON grupo (idoperadora) WHERE idoperadora IS NOT NULL;
