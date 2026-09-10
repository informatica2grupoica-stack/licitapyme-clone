-- migration-95-compras-reloj.sql
-- MÓDULO DE COMPRAS — Reloj de entrega, multas y prórrogas (spec §15).
--
-- §15.1: "se construye a partir del plazo de entrega ofertado y del hito desde el cual corre...
-- requiere validación manual antes de fijarse" — por eso `fijado_at` existe: mientras sea NULL, el
-- reloj no está "fijado" de verdad, aunque el resumen ejecutivo ya traiga un plazo tentativo (la
-- tarea del catálogo 'reloj_entrega', Fase 1, es justo ese paso de validación manual).
--
-- §15.4: la prórroga concedida se registra como NUEVO plazo oficial, con su documento de respaldo
-- — no se pisa `fecha_limite`, queda aparte para no perder el rastro del plazo original.
--
-- §15.5/§15.7: "no se entrega con multa. Excepcionalmente puede definirse hacerlo, por decisión
-- expresa —nunca por silencio ni por atraso—, autorizada solo por jefe de ventas o CA" — de ahí que
-- `entrega_con_multa` lleve su propio autorizador, igual patrón que la prórroga.
--
-- Aplicar con `node scripts/aplicar-migration-95.mjs`. Idempotente: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS compras_reloj (
  negocio_id              INT          NOT NULL PRIMARY KEY,
  hito_inicio             VARCHAR(300)     NULL,  -- ej. "emisión de la OC", "aceptación de la OC"
  fecha_inicio            DATE             NULL,
  plazo_dias              INT              NULL,
  plazo_tipo              VARCHAR(12)  NOT NULL DEFAULT 'CORRIDOS',  -- HABILES | CORRIDOS
  fecha_limite            DATE             NULL,  -- calculada al fijar (fecha_inicio + plazo_dias)
  fijado_por              INT              NULL,  -- NULL = todavía no se validó a mano (§15.1)
  fijado_por_nombre       VARCHAR(160)     NULL,
  fijado_at               DATETIME         NULL,

  -- Prórroga (§15.4) — plazo NUEVO oficial, no pisa fecha_limite original.
  prorroga_fecha_limite      DATE             NULL,
  prorroga_motivo            TEXT             NULL,
  prorroga_documento_url     VARCHAR(600)     NULL,
  prorroga_autorizado_por        INT          NULL,  -- jefe de ventas o CA
  prorroga_autorizado_por_nombre VARCHAR(160) NULL,
  prorroga_autorizado_at         DATETIME     NULL,

  -- Entrega con multa (§15.5/§15.7) — excepción expresa, nunca por silencio ni por atraso.
  entrega_con_multa              TINYINT(1)   NOT NULL DEFAULT 0,
  entrega_con_multa_motivo       TEXT             NULL,
  entrega_con_multa_autorizado_por        INT          NULL,
  entrega_con_multa_autorizado_por_nombre VARCHAR(160) NULL,
  entrega_con_multa_autorizado_at         DATETIME     NULL,

  created_at              DATETIME     NOT NULL,
  updated_at              DATETIME     NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
