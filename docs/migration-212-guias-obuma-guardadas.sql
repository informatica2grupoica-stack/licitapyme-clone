-- migration-212: guías de despacho de Obuma guardadas por negocio, para no consultar Obuma cada vez que se abre «Entrega y cierre».
-- La app crea las tablas sola (asegurarTablasGuias en compras-guia-despacho-obuma.ts). Cuelgan de negocios: el cliente se hereda por negocio_id
-- (la baja de una empresa ya las borra, borrar-cliente.ts descubre las tablas con negocio_id). Idempotente.
CREATE TABLE IF NOT EXISTS compras_guia_obuma_lista (
  negocio_id    INT      NOT NULL PRIMARY KEY,
  datos_json    LONGTEXT NOT NULL,
  consultado_at DATETIME NOT NULL
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS compras_guia_obuma_xml (
  negocio_id INT         NOT NULL,
  folio      VARCHAR(40) NOT NULL,
  xml        MEDIUMTEXT  NOT NULL,
  PRIMARY KEY (negocio_id, folio)
) DEFAULT CHARSET=utf8mb4;
