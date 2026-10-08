-- migration-141: quién lleva la mercadería y cuánto cuesta el flete, por cotización (08-oct-2026)
--
-- POR QUÉ: «incluye_flete» + «flete_monto» no distinguen casos reales: el proveedor despacha y cobra el flete
-- aparte (ABC SA, 759-21-LE26), el proveedor despacha con flete incluido, lo retiramos nosotros, lo trae un
-- transportista que contratamos, o se compró en tienda. Se separan dos preguntas:
--   despacho_modalidad: PROVEEDOR | RETIRO_PROPIO | TRANSPORTISTA | TIENDA
--   flete_condicion:    INCLUIDO | SIN_COSTO | APARTE | POR_CONFIRMAR
-- El flete sigue siendo UNO por cotización. `incluye_flete` y `flete_monto` NO se quitan: el motor de
-- escenarios sigue leyéndolos (la app los deriva de estas dos columnas al guardar). NULL = cotización antigua,
-- se comporta como siempre. Idempotente (el script de aplicación ignora «la columna ya existe»).

ALTER TABLE compras_cotizacion ADD COLUMN despacho_modalidad VARCHAR(20) NULL;
ALTER TABLE compras_cotizacion ADD COLUMN flete_condicion VARCHAR(20) NULL;
