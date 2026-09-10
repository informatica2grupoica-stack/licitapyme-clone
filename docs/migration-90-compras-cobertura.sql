-- migration-90-compras-cobertura.sql
-- MÓDULO DE COMPRAS — Estados y subestados de cobertura por producto (spec §14).
--
-- El proyecto MercadoPúblico es dicotómico a nivel de negocio: se puede entregar o no se puede
-- entregar (§14.1). Lo que SÍ tiene grados es cada producto/línea ganada: diez productos son diez
-- subestados de cumplimiento, y los diez deben estar cubiertos para poder entregar (§14.2,
-- "cobertura total o nada"). Esta tabla es la unidad que lleva ese subestado.
--
-- ORIGEN DE LOS DATOS: una línea/producto entra acá SOLO si se ganó de verdad — se puebla leyendo
-- `adjudicacion_cache.lineas` (JSON) filtrado por `esNuestra = true` (ver app/lib/adjudicacion.ts),
-- que es la ÚNICA fuente del sistema que sabe el resultado LÍNEA POR LÍNEA (a diferencia de
-- `negocio_lineas_oferta`, que es intención de oferta, no resultado). Si el negocio es de
-- adjudicación total (sin líneas separadas en el acta), se crea una sola fila "global".
--
-- RENUNCIA A LÍNEA (§14.5): sale del cómputo de cobertura, pero no se borra — queda como registro
-- de que existió y de por qué se renunció, con doble responsable (quien la propone y quien la
-- aprueba, igual patrón que las Compuertas de Aprobación §10).
--
-- Aplicar con `node scripts/aplicar-migration-90.mjs`. Idempotente: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS compras_producto (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id            INT          NOT NULL,
  correlativo           INT              NULL,  -- correlativo de la línea en el acta de MP, si existe
  descripcion           VARCHAR(500) NOT NULL,
  cantidad              DECIMAL(14,3)    NULL,
  unidad                VARCHAR(40)      NULL,
  monto_unitario        DECIMAL(18,2)    NULL,  -- lo adjudicado (lo que se vendió), no lo que costará comprar
  subestado             VARCHAR(24)  NOT NULL DEFAULT 'PENDIENTE',
    -- PENDIENTE | COTIZANDO | COMPRADO | EN_BODEGA | LISTO_ENTREGA | ENTREGADO | RENUNCIADO
  renuncia_motivo       TEXT             NULL,
  renuncia_propuesta_por      INT              NULL,
  renuncia_propuesta_por_nombre VARCHAR(160)   NULL,
  renuncia_propuesta_at       DATETIME         NULL,
  renuncia_aprobada_por        INT              NULL,  -- jefe de ventas (§14.5)
  renuncia_aprobada_por_nombre VARCHAR(160)     NULL,
  renuncia_aprobada_at         DATETIME         NULL,
  created_at            DATETIME     NOT NULL,
  updated_at            DATETIME     NOT NULL,
  INDEX idx_compras_producto_negocio (negocio_id, subestado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
