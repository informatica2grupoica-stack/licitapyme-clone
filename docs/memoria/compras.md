# Compras

Pantalla principal: `/compras/[negocioId]` (`ComprasChrome.tsx`). Traspasado desde la memoria
personal el 2026-10-27; las fechas son de cuando se decidió.

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
