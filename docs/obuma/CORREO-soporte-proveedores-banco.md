# Correo para el soporte de Obuma — datos bancarios del proveedor por API

**Asunto:** API v1.0 — `proveedores.create` / `proveedores.update` no guardan banco, N° y tipo de cuenta

Hola, equipo de Obuma:

Somos Inversiones Claro (empresa 1005). Integramos Obuma con nuestro sistema de compras (Licitank) y necesitamos crear y completar proveedores por API, incluidos sus datos bancarios.

Lo que vemos al LEER: `proveedores.list.json` y `proveedores.findById.json` devuelven `proveedor_banco_cuenta` (ID del banco, que resolvemos con `pg-bancos.list.json`), `proveedor_nro_cuenta`, `proveedor_tipo_cuenta`, `proveedor_forma_pago` y `proveedor_centro_costo`. Funciona bien.

Lo que vemos al ESCRIBIR: `proveedores.create.json` y `proveedores.update.json` responden OK (HTTP 200) pero esos mismos campos quedan vacíos al releer el proveedor. Tampoco guardan `proveedor_tipo_despacho` ni `proveedor_es_cuenta_corriente`. Los campos documentados (contacto, teléfono, correo, dirección, giro, etc.) sí se guardan.

Consultas:
1. ¿Se puede habilitar en `proveedores.create` y `proveedores.update` el guardado de `proveedor_banco_cuenta`, `proveedor_nro_cuenta`, `proveedor_tipo_cuenta`, `proveedor_forma_pago` y `proveedor_centro_costo`? Si ya existen con otro nombre de campo, ¿cuál es?
2. ¿Hay un endpoint para crear o renombrar centros de costo (`contabilidadCentrosDeCostos`) y proyectos (`ext-proyectos`)? Hoy solo vemos `list`.
3. Nuestro límite es 1.500 llamadas por día por método. Con la sincronización diaria de proveedores y órdenes de compra nos acercamos al tope en `compras.list`, `comprasOc.listItems` y `comprasDte.list`. ¿Pueden subirlo para nuestra empresa?

Quedamos atentos. Muchas gracias.
