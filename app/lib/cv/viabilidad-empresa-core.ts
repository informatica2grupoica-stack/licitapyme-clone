// app/lib/cv/viabilidad-empresa-core.ts
// Viabilidad IA de las EMPRESAS-CLIENTE: configuración propia de cada empresa y «calce» con lo que vende. Parte pura (sin BD).
// Solo la usa el código de clientes (app/lib/cv/**): Grupo ICA no pasa por aquí.
//
// El análisis de las bases es igual para todas (extrae criterios, requisitos, productos, presupuesto). Lo que cambia por empresa es el NIVEL de
// atractivo: antes salía con los criterios calibrados para ICA; ahora se ajusta con el perfil de la empresa (qué vende, montos) y con su
// configuración (presupuesto mínimo, qué tan estricto es el calce).

/** Qué tan estricto es el calce con lo que la empresa vende: 'ninguno' no lo usa; 'suave' baja 1; 'normal' baja 2 si no calza (1 si calza en parte); 'estricto' deja el nivel en BAJO si no calza. */
export type ModoCalce = 'ninguno' | 'suave' | 'normal' | 'estricto';
export const MODOS_CALCE: { id: ModoCalce; titulo: string; ayuda: string }[] = [
  { id: 'normal', titulo: 'Normal (recomendado)', ayuda: 'Si la licitación no calza con lo que vendes, el nivel baja dos escalones; si calza en parte, uno.' },
  { id: 'suave', titulo: 'Suave', ayuda: 'Si no calza, el nivel baja solo un escalón.' },
  { id: 'estricto', titulo: 'Estricto', ayuda: 'Si no calza con lo que vendes, el nivel queda en BAJO y se recomienda soltarla.' },
  { id: 'ninguno', titulo: 'No usar', ayuda: 'El nivel solo depende del presupuesto y de las bases, sin mirar lo que vendes.' },
];
export const esModoCalce = (v: unknown): v is ModoCalce => v === 'ninguno' || v === 'suave' || v === 'normal' || v === 'estricto';

export interface ConfigViabilidadEmpresa {
  /** Presupuesto neto mínimo (CLP) para que valga la pena; bajo este monto el nivel queda EXCLUIDO. null = el valor por defecto del sistema. */
  minimo_neto: number | null;
  calce: ModoCalce;
}
export const CONFIG_EMPRESA_POR_DEFECTO: ConfigViabilidadEmpresa = { minimo_neto: null, calce: 'normal' };

export function normalizarConfigEmpresa(raw: unknown): ConfigViabilidadEmpresa {
  let o: any = raw;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { o = null; } }
  const m = Number(o?.minimo_neto);
  return {
    minimo_neto: o?.minimo_neto != null && o.minimo_neto !== '' && Number.isFinite(m) && m >= 0 ? Math.round(m) : null,
    calce: esModoCalce(o?.calce) ? o.calce : CONFIG_EMPRESA_POR_DEFECTO.calce,
  };
}

// ── Calce con lo que la empresa vende ───────────────────────────────────────────────────────────────
export interface PerfilCalce { descripcion?: string; rubros?: string; productos_si?: string; productos_no?: string; monto_min?: number | null; monto_max?: number | null; regiones?: string }
export interface ResultadoCalce {
  coincidencia: 'SI' | 'PARCIAL' | 'NO' | 'SIN_DATO';
  detalle: string;
  /** Productos de la licitación que calzan / que la empresa dijo que NO vende. */
  calzan: string[]; noDeseados: string[];
  montoFuera: 'BAJO_MINIMO' | 'SOBRE_MAXIMO' | null;
  /** true si la empresa dijo en qué regiones entrega y la de la licitación NO está entre ellas. false = está, o no hay dato para saberlo. */
  regionFuera: boolean;
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['para', 'con', 'sin', 'los', 'las', 'del', 'por', 'una', 'uno', 'que', 'sus', 'este', 'esta', 'tipo', 'marca', 'modelo', 'otros', 'otras', 'equipo', 'equipos', 'productos', 'producto', 'servicio', 'servicios', 'venta', 'vendemos', 'vendo']);
/** Raíces de 5 letras de las palabras con contenido («sillas» y «silla» calzan). */
export function raices(texto: unknown): Set<string> {
  const out = new Set<string>();
  for (const w of norm(texto).split(' ')) if (w.length >= 4 && !STOP.has(w)) out.add(w.slice(0, 5));
  return out;
}

// ── Regiones ────────────────────────────────────────────────────────────────────────────────────────
// El perfil trae las regiones en texto libre («Metropolitana, Valparaíso»). Solo se penaliza cuando se entiende QUÉ regiones dijo y cuál es la
// de la licitación; ante la duda no se castiga (mejor un aviso de menos que descartar una licitación buena por un error de lectura).
const REGIONES: Array<[string, string[]]> = [
  ['arica', ['arica', 'parinacota']], ['tarapaca', ['tarapaca', 'iquique']], ['antofagasta', ['antofagasta']], ['atacama', ['atacama', 'copiapo']],
  ['coquimbo', ['coquimbo', 'la serena']], ['valparaiso', ['valparaiso', 'vina del mar']], ['rm', ['metropolitana', 'santiago', 'rm']],
  ['ohiggins', ['higgins', 'rancagua', 'libertador']], ['maule', ['maule', 'talca']], ['nuble', ['nuble', 'chillan']],
  ['biobio', ['biobio', 'bio bio', 'concepcion']], ['araucania', ['araucania', 'temuco']], ['losrios', ['los rios', 'valdivia']],
  ['loslagos', ['los lagos', 'puerto montt']], ['aysen', ['aysen', 'coyhaique']], ['magallanes', ['magallanes', 'punta arenas']],
];
const TODO_CHILE = ['todas', 'todo chile', 'todo el pais', 'nacional', 'todo el territorio', 'cualquier region'];
const tieneFrase = (texto: string, frase: string) => ` ${texto} `.includes(` ${frase} `);
function idsDeRegion(texto: unknown): Set<string> {
  const t = norm(texto);
  const out = new Set<string>();
  for (const [id, claves] of REGIONES) if (claves.some(c => tieneFrase(t, c))) out.add(id);
  return out;
}
/** ¿La región de la licitación queda FUERA de las que la empresa dijo? false si no se puede saber (perfil vacío o ilegible, «todo Chile», región de la licitación desconocida). */
export function regionFuera(regionesPerfil: unknown, regionLicitacion: unknown): boolean {
  const t = norm(regionesPerfil);
  if (!t || TODO_CHILE.some(f => tieneFrase(t, f))) return false;
  const propias = idsDeRegion(t);
  const lic = idsDeRegion(regionLicitacion);
  if (!propias.size || lic.size !== 1) return false;
  return !propias.has([...lic][0]);
}

export function evaluarCalce(perfil: PerfilCalce | null, productos: Array<{ nombre?: unknown; descripcion?: unknown }>, neto: number | null, regionLicitacion?: string | null): ResultadoCalce {
  const regFuera = !!perfil && regionFuera(perfil.regiones, regionLicitacion);
  const montoFuera: ResultadoCalce['montoFuera'] = !perfil || neto == null ? null
    : (perfil.monto_min != null && perfil.monto_min > 0 && neto < perfil.monto_min) ? 'BAJO_MINIMO'
    : (perfil.monto_max != null && perfil.monto_max > 0 && neto > perfil.monto_max) ? 'SOBRE_MAXIMO' : null;
  const si = raices(`${perfil?.productos_si ?? ''} ${perfil?.rubros ?? ''}`);
  const no = raices(perfil?.productos_no);
  const nombres = [...new Set(productos.map(p => String(p?.nombre ?? p?.descripcion ?? '').trim()).filter(Boolean))];
  if (!si.size || !nombres.length) return { coincidencia: 'SIN_DATO', detalle: !si.size ? 'Falta completar en tu perfil qué productos o rubros vendes.' : 'No hay productos listados en las bases.', calzan: [], noDeseados: [], montoFuera, regionFuera: regFuera };
  const calzan: string[] = [], noDeseados: string[] = [];
  for (const n of nombres) {
    const r = raices(n);
    const esNo = [...r].some(x => no.has(x));
    const esSi = [...r].some(x => si.has(x));
    if (esNo) noDeseados.push(n);
    else if (esSi) calzan.push(n);
  }
  const coincidencia: ResultadoCalce['coincidencia'] = calzan.length === 0 ? 'NO' : calzan.length === nombres.length ? 'SI' : 'PARCIAL';
  const detalle = coincidencia === 'SI' ? `Todos los productos (${nombres.length}) calzan con lo que vendes.`
    : coincidencia === 'PARCIAL' ? `Calzan ${calzan.length} de ${nombres.length} productos con lo que vendes.`
    : noDeseados.length ? `Los productos de la licitación están entre lo que dijiste que NO vendes (${noDeseados.slice(0, 3).join(', ')}).` : 'Ningún producto de la licitación calza con lo que vendes.';
  return { coincidencia, detalle, calzan: calzan.slice(0, 8), noDeseados: noDeseados.slice(0, 8), montoFuera, regionFuera: regFuera };
}

/** Escalones que baja el nivel por el calce, según el modo. `techoBajo` = además el nivel no puede pasar de BAJO (modo estricto sin calce). */
export function efectoCalce(modo: ModoCalce, r: ResultadoCalce): { escalones: number; techoBajo: boolean } {
  if (modo === 'ninguno') return { escalones: 0, techoBajo: false };
  let escalones = 0, techoBajo = false;
  if (r.coincidencia === 'NO') {
    if (modo === 'suave') escalones += 1; else if (modo === 'normal') escalones += 2; else techoBajo = true;
  } else if (r.coincidencia === 'PARCIAL' && modo !== 'suave') escalones += 1;
  if (r.montoFuera) { if (modo === 'estricto') techoBajo = true; else escalones += 1; }
  if (r.regionFuera) { if (modo === 'estricto') techoBajo = true; else escalones += 1; }
  return { escalones, techoBajo };
}
