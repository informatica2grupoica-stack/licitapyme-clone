-- migration-28-permisos-usuarios.sql
-- Permisos granulares por usuario. El admin es "super" (todos los permisos implícitos);
-- el usuario normal solo tiene los que el admin le otorgue, guardados en esta columna JSON.
--
-- Catálogo de permisos (claves del JSON, todas opcionales, default = false):
--   ver_otros_negocios  → ver licitaciones asignadas a OTROS perfiles (no solo las suyas)
--   acceso_radar        → entrar al radar (por defecto solo admin)
--   comentar_viabilidad → comentar / corregir la viabilidad (enseñar a la IA)
--   exportar            → exportar a Excel
--   alertas_anexos      → recibir campana + correo cuando un perfil mueve una licitación a la etapa ANEXOS (ej. Fernando)
--
-- Ejemplo de valor: {"ver_otros_negocios": true, "exportar": true}
--
-- SEGURO: columna nullable con default NULL; el código tolera su ausencia (trata como {}).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE usuarios
  ADD COLUMN permisos JSON NULL AFTER rol;
