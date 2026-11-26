-- migration-210-solicitud-alta.sql
-- MULTI-CLIENTE (2026-11-26): ALTA AUTÓNOMA con aprobación. El formulario público /registro deja una solicitud PENDIENTE (sin cuenta, sin gasto
-- de Mercado Público ni de IA); un admin de LICITANK la aprueba en /admin/solicitudes y recién ahí se crea la empresa, su admin y la evaluación por RUT.
-- Solo AGREGA una tabla. Datos personales mínimos (Ley 21.719): nombre y correo de contacto; se borran con la empresa (cliente_id) o al rechazar.
CREATE TABLE IF NOT EXISTS cliente_solicitud (
  id               INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  razon_social     VARCHAR(200) NOT NULL,
  rut              VARCHAR(20)  NOT NULL,
  contacto_nombre  VARCHAR(150) NOT NULL,
  contacto_email   VARCHAR(190) NOT NULL,
  contacto_telefono VARCHAR(40) NULL,
  mensaje          VARCHAR(500) NULL,
  estado           VARCHAR(12)  NOT NULL DEFAULT 'PENDIENTE',   -- PENDIENTE | APROBADA | RECHAZADA
  ip               VARCHAR(64)  NULL,
  cliente_id       INT          NULL,                           -- la empresa creada al aprobar
  resuelta_por     INT          NULL,
  resuelta_at      DATETIME     NULL,
  motivo           VARCHAR(300) NULL,                           -- por qué se rechazó
  created_at       DATETIME     NOT NULL,
  KEY idx_estado (estado, created_at),
  KEY idx_email (contacto_email),
  KEY idx_ip (ip, created_at)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
