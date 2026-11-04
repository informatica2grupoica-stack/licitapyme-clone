-- migration-178: avisos por WhatsApp (ganada / perdida / apertura) enviados desde el número emisor de la empresa.
--  · whatsapp_aviso_pref: qué avisos quiere recibir cada perfil (selector en Editar permisos). Sin fila = valor por defecto del código.
--  · whatsapp_cola: cola de envío (uno por persona y aviso). `clave` única: el mismo aviso no se manda dos veces aunque el cron repita el evento.
-- Tablas nuevas: no cambian nada existente. Aplicar con scripts/aplicar-migration-178.mjs (local por defecto).
CREATE TABLE IF NOT EXISTS whatsapp_aviso_pref (
  usuario_id INT NOT NULL,
  tipo VARCHAR(30) NOT NULL,
  activo TINYINT(1) NOT NULL,
  PRIMARY KEY (usuario_id, tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS whatsapp_cola (
  id BIGINT NOT NULL AUTO_INCREMENT,
  cliente_id INT NOT NULL,
  usuario_id INT NOT NULL,
  telefono VARCHAR(20) NOT NULL,
  tipo VARCHAR(30) NOT NULL,
  licitacion_codigo VARCHAR(80) NOT NULL,
  clave VARCHAR(160) NOT NULL,
  texto TEXT NOT NULL,
  estado VARCHAR(12) NOT NULL DEFAULT 'pendiente',
  intentos INT NOT NULL DEFAULT 0,
  error VARCHAR(255) NULL,
  creado_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  enviado_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_whatsapp_clave (clave),
  KEY idx_whatsapp_estado (estado, id),
  KEY idx_whatsapp_cliente (cliente_id, enviado_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
