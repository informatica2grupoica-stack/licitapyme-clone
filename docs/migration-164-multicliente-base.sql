-- migration-164-multicliente-base.sql
-- MULTI-CLIENTE, PASO A (ver docs/diseno-multitenant-fase1.md §7).
-- Deja la base lista para que existan varios clientes (empresas que contratan LICITANK), sin cambiar
-- nada de lo que hoy ve el cliente 1 (Grupo ICA): todas las columnas nuevas nacen con DEFAULT 1.
--
--  1) `clientes` pasa de "lista de nombres" a ficha comercial: plan, tope de usuarios, estado,
--     vencimiento y módulos contratados.
--  2) `usuarios.cliente_id`: a qué cliente pertenece cada persona (fuente de verdad del aislamiento).
--  3) `usuarios.es_superadmin`: quien administra TODOS los clientes (solo ICA). No es un rol nuevo
--     del ENUM a propósito: así ninguno de los `rol === 'admin'` actuales cambia de significado.
--
-- Cliente 1 (Grupo ICA): sin tope de usuarios (max_usuarios NULL) y todos los módulos (modulos NULL).
-- Un cliente nuevo parte con max_usuarios = 2 y solo Radar + Negocios.
--
-- MySQL no soporta ADD COLUMN IF NOT EXISTS: scripts/aplicar-migration-164.mjs comprueba antes y
-- solo corre lo que falta. Aplicar SOLO en la BD local mientras dure el desarrollo multi-cliente.

ALTER TABLE clientes ADD COLUMN plan            VARCHAR(40)  NOT NULL DEFAULT 'EQUIPO';
ALTER TABLE clientes ADD COLUMN max_usuarios    INT          NULL     DEFAULT 2;
ALTER TABLE clientes ADD COLUMN estado          VARCHAR(12)  NOT NULL DEFAULT 'ACTIVO';
ALTER TABLE clientes ADD COLUMN vence_at        DATE         NULL;
ALTER TABLE clientes ADD COLUMN modulos         JSON         NULL;
ALTER TABLE clientes ADD COLUMN cupo_ia_mensual INT          NOT NULL DEFAULT 0;
ALTER TABLE clientes ADD COLUMN contacto_nombre VARCHAR(160) NULL;
ALTER TABLE clientes ADD COLUMN contacto_email  VARCHAR(190) NULL;
ALTER TABLE clientes ADD COLUMN notas           TEXT         NULL;

ALTER TABLE usuarios ADD COLUMN cliente_id      INT          NOT NULL DEFAULT 1;
ALTER TABLE usuarios ADD COLUMN es_superadmin   TINYINT(1)   NOT NULL DEFAULT 0;
ALTER TABLE usuarios ADD INDEX idx_usuarios_cliente (cliente_id);

-- El dueño del sistema: plan interno, sin tope de usuarios, todos los módulos.
UPDATE clientes SET plan = 'INTERNO', max_usuarios = NULL, modulos = NULL WHERE id = 1;
