-- migration-85-costeo-editor.sql
-- COSTEO EN EL SISTEMA — editor tipo planilla integrado al negocio, para no tener que bajar el
-- Excel, llenarlo aparte y volver a subirlo. El costeo se edita EN la pestaña "Costeo" (arriba del
-- Auditor Técnico); al guardar se ingresa como una versión más de checklist_comercial_costeo —
-- misma tabla, mismas 4 alertas del Motor Comercial (motor-comercial.ts), mismo auto-precarga del
-- checklist — solo que con origen='editor' en vez de 'archivo'. archivo_url pasa a admitir NULL
-- porque una versión de editor no tiene ningún archivo detrás (nunca se sube a ningún lado).
--
-- negocio_costeo_editor guarda el ESTADO VIVO editable (los grupos/filas tal como quedaron
-- tipeados) — una fila por negocio, se sobreescribe en cada guardado. Es la fuente que alimenta
-- cada nueva versión de checklist_comercial_costeo, no un reemplazo de esa tabla ni un historial
-- propio (el historial ya lo lleva checklist_comercial_costeo, igual que con el Excel subido).
--
-- Aplicar con `node scripts/aplicar-migration-85.mjs` (o a mano en phpMyAdmin).
-- Idempotente: CREATE TABLE IF NOT EXISTS + MODIFY COLUMN (repetible) + el script aplicador
-- comprueba antes si `origen` ya existe (esta versión de MySQL no soporta ADD COLUMN IF NOT
-- EXISTS, ver migration-80/81).

CREATE TABLE IF NOT EXISTS negocio_costeo_editor (
  id                     INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id             INT          NOT NULL,
  modalidad              VARCHAR(20)  NOT NULL DEFAULT 'suma_alzada',
  datos_json             LONGTEXT     NOT NULL,
  actualizado_por        INT              NULL,
  actualizado_por_nombre VARCHAR(160)     NULL,
  actualizado_at         DATETIME     NOT NULL,
  UNIQUE KEY uk_negocio_costeo_editor (negocio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE checklist_comercial_costeo MODIFY COLUMN archivo_url VARCHAR(600) NULL;

ALTER TABLE checklist_comercial_costeo
  ADD COLUMN origen ENUM('archivo','editor') NOT NULL DEFAULT 'archivo' AFTER archivo_nombre;
