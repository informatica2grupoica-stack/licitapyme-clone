// app/lib/viabilidad-v4/presupuesto.ts
// P2 · PRESUPUESTO — el modelo copia los montos TAL CUAL ("M$ 872.079"); el código los interpreta.
//
// Cholchol: "M$ 872.079" podía leerse como $872.079 cuando son $872.079.000 (M$ = miles de pesos).
// El carácter (EXCLUYENTE/REFERENCIAL/NO_DECLARADO) lo reporta el modelo con su cita; la cláusula
// de modificación del contrato hasta 30 % no es evidencia de nada.

export interface MontoInterpretado { pesos: number | null; miles: boolean; con_iva: boolean | null }

/**
 * Interpreta un monto escrito como en las bases. Acepta "$52.000.000", "M$ 872.079",
 * "$ 1.970.640 (IVA incluido)", "52000000", "$52 millones". Devuelve null si no hay cifra.
 */
export function interpretarMonto(texto: unknown): MontoInterpretado {
  const s = String(texto ?? '').trim();
  if (!s) return { pesos: null, miles: false, con_iva: null };
  const miles = /\bM\s*\$|\$\s*M\b|miles\s+de\s+pesos/i.test(s);
  const millones = /millones?\b|MM\s*\$|\$\s*MM\b/i.test(s);
  const con_iva = /iva\s+inclu|impuestos?\s+inclu|con\s+iva/i.test(s) ? true : /\bneto\b|sin\s+iva|\+\s*iva/i.test(s) ? false : null;
  // La cifra pegada al "$" manda ("2 motoniveladoras: $872.079.000" no es 2); si no hay "$", la
  // cifra más larga del texto.
  const reCifra = /\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g;
  const trasPeso = s.match(/\$\s*(\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?|\d+(?:,\d+)?)/);
  const cifra = trasPeso?.[1] ?? (s.match(reCifra) || []).sort((a, b) => b.length - a.length)[0];
  if (!cifra) return { pesos: null, miles, con_iva };
  let t = cifra.replace(/[.\s](?=\d{3}\b)/g, '');
  t = t.replace(',', '.');
  let n = Number(t);
  if (!Number.isFinite(n)) return { pesos: null, miles, con_iva };
  // Una cifra suelta, sin "$", sin puntos de miles y chica no es un monto: es un numeral o un N°
  // ("…se encuentra especificado en el numeral 13 de las presentes Bases", 2905-52-LE26 → $13).
  if (!trasPeso && !miles && !millones && !/[.\s]\d{3}/.test(cifra) && n < 100_000) return { pesos: null, miles, con_iva };
  // Un "M$" con una cifra ya de 10+ dígitos ("M$ 1.158.670.000", total que el modelo sumó en pesos y
  // rotuló M$) multiplicado por 1.000 daría más de un billón de pesos: ya viene en pesos. Ninguna
  // licitación de este negocio se acerca a ese monto (golden Cholchol 4993-70-LR26, 07-oct-2026).
  if (miles && n < 1_000_000_000) n *= 1_000;
  // Lo mismo con "millones": una cifra que ya viene en millones de pesos es el monto escrito en
  // número y la palabra es la glosa en letras ("$28.003.098.-(Veintiocho millones tres mil…)",
  // 2446-307-LE26, leído como $28 billones).
  else if (millones && n < 1_000_000) n *= 1_000_000;
  return { pesos: Math.round(n), miles, con_iva };
}

export interface LineaPresupuesto {
  linea: string; numero: number; monto_texto: string; monto_pesos: number | null; neto: number | null; cita?: any;
}

const numLinea = (x: unknown) => { const m = String(x ?? '').match(/\d+/); return m ? Number(m[0]) : 0; };

/** Presupuesto por línea interpretado (con neto). `exento` = sin IVA que descontar. */
export function interpretarPorLinea(porLinea: unknown, exento: boolean, conIvaDefault = true): LineaPresupuesto[] {
  if (!Array.isArray(porLinea)) return [];
  return porLinea.filter(p => p && typeof p === 'object').map((p: any) => {
    // Informes que ya traen el monto numérico (bruto) — tabla determinista de distribución.
    const directo = typeof p.bruto === 'number' && p.bruto > 0 ? p.bruto : null;
    const it = directo != null ? { pesos: directo, miles: false, con_iva: true } : interpretarMonto(p.monto_texto);
    const conIva = it.con_iva ?? conIvaDefault;
    const neto = it.pesos == null ? null : Math.round(exento || !conIva ? it.pesos : it.pesos / 1.19);
    // `monto_pesos` va siempre CON IVA (salvo exento), como el total: el costeo y el Motor Comercial lo
    // dividen por 1,19 para sacar el tope neto. Un monto que las bases escriben "(neto)" se guardaba tal
    // cual y se descontaba el IVA dos veces (1488-39-LE26: cada hoja con un tope 16 % más bajo).
    const montoPesos = it.pesos == null ? null : exento || conIva ? it.pesos : Math.round(it.pesos * 1.19);
    const numero = numLinea(p.linea);
    return { linea: numero ? `L${numero}` : String(p.linea ?? ''), numero, monto_texto: String(p.monto_texto ?? (directo != null ? `$${directo.toLocaleString('es-CL')}` : '')), monto_pesos: montoPesos, neto, cita: p.cita };
  }).filter(l => l.numero > 0);
}

/**
 * Montos por línea escritos en MILES sin "M$" en la frase ("VALOR TOTAL IVA INCLUIDO $ 10.710" de una
 * tabla cuyo encabezado dice M$ — 1057898-88-LP26, -103-LP26, -74-LE26): si la suma ×1.000 da el total
 * (±2 %) y ninguna línea llega a $1.000.000, se multiplican por 1.000 (muta). Devuelve si escaló.
 */
export function escalarLineasEnMiles(lineas: LineaPresupuesto[], totalBruto: number | null): boolean {
  const con = lineas.filter(l => l.monto_pesos != null);
  if (con.length < 2 || con.length !== lineas.length || !totalBruto) return false;
  if (con.some(l => (l.monto_pesos as number) >= 1_000_000)) return false;
  const suma = con.reduce((a, l) => a + (l.monto_pesos as number), 0);
  if (Math.abs(suma * 1000 - totalBruto) / totalBruto > 0.02) return false;
  for (const l of con) { l.monto_pesos = (l.monto_pesos as number) * 1000; if (l.neto != null) l.neto *= 1000; }
  return true;
}

/**
 * Bruto total a usar según el monto que el modelo copió de las bases. El texto manda: el modelo a veces
 * escribe en `bruto` otra cifra (2711-19-LP26: texto $72.911.000, bruto $61.163.293) o le suma un IVA
 * que las bases no piden (1057898-74-LE26: texto $14.544.000, bruto $17.287.376). Si el texto dice
 * "neto" (y no es exento), el bruto es el texto × 1,19. null = el texto no trae cifra: queda el del modelo.
 */
export function brutoDesdeTexto(montoTexto: unknown, brutoModelo: number | null, exento: boolean): { bruto: number; cambia: boolean; miles: boolean } | null {
  // Con dos montos distintos en el texto no se sabe cuál es el total: "LINEA 1 … $36.419.000.- LINEA 2 …
  // $46.882.000.-" (4697-25-LP26) o "$20.168.067.- Valor neto $24.000.000.- con impuestos" (948354-149-LE26).
  const montos = new Set((String(montoTexto ?? '').match(/\$\s*\d[\d.\s]*\d/g) || []).map(m => m.replace(/\D/g, '')));
  if (montos.size >= 2) return null;
  const it = interpretarMonto(montoTexto);
  if (!it.pesos) return null;
  const bruto = it.con_iva === false && !exento ? Math.round(it.pesos * 1.19) : it.pesos;
  const cambia = brutoModelo == null || brutoModelo <= 0 || Math.abs(brutoModelo - bruto) / bruto > 0.01;
  return { bruto, cambia, miles: it.miles };
}

/** ¿La suma de las líneas cuadra con el total (±1 %)? null si no hay con qué comparar. */
export function sumaLineasCuadra(lineas: LineaPresupuesto[], totalBruto: number | null): boolean | null {
  const con = lineas.filter(l => l.monto_pesos != null);
  if (con.length < 2 || !totalBruto) return null;
  const suma = con.reduce((a, l) => a + (l.monto_pesos || 0), 0);
  return Math.abs(suma - totalBruto) / totalBruto <= 0.01;
}

export type CaracterPresupuesto = 'EXCLUYENTE' | 'REFERENCIAL' | 'NO_DECLARADO';
export function normalizarCaracter(x: unknown): CaracterPresupuesto {
  const s = String(x ?? '').toUpperCase();
  if (s.startsWith('EXCLU')) return 'EXCLUYENTE';
  if (s.startsWith('REFER') || s.startsWith('ESTIM')) return 'REFERENCIAL';
  return 'NO_DECLARADO';
}

export const NOTA_ART_32 = 'Presupuesto no excluyente: se puede ofertar sobre el estimado. Si se adjudica más de un 30 % sobre el monto estimado, el organismo debe justificarlo (art. 32, D661). Riesgo acotado.';

/**
 * Detector en código de un presupuesto EXCLUYENTE con texto expreso ("El oferente que exceda el
 * presupuesto máximo disponible quedará fuera de bases", "no podrá superar el presupuesto…").
 * Respaldo del modelo: en el golden Cholchol (4993-70-LR26) citó otra frase y el chequeo semántico
 * lo bajó a NO_DECLARADO aunque las bases lo dicen expresamente. La cláusula de modificación del
 * contrato (hasta 30 %) NO cuenta: exige que la frase hable de exceder/superar el PRESUPUESTO o
 * monto disponible y de una consecuencia de exclusión.
 */
export function detectarPresupuestoExcluyente(docs: { nombre: string; texto: string }[]): { documento: string; frase: string } | null {
  const re = /(?:(?:exced\w+|supe\w+|sobrepas\w+)\s+(?:de\s+)?(?:el\s+|al?\s+)?(?:presupuesto|monto)\s+(?:m[aá]ximo\s+|m[aá]x\.?\s+)?(?:disponible|estimado|referencial|oficial|asignado)?[^.\n]{0,80}(?:quedar[aá]n?\s+fuera|ser[aá]n?\s+(?:declarad\w+\s+)?(?:inadmisible|rechazad|desestimad)|no\s+ser[aá]n?\s+(?:evaluad|considerad|admitid))|no\s+podr[aá]n?\s+(?:superar|exceder)\s+(?:el\s+)?(?:presupuesto|monto)\s+(?:m[aá]ximo\s+)?(?:disponible|estimado|asignado|oficial)[^.\n]{0,100}(?:fuera|inadmisible|rechaz|desestim))/i;
  for (const d of docs) {
    if (!d.texto || /^COSTEO_/i.test(d.nombre)) continue;
    const m = d.texto.match(re);
    if (!m || m.index == null) continue;
    // La oración completa que contiene la coincidencia (para que la frase sea citable y literal).
    const ini = Math.max(d.texto.lastIndexOf('.', m.index - 1) + 1, d.texto.lastIndexOf('\n', m.index - 1) + 1, 0);
    const finPunto = d.texto.indexOf('.', m.index + m[0].length);
    const fin = finPunto < 0 ? m.index + m[0].length : finPunto + 1;
    const frase = d.texto.slice(ini, fin).replace(/\s+/g, ' ').replace(/^[\s:·-]*(?:observaci[oó]n:)?\s*/i, '').trim();
    return { documento: d.nombre, frase: frase.slice(0, 300) };
  }
  return null;
}
