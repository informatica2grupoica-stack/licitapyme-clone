-- migration-203: estado de la compra (Abierta -> En proceso -> Entregada -> Pagada; o Cancelada con motivo).
-- Pedido del dueño, 23-nov-2026. Entregada NO es cerrada: la licitación se cierra recién cuando está facturada al cliente y pagada.
-- Convive con cierre_legado: PAGADA deja cierre_legado = 'ENTREGADA' (pestaña Cerradas) y CANCELADA deja 'NO_REALIZADA' (pestaña Canceladas).
ALTER TABLE compras_asignacion
  ADD COLUMN estado_compra VARCHAR(12) NOT NULL DEFAULT 'ABIERTA',
  ADD COLUMN estado_compra_at DATETIME NULL,
  ADD COLUMN estado_compra_por_nombre VARCHAR(160) NULL;

-- Lo que ya estaba cerrado o cancelado
UPDATE compras_asignacion SET estado_compra = 'PAGADA' WHERE cierre_legado = 'ENTREGADA';
UPDATE compras_asignacion SET estado_compra = 'CANCELADA' WHERE cierre_legado IN ('NO_REALIZADA', 'OC_CANCELADA');

-- Lo abierto, según su avance real
UPDATE compras_asignacion ca SET ca.estado_compra = 'EN_PROCESO'
 WHERE ca.cierre_legado IS NULL AND ca.precompra = 0 AND ca.estado_compra = 'ABIERTA'
   AND EXISTS (SELECT 1 FROM compras_tarea t WHERE t.negocio_id = ca.negocio_id AND t.estado <> 'PENDIENTE');
UPDATE compras_asignacion ca SET ca.estado_compra = 'ENTREGADA'
 WHERE ca.cierre_legado IS NULL AND ca.precompra = 0 AND ca.estado_compra IN ('ABIERTA', 'EN_PROCESO')
   AND EXISTS (SELECT 1 FROM compras_reloj r WHERE r.negocio_id = ca.negocio_id AND r.entregado_fecha IS NOT NULL);
