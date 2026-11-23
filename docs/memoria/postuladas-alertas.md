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
- **A QUIÉN le llega cada alerta (09-nov-2026, decisión del dueño; correo y WhatsApp igual).** Una sola regla en
  `app/lib/avisos-reglas.ts`; Compras y Mercado Público se reconocen por el campo **Área** del perfil (texto libre en
  Admin > Usuarios: «Compras», «Mercado Público»; se compara sin tildes ni mayúsculas), no por nombres en el código:
  ganada / perdida / cerrada-revocada-desierta → encargado de la licitación + admins + Compras;
  apertura → encargado + Compras + Mercado Público; orden de compra y OC por vencer → encargado (comercial y de Compras) + Compras
  + Mercado Público (los admins ya NO); cierra pronto → encargado + Mercado Público (admins ya NO); digest del radar → solo admins.
  Un asistente solo se entera de SUS licitaciones. El WhatsApp además exige tener el aviso activado en el perfil: ganada, perdida y
  apertura vienen encendidos; los demás (estado, OC, OC por vencer, cierra pronto, radar) nacen apagados y los autoriza el admin.
  Cierra pronto y radar van a WhatsApp como UN resumen por corrida, no uno por licitación (el número es no oficial: riesgo de bloqueo).
  Correo de ganada/perdida/apertura/estado con freno anti-duplicado (`avisos_correo_enviados`, migration-182). Falta: aplicar
  migration-182 en el VPS, poner el Área a María Elena y Carolina Sepúlveda («Compras») y a Carolina González («Mercado Público»),
  y encender los avisos nuevos de WhatsApp por perfil. Sin desplegar ni probado en vivo. El aviso de cambio de fecha de cierre y
  los de Compras (aprobaciones) no se tocaron.
- **Comentarios automáticos de Mercado Público se ven como LICITANK (23-nov-2026, pedido del dueño).** El comentario «Mercado Público
  marcó la licitación como X.» se guarda con el encargado como `usuario_id` (la columna es NOT NULL), lo que confundía: parecía
  escrito por la asistente. Ahora la API lo marca `es_sistema` (por ese texto, sin migración) y `ComentariosSection` muestra el
  logo LICITANK + «Automático». Si se agrega otro comentario automático, hay que sumarlo a ese `LIKE` en
  `licitacion-comentarios/[codigo]/route.ts` y `negocios/[id]/comentarios/route.ts`. Sin probar en pantalla (la BD local no responde).
- **Nunca avisar por vista de pantalla**: que alguien abra Postuladas no puede disparar ni
  «consumir» un aviso; el aviso lo da el cron. Mismo blindaje para Adjudicada, Revocada, Desierta,
  Cerrada, Suspendida y apertura.
- **Una orden de compra nunca se revincula a otra licitación**: es un hecho histórico. Lo que sí
  se hace es copiarla como documento de experiencia a otra licitación.
- Las OC alimentan los certificados de experiencia: se guardan comprador, montos e ítems.
- **Aviso de OC nueva o con cambio de estado (campana + correo): [desde el 09-nov solo Compras + Mercado Público + encargados, ver arriba; antes admins + asignado del radar +
  encargado principal y coencargados de Compras de esa licitación]** (2026-11-03, tras 4152-22-LE26:
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
- **Readjudicada que no responde = no hay resultado** (2026-11-16, 4777-25-LE26): la ficha original dice
  «Readjudicada en Id …-R126» pero sigue mostrando el acta VIEJA. El 26-oct la municipalidad la readjudicó a
  OpenCluster Tech (decreto 6401) y el 27-oct quedó bien en PERDIDA; el 16-nov a las 04:10 la R126 no respondió,
  `construirConReadjudicacion` devolvió la ficha original sola y la reconfirmación de 12 h la volvió a «ganada»
  con alerta a todos (falsa). Ahora, si la readjudicación no responde, lanza error y se reintenta después.
  Sin desplegar: hasta el deploy el VPS puede repetirlo si una R126 falla. El negocio 1110 se devolvió a PERDIDA en
  silencio el mismo día (decisión del dueño; caché con R126/OpenCluster, sin avisos). Antes se simuló sin escribir
  con el código arreglado sobre las 11 readjudicadas (9 con `readjudicada_en`, 4777 y la marca manual 1426039-8-LE26):
  todas dan el estado que tienen. Simulador: `scripts/scratch/dbg-readj-simular.mts` (tsx --env-file=.env.local).

## Pendientes conocidos

- SMTP del correo de licitaciones rechazaba la clave (535) en ago–sep 2026: confirmar el `.env`
  del VPS. Además el servidor propio acepta pero Gmail no entrega (falta DKIM/DMARC).
- WhatsApp: método de pago, mensaje de prueba, verificación del negocio y plantillas Utility.
- Licitaciones NO postuladas que quedan Revocadas solo cambian `licitacion_estado`, no el pipeline
  (a propósito).
- Foro de preguntas de MP solo por scraping de la ficha (la API no lo trae).

## 2026-11-18 — Monto ganado de 759-30-LE26 salía $74.116 en vez de $31.499.158 (SIN desplegar)
La API de MP trae Cantidad pedida 425 y CantidadAdjudicada 1 (adjudicación TOTAL, precio unitario 74.115,665; el Anexo 4 dice neto $31.499.158 = 425 × unitario). `construirDesdeLicitacion` usaba la adjudicada. Ahora `cantidadGanada()` (adjudicacion.ts): si adjudicada = 1, tipo = 2 y pedida > 1, vale la pedida. La fila de `adjudicacion_cache` era definitiva (adjudicada no se reconsulta): corregida a mano en el VPS (respaldo en scripts/scratch/_respaldo_adjudicacion_cache_759-30-LE26_181126.json). OJO: `guardarCache` con la respuesta SIN enriquecer borra `esNuestra` de las líneas y el Resumen ejecutivo («Precio de venta ganado» = «—») lo lee de ahí; se restauró con un UPDATE de `lineas` (no regrabar una fila con guardarCache sin enriquecer). Sin desplegar: otras licitaciones con ese patrón seguirían mal al cachearse; las ya cacheadas no se revisaron una por una (24 con una línea de cantidad 1 tienen montos plausibles).

## 2026-11-17 — PDF de la OC sin captcha: copia de la ficha pública (tsc ok; SIN desplegar)
- MP protege `PDFReport.aspx` (PDF oficial) con reCAPTCHA y no se resuelve. La ficha `DetailsPurchaseOrder.aspx` es pública: `app/lib/mp-oc-ficha-pdf.ts` la abre con el navegador headless (espera «TOTAL OC», abre el panel con scroll de 700 px) y la imprime a PDF (2 páginas, 3 s).
- `descargarPdfOrdenCompra` usa esa copia cuando el oficial falla; se marca en `ordenes_compra.pdf_error` = «Copia de la ficha pública de MP (no es el PDF oficial)». Subir el «PDF oficial» a mano la reemplaza (pdf_error vuelve a NULL; mismo nombre `OC_<código>.pdf`, no duplica en Documentos).
- Corrido local contra el VPS el 17-nov: 29 OC sin PDF → 29 con copia, 0 fallas. Falta desplegar para que el cron diario lo haga solo con las nuevas. Pendiente: mostrar la marca «copia» en `/ordenes-compra`; las OC que el barrido nunca encontró (no nombran la licitación) siguen sin estar.
- **17-nov (tarde) — PDF OFICIAL sí se baja:** el reCAPTCHA de `PDFReport.aspx` es invisible; con un Chrome CON ventana (no headless) el botón PDF entrega el archivo solo (probado con 3789-636-SE26: 186 KB). `descargarPdfOficialOrdenCompra` (mp-oc-ficha-pdf.ts) lo hace; en Linux levanta Xvfb (Dockerfile ahora instala `xvfb`). Orden: oficial → copia de la ficha → subida manual. `descargarPdfsPendientes` también reintenta las copias. Corrido local contra el VPS con permiso del dueño: las 29 pasaron a oficial. **Sin desplegar ni probado en el VPS** (depende de Xvfb y de que MP puntúe bien esa IP).

## 2026-11-17 (noche) — Se quitó la subida a mano del «PDF oficial» de la OC (tsc ok; visto en navegador local; DESPLEGADO el 17-nov, contenedor `licitapyme` con /usr/bin/Xvfb y chromium; falta ver una OC nueva bajar sola en el VPS)
- Decisión del dueño: el PDF de la OC llega solo desde MP, así que se sacó el botón «PDF oficial» (abrir MP + arrastrar el archivo) de Compras (`ComprasChrome.tsx`), Resultado de la licitación/negocio (`OrdenesCompraBloque.tsx`) y `/ordenes-compra`. Borrados `SubirPdfOficialOC.tsx`, `/api/ordenes-compra/pdf/subir` y `carpeta-descargas-cliente.ts`. Orden ahora: oficial → copia de la ficha (el cron la reintenta a oficial).
- En Compras «PDF de la orden» sale en toda OC de MP; si no hay PDF guardado lo baja al pinchar (probado en local con 2415-283-SE26: bajó el oficial de 187 KB en el momento).
- Se dejó «Registrar a mano / Corregir a mano» (número, monto, fechas de la OC del cliente): sirve para fichas a las que MP nunca les trae OC.
- Estado en el VPS el 17-nov: 267 OC propias, todas con PDF oficial. 80 fichas de Compras: 61 con OC de MP, 19 sin OC (ninguna a mano). Barrido de solo lectura en MP por proveedor (Claro y Comercial MP, 150 días, 0 días fallidos): solo 2 OC propias no estaban guardadas, ambas de Claro, Aceptadas, de inicios de septiembre (antes de la ventana del barrido): 1422051-201-SE26 → 1422051-16-LP26 (negocio 315) y 1422051-204-SE26 → 1422051-17-LP26 (negocio 625). Las otras 17 fichas sin OC: MP no tiene OC emitida a nuestras empresas.
- Cargadas en el VPS el mismo día con OK del dueño, con la función del cron (`sincronizarOrdenesCompra({ dias: 75, soloProveedor: true, avisar: false })`, sin avisos): las 2 quedaron es_nuestra, enganchadas a Compras (oc_origen 'mp', $29.839.029 y $80.905.250) y con PDF oficial; no cambió ninguna otra OC. Quedan 269 OC propias, todas con PDF oficial; Compras: 63 con OC de MP, 17 sin OC.
- Ojo: el barrido diario solo mira pocos días hacia atrás; una OC vieja que no se alcanzó no llega sola. Para recuperarla: la misma llamada con más `dias`.
