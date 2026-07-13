-- migration-40-empresas.sql
-- EMPRESAS con las que se postula. Una licitación marcada como POSTULADA queda asociada
-- a la empresa con la que se presentó la oferta (postulamos con más de una empresa).
--
--   · Tabla `empresas`         → ficha completa de cada empresa (datos + representante + banco).
--   · Columna `negocios.empresa_id` → con qué empresa se postuló ese negocio (NULL = sin asignar).
--
-- Aplicar en Bluehost → phpMyAdmin (base ooosywmy_ica_licitaciones), pestaña SQL.

-- 1) Ficha de empresa ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS empresas (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  razon_social          VARCHAR(255) NOT NULL,
  rut                   VARCHAR(20)  NOT NULL,
  direccion             VARCHAR(255) DEFAULT NULL,
  region                VARCHAR(120) DEFAULT NULL,
  giro                  VARCHAR(255) DEFAULT NULL,
  tipo_persona_juridica VARCHAR(120) DEFAULT NULL,
  fecha_sociedad        VARCHAR(255) DEFAULT NULL,   -- texto libre (fecha + notaría)

  -- Representante legal
  representante_nombre  VARCHAR(160) DEFAULT NULL,
  representante_rut     VARCHAR(20)  DEFAULT NULL,
  representante_cargo   VARCHAR(120) DEFAULT NULL,

  -- Contactos
  email1                VARCHAR(160) DEFAULT NULL,
  telefono1             VARCHAR(40)  DEFAULT NULL,
  email2                VARCHAR(160) DEFAULT NULL,
  telefono2             VARCHAR(40)  DEFAULT NULL,

  -- Datos bancarios
  banco_tipo_cuenta     VARCHAR(60)  DEFAULT NULL,
  banco_numero          VARCHAR(40)  DEFAULT NULL,
  banco_nombre          VARCHAR(120) DEFAULT NULL,
  banco_email           VARCHAR(160) DEFAULT NULL,

  activo                TINYINT(1)   NOT NULL DEFAULT 1,
  created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_empresa_rut (rut)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) Enlace negocio → empresa -------------------------------------------------
-- (con qué empresa se postuló). Si tu versión de MySQL no soporta IF NOT EXISTS en
-- ADD COLUMN, quita esa cláusula; si ya existe la columna, ignora el error.
ALTER TABLE negocios
  ADD COLUMN IF NOT EXISTS empresa_id INT DEFAULT NULL;

ALTER TABLE negocios
  ADD INDEX idx_negocios_empresa (empresa_id);

-- 3) Semilla: las dos empresas actuales --------------------------------------
INSERT INTO empresas
  (razon_social, rut, direccion, region, giro, tipo_persona_juridica, fecha_sociedad,
   representante_nombre, representante_rut, representante_cargo,
   email1, telefono1, email2, telefono2,
   banco_tipo_cuenta, banco_numero, banco_nombre, banco_email)
VALUES
  ('Inversiones Claro ARZ SPA', '76.902.659-2',
   'Barros Arana N°492 Of.78, Concepción', 'Región del Bío Bío',
   'Venta de Maquinaria - Equipos y Herramientas',
   'Sociedad comercial privada con fines de lucro',
   '20 de Agosto de 2018 — sociedad por acciones, Segunda Notaría La Serena',
   'Santiago Osvaldo López Palavecino', '15.875.453-3', 'Ingeniero Constructor',
   'ventas@grupoica.cl', '+569 3146 2445', 'ventas1@grupoica.cl', '+569 7549 1833',
   'Cuenta corriente', '921197332', 'Banco Security', 'pagos@grupoica.cl'),

  ('Comercial MP SpA', '78.388.175-6',
   'Camino El Oliveto N° 575 N° 6, Talagante', 'Metropolitana',
   'Venta al por menor por correo, por internet y vía telefónica',
   'SpA', '27 de marzo del 2026',
   'Lidia Valenzuela', '6.736.698-0', 'Representante',
   'sociedadcomercialmp@gmail.com', '+569 7549 1833', NULL, NULL,
   'Cuenta Vista', '134426105', 'Banco de Chile', 'sociedadcomercialmp@gmail.com')
ON DUPLICATE KEY UPDATE razon_social = VALUES(razon_social);
