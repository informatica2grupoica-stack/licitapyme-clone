// app/lib/checklist-comercial.ts
// MÓDULO "INFORMACIÓN COMERCIAL" — generación del checklist y reglas de la máquina de estados.
//
// IDEA CENTRAL: el checklist NO se escribe a mano. El informe de viabilidad ya dice qué necesita
// esta licitación para ganarse (criterios con su ponderación, requisitos de admisibilidad, anexos
// propios a crear, líneas del manifiesto). Este módulo traduce ese informe a filas accionables.
//
// clave_origen es la huella ESTABLE de cada punto: al resincronizar tras un re-análisis se agregan
// los puntos nuevos sin duplicar ni pisar lo que el asesor ya aprobó.

export type BloqueChecklist = 'ADMINISTRATIVO' | 'TECNICO' | 'COMERCIAL';
export type TipoItem = 'documento' | 'dato' | 'precio';
export type EstadoItem = 'PENDIENTE' | 'CARGADO' | 'APROBADO' | 'OBSERVADO';
export type Criticidad = 'ADMISIBILIDAD_DURA' | 'PUNTAJE_CONDICIONANTE' | 'COMPROMISO_EJECUCION' | 'INFORMATIVO';

export interface ItemGenerado {
  bloque:      BloqueChecklist;
  tipo:        TipoItem;
  titulo:      string;
  descripcion: string | null;
  criticidad:  Criticidad;
  ponderacion: number | null;
  fuenteCita:  string | null;
  origen:      'viabilidad' | 'modalidad' | 'manual';
  claveOrigen: string;
  generable:   boolean;
  lineaNumero: number | null;
  orden:       number;
}

export interface ItemChecklist extends Omit<ItemGenerado, 'fuenteCita' | 'claveOrigen' | 'lineaNumero'> {
  id: number;
  fuente_cita: string | null;
  clave_origen: string;
  linea_numero: number | null;
  ofertamos: boolean | null;
  estado: EstadoItem;
  valor_texto: string | null;
  valor_numero: number | null;
  documento_url: string | null;
  documento_nombre: string | null;
  observacion: string | null;
  cargado_por: number | null;
  cargado_por_nombre: string | null;
  cargado_at: string | null;
  aprobado_por: number | null;
  aprobado_por_nombre: string | null;
  aprobado_at: string | null;
}

// ─── Etapas donde el módulo está vivo ────────────────────────────────────────────
// A partir de ANEXOS y hacia adelante. NO solo ANEXOS: si la pestaña desapareciera al
// avanzar, se perdería la evidencia de auditoría justo cuando más se necesita (una
// licitación postulada o adjudicada tiene que poder mostrar quién aprobó qué).
const ETAPAS_CON_COMERCIAL = new Set([
  'ANEXOS', 'ANEXO_LISTO', 'VISADO', 'POSTULADA', 'POSIBLE_ADJ', 'ADJUDICADA', 'PERDIDA',
]);

export function tieneInformacionComercial(estadoPipeline?: string | null): boolean {
  if (!estadoPipeline) return false;
  return ETAPAS_CON_COMERCIAL.has(String(estadoPipeline).toUpperCase());
}

// ─── Clasificación de criterios ──────────────────────────────────────────────────
// El criterio de evaluación dice DÓNDE se ganan los puntos; el bloque dice QUIÉN lo prepara.
// Precio y plazo los pone el asistente en el bloque comercial; el resto (experiencia,
// cumplimiento de especificaciones, garantía, plazo de garantía…) es respaldo técnico.
const RE_PRECIO = /\b(precio|econ[oó]mic|oferta\s+econ|valor\s+ofertad|monto\s+ofertad)/i;
const RE_PLAZO  = /\b(plazo\s+de\s+entrega|tiempo\s+de\s+entrega|plazo\s+ofertad|d[ií]as\s+de\s+entrega)/i;

function bloqueDeCriterio(nombre: string): BloqueChecklist {
  if (RE_PRECIO.test(nombre) || RE_PLAZO.test(nombre)) return 'COMERCIAL';
  return 'TECNICO';
}

/** Normaliza un texto a una clave estable (para clave_origen). */
function slug(s: string): string {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '').slice(0, 120) || 'sin_nombre';
}

function critDe(v: unknown): Criticidad {
  const s = String(v || '').toUpperCase();
  if (s === 'ADMISIBILIDAD_DURA' || s === 'PUNTAJE_CONDICIONANTE' || s === 'COMPROMISO_EJECUCION') return s;
  return 'INFORMATIVO';
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/** ¿La licitación se cotiza línea por línea? (eje "cómo se cotiza", no "a quién se adjudica"). */
export function esPorLinea(informe: any): boolean {
  return String(informe?.modalidad?.tipo || '').toLowerCase() === 'por_linea';
}

/** La modalidad no quedó determinada y el asesor tiene que resolverla antes de cargar precios. */
export function modalidadDudosa(informe: any): boolean {
  const t = String(informe?.modalidad?.tipo || '').toLowerCase();
  return informe?.modalidad?.estado === 'REVISION_HUMANA' || (t !== 'por_linea' && t !== 'suma_alzada');
}

/** Líneas ofertables, desde el manifiesto de productos del informe (con respaldos). */
export function lineasDelInforme(informe: any): Array<{ linea: number; descripcion: string; cantidad: number | null; unidad: string | null }> {
  const crudo: any[] =
    (Array.isArray(informe?.manifiesto_productos) && informe.manifiesto_productos) ||
    (Array.isArray(informe?.productos?.items) && informe.productos.items) ||
    (Array.isArray(informe?.costeo?.items) && informe.costeo.items) || [];

  const vistas = new Set<number>();
  const out: Array<{ linea: number; descripcion: string; cantidad: number | null; unidad: string | null }> = [];
  crudo.forEach((it, i) => {
    const linea = Number(it?.linea ?? it?.numero ?? i + 1) || i + 1;
    if (vistas.has(linea)) return;   // el manifiesto a veces repite la línea por sub-ítem
    vistas.add(linea);
    out.push({
      linea,
      descripcion: String(it?.descripcion || it?.nombre || it?.producto || `Línea ${linea}`).slice(0, 280),
      cantidad: num(it?.cantidad),
      unidad: it?.unidad_medida || it?.unidad || null,
    });
  });
  return out.sort((a, b) => a.linea - b.linea);
}

// ═══ GENERACIÓN ═════════════════════════════════════════════════════════════════

/**
 * Traduce el informe de viabilidad al checklist de trabajo.
 * Tolera v2 y v3: los campos cambiaron de sitio entre versiones (requisitos_admisibilidad vs
 * capa_c_admisibilidad, orden_anexos_propios vs documentos_infaltables) y aquí se leen ambos.
 */
export function generarItemsDesdeViabilidad(informe: any): ItemGenerado[] {
  const items: ItemGenerado[] = [];
  const adm = informe?.requisitos_admisibilidad || {};
  const capaC = informe?.capa_c_admisibilidad || {};
  let orden = 0;
  const push = (it: Omit<ItemGenerado, 'orden'>) => { items.push({ ...it, orden: orden++ }); };

  // ── BLOQUE ADMINISTRATIVO ─────────────────────────────────────────────────────
  // 1) Anexos propios que la IA mandó crear (v3) — el orden de trabajo de la Fase 4.
  const anexos: any[] = Array.isArray(adm.orden_anexos_propios) ? adm.orden_anexos_propios : [];
  for (const a of anexos) {
    const titulo = String(a?.que_crear || '').trim();
    if (!titulo) continue;
    push({
      bloque: 'ADMINISTRATIVO', tipo: 'documento', titulo: titulo.slice(0, 280),
      descripcion: [a?.que_debe_contener, a?.por_que].filter(Boolean).join(' — ') || null,
      criticidad: critDe(a?.criticidad), ponderacion: null,
      fuenteCita: a?.fuente || null, origen: 'viabilidad',
      claveOrigen: `anexo:${slug(titulo)}`,
      generable: true,          // candidato a generarse desde la app (Fase 2)
      lineaNumero: null,
    });
  }

  // 2) Documentos infaltables (v2.1) — mismo rol que los anexos propios en el informe viejo.
  const infaltables: any[] = Array.isArray(informe?.documentos_infaltables) ? informe.documentos_infaltables : [];
  for (const d of infaltables) {
    const titulo = String(d?.exige || '').trim();
    if (!titulo) continue;
    const clave = `anexo:${slug(titulo)}`;
    if (items.some(i => i.claveOrigen === clave)) continue;   // ya vino por orden_anexos_propios
    push({
      bloque: 'ADMINISTRATIVO', tipo: 'documento', titulo: titulo.slice(0, 280),
      descripcion: d?.cubre || null, criticidad: 'ADMISIBILIDAD_DURA', ponderacion: null,
      fuenteCita: d?.fuente || null, origen: 'viabilidad',
      claveOrigen: clave, generable: true, lineaNumero: null,
    });
  }

  // 3) Garantías y formalidades que las bases exigen. Solo se crean si APLICAN: un checklist
  //    con quince "no aplica" no lo lee nadie.
  const exigencias: Array<{ cond: boolean; clave: string; titulo: string; desc: string | null; fuente: string | null; tipo: TipoItem }> = [
    {
      cond: !!adm.seriedad_oferta?.exige,
      clave: 'garantia_seriedad', titulo: 'Garantía de seriedad de la oferta',
      desc: 'Tomar el instrumento y adjuntarlo antes del cierre.', fuente: adm.seriedad_oferta?.fuente || null, tipo: 'documento',
    },
    {
      cond: !!adm.fiel_cumplimiento?.exige,
      clave: 'garantia_fiel_cumplimiento', titulo: 'Garantía de fiel cumplimiento',
      desc: [adm.fiel_cumplimiento?.forma && `Forma: ${adm.fiel_cumplimiento.forma}`, adm.fiel_cumplimiento?.plazo_entrega && `Plazo: ${adm.fiel_cumplimiento.plazo_entrega}`].filter(Boolean).join(' · ') || null,
      fuente: adm.fiel_cumplimiento?.fuente || null, tipo: 'documento',
    },
    {
      cond: !!(adm.boleta?.aplica ?? capaC.boleta_aplica),
      clave: 'boleta_garantia', titulo: 'Boleta de garantía',
      desc: adm.boleta?.detalle || (capaC.umbral_utm ? `Umbral: ${capaC.umbral_utm} UTM` : null),
      fuente: adm.boleta?.fuente || null, tipo: 'documento',
    },
    {
      cond: !!(adm.firma_puno_y_letra?.exigida ?? capaC.firma_puno_y_letra),
      clave: 'firma_puno_y_letra', titulo: 'Firma de puño y letra en los anexos',
      desc: adm.firma_puno_y_letra?.evidencia_textual || 'Los anexos deben ir firmados a mano, escaneados. Firma digital no sirve.',
      fuente: adm.firma_puno_y_letra?.fuente || null, tipo: 'dato',
    },
    {
      cond: !!adm.contrato?.exige,
      clave: 'contrato', titulo: 'Suscripción de contrato',
      desc: adm.contrato?.plazos ? `Plazos: ${adm.contrato.plazos}` : null,
      fuente: adm.contrato?.fuente || null, tipo: 'dato',
    },
    {
      cond: !!(adm.cotizar_100?.aplica ?? capaC.cotizar_100_obligatorio?.aplica ?? informe?.modalidad?.cotizar_100_obligatorio),
      clave: 'cotizar_100', titulo: 'Cotizar el 100% de los ítems',
      desc: 'Si queda un ítem sin cotizar, la oferta se declara inadmisible. Revisar la planilla completa.',
      fuente: adm.cotizar_100?.fuente || capaC.cotizar_100_obligatorio?.fuente || null, tipo: 'dato',
    },
  ];
  for (const e of exigencias) {
    if (!e.cond) continue;
    push({
      bloque: 'ADMINISTRATIVO', tipo: e.tipo, titulo: e.titulo, descripcion: e.desc,
      criticidad: 'ADMISIBILIDAD_DURA', ponderacion: null, fuenteCita: e.fuente,
      origen: 'viabilidad', claveOrigen: `adm:${e.clave}`, generable: false, lineaNumero: null,
    });
  }

  // 4) Bloqueantes sueltos que la IA detectó y no calzan en ninguna casilla fija.
  const bloqueantes: any[] = [
    ...(Array.isArray(adm.bloqueantes) ? adm.bloqueantes : []),
    ...(Array.isArray(capaC.bloqueantes) ? capaC.bloqueantes : []),
  ];
  for (const b of bloqueantes) {
    const titulo = String(typeof b === 'string' ? b : (b?.item || b?.titulo || '')).trim();
    if (!titulo) continue;
    const clave = `bloqueante:${slug(titulo)}`;
    if (items.some(i => i.claveOrigen === clave)) continue;
    push({
      bloque: 'ADMINISTRATIVO', tipo: 'dato', titulo: titulo.slice(0, 280),
      descripcion: (typeof b === 'object' && b?.efecto) || null, criticidad: 'ADMISIBILIDAD_DURA',
      ponderacion: null, fuenteCita: (typeof b === 'object' && b?.fuente) || null,
      origen: 'viabilidad', claveOrigen: clave, generable: false, lineaNumero: null,
    });
  }

  // ── BLOQUES TÉCNICO Y COMERCIAL: los criterios de evaluación ──────────────────
  // Cada criterio con el que se nos evalúa es un punto que hay que respaldar. Se arrastra
  // la ponderación efectiva y la forma de aplicación para que el asesor vea, al lado del
  // check, cuántos puntos se juega en esa fila.
  // El plazo aparece por dos lados: como criterio evaluado y como rango de admisibilidad. Es UN
  // solo dato a comprometer, así que se fusionan bajo la misma clave — si no, el asistente tiene
  // que escribir el mismo número dos veces y el asesor aprobarlo dos veces.
  const rango = adm.plazo_entrega_rango;
  const hayRango = !!(rango && (rango.min || rango.max));
  const textoRango = hayRango
    ? `Rango admisible: ${rango.min || '—'} a ${rango.max || '—'}.${rango.fuera_de_rango_inadmisible === false ? '' : ' Fuera de rango la oferta es inadmisible.'}`
    : null;
  const CLAVE_PLAZO = 'comercial:plazo_entrega';

  const criterios: any[] = Array.isArray(informe?.criterios_evaluacion?.criterios) ? informe.criterios_evaluacion.criterios : [];
  for (const c of criterios) {
    const nombre = String(c?.nombre || '').trim();
    if (!nombre) continue;
    // El criterio precio NO se convierte en un punto documental: se cubre con el bloque de
    // precios (abajo), que es el que respeta la modalidad. Duplicarlo confunde al asistente.
    if (RE_PRECIO.test(nombre)) continue;

    const pond = num(c?.ponderacion_efectiva) ?? num(c?.ponderacion) ?? num(c?.ponderacion_nominal);
    const esPlazo = RE_PLAZO.test(nombre);
    const desc = c?.forma_aplicacion || c?.medio_verificacion || null;
    push({
      bloque: bloqueDeCriterio(nombre), tipo: esPlazo ? 'dato' : 'documento',
      titulo: nombre.slice(0, 280),
      descripcion: esPlazo ? [desc, textoRango].filter(Boolean).join(' · ') || null : desc,
      // Si el plazo además tiene rango excluyente, manda la admisibilidad: no basta con
      // "sacar menos puntos", fuera de rango la oferta se cae.
      criticidad: esPlazo && hayRango ? 'ADMISIBILIDAD_DURA' : 'PUNTAJE_CONDICIONANTE',
      ponderacion: pond, fuenteCita: c?.fuente || rango?.fuente || null, origen: 'viabilidad',
      claveOrigen: esPlazo ? CLAVE_PLAZO : `criterio:${slug(nombre)}`,
      generable: false, lineaNumero: null,
    });
  }

  // Plazo de entrega cuando NO es criterio evaluado: igual hay que comprometer un número.
  if (hayRango && !items.some(i => i.claveOrigen === CLAVE_PLAZO)) {
    push({
      bloque: 'COMERCIAL', tipo: 'dato', titulo: 'Plazo de entrega ofertado',
      descripcion: textoRango, criticidad: 'ADMISIBILIDAD_DURA', ponderacion: null,
      fuenteCita: rango.fuente || null, origen: 'viabilidad',
      claveOrigen: CLAVE_PLAZO, generable: false, lineaNumero: null,
    });
  }

  // ── BLOQUE COMERCIAL: el precio, con la forma que manda la modalidad ──────────
  // suma_alzada → un único precio total. por_linea → un precio por línea, y el asistente
  // marca a cuáles se oferta (se puede postular a un subconjunto).
  if (esPorLinea(informe)) {
    const lineas = lineasDelInforme(informe);
    if (lineas.length > 0) {
      for (const l of lineas) {
        push({
          bloque: 'COMERCIAL', tipo: 'precio',
          titulo: `Línea ${l.linea} — ${l.descripcion}`,
          descripcion: [l.cantidad != null && `Cantidad: ${l.cantidad}`, l.unidad].filter(Boolean).join(' ') || null,
          criticidad: 'ADMISIBILIDAD_DURA', ponderacion: null, fuenteCita: null,
          origen: 'modalidad', claveOrigen: `precio:linea:${l.linea}`, generable: false,
          lineaNumero: l.linea,
        });
      }
    } else {
      // Es por línea pero el manifiesto vino vacío: no inventamos líneas, pedimos el total y
      // que el asesor lo revise. Mejor un punto honesto que un checklist falso.
      push({
        bloque: 'COMERCIAL', tipo: 'precio', titulo: 'Precio ofertado (revisar líneas)',
        descripcion: 'La licitación se cotiza por línea, pero el informe no trajo el detalle de líneas. Cargar el total y verificar el formulario económico.',
        criticidad: 'ADMISIBILIDAD_DURA', ponderacion: null, fuenteCita: null,
        origen: 'modalidad', claveOrigen: 'precio:total', generable: false, lineaNumero: null,
      });
    }
  } else {
    push({
      bloque: 'COMERCIAL', tipo: 'precio', titulo: 'Precio total ofertado',
      descripcion: 'Suma alzada: un único total para toda la licitación.',
      criticidad: 'ADMISIBILIDAD_DURA', ponderacion: null, fuenteCita: null,
      origen: 'modalidad', claveOrigen: 'precio:total', generable: false, lineaNumero: null,
    });
  }

  return items;
}

// ═══ RESUMEN Y GATE ═════════════════════════════════════════════════════════════

export interface ResumenChecklist {
  total: number;
  aprobados: number;
  porAprobar: number;          // esperando visto bueno del asesor (CARGADO)
  pendientes: number;
  observados: number;
  bloqueantesPendientes: number;
  listoParaPostular: boolean;
  avance: number;              // 0-100
}

export function resumirChecklist(items: Array<Pick<ItemChecklist, 'estado' | 'criticidad' | 'tipo' | 'ofertamos'>>): ResumenChecklist {
  // En por-línea, una línea que decidimos NO ofertar no cuenta para el avance: descartarla es
  // una decisión válida, no una tarea pendiente.
  const vivos = items.filter(i => !(i.tipo === 'precio' && i.ofertamos === false));
  const aprobados  = vivos.filter(i => i.estado === 'APROBADO').length;
  const porAprobar = vivos.filter(i => i.estado === 'CARGADO').length;
  const observados = vivos.filter(i => i.estado === 'OBSERVADO').length;
  const pendientes = vivos.filter(i => i.estado === 'PENDIENTE').length;
  const bloqueantesPendientes = vivos.filter(
    i => i.criticidad === 'ADMISIBILIDAD_DURA' && i.estado !== 'APROBADO',
  ).length;

  return {
    total: vivos.length, aprobados, porAprobar, pendientes, observados,
    bloqueantesPendientes,
    listoParaPostular: vivos.length > 0 && bloqueantesPendientes === 0,
    avance: vivos.length ? Math.round((aprobados / vivos.length) * 100) : 0,
  };
}

/**
 * Transiciones válidas de la máquina de estados. Devuelve el estado destino o null si la
 * acción no aplica. El control de QUIÉN puede hacer cada acción va en la ruta API.
 */
export function transicion(actual: EstadoItem, accion: 'CARGAR' | 'APROBAR' | 'OBSERVAR' | 'REABRIR'): EstadoItem | null {
  switch (accion) {
    // Cargar siempre deja el punto listo para visar, incluso si venía OBSERVADO (es el rebote
    // corregido) o APROBADO (editar algo aprobado lo devuelve a revisión: un dato aprobado que
    // cambió sin que nadie lo vea es exactamente el error que este módulo existe para evitar).
    case 'CARGAR':  return 'CARGADO';
    case 'APROBAR': return actual === 'CARGADO' ? 'APROBADO' : null;
    case 'OBSERVAR': return (actual === 'CARGADO' || actual === 'APROBADO') ? 'OBSERVADO' : null;
    case 'REABRIR': return actual === 'APROBADO' ? 'PENDIENTE' : null;
    default: return null;
  }
}
