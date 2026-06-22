-- migration-20-licitaciones-cache.sql
-- Caché persistente del DETALLE de licitaciones (lo que la API de MP solo entrega
-- vía ?codigo= 1×1 y con rate-limit fuerte). Permite acumular el enriquecimiento
-- entre corridas del cron y compartirlo con la búsqueda manual, en vez de re-pedir
-- lo mismo cada vez (y gatillar 429).
-- El código tiene fallback si la tabla no existe (no rompe cron ni búsqueda).
-- Ejecutar en Bluehost → phpMyAdmin → licitapyme → SQL

CREATE TABLE IF NOT EXISTS licitaciones_cache (
  codigo            VARCHAR(40)  NOT NULL PRIMARY KEY,
  nombre            VARCHAR(500) NULL,
  descripcion       TEXT         NULL,
  organismo         VARCHAR(500) NULL,
  region            VARCHAR(150) NULL,
  monto             BIGINT       NULL,
  estado            VARCHAR(40)  NULL,
  tipo              VARCHAR(20)  NULL,
  fecha_cierre      DATETIME     NULL,
  fecha_publicacion DATETIME     NULL,
  items_json        MEDIUMTEXT   NULL,            -- JSON.stringify de los ítems (producto/desc/categoría)
  enriquecido       TINYINT      NOT NULL DEFAULT 0,  -- 1 = trajo detalle completo desde ?codigo=
  enriched_at       DATETIME     NULL,
  updated_at        DATETIME     NULL,
  INDEX idx_enriquecido (enriquecido),
  INDEX idx_enriched_at (enriched_at)
);
