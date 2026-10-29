# Negocios, radar, dashboard y gestión

Traspasado desde la memoria personal el 2026-10-27; las fechas son de cuando se decidió.

## 2026-10-27 — «¿A qué líneas vamos?» salía en licitaciones globales
Caso real: 3712-74-LP26 (negocio 1511). Banner «Esta licitación es por línea (1): falta elegir a cuáles
vamos» en una licitación de adjudicación GLOBAL con una sola línea. El selector miraba solo
`modalidad.tipo` (cómo se COTIZA), que quedó `por_linea`; elegir líneas depende de cómo se ADJUDICA.
Ahora sale solo con `hayLineasQueElegir` (`checklist-comercial.ts`): cotización por línea, 2 o más líneas
ofertables y adjudicación que no sea GLOBAL; o si ya hay una decisión guardada (para no esconder líneas
dejadas fuera). Ruta `api/negocios/[id]/lineas-oferta`.
**Verificado:** test `selector-lineas-oferta.test.mts`; barrido en la BD (solo lectura): el selector sale en
438 negocios y deja de salir en 44 (GLOBAL o una línea), 3712 incluido. Sin ver en navegador.
4697-25-LP26 (GLOBAL con la línea 1 dejada fuera) estaba mal leída: es por línea y la decisión del equipo
es válida (ver viabilidad.md, «Completar cada línea»).

## Decisiones vigentes del dueño

- **`estado_pipeline` usa ids limpios UPPER_SNAKE**; `pipeline.ts` es la fuente de verdad. Nunca
  comparar ni guardar por la etiqueta. Un estado nuevo va SOLO en `ESTADOS_PIPELINE`; los ids
  viejos viven solo en `ALIAS_LEGADO`.
- Admin = superusuario: el radar muestra todo lo de la empresa, no solo sus palabras clave.
- La tarjeta «Licitaciones en radar» del dashboard da el MISMO número que el radar (la cola
  pendiente, no el volumen ya repartido).
- `/analisis-licitacion` cuenta adjudicadas por el acta de MP, no por `estado_pipeline`.
- Aviso de cierre al 65% del plazo (piso 72 h); botón «En proceso» bloqueado sin viabilidad IA:
  nadie trabaja una licitación sin análisis.
- Descarte con motivo obligatorio y apartado Descartadas.
- **Bitácora total**: todo endpoint que modifica algo llama a `registrarActividad` (sin bloquear la
  respuesta). El historial por licitación hace dedupe diario de las acciones de «mirar» y usa hora
  chilena real.
- Varias firmas escaneadas por empresa; `empresas.firma_url` es espejo de la principal.
- Entrega de Proyectos (F.1): el modal de entrega pendiente es bloqueante (la salida es «Acuso
  recibo»). Facturación queda fuera: se hace en Obuma.
- Para agregar una licitación puntual al radar que no calzó ninguna palabra clave hay un script;
  se corre solo si ya se confirmó que falta.
- Entrevistas técnicas para contratar: el dominio del negocio no entra en la evaluación.

## Pendientes conocidos

- PATCH/DELETE de `/api/alertas` solo operan sobre filas propias: un admin no puede marcar/borrar
  una alerta ajena.
- Entrega de Proyectos: destinatario de logística y export a PDF/Word sin decidir.
- Batch de re-análisis del golden set con la función que GUARDA nunca se completó (jul-2026).
- Dashboard: descarte antes de asignar (nivel 0) no se representa; «Posible adjudicado»
  automático fuera de alcance.
- Refresco garantizado de «Destacadas» cada 2 h necesitaría un cron dedicado (decisión del dueño).

## Días al cierre = días de CALENDARIO en hora Chile (29-oct-2026)
- Bug: «Cierra mañana» con fecha impresa «jueves 29» (= hoy). Causa: `Math.ceil`/`Math.round` de ms/24 h (cierre hoy 20:00 visto a las 08:00 → 0,5 → «mañana»).
- Regla: contar SIEMPRE con `diasCalendarioChile()` de `app/lib/tz.ts` (0 = hoy, 1 = mañana); nunca dividir ms por 86400000. Aplicado en getDiasRestantes (licitación/Resumen), ResumenNegocio, FechasNegocio, search-engine, api/search, negocios/page. Sin verificar en navegador.
- Pendiente: fechas de otros módulos (reloj de entrega de Compras ya usa YMD; postuladas usa dayjs del navegador).
