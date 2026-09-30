// app/lib/auditor-proveedor.ts
// AUDITOR unificado · salidas por código hacia el proveedor y hacia OBUMA (puro, sin base de datos ni red):
//   · UN mensaje por proveedor que junta lo que hay que preguntarle (comercial y de identidad del producto)
//     y los datos que faltan para crearlo, en orden: lo que bloquea primero, los datos administrativos al final.
//     Lo genera el sistema y lo envía el asistente a mano (spec §10).
//   · Mapeo de proveedor y producto a las columnas del formato de carga OBUMA (spec §12). Comuna, región,
//     forma de pago y banco van como TEXTO: OBUMA los pide como ID de catálogo y ese catálogo aún no está
//     cargado (pendiente P-8), por lo que la columna queda vacía y el texto viaja en `pendientes_catalogo`.
import type { OpcionDTO, LineaAuditorDTO } from '@/app/lib/auditor-opciones';
import { faltantesProveedor } from '@/app/lib/auditor-opciones-core';

const clp = (n: number | null | undefined) => (n == null ? '' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n));

// ── Mensaje unificado al proveedor ───────────────────────────────────────────────────────────────
export interface MensajeProveedor {
  proveedor: string; rut: string | null; vendedor: string | null; email: string | null; telefono: string | null;
  opcionIds: number[]; bloquea: boolean; preguntas: number; texto: string;
}

function nombreProducto(o: OpcionDTO): string {
  return [o.marca, o.modelo].filter(Boolean).join(' ') || o.producto?.nombre || 'el producto cotizado';
}

/** Preguntas para el proveedor sobre UNA opción, ya redactadas, con las que bloquean primero. */
export interface PreguntaProveedor { texto: string; bloquea: boolean; /** 'plazo' se junta en UNA pregunta por proveedor */ clave?: 'plazo'; sujeto?: string }

export function preguntasDeOpcion(o: OpcionDTO, linea: LineaAuditorDTO): PreguntaProveedor[] {
  const v = o.verificacion, p = o.producto;
  if (!v) return [];
  const prod = nombreProducto(o), sku = p?.sku ? ` (código ${p.sku})` : '';
  const out: PreguntaProveedor[] = [];
  // Preguntas TÉCNICAS del verificador técnico (solo sobre lo abierto, nunca sobre lo cualitativo): entran al mismo mensaje.
  for (const q of o.tecnico?.resultado?.preguntas ?? []) out.push({ bloquea: q.bloquea, texto: q.texto });
  const hay = (codigo: string) => v.bloqueos.some(b => b.codigo === codigo);
  const alerta = (codigo: string) => v.alertas.find(a => a.codigo === codigo && a.accion === 'pedir_proveedor');

  if (hay('V1')) out.push({ bloquea: true, texto: `¿Nos confirman la marca y el modelo exactos de ${prod}${sku}? La cotización no los indica con claridad.` });
  if (hay('V3') && (p?.moneda || 'CLP') === 'CLP') out.push({ bloquea: true, texto: `El precio unitario de ${prod}${p?.precio != null ? ` (${clp(p.precio)})` : ''}: ¿es neto o incluye IVA?` });
  if (hay('V2') && p?.moq != null) out.push({ bloquea: true, texto: `Para ${prod} piden un mínimo de compra de ${p.moq} unidades y necesitamos ${linea.cantidad}. ¿Pueden vendernos esa cantidad?` });
  if (hay('SIN_RESPALDO')) out.push({ bloquea: true, texto: `¿Nos pueden enviar la cotización formal de ${prod} con el precio, la marca/modelo y si el valor es neto o con IVA?` });

  // La pregunta de la IA de costo (Prompt 5, campo ③) entra al mismo mensaje cuando la opción está bloqueada y las reglas de código no armaron ninguna.
  const qIA = o.costoIA?.ayuda?.preguntaProveedor?.trim();
  if (qIA && v.bloqueos.length > 0 && out.length === 0) out.push({ bloquea: true, texto: qIA });

  const v2 = alerta('V2');
  if (v2 && p?.cantidadCotizada != null) out.push({ bloquea: false, texto: `La cotización de ${prod} es por ${p.cantidadCotizada} unidades y necesitamos ${linea.cantidad}: ¿mantienen el precio unitario para ${linea.cantidad}?` });
  else if (v2) out.push({ bloquea: false, texto: `Para ${prod}: ¿nos confirman cuántas unidades trae el precio cotizado y si lo mantienen para ${linea.cantidad}?` });
  if (alerta('V7')) out.push({ bloquea: false, texto: `¿Pueden revalidar el precio y la vigencia de la cotización de ${prod}? ${v.alertas.find(a => a.codigo === 'V7')?.mensaje.startsWith('La cotización venció') ? 'La actual ya venció.' : 'Nos gustaría confirmar que sigue vigente.'}` });
  if (alerta('V6')) out.push({ bloquea: false, texto: `¿Tienen stock de ${prod} para ${linea.cantidad} unidades? Y, si es así, ¿en qué plazo pueden entregar?` });
  else if (!p?.plazoTexto) out.push({ bloquea: false, clave: 'plazo', sujeto: prod, texto: `¿Cuál es el plazo de entrega de ${prod}?` });
  return out;
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
    const bloqueantes: string[] = [], otras: string[] = [], sujetosPlazo: string[] = [];
    for (const { o, l } of opciones) for (const q of preguntasDeOpcion(o, l)) {
      if (q.clave === 'plazo') sujetosPlazo.push(q.sujeto || '');
      else (q.bloquea ? bloqueantes : otras).push(q.texto);
    }
    // El plazo se pregunta UNA vez por proveedor, nombrando todos los productos.
    if (sujetosPlazo.length) otras.push(sujetosPlazo.length === 1 ? `¿Cuál es el plazo de entrega de ${sujetosPlazo[0]}?` : `¿Cuál es el plazo de entrega de cada uno de estos productos: ${sujetosPlazo.join('; ')}?`);
    const faltantes = faltantesProveedor(datos);
    if (!bloqueantes.length && !otras.length && !faltantes.length) continue;

    const lista = (xs: string[], desde: number) => xs.map((t, i) => `${desde + i}. ${t}`).join('\n');
    const partes: string[] = [];
    const vendedor = datos?.vendedor?.valor?.trim();
    const doc = opciones.map(x => x.o.documentoInfo).find(d => d?.numero);
    partes.push(`Hola${vendedor ? ` ${vendedor.split(/\s+/)[0]}` : ''}, buenos días. Junto con saludar, revisando su cotización${doc?.numero ? ` N° ${doc.numero}` : ''}${doc?.fechaEmision ? ` del ${doc.fechaEmision}` : ''} necesitamos confirmar lo siguiente:`);
    const preguntas = [...bloqueantes, ...otras];
    if (preguntas.length) partes.push(lista(preguntas, 1));
    if (faltantes.length) partes.push(`Además, para poder registrarlos como proveedor necesitamos estos datos de su empresa: ${faltantes.join(', ')}.`);
    partes.push('Muchas gracias, quedamos atentos.');

    out.push({
      proveedor: primero.proveedorRazonSocial || primero.proveedorRut || 'Proveedor', rut: primero.proveedorRut,
      vendedor: vendedor || null, email: datos?.email?.valor || null, telefono: datos?.celular?.valor || datos?.telefono?.valor || null,
      opcionIds: opciones.map(x => x.o.id), bloquea: bloqueantes.length > 0, preguntas: preguntas.length + (faltantes.length ? 1 : 0),
      texto: partes.join('\n\n'),
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
