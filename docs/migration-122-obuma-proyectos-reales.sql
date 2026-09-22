-- migration-122-obuma-proyectos-reales.sql
-- Snapshot de los Proyectos REALES de Obuma (módulo v2.0, "Listar Proyectos"), leídos a mano desde
-- la web de Obuma (con sesión del usuario) el 22-sep-2026 — NO es un cruce en vivo, porque la API
-- v2.0 sigue bloqueada (falta el header access-url, módulo no contratado). Ver
-- docs/BITACORA-MODULO-COMPRAS.md §17.3.7 para el contexto completo.
--
-- Esto reemplaza, para el cruce con nuestras licitaciones, al método anterior (adivinar el código
-- de licitación dentro del NOMBRE del centro de costo v1) por el campo REAL que usa Obuma:
-- "REFERENCIA" de la ficha del Proyecto — mucho más confiable, aunque tampoco 100% limpio (a veces
-- trae "ID 1596-16-LP16", a veces "OC 1471-58-SE26", a veces solo el nombre del cliente sin código).
--
-- folio = número correlativo del Proyecto en Obuma (NO es el mismo ID que rel_proyecto_id de
-- contabilidadCentrosDeCostos.list.json — son dos numeraciones distintas, no se pueden cruzar entre
-- sí sin este puente).
--
-- Aplicar con `node scripts/aplicar-migration-122.mjs`. Idempotente: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS obuma_proyectos_reales (
  folio            INT           NOT NULL PRIMARY KEY,  -- folio del Proyecto en Obuma (Ficha Proyecto #N)
  fecha_ingreso    DATE              NULL,
  fecha_inicio     DATE              NULL,
  nombre           VARCHAR(300)      NULL,
  referencia       VARCHAR(200)      NULL,   -- campo real de Obuma — normalmente trae el código de licitación
  cliente          VARCHAR(300)      NULL,
  presupuesto      DECIMAL(14,2)     NULL,
  costo            DECIMAL(14,2)     NULL,
  precio_neto      DECIMAL(14,2)     NULL,
  facturado_neto   DECIMAL(14,2)     NULL,   -- NULL = "No" (no facturado) en la ficha real
  estado           VARCHAR(40)       NULL,   -- Abierto | Cerrado | Cancelado | En proceso | Rechazado
  capturado_at     DATETIME      NOT NULL,   -- cuándo se leyó este snapshot (no es en vivo)
  INDEX idx_obuma_proy_reales_referencia (referencia)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
