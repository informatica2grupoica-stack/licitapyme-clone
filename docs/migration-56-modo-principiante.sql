-- migration-56-modo-principiante.sql
-- Frente C.1 — vista resumida de viabilidad para usuarios nuevos (modo principiante).
--
-- Un perfil en modo_principiante ve por defecto SOLO la Tarjeta de Decisión (veredicto,
-- dónde se gana, qué hacer, qué lo deja fuera) al abrir el análisis de una licitación, con
-- un botón "Ver análisis completo" para revelar los 4 módulos de detalle a un clic — nunca
-- oculto detrás de otra pantalla. La tarjeta y el detalle nunca se contradicen (ya es un
-- principio del sistema); esto solo cambia qué se muestra primero.
--
-- Los perfiles YA EXISTENTES se marcan como NO principiantes (ya conocen el sistema) — el
-- default TRUE de la columna solo aplica a las cuentas que se creen DESPUÉS de esta migración.
-- El admin puede prender/apagar el modo por perfil desde /admin/usuarios; el propio usuario
-- también puede salir de él (graduarse) desde el botón "Ver análisis completo".
ALTER TABLE usuarios
  ADD COLUMN modo_principiante BOOLEAN NOT NULL DEFAULT TRUE AFTER permisos;

UPDATE usuarios SET modo_principiante = FALSE;
