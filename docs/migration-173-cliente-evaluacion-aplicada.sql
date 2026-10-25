-- migration-173-cliente-evaluacion-aplicada.sql
-- MULTI-CLIENTE: cuándo el admin de la empresa confirmó la configuración inicial (perfil + palabras clave sugeridas).
-- NULL = todavía no la hace → al entrar se le lleva a /mi-empresa. Requiere la 172.
ALTER TABLE cliente_evaluacion ADD COLUMN aplicado_at DATETIME NULL;
