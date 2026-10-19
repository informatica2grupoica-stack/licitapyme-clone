-- migration-154: qué productos de la compra vienen del extranjero (no todo el negocio es importación).
ALTER TABLE compras_producto ADD COLUMN importado TINYINT(1) NOT NULL DEFAULT 0;
