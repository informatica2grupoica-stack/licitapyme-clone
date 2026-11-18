-- migration-197-evaluacion-rut-cola.sql
-- MULTI-CLIENTE (Fase 2, 2026-11-18): la evaluación de una empresa-cliente por sus RUT pasa a ser una COLA que sobrevive a un
-- deploy o reinicio (antes corría dentro del proceso de la app y se cortaba). Solo AGREGA: no borra ni cambia datos.
--
-- 1) cliente_evaluacion: dónde quedó (cursor) para seguir desde ahí, y cuándo reintentar si se acabó el cupo de MP del día.
ALTER TABLE cliente_evaluacion ADD COLUMN `cursor`      JSON     NULL;  -- CURSOR es palabra reservada en MySQL: siempre entre comillas invertidas
ALTER TABLE cliente_evaluacion ADD COLUMN reintentar_at DATETIME NULL;
ALTER TABLE cliente_evaluacion ADD INDEX ix_cliente_evaluacion_estado (estado, reintentar_at);

-- 2) Caché PÚBLICA de Mercado Público para la evaluación (datos oficiales, se comparten entre empresas: una segunda empresa o una
--    re-evaluación no vuelve a gastar las mismas consultas).
--    Detalle de cada orden de compra (ítems, comprador, montos).
CREATE TABLE IF NOT EXISTS mp_oc_publica (
  codigo        VARCHAR(40)  NOT NULL PRIMARY KEY,
  proveedor_rut VARCHAR(20)  NULL,
  raw_json      LONGTEXT     NOT NULL,
  fetched_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_mp_oc_publica_rut (proveedor_rut)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 3) ordenes_compra: de QUÉ empresa-cliente es cada OC «nuestra» (la del proveedor por RUT). Las de terceros (contexto: la OC del
--    competidor que ganó) quedan NULL = se leen como de Grupo ICA, igual que hoy. Todo lo que ya existe es de ICA → 1.
ALTER TABLE ordenes_compra ADD COLUMN cliente_id INT NULL;
ALTER TABLE ordenes_compra ADD INDEX ix_ordenes_compra_cliente_lic (cliente_id, licitacion_codigo);
UPDATE ordenes_compra o JOIN empresas e ON e.id = o.empresa_id SET o.cliente_id = e.cliente_id WHERE o.es_nuestra = 1 AND o.cliente_id IS NULL;
UPDATE ordenes_compra SET cliente_id = 1 WHERE es_nuestra = 1 AND cliente_id IS NULL;

--    Listado de OC de UN proveedor en UN día (solo días ya cerrados: más de 2 días atrás, que no cambian).
CREATE TABLE IF NOT EXISTS mp_oc_proveedor_dia (
  codigo_proveedor VARCHAR(30) NOT NULL,
  fecha            DATE        NOT NULL,
  codigos          JSON        NOT NULL,
  fetched_at       DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (codigo_proveedor, fecha)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
