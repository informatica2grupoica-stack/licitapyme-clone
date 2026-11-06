// app/lib/compras-adicionales-ia.ts
// UNIR LAS LÍNEAS DE UNA COTIZACIÓN A NUESTROS PRODUCTOS GANADOS — funciones PURAS, con pruebas.
//
// Pedido del usuario (07-oct-2026): una cotización real trae varias líneas (horno SIN quemador + quemador aparte, carro
// sin bandejas + 18 bandejas aparte, sobadora…) pero los productos ganados son solo 3, y las bases exigen que el horno
// venga con quemador y el carro con sus bandejas. Esas líneas no son productos nuestros: son COMPONENTES de uno. Se unen
// al producto como adicionales (suman al precio efectivo) y, si la bases exigen algo que la cotización no trae, se avisa.
import type { AdicionalEntrada } from '@/app/lib/compras-adicionales';

const MAX_POR_PRODUCTO = 20;
/** "P2" → 2 (la IA responde con el código del producto; también se acepta el número solo). */
const codigo = (v: unknown): number => Number(String(v ?? '').replace(/\D/g, ''));

const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]+/g, ' ').trim();

/** Regla de oro del módulo (igual que en compras-auditoria-cotizacion): una afirmación de la IA sobre el documento solo vale si trae una
 *  cita LITERAL que el CÓDIGO encuentra en el texto real (≥ 2 palabras y ≥ 8 caracteres). Sin cita verificada no hay aviso ni "incluido":
 *  la IA tendía a decir "falta el quemador" cuando el documento simplemente no hablaba del tema. */
export function citaVerificada(cita: unknown, textoDocumento: string | null | undefined): boolean {
  if (typeof cita !== 'string' || !textoDocumento) return false;
  const c = norm(cita);
  return c.length >= 8 && c.split(' ').length >= 2 && norm(textoDocumento).includes(c);
}

/** Línea de accesorio que la IA leyó, tal como aparece en el documento (cantidad de la LÍNEA, no por unidad del producto). */
export interface AdicionalLeido { concepto: string; cantidadLinea: number; precioUnitario: number }

const ES_SERVICIO = /flete|transport|despacho|env[ií]o|instala|capacita|mano de obra|armado|montaje|puesta en marcha/i;

/** ¿La cotización es de UNA unidad del producto (un set, un kit) y no del lote completo?
 *  Caso 3789-30-LE26: 30 sets de podología, la cotización trae 14 instrumentos con 1 a 5 piezas cada uno = el contenido de UN set
 *  ($171.671). Dividir esas cantidades por 30 daba 0,1 caja por set y un precio 11 veces más bajo.
 *  Si hay ≥ 4 líneas de piezas (no servicios) y NINGUNA llega a la cantidad del producto, no pueden ser del lote: son por unidad. */
export function cotizacionEsPorUnidad(raw: unknown, cantidadProducto: number | null): boolean {
  if (!Array.isArray(raw) || cantidadProducto == null || !Number.isFinite(cantidadProducto) || cantidadProducto <= 1) return false;
  const piezas = raw
    .filter(a => typeof a?.concepto === 'string' && a.concepto.trim() && Number(a?.precioUnitario) > 0 && !ES_SERVICIO.test(a.concepto))
    .map(a => Number(a?.cantidadLinea ?? a?.cantidad ?? 1))
    .filter(n => Number.isFinite(n) && n > 0);
  return piezas.length >= 4 && piezas.every(n => n < cantidadProducto);
}

/** En una cotización por unidad el precio de cabecera es el de UNA línea (la primera: 9.900 del alicate). Esa misma línea no puede
 *  contar otra vez como adicional: pasa a ser la base, con toda su cantidad (5 alicates = $49.500). Sin línea igual, no cambia nada. */
export function baseDeCotizacionPorUnidad(adicionales: AdicionalEntrada[], precioBase: number | null): { base: number | null; adicionales: AdicionalEntrada[] } {
  if (precioBase == null) return { base: precioBase, adicionales };
  const i = adicionales.findIndex(a => Math.abs(a.precioUnitario - precioBase) <= 1);
  if (i < 0) return { base: precioBase, adicionales };
  const l = adicionales[i];
  return { base: Math.round(l.precioUnitario * l.cantidad), adicionales: adicionales.filter((_, j) => j !== i) };
}

/** Limpia lo que devolvió la IA y lo deja como adicionales por unidad del producto, con el precio en NETO.
 *  · cantidad por unidad = cantidad de la línea ÷ cantidad del producto (18 bandejas para 1 carro → 18; para 2 carros → 9);
 *  · si la cotización es de UNA unidad (`cotizacionEsPorUnidad`), la cantidad de la línea ya es por unidad: no se divide;
 *  · precio ≤ 0, sin nombre o sin cantidad: se descarta (nunca se inventa un adicional). */
export function adicionalesDesdeIA(raw: unknown, cantidadProducto: number | null, aNeto: (n: number) => number): AdicionalEntrada[] {
  if (!Array.isArray(raw)) return [];
  const divisor = cantidadProducto != null && Number.isFinite(cantidadProducto) && cantidadProducto > 0 && !cotizacionEsPorUnidad(raw, cantidadProducto) ? cantidadProducto : 1;
  const out: AdicionalEntrada[] = [];
  for (const a of raw) {
    const concepto = typeof a?.concepto === 'string' ? a.concepto.trim().slice(0, 160) : '';
    const cant = Number(a?.cantidadLinea ?? a?.cantidad ?? 1);
    const precio = Number(a?.precioUnitario);
    if (!concepto || !Number.isFinite(cant) || cant <= 0 || !Number.isFinite(precio) || precio <= 0) continue;
    const porUnidad = cant / divisor;
    // La cantidad se guarda con 2 decimales: 1 instalación para 200 basureros (0,005) quedaba en 0,01 y cobraba el doble
    // (1202333-67-LE26: $400.000 → $800.000). Si no cabe exacta, se reparte el MONTO: 1 × ($400.000 ÷ 200) por unidad.
    if (Math.abs(Math.round(porUnidad * 100) / 100 - porUnidad) > 1e-9) {
      out.push({ concepto: `${concepto} (${cant} × $${Math.round(aNeto(precio)).toLocaleString('es-CL')} repartido en ${divisor} u)`.slice(0, 160), cantidad: 1, precioUnitario: Math.round(aNeto(precio) * porUnidad) });
    } else out.push({ concepto, cantidad: porUnidad, precioUnitario: Math.round(aNeto(precio)) });
    if (out.length >= MAX_POR_PRODUCTO) break;
  }
  return out;
}

/** Lo que las bases exigen y la cotización no trae ("con quemador" pero el documento dice "sin quemador"). */
export function faltantesDesdeIA(raw: unknown, textoDocumento?: string | null): Array<{ producto: number; concepto: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ producto: number; concepto: string }> = [];
  for (const f of raw) {
    const producto = codigo(f?.producto); const concepto = typeof f?.concepto === 'string' ? f.concepto.trim().slice(0, 160) : '';
    if (Number.isInteger(producto) && producto > 0 && concepto && (textoDocumento === undefined || citaVerificada(f?.cita, textoDocumento))) out.push({ producto, concepto });
  }
  return out;
}

/** Producto nuestro que el documento NO precia aparte porque va dentro del precio de otro ("Incluye 1 carro 18x60x40").
 *  Devuelve [producto incluido, producto que lo contiene]. */
export function incluidosDesdeIA(items: unknown, textoDocumento?: string | null): Array<{ producto: number; en: number }> {
  if (!Array.isArray(items)) return [];
  const out: Array<{ producto: number; en: number }> = [];
  for (const it of items) {
    const producto = codigo(it?.producto); const en = codigo(it?.incluidoEn);
    if (Number.isInteger(producto) && producto > 0 && Number.isInteger(en) && en > 0 && en !== producto && (textoDocumento === undefined || citaVerificada(it?.citaIncluido, textoDocumento))) out.push({ producto, en });
  }
  return out;
}

export const CRITERIO_FALTANTE = 'Falta lo que exigen las bases';
