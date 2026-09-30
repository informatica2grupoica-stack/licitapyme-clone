// app/lib/auditor-proveedor.ts
// AUDITOR unificado · salidas por código hacia el proveedor y hacia OBUMA (puro, sin base de datos ni red):
//   · UN mensaje por proveedor que junta lo que hay que preguntarle (comercial y de identidad del producto)
//     y los datos que faltan para crearlo, en orden: lo que bloquea primero, los datos administrativos al final.
//     Lo genera el sistema y lo envía el asistente a mano (spec §10).
//   · Mapeo de proveedor y producto a las columnas del formato de carga OBUMA (spec §12). Comuna, región,
//     forma de pago y banco van como TEXTO: OBUMA los pide como ID de catálogo y ese catálogo aún no está
//     cargado (pendiente P-8), por lo que la columna queda vacía y el texto viaja en `pendientes_catalogo`.
import type { OpcionDTO, LineaAuditorDTO } from '@/app/lib/auditor-opciones';

const clp = (n: number | null | undefined) => (n == null ? '' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n));

// ── Mensaje unificado al proveedor ───────────────────────────────────────────────────────────────
export interface MensajeProveedor {
  proveedor: string; rut: string | null; vendedor: string | null; email: string | null; telefono: string | null;
  opcionIds: number[]; bloquea: boolean; preguntas: number; texto: string;
}

function nombreProducto(o: OpcionDTO): string {
  return [o.marca, o.modelo].filter(Boolean).join(' ') || o.producto?.nombre || 'el producto cotizado';
}

/** Preguntas para el proveedor sobre UNA opción. Comparador técnico v3.0 (Paso 4): SOLO técnicas —❓ en características principales, o pedir la ficha—, nunca por
 *  IVA, vigencia, stock, plazo ni datos de la empresa (la auditoría de costo pasa a Precompra). Las arma el comparador (máx. 3 por proveedor); aquí solo se leen. */
export interface PreguntaProveedor { texto: string; bloquea: boolean }

export function preguntasDeOpcion(o: OpcionDTO, _linea?: LineaAuditorDTO): PreguntaProveedor[] {
  return (o.tecnico?.resultado?.preguntas ?? []).map(q => ({ bloquea: q.bloquea, texto: q.texto }));
}

// ── Quién es «el mismo proveedor» ────────────────────────────────────────────────────────────────
// Una opción sale de una cotización (con razón social y RUT) y otra de un link (con el nombre de la tienda): «Sociedad de Inversiones
// Audiofans Spa» y «Sociedad de Inversiones Audiofans SpA», o «HORIZONTAL SPA» y «HorizontalFoto», son la misma empresa y reciben UN mensaje.
const SUFIJO_LEGAL = /\b(spa|s\.?a\.?|ltda\.?|limitada|e\.?i\.?r\.?l\.?|sociedad an[oó]nima|y cia\.?|chile)\b/g;
export const nombreProveedorNorm = (n: string | null | undefined) =>
  (n || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(SUFIJO_LEGAL, ' ').replace(/[^a-z0-9]+/g, '');
const rutNorm = (r: string | null | undefined) => (r || '').replace(/[.\s]/g, '').toUpperCase();

export function mismoProveedor(a: { rut?: string | null; nombre?: string | null }, b: { rut?: string | null; nombre?: string | null }): boolean {
  const ra = rutNorm(a.rut), rb = rutNorm(b.rut);
  if (ra && rb) return ra === rb;
  const na = nombreProveedorNorm(a.nombre), nb = nombreProveedorNorm(b.nombre);
  if (!na || !nb) return false;
  return na === nb || (Math.min(na.length, nb.length) >= 8 && (na.includes(nb) || nb.includes(na)));
}

/** Tope de preguntas por proveedor (comparador técnico v3.0, Paso 4). */
export const MAX_PREGUNTAS_MENSAJE = 3;

export function mensajesUnificadosPorProveedor(lineas: LineaAuditorDTO[]): MensajeProveedor[] {
  const grupos: Array<{ rut: string; nombres: string[]; opciones: Array<{ o: OpcionDTO; l: LineaAuditorDTO }> }> = [];
  for (const l of lineas) for (const o of l.opciones) {
    if (['descartada', 'aprobada', 'en_aprobacion'].includes(o.estado)) continue;
    const ref = { rut: o.proveedorRut, nombre: o.proveedorRazonSocial };
    if (!rutNorm(ref.rut) && !nombreProveedorNorm(ref.nombre)) continue;
    const g = grupos.find(x => (x.rut && rutNorm(ref.rut) ? x.rut === rutNorm(ref.rut) : x.nombres.some(n => mismoProveedor({ nombre: n }, { nombre: ref.nombre }))));
    if (g) { g.opciones.push({ o, l }); if (!g.rut) g.rut = rutNorm(ref.rut); if (ref.nombre) g.nombres.push(ref.nombre); }
    else grupos.push({ rut: rutNorm(ref.rut), nombres: ref.nombre ? [ref.nombre] : [], opciones: [{ o, l }] });
  }
  const out: MensajeProveedor[] = [];
  for (const { opciones } of grupos) {
    const primero = (opciones.find(x => x.o.proveedorRut) || opciones[0]).o;
    const datos = opciones.map(x => x.o.proveedorDatos).find(Boolean) || null;
    // Un solo mensaje corto por proveedor: primero las que piden ficha (las que más pesan), sin repetidas, y máximo MAX_PREGUNTAS.
    const todas = [...new Set(opciones.flatMap(({ o, l }) => preguntasDeOpcion(o, l).map(q => q.texto)))];
    const fichas = todas.filter(q => /ficha t[eé]cnica/i.test(q)), otras = todas.filter(q => !/ficha t[eé]cnica/i.test(q));
    const preguntas = [...fichas, ...otras].slice(0, MAX_PREGUNTAS_MENSAJE);
    if (!preguntas.length) continue;

    const vendedor = datos?.vendedor?.valor?.trim();
    const doc = opciones.map(x => x.o.documentoInfo).find(d => d?.numero);
    const texto = [
      `Hola${vendedor ? ` ${vendedor.split(/\s+/)[0]}` : ''}, buenos días. Junto con saludar, revisando su cotización${doc?.numero ? ` N° ${doc.numero}` : ''}${doc?.fechaEmision ? ` del ${doc.fechaEmision}` : ''} necesitamos confirmar lo siguiente:`,
      preguntas.map((t, i) => `${i + 1}. ${t}`).join('\n'),
      'Muchas gracias, quedamos atentos.',
    ].join('\n\n');
    out.push({
      proveedor: primero.proveedorRazonSocial || primero.proveedorRut || 'Proveedor', rut: primero.proveedorRut,
      vendedor: vendedor || null, email: datos?.email?.valor || null, telefono: datos?.celular?.valor || datos?.telefono?.valor || null,
      opcionIds: opciones.map(x => x.o.id), bloquea: true, preguntas: preguntas.length, texto,
    });
  }
  return out.sort((a, b) => Number(b.bloquea) - Number(a.bloquea));
}

// ── Formato de carga OBUMA ───────────────────────────────────────────────────────────────────────
/** Dígito verificador del RUT chileno (módulo 11). */
export function rutValido(rut: string | null | undefined): boolean {
  const limpio = (rut || '').replace(/[.\s]/g, '').toUpperCase();
  const m = limpio.match(/^(\d{1,8})-([\dK])$/);
  if (!m) return false;
  let suma = 0, mult = 2;
  for (const d of m[1].split('').reverse()) { suma += Number(d) * mult; mult = mult === 7 ? 2 : mult + 1; }
  const dv = 11 - (suma % 11);
  return m[2] === (dv === 11 ? '0' : dv === 10 ? 'K' : String(dv));
}

export interface FilaOBUMA { columnas: Record<string, string | number>; pendientes_catalogo: string[]; avisos: string[] }

export function proveedorOBUMA(o: OpcionDTO, licitacionCodigo: string, hoyISO: string): FilaOBUMA {
  const d = o.proveedorDatos || {};
  const v = (x?: { valor?: string }) => (x?.valor || '').trim();
  const rut = (o.proveedorRut || v(d.rut)).trim(), extranjero = !rut && !!v(d.id_tributario_extranjero);
  const avisos: string[] = [];
  if (rut && !rutValido(rut)) avisos.push(`El RUT ${rut} no tiene un dígito verificador válido: revísalo con el documento.`);
  const pendientes = [
    v(d.comuna) && `proveedor_comuna: "${v(d.comuna)}"`, v(d.region) && `proveedor_region: "${v(d.region)}"`,
    v(d.condiciones_pago) && `proveedor_forma_pago: "${v(d.condiciones_pago)}"`, d.transferencia?.banco && `proveedor_banco_cuenta: "${d.transferencia.banco}"`,
  ].filter(Boolean) as string[];
  return {
    columnas: {
      proveedor_id: '', proveedor_rut: rut, proveedor_extranjero: extranjero ? 1 : 0, proveedor_extranjero_id: v(d.id_tributario_extranjero),
      proveedor_contacto: v(d.vendedor), proveedor_razon_social: o.proveedorRazonSocial || v(d.razon_social),
      proveedor_nombre_fantasia: v(d.nombre_fantasia), proveedor_giro_comercial: v(d.giro), proveedor_direccion: v(d.direccion),
      proveedor_comuna: '', proveedor_region: '', proveedor_pais: v(d.pais) || (extranjero ? '' : 'Chile'),
      proveedor_telefono: v(d.telefono), proveedor_celular: v(d.celular), proveedor_email: v(d.email), proveedor_website: v(d.website),
      proveedor_forma_pago: '', proveedor_banco_cuenta: '', proveedor_nro_cuenta: d.transferencia?.numero_cuenta || '',
      proveedor_tipo_cuenta: d.transferencia?.tipo_cuenta || '',
      proveedor_diasdepago: (v(d.condiciones_pago).match(/(\d{1,3})\s*d[ií]as/i)?.[1]) || '', proveedor_plazodepago: '',
      // OBUMA no tiene campo de bodega: la dirección de retiro, la licitación y la fecha van en la observación.
      proveedor_observacion: [v(d.direccion_bodega) && `Bodega/retiro: ${v(d.direccion_bodega)}`, `Licitación ${licitacionCodigo}`, hoyISO].filter(Boolean).join(' · '),
    },
    pendientes_catalogo: pendientes, avisos,
  };
}

export function productoOBUMA(o: OpcionDTO, linea: LineaAuditorDTO): FilaOBUMA {
  const p = o.producto, avisos: string[] = [];
  const respaldo = o.respaldos.find(r => r.sostieneCosto) || o.respaldos[0];
  if (o.verificacion?.costoNetoUnitario == null) avisos.push('Sin costo neto verificado: la columna de costo queda vacía.');
  const factor = p?.unidadesPorEmpaque && p.unidadesPorEmpaque > 1 ? p.unidadesPorEmpaque : '';
  return {
    columnas: {
      producto_nombre: [p?.tipo, o.marca, o.modelo].filter(Boolean).join(' ') || linea.detalle.split(' - ')[0],
      producto_modelo: o.modelo || '', producto_fabricante: o.marca || '', producto_descripcion: linea.detalle.split(' - ')[0],
      producto_descripcion_larga: linea.detalle, producto_codigo_comercial: o.sku || '', codigo_producto: p?.sku || '',
      producto_garantia_observacion: p?.garantia || '', producto_plazo_entrega: p?.plazoTexto || '',
      producto_costo_clp_neto: o.verificacion?.costoNetoUnitario ?? '', producto_web_link: respaldo?.url || respaldo?.documentoUrl || '',
      producto_unidad_medida: linea.unidad, producto_unidad_medida_factor_conversion: factor, producto_exento_iva: 0,
      rel_proveedor_id: '', // se resuelve DESPUÉS de crear el proveedor en OBUMA (primero proveedor, luego producto)
    },
    pendientes_catalogo: [], avisos,
  };
}

/** Escapa una celda CSV (separador ";" por la coma decimal chilena). */
export function aCSV(filas: Array<Record<string, string | number>>): string {
  if (!filas.length) return '';
  const cols = Object.keys(filas[0]);
  const celda = (x: string | number) => { const t = String(x ?? ''); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return [cols.join(';'), ...filas.map(f => cols.map(c => celda(f[c])).join(';'))].join('\n');
}
