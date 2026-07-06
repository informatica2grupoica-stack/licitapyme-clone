-- migration-37-password-resets.sql
-- Recuperación de contraseña por correo (autoservicio desde el login).
--
-- Flujo: el usuario pide recuperar → se genera un token aleatorio, se guarda SOLO su
-- hash (SHA-256) con vencimiento, y se envía el token en claro dentro del enlace por
-- correo. Al abrir el enlace y fijar la clave nueva, se marca `usado` y se invalida.
--
-- Guardamos el HASH del token (no el token en claro): si se filtra la tabla, los enlaces
-- no son utilizables. El token en claro solo viaja en el correo y nunca se persiste.
--
-- SEGURO / idempotente: CREATE TABLE IF NOT EXISTS. No toca datos existentes.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS password_resets (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id  INT             NOT NULL,
  token_hash  CHAR(64)        NOT NULL,
  expira_en   DATETIME        NOT NULL,
  usado_en    DATETIME        NULL DEFAULT NULL,
  ip          VARCHAR(64)     NULL DEFAULT NULL,
  creado_en   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_token_hash (token_hash),
  KEY idx_usuario (usuario_id),
  KEY idx_expira (expira_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
