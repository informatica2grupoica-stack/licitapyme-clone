-- migration-121-compras-auditoria-cotizacion.sql
-- COSTEO Y AUDITORÍA — auditor real de cotizaciones (pedido del usuario, 21-sep-2026: "si subo una
-- cotización y el producto no es el que corresponde debe ser capaz de decirme que no, y por qué").
--
-- Hasta acá el `cumple` de cada cotización × producto lo elegía la persona (por defecto "Cumple") o
-- lo adivinaba una IA que solo leía el texto libre: nadie comparaba la cotización contra lo que el
-- producto DEBE cumplir, y ningún "pasa" traía el motivo. Esta tabla guarda el DICTAMEN formal:
-- qué se exigía, qué dice la cotización, con qué cita literal se sostiene cada punto.
--
--   dictamen: APTA | CON_OBSERVACIONES | NO_APTA | NO_ES_EL_PRODUCTO | NO_VERIFICABLE
--   revisiones_json: lista de revisiones (requisito, lo cotizado, resultado, por qué, citas)
--   override_*: si una persona decide distinto al auditor, queda su motivo obligatorio y su nombre.
--
-- `compras_cotizacion.texto_documento`: texto leído (OCR) del archivo de la cotización, para poder
-- auditar contra lo que el documento REALMENTE dice y no contra lo que alguien tipeó.
--
-- Aplicar con `node scripts/aplicar-migration-121.mjs` (idempotente).

CREATE TABLE IF NOT EXISTS compras_auditoria_cotizacion (
  id INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id INT NOT NULL,
  cotizacion_id INT NOT NULL,
  producto_id INT NOT NULL,
  dictamen VARCHAR(24) NOT NULL,
  resumen TEXT NULL,
  revisiones_json LONGTEXT NULL,
  modelo VARCHAR(40) NULL,
  generado_at DATETIME NOT NULL,
  generado_por INT NULL,
  generado_por_nombre VARCHAR(160) NULL,
  cumple_aplicado VARCHAR(24) NULL,
  override_cumple VARCHAR(24) NULL,
  override_motivo TEXT NULL,
  override_por INT NULL,
  override_por_nombre VARCHAR(160) NULL,
  override_at DATETIME NULL,
  UNIQUE KEY uk_auditoria_cot_prod (cotizacion_id, producto_id),
  INDEX idx_auditoria_cot_negocio (negocio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE compras_cotizacion ADD COLUMN texto_documento LONGTEXT NULL;
