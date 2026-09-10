-- migration-101-compras-reparto-administrativo.sql
-- MÓDULO DE COMPRAS — Proceso administrativo post-aprobación (spec §11).
--
-- §11.1: "Lo que hace OBUMA, no el módulo" — emisión de OC a proveedores, registro de pago,
-- anticipos, moneda/tipo de cambio, facturas de compra, carpeta de proyecto, nota de venta y guía
-- de despacho, factura de venta. La spec es explícita: "El Módulo de Compras CONTROLA Y REGISTRA
-- el estado de estos hitos, NO LOS EJECUTA." Esta tabla es exactamente eso — una fila por negocio
-- con un hito por columna (bool + fecha + nota libre), nunca un botón que dispare nada en OBUMA.
--
-- §11.2 (tareas paralelas al aprobarse la compra) añade: provisión de fondos con política de pago
-- según antigüedad del proveedor (nuevo → exige factura antes; antiguo → se puede provisionar),
-- definición de cuenta de origen, y la carpeta de proyecto ya cubierta arriba. La creación de SKU
-- (§7) y el cálculo de importación (§12) ya viven en sus propias tablas — no se duplican acá.
--
-- Aplicar con `node scripts/aplicar-migration-101.mjs`. Idempotente: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS compras_reparto_administrativo (
  negocio_id                    INT          NOT NULL PRIMARY KEY,

  -- §11.1 — hitos que ejecuta OBUMA; acá solo se registra que ocurrieron.
  oc_emitida_at                 DATETIME         NULL,
  oc_numero                     VARCHAR(80)      NULL,
  pago_registrado_at            DATETIME         NULL,
  anticipo_pagado_at            DATETIME         NULL,
  anticipo_monto                DECIMAL(14,2)    NULL,
  factura_compra_registrada_at  DATETIME         NULL,
  carpeta_proyecto_creada_at    DATETIME         NULL,
  carpeta_proyecto_id           VARCHAR(120)     NULL,

  -- §11.2 — provisión de fondos y cuenta de origen (definición humana, "según montos y límites de
  -- traspaso" — el sistema no calcula el límite, solo registra qué se decidió).
  provision_fondos_at           DATETIME         NULL,
  provision_fondos_monto        DECIMAL(14,2)    NULL,
  cuenta_origen                 VARCHAR(200)     NULL,

  notas                         TEXT             NULL,
  actualizado_por               INT              NULL,
  actualizado_por_nombre        VARCHAR(160)     NULL,
  updated_at                    DATETIME     NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
