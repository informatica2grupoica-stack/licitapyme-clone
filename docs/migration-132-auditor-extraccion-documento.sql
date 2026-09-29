-- migration-132-auditor-extraccion-documento.sql
-- AUDITOR unificado (29-sep-2026) — ajuste a migration-131: el LECTOR (Prompt 6) lee un documento
-- ANTES de saber a qué opción/línea pertenece (una cotización trae varios productos y hay que
-- emparejarlos con las líneas del costeo). Por eso la extracción no puede exigir opcion_id/respaldo_id:
--   auditor_extraccion → respaldo_id y opcion_id pasan a NULL; se agregan negocio_id, documento_url,
--                        documento_nombre y error (si la lectura falló, queda registrado por qué).
--   auditor_respaldo   → se agregan extraccion_id (de qué lectura salió) y producto_idx (cuál de los
--                        productos de esa extracción es el de esta opción).
--
-- Aplicar con `node scripts/aplicar-migration-132.mjs` (idempotente: comprueba cada columna).

ALTER TABLE auditor_extraccion MODIFY respaldo_id INT NULL, MODIFY opcion_id INT NULL;
ALTER TABLE auditor_extraccion ADD COLUMN negocio_id INT NULL;
ALTER TABLE auditor_extraccion ADD COLUMN documento_url VARCHAR(1000) NULL;
ALTER TABLE auditor_extraccion ADD COLUMN documento_nombre VARCHAR(300) NULL;
ALTER TABLE auditor_extraccion ADD COLUMN error VARCHAR(500) NULL;
ALTER TABLE auditor_extraccion ADD INDEX idx_auditor_extraccion_negocio (negocio_id);
ALTER TABLE auditor_respaldo ADD COLUMN extraccion_id INT NULL;
ALTER TABLE auditor_respaldo ADD COLUMN producto_idx INT NULL;
