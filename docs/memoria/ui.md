# Interfaz compartida

Traspasado desde la memoria personal el 2026-10-27; las fechas son de cuando se decidió.

## Decisiones vigentes del dueño

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
- Viabilidad: falta rediseñar por dentro las pestañas Productos y Preparación
  (Cómo ganar, Admisibilidad y Plazos y multa ya están), las vistas antiguas v2/v3 de `ViabilidadIAPanel` y la pantalla de carga/re-análisis.
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
