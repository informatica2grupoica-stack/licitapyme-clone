# Chat IA (ankIA): burbuja, un chat por menú y chat general

## 2026-11-17 — Un chatbot por menú, general solo en Dashboard, separado por empresa

**Decisión del dueño:** el chat general (todas las licitaciones) vive SOLO en el Dashboard; cada otro menú
(Negocios, Aprobaciones, Postuladas, Ganadas/Perdidas, Compras, Proyectos, OC, Entregas, Proveedores, Fleteros,
Radar, Buscador, Puente, Analizadas, Descartadas, Análisis, Historial, Mi empresa, Gasto de IA, Errores) tiene
el suyo, con los datos de ese menú. Dentro de una licitación (`/negocios/<id>`, `/licitacion/<código>`) sigue el
chat de esa licitación (documentos + análisis). Un menú sin chat propio no muestra la burbuja. Responde como
persona del equipo (español chileno, ankIA), no como robot. «Consulta a la IA» es un ADICIONAL para otras
empresas: no viene de inicio.

**Dónde está:**
- `app/lib/chat-secciones.ts` — registro de secciones (ruta, tablas, qué mira, preguntas de ejemplo). Agregar un
  menú = una entrada ahí.
- `app/lib/chat-global.ts` — motor SELECT de solo lectura. Las secciones arman su esquema desde la base real
  (`INFORMATION_SCHEMA`), sin columnas sensibles (`usuarios` solo como vista reducida). Cada tabla se lee ya
  filtrada: por empresa (`cliente_id`, o `negocio_id` → negocios de la empresa) y, en perfiles normales, solo lo
  asignado a ellos. Tabla que no se puede separar por empresa → no se entrega a ninguna empresa-cliente.
- `app/api/chat-seccion/route.ts` (permiso `chat_licitacion`), `chat-global` (permiso `chat_global`, solo
  Dashboard), `chat-proyecto` y `licitacion/[codigo]/chat` (por licitación).
- `app/components/ChatFlotante.tsx` — burbuja con licitank-ui (teal, atajos de preguntas por menú, tablas y
  negritas sin HTML crudo, esqueleto mientras piensa, Ctrl+J).

**Motor (2026-11-17, decisión del dueño):** TODOS los chatbots (burbuja, por menú, general, documentos, por licitación y el análisis por documento de `analizar-documento`) corren en Kimi K2.6 sin razonar (`kimi_rapido`, la versión más barata y estable que hay) y, si falla, en GLM (`glm-4.7` y su escalera; sin DeepSeek ni Gemini). Todo pasa por `app/lib/chat-ia.ts` (`crearChatIAChatbot`). Medido en 1000-12-LP26 (55k tokens de documentos): Kimi K2.6 $0,056 y 37 s contra GLM-4.7 $0,031 y 20 s; en consultas SQL por menú 3-7 s por llamada y ~$0,003. Kimi copia el marcador [[DOCUMENTO]] al citar: se le pidió citar como (nombre, pág. N).

**Multiempresa:** módulo `ia_chat` ahora está en `MODULOS_ACTIVABLES` (adicional). Cubre solo los chats; las otras
rutas de IA que colgaban de él (`licitacion-ia`, `licitacion-preguntas`, `analizar-documento`,
`buscar-productos`) pasaron a «interno» (solo ICA) porque leen sin separar por empresa. El chat de cada menú
exige además el módulo de ese menú. Historial por licitación de otra empresa va con sesión `c<N>:corpus`;
documentos con `filtroDocsVisibles`; contexto cacheado bajo `codigoAlmacenDocs`. A otra empresa se le entrega SU viabilidad (`cliente_viabilidad` y `_v4`, no la v4 de ICA) y `es_nuestra` se recalcula con los RUT de SU tabla `empresas` (en el chat de la licitación y en las consultas SQL; ICA conserva la columna grabada: 162 de 1.238 ofertas; el cliente 2 sale en 0). Los conteos de «cobertura» del chat general son solo ICA.
**Falta para otras empresas:** nada conocido en los chats; probar con un usuario real de otra empresa con `ia_chat` activado.

**Hora de cierre (2026-11-17, visto en licitank.cl):** el chat de la licitación decía 21:43 cuando la base tiene 18:43 (hora de Chile): `JSON.stringify` pasaba las fechas a UTC con «Z» y el modelo las leía tal cual (3 h de más). Ahora las fechas llegan al modelo como «AAAA-MM-DD HH:mm:ss» en hora de Chile (`jsonHoraChile` en `chat-licitacion.ts`, usado también por el chat SQL). Verificado contra 1410-37-LE26; falta desplegar.

**Cobertura de datos (2026-11-17, revisión):** se sumaron a los chats por menú las tablas que ninguno veía (checklist y auditor, costeo guardado, cotizaciones por ítem, tipo de cambio, asignaciones, apertura, documentos y garantías de las ofertas). Siguen fuera a propósito: tablas técnicas, de sesión, firmas y el ruido del Auditor (eventos, capturas, respaldos). **Huecos de datos (no del chat):** 215 documentos sin texto en negocios en curso/postulados/ganados (1.968 contando todos los activos); 5.618 licitaciones adjudicadas sin su adjudicación guardada (solo 521); ofertas de la competencia en solo 164 licitaciones y 188 negocios postulados/ganados/perdidos sin ofertas; 155 negocios activos sin viabilidad; solo 17.170 de 30.636 documentos tienen texto. Kimi mezcla voseo/vosotros: los prompts piden «tú».

**Chat General = toda la aplicación (2026-11-17, pedido del dueño):** se llama «General» (no «Dashboard») y vive solo en el Dashboard. Una llamada corta de Kimi elige los menús que toca la pregunta (`elegirMenus` en `chat-global.ts`) y se suman sus tablas a las 13 base; todo pasa por los mismos filtros de empresa y de perfil. Probado cruzando Compras y Órdenes de compra. También: botón para borrar la conversación (DELETE en las 3 rutas; borra solo los turnos de quien la borra, la de la licitación es compartida) y «Preguntas rápidas» siempre disponibles en el pie de la burbuja.

**Robustez del SQL del chat (2026-11-17, visto en licitank.cl):** «OC sin pagar» falló dos veces por columna inventada y, ya con 3 intentos, respondió «no hay» por un INNER JOIN con IS NULL (0 filas; la respuesta correcta son 28 OC). Ahora: 3 intentos; tras un error de columna se le muestran las columnas reales; un resultado de 0 filas se revisa una vez antes de decir «no hay» (pista: «sin X» = LEFT JOIN + IS NULL); la cobertura de la base solo se adjunta si la consulta toca documentos/adjudicaciones/ofertas/licitaciones. Falta desplegar y repetir en el sitio.

**Revisión del chat en producción (2026-11-17/18):** (1) la OC folio 815 de 2022 ($119 M, solo en `compras_historial_oc`, sin negocio) salía multiplicada por todos los negocios por un JOIN inventado: pistas de relaciones de OC + guarda que revisa un resultado de filas casi idénticas; (2) BUG PROPIO: el reemplazo de tablas por subconsultas filtradas tomaba el comienzo de otra tabla (compras_entrega → compras_entrega_punto) y rompía el SQL de Entregas: ahora el nombre debe terminar ahí; (3) Descartadas no veía los motivos (están en `negocios.descarte_motivo`; `licitaciones_descartadas.motivo` está vacío): nota en la sección; (4) lectura de ofertas: el poller solo leía negocios en POSTULADA/POSIBLE_ADJ; ahora también PERDIDA/ADJUDICADA (99 licitaciones bloqueadas por 403 del portal MP desde un PC; las lee el servidor); (5) documentos: +558 leídos gratis, +10 con OCR; lectura de propios con `scripts/scratch/_sanar_propios.mts`. Falta desplegar (2)-(4) y repetir la prueba de los 19 menús en el sitio.

**Verificado (solo lectura sobre la BD del VPS):** `scripts/scratch/_chat_probar_alcance.mts` — cliente 1 ve 1.710
negocios y el cliente 2 solo sus 14; tabla ajena, coma-join y tabla global de ICA rechazadas para otra empresa;
documentos del cliente 2 = solo los oficiales. `_chat_probar_respuesta.mts` — respuestas reales con modelo
(~10 s) en negocios y compras, ICA y cliente 2. `tsc` limpio.
**NO verificado:** la burbuja en el navegador (requiere sesión) ni un usuario real de otra empresa con el módulo
activado; no se activó `ia_chat` a ningún cliente. Sin desplegar.

**Respuestas cortas + vigentes + huecos de datos (2026-11-17, continuación):**
- Prompts (`chat-global.ts`): «carga de trabajo» cuenta solo negocios VIGENTES (ASIGNADO…POSIBLE_ADJ) y lo dice; respuestas de máx. ~150 palabras, top 10 + total + «¿quieres el listado completo?»; si hay tabla no se repite en prosa; nunca «registros/filas». Medido: «negocios por persona y etapa» bajó de 302 a 155-221 palabras (con tabla), ~18-23 s. En 1 de 3 corridas el SQL no agrupó por persona (variación de Kimi, no del cambio).
- Ofertas de la competencia (`ofertas-competencia.ts`): el poller ahora lee también negocios POSIBLE_ADJ/PERDIDA/ADJUDICADA (antes solo POSTULADA → 188 sin ofertas). El aviso al perfil sigue solo para postuladas. Desde el PC se leyeron 12 de 111; las otras 99 dan 403 (MP bloquea IP), quedaron con 1 intento sumado (tope 6) y las lee el servidor **cuando se despliegue**.
- Texto de documentos: OCR de escaneados en negocios (`_sanar_ocr_salida.txt`, 10 recuperados de 20; los 10 restantes son Word/Excel rotos, logos o QR). Documentos propios (anexos rellenados, OC), que el saneador normal excluye, con `scripts/scratch/_sanar_propios.mts --aplicar --con-ocr` (1.260 pendientes).
- **Falta:** desplegar y repetir en licitank.cl las preguntas por menú (no se probó en el sitio).

**Prueba en licitank.cl con el dueño (2026-11-17 tarde, tras desplegar `fb49ba9`):** se compararon las cifras del chat de cada menú con las de su pantalla. Fallaban y se corrigieron en local (**falta desplegar**):
- Compras: decía «162 pendientes, ninguno vencido» (contaba el pipeline de licitaciones). Ahora compra = `compras_asignacion` (abierta = `cierre_legado IS NULL AND precompra = 0`) → 43, igual que la pantalla, y 38 con tareas vencidas. La «entrega vencida» se calcula en la pantalla y no está en la base: responde con tareas atrasadas.
- Ganadas/Perdidas: 72/221 «este año» → nota con la regla de la pantalla (LEFT JOIN `adjudicacion_cache`, `es_adjudicada = 1` o sin caché) → 74/201. «Quién nos ganó»: decía que no había dato; el ganador está en `adjudicacion_cache.lineas[i].proveedor` (JSON, MySQL 5.7 → UNION ALL de `$[0..9]`). Funciona, pero tarda ~86 s.
- Postuladas: 39 → 41 en evaluación (la pantalla suma negocios marcados PERDIDA que Mercado Público aún no adjudica).
- Órdenes de compra: 282 «último año» y «nuestras = emitidas a proveedores» → nota: `ordenes_compra` = OC de los organismos, pantalla = `es_nuestra = 1` → 267 / $5.413.588.493; las nuestras a proveedores son `compras_orden_compra_obuma` (28 sin pagar).
- General: «cuántos negocios por persona» mostraba ids o «24 negocios» (filas) → una fila por persona con total, nombre por JOIN → 9 personas, 162.
- Kimi vosea pese al prompt y escapa el peso (`\$`): `tutear()` en `chat-global.ts` corrige el texto final.
- Las notas por menú van en `notas` de `chat-secciones.ts`, con la cifra de la pantalla al 17-nov como referencia.
**Ofertas:** el poller del servidor (cron `:15` cada hora) no había leído ninguna de las 101 perdidas/ganadas pendientes a las 13:30 pese a estar desplegado (`8ec2955`); quedaron con 1 intento (el del PC). Revisar el log del scheduler en el VPS.
**Documentos propios:** OCR/lectura terminó: 1.081 de 1.092 recuperados; 11 fallan (PDF «OC_…_experiencia» de 986278-14-LE26).

**Segunda pasada en licitank.cl (2026-11-17, tras desplegar los arreglos):** Compras (43 / 38 con tareas vencidas), Postuladas (41) y la carga por persona coinciden con la pantalla. Hallazgos nuevos, corregidos en local (**falta desplegar**): (1) el historial de la conversación arrastraba cifras viejas equivocadas («162 compras») → el prompt ahora le dice que NO las copie y recalcule; (2) la llamada que arma el SQL tenía tope de 1.500 tokens y preguntas compuestas («ganamos, perdimos y quién nos ganó») se cortaban → «El modelo no devolvió JSON»; tope a 3.000 y nota de usar UNION corto (i = 0..4). «Quién nos ganó» sigue tardando ~106 s (SQL largo + reintentos): pendiente acortar. Poller de ofertas: a las 14:00 aún sin leer ninguna de las 101 pendientes → mirar log del scheduler en el VPS.

### Tercera pasada en licitank.cl (17-nov)
- Pregunta compuesta «ganamos, perdimos y quién nos ganó» ya responde (tope 3000 tokens desplegado, ~40 s), con ranking de competidores (Veloso Oliva 11).
- **Corregido (17-nov, sin desplegar):** nota con consulta exacta de conteo + UNION ALL; local da 74/201 con ranking. Antes dio 65 ganadas / 205 perdidas; la pantalla /adjudicadas da 74 / 201. En la pregunta simple sí coincide. Al mezclar conteo + competidores el modelo no sigue la nota de ADJUDICADA/PERDIDA con LEFT JOIN adjudicacion_cache. Idea: separar la pregunta en dos consultas o forzar el conteo con una consulta fija.
- **Verificado en licitank.cl (17-nov, tras deploy):** pregunta compuesta Ganadas/Perdidas = 74 / 201 + ranking (Veloso Oliva 11), igual que la pantalla. Compras = 18 abiertas / 14 con tareas atrasadas, igual que la pantalla de hoy (antes 43/38; hubo cierres). Sin «162» copiado del historial.
- **Verificado en licitank.cl (17-nov):** Órdenes de compra = 269 / $5.524.332.772 (igual a la pantalla). General: carga por persona suma 162 con nombres; «OC a proveedores sin pagar» = 30 (antes 28), con negocio y monto. Detalle menor: en OC, el chat explicó mal que es_nuestra=1 son las que emitimos a proveedores (son las de organismos); venía arrastrado del historial.
- **Poller de ofertas (17-nov, ~16h):** el servidor sí lee ahora, ~10 por hora (12 a las 15h). Pendientes bajaron de 101 a 42 (18 ADJUDICADA, 22 PERDIDA, 1 REVOCADA, 1 DESCARTADA); negocios sin ofertas 180 → 158. Terminaría en ~4 h si sigue el ritmo.
- **Voseo/aclaraciones + «emitimos a proveedores» (17-nov, sin desplegar; la aclaración se inyecta en el paso de redacción cuando el SQL usa ordenes_compra):** el chat de OC respondió «Te referís…» y preguntó en vez de responder. Ahora: prompt «no hagas preguntas de aclaración si hay suposición razonable», no mostrar nombres de columnas (es_nuestra), ordenes_compra = OC de organismos (no emitidas por nosotros), y `tutear()` suma referís/entendés/ponés/sos/avisás/cruzás/filtrás. Local: «desde 2023 hasta 2026».
