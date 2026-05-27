-- ============================================================
-- MIGRACIÓN 2: Favoritos user-scoped + Palabras clave + Alertas
-- Ejecutar DESPUÉS de migration-auth.sql
-- Fecha: 2026-05-27
-- ============================================================

-- 1. ASEGURAR tabla favoritos con usuario_id
--    Si aún tienes la tabla "favorites" (inglés) del código original,
--    renómbrala primero:
--      RENAME TABLE favorites TO favoritos;
--    Si ya corriste migration-auth.sql y tienes "favoritos" → OK, seguir.
-- ============================================================

-- Crear favoritos si no existe (por si no se corrió migration-auth.sql antes)
CREATE TABLE IF NOT EXISTS favoritos (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id       INT NULL,
  codigo           VARCHAR(100) NOT NULL,
  nombre           TEXT,
  organismo        VARCHAR(500),
  monto_total      BIGINT,
  monto_estimado   BIGINT,
  moneda           VARCHAR(10) DEFAULT 'CLP',
  fecha_cierre     DATETIME,
  fecha_adjudicacion DATETIME,
  estado           VARCHAR(100),
  tipo_licitacion  VARCHAR(100),
  tipo_convocatoria VARCHAR(100),
  region           VARCHAR(100),
  comuna           VARCHAR(100),
  descripcion      TEXT,
  resumen_ia       TEXT,
  detail_url       TEXT,
  search_url       TEXT,
  semantic_score   FLOAT,
  final_score      FLOAT,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_fav (usuario_id, codigo),
  INDEX idx_fav_usuario (usuario_id),
  INDEX idx_fav_codigo  (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Agregar usuario_id si no existe (idempotente)
ALTER TABLE favoritos
  ADD COLUMN IF NOT EXISTS usuario_id INT NULL AFTER id;

-- Agregar constraint FK si no existe
-- (Si falla por ya existir, ignorar)
ALTER TABLE favoritos
  ADD CONSTRAINT fk_fav_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;

-- 2. ASEGURAR usuario_id en documentos_cache
-- ============================================================
ALTER TABLE documentos_cache
  ADD COLUMN IF NOT EXISTS usuario_id INT NULL AFTER id;

ALTER TABLE documentos_cache
  ADD CONSTRAINT fk_docs_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL;

-- 3. TABLA PALABRAS CLAVE (para búsqueda automática)
-- ============================================================
CREATE TABLE IF NOT EXISTS palabras_clave (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id        INT NOT NULL,
  keyword           VARCHAR(255) NOT NULL,
  activo            BOOLEAN NOT NULL DEFAULT TRUE,
  ultima_busqueda   TIMESTAMP NULL,
  resultados_nuevos INT NOT NULL DEFAULT 0,
  total_encontradas INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pk_usuario (usuario_id),
  INDEX idx_pk_activo  (activo),
  CONSTRAINT fk_pk_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. TABLA ALERTAS (licitaciones encontradas por palabras clave)
-- ============================================================
CREATE TABLE IF NOT EXISTS alertas_licitaciones (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id           INT NOT NULL,
  palabra_clave_id     INT NOT NULL,
  keyword_texto        VARCHAR(255),
  licitacion_codigo    VARCHAR(100) NOT NULL,
  licitacion_nombre    TEXT,
  licitacion_organismo VARCHAR(500),
  licitacion_monto     BIGINT,
  licitacion_cierre    DATETIME,
  licitacion_estado    VARCHAR(100),
  licitacion_region    VARCHAR(100),
  leida                BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_alerta    (usuario_id, licitacion_codigo),
  INDEX idx_alertas_usuario   (usuario_id),
  INDEX idx_alertas_leida     (usuario_id, leida),
  INDEX idx_alertas_pk        (palabra_clave_id),
  CONSTRAINT fk_alerta_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_alerta_pk     FOREIGN KEY (palabra_clave_id) REFERENCES palabras_clave(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
