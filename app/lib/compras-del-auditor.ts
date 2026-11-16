// app/lib/compras-del-auditor.ts
// PESTAÑA «REVISADO DEL AUDITOR» (Costeo y auditoría, Compras). Lo que el asistente ya cargó y revisó en el Auditor
// (cotizaciones y fichas técnicas, por producto) se muestra en Compras y se pasa con un botón «Usar»: es como subirlo,
// pero se reutiliza el MISMO archivo y lo que el Auditor ya leyó (sin releer, sin gastar IA).
//   · LEER: solo lectura sobre el Auditor (`armarPanelAuditorCompartido`). No crea ni cambia nada del Auditor.
//   · USAR una cotización → `registrarCotizacion` con el producto y el precio neto ya asignados (no corre la homologación por IA).
//     Si ese mismo archivo ya está en Compras, solo se le suma el producto. Nunca duplica.
//   · USAR una ficha → `asignarProductoDeFicha` (queda en el espacio `cmp:` de Compras, igual que una ficha subida allá).
// El panel de fichas de Compras sigue sin leer el Auditor: lo único que cruza es lo que la persona decide usar.
import pool from '@/app/lib/db';
import { armarPanelAuditorCompartido, cargarEstadoCosteo, lineasAuditables, type Actor, type OpcionDTO } from '@/app/lib/auditor-opciones';
import { listarProductosCompra } from '@/app/lib/compras';
import { lineaDeProducto, filaDeProducto, asignarProductoDeFicha, filaDeProductoCompra } from '@/app/lib/compras-fichas';
import { registrarCotizacion, listarCotizaciones, asignarItemsCotizacion, type AsignacionItemManual } from '@/app/lib/compras-auditor';
import {
  esElegida, etiquetaEstado, respaldoQueSostiene, fichasUsables, origenDeArchivo, motivoCotizacionNoUsable, textoCumple,
} from '@/app/lib/compras-del-auditor-core';

export interface ItemDelAuditor {
  /** `c:<respaldoId>` cotización · `f:<respaldoId>` ficha. */
  clave: string;
  tipo: 'cotizacion' | 'ficha';
  opcionId: number; respaldoId: number;
  nombre: string; url: string;
  proveedor: string | null; proveedorRut: string | null;
  marca: string | null; modelo: string | null;
  estadoOpcion: string; estadoTexto: string; elegida: boolean;
  subidoPor: string | null; subidoAt: string | null;
  /** Cotización: precio neto por unidad que el Auditor verificó (incluye los complementos que sumó). */
  precioNeto: number | null; ivaDeclarado: boolean | null;
  /** Ficha: lo que dice el comparador del Auditor («Cumple 11 de 12»). */
  cumple: string | null; noCumple: number; sinVeredicto: number;
  /** Ya está en Compras (cotización con ese archivo y ese producto, o ficha de ese producto). */
  yaEnCompras: boolean;
  /** Ficha que ya está en Compras en OTROS productos (por ejemplo la del biombo guardada en el biombo y no en la unidad). */
  tambienEn: string[];
  /** null = se puede usar. Si no, la razón en palabras de la persona. */
  motivoNoUsable: string | null;
}
export interface ProductoDelAuditor {
  productoId: number; filaId: string; item: number; descripcion: string; cantidad: number | null; costeadoNeto: number | null;
  items: ItemDelAuditor[];
}
export interface PanelDelAuditor {
  productos: ProductoDelAuditor[];
  /** Líneas del Auditor que no calzan con ningún producto de Compras (renunciado, creado a mano, parte que se compra aparte…): la persona elige a qué producto va cada documento. */
  sinProducto: Array<{ filaId: string; item: number; descripcion: string; items: ItemDelAuditor[] }>;
  /** Todos los productos de Compras a los que se puede mandar un documento (incluye los que no vienen del costeo). `admiteFicha` = no es un servicio. */
  destinos: Array<{ productoId: number; descripcion: string; cantidad: number | null; admiteFicha: boolean }>;
  compraAprobada: boolean;
  porUsar: number;
  sinCosteo: boolean;
}

const corto = (s: string) => s.replace(/\s+/g, ' ').trim().split(' - ')[0].slice(0, 90);

async function compraAprobadaDe(negocioId: number): Promise<boolean> {
  try {
    const [rows] = await pool.query(`SELECT tipo, estado FROM compras_aprobacion WHERE negocio_id = ?`, [negocioId]) as any;
    return (rows as any[]).some(a => a.tipo === 'COMPRA' && String(a.estado).startsWith('APROBADA'));
  } catch { return false; }
}

/** Fichas que Compras ya tiene (espacio `cmp:`): archivo → productos (por su fila) donde está. */
async function fichasYaEnCompras(negocioId: number): Promise<Map<string, Set<string>>> {
  const [rows] = await pool.query(
    `SELECT o.fila_id, r.documento_url FROM auditor_respaldo r JOIN auditor_opcion o ON o.id = r.opcion_id
      WHERE r.negocio_id = ? AND r.tipo = 'ficha_tecnica' AND r.vigente = 1 AND o.estado <> 'descartada' AND o.fila_id LIKE 'cmp:%'`, [negocioId]) as any;
  const m = new Map<string, Set<string>>();
  for (const r of rows as any[]) { const u = String(r.documento_url); (m.get(u) || m.set(u, new Set()).get(u)!).add(String(r.fila_id).replace(/^cmp:/, '')); }
  return m;
}

function itemsDeOpcion(o: OpcionDTO, yaCot: (url: string) => boolean, yaFicha: (url: string) => boolean): ItemDelAuditor[] {
  const base = {
    opcionId: o.id, proveedor: o.proveedorRazonSocial, proveedorRut: o.proveedorRut, marca: o.marca, modelo: o.modelo,
    estadoOpcion: o.estado, estadoTexto: etiquetaEstado(o.estado), elegida: esElegida(o.estado),
  };
  const out: ItemDelAuditor[] = [];
  const res = o.tecnico.resultado?.resumen ?? null;
  const sostiene = respaldoQueSostiene(o.respaldos);
  if (sostiene && sostiene.tipo !== 'link_web' && sostiene.documentoUrl) {
    const precioNeto = o.verificacion?.costoNetoUnitario ?? null;
    out.push({
      ...base, clave: `c:${sostiene.id}`, tipo: 'cotizacion', respaldoId: sostiene.id, nombre: sostiene.documentoNombre || 'cotización', url: sostiene.documentoUrl,
      subidoPor: sostiene.cargadoPorNombre, subidoAt: sostiene.cargadoAt || null, precioNeto,
      ivaDeclarado: o.producto ? o.producto.iva !== 'no_declarado' : null, cumple: null, noCumple: 0, sinVeredicto: 0,
      yaEnCompras: yaCot(sostiene.documentoUrl), tambienEn: [], motivoNoUsable: motivoCotizacionNoUsable({ respaldo: sostiene, precioNeto }),
    });
  }
  for (const f of fichasUsables(o.respaldos)) {
    out.push({
      ...base, clave: `f:${f.id}`, tipo: 'ficha', respaldoId: f.id, nombre: f.documentoNombre || 'ficha técnica', url: f.documentoUrl!,
      subidoPor: f.cargadoPorNombre, subidoAt: f.cargadoAt || null, precioNeto: null, ivaDeclarado: null,
      cumple: textoCumple(res), noCumple: res?.noCumple ?? 0, sinVeredicto: res?.sinVeredicto ?? 0,
      yaEnCompras: yaFicha(f.documentoUrl!), tambienEn: [], motivoNoUsable: null,
    });
  }
  return out;
}

/** Arma lo que Compras muestra de lo que el Auditor ya revisó. Solo lectura. */
export async function panelDelAuditor(negocioId: number, licitacionCodigo: string): Promise<PanelDelAuditor> {
  const [panel, estado, productos, cotizaciones, fichasCmp, compraAprobada] = await Promise.all([
    armarPanelAuditorCompartido(negocioId, licitacionCodigo), cargarEstadoCosteo(negocioId), listarProductosCompra(negocioId),
    listarCotizaciones(negocioId), fichasYaEnCompras(negocioId), compraAprobadaDe(negocioId),
  ]);
  const lineas = lineasAuditables(estado);
  const vigentes = productos.filter(p => !['RENUNCIADO', 'NO_ADJUDICADA'].includes(p.subestado));
  const salida: ProductoDelAuditor[] = []; const sinProducto: PanelDelAuditor['sinProducto'] = [];
  let porUsar = 0;
  for (const ld of panel.lineas) {
    if (ld.noOfertada) continue;
    const prod = vigentes.find(p => lineaDeProducto(p, lineas)?.id === ld.filaId) ?? null;
    const opciones = ld.opciones.filter(o => o.estado !== 'descartada');
    const items = opciones.flatMap(o => itemsDeOpcion(
      o,
      url => !!prod && cotizaciones.some(c => c.archivoUrl === url && c.items.some(i => i.productoId === prod.id)),
      url => !!fichasCmp.get(url)?.has(ld.filaId),
    )).sort((a, b) => Number(b.elegida) - Number(a.elegida) || (a.tipo === b.tipo ? 0 : a.tipo === 'cotizacion' ? -1 : 1));
    // Un mismo documento con varias opciones (variantes) del MISMO producto: en Compras una cotización guarda un solo precio por producto,
    // así que se ofrece la elegida (o la primera) y las otras quedan explicadas.
    const vistos = new Set<string>();
    for (const it of items) if (it.tipo === 'cotizacion' && !it.motivoNoUsable) {
      const k = it.url;
      if (vistos.has(k)) it.motivoNoUsable = 'Este mismo documento ya tiene otra opción para este producto; usa la elegida.';
      else vistos.add(k);
    }
    if (items.length === 0) continue;
    if (!prod) { sinProducto.push({ filaId: ld.filaId, item: ld.item, descripcion: corto(ld.detalle), items }); continue; }
    porUsar += items.filter(i => !i.yaEnCompras && !i.motivoNoUsable).length;
    salida.push({ productoId: prod.id, filaId: ld.filaId, item: ld.item, descripcion: corto(prod.descripcion), cantidad: prod.cantidad, costeadoNeto: ld.costeadoNeto, items });
  }
  const destinos = vigentes.map(p => ({ productoId: p.id, descripcion: corto(p.descripcion), cantidad: p.cantidad, admiteFicha: !p.esServicio }));
  // Una ficha que ya está en Compras en otro producto (no en el que el Auditor tenía): se avisa dónde, para no ofrecerla como si faltara.
  const nombreDeFila = new Map(vigentes.map(p => [filaDeProducto(p, lineas), corto(p.descripcion)] as const));
  for (const g of [...salida, ...sinProducto]) for (const it of g.items) if (it.tipo === 'ficha') {
    const propia = 'productoId' in g ? g.filaId : null;
    it.tambienEn = [...(fichasCmp.get(it.url) ?? [])].filter(fl => fl !== propia).map(fl => nombreDeFila.get(fl)).filter((x): x is string => !!x);
  }
  return { productos: salida, sinProducto, destinos, compraAprobada, porUsar, sinCosteo: lineas.length === 0 };
}

export class ConfirmarCompraAprobada extends Error {
  constructor() { super('La compra de este negocio ya está aprobada. Una cotización nueva puede cambiar lo que se aprobó: confírmalo para seguir.'); this.name = 'ConfirmarCompraAprobada'; }
}

async function buscarItem(negocioId: number, licitacionCodigo: string, clave: string): Promise<{ item: ItemDelAuditor; prod: ProductoDelAuditor | null; panel: PanelDelAuditor }> {
  const panel = await panelDelAuditor(negocioId, licitacionCodigo);
  for (const prod of panel.productos) {
    const item = prod.items.find(i => i.clave === clave);
    if (item) return { item, prod, panel };
  }
  for (const g of panel.sinProducto) {
    const item = g.items.find(i => i.clave === clave);
    if (item) return { item, prod: null, panel };
  }
  throw new Error('Ese documento ya no está en el Auditor (se quitó o cambió). Actualiza la pestaña.');
}

/** Pasa una cotización del Auditor a las cotizaciones de Compras, para ese producto. */
export async function usarCotizacionDelAuditor(p: { negocioId: number; licitacionCodigo: string; clave: string; actor: Actor; confirmarCompraAprobada?: boolean;
  /** Producto de Compras al que va (por defecto el que corresponde a la línea del Auditor). Obligatorio si la línea no tiene producto en Compras. */
  productoId?: number | null }): Promise<{ cotizacionId: number; creada: boolean; yaEstaba?: boolean }> {
  const { negocioId, actor } = p;
  const { item, prod, panel } = await buscarItem(negocioId, p.licitacionCodigo, p.clave);
  if (item.tipo !== 'cotizacion') throw new Error('Eso no es una cotización.');
  if (item.motivoNoUsable) throw new Error(item.motivoNoUsable);
  const destinoId = p.productoId ?? prod?.productoId ?? null;
  if (destinoId == null) throw new Error('Elige a qué producto de Compras va esta cotización.');
  if (!panel.destinos.some(d => d.productoId === destinoId)) throw new Error('Ese producto no está disponible en Compras (renunciado o no adjudicado).');
  if ((await listarCotizaciones(negocioId)).some(c => c.archivoUrl === item.url && c.items.some(i => i.productoId === destinoId))) return { cotizacionId: 0, creada: false, yaEstaba: true };
  if (panel.compraAprobada && !p.confirmarCompraAprobada) throw new ConfirmarCompraAprobada();
  const precio = Math.round(item.precioNeto as number);
  const nota = `Traída del Auditor (${item.estadoTexto.toLowerCase()}): precio neto verificado por el equipo.`;

  // El mismo archivo ya está en Compras (cotización de varios productos): solo se le suma este producto.
  const existentes = await listarCotizaciones(negocioId);
  const misma = existentes.find(c => c.archivoUrl === item.url);
  if (misma) {
    const items: AsignacionItemManual[] = misma.items.map(i => ({
      productoId: i.productoId, precioUnitario: i.precioBase, cumple: i.cumple, detalleDesviacion: i.detalleDesviacion,
      incluido: i.precioBase === 0 && /^Va incluido/i.test(i.detalleDesviacion || ''),
    }));
    items.push({ productoId: destinoId, precioUnitario: precio, cumple: 'CUMPLE' });
    await asignarItemsCotizacion(negocioId, misma.id, items, actor.id, actor.nombre);
    return { cotizacionId: misma.id, creada: false };
  }
  const cotizacionId = await registrarCotizacion(negocioId, {
    proveedorNombre: item.proveedor || '(por completar) proveedor del Auditor', proveedorRut: item.proveedorRut,
    origen: origenDeArchivo(item.nombre, item.url), precioUnitario: precio, ivaIncluido: false,
    archivoUrl: item.url, archivoNombre: item.nombre, notas: nota,
    itemsManual: [{ productoId: destinoId, precioUnitario: precio, cumple: 'CUMPLE' }],
  }, actor.id, actor.nombre);
  return { cotizacionId, creada: true };
}

/** Pasa una ficha técnica del Auditor al panel de fichas de Compras, en su producto y proveedor. */
export async function usarFichaDelAuditor(p: { negocioId: number; licitacionCodigo: string; clave: string; actor: Actor; productoId?: number | null }): Promise<{ opcionId: number | null; proveedor: string | null; yaEstaba?: boolean }> {
  const { negocioId, actor } = p;
  const { item, prod, panel } = await buscarItem(negocioId, p.licitacionCodigo, p.clave);
  if (item.tipo !== 'ficha') throw new Error('Eso no es una ficha técnica.');
  const otroProducto = p.productoId != null && p.productoId !== prod?.productoId;
  if (!otroProducto && item.yaEnCompras) return { opcionId: null, proveedor: item.proveedor, yaEstaba: true };
  const destinoId = p.productoId ?? prod?.productoId ?? null;
  if (destinoId == null) throw new Error('Elige a qué producto de Compras va esta ficha.');
  if (!panel.destinos.some(d => d.productoId === destinoId)) throw new Error('Ese producto no está disponible en Compras (renunciado o no adjudicado).');
  // Un producto sin línea del costeo (el biombo, una parte aparte…) guarda su ficha con un id propio; solo los servicios no llevan ficha.
  const filaId = otroProducto || !prod ? await filaDeProductoCompra(negocioId, destinoId) : prod.filaId;
  if (!filaId) throw new Error('Un servicio (flete, armado…) no lleva ficha técnica.');
  const [rows] = await pool.query(`SELECT extraccion_id, producto_idx FROM auditor_respaldo WHERE id = ? AND negocio_id = ? AND tipo = 'ficha_tecnica' AND vigente = 1`, [item.respaldoId, negocioId]) as any;
  const resp = (rows as any[])[0];
  if (!resp || resp.extraccion_id == null || resp.producto_idx == null) throw new Error('No se encontró la lectura de esa ficha en el Auditor.');
  // La persona ya la aceptó en el Auditor: aunque no traiga marca ni modelo, el nombre hace de identidad (sinMarca).
  const r = await asignarProductoDeFicha({ negocioId, extraccionId: Number(resp.extraccion_id), productoIdx: Number(resp.producto_idx), filaId, proveedor: item.proveedor, actor, sinMarca: true });
  if (!r.ok) throw new Error(r.error || 'No se pudo pasar la ficha.');
  return { opcionId: r.opcionId ?? null, proveedor: r.proveedor };
}
