-- migration-124-reportes-error-solucion-visible.sql
-- El admin decide si el texto de la solución lo ve quien reportó el error ("a todos") o queda
-- solo para los administradores (a veces es información interna). Default 1 = visible, igual que
-- se comportaba hasta ahora. El AVISO de cambio de estado le llega al perfil igual en ambos casos;
-- lo único que se oculta es el texto.
--
-- Aplicar con `node scripts/aplicar-migration-124.mjs`. Idempotente.

ALTER TABLE reportes_error ADD COLUMN solucion_visible TINYINT(1) NOT NULL DEFAULT 1 AFTER solucion;
