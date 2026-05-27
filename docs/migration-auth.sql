-- ============================================================
-- MIGRACIÓN: Sistema de Autenticación y Usuarios
-- Ejecutar en orden en la base de datos Bluehost (MySQL)
-- Fecha: 2026-05-27
-- ============================================================

-- 1. TABLA DE USUARIOS
-- ============================================================
CREATE TABLE IF NOT EXISTS usuarios (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  nombre        VARCHAR(255),
  empresa       VARCHAR(255),
  rol           ENUM('admin', 'usuario') NOT NULL DEFAULT 'usuario',
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  ultimo_login  TIMESTAMP NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_rol   (rol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. AGREGAR usuario_id A FAVORITOS
-- ============================================================
-- Primero verificar si la columna ya existe antes de correr
ALTER TABLE favoritos
  ADD COLUMN usuario_id INT NULL AFTER id,
  ADD INDEX idx_fav_usuario (usuario_id),
  ADD CONSTRAINT fk_fav_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;

-- 3. AGREGAR usuario_id A DOCUMENTOS_CACHE
-- ============================================================
ALTER TABLE documentos_cache
  ADD COLUMN usuario_id INT NULL AFTER id,
  ADD INDEX idx_docs_usuario (usuario_id),
  ADD CONSTRAINT fk_docs_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL;

-- 4. TABLA DE CACHÉ DE ANÁLISIS IA
-- ============================================================
CREATE TABLE IF NOT EXISTS analisis_cache (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id        INT NOT NULL,
  licitacion_codigo VARCHAR(100) NOT NULL,
  documento_nombre  VARCHAR(500) NOT NULL,
  tipo_analisis     ENUM('completo', 'resumen', 'pregunta') NOT NULL,
  pregunta          TEXT,
  resultado         JSON NOT NULL,
  tokens_usados     INT,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_analisis_usuario     (usuario_id),
  INDEX idx_analisis_licitacion  (usuario_id, licitacion_codigo),
  INDEX idx_analisis_documento   (licitacion_codigo, documento_nombre(100)),
  CONSTRAINT fk_analisis_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. CREAR PRIMER USUARIO ADMIN
-- ============================================================
-- Usuario admin inicial con contraseña: Ica2026Admin!
-- ⚠️  CAMBIA LA CONTRASEÑA después de hacer login por primera vez
--
INSERT INTO usuarios (email, password_hash, nombre, rol) VALUES
  ('tobaralexis.89@gmail.com', '$2b$12$5ItbyJhWI6X2Lpt7HgoVbOtxWWozjKBkyE1SDGhjGHksRg.VzSRbG', 'Alexis Tobara', 'admin');
