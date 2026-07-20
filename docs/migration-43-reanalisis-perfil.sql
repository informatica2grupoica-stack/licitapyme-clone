-- migration-43-reanalisis-perfil.sql
-- Permite que un usuario NORMAL (no admin) re-analice la viabilidad de una licitación que tiene
-- asignada, pero SOLO UNA VEZ (antes era exclusivo de admin, sin límite). Se guarda en `negocios`
-- porque cada fila representa la asignación ACTIVA vigente: si se reasigna a otro perfil, la fila
-- nueva/fusionada empieza en 0 (el nuevo asignado tiene su propia oportunidad).
ALTER TABLE negocios
  ADD COLUMN reanalisis_usado TINYINT(1) NOT NULL DEFAULT 0 AFTER estado_pipeline;
