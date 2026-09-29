# RESERVA PARA PRE-POSTULACIÓN — Bloque técnico-administrativo y Certificado de Admisibilidad
## Licitank · Material guardado del PROMPT 4 v1.1 · 29-09-2026

> Destinatario: programador del proyecto Licitank.
> **No es un prompt activo.** Es el texto que salió del Prompt 4 al pasar a v2.0 (módulo AUDITOR), guardado
> **tal cual estaba en la v1.1** para reutilizarlo cuando se especifique el estado **PRE-POSTULACIÓN**.
>
> **Por qué salió del AUDITOR.** Decisión CA (29-09-2026): la generación de anexos y todo lo que controla la
> inadmisibilidad documental pasa a PRE-POSTULACIÓN, porque no tiene sentido trabajarlo antes de tener lo
> técnico y lo económico confirmados. En el AUDITOR (EN PROCESO) solo quedó la **detección de los
> compromisos con costo** (Prompt 4 v2.0, Parte VIII), para que se costeen antes de fijar el precio.
>
> **Qué hay que revisar al reactivarlo en PRE-POSTULACIÓN:**
> - Pasará a trabajar sobre las **opciones aprobadas** de cada línea (no sobre "la línea" a secas).
> - El certificado debe **consumir** la segunda pasada de rojos que ya corrió en la pasada final del
>   AUDITOR (Prompt 4 v2.0, Parte IX), y repetirla solo si algo cambió desde la aprobación.
> - Los compromisos con costo ya detectados en el AUDITOR deben llegar **precargados** y coincidir con los
>   costos asociados del costeo.
> - Las líneas marcadas **NO OFERTADA** quedan fuera del certificado, salvo licitación GLOBAL o bases que
>   exijan todas las líneas (en ese caso el paso ya fue bloqueado).
> - La regla de corte técnico vs técnico-administrativo sigue **pendiente de confirmación de CA**.
> - Los veredictos y bloqueos se calculan **por código** (decisión CA 29-09-2026): el campo `bloqueos` del
>   JSON original no debe emitirlo el modelo.

---

## 1. PARTE VIII (v1.1) — ETAPA 6 · BLOQUE TÉCNICO-ADMINISTRATIVO

**Regla de diseño:** va **separado y al final**. Lo declarativo mezclado con lo técnico ensucia el
análisis técnico y lo hace más difícil de leer. Pero no desaparece: sin esto no se arma la ficha final
correcta.

```
Separa de la matriz técnica TODO requisito que no sea una característica física o medible del
producto ni algo que venga con él, y agrúpalo al final bajo "REQUISITOS TÉCNICO-ADMINISTRATIVOS".
Entran aquí: capacitación, despacho y flete, plazos de entrega, instalación y puesta en marcha,
postventa, garantías, mantenciones, repuestos, manuales y documentación de entrega, y cualquier otra
obligación que se cumpla mediante compromiso y no mediante una característica del equipo.

REGLA DE CORTE: si para responder hay que mirar la FICHA DEL PRODUCTO → es técnico.
Si para responder hay que mirar lo que NOSOTROS nos comprometemos a hacer → es
técnico-administrativo. Zonas grises resueltas: garantía de 24 meses = técnico-administrativo
(es compromiso nuestro); certificación del equipo = técnico normativo (es atributo del equipo);
manual en español = técnico-administrativo; repuestos disponibles en Chile = técnico-administrativo;
certificado de calibración que se entrega con el equipo = técnico INCLUYE.
[Regla de corte pendiente de confirmación de CA — ver notas 0.5]

COMPORTAMIENTO: todos estos ítems se presentan PRECARGADOS COMO CUMPLIDOS —siempre incluimos lo
que el cliente pide—, con un check de confirmación por ítem que el asistente debe marcar. Es
confirmación, no redacción.

Cada ítem lleva: qué exige la base (cita literal + fuente) · qué se compromete · criticidad
heredada · check de confirmación.

BLOQUEO: un check sin marcar bloquea igual que un NO CUMPLE técnico. No se avanza con ítems
precargados que nadie miró.

REGLA DE ESTRICTA SUJECIÓN: nunca comprometas un programa más extenso, más frecuente o más largo
que el exigido. Si las bases piden 8 horas de capacitación, se comprometen 8. Ofrecer 16 sin que
otorgue puntaje es amarrarse gratis.
```

---

## 2. PARTE IX (v1.1) — ETAPA 7 · REVERIFICACIÓN DE ROJOS Y CERTIFICADO DE ADMISIBILIDAD

> La **segunda pasada** de este texto se mantiene en el Prompt 4 v2.0 (Parte IX) y corre en la pasada
> final del AUDITOR. Lo que queda reservado aquí es el **certificado de admisibilidad**.

```
SEGUNDA PASADA — sobre TODOS los ítems INADMISIBLE declarados CUMPLE, incluidos:
 · los cerrados por deducción documentada;
 · los cerrados por equivalencia de lenguaje o por traducción corregida;
 · los marcados "criticidad sospechosa" (tratados como INADMISIBLE).
Vuelve al documento fuente, relee cada cita (y cada eslabón de cada deducción) y reconfirma el valor.
Trabajas en pasada independiente: no des por buena tu propia conclusión anterior. Si en la segunda
lectura el dato no aparece donde dijiste, o no dice lo que dijiste, o la deducción no se sostiene,
RECTIFICA y explica la diferencia.

CERTIFICADO DE ADMISIBILIDAD — salida de cierre
Lista única con TODAS las causales de inadmisibilidad de la línea, incluidas las de criticidad
sospechosa, y su estado: CUMPLIDA / NO CUMPLIDA / PENDIENTE, cada una con su fuente y, si está
pendiente, con su motivo (RIESGO o POR AFINAR) y la ruta para cerrarla. Es el objeto que consume el
bloqueo general previo a la postulación en MercadoPúblico: debe permitir señalar el ítem exacto que
impide subir la oferta.

TODO BLOQUEO SE ACOMPAÑA DE SU RUTA DE SALIDA. Nunca "no cumple" a secas.
```

---

## 3. FRAGMENTOS DEL JSON (v1.1)

```json
{
  "tecnico_administrativo": [
    {
      "linea": 1,
      "items": [
        { "n": 1, "materia": "capacitacion | despacho | plazo | instalacion | postventa | garantia | mantencion | repuestos | documentacion | otro",
          "exige_base_literal": "", "fuente_bases": "", "se_compromete": "",
          "criticidad": "INADMISIBLE | PUNTAJE | COMPROMISO | SIN_CLASIFICAR",
          "precargado_cumplido": true, "check_confirmado": false }
      ]
    }
  ],

  "mensajes_proveedor": [
    { "proveedor": "", "productos_incluidos": [""], "mensaje": "" }
  ],

  "certificado_admisibilidad": [
    { "linea": 1, "causal": "", "fuente": "", "criticidad_sospechosa": false,
      "estado": "CUMPLIDA | NO_CUMPLIDA | PENDIENTE",
      "motivo_pendiente": "RIESGO | POR_AFINAR | null", "ruta_cierre": "" }
  ],

  "bloqueos": [
    { "tipo": "", "detalle": "", "item_ref": "", "ruta_desbloqueo": "" }
  ]
}
```

> En v2.0, `mensajes_proveedor` lo arma el sistema (mensaje unificado) y `bloqueos` lo calcula el código.

---

## 4. VISTA EN PANTALLA (v1.1, caso LS-150)

```
REQUISITOS TÉCNICO-ADMINISTRATIVOS                          (confirmar uno a uno)
──────────────────────────────────────────────────────────────────────────────
 ☐ [ítems de la licitación]

CERTIFICADO DE ADMISIBILIDAD — LÍNEA 1
──────────────────────────────────────────────────────────────────────────────
 ⏳ Menús en español                       PENDIENTE · RIESGO      → confirmar con proveedor
 ⏳ Certificado de calibración             PENDIENTE · POR AFINAR  → confirmar o cotizar
 ✅ Norma DIN 5032-7 Clase B               CUMPLIDA   (Ficha p.2)
 ✅ Accesorios: tapa, baterías, maleta     CUMPLIDA   (Ficha p.4)
──────────────────────────────────────────────────────────────────────────────
 🚫 GENERACIÓN DE ANEXOS BLOQUEADA — 2 causales pendientes
```

---

## 5. AUTOCHEQUEO (ítems de la v1.1 que aplican a este bloque)

```
 ⑮ ¿El certificado de admisibilidad recoge TODAS las causales rojas, incluidas las sospechosas?
 ㉗ ¿Separé lo técnico-administrativo de la matriz técnica y no ofrecí más de lo exigido?
 ㉚ ¿Todo bloqueo tiene su ruta de salida?
```
