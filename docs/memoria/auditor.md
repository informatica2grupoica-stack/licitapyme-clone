# Auditor de la licitación (técnico + costo + pre-postulación)

Pantalla: ítem «Auditor» del negocio, `AuditorOpcionesPanel.tsx`. Traspasado desde la memoria
personal el 2026-10-27; las fechas son de cuando se decidió.

## 2026-10-27 — Al eliminar la ficha técnica seguían «cumplen» y «por resolver»
Al quitar una ficha («Dejar de usar») o borrarla desde Documentos, la comparación técnica de la
opción quedaba guardada tal cual (era así a propósito: «vuelve a comparar»). Ahora se retiran las
comparaciones hechas desde que la ficha se cargó (`retirarComparacionesConFicha`,
`app/lib/auditor-opciones.ts`); las anteriores no la vieron y se conservan. Si no queda ninguna,
la opción vuelve a «sin comparar». No se re-compara sola (gasta IA).
**Verificado:** `tsc` y tests. **Pendiente:** verlo con la BD real (sin túnel ese momento).

## Decisiones vigentes del dueño

- **UNA sola pantalla** (2026-09-30), sin pestañas Técnico/Compra. Pestañas finales: Auditor ·
  Costeo · Checklist · Pre-postulación · Postulación (solo los PDF a subir a MP) · Resumen del
  Auditor.
- **Comparador técnico = Prompt 4 v3.0** (reemplaza al verificador v2): 4 estados por requisito
  (✅ CUMPLE · 🟩 SOBRECUMPLE · ❌ NO CUMPLE · ❓ FALTA DATO), máx. 3 preguntas técnicas por
  proveedor. Firmar/aprobar se bloquea con ❌ o con ❓ sin confirmar.
- Los prompts del comparador se generan desde el `.md` (`scripts/generar-prompts-comparador.mjs`
  → `auditor-comparador-prompts.ts`); NO editarlos a mano, un test los compara.
- Lo que el `.md` deja al modelo pero conviene hacer por código (sobrecumple, veredicto global,
  certificado de admisibilidad, bloqueos) vive en `auditor-comparador-core.ts`.
- **Todo el Auditor con Kimi** (2026-10-26), con respaldo a glm-4.7. Kimi + `response_format:
  json_object` rompe las claves del JSON: no volver a ponerlo. `auditor_extraccion.motor` dice
  quién leyó.
- Precio manual sin documento: se acepta con precio + IVA + motivo; la opción queda en TANTEO y no
  se firma sin cotización.
- Complementos de una opción (accesorios, instalación y envío de la MISMA cotización) se suman al
  costo por unidad; proveedor = la propia empresa se deja vacío (2026-10-26).
- El Auditor respeta el selector «¿A qué líneas vamos?» (`negocio_lineas_oferta`).
- El comparador filtra los requisitos por producto siempre (2026-10-09, caso 387-55-LE26: mezclaba
  84 requisitos de 21 muebles).
- Revocada/Desierta son estados de pipeline propios (REVOCADA, DESIERTA): salen de Postuladas,
  KPIs y lista de Negocios. Toda lista nueva de «estados resueltos» debe incluirlos.
- Cálculo dice CUMPLE y la IA NO_CUMPLE → queda PENDIENTE con nota, nunca aprobado solo.

## Reglas para trabajar aquí

- **Las confirmaciones las hace el equipo, nunca la IA**: precio dudoso, «Lo confirmo», «Sí
  cumple», firmar, aprobar. Quedan con nombre en la BD de producción. Al probar, solo mirar,
  abrir/plegar y filtrar.
- **Hooks de React antes de cualquier `return` temprano** en `AuditorOpcionesPanel.tsx`: uno
  después rompe producción (React #310) y `tsc` no lo ve. Correr
  `npx eslint <archivo> | grep rules-of-hooks`.
- El error más caro es aprobar un modelo y costear otro.
- Ante un Auditor «con requisitos de más», mirar primero cuántos requisitos rotulados tiene la
  línea del informe frente al producto.
- `leerSinGuardar` (`auditor-lector.ts`) diagnostica una lectura sin escribir en la BD.

## Pendientes conocidos

- IVA: la v3 dice «cotización sin IVA → precio tal cual + marca»; hoy rige «cotización sin
  declarar IVA bloquea». Decisión pendiente del dueño.
- 10 decisiones del asesor (CA) en `docs/AUDITORIA_SISTEMA_AUDITOR_2026-10-01.md`, sección 11.
- PRE-POSTULACIÓN: `docs/migration-135-prepostulacion.sql` sin aplicar a esa fecha; regla de corte
  técnico vs técnico-administrativo por confirmar con CA. No reabrir el diseño.
- Retiro del checklist viejo pendiente de 3 decisiones del dueño (doble firma, anexos hasta
  pre-postulación…).
- Aviso de producto repetido (marca+modelo / RUT); V8 contra plazo ofertado.
- Auditor Técnico viejo: 3 grupos de checklist en conflicto con evidencia real en más de una fila
  (requieren decisión humana); 27 negocios con datos fragmentados sin reconciliar por decisión del
  dueño; Fase 5 (agente administrativo-documental) en pausa — no necesita Google Docs API, edita el
  `.docx` del organismo.
- Plan estratégico (jul-2026), 4 decisiones de CA sin zanjar: motor de búsqueda Ruta B y su costo,
  automatización vs confirmación del homólogo, contenido del resumen de entrega, alcance del
  histórico a cargar.
- El recorrido «Siguiente paso» del Auditor no se ha visto con clics reales en todos los botones.
