-- migration-25-radar-descartadas.sql
-- Estado de gestión del radar: licitaciones DESCARTADAS (a nivel empresa, decisión admin).
-- "Asignada" no necesita tabla: se deriva de `negocios` (activo = TRUE).
-- El endpoint /api/radar/descartar crea esta tabla con CREATE TABLE IF NOT EXISTS,
-- así que aplicar este script es opcional; queda para registro/portabilidad.

CREATE TABLE IF NOT EXISTS licitaciones_descartadas (
  licitacion_codigo VARCHAR(64) NOT NULL PRIMARY KEY,
  descartada_por    INT NULL,
  motivo            VARCHAR(255) NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
