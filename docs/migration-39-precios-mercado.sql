-- migration-39-precios-mercado.sql
-- Caché de precios de mercado (buscador de productos portado desde grupoica-intranet).
-- Evita repagar Serper/IA cuando se cotiza el mismo ítem (dentro de una licitación y entre
-- licitaciones distintas). La clave es el producto normalizado + región + rubro.
--
-- Se guarda el JSON completo de resultados (top-N) para poder mostrar alternativas en la hoja
-- "PRECIOS MERCADO" del Excel de costeo y en el buscador manual, sin re-consultar.

CREATE TABLE IF NOT EXISTS precios_mercado (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  clave         VARCHAR(255) NOT NULL,               -- hash/normalización de producto+region+rubro
  producto      VARCHAR(500) NOT NULL,               -- nombre original consultado (para depurar)
  region        VARCHAR(120)     NULL,
  rubro         VARCHAR(120)     NULL,
  -- Mejor match (denormalizado para consultas rápidas / ordenar por confianza):
  precio_neto   INT              NULL,
  precio_iva    INT              NULL,               -- precio con IVA (valor)
  tienda        VARCHAR(120)     NULL,
  link          TEXT             NULL,
  score         INT              NULL,
  nivel         VARCHAR(20)      NULL,               -- exacta/alta/parcial/baja/nula
  resultados    JSON             NULL,               -- top-N completo (alternativas)
  total         INT          NOT NULL DEFAULT 0,     -- cuántos resultados se encontraron
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_clave (clave),
  KEY idx_producto (producto(120)),
  KEY idx_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
