-- migration-96-compras-entrega-postventa.sql
-- MÓDULO DE COMPRAS — Entrega del proyecto y acta (spec §16) + Postventa/Facturación (spec §17).
--
-- §16.7: "el módulo cierra con el acta" — `compras_entrega` es UNA fila por negocio (no un
-- historial): guarda la modalidad, la verificación física, los números que emite OBUMA (nota de
-- venta y guía de despacho — el módulo NO los emite, solo los registra, §16.4/§17.2), y el acta
-- misma con su aprobación y las DOS firmas (acta + guía, §16.5/§16.6). `cerrada_at` se marca cuando
-- ambas firmas existen.
--
-- `compras_entrega_punto` aparte porque §16.2 admite "puntos de entrega múltiples" — casos menores,
-- pero el diseño debe soportarlos sin forzar una sola dirección en la fila principal.
--
-- `compras_postventa`: los compromisos de postventa YA vienen identificados en el paquete de
-- traspaso (resumen ejecutivo, `ResumenEjecutivo.compromisosPostventa`) — esta tabla NO los duplica,
-- solo guarda qué compromiso ya se resolvió (clave = texto del compromiso, es estable porque el
-- resumen es una foto congelada al ganar, §4.1).
--
-- §17.3 "tarea obligatoria: captura del contacto de pagos" — NO es tabla nueva: es una fila más del
-- catálogo enunciativo `compras_tarea_catalogo` (Fase 1, migration-86), con su propio formulario
-- (campos_json) — mismo mecanismo que ya usan las 8 tareas existentes.
--
-- Aplicar con `node scripts/aplicar-migration-96.mjs`. Idempotente: CREATE TABLE IF NOT EXISTS +
-- INSERT IGNORE de la tarea del catálogo.

CREATE TABLE IF NOT EXISTS compras_entrega (
  negocio_id                 INT          NOT NULL PRIMARY KEY,
  modalidad                  VARCHAR(16)  NOT NULL DEFAULT 'TOTAL',  -- TOTAL | PARCIAL (§16.2, regla general vs excepción)
  modalidad_motivo           TEXT             NULL,  -- por qué es parcial (a petición del cliente)

  -- §16.4: números que EMITE OBUMA — el módulo solo los registra, no los genera.
  nota_venta_numero          VARCHAR(80)      NULL,
  guia_despacho_numero       VARCHAR(80)      NULL,

  -- Verificación y validación (§16.4) — "producto correcto y en buenas condiciones", hoy la
  -- ejecuta el propio encargado de compras.
  verificacion_conforme      TINYINT(1)       NULL,  -- NULL = no verificado todavía
  verificacion_por           INT              NULL,
  verificacion_por_nombre    VARCHAR(160)     NULL,
  verificacion_at            DATETIME         NULL,

  -- Acta de entrega (§16.5) — único documento oficial que genera el módulo.
  acta_generada_at           DATETIME         NULL,
  acta_contenido_json        LONGTEXT         NULL,  -- snapshot: productos entregados, cantidades, conformidad
  acta_aprobada_por          INT              NULL,  -- "la aprueba el encargado de compras antes de imprimirse"
  acta_aprobada_por_nombre   VARCHAR(160)     NULL,
  acta_aprobada_at           DATETIME         NULL,
  acta_conformidad           VARCHAR(16)      NULL,  -- CONFORME | NO_CONFORME
  acta_firma_nombre          VARCHAR(200)     NULL,
  acta_firma_rut             VARCHAR(20)      NULL,
  acta_firma_cargo           VARCHAR(150)     NULL,
  acta_firma_recinto         VARCHAR(300)     NULL,
  acta_firma_fecha           DATE             NULL,

  -- Firma de la guía de despacho (§16.6) — nombre, RUT, cargo, fecha, recinto, recepción y timbre.
  guia_firma_nombre          VARCHAR(200)     NULL,
  guia_firma_rut             VARCHAR(20)      NULL,
  guia_firma_cargo           VARCHAR(150)     NULL,
  guia_firma_recinto         VARCHAR(300)     NULL,
  guia_firma_fecha           DATE             NULL,
  guia_timbre                TINYINT(1)   NOT NULL DEFAULT 0,  -- "timbre si es posible" — no siempre hay

  cerrada_at                 DATETIME         NULL,  -- §16.7: con acta Y guía firmadas se cierra el ciclo
  created_at                 DATETIME     NOT NULL,
  updated_at                 DATETIME     NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS compras_entrega_punto (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id  INT          NOT NULL,
  direccion   VARCHAR(400) NOT NULL,
  comuna      VARCHAR(150)     NULL,
  contacto_nombre  VARCHAR(200) NULL,
  contacto_telefono VARCHAR(60) NULL,
  INDEX idx_compras_entrega_punto_negocio (negocio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS compras_postventa (
  negocio_id       INT          NOT NULL,
  compromiso_texto VARCHAR(500) NOT NULL,  -- calza contra ResumenEjecutivo.compromisosPostventa[].titulo
  resuelto_por     INT              NULL,
  resuelto_por_nombre VARCHAR(160) NULL,
  resuelto_at      DATETIME         NULL,
  notas            TEXT             NULL,
  PRIMARY KEY (negocio_id, compromiso_texto)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- §17.3 — tarea obligatoria del catálogo (mismo mecanismo que las 8 ya existentes, migration-86/87).
-- "Nunca es la misma persona que la contraparte técnica" queda como advertencia en la descripción,
-- no como validación de código (no hay forma confiable de comparar "misma persona" con datos libres).
INSERT IGNORE INTO compras_tarea_catalogo (clave, categoria, titulo, descripcion, responsable_regla, plazo_dias, plazo_tipo, orden, campos_json) VALUES
('contacto_pagos', 'ADMINISTRATIVO', 'Captura del contacto de pagos',
 'Se ejecuta mientras aún hay contacto con el cliente. Nunca es la misma persona que la contraparte técnica (spec §17.3). Sin esto, el cliente llama recién al momento de pagar a pedir la factura y los datos de transferencia.',
 'ENCARGADO', NULL, 'CORRIDOS', 100,
 '{"campos":[{"clave":"nombre","etiqueta":"Nombre del contacto de pagos","tipo":"texto"},{"clave":"correo","etiqueta":"Correo","tipo":"texto"},{"clave":"telefono","etiqueta":"Teléfono","tipo":"texto"},{"clave":"datos_transferencia","etiqueta":"Datos de transferencia de la empresa","tipo":"parrafo"},{"clave":"observaciones","etiqueta":"Observaciones","tipo":"parrafo"}]}');
