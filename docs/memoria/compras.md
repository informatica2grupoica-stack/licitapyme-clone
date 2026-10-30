# Compras

Pantalla principal: `/compras/[negocioId]` (`ComprasChrome.tsx`). Traspasado desde la memoria
personal el 2026-10-27; las fechas son de cuando se decidió.

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
