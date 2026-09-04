# Anexo económico en Excel + ficha técnica desde el link del costeo (04-sep-2026)

Bitácora de lo construido en una sesión, caso real: licitación **2446-249-LE26** (negocio 1011).
Si retomas esto: lee primero este archivo completo, después `git log`/`git status` para saber qué
está commiteado (el usuario sube los commits él mismo).

---

## 1. Anexo económico en Excel (relleno de precio unitario)

**Problema:** el Anexo Creator (`app/lib/anexos-rellenar.ts` + `anexos-precios-ia.ts`) solo sabía
rellenar `.docx`. Cuando el anexo económico del organismo viene como `.xlsx`
(`2-_FORMULARIO_OFERTA_ECONÓMICA.xlsx` en este caso), no había ningún camino — caso más
desfavorable posible, medido en producción.

**Decisión de diseño del usuario:** un motor SEPARADO por formato (Word/PDF/Excel no comparten
una función).

### Bug de fondo, corregido de paso

`obtenerItemsCosteoParaAnexo` (`app/lib/anexos-datos.ts`) nunca leía el costeo VIVO del editor
interno (`negocio_costeo_editor`) — solo `checklist_comercial_costeo.archivo_url` (que es `NULL`
a propósito cuando el costeo se guardó desde el editor) y, si fallaba, un `.xlsx` suelto en
Documentos Propios. Fix: nueva `obtenerItemsCosteoDelEditor()` en `app/lib/costeo-editor.ts`, que
se intenta PRIMERO. Esto beneficia también al motor de Word, no solo al de Excel.

### Qué se construyó

- **`app/lib/anexos-excel-precios.ts`** (motor nuevo): `detectarTablaPrecios` (encabezado por
  regex de texto, tolerante a encabezado duplicado) → `matchearPreciosExcel` (reusa
  `matchearPreciosConIA` de `anexos-precios-ia.ts` TAL CUAL, solo cambia el I/O) →
  `escribirPreciosExcel` (nunca toca celdas de fórmula del organismo).
- **`detectarPie`/`corregirPie`** (mismo archivo): reconoce las filas de Sumatoria/IVA/Total
  Bruto y SIEMPRE reescribe sus fórmulas para que sean consistentes entre sí — nunca inventa un
  monto, solo enlaza bien lo que el documento ya declara.
- **`detectarCamposSueltos`/`matchearCamposSueltos`/`escribirCamposSueltos`**: campos de texto
  fuera de la tabla (hoy: "Plazo de entrega...") resueltos contra el Auditor Técnico
  (`resolverCamposSueltosConAuditor`, ya existía para Word, reusado tal cual).
- **Endpoints:** `GET /api/anexos/analizar-xlsx`, `POST /api/anexos/generar-xlsx` (mismo
  guardarraíl bloqueante `verificarTotalEconomico` que ya usa el camino de Word).
- **UI:** `app/components/AnexoRellenoExcelModal.tsx` (modal nuevo y simple) + botón habilitado
  en `DocumentosSection.tsx` (`esAnexoRellenable`/`handleRellenarAnexo`) sobre `.xlsx/.xlsm` de
  categoría `ANEXOS_ECONOMICOS`.

### Bug REAL encontrado por el usuario probando en vivo (no de este código — de la plantilla del organismo)

La celda "Valor Total Bruto" del formulario real traía `=F9+F13` (primera fila de ítem + IVA) en
vez de `=F12+F13` (Sumatoria + IVA) — con 1 solo ítem nadie lo nota, con 3 el Bruto salía
$4.725.509 en vez de $9.866.409. La Nota 2 del propio formulario dice que ese valor se usa para
evaluar el criterio precio — no era cosmético. Corregido por `corregirPie` (ver arriba).

### Verificación

`tsc` limpio, 899/899 tests en verde en ese momento. Probado extremo a extremo con el archivo
real descargado de R2 y el costeo real del editor: 3/3 productos matchearon, total escrito
$8.291.100 calza exacto con el costeo, pie corregido (`SUM(F9:F11)` / `F12*19%` / `F12+F13`).

### Cómo se usa

Licitación → Documentos → caja "Anexos Económicos" → ícono de varita (🪄) sobre el `.xlsx` → modal
muestra productos con precio propuesto → "Generar" sube `ANEXO_<original>.xlsx` a Documentos
Propios.

### Fuera de alcance (a propósito)

- Firma sobre este Excel (queda para una fase posterior).

---

## 2. Ficha técnica del producto desde el link del costeo

**Problema:** el costeo del editor guarda hasta 3 links por producto (`link1/link2/link3`,
`FilaEditorCosteo`) — antes de esto eran texto puro, sin ningún uso. El usuario pidió evaluar si
se puede sacar de ahí la especificación técnica del producto.

**Medido EN VIVO con los 3 links reales de esta licitación** (no genérico):

| Producto | Tienda | Resultado |
|---|---|---|
| Poste Omega | senaliza.cl (Shopify) | Sin tabla de specs, pero la descripción trae un dato técnico real (espesor 2,5mm) |
| Perno coche | **sodimac.cl** | **10 especificaciones estructuradas** (garantía, material, capacidad de carga, medidas…) vía `__NEXT_DATA__` de la página de PRODUCTO |
| Aluminio compuesto | orbex.cl (Shopify) | Nada aprovechable — descripción de puro marketing |

**Resultado real: 1/3 con tabla, 1/3 con texto útil, 1/3 sin nada — nunca es 100%, depende de la
tienda.** Ninguno de los 3 tenía PDF de ficha del fabricante enlazado.

### Qué se construyó

- **`app/lib/costeo-ficha-producto.ts`**: `extraerFichaDeUrl(url)` — cascada: (1) `__NEXT_DATA__`
  de Sodimac/VTEX-Next (`productData.attributes.specifications`), (2) JSON-LD `schema.org/Product`
  (Shopify u otro) — `additionalProperty` si existe, si no `description` PERO solo si tiene ≥40
  caracteres Y al menos un dígito (medida real) — sin ese segundo filtro, texto de puro marketing
  como el de Orbex (68+ caracteres, sin ningún dato técnico) se hubiera colado igual. (3) si nada
  de eso aporta, `null` — nunca inventa.
  `construirFichaProductoHtml` + `generarFichaProductoPdf` (reusa `generarInformePdf`,
  `app/lib/generar-informe.ts`, el mismo motor Chromium headless que ya usa la ficha PROPIA).
  `slugArchivo` para el nombre del PDF.
- **Endpoint:** `POST /api/negocios/[id]/comercial/costeo-editor/ficha-producto/route.ts` — recibe
  `{detalle, link}` ya elegidos por el frontend, extrae, genera PDF, sube a R2 + INSERT en
  `documentos_cache` (categoría `DOCUMENTOS_PROPIOS`) — a diferencia de
  `comercial/ficha-tecnica/route.ts` (la ficha PROPIA), que NO registra en `documentos_cache`; acá
  sí, porque el usuario pidió explícitamente que aparezca en Documentos Propios.
- **UI:** botón nuevo por FILA en `app/negocios/[id]/CosteoEditorCard.tsx` (ícono `FileSearch`,
  comparte celda con el botón Eliminar, usa el primer link no vacío de la fila). Nuevo patrón de
  loading POR FILA (`Set<string>` de ids en proceso) — no existía antes en ese archivo.

### Verificación

`tsc` limpio, 910/910 tests en verde (11 nuevos). Probado extremo a extremo con los 3 links
reales: 2 PDFs generados de verdad (`%PDF-1.4` válido, 46KB y 56KB), Orbex correctamente sin
generar nada. Los 2 PDFs se revisaron manualmente (el usuario los descargó y comparó el contenido
contra las páginas reales de las tiendas) — confirmado que el contenido es exactamente lo que
publican Sodimac/Senaliza, sin ningún dato de las bases de la licitación mezclado (el módulo solo
importa `generarInformePdf`, ningún acceso a bases/informe/auditor).

### Cómo se usa

Negocio → pestaña Costeo → fila con al menos un link cargado → ícono de lupa/documento junto al
botón Eliminar → genera PDF → sube a Documentos Propios (pestaña Documentos de la LICITACIÓN, no
del negocio) con nombre `FICHA_TECNICA_<producto>.pdf`, agrupado en su propia caja **"Ficha
Técnica"** — dentro de "Documentos Propios" existe un mecanismo de cajas libres por
`documentos_cache.subcategoria` (migración 45, ya usado para arrastrar-y-soltar en
`DocumentosSection.tsx`); el INSERT del endpoint escribe siempre el mismo texto
`'Ficha Técnica'` ahí, así que todas las fichas caen juntas y separadas del costeo/anexos
rellenados (que quedan en "Sin clasificar" si nadie los organizó a mano).

### Limitación honesta, a propósito documentada en cada PDF generado

Es la ficha de la TIENDA, no del FABRICANTE — cada PDF trae un pie explícito: "no reemplaza la
ficha técnica oficial del fabricante", con la URL de origen y la fecha de captura.

### Fuera de alcance (a propósito)

- Headless/Puppeteer para sitios que bloquean SSR — ninguno de los 3 casos reales lo necesitó.
- Seguir un link hasta un PDF de ficha del fabricante (4º paso del diseño original de
  `project_costeo_specs_desde_link_medicion_sep2026`) — no aplicó a ningún caso real medido.
- Integrar el resultado con `checklist_comercial_caracteristicas`/`valorOfertado` del Auditor
  Técnico — decisión pendiente de una investigación anterior, no se tocó.

---

### Bug real reportado por el usuario y corregido (mismo día): WooCommerce sin JSON-LD

Con otra licitación (**1271359-92-LE26**), el usuario reportó "esa página tiene ficha y no me la
encuentra". Causa: 3 de 5 links reales eran WooCommerce (ingequipos.cl, donlocker.cl, calas.cl) —
ninguno emite JSON-LD de tipo `Product` (el plugin SEO solo pone WebPage/Organization/
BreadcrumbList en un `@graph`), así que la cascada original (Sodimac → JSON-LD → null) los
descartaba a todos aunque SÍ tenían datos reales ricos. El dato vivía en `<meta
name="description">` (no en `og:description`, que en el mismo sitio trae un resumen de marketing
distinto y más pobre — y algunas páginas traen DOS `<meta name="description">` duplicados, el
bueno no siempre es el primero), como texto "Clave: valor" línea por línea.

**Fix (`app/lib/costeo-ficha-producto.ts`):**
- Nuevo paso de cascada: `extraerDeMetaTags` — lee TODOS los `<meta name="description">` y
  `<meta property="og:description">` de la página (no solo el primero), y `extraerSpecsDeTexto`
  parsea cada uno por patrón "Clave corta (≤4 palabras): valor" línea por línea — mismo criterio
  de vocabulario acotado que ya usa el resto del proyecto, nunca NLP genérico. Se usa el que
  rinda más specs; si ninguno tiene specs pero alguno pasa el guard de descripción libre, ese.
- Filtro nuevo en `extraerDeJsonLd`: `additionalProperty` de Shopify a veces trae solo metadata de
  catálogo (`Tags`, `Title: "Default Title"`, `Type`, `Vendor`) — caso real playplaza.cl, ninguna
  de esas es una característica física. Se descartan por nombre antes de contarlas como specs
  reales, para que el flujo caiga al siguiente paso en vez de quedarse con basura.

**Resultado tras el fix, mismos 5 links reales:** Locker (ingequipos) → 8 specs reales (antes: 0).
Estante (donlocker) → 1 spec. Bancas (playplaza) → sigue en descripción libre (no tiene ningún
"Clave: valor", solo prosa). Mesas (calas.cl) → sigue sin nada — el dato real está en el CUERPO
del HTML, no en ningún meta tag, fuera de alcance de este fix. Carro tecnológico
(planetaudiovisual.cl) → sigue sin nada, a propósito: el link guardado es una URL de BÚSQUEDA
(`?s=CN-45`), no de producto — nunca va a tener datos individuales, es una limitación real del
link guardado, no del extractor.

`tsc` limpio, 915/915 tests en verde (5 nuevos de regresión). Verificado extremo a extremo con
los 5 links reales de 1271359-92-LE26 y 2 PDFs generados de verdad enviados al usuario.

### Imagen del producto en la ficha (mismo día, pedido explícito del usuario)

Medido en los 7 links reales de ambas licitaciones antes de implementar: **`og:image` está
presente en el 100% de los casos**, incluidos los WooCommerce sin JSON-LD de producto — más
confiable que las especificaciones mismas. Reusa el patrón ya existente en
`comercial/ficha-tecnica/route.ts` (`comoDataUri`): `generarInformePdf` carga el HTML con
`setContent` sin recursos externos, así que la imagen se descarga y se embebe como `data:` URI
antes de generar el PDF.

- **`extraerImagenUrl`**: `og:image` primero (universal), `Product.image` de JSON-LD como
  respaldo (string o array).
- **`descargarImagenComoDataUri`**: mismo patrón que `comoDataUri`, límite 4MB, valida
  `content-type` empiece con `image/`.
- Nuevo caso en la cascada: si no hay ni specs ni descripción pero SÍ hay imagen (caso real:
  Aluminio compuesto de Orbex, que antes daba `null` a secas), la ficha se genera solo con la
  foto — antes se perdía por completo.
- `construirFichaProductoHtml` la muestra centrada con el pie "Imagen referencial" (mismo patrón
  visual que la ficha PROPIA de `ficha-tecnica.ts`).

`tsc` limpio, 926/926 tests en verde (11 nuevos). Verificado extremo a extremo con los 3
productos de 2446-249-LE26: los PDFs ahora traen foto real descargada de la tienda (46KB→87KB
Poste Omega, 56KB→363KB Perno coche, y Aluminio compuesto pasó de "sin generar nada" a un PDF de
131KB solo con la imagen).

## Pendiente (pedido explícito del usuario, no hecho todavía)

- **Medir el generador de anexo económico Excel contra más licitaciones reales** (no solo
  2446-249-LE26) — el usuario lo pidió antes de pivotar a las fichas técnicas, quedó sin hacer.
