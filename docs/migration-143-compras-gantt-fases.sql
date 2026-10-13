-- migration-143-compras-gantt-fases.sql
-- MÓDULO DE COMPRAS — Gantt por fases con línea padre. Cada tarea del catálogo declara de qué hito
-- cuelga (ancla) y cuánto dura, en HORAS, para que el Gantt calcule sus tramos solo:
--   fase           PRE_OC | POST_OC | ENTREGA
--   ancla          ADJUDICACION | OC | OC_ACEPTADA | INICIO_PLAZO | FIN_PLAZO
--   desfase_horas  cuándo parte respecto del ancla (negativo = antes; con FIN_PLAZO: antes de la entrega)
--   duracion_horas cuánto dura (con ancla ADJUDICACION el fin sigue siendo `plazo_dias`)
-- Las tareas con ancla distinta de ADJUDICACION ya no usan `plazo_dias` (no se pueden vencer antes
-- de que exista el hito del que cuelgan): reloj_entrega, boleta y firma_contrato lo pierden.
-- Suma 7 tareas al catálogo (aprobación de compra, OC a proveedores, recepción, despacho, entrega,
-- acta firmada, factura y cierre). Los ADD COLUMN no son idempotentes en SQL puro: lo aplica el
-- runner `node scripts/aplicar-migration-143.mjs`, que se salta lo que ya existe.

ALTER TABLE compras_tarea_catalogo
  ADD COLUMN fase           VARCHAR(12) NULL,
  ADD COLUMN ancla          VARCHAR(16) NULL,
  ADD COLUMN desfase_horas  INT         NULL,
  ADD COLUMN duracion_horas INT         NULL;

UPDATE compras_tarea_catalogo SET fase = 'PRE_OC', ancla = 'ADJUDICACION', desfase_horas = 0
 WHERE clave IN ('contacto_inicial', 'validacion_tecnica_real', 'validacion_cotizacion', 'validacion_costeo', 'aceptar_oc');

UPDATE compras_tarea_catalogo SET fase = 'POST_OC', ancla = 'OC', desfase_horas = 0, duracion_horas = 24, plazo_dias = NULL WHERE clave = 'reloj_entrega';
UPDATE compras_tarea_catalogo SET fase = 'POST_OC', ancla = 'OC', desfase_horas = 0, duracion_horas = 120, plazo_dias = NULL WHERE clave IN ('boleta_fiel_cumplimiento', 'firma_contrato');
UPDATE compras_tarea_catalogo SET fase = 'POST_OC', ancla = 'OC', desfase_horas = 0, duracion_horas = 48 WHERE clave = 'contacto_pagos';

INSERT IGNORE INTO compras_tarea_catalogo (clave, categoria, titulo, descripcion, responsable_regla, plazo_dias, plazo_tipo, orden, fase, ancla, desfase_horas, duracion_horas) VALUES
('aprobar_compra', 'ADMINISTRATIVO', 'Aprobación de la compra y el margen',
 'El jefe de ventas aprueba la compra elegida y el margen. Sin esto no arranca lo administrativo.',
 'ENCARGADO', NULL, 'CORRIDOS', 55, 'POST_OC', 'OC', 0, 24),
('emitir_oc_proveedores', 'ADMINISTRATIVO', 'Emisión de órdenes de compra a proveedores',
 'Emitir las órdenes de compra a los proveedores elegidos (OBUMA) y confirmar plazo de despacho.',
 'ENCARGADO', NULL, 'CORRIDOS', 85, 'POST_OC', 'OC', 24, 48),
('recepcion_mercaderia', 'ENTREGA', 'Recepción y revisión de la mercadería',
 'Recibir en bodega, revisar contra la orden de compra y la ficha técnica, y registrar diferencias.',
 'ENCARGADO', NULL, 'CORRIDOS', 110, 'ENTREGA', 'FIN_PLAZO', -168, 72),
('despacho_mercaderia', 'ENTREGA', 'Despacho de la mercadería',
 'Rotulado, embalaje y guía de despacho hacia el cliente.',
 'ENCARGADO', NULL, 'CORRIDOS', 120, 'ENTREGA', 'FIN_PLAZO', -96, 72),
('entrega_cliente', 'ENTREGA', 'Entrega al cliente',
 'Entregar en el lugar y plazo comprometidos en las bases.',
 'ENCARGADO', NULL, 'CORRIDOS', 130, 'ENTREGA', 'FIN_PLAZO', -24, 24),
('acta_entrega_firmada', 'ENTREGA', 'Acta de entrega firmada',
 'Obtener el acta de recepción conforme firmada por el cliente.',
 'ENCARGADO', NULL, 'CORRIDOS', 140, 'ENTREGA', 'FIN_PLAZO', 0, 24),
('factura_cierre', 'ENTREGA', 'Factura y cierre del proyecto',
 'Emitir la factura de venta, confirmar el pago y cerrar el proyecto con su costo real.',
 'ENCARGADO', NULL, 'CORRIDOS', 150, 'ENTREGA', 'FIN_PLAZO', 24, 48);

-- Tareas ya sembradas que ahora cuelgan de la OC: sin plazo hasta que el hito exista.
UPDATE compras_tarea SET plazo_at = NULL
 WHERE catalogo_clave IN ('reloj_entrega', 'boleta_fiel_cumplimiento', 'firma_contrato') AND estado <> 'HECHA';
