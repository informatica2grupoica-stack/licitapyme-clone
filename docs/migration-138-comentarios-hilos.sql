-- migration-138: hilos en los comentarios (06-oct-2026)
--
-- POR QUÉ: un perfil comenta y un admin (o cualquiera del equipo) puede RESPONDER ese mismo
-- comentario. La respuesta vive en la MISMA tabla que el comentario al que responde y apunta
-- a él con `padre_id` (NULL = comentario de primer nivel). Los hilos son de un solo nivel:
-- responder a una respuesta cuelga del comentario original.
--
-- `comentarios_licitacion` (comentarios sueltos de la ficha pública) y `comentarios_negocio`
-- (comentarios del negocio) son tablas distintas: cada una lleva su propio `padre_id`.
-- Idempotente (el script salta lo que ya existe). Sin esta migración, la pantalla sigue
-- funcionando como antes y el botón "Responder" avisa que falta aplicarla.

ALTER TABLE comentarios_licitacion ADD COLUMN padre_id INT NULL;
ALTER TABLE comentarios_negocio ADD COLUMN padre_id INT NULL;
CREATE INDEX idx_comentarios_licitacion_padre ON comentarios_licitacion (padre_id);
CREATE INDEX idx_comentarios_negocio_padre ON comentarios_negocio (padre_id);
