# Interfaz compartida

Traspasado desde la memoria personal el 2026-10-27; las fechas son de cuando se decidió.

## Decisiones vigentes del dueño

- **Filtros por URL en Negocios y Radar (2026-11-20, pedido del dueño):** `/negocios?estado=PERDIDA` (ids de etapa
  separados por coma, solo los que existen), `&analista=correo` (coma), `&vista=lista|semana|calendario` (con `estado` y
  sin `vista` abre en lista: el calendario esconde las resueltas); `/radar?gestion=sin_asignar|asignadas|descartadas|
  no_leidas|excluidas_pref|todas`, `?decision=PASA|REVISION_HUMANA|EXCLUIDO` (sin `gestion` = `todas`, que cuenta
  descartadas y asignadas como el Dashboard). Si la URL trae filtros, mandan sobre lo guardado en sessionStorage y se
  parte de cero (en el radar sin filtro de estado ni de tipo = mismo universo que el Dashboard). Enlaces en el
  Dashboard: «Sin asignar» → radar sin asignar; «Pasan el prefiltro» y cada fila de «Prefiltro automático» → radar
  por decisión; «Negocios por etapa» → «Ver <etapa> en Negocios»; cada persona → «Ver sus negocios» (con la etapa si
  hay). Cuadra con la BD local: negocios Perdida 212, Consuelo+Perdida 39, radar sin asignar 17, radar PASA 34.
  **Hallazgo:** «Pasan el prefiltro» (34 dev; 298 prod) incluye las descartadas y asignadas después (en prod solo 67
  de 298 siguen libres): el texto decía «sin ser descartadas», falso → corregido el texto y se avisa en la ficha.
  «Sin asignar» puede salir unas pocas menos en el Dashboard que en el radar (el radar lista las Revocada). Visto en
  navegador a 1366 px. Sin ver: 800 px, modo oscuro.
- **`/dashboard` y `/postuladas` dados por realizados por el dueño (2026-11-20):** cifras revisadas contra la BD y
  front con licitank-ui; no volver a rediseñarlos sin que lo pida. Siguiente: decidir si Negocios y Radar leen
  filtros de la URL (para que los clics del dashboard lleven a la lista ya filtrada).
- **Dashboards interactivos (2026-11-20, pedido del dueño)** — regla agregada a la skill `licitank-ui` («Dashboards y
  gráficos: interactivos y exactos»). Hecho en `/dashboard`: `Dona` con hover cruzado (tajada ↔ leyenda, el centro
  muestra el valor) y clic opcional; «Negocios por etapa» elegible (clic filtra, las demás se atenúan) y filtra
  «Seguimiento por perfil» (quién tiene esa etapa; chip con X para quitar); cada persona se abre y muestra su
  reparto por etapa (clic en una etapa = filtra). En `AnaliticaGestion`: clic en una persona del «Por analista»
  filtra TODO el tablero; si el filtro inicial «en trabajo» deja 0 se explica y hay botón «Ver las N vigentes».
  **Cifra corregida:** «Postuladas por sub-estado» metía Desierta/Revocada en «Cerrada sin apertura» / «Con apertura,
  sin marcar» → sub-estado propio «Desierta / revocada» (19 en dev = 10 revocadas + 9 desiertas, suma 331); la API
  manda `adjEstado` (texto de `adjudicacion_cache.estado`, el mismo de Postuladas). Visto en navegador a 1366 px.
  No hay navegación con filtros a `/negocios` ni `/radar` desde los gráficos: esas pantallas no leen parámetros de la
  URL (si se quiere «clic en etapa → Negocios filtrado», hay que enseñarles `?estado=`).

- **licitank-ui aplicada a `/dashboard` + revisión de cifras** (2026-11-20, pedido del dueño: «datos exactos, nada errado
  ni inventado»). OJO: el Dashboard real es `app/dashboard/page.tsx`; `app/page.tsx` es el **Buscador** (en la primera
  lista lo rotulé mal). Front: `Encabezado`, `Indicador` (ahora con `info` = ficha «cómo se calcula» y `href`), `Dona`
  nueva en `kit/Dona.tsx` (torta con título que dice qué mide, total al centro, leyenda con cantidad y %), barras con
  cantidad y %, MAYÚSCULAS y `font-black` fuera de `AnaliticaGestion`, `@container`, estados con punto. Se quitaron 2
  gráficos que repetían datos («Negocios en trabajo» torta = «Negocios por etapa» barras; torta «Asignadas por perfil» =
  «Seguimiento por perfil»). **Cifras corregidas:** (1) «Distribución de viabilidad» solo contaba el semáforo antiguo:
  en producción 29 de 71 analizadas eran solo v4 y no salían → ahora manda `nivel_atractivo` y cae al semáforo
  («escala anterior»); (2) «Negocios en trabajo» incluía ganados, perdidos, desiertos y revocados → se llama «Negocios
  por etapa» y lo dice; (3) «Próximos cierres» del usuario contaba las 6 filas del listado (máx. 6) → total real
  (`proximosCierresTotal`; dev 13, prod 26); (4) días al cierre con `Math.ceil` («1d» cuando cierra hoy) → días de
  calendario de Chile («Hoy», «Mañana», «Jueves 24»); (5) tendencia omitía los días sin detecciones → 14 días completos
  con 0; (6) montos «$3.0B» → «$3.011 MM»; (7) **analítica**: «Éxito competitivo» daba 25 % (71 de 284) porque contaba
  Desierta/Revocada como perdidas y no respetaba la readjudicación manual → ahora 27 % (72 de 264) y «Monto neto real»
  $1.930.227.812, IGUAL que Postuladas (regla del dueño: Desierta/Revocada no entran a la efectividad). Buscador
  (`app/page.tsx`): se quitaron «850 organismos» y «118.000+ proveedores», cifras escritas a mano que nadie calculaba.
  Verificado contra la BD con `scripts/scratch/_dashboard_cifras.mjs` (solo lectura; 2º argumento `dev` = BD Docker :3308,
  la que usa el servidor local; sin él = VPS por túnel 3307): radar 174, sin asignar 17, usuarios 72/84, prefiltro
  34/116/23, negocios por etapa (suma 484) y viabilidad 13 coinciden. Visto en navegador a 1366 px, claro. Sin ver:
  800 px, modo oscuro, vista de usuario no admin. **Pendiente:** el bloque «Pipeline y desempeño» de `AnaliticaGestion`
  arranca con filtro «Estado 5» preseleccionado y muestra 0 / $0 (confunde); sus sub-estados ahora cuentan Desierta/
  Revocada dentro de «Cerrada sin apertura / Con apertura sin marcar» (falta un sub-estado propio); `AnaliticaGestion`
  sigue sin rediseño completo; colores de etapa (`pipeline.ts`) siguen con morado/índigo; el desarrollo local usa datos
  de prueba (63 de 72 «usuarios activos» son @sim/@licitank.test) — en producción son 9 de 21.

- **licitank-ui aplicada a `/postuladas`** (2026-11-20, pedido del dueño: probar la skill nueva en una pantalla de uso
  diario). Solo lo visual en `app/postuladas/page.tsx`, misma API, filtros y lógica. Encabezado con `Encabezado`
  (Exportar + buscador h-9); KPIs con `Indicador` dentro de `Lista` (4 + los de desierta/revocada/suspendida solo si
  hay); resultado como `Pestanas` con contador (pierden el color por pestaña); filtros con `Boton`, rótulos sin
  MAYÚSCULAS, filtros activos como chips neutros (punto de color donde significa algo). Tarjeta de cada postulada:
  sin barra de color lateral, sin cajas dentro de cajas, estado/apertura/fechas como texto con punto o ícono gris,
  «Nosotros» en verde sin MAYÚSCULAS, datos con `Dato`, formulario de edición con campos h-9 y «Guardar cambios /
  Guardando…», documentos propios como filas, índigo/violeta → teal, `font-bold/black` → `font-semibold`, se quitó el
  `<style>` con `pp-pulse` y degradados, carga con `TarjetaCargando`, vacío con `Vacio`, error con `Banner`, grillas
  por `@container`. `tsc` sin errores nuevos; eslint sin avisos nuevos (quedan los `any` y `set-state-in-effect` que
  ya existían). Falta que el dueño la apruebe. Siguiente candidata: Dashboard.
  **Ajuste (2026-11-20, el dueño vio capturas):** las líneas de tendencia dentro de los indicadores se sacaron
  («no sacamos nada de poner un gráfico si no se entiende a qué se refiere»). Ahora arriba va una **torta** con
  título «Resultado de las N postuladas», efectividad al centro, leyenda con cantidad y % y nota de cómo se calcula;
  la leyenda filtra la lista como las pestañas; a la derecha 4 indicadores (Ganadas, Perdidas, En evaluación, Monto
  ganado). Regla: todo gráfico lleva título que diga qué mide, leyenda con números y una línea de cómo se calcula.
  Fila de la tarjeta: resultado bajo el título, fechas a la derecha, monto con línea separadora, organismo solo si
  existe; detalle sin datos vacíos y con barra «oferta frente al presupuesto». **Visto en navegador** (panel de
  Claude, sesión del dueño) a 1366 y 800 px, modo claro, sin errores de consola; modo oscuro sin ver.

- **Skill licitank-ui ampliada + Figma** (2026-11-20, pedido del dueño): se agregaron formularios, tablas, avisos,
  textos y formatos chilenos, accesibilidad, escalas fijas de espacios/esquinas/íconos y un ejemplo antes/después;
  se resolvieron contradicciones (bento con `@container`, cuándo `rounded-xl` vs `2xl`, maqueta solo para pantallas
  nuevas). Roboto ahora carga 600 en `app/layout.tsx`; `--color-primary` (sin usos) pasó de índigo a teal.
  Figma «LICITANK — Sistema de diseño»: https://www.figma.com/design/2cFgWOJU5Ww4j9bnvFbngd (componentes solo
  en claro por el plan Starter). No visto en navegador.

- **licitank-ui aplicada a `/aprobaciones`** (2026-11-13, pedido del dueño: «poco intuitivo para aprobar lo que mandan
  Negocios o Compras»). Solo lo visual, misma API y mismas acciones. Tarjeta de licitación
  (`TarjetaNegocioAprobacion.tsx`): arriba dice «Falta tu visto bueno en Técnico/Comercial»; los bloques son filas
  (el listo primero, con Rechazar + Aprobar teal); el bloque que aún prepara el asistente queda sin botones
  (antes salían grises deshabilitados); «Aprobar técnico y comercial» solo si los DOS están listos (con uno era
  el mismo botón repetido); cierre en días de calendario («Cierra el lunes 17») con punto de color.
  Compras (`ItemAprobacionCompras.tsx`): tipo = ícono gris + texto, cada fila dice dónde se aprueba, botón teal
  «Revisar y aprobar en Compras». Página: `Encabezado`, 4 cuadros que hacen de pestañas (se quitó la fila de
  pestañas repetida), filtros de cierre «Urgentes / Cierran pronto / Con tiempo» (antes Rojo/Amarillo/Verde),
  carga con esqueleto, vacíos con `Vacio`. Sin índigo/violeta. `tsc` ok; visto en localhost:3000 el 16-nov (BD Docker :3308) en claro y oscuro, sin pulsar
  aprobar/rechazar. Falta que el dueño lo apruebe. Detalle: la causal «el bloque comercial no tiene aprobación vigente…
  apruebe en /aprobaciones» sale en la misma bandeja (texto del backend, `semaforo-auditor.ts`); queda redundante ahí.
- **`/aprobaciones` con información de qué se trata** (2026-11-16, pedido del dueño: «que entregue información relevante»).
  Cada tarjeta trae una franja de 4 datos (`@container`, 2 o 4 columnas): Licitación = presupuesto publicado
  (`negocios.licitacion_monto`), nuestra oferta con barra contra el presupuesto (rojo si se pasa), cierre con fecha y
  hora, quién lo prepara; Compras = presupuesto, cuántas cosas y de qué tipo, quién lo manda, cuánto espera. El bloque
  listo lista sus puntos (título + valor, `puntos` nuevo en `GET /api/aprobaciones`, solo lectura); el que aún prepara
  el asistente no los muestra. Se ocultan en la tarjeta las causales `BLOQUE_*_SIN_APROBAR` (se resuelven ahí mismo).
  Compras: «Bajo el presupuesto 20,5 %» en vez de «Sobre el presupuesto −20,5 %» (`compras-bandeja-aprobacion.ts`).
  Visto en localhost a 800 y 1366 px, claro y oscuro; sin pulsar aprobar. Falta que el dueño lo apruebe.

- **Barra de gestión del negocio en vez de columna derecha** (2026-11-09, pedido del dueño): en `/negocios/[id]`
  la columna de Estado/Responsable/Historial pasó a una franja fija (`sticky`) bajo el título, con
  `GestionAside variante="barra"`: Estado (se abre hacia abajo), En proceso, Descartar, Responsable
  (clic = Reasignar, admin), Cierre, semáforo «N días sin cambios» (punto, sin animación), Fechas
  (Asignación/Publicación/Cierre), N archivos (lleva a Documentos), Historial y menú ⋯. **Historial** = panel
  que se desliza desde la derecha (Esc / clic fuera cierran). **«Productos a costeo» escondido** con
  `MOSTRAR_PRODUCTOS_COSTEO = false` en `GestionAside.tsx` (código y API intactos). `/licitacion/[codigo]`
  sigue con la columna (`variante="columna"`, por defecto). Las «Líneas de negocio» ya no salen en la barra
  (siguen en el Resumen). Timeline del historial sin pastillas. `tsc` limpio; NO visto en navegador (login).

- **licitank-ui aplicada a Compras → «Seguimiento · Comparativo»** (2026-11-05, pedido del dueño):
  `ResumenComparativoCard.tsx` y el modal `CompararOcModal.tsx`, solo lo visual. Detalle en `compras.md`.
  Visto en localhost con 1154, en modo claro y oscuro; falta que el dueño lo apruebe.

- **Menú lateral ordenado por etapa** (2026-10-28, pedido del dueño antes de sumar más módulos):
  PRINCIPAL (Dashboard, Negocios, Aprobaciones, Postuladas, Ganadas/Perdidas) → EJECUCIÓN (Compras,
  Proyectos (Obuma), Órdenes de compra, Entregas, Proveedores, Fleteros) → OPORTUNIDADES (Radar,
  Buscador, Puente, Analizadas, Descartadas) → ANÁLISIS (Análisis de licitación, Memoria, Historial)
  → MI EMPRESA (Perfil, Empresas, Mi equipo, Líneas negocio, Reglas de la IA) → ADMINISTRACIÓN
  (Usuarios, Empresas-cliente, Errores reportados, Gasto de IA) → SOPORTE (Mis reportes de error).
  El dueño eligió el nombre «PRINCIPAL» para el primer grupo, lo de venta primero y ejecución justo
  después. Solo cambió el orden y los grupos (`NAV_GROUPS` en `AppLayout.tsx`); permisos y nombres
  de cada entrada iguales. Lo nuevo que se agregue va al grupo de su etapa.
  Verificado: `tsc` sin errores; NO visto en navegador (pedía login).

- **Sistema de diseño `licitank-ui`** (2026-10-28): el dueño pidió una skill única para que todo el
  SaaS se vea moderno y profesional (tipografía, animaciones y tarjetas modernas) sin aspecto IA, y
  aplicarla pantalla por pantalla. Vive en `.claude/skills/licitank-ui/` (reemplaza a
  `ui-sin-aspecto-ia`), los componentes en `app/components/ui/kit/`, los tokens en `globals.css` y
  la referencia viva en `/ui-kit`. Primera pantalla aplicada: Resumen del negocio
  (`ResumenNegocio.tsx`), solo lo visual.
- **El dueño quiere «más moderno», no sobrio** (2026-10-28): rechazó la primera versión del Resumen
  (texto con puntos, todo gris: «no me gusta nada») y eligió una **grilla bento**: viabilidad grande
  con medidor de 7 tramos, oferta vs. presupuesto con barra que se llena (% y margen al tope),
  cierre y adjudicación/productos en bloques chicos con ícono en cuadro suave, `rounded-2xl`.
  El texto repetido (resumen = motivo de exclusión) se muestra una sola vez. Ese es el estilo a
  seguir en las demás pantallas.
- **Resumen completo reordenado** (2026-10-28, pedido «optimizar espacios, se ve plano»): bento arriba;
  luego descripción + bases a la izquierda (2/3) y recorrido en columna lateral fija (1/3); los
  paneles de datos en columnas que se rellenan (`columns`, sin huecos). Las líneas de negocio van al
  pie de la descripción. `FichaMPBases` pasó a UNA tarjeta con pestañas (Plazos como línea de tiempo
  con el próximo hito marcado, Criterios con barra de ponderación) — también cambia en el Resumen de
  `/licitacion/[codigo]`, que usa el mismo componente.
- **Encabezado y menú del negocio** (2026-10-28, aprobado seguir): encabezado con código, tipo y estado MP
  como texto con punto, título 22–24 px y organismo sin MAYÚSCULAS forzadas; aviso «Este negocio ganó»
  como tarjeta con acción. `MenuNegocioLateral` (compartido con `/licitacion/[codigo]`): activo en teal
  con fondo que se desliza, Auditor sigue en ámbar, contadores sin pastilla; `SeccionTabs` con
  subrayado teal deslizante (también en Resultado/Competencia).
- **Sin repetir Plazos ni Criterios** (2026-10-28, decisión del dueño): la tarjeta de bases (`FichaMPBases`)
  ya no tiene esas pestañas; viven solo en las pestañas Fechas y Criterios del Resumen. Fechas en bento
  (próximo hito + avance + línea de tiempo horizontal `kit/LineaTiempo`), Criterios con reparto en barra,
  «dónde se gana» y anillo por criterio (`CriteriosSection`, compartida con `/licitacion`; la pestaña
  Viabilidad sigue con `CriteriosEvaluacionV4`), Comentarios como «Conversación del equipo» con el color
  de cada persona (`colorUsuario`).
- **Documentos sin rellenar ni enviar al Auditor** (2026-10-28, decisión del dueño): en `DocumentosSection`
  (compartida con `/licitacion`) se quitaron «Rellenar anexo», «Generar todos» y «Enviar al Auditor
  Técnico» (incluido mandar el costeo al Motor Comercial): eso se hace desde el Auditor. Quedan ver
  (clic en el nombre), preguntar a la IA, separar anexos, descargar, subir, mover entre cajas y el
  estado en el Auditor como punto + texto. Cajas en columnas sin huecos, vacías al final. La tarjeta
  «Empresa con la que se postula» SE QUEDA en Documentos (ahí se elige con qué empresa se llenan los anexos).
- **Viabilidad, primera pasada** (2026-10-28): encabezado de nivel en bento (nivel grande con medidor de
  7 tramos, acción, «Definitivo / Revisión humana» con punto), 4 tarjetas clave sin barra de color ni
  pastillas, pestañas con subrayado teal deslizante y el molde `Bloque` de todas las pestañas al estilo
  kit. Barrido en los 5 archivos de la vista: violeta/índigo → teal, sin `font-black` ni rótulos en
  MAYÚSCULAS. Aplicado IGUAL en las dos copias: `app/licitacion/[codigo]/sections/` (ICA) y
  `app/components/cv/viabilidad/` (multi-cliente); solo difieren en las rutas de API. Script:
  barrido reutilizable en el scratchpad de la sesión, no en el repo.
- **Viabilidad: pestañas con forma de pestaña + «Cómo ganar» en bento** (2026-10-28, pedido del dueño: «que
  parezcan pestañas a simple vista»): `VistaViabilidadV4` ahora tiene pestañas con borde y esquinas
  superiores; la activa es más alta, lleva barra teal arriba y se funde con el panel gris de abajo.
  Cómo ganar: «Se gana en» y «Dónde se decide» como dos bloques suaves (sin fondo sólido), lectura
  comercial, Para ganar / No quedes fuera lado a lado, criterios con barra de reparto, anillo por
  criterio y paleta teal/pizarra/ámbar (sin morados), Estrategia con tarjetas neutras. Aplicado igual
  en las dos copias (ICA y `app/components/cv/viabilidad/`).
- **Viabilidad: criterios interactivos, ley marcada y citas con «Cita»** (2026-10-28, pedido del dueño):
  la barra de reparto, la leyenda y el aviso «dónde se gana» llevan al criterio (hover resalta, clic
  abre y desplaza); cada criterio se abre/cierra y hay «Contraer/Expandir todos». «Cómo puntúa / Cómo
  se gana» va en un recuadro con la frase clave en negrita; «Ley del mínimo/máximo» es una marca verde
  con trofeo (única excepción a «sin pastillas»: lo pidió el dueño). Estrategia: filtros por tipo de
  jugada, peso del criterio en grande, «Qué hacer» destacado. **Citas**: `Cita` ya no muestra el nombre
  del archivo sino «Cita · numeral · pág. N» (el nombre queda en el tooltip); vale para TODAS las
  pestañas y las dos copias. **Cita y ojo son lo mismo; el botón muestra SOLO «👁 Cita»** (numeral y página quedan en el tooltip) (el dueño lo aclaró): un solo botón «👁 Cita ·
  numeral · pág. N» que abre el visor en la página y resalta la frase; ya no hay un ojo aparte.
- **Viabilidad → Admisibilidad** (2026-10-28): arriba 5 tarjetas resumen clicables (Requisitos que dejan fuera,
  Visita técnica, Muestras, Garantías, Firma) con punto de color y que desplazan a su sección; requisitos
  plegables con «Contraer/Expandir todos»; «Si no se cumple…» como fila roja suave; visita y muestras con
  rótulo/valor sin cajas anidadas; garantías sin pastillas (punto + texto). Dos copias iguales.
- **Viabilidad → Plazos y multa** (2026-10-28): arriba 3-4 tarjetas resumen clicables (Plazo previo, Plazo de
  entrega, Multa, Tope); Entrega y Multa en bloques rotulados. **El Plazo previo se queda como TABLA** (el
  dueño rechazó la línea de tiempo vertical: «dejalo tipo tablas»), con columnas Hito · Se cuenta desde ·
  Plazo, **la cita pequeña DEBAJO del nombre del hito** (no en columna aparte) y fila total en teal suave.
- **Viabilidad → Productos y Preparación** (2026-10-28): Productos sigue como TABLA (Línea · Producto ·
  Cantidad · Tipo, se abre la ficha técnica) con 4 tarjetas que FILTRAN (número grande + punto; la activa
  con borde teal), chips de línea en teal suave, «Expandir/Contraer todos», y las pastillas (Libertad de
  oferta, Precio libre, ± cantidad, por revisar, Específico/Genérico) pasaron a punto + texto. Preparación:
  arriba las mismas tarjetas resumen clicables de Admisibilidad (`ResumenAdm`); «Para postular» y
  «Advertencias» lado a lado en bloques suaves; documentos y anexos en listas con antigüedad / «Por cruce»
  como punto ámbar; documentos a crear en tarjetas neutras con «Contenido exigido» rotulado. Sin violeta.
  Dos copias iguales. **Sin ver en navegador** (el dev server de otra sesión pedía login).
- **Viabilidad en notebook** (2026-10-28, el dueño: «en un monitor se ve bien pero en un notebook no»): en
  1366 px, con el menú de la app (256 px) y el del negocio, al panel le quedan ~830 px, pero los cortes
  `lg:`/`xl:` miran la PANTALLA y metían 4-5 columnas igual. Ahora `VistaViabilidadV4` es `@container` y
  `viabilidad-v4-bloques.tsx` usa container queries: `sm→@xl`, `md→@2xl`, `lg→@4xl`, `xl→@6xl`; tarjetas
  resumen en 3-4 columnas desde `@2xl` (5 solo desde `@4xl`), tarjetas clave en 4 solo desde `@6xl`. CSS
  generado comprobado; sin ver la pantalla (pide login). Regla agregada a la skill `licitank-ui`.
- **Modal al pinchar una licitación en `/negocios`** (2026-10-28, pedido del dueño: «algo breve»):
  `NegocioDetalleModal` (`app/negocios/page.tsx`) pasó a `max-w-xl` con el kit: código · tipo · estado
  con punto, título, organismo · región en una línea; `Datos` (Cierre «Hoy/Mañana/día», Presupuesto,
  Ofertado, Documentos N, Responsable); viabilidad con nivel + puntaje + medidor de 7 tramos, resumen y
  recomendación a 2 líneas y solo el NÚMERO de riesgos. Se quitaron del modal la descripción, la lista
  de documentos, ventaja competitiva y el detalle de riesgos (están en el negocio). Sin ver en navegador.
  **Bug arreglado ahí mismo:** el modal decía «Sin descargar» aunque la tarjeta decía «Descargados»:
  `GET /api/negocios/[id]` pedía `nombre_archivo, url_local, url_original` a `documentos_cache`, columnas
  que NO existen (son `documento_nombre`, `documento_url_local`; no hay URL original), y el `.catch`
  lo tapaba devolviendo lista vacía. Ahora usa alias y sin `LIMIT 30`, así `total_documentos` es el real
  (3712-74-LP26 → 7, probado contra la BD del VPS).
- **Viabilidad en `/negocios` = nivel v4 primero** (2026-10-28, el dueño vio tarjetas sin viabilidad que
  sí la tenían): la v4 guarda su nivel en `viabilidad_licitacion.nivel_atractivo` y deja `semaforo` /
  `score_total` en NULL (50 licitaciones solo v4; 183 tienen ambos y a menudo NO coinciden, p. ej.
  4022-19-LE26 semáforo «Media» vs v4 EXCLUIDO). `GET /api/negocios` y `/api/negocios/[id]` ahora
  traen `viabilidad_nivel`; en `app/negocios/page.tsx` `viabilidadDe()` usa el nivel v4 («Muy alto» …
  «Excluido», sin puntaje) y cae al semáforo antiguo si no hay v4. Igual que el Resumen del negocio.
  Tarjetas, lista, modal y Excel. Sin ver en navegador (pide login).

- **Pantallas sin aspecto «hecho por IA»** (2026-10-20): el estándar aprobado en `/negocios` vive
  en la skill `ui-sin-aspecto-ia` (`.claude/skills/ui-sin-aspecto-ia/`). Leerla antes de tocar
  cualquier front. Tailwind, no Mantine (no hay `MantineProvider`). Una sección por vez,
  mostrándosela antes de seguir.
- Evitar clichés de IA: fondo oscuro con gradiente animado, glassmorphism, blobs, contadores,
  índigo/violeta. Usar los colores del logo y maquetas con datos REALES del producto.
- Landing `/bienvenida`: la en uso es la original. Hay una nueva aprobada guardada SIN activar en
  `app/bienvenida/_nueva/`: si pide activarla, copiarla de ahí; no rediseñar de cero.
- Botón flotante rojo «Reportar error» (captura + marcas + observación) → `/admin/errores`.
- Chat IA flotante (Ctrl+J) con contexto de todo el negocio.
- Documentos descargados: sin backfill de los nombres viejos con timestamp (decisión del dueño).
- Documentos Propios se organizan en cajas manuales (arrastrar y soltar); la IA no reclasifica
  esos archivos.
- Sidebar angostable a íconos con tooltips.
- Componentes compartidos (Select, Banner, StatCard, ChartCard, MultiSelect); regla: toast para
  algo pasajero, banner para un estado que persiste.

## Pendientes conocidos

- Elegir tipografía en `/ui-kit` (Roboto actual vs Inter Tight vs Manrope) y aplicarla en `app/layout.tsx`.
- Decidir la propuesta de colores de etapa que se ve en `/ui-kit` (solo cambian Asignado, En proceso y
  Posible adj.).
- Viabilidad: las 5 pestañas de la v4 ya están rediseñadas (Productos y Preparación sin ver en navegador);
  faltan las vistas antiguas v2/v3 de `ViabilidadIAPanel` y la pantalla de carga/re-análisis.
- Negocio: falta el resto de secciones (Líneas, Auditor…) y el Resumen de
  `/licitacion/[codigo]` (`ResumenSection`) y su encabezado.

- Aplicar el estándar sin aspecto IA a las vistas Lista y Mes, al Dashboard y a los colores de
  etapa en `pipeline.ts` (afecta toda la app: decisión aparte).
- Chat general sobre todas las licitaciones (modo global) sin hacer. Huecos de datos que lo
  limitan (oct-2026): ~13.500 documentos sin texto, pocas adjudicaciones y ofertas guardadas.
- Filtros de Postuladas: confirmar con el dueño si los quiere multi-selección por dimensión.
- Backfill del Content-Type de ~8.000 objetos en R2 para que el visor de Office funcione en
  archivos viejos (opcional).
- Resaltado del «ojo» de citas en PDF escaneado (sin capa de texto).

## Auditor — primera pasada visual (2026-10-29)

- Pedido del dueño: «arregla todo el front del auditor con las skill». Barrido SOLO visual con las reglas de
  `licitank-ui` en 7 archivos: `AuditorOpcionesPanel`, `ResumenAuditorPanel`, `PrePostulacionPanel`,
  `FilaLineaTecnica`, `SelectorPuntoAuditor`, `ComparadorFichasPanel`, `ModalAuditorLineaTecnica`.
- Hecho: violeta/índigo → teal (76), `font-bold` → `font-semibold` (97), rótulos sin MAYÚSCULAS ni
  tracking (17), pastillas de estado → texto de color sin fondo (≈63, incluye los mapas `cls`),
  ícono de chispas → `IconScan`. `tsc` limpio; eslint conserva sus `any` preexistentes.
- NO hecho: rediseño bento del Auditor (jerarquía, tarjetas, `Lista`/`Tarjeta` del kit, puntos de estado,
  grillas `@container`). Tampoco se vio en navegador (login + sin desplegar). Anexo 4: el dueño dijo
  «déjalo como estaba», no se tocó el pie «Valor total / Neto / Con Iva».

## Auditor — bento aplicado (2026-10-29, segunda pasada)

- Pedido del dueño: «aplícalo» tras ver la maqueta; luego «te falta el checklist y el pre-postulación, y después postulación».
- Hecho, solo visual y con `@container`: encabezado del Auditor (`AuditorOpcionesPanel`: bloque grande con el
  recorrido de 5 pasos + bloques «Líneas aprobadas» y «Documentos del proveedor»); Pre-postulación
  (`PrePostulacionPanel`: candado como bloque grande tintado + 3 pasos como bloques con barra);
  Checklist (cabecera de `InformacionComercialSection`: bloque grande + «Puntos aprobados» + «Admisibilidad»);
  Postulación (`PostulacionPanel`: 3 bloques —archivos listos, aprobados, faltan— sobre la lista).
  Las tarjetas de esos archivos usan `border-linea shadow-tarjeta` y `dark:`.
- NO hecho: las tarjetas por línea y el cuadro de opciones del Auditor (siguen con su estilo anterior), las
  filas del checklist y sus pastillas internas. Sin ver en navegador: el login lo hace el dueño (local :3000,
  túnel SSH 3307 abierto a mano).

## Pre-postulación sin aspecto IA (2026-10-29)

- Pedido del dueño: «en pre-postulación aplica la skill para sacar el front IA». En `PrePostulacionPanel.tsx`:
  emojis ✅❌⏳ de las causales → punto de color; pastillas («criticidad sospechosa», origen del compromiso,
  «No aplica») → texto de color; cada compromiso ya no es una caja dentro de la tarjeta sino una fila con
  línea divisoria; botones tintados (ámbar/teal pálido) → secundario neutro; «Confirmar los N» pasó de verde
  sólido a teal (acción primaria); el candado quedó en superficie neutra, con el color solo en el ícono y el
  título; textos de 10–11,5 px → `text-xs`; `text-zinc-400` → `text-slate-500` (contraste); títulos de
  sección 15 px. Solo visual: nada de datos ni textos de negocio. Sin ver en navegador (login del dueño).

## Checklist: lista de anexos en cuadros (2026-10-29)

- Pedido del dueño (con captura del bloque «Administrativo»): lista más ordenada, «en cuadros unificados o como se vea mejor».
  En `InformacionComercialSection.tsx`, los bloques Administrativo y Técnico muestran cada punto como cuadro
  (`FilaItem` con `tarjeta`: borde fino, sombra suave, 2 columnas a partir de `@3xl`); el bloque Comercial
  (filas de precio) sigue como lista. Las 3 pastillas de la fila (Admisibilidad / % / estado) pasaron a una línea
  bajo el título: tipo en texto de color, «N% del puntaje» y estado con punto. «Generar anexo» sin ícono de chispas;
  aviso de archivos sueltos en gris neutro. Sin ver en navegador (login del dueño).
- (2026-10-29, ajuste de la tarjeta, pedido del dueño con captura): en el cuadro del anexo, «Generar anexo» y
  «Traer desde Documentos» salieron de la columna del texto y van como pie de la tarjeta, bajo una línea, lado a
  lado a todo el ancho (`flex-1 min-w-[9rem]`; si no caben, uno bajo el otro). Fuera del modo cuadro (bloque
  Comercial y alertas) los botones siguen donde estaban. Sin ver en navegador.
- (2026-10-29, pedido del dueño con captura del bloque Comercial «0/46»): las líneas con `ofertamos === false`
  se sacan de la lista y quedan plegadas al final en «N líneas fuera de la oferta» (`<details>`, se abre para
  «Incluir» alguna); la lista y el contador «aprobados/total» muestran solo las que se ofertan. Solo visual:
  no cambia qué líneas se ofertan ni el total. De paso se arregló que mi cambio a cuadros había quitado las
  líneas divisorias entre filas del Comercial. Sin ver en navegador.
- (2026-11-03, pedido del dueño con capturas en notebook): ficha de Compras (`/compras/<id>`) rediseñada por partes — cabecera y encargado en una tarjeta; «siguiente paso» + reloj de entrega + incidencias en una sola franja (sin repetir la incidencia); Gantt en modal a pantalla casi completa (`plegable`); Resumen, condiciones de las bases, contactos y Orden de compra por ancho del panel (`@container`), rótulo arriba/valor abajo, sin pastillas. Falta el stepper y las pestañas. Método y reglas en la skill `rediseno-compras`. Sin ver en navegador (login).
- (2026-11-03) Cotizaciones: proveedores sugeridos por compras anteriores abren un modal con ficha de contacto, productos comprados y órdenes (ProveedorFichaModal + /api/compras/proveedores/ficha). Stepper del flujo más claro (estado ≠ ubicación, sin números repetidos, «Siguiente»). Detalle en la skill rediseno-compras. Sin ver en navegador (login).

- **Compras → «Compara y elige» con licitank-ui (2026-11-19, pedido del dueño):** filas por columnas, ofertas de los 3 proveedores más baratos visibles con el producto plegado, estados con punto (sin pastillas). Detalle en `compras.md` (11). Sin ver en navegador; falta que el dueño lo apruebe.

- **Compras → «Emparejar a mano» (2026-11-19, pedido del dueño, maqueta aprobada):** panel lateral licitank-ui con candidatas ordenadas, qué revisar con puntos de color, «Ver cotización» y vista previa de cómo quedaría. Detalle en `compras.md` (12). Sin ver en navegador.
