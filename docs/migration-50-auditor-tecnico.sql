-- migration-50-auditor-tecnico.sql
-- AUDITOR TÉCNICO (Fase 1) — comparación técnica línea por línea dentro de Información Comercial.
--
-- QUÉ RESUELVE: el bloque TECNICO de checklist_comercial hoy solo trae los criterios de
-- evaluación generales. No hay ninguna comparación de especificaciones (PISO/TECHO/EXACTO/RANGO)
-- entre lo exigido por las bases y lo ofertado, línea por línea. Esta tabla es donde vive esa
-- comparación: cuelga de un item de checklist_comercial (bloque=TECNICO, tipo='linea_tecnica'),
-- una fila por CARACTERÍSTICA de esa línea.
--
-- Generado por el Agente Técnico (app/lib/auditor-tecnico.ts): clasifica el texto libre de
-- caracteristicas[] de las bases en PISO/TECHO/EXACTO/RANGO, y compara contra lo ofertado (por
-- interrogatorio al asistente o por ficha técnica del proveedor). Loop de aprendizaje: si el
-- asesor corrige un veredicto, se guarda el veredicto original de la IA + quién corrigió + por qué.
--
-- Mismo criterio que checklist_comercial_documentos/_bitacora: SIN FOREIGN KEY (el proyecto no
-- usa constraints FK en esta familia de tablas, la integridad la garantiza el código) y SIN
-- COLLATE explícito (igual que migration-48, hereda el default del servidor — evita el problema
-- de collation ya diagnosticado en joins con negocios/usuarios).
--
-- Aplicar en Bluehost → phpMyAdmin (base ooosywmy_ica_licitaciones), pestaña SQL.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS checklist_comercial_caracteristicas (
  id                          INT AUTO_INCREMENT PRIMARY KEY,
  item_id                     INT           NOT NULL,  -- checklist_comercial.id (bloque=TECNICO, tipo='linea_tecnica')
  negocio_id                  INT           NOT NULL,  -- redundante a propósito: filtrar por negocio sin JOIN

  -- Idempotencia: mismo patrón que checklist_comercial.clave_origen — re-validar una línea nunca
  -- duplica ni pisa una fila ya corregida por el asesor.
  clave_caracteristica        VARCHAR(200)  NOT NULL,
  orden                       INT           NOT NULL DEFAULT 0,

  descripcion                 VARCHAR(500)  NOT NULL,  -- el requisito, tal como lo separó el Agente Técnico
  tipo                        VARCHAR(20)   NOT NULL,  -- PISO | TECHO | EXACTO | RANGO

  valor_requerido_texto       VARCHAR(300)  DEFAULT NULL,  -- cita textual del valor exigido en bases
  valor_requerido_numero      DECIMAL(18,4) DEFAULT NULL,  -- PISO/TECHO/EXACTO: el valor · RANGO: el mínimo
  valor_requerido_numero_max  DECIMAL(18,4) DEFAULT NULL,  -- solo RANGO: el máximo
  unidad_requerida            VARCHAR(40)   DEFAULT NULL,

  valor_ofertado_texto        VARCHAR(300)  DEFAULT NULL,
  valor_ofertado_numero       DECIMAL(18,4) DEFAULT NULL,
  unidad_ofertada_original    VARCHAR(40)   DEFAULT NULL,  -- unidad tal como la dio el asistente o la ficha
  valor_convertido_numero     DECIMAL(18,4) DEFAULT NULL,  -- valor_ofertado_numero normalizado a unidad_requerida

  veredicto                   VARCHAR(30)   DEFAULT NULL,  -- CUMPLE | NO_CUMPLE | CUMPLE_CON_COMPLEMENTO | NULL=sin evaluar
  pendiente_confirmacion_proveedor TINYINT(1) NOT NULL DEFAULT 0,  -- la ficha no lo menciona con claridad

  fundamento_documento        VARCHAR(300)  DEFAULT NULL,  -- "Bases Técnicas" | "Ficha técnica proveedor" | nombre de archivo
  fundamento_cita             VARCHAR(500)  DEFAULT NULL,  -- punto/página/cláusula citada
  confianza                   DECIMAL(5,2)  DEFAULT NULL,  -- 0-100 reportado por la IA

  origen                      VARCHAR(20)   NOT NULL DEFAULT 'interrogatorio',  -- interrogatorio | ficha | manual

  -- Loop de aprendizaje: qué dijo la IA primero vs qué corrigió el asesor.
  veredicto_ia                VARCHAR(30)   DEFAULT NULL,   -- snapshot del veredicto ANTES de la corrección humana
  corregido_por                INT          DEFAULT NULL,
  corregido_por_nombre        VARCHAR(160)  DEFAULT NULL,
  corregido_at                DATETIME      DEFAULT NULL,
  comentario_correccion       TEXT          DEFAULT NULL,

  created_at                  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_caracteristica (item_id, clave_caracteristica),
  KEY idx_caract_negocio (negocio_id),
  KEY idx_caract_veredicto (item_id, veredicto)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
