-- migration-97-compras-importacion.sql
-- MÓDULO DE COMPRAS — Ruta de importación y costeo aterrizado (spec §12).
--
-- §12.1: "el proyecto se clasifica DESDE EL INICIO como importación o compra local. Es una
-- bifurcación dentro del mismo flujo, no dos módulos" — por eso `origen_compra` vive como columna
-- directa en `compras_asignacion` (igual patrón que `modalidad_retiro`), no como tabla aparte.
--
-- §12.3: "la cotización FOB no es el costo del producto... el precio que entra al comparativo debe
-- ser el costo final real puesto en bodega, o el margen se calcula sobre una cifra falsa."
-- `compras_embarque` es UNA fila por negocio (un embarque por proyecto, no un historial) con los
-- tres componentes que hay que sumarle al FOB: flete internacional (VALOR GLOBAL del embarque, no
-- por producto — de ahí que viva acá y no en cada cotización), costos de aduana, costo logístico
-- local. Método de cálculo real (tabla de la spec): "prorrateo del flete internacional | por
-- unidad" — NO se arrastra la fórmula gruesa de Fase 3 (FOB × 1000 × 1,06 × 1,3 × 1,19), que sirve
-- para decidir si OFERTAR, no para decidir la COMPRA (spec, tabla de reglas de cálculo).
--
-- §12.4 — nota explícita de la propia spec para el desarrollo: "OBUMA tiene un módulo propio de
-- Gestión de Importaciones. Debe revisarse antes de construir este cálculo: puede que ya resuelva
-- el prorrateo." No hay endpoint de ese módulo disponible hoy (mismo caso que SKU/fleteros, §7.5/
-- §13.3) — este cálculo es el "método efectivo" que la propia spec describe mientras esa
-- integración no exista, no un reemplazo definitivo de lo que OBUMA pueda resolver.
--
-- Aplicar con `node scripts/aplicar-migration-97.mjs`. Idempotente: columna con chequeo previo en
-- el script (igual que migration-93/modalidad_retiro) + CREATE TABLE IF NOT EXISTS.

-- (el script aplicador comprueba si la columna ya existe antes de correr este ALTER)
ALTER TABLE compras_asignacion
  ADD COLUMN origen_compra VARCHAR(16) NULL,  -- LOCAL | IMPORTACION (§12.1)
  ADD COLUMN origen_compra_por INT NULL,
  ADD COLUMN origen_compra_por_nombre VARCHAR(160) NULL,
  ADD COLUMN origen_compra_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS compras_embarque (
  negocio_id              INT           NOT NULL PRIMARY KEY,
  flete_internacional     DECIMAL(18,2)     NULL,  -- valor GLOBAL del embarque, no por producto (§12.3)
  costos_aduana           DECIMAL(18,2)     NULL,  -- ingreso manual (tabla de reglas de cálculo, spec §12)
  costo_logistico_local   DECIMAL(18,2)     NULL,  -- desaduanaje + traslado a bodega, ingreso manual
  moneda                  VARCHAR(6)    NOT NULL DEFAULT 'CLP',  -- moneda y tipo de cambio los maneja OBUMA (§12) — informativo acá
  notas                   TEXT              NULL,
  registrado_por          INT               NULL,
  registrado_por_nombre   VARCHAR(160)      NULL,
  created_at              DATETIME      NOT NULL,
  updated_at              DATETIME      NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
