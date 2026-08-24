// app/lib/checklist-comercial.ts
// MÓDULO "INFORMACIÓN COMERCIAL" — generación del checklist y reglas de la máquina de estados.
//
// IDEA CENTRAL: el checklist NO se escribe a mano. El informe de viabilidad ya dice qué necesita
// esta licitación para ganarse (criterios con su ponderación, requisitos de admisibilidad, anexos
// propios a crear, líneas del manifiesto). Este módulo traduce ese informe a filas accionables.
//
// clave_origen es la huella ESTABLE de cada punto: al resincronizar tras un re-análisis se agregan
// los puntos nuevos sin duplicar ni pisar lo que el asesor ya aprobó.

import { lineasTecnicasDelInforme } from '@/app/lib/auditor-tecnico-core';

export type BloqueChecklist = 'ADMINISTRATIVO' | 'TECNICO' | 'COMERCIAL';
export type TipoItem = 'documento' | 'dato' | 'precio' | 'linea_tecnica';
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

/** Un documento adjunto a un punto — un punto puede tener varios (migración 49). */
export interface DocumentoChecklist {
  id: number;
  url: string;
  nombre: string;
  subidoPorNombre: string | null;
  subidoAt: string | null;
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
  documentos: DocumentoChecklist[];
  observacion: string | null;
  cargado_por: number | null;
  cargado_por_nombre: string | null;
  cargado_at: string | null;
  aprobado_por: number | null;
  aprobado_por_nombre: string | null;
  aprobado_at: string | null;
}

// ─── Etapas donde el módulo está vivo ────────────────────────────────────────────
// Desde ASIGNADO en adelante (pedido explícito del usuario, 3-ago-2026): el precio/comercial es
// LO PRIMERO que arma el asistente, apenas se asigna la licitación y corre la viabilidad — no
// tenía sentido que la pestaña recién apareciera en ANEXOS, cuando el precio ya debería estar
// listo. NO se saca ninguna etapa posterior: si la pestaña desapareciera al avanzar, se perdería
// la evidencia de auditoría justo cuando más se necesita (una licitación postulada o adjudicada
// tiene que poder mostrar quién aprobó qué).
//
// Corrección del mismo pedido (4-ago-2026): "lo primero" no significa "todo junto". El flujo real
// del asistente es (1) fijar el precio con el asesor apenas hay costeo — eso es SOLO el bloque
// COMERCIAL — y (2) recién cuando la licitación entra a ANEXOS, ocuparse de los anexos
// administrativos y técnicos. Mostrar los 3 bloques desde ASIGNADO (como quedó ayer) hacía
// aparecer ADMINISTRATIVO/TECNICO sin que hubiera nada que hacer ahí todavía, antes de que el
// asesor siquiera hubiera revisado el precio. Por eso se separa en dos etapas: COMERCIAL sigue
// viva desde ASIGNADO (sin cambios); ADMINISTRATIVO/TECNICO recién desde ANEXOS. La GENERACIÓN de
// ítems no cambia — el informe de viabilidad ya arma los 3 bloques de una vez cuando se
// sincroniza — esto es solo qué se MUESTRA en cada etapa, para no tener que reabrir sincronizar()
// otra vez al llegar a ANEXOS ni arriesgar perder ítems ya generados.
const ETAPAS_CON_COMERCIAL = new Set([
  'ASIGNADO', 'EN_PROCESO', 'ANEXOS', 'ANEXO_LISTO', 'VISADO', 'POSTULADA', 'POSIBLE_ADJ', 'ADJUDICADA', 'PERDIDA',
]);
const ETAPAS_CON_ANEXOS = new Set([
  'ANEXOS', 'ANEXO_LISTO', 'VISADO', 'POSTULADA', 'POSIBLE_ADJ', 'ADJUDICADA', 'PERDIDA',
]);

export function tieneInformacionComercial(estadoPipeline?: string | null): boolean {
  if (!estadoPipeline) return false;
  return ETAPAS_CON_COMERCIAL.has(String(estadoPipeline).toUpperCase());
}

// El bloque COMERCIAL (precio, plazo, presupuesto) se trabaja apenas se asigna — ver el
// comentario de arriba. ADMINISTRATIVO/TECNICO (los anexos) recién se muestran cuando la
// licitación entra a la etapa ANEXOS, aunque ya estén generados desde antes.
export function tieneAnexosAuditor(estadoPipeline?: string | null): boolean {
  if (!estadoPipeline) return false;
  return ETAPAS_CON_ANEXOS.has(String(estadoPipeline).toUpperCase());
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

// ── Dedupe de documentos/exigencias ADMINISTRATIVAS entre fuentes que se solapan ────────────────
// El informe describe el mismo requisito por varios caminos que NO se cruzan entre sí: la lista
// libre de "anexos propios a crear" (orden_anexos_propios), el campo legado documentos_infaltables
// (v2.1, mismo rol, redactado distinto — ver más abajo), y los booleanos estructurados de
// garantías/contrato/cotizar_100/etc. Cada fuente titula el mismo Formato N°X con palabras en
// otro orden ("Formato N°1: Identificación del Oferente" vs "Identificación del Oferente (Formato
// N°1)"), así que comparar la clave_origen EXACTA (lo que había antes, solo en 2 de las 4 fuentes)
// no los pesca. Caso real reportado 24-ago-2026: 7 Formatos + Garantía de Fiel Cumplimiento
// duplicados en el bloque ADMINISTRATIVO de una sola licitación.
//
// Se dedupe por dos señales:
//  (a) el identificador de Formato/Anexo/Formulario citado en el título, si AMBOS lo traen — la
//      señal más fuerte, sobrevive a cualquier redacción distinta. Es un VETO en ambos sentidos:
//      mismo identificador → son el mismo documento (aunque el resto del texto no se parezca);
//      identificadores EXPLÍCITOS pero DISTINTOS → NUNCA son el mismo documento, aunque el resto
//      del texto sea idéntico (caso real: "Anexo N°2 (Declaración Jurada Simple UTP)" y
//      "Anexo N°3 (Declaración Jurada Simple UTP)" — mismo texto, dos anexos distintos). El
//      identificador incluye el sub-índice completo ("6.1" ≠ "6.2" ≠ "6" — caso real: 7 Anexos
//      N°6.1 a N°6.7, cada uno con las especificaciones de un equipo médico distinto, que un
//      regex que solo miraba el dígito base ("6") fundía en uno solo).
//  (b) si NINGUNO de los dos trae identificador (o solo uno lo trae), el título SIN esa
//      anotación, comparado por contención — mismo criterio que ya usa clasificacion.ts para
//      resolver nombres que la IA no citó letra por letra.
// La PALABRA (Formato/Anexo/Formulario) es parte del identificador, no solo el número: en las
// bases chilenas "Anexo" y "Formulario"/"Formato" suelen ser series de numeración
// INDEPENDIENTES — casos reales: "Formulario N°1: Identificación del Oferente" (persona) y
// "Anexo N°1: Programa de Integridad" (otro tema por completo) comparten el "1" pero NO son el
// mismo documento; ignorar la palabra los fundía por puro accidente de numeración.
const RE_NUM_FORMATO = /(formato|anexo|formulario)\s*n?[°ºo]?\s*[.]?\s*(\d{1,2}(?:\s*[.\-]\s*[a-z0-9]{1,3})?)\b/i;
const RE_STRIP_FORMATO = /\(?\s*(?:formato|anexo|formulario)\s*n?[°ºo]?\s*[.]?\s*\d{1,2}(?:\s*[.\-]\s*[a-z0-9]{1,3})?\s*\)?\s*:?\s*/gi;

// Exportadas: el script de limpieza de duplicados ya materializados (checklist_comercial viejo,
// insertado antes de este fix) reusa exactamente este criterio — ver scripts/limpiar-checklist-duplicados.mjs.
export function numeroDeFormatoEn(texto: string): string | null {
  const m = RE_NUM_FORMATO.exec(String(texto || ''));
  if (!m) return null;
  const palabra = m[1].toLowerCase();
  const numero = m[2].replace(/[.\-\s]/g, '').toLowerCase();   // "6.1"/"6 . 1" → "61"; "5-A" → "5a"
  return `${palabra}:${numero}`;
}
export function nucleoDeTitulo(texto: string): string {
  // NO usar slug() acá: su fallback '|| sin_nombre' convertiría CUALQUIER título que sea SOLO
  // "Anexo N°1" (sin texto propio, todo el título es la anotación de número) en el mismo string
  // 'sin_nombre' que "Anexo N°2", "Anexo N°3"... — colapsando anexos DISTINTOS en un solo grupo.
  // Vacío real (sin núcleo propio) debe devolver '' para que nucleosCoinciden() lo descarte.
  const restante = String(texto || '')
    .replace(RE_STRIP_FORMATO, ' ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return restante;
}
export function nucleosCoinciden(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  // Contención, pero con dos guardas — sin ellas, un núcleo genérico de una sola palabra
  // ("garantia") hacía match con CUALQUIER frase que la mencionara, aunque describiera un
  // instrumento de garantía DISTINTO (caso real 2905-36-LR26: "Formulario N°4: Garantía" se
  // fusionaba con "Garantía de seriedad de la oferta" Y "Garantía de fiel cumplimiento" — dos
  // garantías distintas — solo porque las tres contienen la palabra "garantia"):
  //  · el más corto debe ser sustancial (≥15 chars) — descarta palabras sueltas genéricas.
  //  · el más corto debe cubrir una porción real del más largo (≥45%) — no basta con que quepa.
  const corto = a.length <= b.length ? a : b;
  const largo = a.length <= b.length ? b : a;
  // Prefijo: el título largo empieza EXACTAMENTE con el corto y lo único que agrega es una
  // precisión del mismo documento ("Garantía de fiel cumplimiento" ⊂ "Garantía de fiel
  // cumplimiento de contrato (Póliza/Certificado de fianza)" — caso real 2724-35-LP26, que
  // quedaba fuera por un pelo: 0.44 de cobertura contra el mínimo de 0.45). Empezar igual es
  // una señal mucho más fuerte que caber en cualquier parte, así que se acepta con cobertura
  // menor, pero exigiendo un núcleo más largo (≥20) para no fundir genéricos.
  if (corto.length >= 20 && largo.startsWith(corto)) return true;
  return corto.length >= 15 && largo.includes(corto) && corto.length / largo.length >= 0.45;
}

interface EntradaAdmin { numero: string | null; nucleo: string }

function coincidenEntradas(a: EntradaAdmin, b: EntradaAdmin): boolean {
  // Ambos citan un identificador explícito → ese identificador manda, sea igual o distinto
  // (nunca cae al núcleo: dos anexos con el MISMO texto genérico pero número distinto no son
  // el mismo documento).
  if (a.numero != null && b.numero != null) return a.numero === b.numero;
  return nucleosCoinciden(a.nucleo, b.nucleo);
}

/** Registro compartido por TODA una corrida de generarItemsDesdeViabilidad — ver arriba. */
function creaRegistroAdmin() {
  const registrados: EntradaAdmin[] = [];
  return {
    esDuplicado(titulo: string): boolean {
      const candidato: EntradaAdmin = { numero: numeroDeFormatoEn(titulo), nucleo: nucleoDeTitulo(titulo) };
      return registrados.some(r => coincidenEntradas(candidato, r));
    },
    registrar(titulo: string): void {
      registrados.push({ numero: numeroDeFormatoEn(titulo), nucleo: nucleoDeTitulo(titulo) });
    },
  };
}

// ── Dedupe CONTRA LO YA PERSISTIDO (el hueco que el registroAdmin de arriba no cubre) ───────────
// registroAdmin solo compara los ítems generados EN ESTA corrida entre sí. Pero clave_origen de
// un ítem 'anexo:...' es el slug del título que redactó la IA, y sincronizar() (route.ts) inserta
// con INSERT IGNORE contra el UNIQUE(negocio_id, clave_origen) — si un re-análisis redacta el
// MISMO Anexo N°X con otras palabras ("Anexo N°6: Programa de integridad" vs "Anexo N°6 - Programa
// Integridad"), el slug cambia, el UNIQUE no lo pesca, y se inserta un duplicado real (caso
// reportado 24-ago-2026, confirmado contra producción: 83 grupos duplicados en 183 negocios,
// todos por esta única causa). Se filtra ANTES de intentar insertar, con el mismo criterio fuzzy
// (número explícito manda; si no hay, núcleo del título) — sin tocar clave_origen ni migrar datos
// existentes, así no hay riesgo de que una fila vieja con formato de clave distinto se vea como
// "nueva" y dispare el problema inverso.
export function excluirYaExistentes(nuevos: ItemGenerado[], titulosExistentesAdmin: string[]): ItemGenerado[] {
  const existentes: EntradaAdmin[] = titulosExistentesAdmin.map(t => ({ numero: numeroDeFormatoEn(t), nucleo: nucleoDeTitulo(t) }));
  return nuevos.filter(it => {
    if (it.bloque !== 'ADMINISTRATIVO' || !it.claveOrigen.startsWith('anexo:')) return true;
    const candidato: EntradaAdmin = { numero: numeroDeFormatoEn(it.titulo), nucleo: nucleoDeTitulo(it.titulo) };
    return !existentes.some(e => coincidenEntradas(candidato, e));
  });
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
export function lineasDelInforme(informe: any): Array<{ linea: number; descripcion: string; cantidad: number | null; unidad: string | null; presupuestoLinea: number | null }> {
  const crudo: any[] =
    (Array.isArray(informe?.manifiesto_productos) && informe.manifiesto_productos) ||
    (Array.isArray(informe?.productos?.items) && informe.productos.items) ||
    (Array.isArray(informe?.costeo?.items) && informe.costeo.items) || [];

  const vistas = new Set<number>();
  const out: Array<{ linea: number; descripcion: string; cantidad: number | null; unidad: string | null; presupuestoLinea: number | null }> = [];
  crudo.forEach((it, i) => {
    const linea = Number(it?.linea ?? it?.numero ?? i + 1) || i + 1;
    if (vistas.has(linea)) return;   // el manifiesto a veces repite la línea por sub-ítem
    vistas.add(linea);
    out.push({
      linea,
      descripcion: String(it?.descripcion || it?.nombre || it?.producto || `Línea ${linea}`).slice(0, 280),
      cantidad: num(it?.cantidad),
      unidad: it?.unidad_medida || it?.unidad || null,
      // Cuando las bases fijan un monto máximo INDEPENDIENTE por línea (viabilidad-ia.ts ya lo
      // detecta como señal de modalidad), cada sub-ítem del manifiesto trae el MISMO
      // presupuesto_linea — tomar el del primero (el mismo dedupe de arriba) es exacto, no una
      // aproximación. null si las bases no fijan presupuesto por línea (queda solo el global).
      presupuestoLinea: num(it?.presupuesto_linea),
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
  const push = (it: Omit<ItemGenerado, 'orden'>) => {
    const completo: ItemGenerado = { ...it, orden: orden++ };
    items.push(completo);
    // Índice de los ANEXOS/FORMATOS reales ya creados (documento a adjuntar, bloque
    // administrativo). Lo usan los bloqueantes de más abajo para pegar su advertencia sobre el
    // anexo que citan en vez de crear una fila suelta que parece otro anexo más.
    if (completo.bloque === 'ADMINISTRATIVO' && completo.tipo === 'documento') {
      const n = numeroDeFormatoEn(completo.titulo);
      if (n && !anexosPorNumero.has(n)) anexosPorNumero.set(n, completo);
    }
    return completo;
  };
  const anexosPorNumero = new Map<string, ItemGenerado>();
  const registroAdmin = creaRegistroAdmin();

  // ── BLOQUE ADMINISTRATIVO ─────────────────────────────────────────────────────
  // 1) Anexos propios que la IA mandó crear (v3) — el orden de trabajo de la Fase 4.
  const anexos: any[] = Array.isArray(adm.orden_anexos_propios) ? adm.orden_anexos_propios : [];
  for (const a of anexos) {
    const titulo = String(a?.que_crear || '').trim();
    if (!titulo || registroAdmin.esDuplicado(titulo)) continue;
    registroAdmin.registrar(titulo);
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
    if (!titulo || registroAdmin.esDuplicado(titulo)) continue;   // ya vino por otra fuente
    registroAdmin.registrar(titulo);
    push({
      bloque: 'ADMINISTRATIVO', tipo: 'documento', titulo: titulo.slice(0, 280),
      descripcion: d?.cubre || null, criticidad: 'ADMISIBILIDAD_DURA', ponderacion: null,
      fuenteCita: d?.fuente || null, origen: 'viabilidad',
      claveOrigen: `anexo:${slug(titulo)}`, generable: true, lineaNumero: null,
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
      // Alerta, no documento a subir con la oferta: la garantía de fiel cumplimiento se entrega
      // DESPUÉS de adjudicar (plazo propio, ver descripción). Mientras se prepara el sobre no hay
      // nada que adjuntar, así que vive abajo, en "Alertas de cumplimiento" (pedido 24-ago-2026).
      fuente: adm.fiel_cumplimiento?.fuente || null, tipo: 'dato',
    },
    {
      cond: !!(adm.boleta?.aplica ?? capaC.boleta_aplica),
      clave: 'boleta_garantia', titulo: 'Boleta de garantía',
      desc: adm.boleta?.detalle || (capaC.umbral_utm ? `Umbral: ${capaC.umbral_utm} UTM` : null),
      fuente: adm.boleta?.fuente || null, tipo: 'dato',   // misma razón que fiel cumplimiento
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
    // registroAdmin también, aunque estas 6 tengan clave fija propia (`adm:...`): la IA puede
    // haber listado la MISMA garantía dentro de orden_anexos_propios con otra redacción, y sin
    // este chequeo esta rama la duplicaba siempre — nunca comparaba contra lo ya generado.
    if (!e.cond || registroAdmin.esDuplicado(e.titulo)) continue;
    registroAdmin.registrar(e.titulo);
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
  // OJO: los bloqueantes NO se cruzan contra registroAdmin (a diferencia de las 3 fuentes de
  // arriba). Un bloqueante suele CITAR el número de un anexo como contexto de la advertencia
  // ("No firmar Anexo N°8", "Incumplir características críticas en Anexo N°4 es causal de
  // inadmisibilidad") sin SER ese anexo — es un riesgo/consecuencia, no el documento en sí. El
  // match por N° de formato los fusionaba con el documento real y se perdía la advertencia
  // (caso real: varios negocios el 24-ago-2026). Solo se dedupea contra sí mismo, exacto — el
  // problema que este loop resuelve es que adm.bloqueantes y capaC.bloqueantes pueden repetir la
  // MISMA frase literal.
  const clavesBloqueantes = new Set<string>();
  for (const b of bloqueantes) {
    const titulo = String(typeof b === 'string' ? b : (b?.item || b?.titulo || '')).trim();
    const claveLocal = slug(titulo);
    if (!titulo || clavesBloqueantes.has(claveLocal)) continue;
    clavesBloqueantes.add(claveLocal);
    // Si el bloqueante CITA un Anexo/Formato que ya existe como documento a subir, la advertencia
    // se pega a ESE anexo en vez de abrir una fila propia: como fila suelta se leía como "otro
    // anexo más", y encima aparecía abajo, entre las alertas, lejos del documento del que habla
    // (caso real 2724-35-LP26: los bloqueantes de los Anexos N°3 y N°7 — pedido 24-ago-2026).
    // No se pierde nada: el texto íntegro queda en la descripción del anexo, que ya es
    // ADMISIBILIDAD_DURA.
    const numeroCitado = numeroDeFormatoEn(titulo);
    const anexoCitado = numeroCitado ? anexosPorNumero.get(numeroCitado) : undefined;
    if (anexoCitado) {
      const efecto = (typeof b === 'object' && b?.efecto) || '';
      const aviso = [titulo, efecto].filter(Boolean).join(' — ');
      if (!(anexoCitado.descripcion || '').includes(titulo)) {
        anexoCitado.descripcion = [anexoCitado.descripcion, `⚠ ${aviso}`].filter(Boolean).join(' · ').slice(0, 1000);
      }
      anexoCitado.criticidad = 'ADMISIBILIDAD_DURA';
      continue;
    }
    push({
      bloque: 'ADMINISTRATIVO', tipo: 'dato', titulo: titulo.slice(0, 280),
      descripcion: (typeof b === 'object' && b?.efecto) || null, criticidad: 'ADMISIBILIDAD_DURA',
      ponderacion: null, fuenteCita: (typeof b === 'object' && b?.fuente) || null,
      origen: 'viabilidad', claveOrigen: `bloqueante:${slug(titulo)}`, generable: false, lineaNumero: null,
    });
  }

  // ── BLOQUE TÉCNICO: líneas con características a auditar (Auditor Técnico, Fase 1) ──────────
  // Una cabecera 'linea_tecnica' por cada línea/producto que trae caracteristicas[] en el informe.
  // A diferencia del bloque COMERCIAL (que solo genera filas por línea si esPorLinea(informe)),
  // esto se genera SIEMPRE: la auditoría de especificaciones compara productos, no depende de
  // cómo se factura — en suma alzada puede haber igual varios productos con fichas distintas
  // dentro del mismo total. Las características HIJAS (comparación real) no se generan aquí:
  // sincronizar() sigue siendo puro-DB y rápido (nada de IA en el GET); se disparan bajo demanda
  // desde la UI ("Validar línea"), ver app/lib/auditor-tecnico.ts.
  const lineasTecnicas = lineasTecnicasDelInforme(informe);
  for (const l of lineasTecnicas) {
    if (l.caracteristicas.length === 0) continue;
    push({
      bloque: 'TECNICO', tipo: 'linea_tecnica',
      titulo: `Línea ${l.linea} — ${l.nombre}`,
      descripcion: `${l.caracteristicas.length} característica(s) técnica(s) a verificar.`,
      // Marca exclusiva sin equivalente admitido: un incumplimiento aquí puede inhabilitar la
      // oferta, igual que otros puntos duros del checklist. El resto afecta puntaje, no admisibilidad.
      criticidad: l.clasificacion === 'especifico' && l.admiteEquivalente === false ? 'ADMISIBILIDAD_DURA' : 'PUNTAJE_CONDICIONANTE',
      ponderacion: null, fuenteCita: null, origen: 'viabilidad',
      claveOrigen: `tecnico:linea:${l.linea}`, generable: false, lineaNumero: l.linea,
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
    // Un criterio que ES un Anexo/Formato ("Anexo N°5: Experiencia") es un documento a llenar y
    // subir: va al bloque ADMINISTRATIVO con el resto de los anexos, y se dedupea contra ellos
    // (la IA lo suele listar por los dos lados). El resto de los criterios (requisitos formales,
    // garantía del producto, mantenciones, programa de integridad, comportamiento contractual…)
    // no tiene documento propio: son condiciones que hay que respaldar, así que bajan a "Alertas
    // de cumplimiento" — regla de oro: arriba SOLO anexos y formularios (pedido 24-ago-2026).
    const criterioEsAnexo = numeroDeFormatoEn(nombre) != null;
    if (criterioEsAnexo) {
      if (registroAdmin.esDuplicado(nombre)) continue;
      registroAdmin.registrar(nombre);
    }
    push({
      bloque: criterioEsAnexo ? 'ADMINISTRATIVO' : bloqueDeCriterio(nombre),
      tipo: criterioEsAnexo ? 'documento' : 'dato',
      titulo: nombre.slice(0, 280),
      descripcion: esPlazo ? [desc, textoRango].filter(Boolean).join(' · ') || null : desc,
      // Si el plazo además tiene rango excluyente, manda la admisibilidad: no basta con
      // "sacar menos puntos", fuera de rango la oferta se cae.
      criticidad: esPlazo && hayRango ? 'ADMISIBILIDAD_DURA' : 'PUNTAJE_CONDICIONANTE',
      ponderacion: pond, fuenteCita: c?.fuente || rango?.fuente || null, origen: 'viabilidad',
      claveOrigen: esPlazo ? CLAVE_PLAZO : `criterio:${slug(nombre)}`,
      generable: criterioEsAnexo, lineaNumero: null,
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

// ═══ ESTADO POR BLOQUE (Fase 2 — Bandeja de Aprobación Transversal) ══════════════
// La spec pide aprobar el bloque TÉCNICO y el bloque COMERCIAL por separado, no ítem por ítem.
// Deliberadamente NO se persiste un estado de bloque: se computa desde los ítems que ya existen,
// así la regla "cualquier cambio posterior invalida la aprobación" queda resuelta gratis —
// transicion() ya devuelve cualquier ítem a CARGADO al editarlo, así que un bloque "APROBADO"
// vuelve solo a POR_APROBAR en cuanto algo se recarga, sin tocar esta función.
export type EstadoBloque = 'SIN_ITEMS' | 'PENDIENTE' | 'POR_APROBAR' | 'OBSERVADO' | 'APROBADO';

/** Bloques que requieren aprobación exclusiva de CA/asesor (spec §3) — ADMINISTRATIVO queda fuera. */
export const BLOQUES_CON_APROBACION_CA = ['TECNICO', 'COMERCIAL'] as const;
export type BloqueAprobable = typeof BLOQUES_CON_APROBACION_CA[number];

/** Estado agregado de UN bloque de UN negocio, a partir de sus ítems vivos. */
export function estadoDeBloque(items: Array<Pick<ItemChecklist, 'estado' | 'tipo' | 'ofertamos'>>): EstadoBloque {
  const vivos = items.filter(i => !(i.tipo === 'precio' && i.ofertamos === false));
  if (vivos.length === 0) return 'SIN_ITEMS';
  if (vivos.some(i => i.estado === 'CARGADO')) return 'POR_APROBAR';   // prioridad: hay algo que revisar
  if (vivos.some(i => i.estado === 'OBSERVADO')) return 'OBSERVADO';   // rebotado, esperando al asistente
  if (vivos.every(i => i.estado === 'APROBADO')) return 'APROBADO';
  return 'PENDIENTE';
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

// ═══ PLAZO DE ENTREGA: nunca por sobre el máximo ════════════════════════════════
// El plazo se ofertó a mano y nadie lo cruzaba contra el rango que las bases declaran
// inadmisible: en 2724-35-LP26 se cargó "31 dias habiles" con el máximo en 30, y el asesor lo
// aprobó igual — la oferta se cae por eso. El rango ya viaja en la descripción del ítem (lo
// escribe generarItemsDesdeViabilidad más arriba), así que se lee de ahí: no hay columna nueva
// ni migración, y sirve también para las filas ya guardadas.
export const CLAVE_ITEM_PLAZO = 'comercial:plazo_entrega';

export interface RangoPlazo { min: number | null; max: number | null; inadmisibleFuera: boolean }

/** "31 dias habiles" → 31 · "hasta 30 días" → 30 · "" → null. Toma el PRIMER número del texto. */
export function diasDeTexto(texto: string | null | undefined): number | null {
  const m = /(\d{1,4})/.exec(String(texto || ''));
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/** Lee "Rango admisible: 1 día hábil a 30 días hábiles. Fuera de rango la oferta es inadmisible." */
export function rangoPlazoDeDescripcion(desc: string | null | undefined): RangoPlazo | null {
  const t = String(desc || '');
  const m = /Rango admisible:\s*(.+?)\s+a\s+([^.·]+)/i.exec(t);
  if (!m) return null;
  const min = diasDeTexto(m[1]);
  const max = diasDeTexto(m[2]);
  if (min == null && max == null) return null;
  return { min, max, inadmisibleFuera: /fuera de rango/i.test(t) };
}

export interface VeredictoPlazo { nivel: 'ok' | 'aviso' | 'error'; mensaje: string | null }

/**
 * Veredicto del plazo comprometido contra el rango de las bases.
 *  · sobre el máximo → 'error' cuando las bases lo declaran inadmisible (se bloquea la carga);
 *    'aviso' si el informe no dijo que fuera excluyente.
 *  · bajo el mínimo → siempre 'aviso': entregar antes suele aceptarse, pero hay que mirarlo.
 */
export function validarPlazoOfertado(texto: string | null | undefined, rango: RangoPlazo | null): VeredictoPlazo {
  const dias = diasDeTexto(texto);
  if (!rango || dias == null) return { nivel: 'ok', mensaje: null };
  if (rango.max != null && dias > rango.max) {
    return {
      nivel: rango.inadmisibleFuera ? 'error' : 'aviso',
      mensaje: `El plazo máximo que aceptan las bases es ${rango.max} y estás ofertando ${dias}.`
        + (rango.inadmisibleFuera ? ' Fuera de rango la oferta es inadmisible: baja el plazo antes de cargarlo.' : ''),
    };
  }
  if (rango.min != null && dias < rango.min) {
    return { nivel: 'aviso', mensaje: `Estás ofertando ${dias} y el mínimo declarado es ${rango.min}. Revísalo con el asesor antes de comprometerlo.` };
  }
  return { nivel: 'ok', mensaje: null };
}

// ═══ RE-CLASIFICAR LO YA GUARDADO ═══════════════════════════════════════════════
// sincronizar() es INSERT IGNORE puro: nunca pisa una fila existente, y está bien — el estado y
// los valores que cargó el asistente son sagrados. Pero `bloque` y `tipo` NO son datos del
// usuario: son la decisión de DÓNDE se muestra la fila. Cuando esa decisión cambia (24-ago-2026:
// arriba solo anexos y formularios; garantías, criterios sin documento y bloqueantes abajo), las
// filas viejas se quedaban en el lugar equivocado hasta borrarlas a mano. Esto las mueve, y solo
// eso: no toca estado, valor, documentos ni firmas.
export function reubicacionDeItemGuardado(
  row: { clave_origen: string | null; titulo: string; bloque: BloqueChecklist; tipo: TipoItem },
): { bloque: BloqueChecklist; tipo: TipoItem } | null {
  const clave = String(row.clave_origen || '');
  const esAnexoNumerado = numeroDeFormatoEn(row.titulo) != null;
  let destino: { bloque: BloqueChecklist; tipo: TipoItem } | null = null;

  if (clave === 'adm:garantia_fiel_cumplimiento' || clave === 'adm:boleta_garantia') {
    destino = { bloque: 'ADMINISTRATIVO', tipo: 'dato' };
  } else if (clave.startsWith('criterio:')) {
    destino = esAnexoNumerado
      ? { bloque: 'ADMINISTRATIVO', tipo: 'documento' }
      : { bloque: row.bloque, tipo: 'dato' };
  } else if (clave === CLAVE_ITEM_PLAZO) {
    destino = { bloque: 'COMERCIAL', tipo: 'dato' };
  }

  if (!destino || (destino.bloque === row.bloque && destino.tipo === row.tipo)) return null;
  return destino;
}
