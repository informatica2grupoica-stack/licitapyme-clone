-- migration-53-motor-comercial-costeo.sql
-- MOTOR COMERCIAL (Auditor Técnico, Fase 4) — ingesta del costeo real que trabajó el
-- asistente (spec §7), como prueba documental de que cotizó el proyecto. Cada subida queda
-- versionada (spec §7.6: "si el asistente modifica el costeo después de una aprobación, CA
-- puede ver qué cambió, cuándo y quién") — nunca se sobrescribe una fila, se agrega una nueva
-- con `vigente=1` y se baja la anterior.
--
-- Aplicar en Bluehost → phpMyAdmin (base ooosywmy_ica_licitaciones), pestaña SQL, o con
-- `node scripts/aplicar-migration-53.mjs`.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS checklist_comercial_costeo (
  id                     INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id             INT          NOT NULL,
  version                INT          NOT NULL,
  vigente                TINYINT(1)   NOT NULL DEFAULT 1,

  archivo_url            VARCHAR(600) NOT NULL,
  archivo_nombre         VARCHAR(300) NOT NULL,

  -- Totales extraídos del costeo (spec §7.2/7.3), para no re-parsear el Excel en cada lectura.
  total_costo_neto       DECIMAL(16,2) DEFAULT NULL,   -- suma de "Costo total neto" (COSTEO ORIGINAL)
  total_precio_neto      DECIMAL(16,2) DEFAULT NULL,   -- suma de "Precio total neto" (PRECIOS PARA MP)
  presupuesto_publicado  DECIMAL(16,2) DEFAULT NULL,   -- informe.presupuesto al momento de la subida
  total_anexo_economico  DECIMAL(16,2) DEFAULT NULL,   -- suma de los ítems 'precio' ya cargados en checklist_comercial

  -- Alertas obligatorias (spec §7.4), congeladas en esta versión para que la bandeja no
  -- tenga que re-parsear el Excel cada vez que lista negocios pendientes.
  alertas                JSON         DEFAULT NULL,

  subido_por             INT          DEFAULT NULL,
  subido_por_nombre      VARCHAR(160) DEFAULT NULL,
  subido_at              DATETIME     NOT NULL,

  KEY idx_costeo_negocio (negocio_id, version),
  KEY idx_costeo_vigente (negocio_id, vigente)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
