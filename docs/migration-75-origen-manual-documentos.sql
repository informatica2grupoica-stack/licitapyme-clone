-- Migration 75: columna origen_manual en documentos_cache
-- Marca los documentos que el usuario SUBIÓ A MANO directamente en una caja de la licitación
-- (Bases Administrativas, Bases Técnicas, Anexos Oferente, etc.) mediante el botón "Subir
-- documento(s) a esta caja" — a diferencia de los descargados automáticamente de Mercado
-- Público. Solo estos (y los ya cubiertos por CATS_PROPIAS en el código) se pueden
-- eliminar/renombrar; los oficiales de MP quedan protegidos aunque compartan la misma caja.
-- Ver también migration-47 (categoria_manual), que protege a estos mismos documentos de ser
-- reasignados de caja por una re-clasificación IA.
-- Ejecutar en Bluehost phpMyAdmin.

ALTER TABLE documentos_cache
  ADD COLUMN origen_manual TINYINT(1) NOT NULL DEFAULT 0 AFTER categoria_manual;
