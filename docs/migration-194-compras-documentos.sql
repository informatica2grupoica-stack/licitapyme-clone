-- migration-194: GESTIONAR DOCUMENTOS (13-nov-2026). Las tablas también las crea sola app/lib/compras-documentos.ts; este archivo es el registro.
CREATE TABLE IF NOT EXISTS compras_doc_plantilla (
  id INT AUTO_INCREMENT PRIMARY KEY, empresa_rut VARCHAR(20) NOT NULL, clave VARCHAR(60) NOT NULL, nombre VARCHAR(200) NOT NULL,
  descripcion VARCHAR(400) NULL, por_persona TINYINT(1) NOT NULL DEFAULT 0, campos_json TEXT NOT NULL, cuerpo_html MEDIUMTEXT NOT NULL,
  activa TINYINT(1) NOT NULL DEFAULT 1, created_at DATETIME NOT NULL, UNIQUE KEY uq_empresa_clave (empresa_rut, clave)
) DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS compras_doc_generado (
  id INT AUTO_INCREMENT PRIMARY KEY, negocio_id INT NOT NULL, plantilla_id INT NOT NULL, titulo VARCHAR(300) NOT NULL,
  datos_json MEDIUMTEXT NOT NULL, creado_por INT NULL, creado_por_nombre VARCHAR(160) NULL, created_at DATETIME NOT NULL, KEY ix_negocio (negocio_id)
) DEFAULT CHARSET=utf8mb4;
