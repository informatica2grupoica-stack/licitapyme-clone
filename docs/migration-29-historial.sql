-- migration-29-historial.sql
-- "Historial" (antes Alertas): registro de eventos / auditoría + feed de notificaciones.
--
-- Un solo registro por evento sirve para:
--   • HISTORIAL (admin ve todo): qué pasó, cuándo y quién lo hizo.
--   • NOTIFICACIONES del destinatario (campana): los eventos donde usuario_id = ese usuario,
--     con `leido` para marcar leído/no leído (lo usa el tiempo real por SSE).
--
-- Guardamos SNAPSHOTS (licitacion_nombre, usuario_nombre, actor_nombre) para mostrar el
-- historial sin JOINs y que sobreviva aunque cambien/borren registros relacionados.
--
-- COLLATION: licitacion_codigo va en utf8mb4_general_ci (igual que alertas_licitaciones)
-- para evitar el problema de JOINs lentos por desajuste de collation (ver migration-24).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS historial_eventos (
  id                INT AUTO_INCREMENT PRIMARY KEY,

  -- Tipo de evento (string libre, ej: ASIGNACION, REASIGNACION, DESCARTE, RESTAURACION,
  -- CAMBIO_ETAPA, VIABILIDAD, NOTA, SISTEMA).
  tipo              VARCHAR(40) NOT NULL,

  -- Licitación afectada (opcional: algunos eventos no son de una licitación).
  licitacion_codigo VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
  licitacion_nombre VARCHAR(500) NULL,

  -- Destinatario / a quién le concierne el evento (ej: el usuario asignado). Es el que lo
  -- ve en su campana de notificaciones.
  usuario_id        INT NULL,
  usuario_nombre    VARCHAR(255) NULL,

  -- Quién ejecutó la acción (ej: el admin que asignó).
  actor_id          INT NULL,
  actor_nombre      VARCHAR(255) NULL,

  -- Texto legible del evento (ej: "Se te asignó la licitación 1234-5-LP26").
  mensaje           VARCHAR(500) NOT NULL,

  -- Datos extra opcionales (ej: {"desde":"Juan","hacia":"Ana","etapa_old":"1ASIGNADO"}).
  metadata          JSON NULL,

  -- Para el centro de notificaciones del destinatario (leído/no leído).
  leido             BOOLEAN NOT NULL DEFAULT FALSE,

  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_hist_created (created_at),
  INDEX idx_hist_usuario (usuario_id, leido, created_at),
  INDEX idx_hist_codigo  (licitacion_codigo),
  INDEX idx_hist_tipo    (tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ── FKs opcionales (recomendadas si tu tabla usuarios usa InnoDB). Si te da error por
-- ── tipos/engine, puedes omitirlas: los snapshots de nombre ya evitan necesitar JOINs.
-- ALTER TABLE historial_eventos
--   ADD CONSTRAINT fk_hist_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL,
--   ADD CONSTRAINT fk_hist_actor   FOREIGN KEY (actor_id)   REFERENCES usuarios(id) ON DELETE SET NULL;
