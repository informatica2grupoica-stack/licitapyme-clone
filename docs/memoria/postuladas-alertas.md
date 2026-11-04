# Postuladas, adjudicación, alertas y automatización

Traspasado desde la memoria personal el 2026-10-27; las fechas son de cuando se decidió.

## Decisiones vigentes del dueño

- **/postuladas clasifica por el estado REAL de Mercado Público** (Ganada / Perdida / En
  evaluación / Desierta / Revocada / Suspendida), no por etiqueta manual.
- Las adjudicadas **se quedan en Postuladas** (2026-07-13); no se auto-promueven a /adjudicadas.
  Análisis cuenta por resultado real de MP.
- Revocada/Desierta: estados de pipeline propios, fuera de Postuladas y KPIs (ver
  `auditor.md`).
- Alerta de apertura solo para POSTULADAS.
- Avisos de ganada/perdida/apertura: campana + correo al asignado y a los admins.
- **Nunca avisar por vista de pantalla**: que alguien abra Postuladas no puede disparar ni
  «consumir» un aviso; el aviso lo da el cron. Mismo blindaje para Adjudicada, Revocada, Desierta,
  Cerrada, Suspendida y apertura.
- **Una orden de compra nunca se revincula a otra licitación**: es un hecho histórico. Lo que sí
  se hace es copiarla como documento de experiencia a otra licitación.
- Las OC alimentan los certificados de experiencia: se guardan comprador, montos e ítems.
- **Aviso de OC nueva o con cambio de estado (campana + correo): admins + asignado del radar +
  encargado principal y coencargados de Compras de esa licitación** (2026-11-03, tras 4152-22-LE26:
  la OC llegó y los encargados de Compras no recibieron correo). Va en `avisarOrdenes`
  (`app/lib/ordenes-compra.ts`). Sin desplegar ni probado en vivo. Este aviso solo sale desde el
  cron de OC; el enganche de pendientes de Compras no manda correo.
- **Recordatorio de aceptar la OC antes de que venza** (2026-11-03): campana + correo a encargado
  principal, coencargados y admins, una vez cada uno a <24 h, <3 h y «venció» (este solo hasta 24 h
  después). Límite = el del Gantt (`ocLimite`, plazo de las bases desde que llegó la OC). No avisa
  si la OC ya se aceptó (fecha de MP o tarea `aceptar_oc` HECHA). `avisarAceptacionOcPorVencer` en
  `app/lib/compras.ts`, corre en el cron `compras-asignacion`. Sin desplegar ni probado en vivo;
  4152-22-LE26 (límite 5-nov 23:59) es el primer caso real.
- WhatsApp Cloud API: pausado. No migrar el número que alguien usa a diario en su celular; usar
  un número dedicado solo a la API. El token va en variable de entorno, nunca en el repo.

## Reglas para trabajar aquí

- Resultado de adjudicación: cache-first. Adjudicada en caché = hecho final, no se reconsulta;
  no adjudicada → TTL 3 h. Un 429 de MP no puede leerse como «no adjudicada».
- API de órdenes de compra: el endpoint correcto es `ordenesdecompra.json`
  (`/OrdenCompra.json` responde 404). La API no consulta por licitación: al cruzar por nombre
  aparecen las OC del COMPETIDOR que ganó — verificar el proveedor antes de guardarlas como
  nuestras.
- El PDF de una OC (`PDFReport.aspx?qs=…`) se baja con un fetch plano, sin sesión ni IP chilena.
- Un solo error no capturado al arrancar `scheduler.mjs` deja sin correr TODA la automatización
  (pasó en sep-2026 por días). Cualquier cambio al scheduler: probar que arranca.
- Ante «no llegan avisos», separar dos preguntas: ¿cambió el dato (cron/BD)? y ¿salió el aviso
  (SMTP)? Son fallas independientes.
- Si una POSTULADA parece atascada sin pasar a Ganada/Perdida, revisar si la caché quedó sin
  promover (causa real de sep-2026).

## Pendientes conocidos

- SMTP del correo de licitaciones rechazaba la clave (535) en ago–sep 2026: confirmar el `.env`
  del VPS. Además el servidor propio acepta pero Gmail no entrega (falta DKIM/DMARC).
- WhatsApp: método de pago, mensaje de prueba, verificación del negocio y plantillas Utility.
- Licitaciones NO postuladas que quedan Revocadas solo cambian `licitacion_estado`, no el pipeline
  (a propósito).
- Foro de preguntas de MP solo por scraping de la ficha (la API no lo trae).
