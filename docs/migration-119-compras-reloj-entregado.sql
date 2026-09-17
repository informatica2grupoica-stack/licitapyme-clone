-- migration-119-compras-reloj-entregado.sql
-- MÓDULO DE COMPRAS — Reloj de entrega: registrar la entrega real (spec §15).
--
-- El reloj (migration-95) solo sabía medir el plazo, la prórroga y la multa — no tenía forma de
-- decir "ya entregamos". Sin eso, una entrega hecha ANTES del vencimiento seguía mostrando
-- "Vencido" para siempre y el jefe de ventas terminaba usando los campos de prórroga/multa como
-- si fueran notas libres (motivo: "no se entregará con multa, entregamos antes") — un mal uso de
-- un campo que en realidad autoriza una excepción real.
--
-- `entregado_fecha` es la fecha real de entrega (dato del usuario, no calculado). Si es <= la
-- fecha límite vigente (prórroga si existe, si no la original), el reloj se considera cerrado a
-- tiempo y deja de mostrar "Vencido" ni de ofrecer prórroga/multa.
--
-- Aplicar con `node scripts/aplicar-migration-119.mjs`. Idempotente (revisa INFORMATION_SCHEMA).

ALTER TABLE compras_reloj
  ADD COLUMN entregado_fecha            DATE         NULL AFTER entrega_con_multa_autorizado_at,
  ADD COLUMN entregado_nota             VARCHAR(400)     NULL AFTER entregado_fecha,
  ADD COLUMN entregado_por              INT              NULL AFTER entregado_nota,
  ADD COLUMN entregado_por_nombre       VARCHAR(160)     NULL AFTER entregado_por,
  ADD COLUMN entregado_registrado_at    DATETIME         NULL AFTER entregado_por_nombre;
