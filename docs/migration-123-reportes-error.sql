-- migration-123-reportes-error.sql
-- Reportes de error enviados por cualquier perfil desde el botón flotante "Reportar error"
-- (app/components/ReportarErrorBoton.tsx): captura de la pantalla donde lo apretó, con sus marcas
-- encima, más una observación detallada. Llegan a todos los admin (campana) y se gestionan en
-- /admin/errores, donde el admin los resuelve dejando escrito CÓMO se solucionó.
--
-- Aplicar con `node scripts/aplicar-migration-123.mjs`. Idempotente: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS reportes_error (
  id                  INT            NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario_id          INT            NOT NULL,              -- quién lo reportó
  usuario_nombre      VARCHAR(200)       NULL,
  usuario_email       VARCHAR(200)       NULL,
  url                 VARCHAR(1000)  NOT NULL,              -- página donde apretó el botón
  titulo              VARCHAR(200)   NOT NULL,
  que_paso            TEXT           NOT NULL,              -- qué pasó (el error)
  que_esperaba        TEXT           NOT NULL,              -- qué debería haber pasado
  pasos               TEXT               NULL,              -- qué estaba haciendo antes
  gravedad            VARCHAR(20)    NOT NULL DEFAULT 'media', -- bloqueante | alta | media | baja
  imagen_url          VARCHAR(1000)      NULL,              -- captura con marcas (R2)
  contexto            JSON               NULL,              -- navegador, pantalla, errores de consola
  estado              VARCHAR(20)    NOT NULL DEFAULT 'abierto', -- abierto | en_revision | resuelto | descartado
  solucion            TEXT               NULL,              -- cómo se solucionó (obligatorio al resolver)
  resuelto_por        INT                NULL,
  resuelto_por_nombre VARCHAR(200)       NULL,
  resuelto_at         DATETIME           NULL,
  created_at          DATETIME       NOT NULL,
  updated_at          DATETIME       NOT NULL,
  INDEX idx_reportes_error_estado (estado, created_at),
  INDEX idx_reportes_error_usuario (usuario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
