-- migration-63-empresas-titular-cuenta.sql
-- Agrega el TITULAR de la cuenta bancaria (nombre + RUT) como campos propios de `empresas`.
-- Hasta ahora el perfil bancario solo guardaba tipo de cuenta / número / banco / email de pagos
-- (migration-40) — ninguno identifica A NOMBRE DE QUIÉN está la cuenta. Varios anexos reales
-- (caso real 1058086-43-LP26, tabla "DATOS PARA PAGO") piden "Nombre del Titular" y "Cédula de
-- Identidad del Titular" como casillas separadas de la razón social/RUT de la empresa — sin estos
-- campos esas dos casillas quedan pendientes SIEMPRE, sin importar cuántas veces se llenen a mano
-- en el modal de relleno (ver analizarAnexoParaUI: no hay dato en la ficha para autocompletarlas).
--
-- Mismo criterio de nombres que representante_nombre/representante_rut (RUT, nunca "cedula", como
-- columna — ver DESCRIPCION_CAMPO en anexos-ia-motor.ts).
--
-- Aplicar con: node scripts/aplicar-migration-63.mjs (Bluehost no soporta
-- "ADD COLUMN IF NOT EXISTS", el script ya comprueba antes si la columna existe).
ALTER TABLE empresas ADD COLUMN banco_titular_nombre VARCHAR(160) DEFAULT NULL;
ALTER TABLE empresas ADD COLUMN banco_titular_rut     VARCHAR(20)  DEFAULT NULL;
