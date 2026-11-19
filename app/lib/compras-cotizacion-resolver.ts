// app/lib/compras-cotizacion-resolver.ts
// NÚCLEO PURO de «a qué producto va cada línea de una cotización»: arma lo que se le pregunta a la IA, parte las cotizaciones largas en tandas,
// y aplica los frenos deterministas (precio inventado o cruzado, otra medida o modelo, conversión rollo/caja, kits, adicionales).
//
// No toca la base de datos ni llama a la IA por su cuenta: la IA entra por `llamarIA` (producción: crearChatIA con cupo; banco de pruebas: una
// copia en disco). Así `homologarCotizacionIA` (compras-auditor.ts) y el banco de cotizaciones reales (scripts/banco-cotizaciones) corren EXACTAMENTE
// el mismo código: lo que mide el banco es lo que pasa en producción.
import { precioClpDeItemIA } from '@/app/lib/compras-precio-homologacion';
import {
  precioPorUnidadDeProducto, conversionDesdeTexto, numeroApareceEnTexto, lineasDesdeTabla, corregirAdicionalesConLineas, lineaDelProducto,
  desajustesProductoLinea, sinComponentesDeLaLineaPropia, conversionCoherenteConLinea, productoQueCubreLaLinea, lineasSinAsignar, factoresPrecioDeCotizacion, lineasAlternativas, type LineaCotizacion,
} from '@/app/lib/compras-cotizacion-lineas';
import { productosCandidatos, tandasDeLineas, lineaDeLaAsignacion, conflictosMedibles, respaldoDelPrecio, lineaConElMismoModelo, puntajeLineaProducto } from '@/app/lib/compras-cotizacion-emparejar';
import { netoDesdeBruto, conDescuento } from '@/app/lib/compras-cotizacion-lectura';
import { adicionalesDesdeIA, cotizacionEsPorUnidad, baseDeCotizacionPorUnidad, incluidosDesdeIA, citaVerificada } from '@/app/lib/compras-adicionales-ia';
import { parseJsonIA } from '@/app/lib/json-ia';

export interface ProductoResolver { id: number; descripcion: string; cantidad: number | string | null; unidad?: string | null; productoPadreId?: number | null; /** precio de VENTA adjudicado por unidad (neto): sirve de cordura para el costo */ montoUnitario?: number | string | null }
export interface CotizResolver {
  proveedor_nombre: string | null; precio_unitario: number | string | null; precio_total: number | string | null; moneda: string | null;
  descripcion_libre: string | null; tipo_cambio_usado: number | string | null; notas: string | null; descuento_pct: number | string | null;
  precio_unitario_clp: number | string | null; precio_unitario_bruto: number | string | null; flete_monto: number | string | null;
}
export interface RespuestaIA { content: string; finishReason: string | null }
export type LlamarIA = (system: string, user: string) => Promise<RespuestaIA>;

/** Con más productos que esto, a la IA solo se le ofrecen los candidatos de cada línea. */
export const MUCHOS_PRODUCTOS = 30;
const CUMPLES = ['CUMPLE', 'MEJORA', 'INFERIOR_NEGOCIABLE', 'INFERIOR_INSALVABLE', 'NO_ES_EL_PRODUCTO'];
const codigo = (v: unknown) => Number(String(v ?? '').replace(/\D/g, ''));   // "P2" → 2

/** El precio que la IA lee de una línea tiene que EXISTIR en el documento (como está, con IVA o sin IVA). */
export function precioEnDocumento(v: unknown, texto: string): boolean {
  if (v == null || v === '' || typeof v === 'boolean') return true;       // sin precio propio: no hay nada que validar
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return true;
  if (!texto.trim()) return true;                                          // sin texto no hay con qué comparar
  return numeroApareceEnTexto(n, texto) || numeroApareceEnTexto(n * 1.19, texto) || numeroApareceEnTexto(n / 1.19, texto);
}

export interface FinalAsignado { it: any; producto: ProductoResolver; esIncluido: boolean; precioClp: number | null; adic: Array<{ concepto: string; cantidad: number; precioUnitario: number }>; conv: ReturnType<typeof precioPorUnidadDeProducto> }
export interface ResultadoResolver {
  lineasDelDoc: LineaCotizacion[];
  items: any[]; faltantes: any[]; puntosCriticos: string | null;
  /** Después de todos los frenos, con el precio ya en CLP neto y los adicionales listos para guardar. */
  finales: FinalAsignado[];
  resueltos: Array<{ it: any; producto: ProductoResolver; precioClp: number | null; conv: ReturnType<typeof precioPorUnidadDeProducto> }>;
  cruzados: string[]; porMedida: string[]; desajustes: string[];
  incluidos: Set<number>; hayConPrecio: boolean;
  /** Para medir: cuántas tandas y cuántos productos vio la IA en cada una. */
  tandas: number; productosPorTanda: number[];
}

export async function resolverCotizacion(e: { productos: ProductoResolver[]; cotiz: CotizResolver; sobreTotal: boolean; systemPrompt: string; llamarIA: LlamarIA; /** precio base que ya tenía cada producto en ESTA cotización (producto → CLP) */ preciosPrevios?: Record<number, number | null> }): Promise<ResultadoResolver> {
  const { productos, cotiz, systemPrompt, llamarIA } = e;
  const textoDocumento = String(cotiz.descripcion_libre || '');
  const sufijoMoneda = cotiz.moneda && cotiz.moneda !== 'CLP' ? ` ${cotiz.moneda}` : '';
  const lineasDelDoc = lineasDesdeTabla(textoDocumento);
  const conPrecio = lineasDelDoc.filter(l => (l.total ?? l.precioUnitario ?? 0) !== 0);
  // EMPAREJAR A ESCALA (18-nov-2026, 727202-72-LP26: 141 productos). Antes se mandaban TODOS los productos y toda la cotización en una sola
  // llamada con tope de 3.000 tokens: no cabía una cotización larga y la IA confundía tamaños parecidos. Ahora, con muchos productos, a la IA
  // solo se le ofrecen los candidatos de cada línea (palabras, medidas y modelos), y una cotización larga se parte en tandas de pocas líneas.
  // Con pocos productos y pocas líneas todo queda como antes (una llamada, lista completa).
  const paraEmparejar = productos.map(p => ({ id: p.id, descripcion: p.descripcion, cantidad: p.cantidad != null ? Number(p.cantidad) : null }));
  const tandas: LineaCotizacion[][] = conPrecio.length ? tandasDeLineas(conPrecio) : [[]];
  const productosPorTanda: number[] = [];

  const resolverTanda = async (tanda: LineaCotizacion[], profundidad: number): Promise<{ items: any[]; faltantes: any[]; puntos: string[] }> => {
    const filtrar = productos.length > MUCHOS_PRODUCTOS && tanda.length > 0;
    let visibles = new Set(productos.map(p => p.id));
    if (filtrar) {
      const cand = productosCandidatos(tanda, paraEmparejar);
      // Un producto y la parte que se compra aparte van juntos: la IA necesita ver las dos filas para no tratar la parte como faltante.
      for (const p of productos) if (cand.has(p.id) && p.productoPadreId != null) cand.add(p.productoPadreId);
      for (const p of productos) if (p.productoPadreId != null && cand.has(p.productoPadreId)) cand.add(p.id);
      visibles = cand;
    }
    const lista = productos.map((p, i) => ({ p, i })).filter(x => visibles.has(x.p.id));
    if (profundidad === 0) productosPorTanda.push(lista.length);
    const notaTanda = tandas.length > 1 || profundidad > 0
      ? `\n\nESTA LLAMADA RESUELVE SOLO ESTAS ${tanda.length} LÍNEAS del bloque «LÍNEAS DEL DOCUMENTO» (las demás las ve otra llamada: NO las uses para ningún producto ni adicional):\n${tanda.map(l => `- ${l.descripcion.slice(0, 110)} | cantidad ${l.cantidad ?? '—'} | precio unitario ${l.precioUnitario ?? '—'}`).join('\n')}`
      : '';
    const user = `PRODUCTOS GANADOS (código: descripción, cantidad, unidad)${filtrar ? ' — selección de los productos candidatos a estas líneas: lo que no está en la lista no se puede asignar' : ''}:
${lista.map(({ p, i }) => {
      // Partes que se compran aparte (pernos de una butaca «que incluye pernos»): son un producto de la lista, y su ausencia en la
      // cotización del producto NO es un faltante (van a otro proveedor).
      const padre = p.productoPadreId != null ? productos.findIndex(x => x.id === p.productoPadreId) : -1;
      const partes = productos.filter(x => x.productoPadreId === p.id).map(x => `P${productos.indexOf(x) + 1}`);
      const nota = padre >= 0 ? ` (parte de P${padre + 1} que se compra APARTE: si el documento la cotiza, va aquí y no como adicional de P${padre + 1})`
        : partes.length ? ` (${partes.join(', ')} se compra${partes.length > 1 ? 'n' : ''} aparte: si el documento no lo${partes.length > 1 ? 's' : ''} trae, NO es un faltante de este producto)` : '';
      return `P${i + 1}. ${p.descripcion}${p.cantidad ? `, cantidad ${p.cantidad}` : ''}${p.unidad ? ` ${p.unidad}` : ''}${nota}`;
    }).join('\n')}

COTIZACIÓN de "${cotiz.proveedor_nombre}"${cotiz.precio_unitario ? ` — precio unitario informado: ${Number(cotiz.precio_unitario).toLocaleString('es-CL')}${sufijoMoneda}` : ''}${cotiz.precio_total ? ` — total: ${Number(cotiz.precio_total).toLocaleString('es-CL')}${sufijoMoneda}` : ''}${sufijoMoneda ? `\n(Todo precio que asignes por producto debe estar en la MISMA moneda del documento, ${cotiz.moneda} — no conviertas tú, la conversión a CLP la hace el sistema aparte.)` : ''}:
${cotiz.descripcion_libre || '(sin descripción libre — usar solo el precio si corresponde a un único producto)'}${notaTanda}`;

    const r = await llamarIA(systemPrompt, user);
    const cortada = r.finishReason === 'length';
    const parsedT: any = parseJsonIA(String(r.content ?? '')) || {};
    // Respuesta cortada por el tope o ilegible: se parte la tanda en dos y se reintenta, para no perder líneas en silencio.
    if ((cortada || !Array.isArray(parsedT.items)) && tanda.length > 1 && profundidad < 3) {
      const mitad = Math.ceil(tanda.length / 2);
      const [a, b] = await Promise.all([resolverTanda(tanda.slice(0, mitad), profundidad + 1), resolverTanda(tanda.slice(mitad), profundidad + 1)]);
      return { items: [...a.items, ...b.items], faltantes: [...a.faltantes, ...b.faltantes], puntos: [...a.puntos, ...b.puntos] };
    }
    return { items: Array.isArray(parsedT.items) ? parsedT.items : [], faltantes: Array.isArray(parsedT.faltantes) ? parsedT.faltantes : [], puntos: parsedT.puntosCriticos ? [String(parsedT.puntosCriticos)] : [] };
  };

  const resultados = await Promise.all(tandas.map(t => resolverTanda(t, 0)));
  // Un mismo producto puede salir en dos tandas (una línea de cada una): se queda la que trae precio propio.
  const porProducto = new Map<number, any>(), sinCodigo: any[] = [];
  for (const it of resultados.flatMap(r => r.items)) {
    const c = codigo(it?.producto);
    if (!c) { sinCodigo.push(it); continue; }
    const previo = porProducto.get(c);
    if (!previo || (previo.precioUnitarioAsignado == null && it?.precioUnitarioAsignado != null)) porProducto.set(c, it);
  }
  const items: any[] = [...porProducto.values(), ...sinCodigo];
  const faltantes = resultados.flatMap(r => r.faltantes);
  const puntosCriticos = [...new Set(resultados.flatMap(r => r.puntos))].join(' ').slice(0, 1200) || null;

  const tipoCambio = cotiz.tipo_cambio_usado != null ? Number(cotiz.tipo_cambio_usado) : null;
  const itemsValidos = items.filter((x: any) => productos[codigo(x?.producto) - 1] && CUMPLES.includes(x?.cumple) && x.cumple !== 'NO_ES_EL_PRODUCTO').length;
  // Auditoría 07-oct-2026: la IA a veces "cubre" productos que el documento ni menciona (una cotización solo del horno quedó
  // asignada también a sobadora y carro, "sin precio") y marca como asignable lo que es OTRO producto. Eso es ruido que
  // ensucia la matriz: se descartan los NO_ES_EL_PRODUCTO y, si la cotización tiene precio para algún producto, los que quedan sin precio.
  // El precio propio que la IA lee de una línea viene tal como el documento lo muestra: antes de descuento y, si el
  // documento dice "IVA incluido", con IVA. Se lleva a NETO igual que el precio de cabecera (registrarCotizacion).
  const ivaIncluido = /se guardaron en neto \(÷ 1,19\)/.test(String(cotiz.notas || '')) && (cotiz.moneda || 'CLP') === 'CLP';
  const dscto = cotiz.descuento_pct != null ? Number(cotiz.descuento_pct) : null;
  const sobreTotal = e.sobreTotal;
  const aNeto = (v: unknown): unknown => {
    const n = v == null || v === '' || typeof v === 'boolean' ? NaN : Number(v);
    if (!Number.isFinite(n) || n <= 0) return v;
    let x = ivaIncluido ? netoDesdeBruto(n) : n;
    if (!sobreTotal && dscto != null && dscto > 0 && dscto < 100) x = conDescuento(x, dscto, 'unitario');
    return x;
  };
  // Precio de cabecera en el mismo modo: a precio de lista si el descuento va sobre el total.
  const cabeceraClp = sobreTotal && cotiz.precio_unitario_bruto != null
    ? Number(cotiz.precio_unitario_bruto) * (cotiz.moneda && cotiz.moneda !== 'CLP' && cotiz.tipo_cambio_usado ? Number(cotiz.tipo_cambio_usado) : 1)
    : (cotiz.precio_unitario_clp != null ? Number(cotiz.precio_unitario_clp) : null);

  // Código de modelo exacto manda: si el producto trae un modelo y una sola línea del documento lo trae, el precio es el de esa línea.
  for (const it of items) {
    const prod = productos[codigo(it?.producto) - 1];
    if (!prod || it.incluidoEn != null || it.conversionUnidad) continue;
    const lm = lineaConElMismoModelo(prod.descripcion, lineasDelDoc);
    const pa = Number(it.precioUnitarioAsignado);
    if (lm && lm.precioUnitario != null && !(Number.isFinite(pa) && Math.abs(pa - lm.precioUnitario) <= 1.5)) {
      it.precioUnitarioAsignado = lm.precioUnitario;
      it.detalle = [it.detalle, `el precio es el de la línea «${lm.descripcion.slice(0, 60)}», que trae el mismo modelo que el producto`].filter(Boolean).join(' · ');
    }
  }
  let resueltos = items.map((it: any) => {
    const producto = productos[codigo(it?.producto) - 1];
    if (!producto || !CUMPLES.includes(it.cumple) || it.cumple === 'NO_ES_EL_PRODUCTO') return null;
    // "Va incluido en otro producto" sin cita literal verificada = invento: ese producto no se asigna a esta cotización.
    if (it.incluidoEn != null && !citaVerificada(it.citaIncluido, textoDocumento)) return null;
    // Línea por METRO/KILO y producto por ROLLO/CAJA (2736-44, MCT 621206): el código multiplica, con el factor sacado de la descripción del producto.
    let conv = precioPorUnidadDeProducto(it.conversionUnidad, producto.descripcion, textoDocumento)
      ?? precioPorUnidadDeProducto(conversionDesdeTexto(Number(it.precioUnitarioAsignado), producto.descripcion, textoDocumento), producto.descripcion, textoDocumento);
    // La medida del producto puede ser un ATRIBUTO (basurero de 1.100 litros) y no un envase: solo se multiplica si la línea del precio se cobra por esa medida.
    if (conv) {
      const c = conv;
      const venta = Number(producto.montoUnitario);
      if (Number.isFinite(venta) && venta > 0) {
        // Con precio de VENTA adjudicado: entre multiplicar o no, gana el costo más parecido a la venta (un saco de carbón que se vende a $6.978 no
        // cuesta $46.218; un rollo de nylon que se vende a $215.701 no cuesta $2.000). Banco de cotizaciones reales: termo × 20, carbón × 10, basurero × 1.100.
        const k = tipoCambio || 1;
        const crudo = Number(aNeto(c.precioLinea)) * k, convertido = Number(aNeto(c.precio)) * k;
        if (crudo > 0 && convertido > 0 && Math.abs(Math.log(crudo / venta)) < Math.abs(Math.log(convertido / venta))) conv = null;
      } else {
        // Sin precio de venta: solo si la línea se cobra por la medida (su unidad, o una cantidad múltiplo exacto de N).
        const lineasDelPrecio = lineasDelDoc.filter(l => l.precioUnitario != null && Math.abs(l.precioUnitario - c.precioLinea) <= 1.5);
        if (lineasDelPrecio.length && !lineasDelPrecio.some(l => conversionCoherenteConLinea(l, c.factor))) conv = null;
      }
      // Conversión rechazada: el precio es el de la línea tal cual. La IA deja «precioUnitarioAsignado» vacío cuando informa una conversión
      // (así se lo pide el prompt), y sin esto el producto se quedaba sin precio y desaparecía.
      if (!conv && (it.precioUnitarioAsignado == null || it.precioUnitarioAsignado === '')) it.precioUnitarioAsignado = c.precioLinea;
    }
    if (conv) it.detalle = [it.detalle, `Precio por ${conv.unidadLinea} $${Math.round(conv.precioLinea).toLocaleString('es-CL')} × ${conv.factor} por unidad del producto = $${Math.round(conv.precio).toLocaleString('es-CL')} (la cotización cobra por ${conv.unidadLinea}, el producto se compra por rollo/caja).`].filter(Boolean).join(' · ');
    const precioClp = precioClpDeItemIA({
      // El precio que la IA lee de una línea tiene que EXISTIR en el documento: "121.000,85" se leyó como 121,00085 y quedó en $109.
      // Si no aparece (ni como número), se ignora y se usa el precio de la cotización en vez de guardar un valor inventado.
      precioUnitarioAsignado: aNeto(conv ? conv.precio : precioEnDocumento(it.precioUnitarioAsignado, textoDocumento) ? it.precioUnitarioAsignado : null), tipoCambio,
      precioClpCotizacion: cabeceraClp,
      totalItemsAsignados: itemsValidos,
    });
    return { it, producto, precioClp, conv };
  }).filter(Boolean) as ResultadoResolver['resueltos'];

  // Precio cruzado: el precio que la IA asignó EXISTE en el documento pero es de otra línea que no se parece nada al producto (la IA de respaldo
  // le dio a una bomba el precio de una tubería). No se asigna: la línea queda a la vista en «Revisa la asignación».
  const cruzados: string[] = [];
  // Solo se descarta si OTRO producto con ese mismo precio sí tiene que ver con la línea (el dueño real del precio): sin eso no se sabe quién
  // se equivocó (una brida contra «Flange Respaldo» es un sinónimo legítimo, no un cruce).
  const precioDocDe = (r: { it: any; conv: ReturnType<typeof precioPorUnidadDeProducto> }) => r.conv ? r.conv.precioLinea : (Number.isFinite(Number(r.it.precioUnitarioAsignado)) && Number(r.it.precioUnitarioAsignado) > 0 ? Number(r.it.precioUnitarioAsignado) : null);
  const respaldos = resueltos.map(r => ({ r, precioDoc: precioDocDe(r), resp: r.it.incluidoEn != null ? null : respaldoDelPrecio(r.producto.descripcion, lineasDelDoc, precioDocDe(r)) }));
  resueltos = respaldos.filter(x => {
    if (!x.resp || x.resp.plausible) return true;
    const hayDueno = respaldos.some(o => o !== x && o.resp?.plausible && o.precioDoc != null && x.precioDoc != null && Math.abs(o.precioDoc - x.precioDoc) <= 1.5);
    if (!hayDueno) return true;
    cruzados.push(`«${x.r.producto.descripcion.slice(0, 40)}» ← «${x.resp.linea.descripcion.slice(0, 40)}»`);
    return false;
  }).map(x => x.r);

  // OTRA MEDIDA FÍSICA (63 mm ≠ 75 mm, 30 HP ≠ 15 HP, 220 V ≠ 380 V): la línea que respalda el precio es de un producto distinto al pedido.
  // Asignarle ese precio ensucia la comparación («la más barata» sería otra cosa), y marcarlo «inferior» no alcanza: el auditor de fondo reescribe
  // el veredicto. No se asigna; el motivo queda en las notas de la cotización y se puede asignar a mano.
  const porMedida: string[] = [];
  resueltos = resueltos.filter(r => {
    if (r.it.incluidoEn != null) return true;
    const precioDoc = precioDocDe(r);
    const linea = lineaDeLaAsignacion(r.producto.descripcion, lineasDelDoc, precioDoc);
    const graves = linea ? conflictosMedibles(r.producto.descripcion, linea.descripcion).filter(m => m.grave) : [];
    if (!linea || !graves.length) return true;
    // Mismo código de modelo en la línea y en el producto (SS642/14 ↔ SS642-14): es ese producto aunque la medida difiera (la licitación pedía 30 HP y
    // el proveedor cotiza 15 HP). Se asigna y el freno de abajo lo deja en «inferior» con el aviso, para que una persona lo resuelva.
    if (lineaConElMismoModelo(r.producto.descripcion, lineasDelDoc) === linea) return true;
    porMedida.push(`«${r.producto.descripcion.slice(0, 45)}» no se asignó a «${linea.descripcion.slice(0, 45)}»: ${graves.map(g => g.texto).join('; ')}`);
    return false;
  });

  // Un producto que va incluido en el precio de otro queda con base $0 (explícito): su costo está en el otro producto.
  const incluidos = new Set(incluidosDesdeIA(items, textoDocumento).map(x => x.producto));
  const hayConPrecio = resueltos.some(r => r.precioClp != null);
  // ¿Es el MISMO producto? Freno determinista sobre lo medible (talla, chasis): la IA decide por significado y dejó pasar
  // una silla talla 43 chasis rígido como si fuera la talla 42 chasis plegable (1110). No se excluye (§8.8.1): se rebaja y se avisa.
  const desajustes: string[] = [];
  for (const r of resueltos) {
    // La línea que respalda el precio: la que trae el MISMO precio que la IA leyó (así «75 mm» no se compara con la de 63 mm que se le parece),
    // y si no, la de nombre más parecido. Talla/chasis (1110) y ahora también MEDIDAS y MODELOS (63 mm ≠ 75 mm, 220 V ≠ 380 V, HST 300 ≠ PL160).
    const precioDoc = r.conv ? r.conv.precioLinea : (Number.isFinite(Number(r.it.precioUnitarioAsignado)) ? Number(r.it.precioUnitarioAsignado) : null);
    const linea = lineaDeLaAsignacion(r.producto.descripcion, lineasDelDoc, precioDoc) ?? lineaDelProducto(r.producto.descripcion, lineasDelDoc);
    const dif = linea ? desajustesProductoLinea(r.producto.descripcion, linea.descripcion) : [];
    const medibles = linea ? conflictosMedibles(r.producto.descripcion, linea.descripcion) : [];
    if (!dif.length && !medibles.length) continue;
    const txt = `no es exactamente lo pedido: ${[...dif, ...medibles.map(m => m.texto)].join('; ')}`;
    // Una medida física distinta (tamaño, potencia, tensión) no se arregla negociando: es otro producto. Presión (PN) y modelo se avisan, son negociables.
    if (medibles.some(m => m.grave)) { if (r.it.cumple !== 'INFERIOR_INSALVABLE') r.it.cumple = 'INFERIOR_INSALVABLE'; }
    else if (r.it.cumple === 'CUMPLE' || r.it.cumple === 'MEJORA') r.it.cumple = 'INFERIOR_NEGOCIABLE';
    r.it.detalle = [r.it.detalle, txt].filter(Boolean).join(' · ');
    desajustes.push(`«${r.producto.descripcion.slice(0, 50)}» ${txt}`);
  }

  // Precio final y adicionales de cada producto asignado.
  const finales: FinalAsignado[] = [];
  for (const { it, producto, precioClp: precioIA, conv } of resueltos) {
    const esIncluido = incluidos.has(codigo(it.producto));
    let precioClp = esIncluido ? 0 : precioIA;
    if (hayConPrecio && precioClp == null) continue;
    // Componentes con precio propio que el documento cotiza aparte (quemador, bandejas…): se unen al producto como adicionales.
    // La cantidad y el precio de cada adicional salen de la línea verificada del documento (no de lo que la IA recuerde de ella).
    // Si la cotización ya trae su flete aparte (flete_monto), el motor de escenarios lo muestra y lo suma como "Flete / logística":
    // dejarlo también como adicional del producto lo contaba dos veces y mezclaba equipo + transporte en un solo precio
    // (1120: equipo €15.960 + transporte €710 = €16.670, se ven por separado y se suman).
    const adicCorregidos = (() => {
      const propios = sinComponentesDeLaLineaPropia(it.adicionales, lineaDelProducto(producto.descripcion, lineasDelDoc));
      let corr = corregirAdicionalesConLineas(propios, lineasDelDoc).adicionales;
      // La línea por metro/kilo que YA dio el precio del producto no es además un adicional (2736-44: el folio salió como rollo $136.000 + adicional 70 × $2.000 = $276.000).
      if (conv && Array.isArray(corr)) corr = corr.filter((a: any) => !(Math.abs(Number(a?.precioUnitario) - conv.precioLinea) <= 1));
      if (cotiz.flete_monto == null || !Array.isArray(corr)) return corr;
      return corr.filter((a: any) => !/flete|transport|despacho|env[ií]o|spedizione|shipping|freight|\bCIF\b/i.test(String(a?.concepto ?? '')));
    })();
    // Cotización en moneda extranjera (1120, €710 de transporte quedó como $710): el adicional viene en la moneda del documento
    // y se guarda en CLP, igual que el precio del producto (precioClpDeItemIA ya multiplica por el tipo de cambio).
    const aNetoClp = (n: number) => (tipoCambio ? Number(aNeto(n)) * tipoCambio : Number(aNeto(n)));
    const cantProducto = producto.cantidad != null ? Number(producto.cantidad) : null;
    let adic = adicionalesDesdeIA(adicCorregidos, cantProducto, aNetoClp);
    // TIPO «cotización de UNA unidad» (set/kit: 14 instrumentos para 1 set, el producto pide 30): cada línea ya es por unidad y la línea del
    // precio de cabecera no cuenta dos veces. Generalizado a partir de 3789-30-LE26 (#278: $15.623 en vez de $171.671).
    // Lo mismo con un KIT cotizado para el lote completo (Sinergia #319: 150 alicates, 90 pinzas… para 30 sets): el producto no tiene línea
    // propia en el documento, el precio de cabecera es el de la primera pieza y esa pieza además venía como adicional (salía $113.765 = $5.181
    // de «producto solo» + los 15 componentes). Esa pieza pasa a ser la base con su cantidad por set; si ninguna coincide, no cambia nada.
    if (!esIncluido && (cotizacionEsPorUnidad(adicCorregidos, cantProducto) || (adic.length > 0 && !lineaDelProducto(producto.descripcion, lineasDelDoc)))) {
      const k = baseDeCotizacionPorUnidad(adic, precioClp);
      adic = k.adicionales; precioClp = k.base;
    }
    // El equipo ya pasó esta cotización a NETO (botón «con IVA») aunque las notas no lo digan: si el precio que tenía es justo el nuevo ÷ 1,19, se respeta.
    // Si no, volver a leerla devolvía los precios con IVA (2736-44, colchones $40.000 en vez de $33.613 aprobados).
    const previo = e.preciosPrevios?.[producto.id];
    if (previo != null && previo > 0 && precioClp != null && precioClp > 0 && Math.abs(previo - precioClp / 1.19) <= Math.max(1, previo * 0.001)) {
      precioClp = previo;
      it.detalle = [it.detalle, 'precio en neto (sin IVA), como ya lo había dejado el equipo'].filter(Boolean).join(' · ');
    }
    finales.push({ it, producto, esIncluido, precioClp, adic: adic as any, conv });
  }

  // FLETE: si la cotización ya trae su flete APARTE (flete_monto), se reparte entre los productos (regla del equipo, 12-nov-2026) y NO se asigna al
  // producto «Transporte» de la licitación; si no lo trae aparte, la línea de flete sí es ese producto (2906-19, 1095439: así lo hizo el equipo).
  const esProductoFlete = (p: ProductoResolver) => /\b(flete|transporte|trasporte|traslado|despacho)\b/i.test(String(p.descripcion));
  if (cotiz.flete_monto != null && Number(cotiz.flete_monto) > 0) {
    for (let i = finales.length - 1; i >= 0; i--) if (esProductoFlete(finales[i].producto)) finales.splice(i, 1);
  }
  // Una línea de flete de $1 (marcador de «despacho incluido») no es el precio de ningún producto.
  for (let i = finales.length - 1; i >= 0; i--) if (esProductoFlete(finales[i].producto) && finales[i].precioClp != null && (finales[i].precioClp as number) <= 1) finales.splice(i, 1);

  // SEGUNDA PASADA SIN IA: líneas con precio que la IA dejó sin producto y productos que nadie cubrió, cuando se ELIGEN MUTUAMENTE como la mejor
  // pareja, con nombre muy parecido y sin ningún choque de medida ni de modelo («Gabinete Bajo Con Puertas» ↔ «Gabinete de dos puertas», 387-55).
  // Se asignan avisando que lo hizo el sistema, para revisarlo. Medido con el banco de cotizaciones reales antes de dejarlo.
  const asignadosPorCodigo = new Set(finales.map(f => f.producto.id));
  const fp = { factoresPrecio: factoresPrecioDeCotizacion({ moneda: cotiz.moneda, tipoCambioUsado: tipoCambio, notas: cotiz.notas }) };
  const prodsCub = finales.map(f => ({ id: f.producto.id, descripcion: f.producto.descripcion, precioBase: f.precioClp }));
  const adicConceptos = finales.flatMap(f => f.adic.map(a => String(a.concepto)));
  // Libres = no cubiertas por ningún producto, más las que solo «tapa» el nombre de un producto que ya tomó el precio de OTRA línea (fieltro 16 m vs 40 m).
  const alternativasLibres = new Set(lineasAlternativas(conPrecio, prodsCub, fp));
  const lineasLibres = conPrecio
    .filter(l => !/flete|transport|despacho|env[ií]o|shipping|freight|descuento|\biva\b|total/i.test(l.descripcion))
    .filter(l => alternativasLibres.has(l) || (!productoQueCubreLaLinea(l, prodsCub, fp) && lineasSinAsignar([l], [...prodsCub.map(x => x.descripcion), ...adicConceptos]).length > 0))
    .filter(l => lineasSinAsignar([l], adicConceptos).length > 0);
  const productosLibres = productos.filter(p => !asignadosPorCodigo.has(p.id));
  if (lineasLibres.length && productosLibres.length && hayConPrecio !== false) {
    const sinChoque = (p: ProductoResolver, l: LineaCotizacion) => conflictosMedibles(p.descripcion, l.descripcion).length === 0;
    const pt = (l: LineaCotizacion, p: ProductoResolver) => puntajeLineaProducto(l, { id: p.id, descripcion: p.descripcion, cantidad: p.cantidad != null ? Number(p.cantidad) : null }).puntaje;
    for (const l of lineasLibres) {
      if (l.precioUnitario == null || !(l.precioUnitario > 0)) continue;
      const orden = productosLibres.filter(p => !asignadosPorCodigo.has(p.id)).map(p => ({ p, s: pt(l, p) })).sort((a, b) => b.s - a.s);
      const mejor = orden[0];
      // Ganador claro: puntaje ≥ 0,5 y al menos 0,15 sobre el segundo (que no sea una fila repetida del mismo producto), sin choque de medida ni modelo.
      const segundo = orden.find(x => x !== mejor && x.p.descripcion !== mejor?.p.descripcion);
      if (!mejor || mejor.s < 0.5 || (segundo && segundo.s > mejor.s - 0.15) || !sinChoque(mejor.p, l)) continue;
      // mutuo: para ese producto, ninguna otra línea libre se le parece más
      const otra = lineasLibres.filter(x => x !== l).some(x => pt(x, mejor.p) > mejor.s + 1e-9);
      if (otra) continue;
      const precioClp = precioClpDeItemIA({ precioUnitarioAsignado: aNeto(l.precioUnitario), tipoCambio, precioClpCotizacion: null, totalItemsAsignados: 2 });
      if (precioClp == null) continue;
      const it = { producto: `P${productos.indexOf(mejor.p) + 1}`, cumple: 'INFERIOR_NEGOCIABLE', precioUnitarioAsignado: l.precioUnitario, adicionales: [],
        detalle: `Lo asignó el sistema (no la IA): el nombre coincide con la línea «${l.descripcion.slice(0, 70)}». Revisa que sea el producto.`, segundaPasada: true };
      finales.push({ it, producto: mejor.p, esIncluido: false, precioClp, adic: [], conv: null });
      asignadosPorCodigo.add(mejor.p.id);
    }
  }

  // VARIANTES SIN ESPECIFICAR: productos que solo difieren en un número (talla 43 / talla 45) y una línea asignada a uno de ellos que no dice ninguno
  // de esos números («Silla De Ruedas Eléctrica Plegable»): la misma oferta sirve para todas las variantes. Se asigna con aviso (4777-25-LE26, aprobado así).
  const sinNumeros = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\d+([.,]\d+)?/g, '#').replace(/[^a-z#]+/g, ' ').trim();
  const numerosDe = (s: string) => new Set((String(s || '').match(/\d+(?:[.,]\d+)?/g) ?? []).map(x => x.replace(',', '.')));
  for (const f of [...finales]) {
    if (f.esIncluido || f.precioClp == null) continue;
    const forma = sinNumeros(f.producto.descripcion);
    if (!forma.includes('#')) continue;
    const linea = lineaDeLaAsignacion(f.producto.descripcion, lineasDelDoc, f.conv ? f.conv.precioLinea : (Number(f.it.precioUnitarioAsignado) > 0 ? Number(f.it.precioUnitarioAsignado) : null));
    if (!linea) continue;
    const enLinea = numerosDe(linea.descripcion);
    for (const p of productos) {
      if (asignadosPorCodigo.has(p.id) || sinNumeros(p.descripcion) !== forma) continue;
      const distintos = [...numerosDe(p.descripcion)].filter(n => !numerosDe(f.producto.descripcion).has(n));
      const propios = [...numerosDe(f.producto.descripcion)].filter(n => !numerosDe(p.descripcion).has(n));
      if (!distintos.length || distintos.some(n => enLinea.has(n)) || propios.some(n => enLinea.has(n))) continue;
      const it = { producto: `P${productos.indexOf(p) + 1}`, cumple: 'INFERIOR_NEGOCIABLE', precioUnitarioAsignado: f.it.precioUnitarioAsignado, adicionales: [],
        detalle: `La línea «${linea.descripcion.slice(0, 60)}» no dice la medida/talla (${distintos.join('/')}): se usó la misma oferta que para «${f.producto.descripcion.slice(0, 40)}». Revisa.`, variante: true };
      finales.push({ it, producto: p, esIncluido: false, precioClp: f.precioClp, adic: [], conv: f.conv });
      asignadosPorCodigo.add(p.id);
    }
  }

  return { lineasDelDoc, items, faltantes, puntosCriticos, finales, resueltos, cruzados, porMedida, desajustes, incluidos, hayConPrecio, tandas: tandas.length, productosPorTanda };
}
