-- migration-107-compras-cierre-legado.sql
-- MÓDULO DE COMPRAS — cierre rápido para el backlog histórico (11-sep-2026).
--
-- El usuario pidió cargar a Compras los 45 negocios ADJUDICADA que quedaron fuera cuando el
-- módulo arrancó "limpio" (04-sep-2026, ver docs/BITACORA-MODULO-COMPRAS.md §7) — y una forma
-- RÁPIDA de marcar cuáles de esos ya se entregaron o nunca se concretaron, sin obligarlos a pasar
-- por el flujo completo de Entrega (§16: verificación, acta, firma) ni de Fracaso (§14.6:
-- declaración + dictamen del jefe de ventas) — esos flujos son para el trabajo EN VIVO, no para
-- limpiar historial. `cierre_legado` es deliberadamente una marca aparte de `compras_entrega` y
-- `compras_fracaso`: no se inventa una verificación/dictamen que nunca pasó.
--
-- Aplicar con `node scripts/aplicar-migration-107.mjs`. Idempotente: columna con chequeo previo en
-- el script.

ALTER TABLE compras_asignacion
  ADD COLUMN cierre_legado VARCHAR(16) NULL,             -- ENTREGADA | NO_REALIZADA
  ADD COLUMN cierre_legado_nota VARCHAR(300) NULL,
  ADD COLUMN cierre_legado_por INT NULL,
  ADD COLUMN cierre_legado_por_nombre VARCHAR(160) NULL,
  ADD COLUMN cierre_legado_at DATETIME NULL;
