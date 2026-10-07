// app/lib/compras-siguiente-paso.ts
// "¿QUÉ HAGO AHORA?" del módulo de Compras — decisión PURA (sin red ni BD) para poder probarla.
// La pantalla tenía 7 pasos con 3-5 tarjetas cada uno y nada que dijera por dónde seguir. Esto mira
// los datos que la pantalla ya tiene y devuelve UN solo pendiente, el más urgente.
//
// Orden = urgencia real: plazo vencido > incidencias > tareas vencidas > OC sin aceptar > reloj >
// validaciones de inicio > cotizaciones > aprobaciones > hitos administrativos > resto.

export type FaseCompras = 'tareas' | 'costeo' | 'aprobacion' | 'compra' | 'entrega';
export type AnclaCompras = 'encargado' | 'oc';

export interface TareaMin { catalogoClave: string | null; titulo: string; estado: 'PENDIENTE' | 'EN_CURSO' | 'HECHA'; vencida: boolean }
export interface EntradaSiguientePaso {
  asignado: boolean;
  plazoAsignacionVencido: boolean;
  esJefeDeVentas: boolean;
  ocAceptada: boolean;
  tareas: TareaMin[];
  fases: { tareasVencidas: number; productosSinCotizacion: number; escenarioElegido?: boolean; compraAprobada?: boolean; margenAprobado?: boolean; compuertasPendientes: number; hitosAdminPendientes: number | null; incidenciasAbiertas: number; relojVencido: boolean } | null;
}
export interface SiguientePaso {
  tono: 'alerta' | 'pendiente' | 'ok';
  titulo: string;
  detalle: string;
  /** Paso del flujo al que lleva el botón (si aplica). */
  fase?: FaseCompras;
  /** Bloque de arriba (fuera del flujo) al que lleva el botón. */
  ancla?: AnclaCompras;
  boton: string;
}

const VALIDACIONES_INICIO = ['contacto_inicial', 'validacion_tecnica_real', 'validacion_cotizacion', 'validacion_costeo'];

export function siguientePaso(e: EntradaSiguientePaso): SiguientePaso {
  if (!e.asignado) {
    return e.esJefeDeVentas
      ? { tono: e.plazoAsignacionVencido ? 'alerta' : 'pendiente', titulo: 'Asigna un encargado', detalle: e.plazoAsignacionVencido ? 'El plazo de 3 horas hábiles ya venció: si no lo asignas tú, el sistema lo hará solo.' : 'Hasta que haya encargado no se abre ninguna tarea.', ancla: 'encargado', boton: 'Elegir encargado' }
      : { tono: 'pendiente', titulo: 'Esperando que se asigne un encargado', detalle: 'El jefe de ventas debe asignarlo; mientras tanto no hay nada que hacer aquí.', ancla: 'encargado', boton: 'Ver quién asigna' };
  }
  const f = e.fases;
  const pendientes = e.tareas.filter(t => t.estado !== 'HECHA');
  const pendiente = (clave: string) => pendientes.find(t => t.catalogoClave === clave);

  if (f?.relojVencido) return { tono: 'alerta', titulo: 'El plazo de entrega venció', detalle: 'Gestiona con el cliente una prórroga sin multa; solo el jefe de ventas puede autorizar entregar con multa.', fase: 'entrega', boton: 'Ver reloj y prórroga' };
  if (f && f.incidenciasAbiertas > 0) return { tono: 'alerta', titulo: `${f.incidenciasAbiertas === 1 ? 'Hay 1 incidencia abierta' : `Hay ${f.incidenciasAbiertas} incidencias abiertas`}`, detalle: 'Las incidencias no detienen el reloj: resuélvelas o gestiónalas en paralelo.', fase: 'tareas', boton: 'Ver incidencias' };
  const vencidas = pendientes.filter(t => t.vencida);
  if (vencidas.length > 0) return { tono: 'alerta', titulo: vencidas.length === 1 ? `Tarea vencida: ${vencidas[0].titulo}` : `${vencidas.length} tareas vencidas`, detalle: vencidas.length === 1 ? 'Pasó su plazo. Ciérrala o regístrala hoy.' : `La más urgente: ${vencidas[0].titulo}.`, fase: 'tareas', boton: 'Ir a las tareas' };
  if (!e.ocAceptada) return { tono: 'pendiente', titulo: 'Falta la orden de compra aceptada', detalle: 'Regístrala o búscala en Mercado Público: de ella depende el plazo de entrega.', ancla: 'oc', boton: 'Ver orden de compra' };
  const reloj = pendiente('reloj_entrega');
  if (reloj) return { tono: 'pendiente', titulo: 'Fija el plazo de entrega', detalle: 'El reloj corre siempre: confirma desde qué hito parte y cuántos días tienes.', fase: 'tareas', boton: 'Fijar el reloj' };
  const validacion = pendientes.find(t => t.catalogoClave && VALIDACIONES_INICIO.includes(t.catalogoClave));
  if (validacion) return { tono: 'pendiente', titulo: validacion.titulo, detalle: 'Validación de inicio: se hace en paralelo y antes de comprar.', fase: 'tareas', boton: 'Hacerla ahora' };
  if (f && f.productosSinCotizacion > 0) return { tono: 'pendiente', titulo: `Cotiza ${f.productosSinCotizacion === 1 ? '1 producto' : `${f.productosSinCotizacion} productos`}`, detalle: 'Carga cotizaciones en cualquier formato (PDF, foto, WhatsApp, llamada). Lo ideal son tres por producto.', fase: 'costeo', boton: 'Cargar cotizaciones' };
  if (f && f.escenarioElegido === false) return { tono: 'pendiente', titulo: 'Elige cómo comprar', detalle: 'Compara los precios, elige la combinación de proveedores (o el escenario) y justifica si te apartas del más rápido.', fase: 'costeo', boton: 'Elegir cómo comprar' };
  if (f && f.compuertasPendientes === 0 && (f.compraAprobada === false || f.margenAprobado === false)) return { tono: 'pendiente', titulo: f.compraAprobada === false ? 'Propón la compra para aprobación' : 'Propón el margen para aprobación', detalle: 'Compra y margen son dos aprobaciones separadas del jefe de ventas; sin ellas no arranca lo administrativo.', fase: 'aprobacion', boton: 'Ir a aprobación' };
  if (f && f.compuertasPendientes > 0) return { tono: 'pendiente', titulo: 'Pide la aprobación de la compra', detalle: 'La compra y el margen (piso 20 %) los aprueba el jefe de ventas; sin eso no arranca lo administrativo.', fase: 'aprobacion', boton: 'Ir a aprobación' };
  if (f && f.hitosAdminPendientes != null && f.hitosAdminPendientes > 0) return { tono: 'pendiente', titulo: `${f.hitosAdminPendientes === 1 ? 'Queda 1 hito administrativo' : `Quedan ${f.hitosAdminPendientes} hitos administrativos`}`, detalle: 'OC a proveedores, provisión de fondos y facturas de compra (se ejecutan en OBUMA).', fase: 'compra', boton: 'Ver hitos' };
  if (pendientes.length > 0) return { tono: 'pendiente', titulo: pendientes[0].titulo, detalle: `Quedan ${pendientes.length} tarea(s) por cerrar.`, fase: 'tareas', boton: 'Ir a las tareas' };
  return { tono: 'ok', titulo: 'Todo al día: prepara la entrega', detalle: 'Rotulado, embalaje, guía de despacho y acta de entrega firmada cierran el proyecto.', fase: 'entrega', boton: 'Ir a entrega' };
}
