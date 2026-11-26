# Correo para soporte de Obuma — OC internacionales con proveedores que comparten el RUT 55.555.555-5

**Asunto:** API comprasOc.create: poder indicar el proveedor por id (proveedores extranjeros con RUT 55.555.555-5)

Hola,

Usamos la API para crear órdenes de compra (`comprasOc.create.json` y `comprasOc.update.json`). Con los proveedores extranjeros tenemos un problema:

- Por regla del SII todos los proveedores internacionales llevan el RUT genérico 55.555.555-5, así que en nuestra cuenta hay varios proveedores con ese mismo RUT (por ejemplo OMAR MARTIN id 84857, DENAIYOU id 190521 y XIAMEN WEIYOU INTELLIGENT TECHNOLOGY CO., LTD id 204875).
- La API solo identifica al proveedor por `proveedor_rut`. Con ese RUT siempre asigna la OC al primero de la lista (OMAR MARTIN), aunque mandemos otra `proveedor_razon_social`.
- Probamos con la OC folio 4109 (id 284015): `rel_proveedor_id` y `proveedor_id` responden «Error en id proveedor» (código 111), y sin `proveedor_rut` la actualización no cambia el proveedor.
- Hoy tenemos que entrar a Obuma y usar Editar → Cambiar proveedor en cada OC internacional.

**Lo que necesitamos:** que `comprasOc.create` y `comprasOc.update` acepten el id del proveedor (por ejemplo `rel_proveedor_id` o `proveedor_id`) y lo usen en lugar de buscar por RUT cuando viene informado. Con eso podríamos asignar siempre el proveedor correcto.

Si ya existe una forma de hacerlo que no hayamos encontrado, les agradecemos que nos la indiquen.

Gracias,
