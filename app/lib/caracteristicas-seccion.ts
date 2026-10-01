// app/lib/caracteristicas-seccion.ts
// Ubica, en el texto de las bases, la SECCIÓN de cada equipo específico (p. ej. "4.2 a) CAMIÓN ALZAHOMBRES ... b) CAMIÓN CISTERNA").
// Sirve para una segunda pasada que transcribe TODOS los requisitos del equipo: el análisis general del modelo los resume
// (caso 2369-74-LR26: la cisterna traía ~120 requisitos repartidos en apartados y el informe quedó con 64; el minicargador 33 de ~60).
// Función pura: sin IA ni base de datos.

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const norm = (s: string) => sinTildes(s).replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();

const TOPE_SECCION = 40_000;
const MINIMO_SECCION = 600;

/** Candidatos: líneas que EMPIEZAN con el nombre del equipo (con o sin viñeta "a)", "1.", "4.2 a)"). */
function candidatos(texto: string, nombre: string): number[] {
  const clave = norm(nombre).split(' ').filter(Boolean).slice(0, 3).join(' ');
  if (clave.length < 4) return [];
  const out: number[] = [];
  let pos = 0;
  for (const linea of texto.split('\n')) {
    const limpia = norm(linea.replace(/^\s*(?:\d+(?:\.\d+)*\s*)?(?:[a-z]\)|\d+[.)])?\s*/i, ''));
    if (limpia.startsWith(clave)) out.push(pos);
    pos += linea.length + 1;
  }
  return out;
}

const SEÑAL_SECCION = /presupuesto estimado|antecedentes generales|caracteristicas|requerimientos|requisitos/;

export interface SeccionEquipo { nombre: string; texto: string }

/** Para cada nombre devuelve su sección (del título hasta el título del siguiente equipo o, si es el último, hasta el siguiente
 *  numeral de primer nivel "4.3"/"5."). Omite los equipos cuya sección no se pudo ubicar con seguridad. */
export function seccionesDeEquipos(texto: string, nombres: string[]): Map<string, string> {
  const salida = new Map<string, string>();
  const elegido = new Map<string, number>();
  for (const n of nombres) {
    const todos = candidatos(texto, n);
    // Título de verdad: trae el presupuesto en su misma línea o la siguiente; si no, cualquier candidato con vocabulario de sección.
    const titulos = todos.filter(c => /presupuesto estimado/.test(norm(texto.slice(c, c + 160))));
    const cs = titulos.length ? titulos : todos.filter(c => SEÑAL_SECCION.test(norm(texto.slice(c, c + 500))));
    // El título real es el último candidato con señal de sección (las menciones previas son referencias o índices).
    if (cs.length) elegido.set(n, cs[cs.length - 1]);
  }
  const inicios = [...elegido.values()].sort((a, b) => a - b);
  for (const [n, ini] of elegido) {
    const sig = inicios.find(i => i > ini);
    let fin = sig ?? texto.length;
    if (sig == null) {
      const resto = texto.slice(ini + 200);
      const m = /\n\s*(?:\d+\.\d+|\d+\.)\s+[A-ZÁÉÍÓÚ][^\n]{3,80}\n/.exec(resto);
      if (m) fin = ini + 200 + m.index;
    }
    const sec = texto.slice(ini, Math.min(fin, ini + TOPE_SECCION)).trim();
    if (sec.length >= MINIMO_SECCION) salida.set(n, sec);
  }
  return salida;
}
