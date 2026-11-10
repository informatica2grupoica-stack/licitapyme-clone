-- migration-188-push-tokens.sql
-- APP MÓVIL — avisos push (pedido del dueño, 10-nov-2026).
--
-- Cada teléfono que entra a la app registra su «Expo push token» (ExponentPushToken[...]) asociado al usuario.
-- Cuando se crea un aviso para esa persona (mismo lugar que alimenta la campana: registrarEvento en
-- app/lib/historial.ts), el servidor lo manda también al teléfono vía Expo → Firebase (FCM).
--
-- Un token es de UN teléfono; si otra persona entra en ese teléfono, el token pasa a ella (UNIQUE por token).
-- Multiempresa: cliente_id sale de usuarios.cliente_id (COALESCE 1) y se guarda para poder acotar por empresa.
--
-- Aplicar con `node scripts/aplicar-migration-188.mjs` (espejo local) o `--produccion`. Idempotente.

CREATE TABLE IF NOT EXISTS push_tokens (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id  INT          NOT NULL DEFAULT 1,
  usuario_id  INT          NOT NULL,
  token       VARCHAR(255) NOT NULL,
  plataforma  VARCHAR(16)  NULL,
  created_at  DATETIME     NOT NULL,
  updated_at  DATETIME     NOT NULL,
  UNIQUE KEY uq_push_token (token),
  KEY idx_push_cliente_usuario (cliente_id, usuario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
