-- migration-41-licitacion-apertura.sql
-- Estado de APERTURA por licitación, detectado leyendo el portal de MP (ficha
-- DetailsAcquisition), igual que la descarga de documentos. Ver app/lib/mp-apertura.ts
-- y app/lib/detectar-aperturas.ts.
--
-- Se persiste para que:
--   · el poller (cron de IP chilena) sepa cuáles ya verificó y no re-consulte el portal,
--   · el apartado Postuladas muestre el chip "Aperturada / Sin apertura" sin pegarle al
--     portal por cada tarjeta (que sería lento y lo bloquearía el WAF),
--   · la alerta de apertura se dispare UNA sola vez (transición no-aperturada → aperturada).

CREATE TABLE IF NOT EXISTS licitacion_apertura (
  licitacion_codigo VARCHAR(50)  NOT NULL PRIMARY KEY,
  aperturada        TINYINT(1)    NOT NULL DEFAULT 0,
  evidencia         VARCHAR(60)   NULL,          -- qué marcador la delató (depuración)
  detectada_en      DATETIME      NULL,          -- cuándo NUESTRO poller la vio aperturada 1ª vez
  verificado_en     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_aperturada (aperturada)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
