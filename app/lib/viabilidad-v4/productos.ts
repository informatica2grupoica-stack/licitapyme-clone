// app/lib/viabilidad-v4/productos.ts
// P8 · PRODUCTOS Y FICHAS + P11 · UNA SOLA LISTA.
//
//  · Cada característica debe existir LITERAL en las bases. Lo que no se encuentra queda en
//    `caracteristicas_no_encontradas` ("no encontrada en bases") y NO pasa al AUDITOR como
//    requisito hasta revisarla. Antes `completarCaracteristicasLiterales` reemplazaba la lista si
//    la nueva era más larga, y el AUDITOR recibía fichas resumidas o reescritas.
//  · Una sola lista: `productos.items` (con ficha) y `manifiesto_productos` (puente al costeo) salen
//    de la MISMA lista final, después de todas las correcciones. Antes convivían dos listas
//    distintas y la pestaña mostraba una mientras el costeo usaba otra.
//  · Conteo cruzado entre fuentes ("N de N") y control de calidad del manifiesto (V-23: Valdivia
//    traía 21 "ítems" que eran membretes y encabezados con 97 % de confianza).

import { LocalizadorCitas } from '@/app/lib/viabilidad-v4/citas';
import { esFilaNoProducto } from '@/app/lib/fila-no-producto';

const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** ¿La característica existe literal en las bases? En "Ítem: valor" cada parte debe existir. */
export function caracteristicaEnBases(car: string, loc: LocalizadorCitas): boolean {
  const partes = car.split(/\s*[:：]\s*/).map(p => p.trim()).filter(p => norm(p).length >= 2);
  if (!partes.length) return false;
  return partes.every(p => loc.localizar({ frase: p }).verificada === true);
}

/** Separa las características encontradas de las que no (muta los ítems). Devuelve el conteo. */
export function verificarCaracteristicasLiterales(items: any[], loc: LocalizadorCitas): { revisadas: number; no_encontradas: number } {
  let revisadas = 0, noEnc = 0;
  for (const it of items) {
    const cs: string[] = Array.isArray(it?.caracteristicas) ? it.caracteristicas.map((c: any) => String(c ?? '').trim()).filter(Boolean) : [];
    if (!cs.length) continue;
    const ok: string[] = [];
    const fuera: string[] = Array.isArray(it.caracteristicas_no_encontradas) ? [...it.caracteristicas_no_encontradas] : [];
    for (const c of cs) {
      revisadas++;
      if (caracteristicaEnBases(c, loc)) ok.push(c);
      else { fuera.push(c); noEnc++; }
    }
    it.caracteristicas = ok;
    if (fuera.length) it.caracteristicas_no_encontradas = [...new Set(fuera)];
  }
  return { revisadas, no_encontradas: noEnc };
}

// ─── Lista única ──────────────────────────────────────────────────────────────────────────
export interface FilaManifiesto {
  linea: number; categoria: string | null; descripcion: string; modelo: string; cantidad: number | null;
  unidad_medida: string; unidad_inferida: boolean; presupuesto_linea: number | null; tipo: string; ruta: string;
}

const sinEspacios = (s: unknown) => norm(s).replace(/ /g, '');

/**
 * Reasigna el N° de línea del manifiesto usando la TABLA DE MONTOS POR ÍTEM de las bases
 * (presupuesto.por_linea, cada fila con su frase literal "NOMBRE  CANTIDAD  ASIG.  $MONTO").
 * Caso real 1057448-45-LP26: 6 ítems con monto propio y el modelo los emitió todos como "L1"
 * (otra corrida los puso bien L1..L6: dependía de la suerte). Solo actúa si el cruce es UNO A UNO y
 * cubre TODAS las filas; en cualquier duda no toca nada. Entre varios candidatos gana el nombre más
 * largo ("PLACA DE ENFRIAMIENTO" está contenida en "CENTRO DE INCLUSIÓN CON PLACA DE ENFRIAMIENTO").
 * Compara sin espacios (el PDF parte palabras: "ALMACENAMIEN TO").
 */
export function reasignarLineasPorTablaDeMontos(
  manifiesto: FilaManifiesto[],
  porLinea: Array<{ numero: number; cita?: { frase?: string } | null }>,
): { cambiado: boolean; motivo: string } {
  const entradas = porLinea.filter(l => l && Number.isFinite(l.numero) && l.cita?.frase);
  if (entradas.length < 2 || manifiesto.length !== entradas.length) return { cambiado: false, motivo: 'no aplica' };
  if (new Set(entradas.map(e => e.numero)).size !== entradas.length) return { cambiado: false, motivo: 'líneas repetidas' };
  if (new Set(manifiesto.map(m => m.linea)).size >= entradas.length) return { cambiado: false, motivo: 'las líneas ya están separadas' };
  const claves = manifiesto.map(m => sinEspacios(m.descripcion));
  if (claves.some(k => k.length < 4)) return { cambiado: false, motivo: 'descripciones muy cortas' };
  const asignacion = new Map<number, number>(); // índice del manifiesto → N° de línea
  for (const e of entradas) {
    const frase = sinEspacios(e.cita!.frase);
    let mejor = -1;
    manifiesto.forEach((m, i) => {
      if (!frase.includes(claves[i])) return;
      if (m.cantidad != null && !frase.includes(claves[i] + String(m.cantidad))) return; // nombre + cantidad pegados
      if (mejor < 0 || claves[i].length > claves[mejor].length) mejor = i;
    });
    if (mejor < 0 || asignacion.has(mejor)) return { cambiado: false, motivo: 'cruce ambiguo' };
    asignacion.set(mejor, e.numero);
  }
  if (asignacion.size !== manifiesto.length) return { cambiado: false, motivo: 'no cubre todas las filas' };
  manifiesto.forEach((m, i) => { m.linea = asignacion.get(i)!; });
  manifiesto.sort((x, y) => x.linea - y.linea);
  return { cambiado: true, motivo: `${entradas.length} ítems cruzados uno a uno con la tabla de montos de las bases` };
}

const numLinea = (x: unknown) => { const m = String(x ?? '').match(/\d+/); return m ? Number(m[0]) : 1; };

/**
 * Arma la lista ÚNICA: las filas del manifiesto final (que pudo ganar la planilla, la tabla
 * canónica o la extracción dedicada) con la ficha del modelo pegada por descripción, o por línea
 * cuando la línea no está saturada (si en una línea hay más filas que fichas, la clave no
 * discrimina y se prefiere dejar la ficha vacía antes que mostrar la de otro producto — bug
 * 2920-30-LE26 / 1414396-21-LP26).
 */
export function construirListaUnica(manifiesto: FilaManifiesto[], itemsModelo: any[]): any[] {
  const porDesc = new Map<string, any>();
  const porLinea = new Map<number, any[]>();
  for (const it of itemsModelo) {
    const d = norm(it?.nombre ?? it?.descripcion);
    if (d && !porDesc.has(d)) porDesc.set(d, it);
    const l = numLinea(it?.linea);
    if (!porLinea.has(l)) porLinea.set(l, []);
    porLinea.get(l)!.push(it);
  }
  const filasPorLinea = new Map<number, number>();
  for (const m of manifiesto) filasPorLinea.set(m.linea, (filasPorLinea.get(m.linea) || 0) + 1);
  const pos = new Map<number, number>();
  return manifiesto.map(m => {
    let mod = porDesc.get(norm(m.descripcion));
    if (!mod) {
      const fichas = porLinea.get(m.linea) || [];
      if (fichas.length && (filasPorLinea.get(m.linea) || 0) <= fichas.length) {
        const p = pos.get(m.linea) || 0;
        mod = fichas[Math.min(p, fichas.length - 1)];
        pos.set(m.linea, p + 1);
      }
    }
    return {
      linea: `L${m.linea}`,
      nombre: m.descripcion,
      familia: mod?.familia ?? '',
      clasificacion: mod?.clasificacion ?? (m.tipo || 'generico'),
      marca_modelo_referencia: m.modelo || mod?.marca_modelo_referencia || '',
      libertad_de_oferta: !!mod?.libertad_de_oferta,
      caracteristicas: Array.isArray(mod?.caracteristicas) ? mod.caracteristicas : [],
      ...(Array.isArray(mod?.caracteristicas_no_encontradas) && mod.caracteristicas_no_encontradas.length ? { caracteristicas_no_encontradas: mod.caracteristicas_no_encontradas } : {}),
      cantidad: m.cantidad,
      cantidad_variable: mod?.cantidad_variable ?? null,
      unidad_medida: m.unidad_medida,
      unidad_inferida: m.unidad_inferida,
      presupuesto_linea: m.presupuesto_linea,
      libertad_de_pricing: m.presupuesto_linea == null ? true : !!mod?.libertad_de_pricing,
      cita: mod?.cita ?? null,
    };
  });
}

// ─── Conteo cruzado (V-21) ────────────────────────────────────────────────────────────────
export interface ConteoCruzado { final: number; declarado: number | null; fuentes: Array<{ documento: string; rol: string; n_items: number }>; api_lineas: number; cuadra: boolean; detalle: string }

export function conteoCruzado(productos: any, final: number, apiLineas: number): ConteoCruzado {
  const mapa: any[] = Array.isArray(productos?.mapa_items) ? productos.mapa_items : [];
  const fuentes = mapa
    .filter(m => /principal|parcial|espejo/i.test(String(m?.rol || '')) && Number(m?.n_items) > 0)
    .map(m => ({ documento: String(m.documento || ''), rol: String(m.rol || ''), n_items: Number(m.n_items) }));
  const declarado = Number.isFinite(Number(productos?.total_items)) && Number(productos?.total_items) > 0 ? Number(productos.total_items) : null;
  const distintos = new Set(fuentes.map(f => f.n_items));
  const cuadra = (declarado == null || declarado === final) && distintos.size <= 1 && (distintos.size === 0 || distintos.has(final));
  const partes: string[] = [];
  if (declarado != null && declarado !== final) partes.push(`el análisis declaró ${declarado} y la lista final tiene ${final}`);
  if (distintos.size > 1 || (distintos.size === 1 && !distintos.has(final))) partes.push(`las fuentes no coinciden: ${fuentes.map(f => `${f.documento} (${f.n_items})`).join(' · ')}`);
  return { final, declarado, fuentes, api_lineas: apiLineas, cuadra, detalle: partes.join('; ') };
}

// ─── Control de calidad del manifiesto (V-23) ─────────────────────────────────────────────
export function problemasCalidadManifiesto(man: FilaManifiesto[]): string[] {
  if (man.length < 3) return [];
  const p: string[] = [];
  const rotulos = man.filter(m => esFilaNoProducto(m.descripcion)).length;
  if (rotulos >= Math.max(2, man.length * 0.3)) p.push(`${rotulos} de ${man.length} filas son encabezados o rótulos, no productos`);
  const comoFila = man.filter((m, i) => m.cantidad === i + 1).length;
  if (man.length >= 5 && comoFila >= man.length * 0.8) p.push('las cantidades parecen el número de fila (1, 2, 3…)');
  const sinUnidad = man.filter(m => !String(m.unidad_medida || '').trim()).length;
  const sinCantidad = man.filter(m => m.cantidad == null).length;
  if (sinUnidad === man.length && sinCantidad >= man.length * 0.8) p.push('ninguna fila trae unidad y casi ninguna trae cantidad');
  // Palabra partida por el salto de línea del PDF ("Motonivela-"): huella de una fila cortada.
  const cortadas = man.filter(m => /[a-záéíóúñ]-$/i.test(String(m.descripcion).trim())).length;
  if (cortadas >= Math.max(3, man.length * 0.4)) p.push(`${cortadas} descripciones parecen cortadas a media palabra`);
  return p;
}

// ─── Ítems inventados por el modelo ───────────────────────────────────────────────────────
// Golden Arica (2585-87-LE26): el modelo agregó un 3.er producto, "Embarcación a motor de uso
// personal", que no aparece en ningún documento, sin una sola característica; eso descuadró el
// conteo con la API (2 líneas) y dejó el informe en "confirma la cantidad". Un ítem SIN ficha, en
// una lista donde otros ítems sí la tienen, cuyo nombre no aparece en las bases (sus palabras, por
// raíz de 5 letras, en el mismo orden y a menos de 30 caracteres entre sí) se descarta.
const normTxt = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const VACIAS = new Set(['para', 'como', 'tipo', 'unidad', 'unidades', 'marca', 'modelo', 'con', 'sin', 'del', 'las', 'los', 'una', 'uno', 'por']);

export function descartarItemsInventados(items: any[], textosBases: string[], nombresApi: string[] = [], apiItems: Array<{ nombre?: string; descripcion?: string }> = []): any[] {
  const base = normTxt(textosBases.join('\n') + '\n' + nombresApi.join('\n'));
  if (base.length < 200) return [];   // sin texto no hay con qué comparar: no descarta nada
  const conFicha = (it: any) => Array.isArray(it?.caracteristicas) && it.caracteristicas.some((c: unknown) => String(c ?? '').trim());
  if (!items.some(conFicha)) return [];   // lista genérica "a secas": todos sin ficha es normal
  const descartados: any[] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (conFicha(it)) continue;
    const nombre = normTxt(String(it?.nombre || it?.descripcion || '')).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    // Rótulo de categoría de la API ("Embarcaciones a motor de uso personal") tomado como producto, cuando
    // la descripción de esa misma línea de la API ya es el producto de otro ítem que sí tiene ficha.
    const stem = (t: string) => t.slice(0, 5);
    const esRotuloApi = apiItems.some(a => {
      const an = normTxt(String(a?.nombre || '')).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!an || !nombre || stem(an.split(' ')[0]) !== stem(nombre.split(' ')[0])) return false;
      const ad = normTxt(String(a?.descripcion || ''));
      return items.some(o => o !== it && conFicha(o) && ad.includes(normTxt(String(o?.nombre || '')).trim()) && normTxt(String(o?.nombre || '')).trim().length >= 4);
    });
    if (esRotuloApi) { descartados.push(...items.splice(i, 1)); continue; }
    if (nombre.length < 4 || base.includes(nombre)) continue;
    const raices = nombre.split(' ').filter(t => t.length >= 4 && !VACIAS.has(t)).map(t => t.slice(0, 5));
    if (!raices.length) continue;
    const enOrden = new RegExp(raices.join('[\\s\\S]{0,30}'));
    if (!enOrden.test(base)) descartados.push(...items.splice(i, 1));
  }
  return descartados.reverse();
}
