-- migration-198: escaneos firmados del cierre de entrega (acta, guía de despacho, listado de capacitación) por negocio.
-- El código la crea solo si falta (compras-entrega-archivos.ts); este archivo es el registro para producción.
CREATE TABLE IF NOT EXISTS compras_entrega_archivo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id INT NOT NULL,
  tipo VARCHAR(20) NOT NULL,            -- 'acta' | 'guia' | 'capacitacion'
  archivo_url VARCHAR(600) NOT NULL,
  archivo_nombre VARCHAR(255) NOT NULL,
  subido_por INT NULL,
  subido_por_nombre VARCHAR(160) NULL,
  created_at DATETIME NOT NULL,
  KEY ix_negocio (negocio_id, tipo)
) DEFAULT CHARSET=utf8mb4;
