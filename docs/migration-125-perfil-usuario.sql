-- migration-125-perfil-usuario.sql
-- Perfil profesional: datos de contacto y cargo del usuario.
--   telefono  "+56912345678" (normalizado)     rut   "12345678-5" (sin puntos, con guion)
--   cargo/area  texto libre                     foto  data URL JPEG ya reducida (≤ ~40 KB), no viaja en /api/auth/me
-- Todas NULL: los usuarios existentes quedan sin datos y ven el aviso "completa tu perfil".
ALTER TABLE usuarios
  ADD COLUMN telefono VARCHAR(20)  NULL AFTER empresa,
  ADD COLUMN rut      VARCHAR(12)  NULL AFTER telefono,
  ADD COLUMN cargo    VARCHAR(100) NULL AFTER rut,
  ADD COLUMN area     VARCHAR(100) NULL AFTER cargo,
  ADD COLUMN foto     MEDIUMTEXT   NULL AFTER area;
