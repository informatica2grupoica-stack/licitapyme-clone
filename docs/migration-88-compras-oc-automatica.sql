-- migration-88-compras-oc-automatica.sql
-- MÓDULO DE COMPRAS §3.6 — la orden de compra del cliente deja de escribirse a mano.
--
-- La migración 87 dejó los campos para registrarla, pero alguien tenía que ir a Mercado Público,
-- copiar el número, la fecha y el monto, y tipearlos acá. Mientras tanto el sistema YA sabía de esa
-- orden: `ordenes_compra` (migración 64) la venía trayendo sola desde la API de MP para todas las
-- licitaciones que ofertamos. Los dos módulos se ignoraban.
--
-- Ahora, cuando aparece la OC de una licitación GANADA, se carga sola en su ficha de Compras y se
-- avisa. Estas columnas son lo que hace falta para distinguir de dónde salió cada dato:
--
--   · oc_origen        'mp' = la trajo el sistema desde Mercado Público · 'manual' = la tipeó una
--                      persona. Sirve para saber a quién creerle si alguna vez discrepan, y para
--                      no pisar en silencio lo que alguien anotó a mano.
--   · oc_codigo_mp     el código de la orden EN MERCADO PÚBLICO (ej. "1114-45-SE26"), que es la
--                      llave contra `ordenes_compra`. Se guarda aparte de `oc_numero` porque ese
--                      campo es texto libre: alguien pudo haber escrito ahí el número interno del
--                      organismo, o una nota.
--   · oc_estado_mp     el estado que reporta MP (Enviada a proveedor · Aceptada · Cancelada…). Una
--                      OC cancelada no es lo mismo que una sin aceptar, y §14 va a necesitarlo.
--   · oc_total_neto    el neto de la orden. Es el que se compara contra lo adjudicado para decidir
--                      si "difiere de lo ofertado" (§3.6): `oc_monto` guarda el total CON IVA, que
--                      es lo que muestra el portal, y comparar ese contra el neto adjudicado daba
--                      una diferencia falsa del 19% en todas las órdenes.
--   · oc_vinculada_at  cuándo se enganchó. Distinto de oc_actualizada_at, que se mueve también
--                      cuando una persona edita la ficha a mano.
--
-- Aplicar con `node scripts/aplicar-migration-88.mjs` (tolera "columna ya existe", así que correrla
-- dos veces es seguro por esa vía).

ALTER TABLE compras_asignacion
  ADD COLUMN oc_origen       VARCHAR(8)    NULL,
  ADD COLUMN oc_codigo_mp    VARCHAR(64)   NULL,
  ADD COLUMN oc_estado_mp    VARCHAR(64)   NULL,
  ADD COLUMN oc_total_neto   DECIMAL(15,2) NULL,
  ADD COLUMN oc_vinculada_at DATETIME      NULL;

-- Las fichas que ya tenían OC anotada a mano quedan marcadas como tales, para que el enganche
-- automático sepa que ahí hay una decisión humana que respetar.
UPDATE compras_asignacion
   SET oc_origen = 'manual'
 WHERE oc_origen IS NULL
   AND (oc_numero IS NOT NULL OR oc_aceptada_at IS NOT NULL OR oc_monto IS NOT NULL);

CREATE INDEX idx_compras_asig_oc_mp ON compras_asignacion (oc_codigo_mp);
