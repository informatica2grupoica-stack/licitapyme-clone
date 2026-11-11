-- migration-191-sesiones-revocadas.sql
-- SEGURIDAD — cerrar sesión de verdad (QA de seguridad, 11-nov-2026).
--
-- El JWT dura 7 días y es «sin estado»: cerrar sesión solo borraba la cookie o el token del teléfono, y un token robado seguía valiendo.
-- Ahora cada token nuevo lleva un identificador (jti) y, al cerrar sesión, ese jti se anota aquí; el servidor rechaza los jti anotados.
-- Solo se revoca ESA sesión (no las demás del mismo usuario: cerrar en el teléfono no saca la sesión de la web).
-- Los tokens emitidos antes de esto no tienen jti y no se pueden revocar: vencen solos en 7 días.
--
-- Aplicar con `node scripts/aplicar-migration-191.mjs` (espejo local) o `--produccion`. Idempotente. Tabla nueva: no toca nada existente.

CREATE TABLE IF NOT EXISTS sesiones_revocadas (
  jti         VARCHAR(64) NOT NULL PRIMARY KEY,
  usuario_id  INT NOT NULL,
  expira_at   DATETIME NOT NULL,
  revocada_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sesiones_revocadas_expira (expira_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
