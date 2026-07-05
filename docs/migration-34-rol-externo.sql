-- migration-34-rol-externo.sql
-- Agrega el rol 'externo' (trabajador externo): ve MENOS que un 'usuario' normal.
--   · No ve el logo ni el dashboard; solo "Mis licitaciones" (las asignadas a él).
--   · Puede ver todo el contenido de SU licitación y correr la viabilidad, usar el chatbot,
--     cambiar estado (en proceso/descartar) y subir documentos.
--   · NO puede re-analizar (sigue siendo admin-only) ni dar feedback de viabilidad.
-- Cambio ADITIVO y retrocompatible: solo amplía el ENUM; los roles existentes no cambian.

ALTER TABLE usuarios
  MODIFY COLUMN rol ENUM('admin', 'usuario', 'externo') NOT NULL DEFAULT 'usuario';
