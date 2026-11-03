-- Impressora dedicada a etiquetas de produto (ex.: Brother QL).
-- No máximo uma por estabelecimento; cadastrar item gera etiqueta nela.
ALTER TABLE impressora ADD COLUMN etiqueta BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX uq_impressora_etiqueta ON impressora (etiqueta) WHERE etiqueta;

-- Jobs de texto (etiquetas) são entregues pelo agente via driver do SO;
-- jobs 'escpos' seguem RAW/9100 como antes.
ALTER TABLE impressao_job ADD COLUMN modo TEXT NOT NULL DEFAULT 'escpos'
    CHECK (modo IN ('escpos', 'texto'));
