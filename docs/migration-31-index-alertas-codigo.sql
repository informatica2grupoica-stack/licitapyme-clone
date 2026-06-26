-- migration-31-index-alertas-codigo.sql
-- ÍNDICE FALTANTE que causaba lentitud general.
--
-- Problema: alertas_licitaciones tiene un índice ÚNICO COMPUESTO
-- unique_alerta(usuario_id, licitacion_codigo). Por la regla del prefijo izquierdo
-- de MySQL, una consulta `WHERE licitacion_codigo = ?` (sin usuario_id) NO puede
-- usar ese índice → hace ESCANEO COMPLETO de la tabla (~4.400 filas, ~2 s por
-- consulta en Bluehost). Varias rutas hacen lookups/updates por código solo:
--   - corregirCamposDesdeDetalle (corrección de fecha de publicación al enriquecer)
--   - /api/radar/descartar, deduplicación del radar, etc.
-- Cuando "Enriquecer todo" corre, esos updates de 2 s saturan el pool (3 conexiones)
-- y TODA la app se vuelve lenta, incluido el panel de Negocios.
--
-- Solución: índice simple sobre licitacion_codigo para que los accesos por código
-- sean instantáneos. No rompe el índice único existente (son complementarios).

CREATE INDEX idx_alertas_codigo ON alertas_licitaciones (licitacion_codigo);
