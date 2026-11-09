-- migration-182: freno anti-duplicado de los correos de aviso (ganada, perdida, apertura, cerrada/revocada/desierta).
-- Una fila por «alerta:licitación:persona»; el INSERT IGNORE dice si el correo ya salió. Tabla nueva: no toca nada existente.
-- Sin esta tabla el sistema sigue funcionando (el correo puede repetirse). Aplicar con scripts/aplicar-migration-182.mjs.
CREATE TABLE IF NOT EXISTS avisos_correo_enviados (
  clave VARCHAR(190) NOT NULL,
  creado_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (clave)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
