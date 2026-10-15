-- migration-146: compras_aprobacion.estado era VARCHAR(24) y 'APROBADA_CON_MODIFICACION' tiene 25 letras:
-- se guardaba cortado ('APROBADA_CON_MODIFICACIO') y el sistema no lo reconocía como aprobado.
-- Se ensancha la columna y se reparan las filas ya cortadas. Idempotente.
ALTER TABLE compras_aprobacion MODIFY estado VARCHAR(40) NOT NULL DEFAULT 'PENDIENTE';
UPDATE compras_aprobacion SET estado = 'APROBADA_CON_MODIFICACION' WHERE estado = 'APROBADA_CON_MODIFICACIO';
