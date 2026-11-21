-- CNPJ da operadora B2B — preenchido pela consulta BrasilAPI no cadastro.
ALTER TABLE operadora
    ADD COLUMN IF NOT EXISTS cnpj text;
