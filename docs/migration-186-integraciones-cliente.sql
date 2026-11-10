-- migration-186: CUENTAS EXTERNAS POR CLIENTE (multiempresa, Etapa 2 — ver docs/memoria/multiempresa.md).
-- Cada empresa-cliente guarda sus propias credenciales: ticket de la API de Mercado Público y cuenta de correo de envío (SMTP:
-- sirve para Brevo, Resend, SES, Google Workspace, Microsoft 365, cPanel…). Los secretos van CIFRADOS (AES-256-GCM con la
-- clave INTEGRACIONES_CLAVE del .env, ver app/lib/integraciones-cliente.ts); `pista` es lo único visible (sin secretos).
-- Tabla NUEVA: no toca nada existente. Aplicar con scripts/aplicar-migration-186.mjs (local por defecto, --produccion con OK).
CREATE TABLE IF NOT EXISTS cliente_integracion (
  cliente_id      INT          NOT NULL,
  tipo            VARCHAR(20)  NOT NULL,           -- 'mp_ticket' | 'correo'
  datos_cifrados  TEXT         NOT NULL,
  pista           VARCHAR(160) NULL,               -- p. ej. «••••3F2A» o «smtp-relay.brevo.com · ventas@empresa.cl»
  verificado_at   DATETIME     NULL,               -- última vez que se probó con éxito
  actualizado_por INT          NULL,
  actualizado_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (cliente_id, tipo)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
