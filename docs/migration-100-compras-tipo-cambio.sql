-- migration-100-compras-tipo-cambio.sql
-- MÓDULO DE COMPRAS — Tipo de cambio diario para cotizaciones en moneda extranjera.
--
-- Hallazgo real (09-sep-2026, cotización real de Unisource Ingeniería para el sensor de
-- 1114-12-LE26): las cotizaciones pueden venir en USD, pero el cuadro comparativo y los 4
-- escenarios de compra (§8.7-§8.10) comparaban `precio_unitario` tal cual, sin convertir —
-- comparar un número en dólares contra otros en pesos como si fueran la misma moneda.
--
-- Fuente del tipo de cambio: mindicador.cl (API pública oficial chilena, dólar observado, sin
-- llave). Se consulta UNA vez por día y se cachea acá — no se le pega a la API en cada cotización.
-- Pedido explícito del usuario: "el tipo de cambio debe ser el dólar actual, como lo podemos
-- rescatar diario."
--
-- `compras_cotizacion` guarda AMBOS valores: el original en su moneda (precio_unitario,
-- precio_total, moneda — para mostrar el documento tal cual llegó) y el convertido a CLP
-- (precio_unitario_clp, precio_total_clp) que es el que de verdad entra al cuadro comparativo, los
-- escenarios y el margen — junto con `tipo_cambio_usado`, la foto del tipo de cambio del día en que
-- se registró (nunca se recalcula después: es lo que valía ESE día, no lo que vale hoy).
--
-- Aplicar con `node scripts/aplicar-migration-100.mjs`. Idempotente: CREATE TABLE IF NOT EXISTS +
-- columnas con chequeo previo en el script.

CREATE TABLE IF NOT EXISTS compras_tipo_cambio (
  fecha         DATE         NOT NULL,
  moneda        VARCHAR(6)   NOT NULL DEFAULT 'USD',
  valor         DECIMAL(10,2) NOT NULL,  -- cuántos CLP vale 1 unidad de `moneda`
  fuente        VARCHAR(100) NOT NULL,
  consultado_at DATETIME     NOT NULL,
  PRIMARY KEY (fecha, moneda)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- (el script aplicador comprueba si las columnas ya existen antes de correr este ALTER)
ALTER TABLE compras_cotizacion
  ADD COLUMN tipo_cambio_usado   DECIMAL(10,2) NULL,  -- NULL si la cotización ya estaba en CLP
  ADD COLUMN precio_unitario_clp DECIMAL(18,2) NULL,  -- = precio_unitario si moneda=CLP; convertido si no
  ADD COLUMN precio_total_clp    DECIMAL(18,2) NULL;
