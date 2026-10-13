-- migration-144-compras-aceptar-oc-limite.sql
-- La tarea «Aceptación de la orden de compra» deja de usar un plazo fijo desde la adjudicación
-- (tope legal de 5 días corridos) y pasa al ancla LIMITE_OC: va desde que llega la OC hasta el último
-- día que dan las bases (2 días hábiles, etc., con feriados de Chile; ver app/lib/compras-plan.ts).
UPDATE compras_tarea_catalogo SET ancla = 'LIMITE_OC', plazo_dias = NULL WHERE clave = 'aceptar_oc';
UPDATE compras_tarea SET plazo_at = NULL WHERE catalogo_clave = 'aceptar_oc' AND estado <> 'HECHA';
