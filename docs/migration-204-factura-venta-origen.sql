-- migration-204: de dónde vino cada factura de venta (pedido del dueño, 23-nov-2026).
--   MANUAL = la subió una persona (PDF): se ve el PDF.   OBUMA = la trajo Licitank desde Obuma: se ve el visor tipo factura hecho con el XML.
-- Las ya cargadas quedan como MANUAL (se siguen viendo como PDF, sin cambios).
ALTER TABLE compras_factura_venta
  ADD COLUMN origen  VARCHAR(10)  NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN xml_url VARCHAR(600) NULL;
