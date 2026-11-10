-- migration-189: el RUT de una razón social es único POR CLIENTE, no en toda la plataforma.
-- Antes: UNIQUE (rut) → dos clientes no podían registrar el mismo RUT (p. ej. Comercial MP es razón social de ICA y también cliente de prueba)
--        y el error "Ya existe una empresa con ese RUT" revelaba que el RUT estaba en OTRA empresa.
-- Ahora: UNIQUE (cliente_id, rut). Lo existente no cambia (todo sigue con su cliente_id). Idempotente; lo aplica scripts/aplicar-migration-189.mjs
-- (crea el índice nuevo ANTES de quitar el viejo: la tabla nunca queda sin protección contra duplicados).
ALTER TABLE empresas ADD UNIQUE KEY uq_empresa_cliente_rut (cliente_id, rut);
ALTER TABLE empresas DROP INDEX uq_empresa_rut;
