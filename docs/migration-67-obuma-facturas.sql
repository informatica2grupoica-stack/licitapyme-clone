-- migration-67-obuma-facturas.sql
-- Factura(s) DTE asociada(s) a cada compra de Obuma ya cruzada (obuma_compras, migration-66).
--
-- CORRIGE una conclusión anterior (ver memoria project_obuma_integracion_pendiente): se había
-- probado que `dte.rel_compra_id` viene en "0" y se descartó poder atar la factura a la compra.
-- Esa prueba estaba mal enfocada — se miró una muestra ALEATORIA de comprasDte.list.json, sin
-- filtrar por una compra específica. El campo que SÍ sirve vive en la propia `comprasOc`:
-- `compra_oc_facturada_tipo_dcto` trae "tipo#folio" (ej. ",33#308707,33#308708" si son varias
-- facturas) solo cuando `compra_oc_estado_facturacion` != 0 — con eso, `comprasDte.list.json?
-- tipo_dcto=X&folio_dcto=Y` encuentra la factura real, con su XML real en `s3_link` (un link S3
-- público de Obuma, verificado: HTTP 200, XML del SII válido, sin token ni sesión). Probado 8/8
-- en compras reales FACTURADAS, incluido el caso de dos facturas para una misma OC.
--
-- Idempotente (columna se agrega solo si no existe — MySQL de Bluehost no soporta
-- "ADD COLUMN IF NOT EXISTS", ver migration-64).

ALTER TABLE obuma_compras ADD COLUMN facturas_json LONGTEXT DEFAULT NULL;
-- Array de { tipoDcto, folioDte, dteId, total, proveedorRazonSocial, proveedorRut, s3Link } — la o
-- las facturas reales que Obuma asoció a esta orden de compra. NULL si la compra no está facturada
-- todavía (estado EMITIDA) o si Obuma no logró conciliarla.
