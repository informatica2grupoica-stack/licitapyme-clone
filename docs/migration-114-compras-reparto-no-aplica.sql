-- migration-114-compras-reparto-no-aplica.sql
-- Pedido explícito del usuario (14-sep-2026): "que pasa con las que no se realizan, ya que a veces
-- no realizamos anticipo, pagamos todo" — no todos los hitos del Proceso Administrativo (§11)
-- aplican siempre (ej. "Anticipo pagado" no corresponde si se paga de contado). Sin esto, esos
-- hitos quedaban eternamente pendientes en el checklist sin forma de decir "esto no va a pasar,
-- y está bien que no pase". `estado` distingue el respaldo de un hito HECHO de uno marcado NO_APLICA
-- (con motivo obligatorio en la misma columna `nota` que ya existe) — la fecha del hito
-- (compras_reparto_administrativo.<hito>_at) solo se pone para HECHO, nunca para NO_APLICA.
--
-- Aplicar con `node scripts/aplicar-migration-114.mjs`. Idempotente: columna con chequeo previo.

ALTER TABLE compras_reparto_respaldo
  ADD COLUMN estado ENUM('HECHO','NO_APLICA') NOT NULL DEFAULT 'HECHO';
