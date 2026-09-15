-- migration-117-compras-agente-plazo-detectado.sql
-- Pedido explícito del usuario (15-sep-2026): el Resumen Ejecutivo mostraba "15 días hábiles
-- (tope de las bases — no se registró el plazo ofertado)" como relleno cuando el Auditor Técnico
-- todavía no tiene cargado el plazo comprometido con el cliente. En vez de ese texto genérico, se
-- usa el plazo que la auditoría con IA ("Auditar este negocio completo con IA") ya detecta al leer
-- los documentos reales (bases + nuestros propios anexos, ej. "Oferta Económica, Plazo Entrega y
-- Garantía") — más adelante el Auditor Técnico lo reemplazará como fuente principal, pero mientras
-- tanto es mejor un dato leído de un documento real que un texto de relleno.
--
-- Aplicar con `node scripts/aplicar-migration-117.mjs`. Idempotente: ADD COLUMN IF NOT EXISTS.

ALTER TABLE compras_agente_auditoria_negocio
  ADD COLUMN IF NOT EXISTS plazo_entrega_json TEXT NULL AFTER documentos_leidos_json;
