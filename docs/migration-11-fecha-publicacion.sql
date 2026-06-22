-- ================================================================
-- Migración 11: columnas nuevas en alertas_licitaciones
-- Ejecutar en Bluehost → phpMyAdmin o MySQL CLI
--
-- IMPORTANTE: Ejecutar solo si las columnas NO existen todavía.
-- Si ya ejecutaste una versión anterior, verificar antes con:
--   SHOW COLUMNS FROM alertas_licitaciones;
-- ================================================================

-- 1. Fecha de publicación en Mercado Público (para ordenar las más recientes primero)
ALTER TABLE `alertas_licitaciones`
  ADD COLUMN `licitacion_fecha_publicacion` DATETIME NULL
  AFTER `licitacion_cierre`;

-- 2. Contexto del match (fragmento de texto donde apareció la keyword)
ALTER TABLE `alertas_licitaciones`
  ADD COLUMN `match_contexto` TEXT NULL
  AFTER `match_fuente`;

-- 3. Índice para ordenamiento eficiente por fecha de publicación
ALTER TABLE `alertas_licitaciones`
  ADD INDEX `idx_alertas_fecha_pub` (`licitacion_fecha_publicacion`);

-- ================================================================
-- Backfill: actualizar alertas existentes que tienen organismo vacío
-- usando created_at como aproximación de fecha_publicacion
-- (las alertas nuevas se rellenarán correctamente desde el cron)
-- ================================================================
UPDATE `alertas_licitaciones`
SET `licitacion_fecha_publicacion` = `created_at`
WHERE `licitacion_fecha_publicacion` IS NULL;
