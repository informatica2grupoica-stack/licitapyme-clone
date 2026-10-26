// COMPLEMENTOS DE UNA OPCIÓN (26-oct-2026) — núcleo puro (sin BD: lo usan el servidor y las pruebas).
// Caso real 1414396-26-LP26, línea 7: la cotización del horno Unox trae además la osmosis inversa, un enchufe trifásico, 4 bandejas, la
// instalación de cada uno y el envío. El Auditor creaba una OPCIÓN por cada producto (compitiendo con el horno) y el equipo las descartó.
// Un complemento NO compite: se SUMA al costo por unidad de la opción. Todo sale de la MISMA cotización que sostiene el costo del producto
// principal; los montos los calcula el servidor desde la extracción (nunca los manda la pantalla), salvo un cargo manual con su motivo.
import { parsearMonto, normalizarExtraccion, type ProductoNormalizado } from '@/app/lib/auditor-opciones-core';
import type { SalidaLector } from '@/app/lib/auditor-lector';

export type TipoComplemento = 'producto' | 'instalacion' | 'envio' | 'manual';
export interface SugerenciaComplemento {
  clave: string;               // p:<idx> producto · i:<idx> instalación del producto principal · e:envio · m:<marca de tiempo> manual
  tipo: TipoComplemento;
  nombre: string;
  montoDoc: number;            // lo que dice el documento (total de esa fila: precio × cantidad, con su instalación si es un producto)
  cantidadDoc: number | null;  // cantidad cotizada de ese producto (null en cargos)
  porUnidad: number;           // lo que suma al costo de UNA unidad de la opción (se reparte entre las unidades cotizadas del principal)
  detalle: string;             // cómo se calculó, para mostrarlo
}
export interface ComplementoGuardado extends SugerenciaComplemento { por: string; at: string }

const r0 = (n: number) => Math.round(n);
const fmt = (n: number) => `$${r0(n).toLocaleString('es-CL')}`;

/** Instalación cotizada de un producto: el Lector la deja como otro precio con «instalación» en su condición (caso Unox: $91.142). */
export function instalacionDe(salida: SalidaLector, idx: number): number | null {
  const precios = salida.productos?.[idx]?.comercial?.precios || [];
  const p = precios.find(x => /instalaci[oó]n|montaje|puesta en marcha/i.test(`${x.detalle_condicion || ''} ${x.condicion || ''}`) && !/total/i.test(x.detalle_condicion || ''));
  const n = p ? parsearMonto(p.valor) : null;
  return n != null && n > 0 ? n : null;
}

/** Envío cobrado aparte: el Lector lo deja en «observaciones» (no es un producto). Solo se toma si la frase trae el monto. */
export function envioDe(salida: SalidaLector): number | null {
  for (const t of salida.observaciones || []) {
    const m = String(t).match(/(env[ií]o|despacho|flete)[^$\d]{0,80}\$\s?([\d.,]+)/i);
    const n = m ? parsearMonto(m[2]) : null;
    if (n != null && n > 0) return n;
  }
  return null;
}

/** Lo que se puede sumar a la opción cuyo producto principal es `principalIdx` de esa cotización. `ya` = claves ya sumadas (no se ofrecen). */
export function sugerenciasDeComplementos(data: { salida: SalidaLector; texto: string; metodoTexto?: string }, principalIdx: number, ya: Set<string> = new Set()): SugerenciaComplemento[] {
  const salida = data.salida;
  const productos: ProductoNormalizado[] = normalizarExtraccion(data as any);
  const principal = productos[principalIdx];
  if (!principal) return [];
  // Unidades del principal en ESTA cotización: lo cotizado para N unidades se reparte entre N (bandejas 4 para 1 horno = 4 por horno).
  const unidades = principal.cantidadCotizada && principal.cantidadCotizada > 0 ? principal.cantidadCotizada : 1;
  const out: SugerenciaComplemento[] = [];
  const instP = instalacionDe(salida, principalIdx);
  if (instP != null) out.push({ clave: `i:${principalIdx}`, tipo: 'instalacion', nombre: `Instalación de ${principal.nombre}`, montoDoc: instP * unidades, cantidadDoc: unidades, porUnidad: instP, detalle: `${fmt(instP)} por unidad` });
  for (const p of productos) {
    if (p.idx === principalIdx || p.precio == null) continue;
    if (p.esCargo) {
      out.push({ clave: `p:${p.idx}`, tipo: 'envio', nombre: p.nombre, montoDoc: p.precio, cantidadDoc: null, porUnidad: p.precio / unidades, detalle: unidades > 1 ? `${fmt(p.precio)} repartido en ${unidades} unidades` : fmt(p.precio) });
      continue;
    }
    const cant = p.cantidadCotizada && p.cantidadCotizada > 0 ? p.cantidadCotizada : 1;
    const inst = instalacionDe(salida, p.idx);
    const total = (p.precio + (inst ?? 0)) * cant;
    out.push({
      clave: `p:${p.idx}`, tipo: 'producto', nombre: p.nombre, montoDoc: total, cantidadDoc: cant, porUnidad: total / unidades,
      detalle: `${cant > 1 ? `${cant} × ` : ''}${fmt(p.precio)}${inst ? ` + instalación ${fmt(inst)}${cant > 1 ? ' c/u' : ''}` : ''}${unidades > 1 ? `, repartido en ${unidades} unidades` : ''}`,
    });
  }
  const envio = envioDe(salida);
  if (envio != null && !productos.some(p => p.esCargo && /env[ií]o|despacho|flete/i.test(p.nombre)))
    out.push({ clave: 'e:envio', tipo: 'envio', nombre: 'Envío', montoDoc: envio, cantidadDoc: null, porUnidad: envio / unidades, detalle: unidades > 1 ? `${fmt(envio)} repartido en ${unidades} unidades` : fmt(envio) });
  return out.filter(s => !ya.has(s.clave)).map(s => ({ ...s, porUnidad: r0(s.porUnidad) }));
}

/** Pliega los eventos `complemento` de una opción (en orden): «poner» agrega o reemplaza por clave, «quitar» la saca. */
export function plegarComplementos(eventos: Array<{ accion: string; clave: string; [k: string]: unknown }>): ComplementoGuardado[] {
  const m = new Map<string, ComplementoGuardado>();
  for (const e of eventos) {
    if (e.accion === 'quitar') m.delete(e.clave);
    else if (e.accion === 'poner') m.set(e.clave, e as unknown as ComplementoGuardado);
  }
  return [...m.values()];
}

export const sumaPorUnidad = (cs: ComplementoGuardado[]) => cs.reduce((s, c) => s + (Number(c.porUnidad) || 0), 0);

// ── El proveedor anotado es la PROPIA empresa ─────────────────────────────────────────────────────
// Casos reales 26-oct-2026: la cotización GETAC y la del horno Unox decían «Señores / Razón Social: Comercial Mp Spa» (el CLIENTE, o sea
// nosotros) y el Lector lo anotó como proveedor. Se reconoce por RUT o por razón social contra las empresas de la cuenta.
const soloRut = (r: string | null | undefined) => String(r || '').replace(/[^0-9kK]/g, '').toUpperCase();
const soloNombre = (n: string | null | undefined) => String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(spa|s\.?p\.?a\.?|ltda\.?|limitada|s\.?a\.?|eirl|e\.?i\.?r\.?l\.?|y cia\.?)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

export function esPropiaEmpresa(prov: { rut?: string | null; razon?: string | null }, propias: Array<{ rut: string | null; razon_social: string | null }>): boolean {
  const rut = soloRut(prov.rut), razon = soloNombre(prov.razon);
  return propias.some(e => (rut.length >= 7 && rut === soloRut(e.rut)) || (razon.length >= 4 && razon === soloNombre(e.razon_social)));
}

/** Si el proveedor que leyó el Lector es la propia empresa, lo deja vacío, guarda a quién nombraba como «otra empresa» y lo anota en observaciones.
 *  Devuelve true si cambió algo. Muta `salida` (se llama justo después de leer, antes de guardar). */
export function limpiarProveedorPropio(salida: SalidaLector, propias: Array<{ rut: string | null; razon_social: string | null }>): boolean {
  const p: any = salida.proveedor;
  if (!p) return false;
  const razon = p.razon_social?.valor ?? null, rut = p.rut?.valor ?? null;
  if (!esPropiaEmpresa({ rut, razon }, propias)) return false;
  p.otra_empresa_en_documento = { rol: 'destinatario: nuestra propia empresa', razon_social: razon || rut || '', cita: p.razon_social?.cita || p.rut?.cita || '' };
  if (p.razon_social) p.razon_social = { valor: '', cita: '' };
  if (p.rut) p.rut = { valor: '', cita: '' };
  for (const k of ['direccion', 'comuna', 'telefono', 'email']) if (p[k]) p[k] = { valor: '', cita: '' };   // también eran nuestros datos
  salida.observaciones = [...(salida.observaciones || []), `El documento nombraba como «proveedor» a nuestra propia empresa (${razon || rut}): era el destinatario. Revisa quién cotiza.`];
  return true;
}
