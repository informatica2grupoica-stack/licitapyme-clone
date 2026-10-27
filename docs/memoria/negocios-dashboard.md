# Negocios, radar, dashboard y gestión

Traspasado desde la memoria personal el 2026-10-27; las fechas son de cuando se decidió.

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

- Índice `idx_alertas_codigo` en `alertas_licitaciones (licitacion_codigo)` (migración 31):
  figuraba sin aplicar; es el arreglo de fondo de la lentitud por código (verificar).
- PATCH/DELETE de `/api/alertas` solo operan sobre filas propias: un admin no puede marcar/borrar
  una alerta ajena.
- Entrega de Proyectos: destinatario de logística y export a PDF/Word sin decidir.
- F.2 / F.3 (ofertas de competencia, memoria histórica): migraciones 59 y 60 figuraban sin
  aplicar (verificar).
- Batch de re-análisis del golden set con la función que GUARDA nunca se completó (jul-2026).
- Dashboard: descarte antes de asignar (nivel 0) no se representa; «Posible adjudicado»
  automático fuera de alcance.
- Refresco garantizado de «Destacadas» cada 2 h necesitaría un cron dedicado (decisión del dueño).
