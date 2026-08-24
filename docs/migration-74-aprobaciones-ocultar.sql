-- migration-74-aprobaciones-ocultar.sql
-- OCULTAR un negocio de la bandeja de Aprobaciones (Fase 2), sin tocar nada más.
--
-- POR QUÉ (21-ago-2026): el botón "Eliminar" de /aprobaciones usaba el DELETE de
-- /api/negocios/[id], que hace activo = FALSE — eso saca al negocio de TODOS lados
-- (Negocios, Postuladas, dashboard del asignado, etc.), no solo de Aprobaciones. Un admin lo usó
-- para limpiar 8 tarjetas de la bandeja y de paso le desapareció el negocio a cada asistente
-- asignado. Esta columna es la forma correcta: solo afecta lo que construirBandeja() (ver
-- app/api/aprobaciones/route.ts) lee para armar la lista, el negocio sigue activo y visible en
-- todo el resto de la app.
--
-- oculto_aprobaciones_por/_at quedan para saber quién lo sacó de la bandeja y cuándo (mismo
-- patrón que descarte_motivo/descarte_por/descarte_at de migration-33).
--
-- Aplicar con: node scripts/aplicar-migration-74.mjs

ALTER TABLE negocios
  ADD COLUMN oculto_aprobaciones     TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN oculto_aprobaciones_por INT            NULL DEFAULT NULL,
  ADD COLUMN oculto_aprobaciones_at  DATETIME       NULL DEFAULT NULL;
