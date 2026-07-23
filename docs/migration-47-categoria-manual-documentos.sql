-- Migration 47: columna categoria_manual en documentos_cache
-- Marca cuando un documento DE LA LICITACIÓN (no Documentos Propios) fue movido a mano por
-- el usuario entre cajas oficiales (Bases Administrativas, Bases Técnicas, Anexos, etc.) —
-- para que un re-análisis o re-clasificación con IA NUNCA le pise el cambio. Mismo patrón de
-- protección que ya existía para categoria = 'DOCUMENTOS_PROPIOS', extendido a cualquier caja.
-- Ejecutar en Bluehost phpMyAdmin.

ALTER TABLE documentos_cache
  ADD COLUMN categoria_manual TINYINT(1) NOT NULL DEFAULT 0 AFTER categoria;
