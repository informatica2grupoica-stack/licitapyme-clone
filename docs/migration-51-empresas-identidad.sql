-- migration-51-empresas-identidad.sql
-- AUDITOR TÉCNICO (Fase 1) — identidad de la empresa: logo, firma, timbre, certificados y
-- experiencia acreditable. Hasta ahora `empresas` era una ficha puramente administrativa
-- (datos societarios + representante + banco), sin ningún archivo asociado.
--
-- Logo/firma/timbre → columnas directas en `empresas` (un archivo cada una, se reemplaza al
-- subir uno nuevo: no tiene sentido guardar historial de firmas viejas).
-- Certificados y experiencia → tabla hija `empresa_documentos` (acumulan, nunca se reemplazan —
-- mismo patrón que checklist_comercial_documentos).
--
-- COLLATE explícito utf8mb4_unicode_ci, igual que migration-40-empresas.sql (esta tabla se une
-- conceptualmente con `empresas`, que ya usa ese collate).
--
-- Aplicar en Bluehost → phpMyAdmin (base ooosywmy_ica_licitaciones), pestaña SQL.
-- ════════════════════════════════════════════════════════════════════════════

-- Esta versión de MySQL (Bluehost) NO soporta "ADD COLUMN IF NOT EXISTS" (falla de sintaxis,
-- verificado en vivo 27-jul-2026) — a diferencia de lo que asumía migration-40. Sin esa cláusula:
-- el script scripts/aplicar-migration-51.mjs ya comprueba antes si la columna existe y solo
-- corre esto si falta, así que no hace falta la guardia a nivel de SQL.
ALTER TABLE empresas ADD COLUMN logo_url      VARCHAR(600) DEFAULT NULL;
ALTER TABLE empresas ADD COLUMN logo_nombre   VARCHAR(300) DEFAULT NULL;
ALTER TABLE empresas ADD COLUMN firma_url     VARCHAR(600) DEFAULT NULL;
ALTER TABLE empresas ADD COLUMN firma_nombre  VARCHAR(300) DEFAULT NULL;
ALTER TABLE empresas ADD COLUMN timbre_url    VARCHAR(600) DEFAULT NULL;
ALTER TABLE empresas ADD COLUMN timbre_nombre VARCHAR(300) DEFAULT NULL;

CREATE TABLE IF NOT EXISTS empresa_documentos (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id         INT          NOT NULL,
  tipo               VARCHAR(30)  NOT NULL,   -- certificado | experiencia | otro
  titulo             VARCHAR(300) NOT NULL,
  descripcion        TEXT         DEFAULT NULL,  -- mandante/monto/fecha en texto libre (experiencia)
  url                VARCHAR(600) DEFAULT NULL,  -- una experiencia puede no traer PDF
  nombre             VARCHAR(300) DEFAULT NULL,
  orden              INT          NOT NULL DEFAULT 0,
  subido_por         INT          DEFAULT NULL,
  subido_por_nombre  VARCHAR(160) DEFAULT NULL,
  subido_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_empdoc_empresa (empresa_id, tipo, orden)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
