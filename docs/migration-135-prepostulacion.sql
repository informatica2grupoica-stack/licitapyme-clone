-- migration-135-prepostulacion.sql
-- PRE-POSTULACIÓN (30-sep-2026) — estado que reemplaza a ANEXOS en el flujo del AUDITOR unificado.
-- Spec: docs/ESPECIFICACION_AUDITOR_v1.md §2 y §11.4 · docs/RESERVA_PREPOSTULACION_Bloque_TecAdm_y_Certificado.md.
--
--   auditor_prepost_item  → BLOQUE TÉCNICO-ADMINISTRATIVO: compromisos que NOSOTROS asumimos con la oferta (capacitación,
--                           garantía, manual en español, repuestos, plazos…). Se precargan como cumplidos y el asistente
--                           confirma UNO A UNO; un check sin marcar bloquea (RESERVA, Parte VIII). Origen:
--                             'ia'              → los saca el modelo de los requisitos de la línea y de las bases;
--                             'costo_asociado'  → los compromisos con costo que ya detectó el verificador técnico en EN
--                                                 PROCESO (auditor_costo_asociado): llegan precargados y coinciden con el costeo;
--                             'manual'          → los agrega el asistente.
--                           "No aplica" exige comentario (mismo criterio que anular un costo asociado). Nada se borra.
--   auditor_prepost_linea → marca de que el bloque de ESA línea ya se revisó (aunque no haya salido ningún ítem): sin esto
--                           "no hay compromisos" y "todavía no se miró" serían indistinguibles.
--
-- El CERTIFICADO DE ADMISIBILIDAD no tiene tabla: lo calcula el código en cada lectura a partir de la verificación técnica de
-- la opción aprobada (auditor_verificacion_tecnica, L1 + segunda pasada L2). Así nunca queda desactualizado.
--
-- Aplicar con `node scripts/aplicar-migration-135.mjs` (idempotente: CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS auditor_prepost_item (
  id INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id INT NOT NULL,
  fila_id VARCHAR(40) NULL,
  clave CHAR(40) NOT NULL,
  origen ENUM('ia','costo_asociado','manual') NOT NULL DEFAULT 'ia',
  materia VARCHAR(40) NOT NULL DEFAULT 'otro',
  exige_base_literal TEXT NULL,
  fuente_bases VARCHAR(300) NULL,
  se_compromete TEXT NULL,
  cuantificacion VARCHAR(300) NULL,
  criticidad VARCHAR(20) NULL,
  costo_asociado_id INT NULL,
  confirmado TINYINT(1) NOT NULL DEFAULT 0,
  confirmado_por INT NULL,
  confirmado_por_nombre VARCHAR(160) NULL,
  confirmado_at DATETIME NULL,
  no_aplica TINYINT(1) NOT NULL DEFAULT 0,
  nota VARCHAR(500) NULL,
  creado_at DATETIME NOT NULL,
  actualizado_at DATETIME NOT NULL,
  UNIQUE KEY uk_auditor_prepost_item (negocio_id, clave),
  INDEX idx_auditor_prepost_item_fila (negocio_id, fila_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS auditor_prepost_linea (
  id INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id INT NOT NULL,
  fila_id VARCHAR(40) NOT NULL,
  revisado_at DATETIME NOT NULL,
  revisado_por INT NULL,
  revisado_por_nombre VARCHAR(160) NULL,
  motor VARCHAR(60) NULL,
  items_detectados INT NOT NULL DEFAULT 0,
  error VARCHAR(500) NULL,
  UNIQUE KEY uk_auditor_prepost_linea (negocio_id, fila_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
