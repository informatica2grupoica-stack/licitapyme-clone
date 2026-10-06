-- migration-139: gasto de IA por perfil / módulo (06-oct-2026)
--
-- POR QUÉ: hasta hoy el costo de cada llamada al modelo solo salía por la consola del servidor
-- (logTelemetriaIA en gemini.ts) y se perdía. El pedido: saber QUIÉN gasta más IA, en qué módulo
-- (viabilidad, consultas/chat, auditor, anexos, compras…) y con qué modelo. Una fila por llamada
-- exitosa al modelo de texto; usuario_id NULL = proceso automático (cron, scheduler, al asignar).
-- Idempotente (CREATE TABLE IF NOT EXISTS). Sin esta tabla la app sigue igual: el registro falla
-- en silencio y /admin/gasto-ia avisa que falta aplicarla.

CREATE TABLE IF NOT EXISTS ia_uso (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_id INT NULL,
  usuario_nombre VARCHAR(160) NULL,
  modulo VARCHAR(40) NOT NULL DEFAULT 'otros',
  licitacion_codigo VARCHAR(40) NULL,
  proveedor VARCHAR(30) NULL,
  modelo VARCHAR(80) NOT NULL,
  respaldo TINYINT(1) NOT NULL DEFAULT 0,
  tokens_in INT NOT NULL DEFAULT 0,
  tokens_out INT NOT NULL DEFAULT 0,
  costo_usd DECIMAL(12,6) NOT NULL DEFAULT 0,
  duracion_ms INT NOT NULL DEFAULT 0,
  INDEX idx_ia_uso_fecha (created_at),
  INDEX idx_ia_uso_usuario (usuario_id, created_at),
  INDEX idx_ia_uso_modulo (modulo, created_at),
  INDEX idx_ia_uso_licitacion (licitacion_codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
