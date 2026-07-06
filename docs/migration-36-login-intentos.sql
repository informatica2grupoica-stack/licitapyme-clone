-- migration-36-login-intentos.sql
-- Protección de FUERZA BRUTA para el login, SIN depender de Redis/Upstash (funciona
-- también en el notebook/Docker donde no hay Redis).
--
-- Registra cada intento de login (email + IP + éxito). El endpoint /api/auth/login
-- cuenta los intentos FALLIDOS recientes por email y por IP dentro de una ventana y
-- bloquea temporalmente cuando se superan los umbrales:
--   · por email → frena el ataque contra UNA cuenta concreta.
--   · por IP    → frena el "password spraying" (probar 1 pass contra muchos emails).
--
-- La tabla se auto-limpia: el endpoint borra filas más viejas que la ventana en cada
-- intento, así se mantiene pequeña (los índices por fecha resuelven el conteo rápido).
--
-- SEGURO / idempotente: CREATE TABLE IF NOT EXISTS. No toca datos existentes.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS login_intentos (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email      VARCHAR(255)    NOT NULL,
  ip         VARCHAR(64)     NOT NULL,
  exito      TINYINT(1)      NOT NULL DEFAULT 0,
  creado_en  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_login_email_fecha (email, creado_en),
  KEY idx_login_ip_fecha (ip, creado_en),
  KEY idx_login_fecha (creado_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
