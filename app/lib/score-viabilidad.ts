// app/lib/score-viabilidad.ts
// NIVEL DE ATRACTIVO v4.1 (especificación 2, CAMBIOS_Fase2_Score_v4_1, aprobada por CA 02-10-2026).
//
// Reemplaza el score 0-100 que asignaba el modelo (dimensiones 40/40/20) por una función de
// CÓDIGO, sin IA: "el modelo extrae; el código decide". Corre al FINAL del análisis, después del
// validador, las escaladas y las autocorrecciones (antes se calculaba antes del validador y los
// números no reflejaban las correcciones — H-01), y se RECALCULA cada vez que cambia un dato que
// usa (corrección del asistente, configuración nueva).
//
// Qué es: dice al asistente, sin preguntarle a CA, si SIGUE con el proyecto, lo CONSULTA o lo
// SUELTA. Qué NO es: no asigna proyectos ni saca proyectos de la bandeja (ese es el perfil inicial).
//
// Orden: filtros duros (F1-F4 → EXCLUIDO) → unidad evaluada (proyecto o cada línea) → nivel de
// partida por presupuesto neto → escalones → pisos → techos (mandan sobre los pisos) → acota 1..6.
// Función PURA: recibe el informe y la configuración; no lee BD ni llama a nadie.

import { extractTipoFromCodigo } from '@/app/lib/tipos-licitacion';
import { NIVELES, calzaCatalogo, type ConfigViabilidadV4, type Complejidad, type NivelAtractivo } from '@/app/lib/viabilidad-v4/config';

export type AccionAsistente = 'SEGUIR' | 'CONSULTAR_CA' | 'SOLTAR' | 'REVISAR_SALIDA' | 'CONFIRMAR_DATO';

export interface PasoNivel { regla: string; efecto: string; dato: string; cita?: any }
export interface LineaNivel { linea: string; presupuesto_neto: number | null; presupuesto_origen: 'LINEA' | 'TOTAL' | 'TIPO'; nivel: NivelAtractivo; viable: boolean }
export interface DatoDudoso { dato: string; clave: string; razon: string }

export interface ScoreV4 {
  nivel: NivelAtractivo;
  nivel_num: number;
  motivo_exclusion: { filtro: 'F1' | 'F2' | 'F3' | 'F4'; texto: string; cita: any } | null;
  unidad_evaluada: string;                      // "PROYECTO" | "LINEA n"
  supuesto_no_claro: 'GLOBAL' | 'POR_LINEAS' | null;
  lineas: LineaNivel[];
  pasos: PasoNivel[];
  datos_dudosos: DatoDudoso[];
  avisos: string[];
  accion_asistente: AccionAsistente;
  accion_texto: string;
  resumen_pantalla: string;
  presupuesto_neto_orden: number | null;        // para ordenar dentro del mismo nivel (§5.5)
  version_reglas: string;
  calculado_en: string;
}

export interface CtxNivel {
  codigo: string;
  /** UTM del mes (servicio oficial). Solo se usa para el aviso de rango sin monto publicado. */
  utm?: number | null;
  /** Datos clave que el asistente ya confirmó en el visor (claves de DatoDudoso). */
  confirmados?: string[];
  ahora?: Date;
}

const LABEL: Record<NivelAtractivo, string> = {
  EXCLUIDO: 'EXCLUIDO', BAJO: 'BAJO', MEDIO_BAJO: 'MEDIO BAJO', MEDIO: 'MEDIO', MEDIO_ALTO: 'MEDIO ALTO', ALTO: 'ALTO', MUY_ALTO: 'MUY ALTO',
};
export const etiquetaNivel = (n: string) => LABEL[n as NivelAtractivo] ?? n.replace(/_/g, ' ');

const nivelDe = (n: number): NivelAtractivo => NIVELES[Math.max(0, Math.min(6, Math.round(n)))];
const millones = (n: number) => `$${(n / 1_000_000).toLocaleString('es-CL', { maximumFractionDigits: 1, minimumFractionDigits: n >= 10_000_000 ? 1 : 0 })}M`;
const normTxt = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const numLinea = (x: unknown) => { const m = String(x ?? '').match(/\d+/); return m ? Number(m[0]) : 1; };
const num = (x: unknown): number | null => (x == null || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null);

const FAMILIA_LEGIBLE: Record<string, string> = {
  LABORATORIO: 'laboratorio', MEDICO_HOSPITALARIO: 'médico hospitalario', ELECTRICO: 'eléctrico',
  ELECTRONICO_INSTRUMENTACION: 'instrumentación', INDUSTRIAL_ESPECIALIZADO: 'industrial especializado',
  EQUIPO_ESPECIALIDAD: 'equipo de especialidad', MAQUINARIA_CONSTRUCCION: 'maquinaria', MAQUINARIA_AGRICOLA: 'maquinaria agrícola',
  MAQUINARIA_ASEO: 'maquinaria de aseo', MAQUINARIA_OTRA: 'maquinaria', VEHICULOS: 'vehículos', MOBILIARIO: 'mobiliario',
  HERRAMIENTAS: 'herramientas', MATERIALES_CONSTRUCCION: 'materiales de construcción', FERRETERIA: 'ferretería',
  HOGAR_RETAIL: 'hogar', COMPUTACION: 'computación', OTRO: 'familia no catalogada',
};

function complejidadDeFamilia(f: string, cfg: ConfigViabilidadV4): Complejidad | null {
  const F = String(f || '').toUpperCase();
  for (const c of ['ALTA', 'MEDIA', 'COMMODITY'] as Complejidad[]) if (cfg.familias[c].includes(F)) return c;
  return null;
}

interface Unidad { etiqueta: string; linea: string | null; neto: number | null; origen: 'LINEA' | 'TOTAL' | 'TIPO'; productos: any[] }

/** Criterio continuo sin piso/tope que nos favorece: ley del mínimo en plazo o del máximo en garantía. */
function leyAFavor(criterios: any[]): any | null {
  for (const c of criterios) {
    const tema = String(c?.tema || '').toUpperCase();
    const clase = String(c?.clase || '').toUpperCase();
    const rango = c?.rango_admisibilidad || {};
    if (tema === 'PLAZO_ENTREGA' && clase === 'LEY_DEL_MINIMO' && !String(rango.min ?? '').trim()) return c;
    if (tema === 'GARANTIA' && clase === 'LEY_DEL_MAXIMO' && !String(rango.max ?? '').trim()) return c;
  }
  return null;
}

function nivelDeUnidad(u: Unidad, inf: any, cfg: ConfigViabilidadV4, tipo: string, certMarca: any, pasos: PasoNivel[], avisos: string[]): number {
  const P = (regla: string, efecto: string, dato: string, cita?: any) => pasos.push({ regla, efecto, dato, ...(cita ? { cita } : {}) });
  const neto = u.neto;
  // Paso 1 · Nivel de partida.
  let n: number;
  if (neto == null) {
    n = (cfg.partida_sin_monto as any)[tipo] ?? 2;
    P('Partida sin monto publicado', `parte en ${etiquetaNivel(nivelDe(n))} (provisorio)`, `${u.etiqueta}: licitación ${tipo || 'de tipo desconocido'}`);
  } else {
    const tramo = cfg.tramos_presupuesto.find(t => t.hasta == null || neto <= t.hasta) ?? cfg.tramos_presupuesto[cfg.tramos_presupuesto.length - 1];
    n = tramo.nivel;
    P('Partida por presupuesto', `parte en ${etiquetaNivel(nivelDe(n))}`, `${u.etiqueta}: ${millones(neto)} neto`, inf?.presupuesto?.cita);
  }
  // Paso 2 · Escalones.
  const nombres = new Map<string, any>();
  for (const it of u.productos) { const k = normTxt(it?.nombre ?? it?.descripcion); if (k && !nombres.has(k)) nombres.set(k, it); }
  const distintos = [...nombres.values()];
  const conteo = new Map<Complejidad, number>();
  let otros = 0;
  for (const it of distintos) {
    const c = complejidadDeFamilia(it?.familia, cfg);
    if (!c) otros++;
    const cc = c ?? 'MEDIA';
    conteo.set(cc, (conteo.get(cc) || 0) + 1);
  }
  if (otros) avisos.push(`${otros} producto(s) con familia no catalogada: se trataron como complejidad media (CA puede asignarles familia).`);
  let comp: Complejidad | null = null;
  if (conteo.size) {
    const max = Math.max(...conteo.values());
    comp = (['ALTA', 'MEDIA', 'COMMODITY'] as Complejidad[]).find(c => conteo.get(c) === max) ?? null;   // empate → mayor complejidad
    const e = cfg.escalones.complejidad[comp!];
    if (e) { n += e; P('Complejidad', `${e > 0 ? '+' : ''}${e}`, `complejidad ${comp!.toLowerCase()}`); }
  }
  const nProd = distintos.length;
  const tramoP = cfg.escalones.productos.find(t => nProd >= t.desde && (t.hasta == null || nProd <= t.hasta));
  if (tramoP && tramoP.escalones) { n += tramoP.escalones; P('Cantidad de productos', `${tramoP.escalones > 0 ? '+' : ''}${tramoP.escalones}`, `${nProd} producto(s)`); }
  const criterios: any[] = Array.isArray(inf?.criterios_evaluacion?.criterios) ? inf.criterios_evaluacion.criterios : [];
  if (comp === 'COMMODITY') {
    const precio = criterios.find(c => String(c?.tema || '').toUpperCase() === 'PRECIO' && (num(c?.ponderacion_efectiva) ?? num(c?.ponderacion_nominal) ?? 0) >= cfg.escalones.pelea_precio.umbral_pct);
    if (precio) { n += cfg.escalones.pelea_precio.escalones; P('Pelea de precio', String(cfg.escalones.pelea_precio.escalones), `commodity y precio ${num(precio.ponderacion_efectiva) ?? num(precio.ponderacion_nominal)}%`, precio.cita); }
  }
  if (certMarca) { n += cfg.escalones.certificado_marca; P('Certificado de servicio técnico de marca', String(cfg.escalones.certificado_marca), String(certMarca.que || certMarca.cita?.frase || '').slice(0, 120), certMarca.cita); }
  const ley = leyAFavor(criterios);
  if (ley && neto != null && neto <= cfg.escalones.leyes.hasta_neto) {
    n += cfg.escalones.leyes.escalones;
    P('Ley del mínimo/máximo', `+${cfg.escalones.leyes.escalones}`, String(ley.nombre || ''), ley.cita);
  }
  // Paso 3 · Pisos.
  const piso = (min: number, regla: string, dato: string) => { if (n < min) { n = min; P(regla, `piso ${etiquetaNivel(nivelDe(min))}`, dato); } };
  if (ley && neto != null && neto > 20_000_000 && neto <= 30_000_000) piso(cfg.pisos.ley_20_30, 'Piso por ley a favor', `${ley.nombre} con ${millones(neto)}`);
  if (ley && neto != null && neto > 30_000_000) piso(cfg.pisos.ley_mas_30, 'Piso por ley a favor', `${ley.nombre} con ${millones(neto)}`);
  if (neto != null && neto > 60_000_000) piso(cfg.pisos.presupuesto_mas_60, 'Piso por presupuesto', `${millones(neto)} neto`);
  // Paso 4 · Techos (mandan sobre los pisos).
  const techo = (max: number, regla: string, dato: string, cita?: any) => { if (n > max) { n = max; P(regla, `techo ${etiquetaNivel(nivelDe(max))}`, dato, cita); } };
  if (neto != null && neto > cfg.minimo_neto && neto <= 20_000_000) techo(cfg.techos.presupuesto_10_20, 'Techo por presupuesto', `${millones(neto)} neto`);
  if (String(inf?.objeto_principal?.tipo || '').toUpperCase() === 'SERVICIO') techo(cfg.techos.servicio, 'Techo por servicio', 'el objeto principal es un servicio', inf?.objeto_principal?.cita);
  return Math.max(1, Math.min(6, n));
}

function unidadesDe(inf: any, supuesto: 'GLOBAL' | 'POR_LINEAS', netoTotal: number | null, origenTotal: 'TOTAL' | 'TIPO'): Unidad[] {
  const items: any[] = Array.isArray(inf?.productos?.items) ? inf.productos.items : [];
  if (supuesto === 'GLOBAL') return [{ etiqueta: 'Proyecto', linea: null, neto: netoTotal, origen: origenTotal, productos: items }];
  const porLinea: any[] = Array.isArray(inf?.presupuesto?.por_linea_interpretado) ? inf.presupuesto.por_linea_interpretado : [];
  const lineas = [...new Set(items.map(it => numLinea(it?.linea)))].sort((a, b) => a - b);
  for (const l of porLinea) if (l?.numero && !lineas.includes(l.numero)) lineas.push(l.numero);
  if (!lineas.length) lineas.push(1);
  return lineas.map(n => {
    const pl = porLinea.find(l => l?.numero === n && num(l?.neto) != null);
    return {
      etiqueta: `Línea ${n}`, linea: `L${n}`,
      neto: pl ? Number(pl.neto) : netoTotal, origen: pl ? 'LINEA' : origenTotal,
      productos: items.filter(it => numLinea(it?.linea) === n),
    };
  });
}

export function calcularNivel(inf: any, cfg: ConfigViabilidadV4, ctx: CtxNivel): ScoreV4 {
  const ahora = (ctx.ahora ?? new Date()).toISOString();
  const pasos: PasoNivel[] = [];
  const avisos: string[] = [];
  const tipo = extractTipoFromCodigo(ctx.codigo || '');
  const confirmados = new Set(ctx.confirmados ?? []);
  const pres = inf?.presupuesto || {};
  const netoTotal = num(pres.neto) != null && Number(pres.neto) > 0 ? Number(pres.neto) : null;
  const sinMonto = netoTotal == null;
  const requisitos: any[] = Array.isArray(inf?.requisitos_admisibilidad?.requisitos) ? inf.requisitos_admisibilidad.requisitos.filter((r: any) => r?.origen !== 'sistema') : [];

  // ── Datos dudosos (§8) ──
  const dudosos: DatoDudoso[] = [];
  const dudar = (clave: string, dato: string, razon: string) => { if (!confirmados.has(clave) && !dudosos.some(d => d.clave === clave)) dudosos.push({ clave, dato, razon }); };
  const resultadoAdj = String(inf?.adjudicacion?.resultado || 'NO_CLARO').toUpperCase();
  if (resultadoAdj === 'NO_CLARO') dudar('adjudicacion', 'cómo se adjudica', 'las bases no dejan claro si se adjudica global o por línea');
  if (!sinMonto && (pres.cita?.verificada === false || pres.incierto === true)) dudar('presupuesto', 'el presupuesto', pres.incierto ? 'las bases traen cifras que no calzan' : 'su cita no se encontró en las bases');
  if (pres.caracter_corregido) avisos.push('El carácter del presupuesto (excluyente o referencial) no quedó respaldado por una frase de las bases: se trata como no declarado.');
  const conteo = inf?.productos?.conteo_cruzado;
  const calidad: string[] = Array.isArray(inf?.productos?.problemas_calidad) ? inf.productos.problemas_calidad : [];
  if ((conteo && conteo.cuadra === false) || calidad.length) dudar('productos', 'la cantidad de productos', conteo?.detalle || calidad[0] || 'el conteo no cuadra entre fuentes');
  if (inf?._json_reparado) dudar('informe', 'todo el informe', 'la respuesta de la IA llegó cortada y se reparó');

  const resumenBase = (n: NivelAtractivo, texto: string) => `${etiquetaNivel(n)} · ${texto}`;
  const fin = (s: Omit<ScoreV4, 'version_reglas' | 'calculado_en' | 'avisos' | 'pasos' | 'datos_dudosos' | 'accion_texto'> & { accion_asistente: AccionAsistente }, dud: DatoDudoso[] = dudosos): ScoreV4 => {
    let accion = s.accion_asistente;
    const bloqueaConfirmar = s.motivo_exclusion && (s.motivo_exclusion.filtro === 'F1' || s.motivo_exclusion.filtro === 'F2');
    if (dud.length && !bloqueaConfirmar) accion = 'CONFIRMAR_DATO';
    const accionTexto = accion === 'SEGUIR' ? 'Sigue con el proyecto'
      : accion === 'CONSULTAR_CA' ? 'Consulta a CA antes de seguir'
      : accion === 'SOLTAR' ? 'Suelta el proyecto'
      : accion === 'REVISAR_SALIDA' ? 'Revisa si hay salida antes de soltarlo'
      : `Confirma ${dud.map(d => d.dato).join(', ')} en el visor antes de decidir`;
    return { ...s, accion_asistente: accion, accion_texto: accionTexto, pasos, avisos: [...new Set(avisos)], datos_dudosos: dud, version_reglas: cfg.version_reglas, calculado_en: ahora };
  };
  const excluido = (filtro: 'F1' | 'F2' | 'F3' | 'F4', texto: string, cita: any, extra: Partial<ScoreV4> = {}) => {
    pasos.push({ regla: `Filtro ${filtro}`, efecto: 'EXCLUIDO', dato: texto, ...(cita ? { cita } : {}) });
    return fin({
      nivel: 'EXCLUIDO', nivel_num: 0, motivo_exclusion: { filtro, texto, cita: cita ?? null },
      unidad_evaluada: 'PROYECTO', supuesto_no_claro: null, lineas: [], presupuesto_neto_orden: netoTotal,
      accion_asistente: filtro === 'F4' ? 'REVISAR_SALIDA' : 'SOLTAR',
      resumen_pantalla: resumenBase('EXCLUIDO', texto), ...extra,
    } as any);
  };

  // ── Filtros duros (§3), en orden ──
  const exc = inf?.exclusion || {};
  if (exc.excluido && String(exc.categoria || '').toUpperCase() === 'CONTRATO_SUMINISTRO') {
    return excluido('F1', `Contrato de suministro${exc.motivo ? `: ${exc.motivo}` : ''}`, exc.cita);
  }
  if (tipo === 'LS') return excluido('F2', 'Licitación LS (servicios personales especializados)', null);
  if (exc.categoria && String(exc.categoria).toUpperCase() !== 'CONTRATO_SUMINISTRO') {
    avisos.push(`El objeto se reportó como ${String(exc.categoria).toLowerCase().replace(/_/g, ' ')}${exc.motivo ? ` (${exc.motivo})` : ''}: no excluye en esta versión.`);
  }
  // Presupuesto no publicado: decide el tipo de licitación (3.1).
  if (sinMonto) {
    const utm = num(ctx.utm);
    if (tipo === 'L1') return excluido('F3', `Licitación L1 sin monto publicado: menos de 100 UTM${utm ? ` (menos de ${millones(100 * utm)})` : ''}, bajo el mínimo de ${millones(cfg.minimo_neto)}`, null);
    if (tipo === 'LE') avisos.push(utm ? `Presupuesto no publicado: entre ${millones(100 * utm)} y ${millones(1000 * utm)} (licitación LE).` : 'Presupuesto no publicado: licitación LE (100 a 1.000 UTM).');
    if (!['LE', 'LP', 'LR'].includes(tipo)) dudar('presupuesto', 'el presupuesto', `las bases no publican monto y el tipo ${tipo || 'de licitación'} no tiene rango conocido`);
  }
  // F4 · admisibilidad imposible (solo requisitos que dejan fuera: todos los de la lista lo son).
  for (const r of requisitos) {
    const txt = `${r.que || ''} ${r.como || ''} ${r.cuanto || ''} ${r.cita?.frase || ''}`;
    for (const cat of cfg.admisibilidad_imposible) {
      if (calzaCatalogo(txt, cat)) {
        const dud = r.cita?.verificada === false ? [...dudosos, { clave: 'causal_f4', dato: 'el requisito de admisibilidad', razon: 'su cita no se encontró en las bases' }] : dudosos;
        pasos.push({ regla: 'Filtro F4', efecto: 'EXCLUIDO', dato: `${cat.nombre}: ${String(r.que || '').slice(0, 120)}`, ...(r.cita ? { cita: r.cita } : {}) });
        return fin({
          nivel: 'EXCLUIDO', nivel_num: 0,
          motivo_exclusion: { filtro: 'F4', texto: `${String(r.que || cat.nombre).slice(0, 160)}: no lo cumplimos`, cita: r.cita ?? null },
          unidad_evaluada: 'PROYECTO', supuesto_no_claro: null, lineas: [], presupuesto_neto_orden: netoTotal,
          accion_asistente: 'REVISAR_SALIDA', resumen_pantalla: resumenBase('EXCLUIDO', `${cat.nombre}: revisa si hay salida`),
        } as any, confirmados.has('causal_f4') ? dudosos : dud);
      }
    }
  }
  // §6.2 · certificado de servicio técnico de marca (−1, no excluye).
  const certMarca = requisitos.find(r => calzaCatalogo(`${r.que || ''} ${r.como || ''} ${r.cita?.frase || ''}`, cfg.certificado_marca)) ?? null;
  if (certMarca) {
    avisos.push(`Piden servicio técnico autorizado de una marca: ${cfg.certificado_marca.salida}.`);
    if (certMarca.cita?.verificada === false) dudar('causal_marca', 'el requisito de servicio técnico de marca', 'su cita no se encontró en las bases');
  }

  // ── Unidad evaluada (§4) ──
  const origenTotal: 'TOTAL' | 'TIPO' = sinMonto ? 'TIPO' : 'TOTAL';
  const evaluar = (supuesto: 'GLOBAL' | 'POR_LINEAS') => {
    const pasosAntes = pasos.length;
    const unidades = unidadesDe(inf, supuesto, netoTotal, origenTotal);
    const lineas: LineaNivel[] = [];
    let mejor: { u: Unidad; n: number } | null = null;
    for (const u of unidades) {
      // F3 por unidad (el monto de la línea, o el total si la línea no tiene propio).
      if (u.neto != null && u.neto <= cfg.minimo_neto) {
        if (u.linea) lineas.push({ linea: u.linea, presupuesto_neto: u.neto, presupuesto_origen: u.origen, nivel: 'EXCLUIDO', viable: false });
        continue;
      }
      const n = nivelDeUnidad(u, inf, cfg, tipo, certMarca, pasos, avisos);
      if (u.linea) lineas.push({ linea: u.linea, presupuesto_neto: u.neto, presupuesto_origen: u.origen, nivel: nivelDe(n), viable: true });
      // Gana la mejor línea; dentro del mismo nivel, la de mayor presupuesto (§5.5).
      if (!mejor || n > mejor.n || (n === mejor.n && (u.neto ?? 0) > (mejor.u.neto ?? 0))) mejor = { u, n };
    }
    return { mejor, lineas, unidades, pasosAntes };
  };

  let supuesto: 'GLOBAL' | 'POR_LINEAS' = resultadoAdj === 'POR_LINEAS' ? 'POR_LINEAS' : 'GLOBAL';
  let supuestoNoClaro: 'GLOBAL' | 'POR_LINEAS' | null = null;
  let r = evaluar(supuesto);
  if (resultadoAdj === 'NO_CLARO') {
    // Se calcula en los dos supuestos y se muestra el MENOR.
    const pasosGlobal = pasos.splice(r.pasosAntes);
    const r2 = evaluar('POR_LINEAS');
    const nG = r.mejor?.n ?? 0, nL = r2.mejor?.n ?? 0;
    if (nL < nG) { supuesto = 'POR_LINEAS'; r = r2; }
    else { pasos.splice(r2.pasosAntes); pasos.push(...pasosGlobal); }
    supuestoNoClaro = supuesto;
    pasos.push({ regla: 'Adjudicación no clara', efecto: `se toma el menor de los dos supuestos (${supuesto === 'GLOBAL' ? 'global' : 'por línea'})`, dato: `global: ${etiquetaNivel(nivelDe(nG))} · por línea: ${etiquetaNivel(nivelDe(nL))}` });
  }

  if (!r.mejor) {
    // Ninguna unidad supera el mínimo (F3).
    const texto = netoTotal != null
      ? `Presupuesto ${millones(netoTotal)} neto${r.lineas.length > 1 ? ' (ninguna línea supera el mínimo)' : ''}, bajo el mínimo de ${millones(cfg.minimo_neto)}`
      : `Presupuesto bajo el mínimo de ${millones(cfg.minimo_neto)}`;
    return excluido('F3', texto, pres.cita, { lineas: r.lineas, supuesto_no_claro: supuestoNoClaro, unidad_evaluada: supuesto === 'POR_LINEAS' ? 'LINEA' : 'PROYECTO' } as any);
  }

  const { u, n } = r.mejor;
  const nivel = nivelDe(n);
  const accion: AccionAsistente = n >= 5 ? 'SEGUIR' : n >= 2 ? 'CONSULTAR_CA' : 'SOLTAR';
  // Resumen comercial: "MUY ALTO · Línea 1: $732,8M neto · maquinaria · 1 producto".
  const fams = new Map<string, number>();
  for (const it of u.productos) { const f = String(it?.familia || '').toUpperCase(); if (f) fams.set(f, (fams.get(f) || 0) + 1); }
  const famTop = [...fams.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const nProd = new Set(u.productos.map(it => normTxt(it?.nombre ?? it?.descripcion)).filter(Boolean)).size;
  const partes = [
    `${u.linea ? `${u.etiqueta}: ` : ''}${u.neto != null ? `${millones(u.neto)} neto` : 'monto no publicado'}`,
    famTop ? (FAMILIA_LEGIBLE[famTop] ?? famTop.toLowerCase().replace(/_/g, ' ')) : '',
    nProd ? `${nProd} producto${nProd === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  if (nivel === 'BAJO') partes.push('presupuesto y producto poco atractivos');

  return fin({
    nivel, nivel_num: NIVELES.indexOf(nivel), motivo_exclusion: null,
    unidad_evaluada: u.linea ? `LINEA ${numLinea(u.linea)}` : 'PROYECTO',
    supuesto_no_claro: supuestoNoClaro, lineas: r.lineas,
    presupuesto_neto_orden: u.neto, accion_asistente: accion,
    resumen_pantalla: resumenBase(nivel, partes.join(' · ')),
  });
}
