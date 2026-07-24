-- migration-48-checklist-comercial.sql
-- MÓDULO "INFORMACIÓN COMERCIAL" — el auditor de la etapa ANEXOS.
--
-- QUÉ RESUELVE: cuando una licitación entra a ANEXOS, el asistente arma la oferta
-- (anexos administrativos con los datos de la empresa, informe técnico, precio) y el
-- asesor tiene que VISAR cada punto antes de postular. Hasta ahora eso vivía en la
-- cabeza de la gente y en comentarios sueltos: no había forma de saber qué falta ni
-- quién aprobó qué.
--
-- CÓMO: el checklist NO se escribe a mano — se materializa desde el informe de
-- viabilidad v3 que ya está en BD (criterios de evaluación, requisitos de
-- admisibilidad, orden de anexos propios, manifiesto de productos). Cada fila recorre
-- PENDIENTE → CARGADO (asistente) → APROBADO (asesor), con OBSERVADO como rebote.
--
--   · checklist_comercial          → una fila por punto a cumplir (estado actual)
--   · checklist_comercial_bitacora → cada transición, para auditoría real
--
-- CHARSET sin COLLATE explícito, igual que migration-3-negocios.sql: hereda el default
-- del servidor. Poner utf8mb4_unicode_ci aquí rompería los JOINs contra negocios/usuarios
-- (ver el problema de collation ya diagnosticado en este proyecto).
--
-- Aplicar en Bluehost → phpMyAdmin (base ooosywmy_ica_licitaciones), pestaña SQL.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Puntos del checklist ----------------------------------------------------
CREATE TABLE IF NOT EXISTS checklist_comercial (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id         INT          NOT NULL,
  licitacion_codigo  VARCHAR(60)  NOT NULL,

  -- Clasificación del punto
  bloque             VARCHAR(20)  NOT NULL,              -- ADMINISTRATIVO | TECNICO | COMERCIAL
  tipo               VARCHAR(20)  NOT NULL DEFAULT 'documento',  -- documento | dato | precio
  titulo             VARCHAR(300) NOT NULL,
  descripcion        TEXT         DEFAULT NULL,          -- qué debe contener / forma de aplicación
  criticidad         VARCHAR(30)  NOT NULL DEFAULT 'INFORMATIVO',
                     -- ADMISIBILIDAD_DURA | PUNTAJE_CONDICIONANTE | COMPROMISO_EJECUCION | INFORMATIVO
  ponderacion        DECIMAL(6,2) DEFAULT NULL,          -- % del criterio, cuando viene de criterios_evaluacion
  fuente_cita        VARCHAR(500) DEFAULT NULL,          -- cita a las bases (la misma que muestra Viabilidad)

  -- Trazabilidad del origen. clave_origen es la huella estable del punto: permite
  -- resincronizar con la viabilidad (agregar lo nuevo) SIN duplicar ni pisar lo aprobado.
  origen             VARCHAR(20)  NOT NULL DEFAULT 'viabilidad',  -- viabilidad | modalidad | manual
  clave_origen       VARCHAR(200) NOT NULL,

  -- Gancho para la Fase 2 (generar certificados/declaraciones desde la app).
  -- Hoy siempre 0: el botón "Generar" existe en la UI pero está deshabilitado.
  generable          TINYINT(1)   NOT NULL DEFAULT 0,
  plantilla_id       VARCHAR(60)  DEFAULT NULL,

  -- Solo para tipo='precio'. En suma alzada hay UNA fila con linea_numero NULL;
  -- en por_línea hay una fila por línea y `ofertamos` dice si esa línea va en la oferta.
  linea_numero       INT          DEFAULT NULL,
  ofertamos          TINYINT(1)   DEFAULT NULL,

  -- Estado y evidencia
  estado             VARCHAR(20)  NOT NULL DEFAULT 'PENDIENTE',  -- PENDIENTE|CARGADO|APROBADO|OBSERVADO
  valor_texto        TEXT         DEFAULT NULL,
  valor_numero       DECIMAL(16,2) DEFAULT NULL,          -- precio neto ofertado
  documento_url      VARCHAR(600) DEFAULT NULL,
  documento_nombre   VARCHAR(300) DEFAULT NULL,
  observacion        TEXT         DEFAULT NULL,           -- motivo del asesor al observar
  orden              INT          NOT NULL DEFAULT 0,

  -- Doble firma
  cargado_por        INT          DEFAULT NULL,
  cargado_por_nombre VARCHAR(160) DEFAULT NULL,
  cargado_at         DATETIME     DEFAULT NULL,
  aprobado_por       INT          DEFAULT NULL,
  aprobado_por_nombre VARCHAR(160) DEFAULT NULL,
  aprobado_at        DATETIME     DEFAULT NULL,

  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_checklist_item (negocio_id, clave_origen),
  KEY idx_checklist_negocio (negocio_id, bloque, orden),
  KEY idx_checklist_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2) Bitácora de transiciones -------------------------------------------------
-- Esto es lo que convierte el checklist en AUDITORÍA y no en una lista de tareas:
-- queda la traza completa aunque un punto rebote tres veces entre asistente y asesor.
CREATE TABLE IF NOT EXISTS checklist_comercial_bitacora (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  item_id         INT          NOT NULL,
  negocio_id      INT          NOT NULL,
  accion          VARCHAR(30)  NOT NULL,   -- CARGAR | APROBAR | OBSERVAR | EDITAR | REABRIR | GENERAR
  estado_anterior VARCHAR(20)  DEFAULT NULL,
  estado_nuevo    VARCHAR(20)  NOT NULL,
  comentario      TEXT         DEFAULT NULL,
  usuario_id      INT          DEFAULT NULL,
  usuario_nombre  VARCHAR(160) DEFAULT NULL,
  created_at      DATETIME     NOT NULL,
  KEY idx_bitacora_item (item_id, id),
  KEY idx_bitacora_negocio (negocio_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
