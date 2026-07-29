# Bitácora — Anexo Creator (relleno automático de anexos de oferente)

Continuidad entre sesiones para el módulo de relleno automático de anexos (.doc/.docx). Objetivo
del usuario, dicho explícito: **generar los anexos que pide Mercado Público de forma automática,
en su totalidad o la gran mayoría, para cualquier licitación** — no solo casos prolijos.

Si retomas esto en otra sesión: lee primero este archivo completo, después mira `git log` y
`git status` para saber qué de lo de acá ya está commiteado/desplegado (el usuario sube los
commits él mismo — nunca asumas que algo está en producción sin confirmarlo).

---

## Arquitectura (todo en `app/lib/anexos-*.ts`)

- **`anexos-docx.ts`** — bajo nivel: abre/guarda el zip, normaliza `w14:paraId`, rellena celdas
  vacías (`rellenarCeldaVacia`) y runs por índice (`rellenarRunPorIndice` — nunca por texto, el
  texto puede repetirse). `insertarImagenEnParrafo()` inserta una imagen REAL (firma escaneada)
  como objeto OOXML embebido (media + relación + content-type + `<w:drawing>`), no un atajo.
- **`anexos-detectar.ts`** — 4 patrones de detección:
  1. Celda vacía junto a etiqueta corta (párrafo N con texto, N+1 vacío).
  1b. **Tablas multi-columna** (specs, evaluación técnica): arma la etiqueta con la celda más
      larga de la fila + nombre de columna del encabezado — sin esto, tablas anchas mostraban el
      valor de OTRA columna como etiqueta (ej. "CO" en vez de la especificación real).
  2. Blanco subrayado inline (`_{4,}` dentro de una oración) — el contexto se arma con TODO el
     párrafo (cruza runs), no solo el run del blanco.
  3. Secciones Persona Natural/Jurídica/UTP — solo se rellena la sección Jurídica.
  4. **Línea de firma** (`detectarLineasFirma`) — raya de 10+ guiones + leyenda que menciona
     "firma", "representante legal" o "persona natural", en el MISMO párrafo o en los 1-2
     siguientes. Se excluye del patrón 2 (no se ofrece texto Y firma para el mismo blanco).
- **`anexos-diccionario.ts`** — 16 campos reales de `empresas` (no solo los básicos), con
  normalización de numeración inicial ("1.1. Razón Social" → "Razón Social"), puntuación final
  colgante, y sufijo opcional "del oferente/de la empresa/del proponente" (`SUFIJO_OFERENTE`).
- **`anexos-ia-matching.ts`** — respaldo IA (GLM, mismo proveedor que viabilidad) para etiquetas
  que el diccionario no resuelve. Manda TODAS las etiquetas sin match en una sola llamada por
  documento. **Cuidado real encontrado en pruebas:** la IA confundía "Ciudad" con el campo
  `region` (una región no es una ciudad) pese a instrucción explícita en contra — se sacó
  `region` de los campos elegibles para IA (el diccionario determinista lo sigue matcheando
  exacto). También: no asumir que un cargo/rol distinto ("Gerente General") es el representante
  legal salvo que la etiqueta lo diga explícito.
- **`anexos-dividir.ts`** — si el documento trae varios "FORMULARIO N°X" pegados, los separa en
  archivos independientes DESPUÉS de rellenar (nunca antes). También agrupa los pendientes por
  formulario en el modal.
- **`anexos-doc-legacy.ts`** — puente al microservicio `conversor-doc/` (VPS) que convierte `.doc`
  legado (Word 97-2003) a `.docx` con LibreOffice headless, vía red interna de docker-compose
  (`http://conversor-doc:8091`), sin exponer puerto público.
- **`anexos-datos.ts`** — puente DB+R2. Sin filtro de categoría MP a propósito (el clasificador a
  veces mete un anexo real fuera de ANEXOS_OFERENTE).
- **`anexos-rellenar.ts`** — orquestador: `analizarAnexoParaUI()` (solo lectura, para el modal,
  con ids ESTABLES basados en índice de aparición — nunca en `paraId`, que es aleatorio entre
  llamadas) y `generarAnexoFinal()` (escribe: 1° blancos inline, 2° celdas diccionario→IA→humano,
  3° firma — ese orden importa, ver comentarios en el código).

**Rutas:** `GET /api/anexos/analizar`, `POST /api/anexos/generar` (sube a R2 + `documentos_cache`
categoría `DOCUMENTOS_PROPIOS`, nombre `ANEXO_<original>` o `ANEXO_<sufijo>_<original>` si se
dividió por formularios).

**UI:** `app/components/AnexoRellenoModal.tsx` — ícono de varita en Documentos (cualquier
`.doc`/`.docx` de la licitación, sin filtro de categoría). Modal ancho: Word real a la izquierda
(visor Office Online), formulario a la derecha, agrupado por formulario cuando aplica, insignia
"IA" en los campos que no vinieron del diccionario exacto.

**Infra (`conversor-doc/`):** microservicio LibreOffice headless en el MISMO docker-compose del
VPS de producción (216.185.51.104, dominio `licitank.cl` detrás de Caddy — **el VPS ES
producción real, Vercel no sirve tráfico de usuarios**). Variables: `CONVERSOR_SECRET` (lo lee el
microservicio) + `DOC_CONVERSOR_URL=http://conversor-doc:8091` / `DOC_CONVERSOR_SECRET` (los lee
la app) — mismo secreto en las tres.

---

## Casos reales usados como golden set (no inventados)

- **Documento con 5 "FORMULARIO N°X" pegados** (`FORMULARIOS_OBLIGATORIOS.doc`, licitación
  4291-38-LP26, `.doc` legado) — validó el divisor y la conversión `.doc`→`.docx`.
- **Anexo de Evaluación Técnica con tabla de specs** (`Anexo_N°5_Evaluacion_Tecnica`) — encontró
  el bug de "CO" como etiqueta, motivó el patrón 1b.
- **20 anexos reales YA PRESENTADOS a Mercado Público**, en `C:\Users\droku\Downloads\comercial
  mp\` y `...\inverciones claro\` (uno por licitación, 5+5 subcarpetas) — usados para comparar
  etiqueta→valor real contra lo que el diccionario producía. Subió de 19 a 37 matches correctos
  tras ampliar sufijos/normalización. Casi todo lo NO reconocido (~692 etiquetas) es
  especificación técnica de producto (marca, modelo, garantía) — NO son datos de empresa, no
  tienen techo de automatización posible con este enfoque.
- **Licitación 564162-64-LE26** (empresa 1, Inversiones Claro) — 5 anexos reales con sus PDFs ya
  presentados en `DOCUMENTOS_PROPIOS` (hechos a mano) como referencia de "cómo se ve terminado".
  Tras arreglar la detección de firma: los 5 pasaron de 0% automático a detectar+insertar firma
  en los 5, uno de ellos (`ANEXO_N°1`) quedó 100% automático.

Documentos de ejemplo usados en pruebas (ids reales en `documentos_cache`, empresa 1 =
Inversiones Claro ARZ SPA, empresa 2 = Comercial MP SpA):
- id 3351 — anexo con etiquetas numeradas ("1.1. Nombre o Razón Social").
- id 18772-18776 — los 5 anexos de 564162-64-LE26.
- id 18441 — `FORMULARIOS_OBLIGATORIOS.doc` de 4291-38-LP26 (.doc legado, 5 formularios).

---

## Bugs reales encontrados y corregidos (no repetir el análisis)

1. Offsets mal calculados en el detector de tablas (posición relativa al grupo capturado, no al
   match completo) — corregido, cubierto con test.
2. `<Relationships/>` autocerrado (documento sin relaciones previas) rompía la inserción de
   imagen porque el código buscaba un `</Relationships>` literal que no existía.
3. Leyenda de firma sin la palabra "firma" ("Nombre Persona Natural o Representante legal...") —
   se amplió el patrón de leyenda.
4. Raya de firma y leyenda en el MISMO run de texto (no runs separados) — reemplazar el run
   entero se comía la leyenda; ahora se separa en dibujo + run de texto nuevo con la leyenda.
5. (Bug de un script de prueba, no de la app real) Al armar un demo para mandar al usuario, se
   olvidó llamar `guardarDocx()`/`zip.file('word/document.xml', ...)` antes de generar el buffer
   final — el archivo enviado no tenía el `<w:drawing>` aunque la imagen SÍ estaba en el zip. La
   ruta real (`generarAnexoFinal`) sí lo hace bien — confirmado leyendo el código.

---

## Estado de despliegue (verificar con `git log`/`git status` al retomar)

- **Ya confirmado funcionando en producción (VPS):** conversor-doc desplegado y probado
  (`docker compose exec app node -e "fetch('http://conversor-doc:8091/salud')..."` → `ok`),
  detección .doc funcionando desde la app real.
- **Construido y probado localmente, pendiente de que el usuario suba/despliegue:** diccionario
  ampliado + normalización, respaldo IA, detector de tablas, divisor de formularios, visor lado a
  lado, inserción de firma real. Todo compila limpio (`npx tsc --noEmit -p .`) y tiene pruebas
  contra datos reales (no sintéticas cuando fue posible) al momento de escribir esto.
- El usuario sube los commits él mismo (ver memoria `feedback_workflow_git_usuario`) — no ofrecer
  hacerlo, solo mostrar `git status` con el resumen de qué cambió cada archivo.

## Pendiente / próximos pasos posibles

- Confirmar visualmente (el usuario, no se puede verificar sin sus credenciales de login) que la
  firma se ve bien insertada en el documento real, una vez desplegado.
- La ambigüedad de "RUT" bare (a veces es de la empresa, a veces del representante, según
  contexto/posición) sigue sin resolver — es pre-existente, no introducida en esta ronda. Requiere
  awareness posicional/de sección, no un fix de una línea.
- No se ha construido: usar `logo_url`/`timbre_url` (el usuario dijo explícitamente que el logo
  no hace falta para esto — solo la firma, que ya está).
- Sin explorar aún: si vale la pena expandir el detector de tabla (1b) para manejar tablas con
  encabezados de 2 filas (headers combinados/mergeados) — se simplificó a propósito para evitar
  nombres de columna incorrectos en casos complejos.
