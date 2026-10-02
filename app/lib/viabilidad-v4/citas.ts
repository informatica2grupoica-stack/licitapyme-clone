// app/lib/viabilidad-v4/citas.ts
// P5 · CITAS Y VISOR — el modelo entrega {documento, numeral, frase}; el CÓDIGO busca la frase en
// el texto real y pone la página. Antes la página la escribía el modelo ("pág. 1" para material de
// la pág. 24) y una cita inventada se mostraba en verde igual (Arica: "admite o equivalente").
//
// Búsqueda en tres pasadas: exacta (sin tildes ni mayúsculas) → normalizada (solo letras y
// números) → aproximada (ventana de palabras con ≥ 85 % de coincidencia). Lo que no se encuentra
// queda "no verificado" (ámbar en pantalla) y nunca se muestra como verificado.
//
// Prioridad cuando dos documentos se contradicen: aclaraciones del foro > bases > formularios y
// anexos (se usa para elegir dónde buscar primero, ver prioridadDocumento).

export interface CitaV4 {
  documento?: string;
  numeral?: string;
  frase?: string;
  // Los agrega el código:
  pagina?: number | null;
  verificada?: boolean;
  metodo?: 'exacta' | 'normalizada' | 'aproximada' | 'no_encontrada' | 'sin_frase';
  documento_real?: string;   // dónde se encontró de verdad (si difiere del citado)
  semantica?: 'SI' | 'PARCIAL' | 'NO' | 'NO_EVALUADA';
}

export interface DocTexto { nombre: string; texto: string; categoria?: string | null }

const RE_MARCA = /\[\[P[ÁA]GINA\s*(\d+)(?:\s*[-–]\s*\d+)?[^\]]*\]\]/gi;

const sinTildes = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const tokens = (s: string) => sinTildes(s).replace(/\[\[p[aá]gina[^\]]*\]\]/gi, ' ').replace(/<[^>]+>/g, ' ')
  .split(/[^a-z0-9ñ]+/).filter(Boolean);

/** Prioridad de un documento como fuente: foro (0) > bases (1) > técnicas (2) > formularios/anexos (3). */
export function prioridadDocumento(nombre: string, categoria?: string | null): number {
  const n = sinTildes(`${nombre} ${categoria || ''}`);
  if (/aclarac|respuesta|consulta|foro/.test(n)) return 0;
  if (/administrativ|bases/.test(n)) return 1;
  if (/tecnic|especif|eett|ttr/.test(n)) return 2;
  return 3;
}

interface DocIndexado {
  nombre: string;
  prioridad: number;
  toks: string[];
  /** página de cada token (null si el documento no trae marcadores). */
  pags: (number | null)[];
  plano: string;            // tokens unidos por espacio
  offsets: number[];        // offset de cada token dentro de `plano`
}

function indexar(d: DocTexto): DocIndexado {
  const toks: string[] = [];
  const pags: (number | null)[] = [];
  let pagina: number | null = null;
  // Se recorre por trozos entre marcadores para saber en qué página cae cada palabra.
  const texto = d.texto || '';
  let ultimo = 0;
  const empujar = (trozo: string) => { for (const t of tokens(trozo)) { toks.push(t); pags.push(pagina); } };
  RE_MARCA.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_MARCA.exec(texto))) {
    empujar(texto.slice(ultimo, m.index));
    pagina = Number(m[1]);
    ultimo = m.index + m[0].length;
  }
  empujar(texto.slice(ultimo));
  const offsets: number[] = [];
  let off = 0;
  for (const t of toks) { offsets.push(off); off += t.length + 1; }
  return { nombre: d.nombre, prioridad: prioridadDocumento(d.nombre, d.categoria), toks, pags, plano: toks.join(' '), offsets };
}

function tokenEnOffset(doc: DocIndexado, off: number): number {
  let lo = 0, hi = doc.offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (doc.offsets[mid] <= off) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Busca la frase en un documento. Devuelve el índice del primer token o -1. */
function buscarEnDoc(doc: DocIndexado, ft: string[]): { idx: number; metodo: 'normalizada' | 'aproximada' } | null {
  if (!ft.length || !doc.toks.length) return null;
  // Con espacios a los lados para no calzar a media palabra ("linea" dentro de "lineas").
  const pos = ` ${doc.plano} `.indexOf(` ${ft.join(' ')} `);
  if (pos >= 0) return { idx: tokenEnOffset(doc, pos), metodo: 'normalizada' };
  if (ft.length < 5) return null;
  // Aproximada: ventana del largo de la frase (+20 %), ≥ 85 % de las palabras de la frase presentes.
  // Se arranca solo donde aparece alguna de las palabras más largas de la frase (ancla barata).
  const anclas = new Set([...ft].sort((a, b) => b.length - a.length).slice(0, 3));
  const largo = Math.ceil(ft.length * 1.2);
  const necesarias = Math.ceil(ft.length * 0.85);
  let mejor = -1, mejorN = 0;
  for (let i = 0; i < doc.toks.length; i++) {
    if (!anclas.has(doc.toks[i])) continue;
    const ini = Math.max(0, i - ft.length);
    for (const desde of [ini, i]) {
      const ventana = new Map<string, number>();
      for (let k = desde; k < Math.min(doc.toks.length, desde + largo); k++) ventana.set(doc.toks[k], (ventana.get(doc.toks[k]) || 0) + 1);
      let n = 0;
      for (const t of ft) { const c = ventana.get(t) || 0; if (c > 0) { n++; ventana.set(t, c - 1); } }
      if (n > mejorN) { mejorN = n; mejor = desde; }
    }
    if (mejorN === ft.length) break;
  }
  return mejorN >= necesarias ? { idx: mejor, metodo: 'aproximada' } : null;
}

export class LocalizadorCitas {
  private docs: DocIndexado[];
  private textos: Map<string, string>;

  constructor(docs: DocTexto[]) {
    this.docs = docs.filter(d => d.texto).map(indexar).sort((a, b) => a.prioridad - b.prioridad);
    this.textos = new Map(docs.map(d => [d.nombre, sinTildes(d.texto || '').replace(/\s+/g, ' ')]));
  }

  /** Documento que corresponde a un nombre citado (exacto, o el más parecido). */
  docPorNombre(nombre?: string): DocIndexado | null {
    if (!nombre) return null;
    const exacto = this.docs.find(d => d.nombre === nombre);
    if (exacto) return exacto;
    const n = sinTildes(nombre).replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
    if (!n) return null;
    return this.docs.find(d => {
      const b = sinTildes(d.nombre).replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
      return b === n || (b.length >= 6 && (b.includes(n) || n.includes(b)));
    }) ?? null;
  }

  /** Ubica la frase y completa la cita (muta y devuelve la misma cita). */
  localizar(cita: CitaV4): CitaV4 {
    const frase = String(cita?.frase || '').trim();
    if (!frase) { cita.verificada = false; cita.metodo = 'sin_frase'; cita.pagina = null; return cita; }
    const ft = tokens(frase);
    const citado = this.docPorNombre(cita.documento);
    const orden = citado ? [citado, ...this.docs.filter(d => d !== citado)] : this.docs;
    // 1) Exacta: la frase tal cual (sin tildes/mayúsculas, espacios colapsados) en el texto crudo.
    const exacta = sinTildes(frase).replace(/\s+/g, ' ');
    for (const d of orden) {
      const t = this.textos.get(d.nombre) || '';
      if (exacta.length >= 12 && t.includes(exacta)) {
        const r = buscarEnDoc(d, ft);
        return this.completar(cita, d, r?.idx ?? -1, 'exacta');
      }
    }
    // 2) Normalizada y 3) aproximada.
    for (const metodo of ['normalizada', 'aproximada'] as const) {
      for (const d of orden) {
        const r = buscarEnDoc(d, ft);
        if (r && r.metodo === metodo) return this.completar(cita, d, r.idx, metodo);
      }
    }
    cita.verificada = false; cita.metodo = 'no_encontrada'; cita.pagina = null;
    return cita;
  }

  private completar(cita: CitaV4, d: DocIndexado, idx: number, metodo: CitaV4['metodo']): CitaV4 {
    cita.verificada = true;
    cita.metodo = metodo;
    cita.pagina = idx >= 0 ? d.pags[idx] ?? null : null;
    if (cita.documento !== d.nombre) {
      if (cita.documento) cita.documento_real = d.nombre;
      else cita.documento = d.nombre;
    }
    return cita;
  }
}

const esCita = (v: unknown): v is CitaV4 => !!v && typeof v === 'object' && !Array.isArray(v)
  && ('frase' in (v as any) || 'documento' in (v as any) || 'numeral' in (v as any));

/** Recorre el informe y localiza TODAS las citas (claves `cita`). Devuelve el conteo. */
export function localizarCitasInforme(inf: any, loc: LocalizadorCitas): { total: number; verificadas: number; no_verificadas: number; sin_frase: number } {
  const r = { total: 0, verificadas: 0, no_verificadas: 0, sin_frase: 0 };
  const walk = (o: any) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    for (const [k, v] of Object.entries(o)) {
      if (k === 'cita' && esCita(v)) {
        loc.localizar(v);
        if (v.metodo === 'sin_frase') r.sin_frase++;
        else { r.total++; if (v.verificada) r.verificadas++; else r.no_verificadas++; }
      } else walk(v);
    }
  };
  walk(inf);
  return r;
}

/** Texto plano de una cita para consumidores que esperan un string ("doc · numeral · pág. N"). */
export function citaATexto(c?: CitaV4 | null): string {
  if (!c || typeof c !== 'object') return '';
  const doc = c.documento_real || c.documento || '';
  if (!doc && !c.frase) return '';
  return [doc, c.numeral, c.pagina ? `pág. ${c.pagina}` : '', c.frase ? `«${String(c.frase).slice(0, 160)}»` : '']
    .filter(Boolean).join(' · ');
}
