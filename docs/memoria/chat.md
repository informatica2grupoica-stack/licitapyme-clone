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

**Verificado (solo lectura sobre la BD del VPS):** `scripts/scratch/_chat_probar_alcance.mts` — cliente 1 ve 1.710
negocios y el cliente 2 solo sus 14; tabla ajena, coma-join y tabla global de ICA rechazadas para otra empresa;
documentos del cliente 2 = solo los oficiales. `_chat_probar_respuesta.mts` — respuestas reales con modelo
(~10 s) en negocios y compras, ICA y cliente 2. `tsc` limpio.
**NO verificado:** la burbuja en el navegador (requiere sesión) ni un usuario real de otra empresa con el módulo
activado; no se activó `ia_chat` a ningún cliente. Sin desplegar.
