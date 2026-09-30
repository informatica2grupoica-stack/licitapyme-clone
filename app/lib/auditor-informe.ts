// app/lib/auditor-informe.ts
// AUDITOR · INFORME COMPLETO (texto para copiar y documento para PDF). Puro: recibe el panel que ya arma armarPanelAuditor (+ la posición de precio)
// y lo convierte en un documento con TODO el contenido, siempre desplegado, sin depender de qué esté plegado en pantalla. Nada se recalcula ni se
// inventa aquí: solo se ordena y se escribe lo que el panel ya tiene (resumen, posición de precio, cotizaciones, costos asociados, mensajes al proveedor,
// y por línea: cada opción con su costo, respaldos, capturas, bloqueos y alertas, mercado, verificación de costo con IA y verificación técnica completa,
// más el cuadro comparativo técnico de la línea).
import type { PanelAuditorDTO, LineaAuditorDTO, OpcionDTO } from '@/app/lib/auditor-opciones';
import type { PosicionGuardadaDTO } from '@/app/lib/auditor-posicion';

export type Bloque =
  | { t: 'h1' | 'h2' | 'h3'; texto: string }
  | { t: 'p'; texto: string }
  | { t: 'kv'; pares: Array<[string, string]> }
  | { t: 'lista'; items: string[] }
  | { t: 'tabla'; cabecera: string[]; filas: string[][] }
  | { t: 'pre'; texto: string };
export interface InformeAuditor { titulo: string; bloques: Bloque[] }

const clp = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(n).toLocaleString('es-CL')}`);
const fecha = (f: string | null | undefined) => (f ? String(f).slice(0, 16).replace('T', ' ') : '—');
const v = (x: string | number | null | undefined) => (x == null || x === '' ? '—' : String(x));
const ESTADO_OPCION: Record<string, string> = { tanteo: 'Tanteo', formalizada: 'Formalizada', verificada: 'Verificada', definitiva: 'Definitiva (firmada)', en_aprobacion: 'En aprobación', aprobada: 'Aprobada', descartada: 'Descartada' };
const VEREDICTO_COSTO: Record<string, string> = { VERIFICADO: 'Verificado', VERIFICADO_CON_ALERTAS: 'Verificado con alertas', REQUIERE_HABILITACION: 'Requiere habilitación del EM', NO_VERIFICADO: 'No verificado', SIN_RESPALDO: 'Sin respaldo', PENDIENTE_CRUCE_TECNICO: 'Pendiente de cruce técnico' };
const VEREDICTO_TEC: Record<string, string> = { CUMPLE: 'CUMPLE', NO_CUMPLE: 'NO CUMPLE', CUMPLE_CON_COMPLEMENTO: 'CUMPLE CON COMPLEMENTO', SIN_VEREDICTO: 'SIN VEREDICTO' };
const ESTADO_TEC: Record<string, string> = { CUMPLE: 'Cumple todo', CON_PENDIENTES: 'Con pendientes', NO_CUMPLE: 'No cumple', NO_CORRIDO: 'Sin verificar', SIN_REQUISITOS: 'Sin requisitos heredados', NO_APLICA: 'Vía liviana: no corre', SIN_EVALUAR: 'Sin evaluar' };
const ORIGEN_TEC: Record<string, string> = { FICHA: 'ficha', FICHA_WEB: 'página web', CONFIRMACION_INFORMAL: 'informal', DECLARADO: 'declarado', CONTRADICE_FICHA: 'contradice la ficha', HEREDADO: 'heredado', NO_LEGIBLE: 'no legible' };
const NIVEL: Record<string, string> = { rojo: 'ROJO', amarillo: 'AMARILLO', info: 'INFO', ok: 'OK' };
const nombreOpcion = (o: OpcionDTO) => [o.marca, o.modelo].filter(Boolean).join(' ') || o.producto?.nombre || 'Producto sin identificar';

function detalleOpcion(o: OpcionDTO, l: LineaAuditorDTO): Bloque[] {
  const b: Bloque[] = [];
  const ver = o.verificacion;
  b.push({ t: 'h3', texto: `Opción #${o.id} · ${o.proveedorRazonSocial || 'Proveedor sin identificar'} · ${nombreOpcion(o)}` });
  b.push({ t: 'kv', pares: [
    ['Estado', ESTADO_OPCION[o.estado] || o.estado], ['Vía de verificación', o.via === 'liviana' ? 'Liviana' : 'Completa'],
    ['Proveedor', `${v(o.proveedorRazonSocial)}${o.proveedorRut ? ` · RUT ${o.proveedorRut}` : ''}`],
    ['Producto', [o.marca && `marca ${o.marca}`, o.modelo && `modelo ${o.modelo}`, o.version && `versión ${o.version}`, o.sku && `SKU ${o.sku}`].filter(Boolean).join(' · ') || '—'],
    ['Costo unitario neto verificado', clp(ver?.costoNetoUnitario)], ['Costeado (neto por unidad)', clp(l.costeadoNeto)],
    ['Diferencia', ver?.diffPct != null ? `${ver.diffPct > 0 ? '+' : ''}${ver.diffPct}% (${clp(ver.diffMonto)} por unidad)` : '—'],
    ['Veredicto de costo', ver ? VEREDICTO_COSTO[ver.veredicto] || ver.veredicto : '—'], ['Origen del dato', v(ver?.origenDato)],
    ['Stock', v(o.producto?.stock)], ['Plazo de entrega', v(o.producto?.plazoTexto)],
    ...(o.firmadaPorNombre ? [['Firmada por', `${o.firmadaPorNombre} (${fecha(o.firmadaAt)})`] as [string, string]] : []),
    ...(o.motivoDescarte ? [['Motivo del descarte', o.motivoDescarte] as [string, string]] : []),
  ] });

  if (o.respaldos.length) b.push({ t: 'tabla', cabecera: ['Respaldo', 'Tipo', 'Precio declarado', 'IVA', 'Vigente', 'Sostiene el costo', 'Cargado'], filas: o.respaldos.map(r => [
    r.documentoNombre || r.url || '—', r.tipo.replace(/_/g, ' '), clp(r.precioDeclarado), r.precioIva.replace('_', ' '), r.vigente ? 'sí' : 'no (historial)', r.sostieneCosto ? 'sí' : 'no', `${fecha(r.cargadoAt)}${r.cargadoPorNombre ? ` · ${r.cargadoPorNombre}` : ''}`]) });
  if (o.capturas.length) b.push({ t: 'lista', items: o.capturas.map(c => `Captura ${fecha(c.capturadoAt)} · ${c.estado} · ${c.url}`) });

  if (ver?.bloqueos.length) b.push({ t: 'lista', items: ver.bloqueos.map(x => `BLOQUEO ${x.codigo}: ${x.mensaje} → Salida: ${x.salida}`) });
  if (ver?.alertas.length) b.push({ t: 'lista', items: ver.alertas.map(a => `${NIVEL[a.nivel]} ${a.codigo}: ${a.mensaje}${a.cita ? ` (cita: «${a.cita}»)` : ''}`) });
  if (ver?.faltantesProveedor.length) b.push({ t: 'p', texto: `Datos del proveedor que faltan para crearlo en OBUMA: ${ver.faltantesProveedor.join(', ')}.` });

  // Mercado
  const m = o.mercado;
  b.push({ t: 'h3', texto: `Mercado (opción #${o.id})` });
  if (!m) b.push({ t: 'p', texto: 'Todavía no se buscaron referencias de mercado.' });
  else {
    b.push({ t: 'p', texto: `Búsqueda del ${fecha(m.creadoAt)}: «${m.consulta || '—'}»${m.error ? ` — ${m.error}` : ''}${m.justificada ? ' — el asistente justificó por qué no usó la referencia más barata' : ''}.` });
    if (m.comparador.length) b.push({ t: 'tabla', cabecera: ['Fuente', 'Costo neto', 'Enlace'], filas: m.comparador.map(f => [f.origen === 'opcion' ? `Esta opción (${f.nombre})` : f.nombre, clp(f.precioNeto), f.url || '—']) });
    if (m.medianaReferencias != null) b.push({ t: 'p', texto: `Mediana de ${m.referencias.length} referencia(s) del mismo producto: ${clp(m.medianaReferencias)}.${m.ahorroMaximoPct != null ? ` Ahorro máximo posible: ${m.ahorroMaximoPct}%.` : ''}${m.dispersionActiva ? ' ATENCIÓN: los precios se separan más de 40% de la mediana.' : ''}` });
    if (m.mercadoPublico?.neto != null) b.push({ t: 'p', texto: `Mercado público: ${clp(m.mercadoPublico.neto)} (${m.mercadoPublico.n} OC, ${m.mercadoPublico.calidad === 'mismo_producto' ? 'mismo producto' : 'comparable: dato débil'}).` });
    if (m.competidor) b.push({ t: 'p', texto: `Historial del proveedor en MercadoPúblico: ${m.competidor.venteAlEstado ? `vende al Estado (${m.competidor.nLicitaciones} licitación(es), ${m.competidor.nOrdenesCompra} OC${m.competidor.rubros.length ? `; rubros: ${m.competidor.rubros.join(', ')}` : ''})` : 'sin ventas al Estado en nuestra base'}. ${m.competidor.limitacion}` });
    if (m.descartadas.length) b.push({ t: 'lista', items: m.descartadas.map(d => `Descartada: ${d.tienda || d.nombre} — ${d.motivo} (${d.url})`) });
  }

  // Verificador de costo con IA
  const c = o.costoIA;
  b.push({ t: 'h3', texto: `Verificación de costo con IA (opción #${o.id})` });
  if (!c) b.push({ t: 'p', texto: 'Todavía no se corrió.' });
  else {
    b.push({ t: 'p', texto: `Corrida del ${fecha(c.creadoAt)}: ${c.error ? `error — ${c.error}` : `${c.alertas} alerta(s) agregada(s) a la opción`}.` });
    if (c.ayuda) b.push({ t: 'kv', pares: [['Diagnóstico', v(c.ayuda.diagnostico)], ['Causa probable', v(c.ayuda.causaProbable)], ['Pregunta al proveedor', v(c.ayuda.preguntaProveedor)], ['Qué hacer', v(c.ayuda.accionConcreta)], ['Datos para el impacto', v(c.ayuda.datosParaImpacto)]] });
    if (c.descartados.length) b.push({ t: 'lista', items: c.descartados.map(d => `Hallazgo de la IA descartado (sin cita en el documento): ${d}`) });
    if (c.noPudeLeer.length) b.push({ t: 'lista', items: c.noPudeLeer.map(x => `No se pudo leer: ${x.que} (${x.donde})`) });
  }

  // Verificación técnica
  const t = o.tecnico, r = t.resultado;
  b.push({ t: 'h3', texto: `Verificación técnica (opción #${o.id})` });
  b.push({ t: 'p', texto: `Estado: ${ESTADO_TEC[t.estado] || t.estado}${t.corridoAt ? ` · verificada el ${fecha(t.corridoAt)}` : ''}${t.segundaPasadaAt ? ` · segunda pasada el ${fecha(t.segundaPasadaAt)}` : ''} · ${t.requisitosTotal} requisito(s) heredado(s) en la línea.${t.error ? ` Error: ${t.error}` : ''}` });
  if (r) {
    b.push({ t: 'p', texto: `Resumen: ${r.resumen.cumple} cumplen · ${r.resumen.conComplemento} con complemento · ${r.resumen.noCumple} no cumplen · ${r.resumen.sinVeredicto} sin veredicto (${r.resumen.riesgo} riesgo, ${r.resumen.porAfinar} por afinar) · ${r.resumen.rojosAbiertos} exigencias críticas abiertas · ${r.resumen.requiereEM} requieren al EM.` });
    if (r.alertas.length) b.push({ t: 'lista', items: r.alertas.map(a => `${NIVEL[a.nivel]}: ${a.texto}`) });
    if (r.productoOrigen.activa) b.push({ t: 'p', texto: r.productoOrigen.mensaje });
    if (r.sobredimensionamiento.activa) b.push({ t: 'p', texto: r.sobredimensionamiento.mensaje });
    if (r.bloqueos.length) b.push({ t: 'lista', items: r.bloqueos.map(x => `BLOQUEO ${x.codigo}${x.item != null ? ` (ítem ${x.item})` : ''}: ${x.mensaje} → Salida: ${x.salida}`) });
    for (const f of r.filas) {
      b.push({ t: 'kv', pares: [
        [`Requisito ${f.n}${f.criticidad === 'INADMISIBLE' ? ' (INADMISIBLE)' : ` (${f.criticidad})`}`, f.requeridoTexto], ['Fuente en las bases', v(f.fuenteBases)],
        ['Veredicto', `${VEREDICTO_TEC[f.veredicto]}${f.motivoPendiente ? ` · ${f.motivoPendiente === 'RIESGO' ? 'RIESGO' : 'POR AFINAR'}` : ''}${f.sobrecumple ? ' · sobrecumple' : ''}${f.criticidadSospechosa ? ' · criticidad sospechosa' : ''}`],
        ['Valor ofertado', v(f.valorCorto)], ['Origen del dato', f.origen ? ORIGEN_TEC[f.origen] || f.origen : '—'],
        ...(f.habilitacion === 'EM' ? [['Habilitación', f.habilitado ? 'habilitada por el EM' : 'requiere habilitación del EM'] as [string, string]] : []),
        ...(f.partes.length > 1 || f.resumenPartes ? [['Partes', f.resumenPartes || f.partes.map(p => `${p.parte}: ${VEREDICTO_TEC[p.veredicto]}`).join(' · ')] as [string, string]] : []),
        ...f.partes.filter(p => p.citaOriginal || p.calculo || p.lecturaCorregida).map(p => [`Cita (${p.parte || 'ficha'})`, [p.fuenteFicha, p.citaOriginal && `«${p.citaOriginal}»`, p.citaTraduccion && `(${p.citaTraduccion})`, p.calculo && `cálculo: ${p.calculo}`, p.lecturaCorregida && `lectura corregida: ${p.lecturaCorregida}`].filter(Boolean).join(' ')] as [string, string]),
        ...(f.ayuda ? [['Diagnóstico', v(f.ayuda.diagnostico)], ['Pregunta al proveedor', v(f.ayuda.preguntaProveedor)], ...(f.ayuda.declaracionPropuesta ? [['Declaración propuesta', f.ayuda.declaracionPropuesta]] : []), ['Ruta', `${f.ayuda.ruta || '—'}: ${v(f.ayuda.accionConcreta || f.rutaCierre)}`]] as Array<[string, string]> : []),
        ...(f.rectificacion ? [['Segunda pasada', f.rectificacion] as [string, string]] : []),
      ] });
    }
    if (r.preguntas.length) b.push({ t: 'lista', items: r.preguntas.map(q => `Pregunta al proveedor (requisito ${q.n})${q.bloquea ? ' [bloquea]' : ''}: ${q.texto}`) });
    if (r.compromisos.length) b.push({ t: 'lista', items: r.compromisos.map(cm => `Compromiso con costo — ${cm.materia}: ${cm.cuantificacion || 'no cuantificado'} (${cm.fuenteBases}) «${cm.exigeBaseLiteral}»`) });
    if (r.eventos.length) b.push({ t: 'lista', items: r.eventos.map(e => `Evento ${e.tipo.replace(/_/g, ' ')}: ${e.detalle}`) });
    if (r.noPudeLeer.length) b.push({ t: 'lista', items: r.noPudeLeer.map(x => `No se pudo leer: ${x.que} (${x.donde})`) });
  }
  return b;
}

/** Cuadro comparativo técnico de la línea: filas = requisitos (texto literal de las bases), columnas = opciones vivas con verificación. */
function cuadroTecnico(l: LineaAuditorDTO): Bloque[] {
  const cols = l.opciones.filter(o => o.estado !== 'descartada' && o.tecnico.resultado);
  if (cols.length === 0) return [];
  const base = cols[0].tecnico.resultado!.filas;
  return [
    { t: 'h3', texto: `Cuadro comparativo técnico de la línea #${l.item} (${base.length} requisitos)` },
    { t: 'tabla', cabecera: ['Requisito (literal de las bases)', ...cols.map(o => `${o.proveedorRazonSocial || 'Proveedor'} · ${nombreOpcion(o)}`)],
      filas: [
        ...base.map(f => [`${f.n}. ${f.criticidad === 'INADMISIBLE' ? '[INADMISIBLE] ' : ''}${f.requeridoTexto}`, ...cols.map(o => {
          const x = o.tecnico.resultado!.filas.find(y => y.n === f.n);
          return x ? `${VEREDICTO_TEC[x.veredicto]}${x.valorCorto ? ` — ${x.valorCorto}` : ''}${x.origen && x.origen !== 'FICHA' ? ` [${ORIGEN_TEC[x.origen]}]` : ''}${x.motivoPendiente ? ` (${x.motivoPendiente === 'RIESGO' ? 'riesgo' : 'por afinar'})` : ''}` : '—';
        })]),
        ['COSTO UNITARIO NETO', ...cols.map(o => clp(o.verificacion?.costoNetoUnitario))],
      ] },
  ];
}

export function construirInformeAuditor(panel: PanelAuditorDTO, meta: { licitacionCodigo: string; generadoPor: string | null; generadoAt: string }): InformeAuditor {
  const b: Bloque[] = [];
  const r = panel.resumen;
  b.push({ t: 'p', texto: `Licitación ${meta.licitacionCodigo} · informe generado el ${fecha(meta.generadoAt)}${meta.generadoPor ? ` por ${meta.generadoPor}` : ''}. Incluye TODO el contenido del Auditor, con todo desplegado.` });

  b.push({ t: 'h2', texto: 'Resumen' });
  b.push({ t: 'kv', pares: [
    ['Líneas con opción', `${r.conOpcion} de ${r.lineas}`], ['Opciones definitivas (firmadas)', String(r.definitivas)], ['Opciones aprobadas', String(r.aprobadas)], ['Opciones con bloqueos', String(r.bloqueadas)],
    ['Margen con las definitivas', panel.margen?.margenFinal != null ? `${panel.margen.margenFinal}%${panel.margen.margenBase != null ? ` (base ${panel.margen.margenBase}%)` : ''}` : '—'],
    ['Avance a PRE-POSTULACIÓN', `${panel.avance.puede ? 'LISTO. ' : ''}${panel.avance.mensaje} (${panel.avance.aprobadas} de ${panel.avance.ofertadas} líneas ofertadas con opción aprobada)`],
  ] });

  const pos: PosicionGuardadaDTO | null = panel.posicion ?? null;
  b.push({ t: 'h2', texto: 'Posición de precio' });
  if (!pos) b.push({ t: 'p', texto: 'Todavía no se calculó la posición de precio.' });
  else {
    const p = pos.posicion;
    b.push({ t: 'kv', pares: [
      [`Presupuesto del organismo${p.presupuesto.nivel ? ` (${p.presupuesto.nivel})` : ''}`, `${clp(p.presupuesto.monto_neto)} — ${p.presupuesto.fuente}`],
      ['Mercado público', p.mercado_publico.calidad === 'sin_datos' ? 'sin datos suficientes' : `${clp(p.mercado_publico.monto_neto)} (${p.mercado_publico.n_datos} OC${p.mercado_publico.rango_fechas ? `, ${p.mercado_publico.rango_fechas}` : ''}, ${p.mercado_publico.calidad === 'mismo_producto' ? 'mismo producto' : 'comparable'})`],
      ['Mercado privado', p.mercado_privado.monto_neto != null ? `${clp(p.mercado_privado.monto_neto)} (${p.mercado_privado.lineas_con_referencias} línea(s) con referencias)` : '—'],
      ['Nuestro costo', `${clp(p.costo_verificado.monto_neto)} (${p.costo_verificado.lineas_pendientes} de ${p.costo_verificado.lineas_total} líneas sin verificar)`],
      ['Espacio de maniobra', `${clp(p.espacio_maniobra.monto)}${p.espacio_maniobra.pct_sobre_costo != null ? ` (${p.espacio_maniobra.pct_sobre_costo}% sobre el costo)` : ''}`],
      ['Margen', `con el precio de venta registrado: ${p.margen.con_precio_venta != null ? p.margen.con_precio_venta + '%' : '—'} · al presupuesto: ${p.margen.al_presupuesto != null ? p.margen.al_presupuesto + '%' : '—'}`],
      ['Orden presupuesto ≥ público > privado ≥ costo', p.orden_sano == null ? '—' : p.orden_sano ? 'sano' : 'NO se cumple'],
      ...(pos.provisorias > 0 ? [['Líneas con costo provisorio', `${pos.provisorias} (sin opción firmada)`] as [string, string]] : []),
      ['Calculada', fecha(pos.creadoAt)],
    ] });
    if (p.alertas.length) b.push({ t: 'lista', items: p.alertas.map(a => `${NIVEL[a.nivel]}: ${a.detalle}${a.lineas_que_mas_aportan.length ? ` (líneas que más aportan: ${a.lineas_que_mas_aportan.join(', ')})` : ''}`) });
    if (p.lectura) b.push({ t: 'p', texto: `Lectura: ${p.lectura}` });
  }

  b.push({ t: 'h2', texto: `Cotizaciones en Documentos (${panel.documentos.length})` });
  if (panel.documentos.length === 0) b.push({ t: 'p', texto: 'No hay cotizaciones cargadas.' });
  for (const d of panel.documentos) {
    b.push({ t: 'h3', texto: d.nombre });
    b.push({ t: 'p', texto: d.leido
      ? `Leída · ${d.proveedor || 'proveedor sin identificar'}${d.rut ? ` · RUT ${d.rut}` : ''}${d.fechaEmision ? ` · emitida ${d.fechaEmision}` : ''}${d.formalidad ? ` · ${d.formalidad}` : ''} · ${d.productos.length} producto(s).`
      : `Sin leer${d.error ? ` — ${d.error}` : ''}.` });
    if (d.productos.length) b.push({ t: 'tabla', cabecera: ['Producto', 'Precio', 'IVA', 'Cantidad', 'Asignación'], filas: d.productos.map(p => [
      p.nombre, clp(p.precio), p.iva === 'no_declarado' ? 'no declarado' : p.iva === 'incluido' ? 'con IVA' : '+ IVA', v(p.cantidad),
      p.filaId ? `→ ítem ${panel.lineas.find(l => l.filaId === p.filaId)?.item ?? '?'}` : p.esCargo ? 'cargo aparte (no es producto)' : p.precio != null ? 'SIN EMPAREJAR' : 'sin precio legible']) });
  }

  b.push({ t: 'h2', texto: `Costos asociados (${panel.costosAsociados.length}) — total estimado ${clp(panel.totalCostosAsociados)}` });
  if (panel.costosAsociados.length === 0) b.push({ t: 'p', texto: 'No hay costos asociados.' });
  else b.push({ t: 'tabla', cabecera: ['Materia', 'Cuantificación', 'Fuente en las bases', 'Monto estimado', 'Origen', 'Estado'], filas: panel.costosAsociados.map(c => [
    c.materia, v(c.cuantificacion), `${v(c.fuenteBases)}${c.exigeBaseLiteral ? ` «${c.exigeBaseLiteral}»` : ''}`, c.montoEstimado != null ? clp(c.montoEstimado) : 'sin estimar',
    c.origen === 'tecnico' ? 'detectado por el verificador técnico' : 'manual', c.anulado ? `ANULADO: ${c.comentarioAnulacion || '—'}` : 'activo']) });

  b.push({ t: 'h2', texto: `Mensajes al proveedor (${panel.mensajes.length})` });
  if (panel.mensajes.length === 0) b.push({ t: 'p', texto: 'No hay nada que preguntar a ningún proveedor.' });
  for (const m of panel.mensajes) {
    b.push({ t: 'h3', texto: `${m.proveedor}${m.bloquea ? ' — responde algo que bloquea' : ''}` });
    b.push({ t: 'p', texto: [m.rut && `RUT ${m.rut}`, m.vendedor, m.email, m.telefono].filter(Boolean).join(' · ') || 'Sin datos de contacto.' });
    b.push({ t: 'pre', texto: m.texto });
  }

  b.push({ t: 'h2', texto: `Líneas y opciones (${panel.lineas.length})` });
  for (const l of panel.lineas) {
    b.push({ t: 'h2', texto: `Línea #${l.item} — ${l.detalle}` });
    b.push({ t: 'kv', pares: [
      ['Cantidad', `${v(l.cantidad)} ${l.unidad}`], ['Costeado (neto por unidad)', clp(l.costeadoNeto)], ['Precio de venta unitario', clp(l.precioVentaUnitario)],
      ['Exige vía completa', l.exigeViaCompleta ? 'sí (tiene exigencias que pueden dejarnos fuera)' : 'no'],
      ['Opción definitiva', l.opcionDefinitivaId != null ? `#${l.opcionDefinitivaId}` : 'ninguna todavía'],
      ...(l.noOfertada ? [['NO OFERTADA', v(l.motivoNoOfertada)] as [string, string]] : []),
      ...(l.links.length ? [['Links del costeo', l.links.join(' · ')] as [string, string]] : []),
    ] });
    if (l.opciones.length === 0) { b.push({ t: 'p', texto: 'Sin opciones todavía.' }); continue; }
    const vivas = l.opciones.filter(o => o.estado !== 'descartada');
    b.push({ t: 'tabla', cabecera: ['Opción', 'Proveedor · producto', 'Estado', 'Costo unit. neto', 'Veredicto de costo', 'Técnico'], filas: l.opciones.map(o => [
      `#${o.id}`, `${v(o.proveedorRazonSocial)} · ${nombreOpcion(o)}`, ESTADO_OPCION[o.estado] || o.estado, clp(o.verificacion?.costoNetoUnitario),
      o.verificacion ? VEREDICTO_COSTO[o.verificacion.veredicto] || o.verificacion.veredicto : '—', ESTADO_TEC[o.tecnico.estado] || o.tecnico.estado]) });
    if (vivas.length) b.push(...cuadroTecnico(l));
    for (const o of l.opciones) b.push(...detalleOpcion(o, l));
  }
  return { titulo: `Auditor · ${meta.licitacionCodigo}`, bloques: b };
}

// ── Renderizadores ───────────────────────────────────────────────────────────────────────────────
export function informeATexto(inf: InformeAuditor): string {
  const out: string[] = [inf.titulo.toUpperCase(), '='.repeat(Math.min(80, inf.titulo.length)), ''];
  for (const x of inf.bloques) {
    if (x.t === 'h1' || x.t === 'h2') out.push('', x.texto.toUpperCase(), '-'.repeat(Math.min(80, x.texto.length)));
    else if (x.t === 'h3') out.push('', `▸ ${x.texto}`);
    else if (x.t === 'p') out.push(x.texto);
    else if (x.t === 'kv') for (const [k, val] of x.pares) out.push(`  ${k}: ${val}`);
    else if (x.t === 'lista') for (const i of x.items) out.push(`  • ${i}`);
    else if (x.t === 'pre') out.push(...x.texto.split('\n').map(l => `  | ${l}`));
    else if (x.t === 'tabla') { for (const fila of x.filas) out.push(`  - ${fila.map((c, i) => `${x.cabecera[i]}: ${c}`).join(' | ')}`); }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function informeAHtml(inf: InformeAuditor): string {
  const cuerpo = inf.bloques.map(x => {
    if (x.t === 'h1' || x.t === 'h2') return `<h2>${esc(x.texto)}</h2>`;
    if (x.t === 'h3') return `<h3>${esc(x.texto)}</h3>`;
    if (x.t === 'p') return `<p>${esc(x.texto)}</p>`;
    if (x.t === 'kv') return `<table class="kv">${x.pares.map(([k, val]) => `<tr><th>${esc(k)}</th><td>${esc(val)}</td></tr>`).join('')}</table>`;
    if (x.t === 'lista') return `<ul>${x.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
    if (x.t === 'pre') return `<pre>${esc(x.texto)}</pre>`;
    if (x.t !== 'tabla') return '';
    return `<table class="grid"><thead><tr>${x.cabecera.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${x.filas.map(f => `<tr>${f.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }).join('\n');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(inf.titulo)}</title><style>
  body{font-family:Arial,Helvetica,sans-serif;color:#18181b;font-size:10.5px;line-height:1.4;margin:0}
  h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:18px 0 6px;padding-bottom:3px;border-bottom:2px solid #e4e4e7;page-break-after:avoid}
  h3{font-size:11.5px;margin:12px 0 4px;color:#3f3f46;page-break-after:avoid}p{margin:3px 0}ul{margin:3px 0 6px 16px;padding:0}li{margin:1px 0}
  table{border-collapse:collapse;width:100%;margin:4px 0 8px}th,td{border:1px solid #d4d4d8;padding:3px 5px;text-align:left;vertical-align:top;word-break:break-word}
  th{background:#f4f4f5;font-weight:700}table.kv th{width:26%;background:#fafafa}table.grid thead{display:table-header-group}tr{page-break-inside:avoid}
  pre{white-space:pre-wrap;font-family:inherit;background:#fafafa;border:1px solid #e4e4e7;padding:6px 8px;border-radius:4px}
  </style></head><body><h1>${esc(inf.titulo)}</h1>${cuerpo}</body></html>`;
}
