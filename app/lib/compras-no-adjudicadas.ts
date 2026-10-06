// app/lib/compras-no-adjudicadas.ts
// LÍNEAS OFERTADAS PERO NO GANADAS (6-oct-2026) — decisión PURA, para poder probarla sin base de datos.
//
// CASO REAL 1173418-1-LE26 (negocio 457): se ofertaron 4 líneas y el acta de MP adjudicó 3 a
// nosotros; la cuarta (mesón) se la llevó otro proveedor. Compras igual mostraba las 4 como trabajo
// por hacer: la perdida inflaba "sin cotización", impedía la cobertura total (nunca llegaba a
// ENTREGADO) y se podía cotizar/comprar algo que nadie nos va a pagar.
//
// "NO_ADJUDICADA" NO es una renuncia (§14.5): renunciar es dejar una línea GANADA y requiere
// propuesta + aprobación del jefe de ventas. Esto es un hecho del acta, no una decisión de Compras,
// así que se aplica solo y no pide aprobación. La fila no se borra: queda atenuada como referencia.
//
// SOLO LICITACIONES POR LÍNEA CON ADJUDICACIÓN PARCIAL. Una adjudicación global (sin líneas
// separadas en el acta, o con una sola) no entra por acá y no se toca.
//
// PRINCIPIO: ante la duda, NO marcar. Marcar de más esconde una línea que sí hay que comprar (plata
// perdida); marcar de menos solo deja una línea de referencia visible. Por eso cada marca exige
// evidencia positiva (el acta nombra OTRO proveedor para ese correlativo) y que la numeración del
// costeo calce con la del acta (en 1114-12-LE26 no calzaba: mismo motivo por el que el poblado no
// filtra por acta).

/** Subestados que salen del cómputo de cobertura, KPIs y listas de trabajo. */
export const SUBESTADOS_FUERA_DE_COBERTURA = ['RENUNCIADO', 'NO_ADJUDICADA'] as const;

export const esSubestadoFuera = (s: string | null | undefined): boolean =>
  (SUBESTADOS_FUERA_DE_COBERTURA as readonly string[]).includes(String(s));

export interface ProductoParaDecidir { id: number; correlativo: number | null; subestado: string }
export interface LineaActaParaDecidir {
  correlativo?: number | null;
  rutProveedor: string | null;
  proveedor: string | null;
  montoUnitario: number | null;
  esNuestra?: boolean;
}

export interface DecisionNoAdjudicadas {
  /** Productos que pasan a NO_ADJUDICADA. */
  marcar: number[];
  /** Productos NO_ADJUDICADA que el acta ahora dice que SÍ son nuestros (RUT agregado, acta corregida). */
  restaurar: number[];
  /** Línea perdida pero con la compra ya avanzada: NO se toca, hay que mirarla a mano. */
  conflictos: Array<{ productoId: number; correlativo: number; subestado: string }>;
  /** Por qué no se evaluó nada (null = se evaluó). */
  omitido: string | null;
  /** Aviso REAL para la pantalla: el acta separa líneas y hay más productos activos que líneas ganadas,
   *  pero no se pudo cruzar por número. Solo se emite con esa evidencia; nunca por simple sospecha. */
  revisarAMano: string | null;
}

const vacia = (omitido: string | null): DecisionNoAdjudicadas => ({ marcar: [], restaurar: [], conflictos: [], omitido, revisarAMano: null });

function sinCruce(motivo: string, activos: number, ganadas: number): DecisionNoAdjudicadas {
  const d = vacia(motivo);
  if (ganadas > 0 && activos > ganadas) {
    d.revisarAMano = `El acta de MP nos adjudicó ${ganadas} línea(s) pero Compras tiene ${activos} producto(s) activos, y no se pudo cruzar por número de línea (${motivo.replace(/: no se toca nada\.?$/, '').toLowerCase()}). Revisa en el acta cuáles se ganaron y renuncia a mano las que no.`;
  }
  return d;
}

/** Solo estos estados admiten pasar a NO_ADJUDICADA solos: todavía no se compró nada. */
const ESTADOS_SIN_COMPRA = ['PENDIENTE', 'COTIZANDO'];

export function decidirNoAdjudicadas(
  productos: ProductoParaDecidir[],
  lineasActa: LineaActaParaDecidir[],
  actaAdjudicada: boolean,
): DecisionNoAdjudicadas {
  if (!actaAdjudicada) return vacia('El acta de MP todavía no confirma la adjudicación.');

  const lineas = lineasActa.filter(l => Number.isFinite(Number(l?.correlativo)));
  // Adjudicación global: sin desglose por línea (0) o con una sola → no es el caso de este módulo.
  if (lineas.length < 2) return vacia('Adjudicación global (el acta no separa líneas): no aplica.');

  const porCorrelativo = new Map<number, LineaActaParaDecidir>();
  for (const l of lineas) {
    const c = Number(l.correlativo);
    if (porCorrelativo.has(c)) return vacia('El acta repite correlativos: no se puede cruzar con seguridad.');
    porCorrelativo.set(c, l);
  }
  if (!lineas.some(l => l.esNuestra)) return vacia('El acta no marca ninguna línea como nuestra: no se toca nada.');

  const conCorrelativo = productos.filter(p => p.correlativo != null);
  const activos = productos.filter(p => !esSubestadoFuera(p.subestado)).length;
  const ganadas = lineas.filter(l => l.esNuestra).length;
  const vistos = new Set<number>();
  for (const p of conCorrelativo) {
    const c = Number(p.correlativo);
    if (vistos.has(c)) return sinCruce('Hay productos con el mismo correlativo: no se puede cruzar con seguridad.', activos, ganadas);
    vistos.add(c);
    if (!porCorrelativo.has(c)) return sinCruce('La numeración del costeo no calza con la del acta: no se toca nada.', activos, ganadas);
  }

  const d = vacia(null);
  for (const p of conCorrelativo) {
    const linea = porCorrelativo.get(Number(p.correlativo))!;
    if (linea.esNuestra) {
      if (p.subestado === 'NO_ADJUDICADA') d.restaurar.push(p.id);
      continue;
    }
    // Evidencia positiva: el acta nombra a OTRO adjudicatario. Sin RUT es "dato desconocido", no "perdida".
    if (!String(linea.rutProveedor || '').trim()) continue;
    if (esSubestadoFuera(p.subestado)) continue;
    if (ESTADOS_SIN_COMPRA.includes(p.subestado)) d.marcar.push(p.id);
    else d.conflictos.push({ productoId: p.id, correlativo: Number(p.correlativo), subestado: p.subestado });
  }
  return d;
}
