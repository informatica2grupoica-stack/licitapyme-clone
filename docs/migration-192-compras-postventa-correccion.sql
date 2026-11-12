-- migration-192: correcciones del equipo a lo que la pestaña «Garantías y postventa» leyó de los documentos.
-- Una fila por dato corregido (clave = documento|título). Si no hay fila, se muestra lo leído del documento.
CREATE TABLE IF NOT EXISTS compras_postventa_correccion (
  negocio_id   INT          NOT NULL,
  clave        VARCHAR(300) NOT NULL,
  texto        TEXT         NOT NULL,
  actor_id     INT              NULL,
  actor_nombre VARCHAR(160)     NULL,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (negocio_id, clave)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
