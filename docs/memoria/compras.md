# Compras

Pantalla principal: `/compras/[negocioId]` (`ComprasChrome.tsx`). Traspasado desde la memoria
personal el 2026-10-27; las fechas son de cuando se decidió.

## 2026-11-05 — «Gastos con SKU y orden de compra» en Compra y logística → Gastos extra: flete o ADICIONAL (grúa) aprobado solo él (`ServiciosConSkuCard.tsx`; migration-181 APLICADA en producción/VPS el 2026-11-05, falta en la BD local Docker; tsc ok, 192 pruebas de compras ok; VISTO en navegador en 1191 sin guardar nada)
- Pedido del dueño: un gasto imprevisto que necesita SKU, OC y factura (grúa, armado, instalación, un flete que salió después) se agrega en «Gastos extra» eligiendo **Flete** o **Adicional**, con proveedor + RUT (busca en el sistema y en Obuma), precio neto y cotización opcional (se lee y propone precio). NO toca el costeo ni la aprobación de la compra completa. Lo que no lleva SKU ni OC (colación, bencina) sigue en «Anotar un gasto».
- Por dentro: servicio (`es_servicio`, migration-177) + `compras_producto.servicio_tipo` 'FLETE'/'ADICIONAL' (migration-181, `scripts/aplicar-migration-181.mjs`; NULL = flete viejo) + cotización `origen: 'directa'`, que crea la **compra rápida** (aprobación del jefe de ventas de ESE ítem; `registrarCotizacion` y la compra rápida no llaman a `invalidarAprobacionesCompras`). Motivo: el flete de «Compara y elige» obligaba a elegir de nuevo la combinación y eso anula TODAS las aprobaciones. Aprobado → Comprado → entra solo a la OC de su proveedor (`proveedoresParaOrdenCompra` ya suma compras rápidas aprobadas) y se le crea SKU.
- Costo real: `costoServiciosPorNegocio` ahora cuenta también el precio de la compra rápida APROBADA de un servicio que no está en el escenario elegido (antes daba $0).
- Los adicionales no salen en «Fletes» (FletesCompra filtra `servicioTipo !== 'ADICIONAL'`). Sin la migración 181, «Flete» funciona y «Adicional» avisa que falta aplicarla.
- Pendiente: aplicar migration-181 en la BD local Docker :3308 (estaba apagada; en producción ya está); probar un alta real de punta a punta (aprobación, SKU, OC Obuma); en «Tu compra»/«Combinaciones» un adicional aún se rotula «🚚 FLETE» (el ítem de la combinación no trae el tipo); un adicional con compra rápida no se puede «Quitar» (lo bloquea `eliminarParteProducto`): se rechaza.

## 2026-11-05 — Menú «OC Comercial MP»: todas las OC propias en una pantalla (`/compras/oc-comercial-mp`, ruta `api/compras/oc-comercial-mp`, `listarTodasOcPropias` + `negocioDeOcPropia` en `compras-oc-propia.ts`, ítem en `AppLayout.tsx`; tsc + eslint ok, consulta y PDF probados contra la BD del VPS, VISTA en navegador en claro y oscuro con la OC real)
- Pedido del dueño: ver las OC de Comercial MP de todas las licitaciones con su información y factura, sin entrar negocio por negocio. Ítem nuevo en el menú lateral, grupo EJECUCIÓN, bajo «Órdenes de compra» (que son las de Mercado Público, otra cosa). Mismo permiso que «Proyectos (Obuma)» (compras_todo / compras / aprobar_comercial / compras_ver / compras_auditor) y entra en el perfil «solo compras».
- **Solo lectura**: emitir, subir la factura y anular se siguen haciendo en el negocio (Compras → Órdenes y facturas → paso 1). Muestra: 4 indicadores (emitidas, total con IVA, esperando factura, facturado), pestañas por estado, búsqueda (folio, licitación, proveedor, producto, factura, n° de negocio) y rango de fechas, y la suma de lo filtrado (sin anuladas). Cada fila: folio, fecha, código + nombre de la licitación, proveedor, estado, total; al abrirla: ítems con código, cantidad, precio y subtotal + neto/IVA/total, proveedor, entrega, pago, despacho, emitida por, n° de negocio, factura (folio, fecha, neto/total, **diferencia con la OC**, cómo se emparejó, quién la subió), PDF de la OC, la factura y link al negocio.
- «Número de proyecto» = código de la licitación + n° de negocio (Comercial MP no está en Obuma: no hay proyecto Obuma). Filtra por `negocios.cliente_id` (otra empresa-cliente no ve ni abre el PDF; probado). El PDF se sirve desde la ruta nueva para que no exija estar asignado al negocio.
- Contra la BD (05-nov): 1 OC, MP-2026-0001 de 2446-240-LE26, ANULADA; PDF 41 KB. Chequeo: `scripts/scratch/_oc_mp_menu_check.mts`.
- (mismo día) A pedido del dueño se BORRÓ esa OC de prueba (id 1, negocio 979, anulada, sin factura; respaldo en `scripts/scratch/_respaldo_oc_mp_2026_0001.json`). Quedan 0 OC propias, así que la próxima vuelve a salir MP-2026-0001. También se borraron sus 2 eventos de `historial_eventos` (23562 emitida, 23568 anulada; sin destinatario, no estaban en la campana; respaldo `_respaldo_eventos_oc_mp_2026_0001.json`).
- Animación al abrir una OC (reclamo del dueño: «fea»): la tarjeta tenía `layout` de framer-motion y al cambiar de alto se estiraba el contenido. Ahora sin `layout`; el detalle se despliega con alto 0→auto + opacidad en 0,22 s con `EASE_LK` (mismo patrón que viabilidad v4) y la flecha gira con `ease-lk`. Medido: 125→460 px en ~250 ms, sin deformación; cierre igual de suave.
- Menú lateral: con `/compras/oc-comercial-mp` (y `/compras/proyectos`) se marcaban DOS ítems porque `/compras` calza por prefijo. `isActive` en `AppLayout.tsx` ahora marca solo el ítem más específico que calza (arreglo general, afecta a todo el menú).

## 2026-11-05 — Recordatorio «aceptar la OC»: dos veces al día, a las 09:00 y a las 17:00 Chile (`avisarAceptacionOcPorVencer` en `compras.ts`; tsc ok, sin correr contra la BD)
- Pedido del dueño: los avisos de aceptación de la OC (campana + correo) llegan dos veces al día, **a las 09:00 y a las 17:00** hora Chile (aclaró: horas fijas, no un rango).
- El cron `compras-asignacion` corre cada 20 min; solo actúa en la hora 09 y en la hora 17. Cada OC recibe a lo más un aviso por turno (dedupe por `metadata.turno` = «AAAA-MM-DD am|pm»); si falla la corrida de las :00, la de las :20 lo recupera.
- La ventana no cambió: desde que faltan <24 h hasta 24 h después de vencida. Antes eran 3 avisos sueltos (<24 h, <3 h, vencida) a cualquier hora; el texto sigue diciendo cuál de esos casos es. Consecuencia: un plazo que vence a las 14:00 recibe su último aviso a las 09:00 (ya no hay «<3 h» suelto).
- Pendiente: desplegar al VPS.

## 2026-11-05 — Cantidad a comprar distinta de la del costeo, con observación (migration-179; `cambiarCantidadCompra` en `compras.ts`, acción `cambiar_cantidad` en la ruta `productos`, `ComparadorPrecios.tsx`, `TablaAprobacionCompra.tsx`, `ArmarCompra.tsx`; tsc + 245 tests ok; migración APLICADA en la BD del VPS el mismo día (477 productos, ninguno cambiado); SIN probar el cambio de cantidad contra la BD ni ver en navegador)
- Pedido del dueño: el costeo dice 30 y se compran 20, pero el costeo inicial no se toca. Se cambia en **Compara precios** (producto abierto → «Cambiar cantidad»), con **observación obligatoria**.
- Diseño: `compras_producto.cantidad` pasa a ser la cantidad **a comprar** (así el escenario, el cuadro, la aprobación y la OC la toman sin más cambios) y la del costeo queda en `cantidad_costeo`, junto con el motivo, quién y cuándo. Mientras haya motivo, **«Sincronizar con costeo» no pisa la cantidad**: solo actualiza `cantidad_costeo`. Si se vuelve a poner la cantidad del costeo, se borra el cambio.
- Al cambiar la cantidad: se corrige el escenario elegido (subtotal de ese producto y `costo_total`; el flete queda igual), se **anulan las aprobaciones** ya dadas y queda el evento `COMPRAS_CANTIDAD_CAMBIADA` en el historial (cantidad anterior → nueva, la del costeo y la observación).
- Dónde se ve: franja ámbar bajo el producto en Compara precios (aunque esté plegado), cantidad tachada → nueva en la fila; en la aprobación, la cantidad tachada y la observación bajo el producto; en «Elige tu compra», un cuadro «Cantidades distintas a las del costeo» y una etiqueta en «Tu compra».
- Decisión tomada sin preguntar: la **venta también se calcula con la cantidad a comprar** (margen 20 contra 20; así no sale inflado). Si se compran menos porque hay stock y se venden igual 30, el margen en pesos sale más bajo que el real (en % da lo mismo). Pendiente de confirmar con el dueño.
- **Pendiente:** desplegar el código al VPS y probar en un negocio **sin** compra aprobada (anula aprobaciones). El espejo local (:3308) no tiene la migración: `node scripts/aplicar-migration-179.mjs`.

## 2026-11-05 — «Deshacer SKU» ya no lo bloquea una OC ANULADA en Obuma (979; `eliminarSkuLocal` en `compras-aprobaciones.ts`; tsc ok, consulta probada contra la BD, sin pulsar Deshacer)
- Caso: la OC 4038 a General Trade (Limpiador 343 y Filtros 347) se anuló en Obuma, pero «Deshacer SKU» seguía diciendo «ya está en una orden de compra emitida»: miraba `compras_orden_compra_obuma` sin cruzar el estado. Ahora cruza con `obuma_compras.estado` y no cuenta las ANULADAS (mismo criterio que `compras-oc-obuma.ts`). Contra la BD: 343 y 347 quedan libres; 340 y 341 siguen bloqueados por la 4037 de AHN (SOLICITADA). El aviso ahora dice el folio y que, si se acaba de anular, hay que esperar la sincronización de Obuma.
- Ojo (dato, sin tocar): Limpiador y Filtros comparten el SKU 6026434235 / id Obuma 1124173 («LIMPIADOR DE FILTROS», costo $4.710.000); en Filtros sale el aviso «No coincide con esta licitación». Al deshacer, el producto en Obuma NO se borra.

## 2026-11-05 — «Ver detalle del precio» se abre en un modal (`AuditorComprasCard.tsx`; tsc ok, sin ver en navegador)
- Pedido del dueño: en «Compara y elige», el detalle (desglose, adicionales, auditoría y ficha técnica de la oferta) se dibujaba al final de toda la lista y no se entendía dónde había aparecido. Ahora abre un `Modal` (lg) con el proveedor en el título y producto + cotización debajo; Esc o la X lo cierran. Mismo contenido (`AuditoriaCotizacionPanel` + `TecnicoDeCelda`); también vale para la vista de matriz.

## 2026-11-05 — OC propia de Comercial MP a Inversiones Claro + factura subida a mano (migration-180; `compras-oc-propia.ts`, `compras-oc-propia-factura.ts`, ruta `oc-propia`, `OcPropiaCard.tsx`; tsc + 6 tests ok, SIN migración aplicada, SIN ver en navegador ni crear una OC real)
- Pedido del dueño: Obuma es solo de Inversiones Claro. Un negocio de **Comercial MP** (ej. 979 = 2446-240-LE26, `negocios.empresa_id` 2) cuya mercadería tiene Inversiones Claro (vacuolavadoras) necesita que Comercial MP le emita una OC a Inversiones Claro. Como Comercial MP no está en Obuma, la OC sale de Licitank y la factura se sube a mano.
- Dónde: Compras → «Órdenes y facturas» → paso 1, debajo de las OC de Obuma: tarjeta «Órdenes de compra de Comercial MP SpA». Solo aparece si la empresa del negocio está en `EMISORES_PROPIOS` (por RUT 78.388.175-6, prefijo MP, logo `public/oc-mp/logo.png`, proveedor por defecto RUT 76.902.659-2 tomado de la tabla `empresas`). Los demás negocios no ven nada.
- «Nueva OC» (modal): proveedor (Inversiones Claro, se puede cambiar), productos vigentes con casilla, cantidad y **precio neto propuesto = costo del escenario elegido** (`costosEscenarioPorProducto`, ahora exportada); los que ya están en otra OC propia salen desmarcados con aviso. Neto + IVA 19 % + total; fecha de entrega, forma de pago, despacho (por defecto la dirección de Comercial MP), condiciones. Folio **MP-año-correlativo** (clave única empresa+año+correlativo, reintenta si dos emiten a la vez). Criterio tributario anotado en el código y la pantalla: entre relacionadas el precio debe ser de mercado (art. 64 CT).
- PDF: el mismo de Obuma (`generarPdfOc`) con `opciones { logo, firma: null }`: logo de Comercial MP sin deformar, sin imagen de firma (las líneas de firma quedan), y las condiciones piden citar la OC como referencia 801. Las OC de Obuma se dibujan EXACTAMENTE igual que antes. Muestra en `scripts/scratch/oc-mp-muestra.pdf` (datos de ejemplo).
- Factura: XML del SII → se revisa ANTES de subir el archivo: emisor = RUT del proveedor y receptor = RUT de Comercial MP (si no, se rechaza diciendo por qué); si cita la OC (TpoDocRef 801 + folio) se empareja sola; si no la cita pero el neto es igual (±$1) pide «Sí, es esta factura»; si no, se rechaza. PDF → folio, fecha, neto y total a mano (emparejo MANUAL). Estados: EMITIDA → FACTURADA; «Quitar la factura» y «Anular la OC» (con motivo, folio no se reutiliza). Eventos `COMPRAS_OC_PROPIA_EMITIDA/FACTURADA/FACTURA_QUITADA/ANULADA`.
- Migración 180 **aplicada en la BD del VPS** (05-nov, con OK del dueño; el espejo local :3308 no estaba corriendo). Chequeo de solo lectura (`scripts/scratch/_oc_propia_check.mts`): en 979 sale Comercial MP → Inversiones Claro y los 5 productos; 4 traen precio del escenario COMBINACION (proveedores externos AHN / General Trade) y la Vacuolavadora DB51 sin precio (no está en el escenario: se escribe a mano). En el modal los productos vienen DESMARCADOS (decisión del dueño, 05-nov): se marca solo lo que se le compra a Inversiones Claro; sin nada marcado no deja emitir. Un negocio de Inversiones Claro (1659) no ve la tarjeta.
- **Pendiente:** (2) emitir una OC real en 979 y subir la factura real de Inversiones Claro; (3) **no está conectado al costo real ni al margen**: la factura queda guardada en la OC, pero el costo real de Compras no la toma todavía; (4) la factura la emite Inversiones Claro desde Obuma: a futuro se podría traer sola desde las ventas de Obuma en vez de subirla; (5) sin firma escaneada de Comercial MP (si se entrega, va en `public/oc-mp/firma.png` y `firma: 'oc-mp/firma.png'` en la ruta).

## 2026-11-05 — «Crear el SKU de cada producto» con el diseño licitank-ui (`AprobacionesCompraCard.tsx`, solo visual; tsc ok, SIN ver en navegador)
- Encabezado con ícono en cuadro suave, barra de avance «N de M creados» (teal; verde al completar) y botón del kit (`Boton` primario). Filas con número, nombre arriba y marca/modelo (lo que va tras « - ») abajo en gris, estado con punto («Sin SKU» / «SKU X · falta crearlo en Obuma») y botones `Boton` sm. En la tabla de SKU creados y en el formulario: sin índigo (pasó a teal/gris), sin mayúsculas en los encabezados, `font-semibold` en vez de bold/extrabold, pasos 1-6 en cuadro gris suave. Sin cambios de datos, reglas ni textos de negocio.
- (mismo día) Pedido del dueño: el formulario de «Crear SKU» se abre en un **modal** (`Modal` de `app/components/ui`, tamaño lg) en vez de desplegarse dentro de la fila: título + producto (y «quedan N por crear» en la cola) arriba, los 6 pasos con scroll al medio, y abajo fijo «Falta: …», Cancelar y «Crear el SKU en Obuma» (misma condición de deshabilitado que antes). Esc o la X cierran (también cortan la cola). tsc ok, sin ver en navegador.
- (mismo día) **Regla nueva (pedido del dueño):** al crear el SKU en Obuma, si el producto **no está en ningún escenario de compra** (no se cotizó, ej. Vacuolavadora DB51 en 979) el precio de costo neto **se escribe a mano** en el paso 5 (antes decía «Falta elegir el escenario» y no dejaba crear). Si hay escenario, manda el escenario y no se ofrece el campo. Se confirma igual en el paso 6 («Confirmo que este costo puesto a mano…»). Servidor (`crearSku` en `compras-aprobaciones.ts`, campo `costoManual` en la ruta `sku`): sin escenario y sin costo manual → error; con escenario y costo manual sin `costoEsperado` → rechaza («ya tiene costo en el escenario, vuelve a abrir»). El evento `COMPRAS_SKU_CREADO` dice «Costo puesto a mano: $X» y guarda `costo_manual` en metadata. El costo manual NO se guarda en el escenario ni en el costeo (solo va a Obuma). tsc ok; sin probar contra la BD ni creando un producto real en Obuma.

## 2026-11-05 — «Compara y elige»: cada oferta muestra qué incluye su precio (fase 1 del rediseño; `ComparadorPrecios.tsx`; tsc + eslint ok, SIN ver en navegador)
- Reporte del dueño: la pantalla «no se entiende nada» y de AHN (#266, negocio 979) solo decía «incluye 3 adicionales». El dato sí estaba guardado (`compras_cotizacion_adicional`: 2 acoples + 15 m de manguera = $87.200 sobre $2.100.000); faltaba mostrarlo. Riesgo de fondo: «Mejor» comparaba el equipo solo de Aquapress contra equipo + accesorios de AHN.
- Ahora, por oferta: desglose por unidad (producto solo + cada adicional con cantidad × precio + total), etiqueta «producto + N adicionales» / «solo el producto, sin adicionales», «% menos/más que lo costeado» y «Mejor precio». Las reemplazadas del mismo proveedor van plegadas en una línea (la elegida queda a la vista). «Ver cotización», «Ver detalle del precio» y «Cambiar producto» pasaron al menú «⋯». Las líneas sin sumar siguen en la oferta («+ Sumar …»). Sin cambios de datos ni cálculos.
- Pendiente (propuesto, sin hacer): fase 2 = frase de recomendación por producto y «Mejor» = la más barata que cumple la ficha (cambia la regla: requiere OK del dueño); fase 3 = historial por producto (cotizaciones, reemplazos, adicionales, cambios de producto, elección) con los eventos de `registrarEvento`.

## 2026-11-05 — «Sincronizar con costeo» ahora SACA lo que ya no está en el costeo (2446-240-LE26, negocio 979; `sincronizarProductosConCosteo` en `compras.ts`, aviso en `ProductosCompraCard.tsx`; tsc + test ok, corrido contra la BD en 979, sin ver en navegador)
- Reporte del dueño: al sincronizar, Compras no quedaba igual al costeo; tuvo que renunciar a mano 4 filas (RETIRO, ENTREGA y dos con el nombre cortado «impiador…»/«iltros…» de un costeo viejo).
- Causa: la sincronización solo actualizaba y agregaba; por diseño nunca sacaba las filas que ya no estaban en el costeo. Además quedaba un duplicado (id 344, «Limpiador de filtros» ×2, con cotización) que nadie había visto.
- Regla nueva (decisión del dueño: «que se sincronice con el costeo actual»): lo que sobra **sin nada colgando se borra**; **con cotización/veredicto y aún PENDIENTE/COTIZANDO queda RENUNCIADO** con motivo «Ya no está en el costeo» (por «Sincronización con el costeo»), con sus partes; si vuelve al costeo, **revive**. Lo ya comprado o con renuncia propuesta **no se toca** y el aviso lo cuenta para revisarlo. Las renunciadas a mano se emparejan al final. Reemplaza los dos borrados parciales de antes (duplicados y fila «Proyecto…», 04-nov). Corre también sola al guardar el costeo.
- En 979: quedaron vigentes exactamente los 5 del costeo; 344 salió (respaldo `scripts/scratch/_979_respaldo_productos.json`); segunda pasada sin cambios. Sin probar con datos reales: el borrado de una fila sin nada colgando y el revivir.
- Decisión del dueño (mismo día): si la sincronización saca al menos un producto, **anula las aprobaciones de compra ya dadas** (`invalidarAprobacionesCompras`, igual que renunciar a mano). Si no saca nada, no toca las aprobaciones. Sin probar con datos reales (979 no tenía aprobaciones).
- (mismo día, tras desplegar) El dueño seguía viendo RETIRO/ENTREGA/limpiador renunciados en la lista: «quiero solo que me salgan los del costeo». La pestaña por defecto de «Productos y cobertura» pasó de «Todos» a **«En la compra»**: solo lo vigente; lo renunciado o no adjudicado queda en «Fuera de la compra» (historial, no se borra). `ProductosCompraCard.tsx`; tsc ok, sin ver en navegador.

## 2026-11-04 — OC Nacional / Internacional al emitir la orden en Obuma (`obuma.ts` crearOrdenCompraObuma, `compras-oc-obuma.ts`, ruta `orden-compra-obuma`, `RepartoAdminCard.tsx`; test con fetch simulado, sin crear OC real ni ver en navegador)
- Decisión del dueño: al crear la OC hay que elegir si es nacional o internacional. Antes TODA OC salía nacional en pesos (`oc_internacional 0`, `oc_moneda 1`).
- La API de Obuma (artículo 331, Compras OC) sí tiene `oc_internacional`, `oc_internacional_tipocambio` y `oc_moneda` (ID de `/pg-monedas.list.json`: USD=3, EUR=4, GBP=6, AUD=7). NO hay API de «Gestión de importaciones» (DIN, aduana, internación): eso sigue siendo a mano en Obuma.
- Formato copiado de las 25 OC internacionales hechas a mano en Obuma (folios 174, 384, 385): precios en la moneda extranjera con 2 decimales, cada línea `producto_exento 1`, IVA 0, neto 0, `oc_exento` = total. En ellas el tipo de cambio quedó en 0; Licitank sí lo manda.
- Licitank guarda precios en pesos (`Math.round(precio × TC)`): la OC internacional manda pesos ÷ TC. El formulario precarga internacional + moneda + TC si la cotización del proveedor vino en otra moneda (`compras_cotizacion.moneda/tipo_cambio_usado`); si no, el dólar/euro de hoy (`tipo-cambio.ts`, tope 4 s). En `compras_orden_compra_obuma` se guarda el equivalente en CLP (margen y pagos siguen en pesos). Sin migración.
- Pendiente: (1) crear UNA OC internacional real y revisarla en Obuma (que los decimales y el exento queden como en la 384); (2) un proveedor extranjero sin RUT todavía no puede recibir OC (Licitank exige RUT); (3) en la OC nacional la línea de flete se manda sin `producto_precio` (por lo de la OC 3989, Obuma la guardaría en 0): revisar.

## 2026-11-04 — QA de fichas de Compras con 31 fichas de prueba, en serie, TODAS A LA VEZ y re-subida (negocio 296 = 1191688-50-LE26; `compras-fichas.ts`, `auditor-opciones-core.ts`)
Banco: `scripts/scratch/fichas-prueba-1191688/` (20 fichas de formatos distintos + 11 adversarias Q01-Q12: cotización con precios, televisor, ficha sin marca, catálogo mixto, PDF escaneado, inglés, duplicado) y `scripts/scratch/_fichas20_*.mts` (correr / chequear con 59 reglas esperadas / limpiar). Todo lo creado en la BD se borró al final (negocio 296 en 0).
- **Resultado final:** serie 59/59 reglas OK; **subida simultánea de las 31: 59/59, 125 s (en serie ~20 min), 0 opciones duplicadas, 0 respaldos huérfanos**; **re-subida: 42 «ya_asignada», 12 s, sin duplicar**. Comparar 3 modelos del mismo producto (calzado) funciona (RankingFichas: «La ficha que más cumple» / «Empatan»): 3 opciones contra los 15 requisitos reales, una llamada, 89 s.
- **Arreglos:** (1) `coincidenciaIdentidad`: el mismo código leído como «modelo» en un documento y «SKU» en otro (o «FPS 50+» como modelo y el código en SKU) es la misma opción → ya no crea una opción duplicada; (2) la IA que decide la línea ahora recibe un resumen de las características de la ficha (`resumenCaracteristicas`): la «Parka VF-P500» solo por nombre quedaba «por confirmar» aunque decía amarillo/reflectante; los lentes solares polarizados igual.
- **Falso positivo que NO era del sistema:** textos cruzados entre PDF (los lentes salían con el texto del gorro) = los PDF de prueba usaban Helvetica estándar SIN incrustar y `pdf-parse` (pdf.js 1.10) devuelve vacío o el texto de otro archivo, incluso leyendo de a uno. Con fuentes incrustadas 0 diferencias en 3 rondas. Una cola de lectura NO lo arreglaba (se probó y se sacó). **Riesgo latente, sin resolver:** un PDF real con fuentes estándar sin incrustar podría leerse mal; mitigación posible: cruzar la capa digital con el OCR cuando ambos existen.
- **Límites vistos:** un documento con varios modelos y uno solo propuesto (17) puede asignar también un distractor; la IA no es del todo determinista en lo dudoso (OG-500 pasó de «por confirmar» a asignada al re-subir). La línea 2 de 1191688-50-LE26 es «no ofertamos»: sus 8 productos de jardinería no entran al ruteo (correcto).

## 2026-11-03 — Pestaña Fichas técnicas con el diseño licitank-ui (`FichasTecnicasCard.tsx`; tsc ok, SIN ver en navegador: el pane pide login)
«Fichas subidas» pasó a tarjetas (nombre, estado con punto, producto, Ver/Descargar) con selector Tarjetas/Lista y «Ver las N fichas» (6 a la vista). Sin índigo, pastillas ni mayúsculas; botones del kit (`Boton`), KPIs en tarjetas con punto de color, fila de producto más limpia (estado + Comparar; «Subir ficha», «Incidencias» y links quedaron dentro del producto abierto). `Insignia` ahora es texto con punto (también la usa FichasEnCotizacion vía OpcionFila). Pendiente: mirarla en pantalla (claro/oscuro) y pulir.

## 2026-11-03 — Fichas «por asignar» ahora traen sugerencia por nombre + «Asignar todas las sugeridas» (1426039-8-LE26, negocio 772; `compras-fichas.ts` panelFichas, `FichasTecnicasCard.tsx`; tsc ok, sin ver en navegador)
Causa: las fichas SIN marca/modelo (muebles normados) no pasaban por la IA y quedaban sin sugerencia (3 de 4 en 772). Ahora el panel sugiere por `puntuar` si una línea gana con ≥0.5 y ≥0.2 de ventaja (no auto-asigna; hay que confirmar). Selector marca «★ Sugerido», dice si el producto ya tiene ficha, el botón dice «Asignar a «X»» y un texto explica que una asignación mala se corrige con «Cambiar de producto…». En 772 se asignaron a mano (script) Sendai→Silla escritorio (387), Bacinica JUNJI→373, Repisa radio→389, y se compararon 369/373/387/389.

## 2026-11-03 — Fichas técnicas: lista «Fichas subidas» con Ver y Descargar (1426039-8-LE26; `FichasTecnicasCard.tsx`; tsc ok, sin ver en navegador)
El dueño subió muchas fichas y solo se veían abriendo producto por producto (o el «Ver» de las por asignar). Ahora, arriba de «por asignar», hay una lista con TODOS los documentos subidos (asignados, por asignar, no-ficha, con error), cada uno con Ver (visor con flechas ←/→ entre fichas) y Descargar, más «Descargar todas». Las fichas de modelos quitados (solo nombre, sin url) no entran.

## 2026-11-03 — 20 fichas técnicas de PRUEBA para entrenar/probar el lector de fichas (1191688-50-LE26, negocio 296)
Banco de prueba pedido por el dueño: 20 fichas con formatos muy distintos (PDF limpio / 2 columnas / bilingüe / apaisado con productos como columnas / folleto de 3 páginas / catálogo denso de 12 productos; DOCX en prosa, con tablas y con 3 modelos de los que solo uno es el ofertado; XLSX de varias hojas, matriz y llave-valor; JPG tipo foto rotada y etiqueta de envase que exigen OCR). Cubren los 26 productos del negocio 296 (EPP, vestuario, jardinería; 0 fichas previas, todo PENDIENTE). Datos FICTICIOS (marcados «DOCUMENTO DE PRUEBA» en cada archivo). Generador: `scripts/scratch/_fichas20_generar.mjs`; salida y `_indice.json` con qué producto trae cada una y su dificultad: `scripts/scratch/fichas-prueba-1191688/`. **Corrida real (3-nov, con IA Kimi, vía `procesarFicha` + servidor local temporal; luego BORRADO todo lo creado en la BD del VPS, negocio 296 quedó como estaba; scripts `_fichas20_correr.mts` / `_fichas20_limpiar.mts`):** 14 de 20 rutearon bien (PDF, Word, Excel, fotos con OCR, catálogo de 12 productos, productos como columnas). Dos bugs reales arreglados en `compras-fichas.ts`: (1) `productoDeLinea` miraba una sola línea y con el mismo ítem repetido (las 18 líneas son «L1») mandaba cualquier ficha al primer producto (fonos → «Pantalón cargo»); ahora cruza contra todas las líneas; (2) un Excel/Word de ficha con una hoja de «condiciones comerciales» y sin precios salía como cotización → «no es ficha»; nueva `esSoloComercial` (sin precios + marca/modelo = ficha). Test: `compras-fichas-ruteo.test.mts`. **Lo que quedó como «sin producto» (02, 03, 08, 11, 12, 16) es correcto:** la línea 2 de 1191688-50-LE26 está marcada «no ofertamos» en el costeo, y las 8 de jardinería existen en Compras pero no tienen línea auditable. **Limitaciones vistas, sin tocar:** (a) en un documento con varios modelos (17: OG-100/300/500 con «modelo propuesto: OG-300») se asigna también el distractor OG-100 porque `es_producto_principal` del Lector no es confiable (en catálogos legítimos marca solo 1 de 4); (b) el Lector deja el código en `sku_fabricante` y `modelo` vacío (08 matriz Excel) o no lo capta si es chico en una foto (19); alcanza para identificar pero se muestra sin modelo.

## 2026-11-03 — OC ya hechas en Obuma se reconocen también por SKU (`compras-oc-obuma.ts`; probado contra la BD real en el negocio 308, sin ver en navegador)
Caso 1095439-8-LP26 (negocio 308): Dercomaq, Metalúrgica Hund, Yucheng y Henan Saloni salían «Sin emitir» + «proveedor sin RUT» aunque sus OC (3855, 3865, 3869, 3870, 3976) ya estaban en Obuma con la referencia de la licitación. Causa: el cruce era solo por RUT / id de proveedor en Obuma y esas fichas (cotizaciones leídas de PDF, proveedores extranjeros «SinRut») no tenían ninguno de los dos. Ahora hay una tercera vía: si un ítem de la OC de Obuma trae el mismo SKU (`productoId` o código comercial) que un producto del grupo, cuenta como OC real. Solo vale un SKU propio de UN producto del negocio y no un código genérico de 1-4 dígitos (`100 · TRANSPORTE`, compartido por todos los fletes). Efecto lateral buscado: esos productos aprobados pasan a «Comprado» (misma regla que ya existía para OC reales). **Pendiente:** el total de Obuma no coincide con el nuestro en Hund ($21,95M vs $24,82M), Henan ($9,54M vs $10,13M) y Yucheng ($23,98M vs $25,44M): revisar si es descuento, tipo de cambio o ítems faltantes. Las fichas locales 524-527 siguen sin RUT ni id de Obuma (no se escribió nada).

## 2026-11-03 — «Aprobar la compra completa» aprueba todo de una vez (`TablaAprobacionCompra.tsx`; sin desplegar, sin probar clic)
Decisión del dueño: el botón no puede exigir aprobar los 17 productos uno por uno. Ahora (solo jefe de ventas, compra en PENDIENTE) está activo aunque falten:
pide confirmación («se aprobarán los N que faltan y luego la compra completa»), aprueba en un PATCH los productos sin decisión o «Corregidos» (`aprobaciones/linea`),
las compras rápidas pendientes una a una (`compra-rapida`) y recién después llama `onAprobarCompra`. Si falla algo, avisa y recarga sin aprobar la compra.
**Los RECHAZADOS no se aprueban solos:** con alguno rechazado el botón queda apagado (hay que corregirlo o deshacer el rechazo). tsc limpio; no se pulsó nada en producción.

## 2026-11-02 — «Agregar flete» en Compara precios (reemplaza «Agregar servicio» de Productos)
- Decisión del dueño: los fletes ya no se crean en Productos. Apartado «Fletes» (`FletesCompra.tsx`, en la etapa Comparar, sobre «Compara y elige»): botón «Agregar flete» → nombre + «¿Tiene cotización?». SÍ: proveedor (nombre y RUT con dígito verificador, obligatorios) + documento; NO: proveedor + RUT + precio neto a mano, editable («Editar precio») y después «+ Agregar cotización». Entra a «Compara y elige» como un producto: se elige, va a aprobación, SKU y OC.
- Por dentro sigue siendo el servicio (`compras_producto.es_servicio`, migration-177): reutiliza aprobación/SKU/OC. Los fletes ya cargados (negocios 308 y 1350) aparecen solos en «Fletes». El PATCH `agregar_servicio` ahora devuelve `productoId`.
- Sacado: «Agregar servicio», su formulario y el chip «Servicios» de `ProductosCompraCard` (los servicios ya no se listan en Productos) y la asignación automática de la línea de flete al servicio en `compras-auditor.ts`. Se dejaron los campos de flete del formulario de cotización y el «flete aparte» sumado al total.
- La reserva del 5 % se queda SIEMPRE (decisión del dueño: con ella ve si gasta más o menos en flete). El cuadro de margen muestra el comparativo: flete real cargado (servicios + flete aparte de los ganadores) vs reserva estimada, con «gastas $X más/menos». Los servicios ya no cuentan como líneas «sin precio de venta» del margen.
- Sin ver en navegador ni probado contra BD (tsc limpio). Fletes sin cotización usan origen «llamada» y nota «Flete sin cotización: precio puesto a mano.»; «Editar precio» solo en los sin documento (el PATCH reescribe las notas).

## 2026-11-02 — Flete cotizado aparte ahora suma y se detalla (2906-19-LE26, cotización #231 Bioplastic)
- La cotización traía estanque $7.555.130 + flete $458.600 (neto $8.013.730); el flete SÍ estaba guardado (`flete_monto`) pero «Total si compras aquí» (`ComparadorPrecios` y `MatrizPrecios`) sumaba solo los productos ($7.555.130) y no mostraba el flete. Ahora total = productos + flete, con la línea «Productos X + flete Y» debajo. `CotizacionMin.fleteMonto` opcional.
- Lo mismo en la tabla «Cotizaciones recibidas» (`ListaCotizaciones.tsx`): chip «Flete $X» en «Qué cubre» y Total = productos + flete con el desglose debajo.
- Líneas del documento que no quedaron en ningún producto ni adicional: ahora son una ALERTA VISIBLE en «Cotizaciones recibidas» (`ListaCotizaciones.tsx`, mismo cálculo `lineasDesdeTabla` + `lineasSinAsignar` que guardaba solo en `notas`). Cada línea tiene «Agregar» (de a una; si la cotización cubre varios productos, elige a cuál) y «No agregar» (solo de la vista, no se guarda). Agregar hace PUT a `/adicionales` con lo previo + la línea (cantidad por unidad con `adicionalesDesdeIA`). Solo CLP; la línea de flete no se ofrece si la cotización ya tiene `flete_monto`. Sin ver en navegador ni probado contra BD. Ojo: el PUT reescribe los adicionales del producto como «creados por persona».
- BUG de ese aviso (misma fecha, 2906-19-LE26 #231): comparaba las líneas con la descripción del producto cortada en « - » (solo «Estanque de almacenamiento de agua…»), así que la línea del propio estanque salía como «sin asignar»; al pulsar «Agregar» se sumó el estanque otra vez ($1.888.783 → $3.777.566 c/u, total $15,5M). Arreglado: se compara con la descripción completa (en la pantalla y en el aviso de `notas` de `compras-auditor.ts`), más una segunda red por precio unitario igual al `precio_base`; test de regresión en `compras-cotizacion-lineas.test.mts`. DATO SIN CORREGIR en producción: adicional id 61 de la cotización 231 (quitarlo desde «Editar adicionales»).
- SERVICIO «Trasporte» + flete de la cotización (2906-19-LE26, cot. 237): la lectura dejaba el flete solo en `flete_monto` y el servicio (producto `es_servicio`) quedaba sin cotizar. Ahora `homologarCotizacion` (compras-auditor.ts): si hay UN servicio sin precio y UNA línea de flete/transporte con precio (solo CLP), esa línea pasa a ser el ítem del servicio (precio = total de la línea ÷ cantidad) y se pone `flete_monto = NULL` para no contar el flete dos veces. Con 0 o varios servicios/líneas no toca nada (queda como flete aparte). Para aplicarlo a una cotización ya subida hay que «Volver a leer con IA». Sin probar contra BD ni en navegador.
- Cambiar a qué producto/servicio va una cotización (negocio 308, 1095439-8-LP26: 3 transportes, las cotizaciones #241 y #242 quedaron ambas en «FLETE 2»; la IA las junta cuando los servicios se parecen). Ahora: pastillas de la lista de «Cotizaciones recibidas» clicables (⚠ ámbar si otra cotización cubre el mismo servicio); en «Compara y elige», cada oferta con «Ver cotización» y «Cambiar producto»; el editor de asignación muestra «Ver el documento», las líneas que trae el documento y un selector «Es de un solo producto» que deja solo ese. Se reasigna con el PUT de `/items` de siempre. Pendiente del dueño: reasignar a mano #241/#242 (no lo toqué en la BD). Sin ver en navegador.
- En «Margen: costeo inicial vs cotizaciones» se agrega una línea informativa «Flete cotizado aparte» (proveedores que dan el mejor precio de alguna línea). NO se tocó el cálculo del margen: sigue la reserva automática del 5 %. Pendiente de decisión del dueño: si el flete real cotizado debe reemplazar esa reserva en la columna «Con cotizaciones». tsc limpio; sin ver en navegador.

## 2026-11-02 — SERVICIO en Productos (flete de toda la entrega con proveedor, cotización, SKU y OC) — etapa 1
- Decisión del dueño: «gasto extra» = lo chico (colación, bencina). El transporte grande que lleva todo junto (387-55-LE26: OC 4015 $1.400.000 y línea de palletizado $59.000 dentro de la OC 3996) es un SERVICIO: producto de Compras sin línea del costeo, sin venta, sin padre (≠ «parte»). Botón «Agregar servicio» al lado del buscador de Productos (`ProductosCompraCard`), chip «Servicios».
- `compras_producto.es_servicio` (migration-177, `scripts/aplicar-migration-177.mjs`; local por defecto, `--produccion` solo con OK). `hayColumnaServicio()` deja todo funcionando sin la columna. `crearServicioProducto` NO invalida aprobaciones (es costo, no alcance de lo vendido; las partes sí invalidan y borran las decisiones por producto).
- Excluido del sync con costeo, de `decidirNoAdjudicadas`, de `coberturaProyecto` (no cuenta en «hay que cumplir»), del acta de entrega, del traslado al costeo y de `lineaDeProducto`/`lineaCosteoDeProducto`. Quitar: «Quitar este servicio» (solo PENDIENTE y sin cotización).
- Etapa 2 (misma fecha): NO hay código nuevo de «enlace a OC»: el servicio entra por el flujo de siempre — cotización con su proveedor (Salinas para la 4015; Officenter para el palletizado de la 3996, en la misma cotización que la biblioteca) → escenario → aprobación → OC. `proveedoresParaOrdenCompra` cruza por proveedor (RUT o id de Obuma) y, si ya hay OC real, `marcarCompradosConOc` lo pasa a Comprado. Ojo: solo si el jefe aprobó la línea del servicio (en 1191 hay decisiones por producto, un servicio nuevo queda sin decidir). `tablaAprobacion`: el servicio no tiene ficha técnica (`SIN_COMPRA`), sin venta ni costeo; su costo baja el margen total. Costo real: `costoServiciosPorNegocio` (compras-costo-real.ts) suma el subtotal del escenario elegido a gastos registrados (y a `gastosEnOc` si ya está comprado) — una sola vez, sin tocar el costeo.
- NO verificado: el SKU «TRANSPORTE» (código 100) con el flujo de SKU (¿acepta producto sin costeo?), emitir una OC solo con una línea de servicio, el cruce plan↔Obuma por texto de la línea (`compras-comparar-oc.ts`) con «Transporte y palletizado…», y la pantalla (sin ver en navegador). Migraciones 176 y 177 sin aplicar en producción. 1699 pruebas pasan, tsc limpio.

## 2026-11-02 — Gasto extra enlazado a la OC de Obuma que ya lo respalda (387-55-LE26, OC 4015)
- Decisión del dueño: las OC de transporte/armado se hicieron directo en Obuma; en «4 · Gastos extra» el gasto se ENLAZA a esa OC (no se crea otra). Todo debe terminar emitiéndose desde Licitank, pero primero se cuadra Licitank con Obuma (proyecto 198).
- `compras_gasto.oc_obuma_folio` (migration-176, `scripts/aplicar-migration-176.mjs`; local por defecto, `--produccion` solo con OK del dueño). Sin la columna todo sigue funcionando (lista y alta normal con fallback).
- `compras-gastos-oc.ts` (pura): ofrece las líneas de transporte/flete/armado de OC vigentes de Obuma sin gasto anotado; NO ofrece el flete de una OC que emitió Licitank (`flete_monto`, ya está en el plan), ni OC anuladas, ni una línea ya enlazada. `registrarGasto` valida folio + monto contra esa lista (no se inventa el vínculo).
- Costo real: el gasto cuenta UNA vez (`gastosRegistrados`); `gastosEnOc` solo iguala el contraste con Obuma (si no, Obuma parecía +16 %).
- Cuadre 387-55-LE26 (sin la OC 3985, que el dueño dijo que no es de la licitación): venta $18.865.472; plan $9.193.183 (51,3 %); Obuma neto $10.614.391 (43,7 %); dif. $1.421.208 = transporte OC 4015 $1.400.000 + palletizado OC 3996 $59.000 − fletes del plan no facturados (butaca $25.202, taburete $12.597) + $7. OC 4015 ($1.666.000 con IVA) sin pago en Licitank.
- Pendiente: aplicar migration-176 en producción y anotar los dos gastos (4015, 3996); la OC de DECO OULET está enlazada a la 3991 (anulada) y la vigente es la 3982; la 3996 en Licitank no trae su línea de $59.000; RUT vacío en 3996-3999. La «factura 73 duplicada» de la 4015 está duplicada solo en `facturas_json`: `resumenGastosCompra` ya la cuenta una vez (dedupe por dteId). Sin ver en navegador.

## 2026-11-02 — Gasto de entrega (flete) automático en el margen de Cotizaciones paso 2
Decisión del dueño: en «Margen: costeo inicial vs cotizaciones» siempre se carga un 5 % del margen costeado de cada línea como costo extra de entrega (`GASTO_ENTREGA_PCT` en `compras-margen-vs-costeo.ts`). Mismo monto en costo inicial, con cotizaciones y con costo de Compras; sale como fila propia. Negocio 1154: margen 27,9 % → 26,5 %, flete $153.169. El 5 % es sobre el margen inicial, no sobre cada columna (así el flete no cambia con la cotización); si el dueño lo quería por columna, cambiar ahí.
Bug de pantalla: el `<span class="sr-only">` de la cabecera de esa tabla (absoluto, sin ancestro `relative`) estiraba el documento y dejaba un hueco gris al fondo con el menú cortado; arreglado con `relative` en el `th`. Mismo riesgo con cualquier `sr-only` dentro de un contenedor con scroll interno.

## 2026-11-02 — Tarea «Emisión de órdenes de compra a proveedores» ahora se cierra sola
Negocio 1191: 8 OC en Obuma y las 21 líneas «Comprado», pero la tarea `emitir_oc_proveedores` seguía pendiente (nadie la cerraba).
`sincronizarTareaOcProveedores` (compras.ts): cierra si hay ≥1 OC y ninguna línea en Pendiente/Cotizando; solo cierra, nunca reabre. Se llama
desde `marcarCompradosConOc` (al emitir OC / tocar productos) y desde el GET de `/api/compras/[negocioId]` (arregla los negocios ya hechos).
**Siguen manuales a propósito:** las 3 validaciones (técnica real, cotización, costeo), `contacto_pagos` y `factura_cierre` (son juicio humano
o dato que no queda registrado). tsc limpio; sin probar en navegador ni contra BD.

## 2026-11-02 — Conciliación 387-55-LE26 (negocio 1191, a cerrar) y causa del RUT vacío
- Causa del RUT NULL en `obuma_compras`: la API de Obuma cortó `proveedores.findById` por tope diario («Error 005… límite de consultas diario»); la sync lo tragaba y SOBRESCRIBÍA el RUT con NULL. Ahora: `resolverProveedor` mira primero `compras_proveedor` (por `obuma_proveedor_id`), el upsert no pisa con NULL (COALESCE) y los cruces OC↔proveedor (`proveedoresParaOrdenCompra`, `emparejarPlanConObuma`) usan también el id de Obuma. PENDIENTE (el dueño debe OK): UPDATE de relleno de los `proveedor_rut` NULL ya guardados desde `compras_proveedor` (bloqueado por seguridad al intentarlo).
- Alerta falsa «Obuma −57,6 %»: el consolidado comparaba solo las 8 OC emitidas por Licitank (con respaldo con IVA). Ahora manda el neto de TODAS las OC de Obuma sin anuladas (18 OC = $12.648.392) → +38,6 % real, explicado abajo.
- Cuadre: costeo estimado $12.210.692 = presupuesto del proyecto Obuma #198 ($12.210.695); venta neta $18.865.472 igual en ambos. Costo real Licitank (21 líneas, cotizaciones) $9.123.706 vs OC Obuma neto $12.648.392 → dif. $3.524.686 = carro tecnológico OC 3985 ($2.034.000, no está en el costeo ni en los productos) + transportes sin registrar como gasto extra (OC 4015 $1.400.000, 3998 $10.670, 3996 $59.000; `compras_gasto` vacío) + silla auditorio +$21.008 (plan $18.400 vs OC 3995 $18.925). Sin cierre aún.
- Proyecto Obuma #198: costo $10.706.261, gastado $12.881.106, 27 documentos; anomalías: Punta Ranco (OC 3998) factura $537.627 con NC −$537.627 (neto 0); GRUPO CRUZADOS (OC 3997) neto −$18.000; NC −$441.209 de LOCKERS STORE SPA que calza con la factura de Roco Import; gastos sin folio $356.900 (limpieza, horas extras, colación, salidas a retiro) que Licitank no tiene.

## 2026-11-02 — OC hechas en Obuma salían «Sin emitir» (387-55-LE26, Roco Import / banca de camarín)
- Causa: el cruce «OC real de Obuma ↔ proveedor» era solo por RUT, y las 22 filas de `obuma_compras` de esa licitación tienen `proveedor_rut` y razón social NULL (la sync no pudo leer el proveedor; sí guarda `proveedor_id` = `rel_proveedor_id`). La OC folio 3984 (PR-198 ID 387-55-LE26 LOS MUERMOS BOMBEROS, FACTURADA, neto $370.764) es de Roco Import (`compras_proveedor` 479, `obuma_proveedor_id` 202896) y no se veía.
- Arreglo: `proveedoresParaOrdenCompra` ahora cruza también por id de proveedor en Obuma (`CompraObumaFila.proveedorObumaId`). Pendiente: por qué `proveedorPorId` deja el RUT en NULL desde mediados de oct (las OC de sept sí traen RUT); `compras-pagos-oc.ts` y `/api/compras/[id]/factura` también cruzan por RUT y podrían tener el mismo hueco. Sin ver en navegador.

## 2026-11-02 — Analítica de Compras (`/compras/analitica`)
- Pantalla nueva con gráficos (recharts): ganado por mes, estado de la entrega, monto por encargado y por comuna/región, tiempos del proceso OC, tareas por categoría, incidencias, proveedores, gastos, margen. Datos: `app/lib/compras-analitica.ts` (filas de `listarAsignacionesCompras` + consultas sueltas) y `/api/compras/analitica` (misma puerta que el dashboard). Botón «Analítica» junto a «Dashboard» en Compras; ambas páginas tienen «Volver a Compras» y se refrescan solas (SSE). Paleta: teal/pizarra/ámbar/cian/verde/naranja/rosa/piedra; el validador marca teal↔pizarra como poco separables, por eso no van juntas en un mismo gráfico apilado. Sin ver en navegador.

## 2026-11-02 — Fases en la línea de tiempo del Gantt (y pestaña «Fases de la OC»)
- Las barras del Gantt ahora siguen el flujo real: Adjudicación (fecha) → Espera de OC → Llegó la OC (fecha) → Aceptación de la OC (hasta el límite de las bases, o fecha de aceptada; punteada «sin dato» si las bases no dan el plazo) → Plazo de entrega. Ya no se usa el tope legal de 5 días como estimado. Pestaña «Fases de la OC» = misma info en tarjetas, se deja. Pendiente: el plazo para que LLEGUE la OC no está guardado (solo aceptación y entrega). Sin ver en navegador.

## 2026-11-02 — Gantt con dos pestañas
- «Por plazo de entrega» (entrega rápida primero, centrado en hoy) y «Desde las últimas ganadas» (filas por `ganadoAt` descendente, la línea de tiempo parte en la última ganada). Fechas: `app/lib/compras-plan.ts` (`calcularHitosGantt`). Organismo: negocio → caché → OC (`ordenes_compra.comprador_organismo`). Sin ver en navegador.

## 2026-11-02 — Compras (`app/compras/page.tsx`) con la skill licitank-ui
- Gantt: sin scroll vertical interno, filas de 172 px con datos rotulados, estados como texto+punto, modal grande sin degradado. Lista/Mes/modal del día/pestañas/banner: sin pastillas, sin degradados, sin índigo, sin barra de color lateral, sin mayúsculas. También `GanttComprasCard` (compartido con el negocio: sin degradados ni pastillas) y, en `compras/[negocioId]` y `dashboard`, solo lo mecánico (índigo→teal, sin mayúsculas). Falta el rediseño a fondo de esas dos pantallas (pastillas, `font-bold`). Tarjetas del Gantt: nombre a 2 líneas con alto fijo. Sin ver en navegador.

## 2026-11-02 — Gantt de Compras: fila reordenada
- Fila: organismo/región arriba en negrita; el nombre lleva a la licitación de compra (`/compras/[id]`); el botón chico (ícono Gantt) abre el detalle de tareas en un modal (antes panel a la derecha). Solo visual, sin ver en navegador.

## 2026-11-02 — Costo real manual como rango de precios (reemplaza las columnas espejo del 30-oct)
El dueño descartó las columnas espejo «Costo unit. COMPRAS / Link COMPRAS» (quitadas). Lo vigente: Compras anota a mano el «Costo unit. REAL»
del costeo (ya existía) como RANGO de precios mientras cotiza. Ese monto se ve en «Compara y elige a quién comprar» (columnas Costeo ·
Costo real (Compras) · Cotización mejor · Elegido) y en el cuadro de margen (columna «Con costo real de Compras», solo si hay alguno;
líneas sin costo real cuentan al costo inicial, provisional). Al MANDAR LA COMPRA A APROBACIÓN (`proponerAprobacionCompra`) se llama a
`trasladarCompraAlCosteo`: los costos reales manuales se PISAN con los precios cotizados elegidos (best-effort; solo líneas con fila y link).
Datos: `costeoComprasPorProducto` (ahora lee costoRealUnitario). tsc limpio; sin ver en navegador ni probado contra BD.
**Si el jefe RECHAZA la compra**, los costos reales manuales vuelven a lo anotado antes: `trasladarCompraAlCosteo` devuelve `previos`, se guardan en
`detalle_json.costosRealesPrevios` de la propuesta y `resolverAprobacion` (RECHAZAR) llama a `restaurarCostosRealesPrevios` (solo filas que siguen con
el valor cargado). Sin probar contra BD.

## 2026-11-02 — Auditoría de seguridad/QA de Compras: lo corregido
- `/api/proxy`: redirecciones a mano con host revalidado (SSRF), tope de 60 MB, `Cache-Control: private`, y `CSP: sandbox` para SVG/HTML/XML (un SVG
  abierto directo corría scripts con la sesión). Riesgo conocido: si algún documento de Mercado Público redirige a un host fuera de la lista, ahora da 403.
- Visor de Excel (`sanearHtmlExcel`, DocumentViewerModal): solo deja enlaces http(s); `javascript:` se quita (probado con xlsx real).
- **Subidas de Compras: máximo 20 MB por archivo** (decisión del dueño, 02-nov-2026) y sin svg/html/ejecutables: `app/lib/subidas.ts` en cotizaciones
  (+extraer), gastos, pagos-oc (máx. 10 comprobantes), reparto y fichas; `proxyClientMaxBodySize: '25mb'` en next.config (Next recortaba a 10 MB).
- `error.message` ya no sale crudo: `mensajeSeguro` (`app/lib/errores-api.ts`) deja pasar los mensajes de negocio y esconde los de MySQL/red/código
  (80 sitios en `app/api/compras`). `negocioId` no numérico → 400. CSP parcial en next.config (object-src, base-uri, form-action, frame-ancestors;
  sin script-src porque Next/Mantine usan código en línea).
- `compraIniciada` (AuditorComprasCard) pasó a ref: recargar ya no pisa los círculos elegidos sin guardar. LinksProducto: una nota en Link 1 ya no es
  enlace. aria-label en 4 botones «X», role=dialog en 9 modales, noopener en un window.open.
- Filtro `cliente_id` en Compras: NO hace falta hoy, porque `MODULOS_ACTIVABLES` (modulos.ts) deja fuera Compras para clientes externos; el proxy ya
  les niega `/compras` y `/api/compras`. Es OBLIGATORIO hacerlo cuando Compras se agregue a esa lista.
- Esc cierra 7 modales (hook `useCerrarConEsc`, app/lib/use-cerrar-con-esc.ts). CSP con `script-src` en modo SOLO AVISO
  (`Content-Security-Policy-Report-Only` en next.config.ts): recorrer la app con la consola abierta; si no sale ninguna violación, pasarla a
  `Content-Security-Policy`. Hay que reiniciar `next dev` para que lea next.config. Sin probar en navegador.

## 2026-10-28 — «Pasa» decía poco: el veredicto ahora se separa en Precio y Ficha
En «Qué se va a aprobar» (`TablaAprobacionCompra`) el dueño no sabía si «Pasa» era por el precio o por la ficha. Es por LOS DOS:
pasa solo si el precio (proveedor elegido, sin pérdida, no más caro que lo costeado, margen ≥ mínimo) y la ficha (comparada y
cumple) están bien. `compras-aprobacion-tabla.ts` ahora calcula `porPrecio` y `porFicha` (null = sin proveedor) y `estado` es el peor
de los dos (mismas reglas que antes); bajo el veredicto se ve «Precio: OK / por revisar / no pasa» y «Ficha: …». Sin ver en navegador.

## 2026-10-29 — La instalación de la cotización no entraba como adicional
1202333-67-LE26 (negocio 708), cotización Bioplastic 00202780: 200 basureros + «INSTALACIÓN» $400.000. El prompt de
homologación (`SYS_HOMOLOGACION`, `compras-auditor.ts`) decía «IGNORA los servicios»: ahora van en `adicionales`. Además
`adicionalesDesdeIA` guardaba la cantidad por unidad con 2 decimales: 1 ÷ 200 = 0,005 → 0,01 cobraba el doble (también la
«PANTALLA SERIGRAFIA» de la cotización 179); si no cabe exacta, se reparte el monto (1 × $2.000/u). `lineasSinAsignar` ya
no avisa líneas sin precio. Probado con la IA real sin escribir; **las cotizaciones 209 y 179 siguen con lo viejo hasta
re-homologarlas** (y lo hecho antes en otros negocios con cantidades no exactas también).

## Decisiones vigentes del dueño

- **Una sola pantalla con stepper** (2026-09-11, tras 5 vueltas). No volver a páginas por
  submódulo. Costeo y Auditoría van juntos.
- **No reordenar las secciones** (pedido 2026-09-17): Gantt primero, luego resumen ejecutivo, OC y
  flujo. Lo que molestaba era el tamaño, no el orden: compactar, nunca mover. Cambiar el tope de la
  pantalla requiere su OK.
- **Banner «Siguiente paso»** decide UN pendiente por urgencia (`compras-siguiente-paso.ts`).
  Todo tiene que entenderse «hasta por un niño».
- **Compras audita PRECIO, no ficha técnica** (2026-10-06). La cotización se compara contra el
  costo ESTIMADO del costeo. El comparador técnico de fichas es otro documento.
- **Compra rápida** (tienda, sin cotización; migr. 151/152): la aprueba el jefe en la misma fila;
  salta compuertas 1 y 2 solo por producto. **No se exime de lo técnico**: siguen las reglas de
  ficha (sin ficha → Revisar) (2026-10-22).
- **Los 45 negocios ADJUDICADA antiguos** quedaron fuera al arrancar (2026-09-04); después se
  cargaron 44 con fecha real + «cierre legado» (migr. 107).
- **Obuma = registro pasivo** por ahora (2026-09-09). No adelantarse a integrar más sin pedido.
  Crear SKU u OC en Obuma escribe en el ERP real: pedir OK antes de probarlo.
- **Separar Compras como producto aparte**: pospuesto (2026-09-11), sigue dentro del proyecto.
- Vigencia vencida de una cotización SÍ alerta; un descuento por pago contado se aplica como
  descuento normal (2026-10-07). **Servicios con precio (instalación, armado, puesta en marcha,
  capacitación) SÍ van como adicionales** del producto (cambió el 2026-10-29; antes se ignoraban).
  **Si el servicio lleva SKU propio** (la instalación de 1202333-67-LE26), no es adicional: se crea
  en Productos con «Comprar una parte aparte» y la cotización le asigna su línea (probado con la IA:
  2/2 la puso como producto a $400.000). Así tiene su SKU y su línea en la OC. Hecho en el 708 el
  29-oct a pedido del dueño: parte 513 «Instalación» 1 UND, cotización 211 re-homologada (basurero
  $143.516,58 + instalación $400.000, sin adicional).
  El flete sigue aparte (`flete_monto`).
- Descuento global de una cotización solo se aplica con prueba en el documento
  (`descuentoGlobalPorAplicar`, 2026-10-21).
- Línea perdida en el acta → subestado `NO_ADJUDICADA` automático. Ante la duda NO se marca:
  esconder una línea ganada es peor que mostrar una perdida (2026-10-06).
- Tareas Sí/No van con botones, no desplegable (migr. 120); más campos = migración nueva.
- «Datos para facturar» salen del acta desde el día 1; la OC solo completa lo que falta.
- La vista mensual se ancla en `ganado_at` (fecha real de adjudicación).
- El auditor de cotizaciones no puede dar «CUMPLE» sin cita literal verificada por código.
- **2026-10-30 · Perfil «Auditor de Compras»** (permiso `compras_auditor`; se aplica con un botón en Editar permisos → Compras,
  que además marca `solo_compras`). Opera Compras DESDE que la compra está aprobada (compra directa o cuadro): SKU, OC,
  logística, entrega, cierre; ve Proveedores, Proyectos, OC y Fleteros (esos catálogos en solo lectura). NO ve Tareas ni
  Tareas ni Costeo y auditoría (pestañas ocultas, el servidor las niega: los GET usan
  `puedeVerPreAprobacion` y las escrituras `puedeOperarPreAprobacion`, ninguno deja pasar al Auditor; ambos en `/api/compras/[negocioId]/route.ts`).
  Para ver los archivos de cotizaciones y fichas tiene la tarjeta `DocumentosCompraCard` en la pestaña Documentos (ruta `documentos-compra`, solo archivos, sin precios).
  «Compra aprobada» = cuadro (`compras_aprobacion` COMPRA) **o** compra directa (`compras_compra_rapida` APROBADA): al
  principio solo se contaba el cuadro y el Auditor no veía los negocios con solo compra directa. Solo lista/abre negocios con la COMPRA aprobada
  (`negociosConCompraAprobada`, `esAuditorAcotado` en `compras.ts`). No aprueba (eso sigue siendo del jefe de ventas) ni
  ve el dashboard de Compras. **Pendiente:** probarlo con un usuario real (no se creó ninguno).
- **Comparar precios: línea sin cotización muestra su costeo en rojo** donde iba «Mejor + %», y
  bajo «Por proveedor» va un resumen contra lo costeado: cotizadas a su MEJOR precio (no la
  elegida) + sin cotizar a lo costeado = total nuevo, y el margen a favor o sobrecosto en $ y %
  (`ComparadorPrecios.tsx`, pedido en el negocio 1008, 2026-10-27; visto en el 1008: 9 cotizadas + 7 sin cotizar, margen a favor $984.797 · 6,6 %).
- **2026-10-27 · Margen del costeo inicial vs margen con las cotizaciones** (Carolina, que supervisa Compras, no quedó
  conforme con ese resumen de costos): lo reemplaza `MargenCosteoVsCotizaciones.tsx` (cálculo puro y testeado en
  `compras-margen-vs-costeo.ts`; el precio de venta por producto sale de `ventaPorProducto`, en la ruta `cotizaciones`).
  Misma venta neta (precio de venta del costeo × cantidad, sin IVA) en los dos lados; costo inicial = lo costeado; costo con
  cotizaciones = MEJOR cotización neta de cada línea (las sin cotizar siguen al costo costeado). Muestra margen en pesos,
  **margen sobre la venta** (margen ÷ venta) y **recargo sobre el costo** (margen ÷ costo, el «margen» con que el costeo arma
  el precio), con la diferencia en pesos y en puntos; el desglose cotizadas/sin cotizar; y el detalle línea por línea con
  proveedor. Avisa que es provisional mientras queden líneas sin cotizar y cuántas líneas bajan el margen. Las líneas sin
  precio de venta o sin costo costeado no entran y se cuentan aparte. **Visto con datos reales del 1008:** venta neta
  $18.382.127; costo $14.932.691 → $13.947.894; margen $3.449.436 (18,8 %) → $4.434.233 (24,1 %), +5,3 pts; recargo 23,1 % →
  31,8 %; 1 línea baja el margen. **Pendiente:** verlo dentro de la pantalla de Compras (solo se vio el componente suelto).
  Ajuste del dueño (mismo día): letra más grande; una frase de conclusión arriba («el margen sube de 18,8 % a 24,1 %…»); lo
  relevante en negrita y color (verde = mejora, rojo = baja, con flecha ▲/▼ y signo); el detalle por línea queda CERRADO por
  defecto («Ver detalle por línea») y, abierto, marca en rojo las líneas que bajan el margen, en verde las que lo mejoran y en
  gris las sin cotizar, con el cambio en puntos y en pesos.
  Posible siguiente paso: un segundo escenario «con lo que ya se eligió comprar» (hoy es siempre la mejor cotización).

## Reglas para trabajar aquí

- **Nunca probar acciones que invalidan aprobaciones** (partes, cotizaciones, escenario,
  renuncias) en un negocio con compra aprobada (§10.5). Pasó el 2026-10-21 en el negocio 1191 y
  hubo que restaurarlo. Usar un negocio sin aprobar o restaurar al terminar.
- No meter ítems de Compras en `editorAFilasCosteo`: contaminan anexo, motor y cobertura.
- Velocidad: cada consulta a la BD cuesta ~180 ms; lo que mata es la consulta en serie. Correr
  `_medir-compras-rutas.mts` antes y después; nunca `await` en serie de lecturas independientes;
  no más de ~8 consultas a la vez.
- La lentitud al leer cotizaciones/fichas es la IA (glm-4.7), no R2/BD. `flashx` se descartó en
  A/B (lee mal). Cambiar de modelo solo con A/B aprobado por el dueño.
- Antes de crear una migración, `ls docs | grep migration-` para ver el número libre (en oct-2026
  se pisó un script de otra migración).
- Datos de prueba se marcan «PRUEBA QA»; nunca registrar hechos inventados en tareas.
- Tutoriales en video viven FUERA del repo.

## Pendientes conocidos

- Sin probar de punta a punta: aprobar compra/margen, crear SKU, OC en Obuma, hitos, entrega,
  acta y postventa; registrar un pago real con varios comprobantes (POST a R2).
- Lento: escenarios (relee productos/cotizaciones 5 veces por request), productos (~2,3 s por
  `marcarCompradosConOc` en cada GET), auditor-costeo. Idea: caché por request.
- «Auditar todo» puede colgarse en una línea (sin timeout del lote).
- Detectar la subida duplicada del mismo documento de cotización.
- Negocios 217, 979 y 1154 tienen grupos de productos repetidos: revisar con
  `scripts/fusionar-productos-duplicados.mts` en modo simulación antes de fusionar.
- Gastos de la tarjeta Gastos: ¿neto o con IVA? y posible doble conteo con Importación.
- Cruce Obuma ↔ `experiencia_caso` (alimenta `/memoria`) sin construir.
- Correo SMTP propio: el servidor acepta pero Gmail no entrega (falta DKIM/DMARC).

## 2026-10-30 — Gantt de /compras: organismo y región por fila + filtro Región
- Cada fila del Gantt muestra solo el lugar corto (`lugarCorto` en compras/page.tsx): comuna si el organismo es «Municipalidad de X» (→ X), si no la región sin prefijo. El selector **Comuna / región** filtra por ese mismo nombre. La fila subió de 78 a 92 px.
- La región sale de `negocios.licitacion_region`. La **comuna no se guarda** en `negocios`; solo se ve a través del nombre del organismo. Pendiente si se quiere filtrar por comuna: guardarla (viene de `ComunaUnidad` de MP).

## 2026-10-30 — Pantalla en blanco abajo + menú lateral cortado (Costeo/Auditoría/Comprar precios)
**Causa (probable, no reproducida en navegador):** `AppLayout` tenía `h-screen overflow-hidden` en la raíz; un `scrollIntoView` (botones «Siguiente», Auditor de compras) que no cabe en `<main>` desplazaba la raíz entera y quedaba un tramo vacío debajo.
**Arreglo:** raíz y contenedor interno de `AppLayout.tsx` pasan a `overflow-clip` (no admite scroll programático). Además `app/compras/[negocioId]/error.tsx`: si Compras falla al dibujarse, muestra el error en vez de blanco.
**Pendiente:** confirmar con el dueño que ya no ocurre.

## 2026-11-02 — Formularios de Cotizaciones en modal
- «Compra directa» (compra rápida), «Registrar una a mano / Editar» y «Cargar varias cotizaciones» ya no se despliegan dentro de la tarjeta: abren en `Modal` (`AuditorComprasCard.tsx`). `CompraDirectaPanel` restyleado con tokens licitank-ui (inputs h-10, sin índigo, `Boton`).
- Pendiente: el formulario «a mano» conserva sus inputs de 12 px (solo se movió al modal); no verificado en navegador (login requerido). Otros formularios de Compras aún inline.

## 03-nov-2026 — Quitar un flete con cotización (negocio 308, flete 520)
- `eliminarParteProducto` (compras.ts): para un SERVICIO/flete ya no bloquean las cotizaciones ni el veredicto IA; se borran sus líneas de cotización, adicionales, veredicto y decisión de aprobación. Sigue bloqueado si está comprado (subestado ≠ PENDIENTE), tiene compra rápida o SKU → «Renunciar». Las partes de producto no cambian.
- «Quitar flete» (FletesCompra.tsx) abre un modal al centro que explica qué pasa; el documento de cotización queda en «Cotizaciones recibidas» sin producto. Sin probar en navegador.

- Flete: al escribir un RUT válido se busca el proveedor en nuestro sistema (/api/compras/proveedores?q=) y luego en Obuma, y rellena el nombre si está vacío; avisa si es proveedor nuevo. Sin probar en navegador.
- Flete con cotización: al elegir el documento se lee con /cotizaciones/extraer (spinner «Leyendo…») y propone precio neto (descuenta IVA si el documento lo trae incluido), proveedor y RUT sin pisar lo escrito. Antes no se veía nada hasta Guardar. Sin probar en navegador.
- Margen costeo vs cotizaciones (MargenCosteoVsCotizaciones.tsx): cambios en palabras («sube $X», «baja $X», «sube 42,9 puntos», «sin cambio»), nunca con + ni −. Con fletes cargados hay sección «Fletes: lo estimado contra lo real» (cada flete, total, reserva 5 % vs real, margen en pesos y % con el flete real, frase final). Sin probar en navegador.
- Margen: la tabla principal ahora trae la columna «Con cotizaciones y flete real» (el flete real reemplaza la reserva del 5 %; el costo neto no cambia) y la Diferencia pasa a ser frente al costeo inicial con flete real; frase propia con el margen resultante. Sin probar en navegador.
- «Tu compra»/combinaciones (compras-auditor.ts armarCombinacion y armar): un flete contratado (servicio) ya NO suma a la mercadería ni genera «viaje»/«flete sin confirmar»; suma a costoLogistico como flete cierto (Combinacion.costoFleteContratado). Pantalla: etiqueta FLETE en su fila (al final de la lista) y «Flete … confirmado». Si hay un flete elegido se asume que cubre el transporte (no se avisa «sin confirmar» de los otros proveedores). Aprobación/SKU/OC leen el escenario guardado: sin revisar con datos reales.
- Marcas de «Elegir a quién comprar» (AuditorComprasCard.tsx): eran solo estado en memoria hasta «Elegir esta compra», por eso se desmarcaban al actualizar. Ahora el borrador se guarda en localStorage (compras-borrador-compra:{negocioId}) y se restaura filtrando lo que ya no vale. Es por navegador, no compartido entre personas. Sin probar en navegador.

## 2026-11-03 · «Ver OC» y «Ver factura» en Compra y logística (negocio 308)
- Bajo cada «OC N°» de pagos: origen («Hecha en Obuma» / «Emitida desde Licitank»), enlace **Ver OC** (`OrdenCompraVisor.tsx`, API `orden-compra-obuma/documento`, lib `compras-oc-documento.ts`: réplica del PDF de Obuma con logo `public/grupo-ica-logo.png`) y **Ver factura** (`FacturaVisor`) + enlace «XML».
- Facturas repetidas dentro de una OC (Obuma las guarda por línea) se deduplican por dteId en `ocsConFacturas`.
- Límites: el proveedor sale de la ficha local (teléfono/correo/comuna quedan en blanco si no están; `proveedores.findById` tiene cuota diaria y se agotó). Emisor fijo por `rel_empresa_id` 1005; «Generado por» solo para usuario 5707 (Carlos A M). Sin imagen del producto.
- Hallazgo: `obuma_compras.fecha_ingreso` queda +3 h respecto de Obuma (raw_json trae la hora real). Sin corregir.
- OC 4033/4034 (flete, 3-nov 14:52/14:54) las creó el usuario Obuma 32814 (igual que la 4008), no Carlos (5707, que hizo la 3870).
- (3-nov, corrección) «Ver OC» ahora es el **PDF con la plantilla exacta de Obuma**: `app/lib/compras-oc-pdf.ts` (pdf-lib, coordenadas medidas sobre `orden-de-compra-3870.pdf`; logo y firma en `public/oc-obuma/`), servido por `orden-compra-obuma/documento?folio=` (`&descargar=1`). Se comparó pixel a pixel contra el original (queda < 1 pt). El corte de hoja es a 770 pt; la tabla repite encabezado. Sin foto del producto (la celda IMAGEN queda vacía). La imagen de «firma» es la de la plantilla de Obuma, igual en todas las OC.
- (3-nov) Foto del producto en «Ver OC»: sale de Obuma (`producto_imagen_principal` del producto, vía `productos.list?id=<producto_id del ítem>`; enlace público del S3 de Obuma), se descarga al armar el PDF. Sin foto en Obuma o sin cuota de API → celda vacía. Reemplaza lo anotado arriba de «sin foto».
- (4-nov) Asignar una ficha que no trae marca ni modelo (solo código/SKU) ya no se rechaza: el servidor responde `confirmarSinMarca` y la pantalla (`FichasTecnicasCard`) abre un aviso al centro «La ficha no dice la marca ni el modelo» con «Asignar igual» / «Cancelar». Al confirmar se reenvía con `sinMarca` y el nombre del producto hace de modelo. Vale también para «Asignar todas las sugeridas». Sin ver en navegador.

## 2026-11-04 · Fila «Proyecto (adjudicación total, sin detalle de líneas)» trababa la aprobación (2446-240-LE26, negocio 979)
- Origen: `poblarProductosCompraBase` crea esa fila cuando Compras se abre SIN costeo digital ni desglose del acta. Después «Cargar compra al costeo» (`sincronizarProductosConCosteo`) metía los productos reales pero no la sacaba → quedaba «Sin cotizar todavía / Sin elegir» y «Falta elegir proveedor para: Proyecto…» impedía pedir aprobación (y con eso SKU y OC).
- Arreglo: la sincronización ahora borra esa fila si no tiene nada colgando (PENDIENTE, sin renuncia, sin cotización/veredicto/auditoría). Borrada a mano en 979 (id 339; respaldo `scripts/scratch/_2446_respaldo_placeholder.json`). En 1154 se dejó: el equipo ya la había renunciado. Sin ver en navegador.

## 2026-11-04 · Adicionales de una cotización: un adicional escondía otra línea parecida (979, hidrolavadora, cotización AHN 9853 = #266; `ListaCotizaciones.tsx` lineasPendientes; tsc ok, sin ver en navegador)
- Cómo se cargan los accesorios que vienen en la MISMA cotización que el producto (acoples, mangueras): como **adicionales** de ese producto en la cotización (Cotizaciones → abrir la fila → líneas sin asignar → agregar), NO con «Comprar una parte aparte» (eso es para comprar a OTRO proveedor; usar las dos suma el costo dos veces).
- Bug: las líneas «sin asignar» se descartaban si se parecían ≥ 50 % por nombre a CUALQUIER adicional ya agregado → tras agregar «ACOPLE RAPIDO DE BOLA … AHNPROC» desaparecía «ACOPLE RAPIDO MACHO … AHNPROC». Ahora cada adicional tapa una sola línea (la de su mismo precio si hay varias parecidas).
- En 979: hidro (producto 340) en #266 con 3 adicionales por unidad (acople bola 1×6.000, manguera 15 m×5.040, acople macho 1×5.600) = $2.187.200/u, cuadra con el neto del documento. Se crearon y quitaron por error 3 partes aparte (ids 530-532); la 979 no tenía aprobaciones, no se desaprobó nada.
- (mismo día) Las líneas sin asignar ahora salen también en la lista de opciones de cada producto (`ComparadorPrecios`, bajo cada oferta: «Trae además, sin asignar: + línea · cant × precio»); un clic la suma como adicional de ESE producto en esa cotización (`agregarLineaComoAdicional`, compartida con `ListaCotizaciones`). No sale en ofertas reemplazadas por otra del mismo proveedor. Probado con los datos de la #266; sin ver en navegador.
