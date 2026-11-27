// app/lib/evaluar-empresa-rut.ts
// Evalúa una empresa-cliente por TODOS sus RUT (cada razón social que tenga en `empresas`, más el RUT de su ficha) con lo que
// realmente vendió en Mercado Público, y le sugiere palabras clave y perfil a la medida (Radar y viabilidad afinados desde el día 1).
//
// Cadena (todo API pública de MP, verificado con Comercial MP 78.388.175-6 → código 2105932):
//   1. BuscarProveedor: RUT → código interno de proveedor (los listados NO aceptan el RUT). Se guarda en `empresas.mp_codigo_proveedor`.
//   2. ordenesdecompra.json?fecha=D&CodigoProveedor=X día por día hacia atrás hasta juntar ~50 OC por RUT
//      (la API no tiene rango de fechas; una empresa chica tiene ~1 OC cada 4 días → ~200 llamadas).
//   3. Detalle de cada OC: ítems con producto ONU, categoría y especificación del proveedor, montos, comprador.
//   4. Acta de cada licitación de origen: las líneas adjudicadas a ALGUNO de sus RUT (lo que ganó compitiendo).
//   5. IA (Kimi): sugiere palabras clave (las mejores + todas las posibles por rubro), negativas y el perfil.
// Nada se aplica solo: el admin de la empresa lo elige al configurar su empresa la primera vez que entra (/mi-empresa).
//
// COLA (Fase 2 multiempresa, 2026-11-18, migration-197). Antes corría entera dentro del proceso de la app: un deploy la cortaba
// a mitad y quedaba «EN_CURSO» para siempre. Ahora es una cola en `cliente_evaluacion`:
//   PENDIENTE → EN_CURSO → LISTO | ERROR.  El avance vive en `cursor` (JSON) y cada pasada trabaja un rato y lo guarda, así que
//   después de un reinicio sigue donde quedó. La mueve el scheduler (/api/cron/evaluar-empresas, cada 5 min) y, para no esperar,
//   también se arranca al tiro al encolar. Dos procesos no trabajan la misma: se «toma» con un UPDATE que solo gana uno.
//   Sin cupo de MP del día → vuelve a PENDIENTE con `reintentar_at` = mañana (no es un error).
// Lo que se baja de MP queda en una caché PÚBLICA (mp_oc_publica, mp_oc_proveedor_dia, adjudicacion_cache): son datos oficiales y
// así una re-evaluación o una segunda empresa no vuelven a gastar las mismas consultas.
// Va en serie con pausa (la API responde 10500 si se la aprieta). Todo el gasto (MP, IA) queda anotado a ESA empresa.
import pool from '@/app/lib/db';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';
import { crearChatIA, iaTextoConfigurada, MODELO_TEXTO } from '@/app/lib/gemini';
import { conModuloIA } from '@/app/lib/ia-uso';
import { conCliente, TopeClienteError, verificarTopeMP } from '@/app/lib/medidor-cliente';
import { ticketMpPropio } from '@/app/lib/integraciones-cliente';
import { leerCache, respuestaDesdeCache, consultarMP, guardarCache } from '@/app/lib/adjudicacion';
import type { OrdenCompraAPI } from '@/app/types/mercado-publico.types';

const OBJETIVO_OC = 50;          // por RUT
const MAX_DIAS = 300;
const PAUSA_MS = 1_200;
const PRESUPUESTO_MS = 4 * 60_000; // trabajo por pasada; el estado se guarda al final de cada paso
const TOMADA_VENCE_MIN = 3;        // una EN_CURSO sin señales hace 3 min se da por abandonada (proceso caído) y se retoma
const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));
const GENERICAS = new Set(['sistema', 'sistemas', 'equipo', 'equipos', 'placa', 'carro', 'camara', 'cámara', 'monitor', 'mueble', 'muebles', 'herramientas',
  'adquisicion', 'adquisición', 'insumos', 'materiales', 'servicio', 'servicios', 'productos', 'articulos', 'artículos', 'implementos', 'accesorios', 'kit']);

/** "78388175-6" / "78.388.175-6" → "78.388.175-6" (el formato que acepta BuscarProveedor). */
export function formatearRut(rut: string): string {
  const s = String(rut || '').replace(/[^0-9kK]/g, '').toUpperCase();
  if (s.length < 2) return '';
  const cuerpo = s.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cuerpo}-${s.slice(-1)}`;
}
const rutPlano = (r: string) => String(r || '').replace(/[^0-9kK]/g, '').toUpperCase();

/** Dígito verificador (módulo 11), en cualquier formato de entrada. */
export function rutValido(rut: string): boolean {
  const s = rutPlano(rut);
  if (!/^\d{7,8}[\dK]$/.test(s)) return false;
  let suma = 0, mult = 2;
  for (const d of s.slice(0, -1).split('').reverse()) { suma += Number(d) * mult; mult = mult === 7 ? 2 : mult + 1; }
  const dv = 11 - (suma % 11);
  return s.slice(-1) === (dv === 11 ? '0' : dv === 10 ? 'K' : String(dv));
}

interface Linea { producto: string; categoria: string; detalle: string; monto: number; origen: 'OC' | 'ACTA' }
interface RutEval { rut: string; empresaId: number | null; codigo?: string | null; nombre?: string; dias: number; encontradas: number; listo: boolean }
export interface CursorEval {
  ruts: RutEval[];
  oc: string[]; ocIdx: number;
  lineas: Linea[]; licitaciones: string[]; licIdx: number; actas: number;
  compradores: Record<string, number>; regiones: Record<string, number>; totales: number[];
}

async function guardarEstado(clienteId: number, estado: string, progreso: string, extra: { resultado?: unknown; cursor?: CursorEval | null; reintentarAt?: string | null } = {}) {
  const sets = ['estado = ?', 'progreso = ?', 'updated_at = NOW()'];
  const vals: unknown[] = [estado, progreso.slice(0, 500)];
  if (extra.resultado !== undefined) { sets.push('resultado = ?'); vals.push(JSON.stringify(extra.resultado)); }
  if (extra.cursor !== undefined) { sets.push('`cursor` = ?'); vals.push(extra.cursor == null ? null : JSON.stringify(extra.cursor)); }
  if (extra.reintentarAt !== undefined) { sets.push('reintentar_at = ?'); vals.push(extra.reintentarAt); }
  vals.push(clienteId);
  await pool.query(`UPDATE cliente_evaluacion SET ${sets.join(', ')} WHERE cliente_id = ?`, vals);
}

export async function leerEvaluacion(clienteId: number) {
  const [rows] = await pool.query('SELECT estado, progreso, resultado, updated_at, aplicado_at FROM cliente_evaluacion WHERE cliente_id = ?', [clienteId]);
  const r = (rows as any[])[0];
  if (!r) return null;
  return { ...r, resultado: typeof r.resultado === 'string' ? JSON.parse(r.resultado) : r.resultado };
}

/** RUT de la empresa-cliente: cada razón social activa de `empresas` + el de su ficha (`clientes.rut`), sin repetir. */
export async function rutsDeCliente(clienteId: number): Promise<Array<{ rut: string; empresaId: number | null }>> {
  const [emp] = await pool.query('SELECT id, rut FROM empresas WHERE cliente_id = ? AND activo = TRUE AND rut IS NOT NULL ORDER BY id', [clienteId]) as any;
  const [[c]] = await pool.query('SELECT rut FROM clientes WHERE id = ?', [clienteId]) as any;
  const vistos = new Set<string>(), out: Array<{ rut: string; empresaId: number | null }> = [];
  for (const [rut, empresaId] of [...(emp as any[]).map(e => [e.rut, e.id] as const), [c?.rut, null] as const]) {
    const p = rutPlano(String(rut || ''));
    if (p.length < 2 || vistos.has(p)) continue;
    vistos.add(p); out.push({ rut: formatearRut(p), empresaId });
  }
  return out;
}

/** Pone (o vuelve a poner) la evaluación de la empresa en la cola y la arranca al tiro en segundo plano.
 *  `forzar`: re-evaluar aunque ya esté LISTO (botón «Volver a evaluar»). No pisa una que está corriendo. */
export async function encolarEvaluacion(clienteId: number, { forzar = false } = {}): Promise<{ ok: boolean; motivo?: string }> {
  const ruts = await rutsDeCliente(clienteId);
  if (!ruts.length) return { ok: false, motivo: 'La empresa no tiene RUT' };
  const ev = await leerEvaluacion(clienteId);
  // «viva» se calcula en MySQL: comparar la hora en JS se corre por la zona horaria (la BD guarda hora de Chile)
  const [[v]] = await pool.query(
    `SELECT (estado = 'EN_CURSO' AND updated_at >= NOW() - INTERVAL ${TOMADA_VENCE_MIN} MINUTE) AS viva FROM cliente_evaluacion WHERE cliente_id = ?`, [clienteId]) as any;
  if (Number(v?.viva)) return { ok: false, motivo: 'Ya hay una evaluación en curso' };
  if (ev && !forzar && (ev.estado === 'LISTO' || ev.estado === 'PENDIENTE')) return { ok: true };
  await pool.query(
    `INSERT INTO cliente_evaluacion (cliente_id, estado, progreso, \`cursor\`, reintentar_at) VALUES (?, 'PENDIENTE', ?, NULL, NULL)
     ON DUPLICATE KEY UPDATE estado = 'PENDIENTE', progreso = VALUES(progreso), \`cursor\` = NULL, reintentar_at = NULL`,
    [clienteId, `En cola: ${ruts.length} RUT por revisar en Mercado Público`]);
  void procesarEvaluacion(clienteId).catch(e => console.error('[evaluar-empresa] arranque', clienteId, String(e).slice(0, 200)));
  return { ok: true };
}

/** Toma la evaluación si nadie más la está trabajando. Solo gana un proceso (UPDATE con condición). */
async function tomar(clienteId: number): Promise<boolean> {
  const [r] = await pool.query(
    `UPDATE cliente_evaluacion SET estado = 'EN_CURSO', updated_at = NOW()
      WHERE cliente_id = ? AND (reintentar_at IS NULL OR reintentar_at <= NOW())
        AND (estado = 'PENDIENTE' OR (estado = 'EN_CURSO' AND updated_at < NOW() - INTERVAL ${TOMADA_VENCE_MIN} MINUTE))`, [clienteId]) as any;
  return Number(r?.affectedRows) > 0;
}

/** Para el cron: avanza las evaluaciones en cola, una tras otra, dentro del presupuesto de tiempo. */
export async function procesarColaEvaluaciones(presupuestoMs = PRESUPUESTO_MS): Promise<{ procesadas: number; pendientes: number }> {
  const hasta = Date.now() + presupuestoMs;
  let procesadas = 0;
  const [rows] = await pool.query(
    `SELECT cliente_id FROM cliente_evaluacion
      WHERE (reintentar_at IS NULL OR reintentar_at <= NOW())
        AND (estado = 'PENDIENTE' OR (estado = 'EN_CURSO' AND updated_at < NOW() - INTERVAL ${TOMADA_VENCE_MIN} MINUTE))
      ORDER BY updated_at LIMIT 10`) as any;
  for (const r of rows as any[]) {
    if (Date.now() >= hasta) break;
    // un error de una empresa no corta a las demás
    await procesarEvaluacion(Number(r.cliente_id), hasta - Date.now()).then(() => { procesadas++; })
      .catch(e => console.error('[evaluar-empresa] cola', r.cliente_id, String(e).slice(0, 200)));
  }
  const [[p]] = await pool.query(
    `SELECT COUNT(*) n FROM cliente_evaluacion WHERE estado IN ('PENDIENTE','EN_CURSO') AND (reintentar_at IS NULL OR reintentar_at <= NOW())`) as any;
  return { procesadas, pendientes: Number(p?.n) || 0 };
}

/** Trabaja UNA evaluación hasta terminarla o agotar el presupuesto (deja el cursor guardado). No lanza por errores de MP o IA. */
export function procesarEvaluacion(clienteId: number, presupuestoMs = PRESUPUESTO_MS): Promise<void> {
  return conCliente(clienteId, async () => {
    if (!(await tomar(clienteId))) return;
    const hasta = Date.now() + presupuestoMs;
    let cur: CursorEval | null = null;
    try {
      const [[row]] = await pool.query('SELECT `cursor` FROM cliente_evaluacion WHERE cliente_id = ?', [clienteId]) as any;
      cur = row?.cursor ? (typeof row.cursor === 'string' ? JSON.parse(row.cursor) : row.cursor) : null;
      if (!cur) {
        const ruts = await rutsDeCliente(clienteId);
        if (!ruts.length) throw new Error('La empresa no tiene RUT');
        cur = { ruts: ruts.map(r => ({ ...r, dias: 0, encontradas: 0, listo: false })), oc: [], ocIdx: 0, lineas: [], licitaciones: [], licIdx: 0, actas: 0, compradores: {}, regiones: {}, totales: [] };
      }
      const terminado = await avanzar(clienteId, cur, hasta);
      if (!terminado) await guardarEstado(clienteId, 'PENDIENTE', progresoDe(cur), { cursor: cur });
    } catch (e) {
      if (e instanceof TopeClienteError && /Mercado Público/i.test(e.message)) {
        // Sin cupo de MP hoy: no es un error, sigue mañana desde donde quedó.
        const manana = new Date(); manana.setDate(manana.getDate() + 1);
        await guardarEstado(clienteId, 'PENDIENTE', `Sin cupo de consultas a Mercado Público hoy; sigue mañana (${progresoDe(cur)})`,
          { cursor: cur, reintentarAt: `${manana.toISOString().slice(0, 10)} 00:05:00` }).catch(() => {});
        return;
      }
      console.error('[evaluar-empresa]', clienteId, String(e).slice(0, 300));
      await guardarEstado(clienteId, 'ERROR', String((e as Error)?.message || e), { cursor: null }).catch(() => {});
    }
  });
}

function progresoDe(c: CursorEval | null): string {
  if (!c) return 'Preparando…';
  const r = c.ruts.find(x => !x.listo);
  if (r) return `Revisando órdenes de compra de ${r.rut}: ${r.dias} días, ${r.encontradas} encontradas`;
  if (c.ocIdx < c.oc.length) return `Leyendo órdenes de compra: ${c.ocIdx}/${c.oc.length}`;
  if (c.licIdx < c.licitaciones.length) return `Leyendo actas de adjudicación: ${c.licIdx}/${c.licitaciones.length}`;
  return `Analizando ${c.lineas.length} líneas vendidas con IA…`;
}

/** Sin ticket propio, frena ANTES de gastar si la empresa ya no tiene cupo de MP hoy (algunos métodos del cliente MP tragan el error). */
async function asegurarCupoMp() {
  if (!(await ticketMpPropio())) await verificarTopeMP();
}

const hoyMenos = (dias: number) => { const f = new Date(); f.setDate(f.getDate() - dias); return f; };
const fechaSQL = (f: Date) => `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;

/** OC de un proveedor en un día. Los días ya cerrados (>2 días atrás) se guardan en la caché pública y no se vuelven a pedir. */
async function ocDelDia(codigoProveedor: string, dias: number): Promise<string[]> {
  const fecha = hoyMenos(dias), f = fechaSQL(fecha), cacheable = dias > 2;
  if (cacheable) {
    const [[c]] = await pool.query('SELECT codigos FROM mp_oc_proveedor_dia WHERE codigo_proveedor = ? AND fecha = ?', [codigoProveedor, f]) as any;
    if (c) return typeof c.codigos === 'string' ? JSON.parse(c.codigos) : c.codigos;
  }
  const lista = await getMercadoPublicoClient().listarOrdenesCompraPorProveedor(codigoProveedor, fecha); // lanza (TopeClienteError incluido)
  await dormir(PAUSA_MS);
  const codigos = [...new Set(lista.map(o => String(o.Codigo || '')).filter(Boolean))];
  if (cacheable) await pool.query('INSERT IGNORE INTO mp_oc_proveedor_dia (codigo_proveedor, fecha, codigos) VALUES (?, ?, ?)', [codigoProveedor, f, JSON.stringify(codigos)]).catch(() => {});
  return codigos;
}

/** Detalle de una OC: primero la caché pública, si no MP (y queda guardado). */
async function detalleOC(codigo: string): Promise<OrdenCompraAPI | null> {
  const [[c]] = await pool.query('SELECT raw_json FROM mp_oc_publica WHERE codigo = ?', [codigo]) as any;
  if (c) { try { return JSON.parse(c.raw_json); } catch { /* corrupto: se vuelve a pedir */ } }
  await asegurarCupoMp();
  const oc = await getMercadoPublicoClient().obtenerOrdenCompra(codigo);
  await dormir(PAUSA_MS);
  if (oc) await pool.query('INSERT INTO mp_oc_publica (codigo, proveedor_rut, raw_json) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE raw_json = VALUES(raw_json), proveedor_rut = VALUES(proveedor_rut), fetched_at = NOW()',
    [codigo, String(oc.Proveedor?.RutSucursal || '').slice(0, 20) || null, JSON.stringify(oc)]).catch(() => {});
  return oc;
}

/** Líneas adjudicadas de una licitación: la caché pública de adjudicación si ya está adjudicada; si no, MP (y se guarda). */
async function lineasAdjudicadas(codigo: string) {
  const c = await leerCache(codigo);
  if (c?.row?.es_adjudicada) return respuestaDesdeCache(codigo, c.row).lineasAdjudicadas;
  await asegurarCupoMp();
  const r = await consultarMP(codigo);
  await dormir(PAUSA_MS);
  if (!r) return [];
  if (r.esAdjudicada) await guardarCache(codigo, r);
  return r.lineasAdjudicadas;
}

const MARCA_PROGRESO_MS = 20_000;

/** Avanza el cursor por pasos. Devuelve true si terminó (LISTO o ERROR ya guardado). */
async function avanzar(clienteId: number, c: CursorEval, hasta: number): Promise<boolean> {
  const mp = getMercadoPublicoClient();
  let marca = 0;
  const latido = async () => { if (Date.now() - marca > MARCA_PROGRESO_MS) { marca = Date.now(); await guardarEstado(clienteId, 'EN_CURSO', progresoDe(c), { cursor: c }); } };
  const queda = () => Date.now() < hasta;

  // 1-2. Por cada RUT: su código de proveedor y el barrido de OC hacia atrás.
  for (const r of c.ruts) {
    if (r.listo) continue;
    if (r.codigo === undefined) {
      const prov = await mp.buscarProveedorPorRut(r.rut); // lanza (TopeClienteError incluido)
      await dormir(PAUSA_MS);
      r.codigo = prov?.codigo ?? null; r.nombre = prov?.nombre ?? '';
      // Se guarda en la razón social: después sirve para traer sus OC directo (ordenes-compra.ts).
      if (prov && r.empresaId) await pool.query(
        `UPDATE empresas SET mp_codigo_proveedor = ? WHERE id = ? AND cliente_id = ? AND (mp_codigo_proveedor IS NULL OR mp_codigo_proveedor = '')`,
        [prov.codigo, r.empresaId, clienteId]).catch(() => {});
      if (!prov) { r.listo = true; continue; }
    }
    while (r.dias < MAX_DIAS && r.encontradas < OBJETIVO_OC) {
      if (!queda()) return false;
      try {
        for (const cod of await ocDelDia(r.codigo!, r.dias)) if (!c.oc.includes(cod)) { c.oc.push(cod); r.encontradas++; }
      } catch (e) {
        if (e instanceof TopeClienteError) throw e;
        /* un día que falló se salta: no vale la pena frenar por uno */
      }
      r.dias++;
      await latido();
    }
    r.listo = true;
  }
  if (c.ruts.every(r => r.codigo === null)) {
    await guardarEstado(clienteId, 'ERROR', `Mercado Público no tiene un proveedor con RUT ${c.ruts.map(r => r.rut).join(', ')}`, { cursor: null });
    return true;
  }
  if (!c.oc.length) {
    await guardarEstado(clienteId, 'ERROR', `Sin órdenes de compra en los últimos ${Math.max(...c.ruts.map(r => r.dias))} días`, { cursor: null });
    return true;
  }

  // 3. Detalle de cada OC.
  for (; c.ocIdx < c.oc.length; c.ocIdx++) {
    if (!queda()) return false;
    const oc: any = await detalleOC(c.oc[c.ocIdx]);
    await latido();
    if (!oc) continue;
    if (Number(oc.Total) > 0) c.totales.push(Number(oc.Total));
    if (oc.CodigoLicitacion && !c.licitaciones.includes(String(oc.CodigoLicitacion))) c.licitaciones.push(String(oc.CodigoLicitacion));
    const org = oc.Comprador?.NombreOrganismo; if (org) c.compradores[org] = (c.compradores[org] || 0) + 1;
    const reg = oc.Comprador?.RegionUnidad; if (reg) c.regiones[reg] = (c.regiones[reg] || 0) + 1;
    for (const it of oc.Items?.Listado || [])
      c.lineas.push({ producto: String(it.Producto || ''), categoria: String(it.Categoria || ''), detalle: String(it.EspecificacionProveedor || it.EspecificacionComprador || '').slice(0, 160), monto: Number(it.Total) || 0, origen: 'OC' });
  }

  // 4. Actas: líneas adjudicadas a CUALQUIERA de sus RUT en cada licitación de origen.
  const susRuts = new Set(c.ruts.map(r => rutPlano(r.rut)));
  for (; c.licIdx < c.licitaciones.length; c.licIdx++) {
    if (!queda()) return false;
    const ganadas = (await lineasAdjudicadas(c.licitaciones[c.licIdx])).filter(l => susRuts.has(rutPlano(l.rutProveedor || '')));
    await latido();
    if (ganadas.length) c.actas++;
    for (const l of ganadas)
      c.lineas.push({ producto: String(l.producto || ''), categoria: '', detalle: String(l.descripcion || '').slice(0, 160), monto: (Number(l.montoUnitario) || 0) * (Number(l.cantidad) || 1), origen: 'ACTA' });
  }

  // 5. IA (Kimi): sugerencias para que el admin de la empresa elija al configurar su empresa. NO se aplica nada aquí.
  await guardarEstado(clienteId, 'EN_CURSO', progresoDe(c), { cursor: c });
  const top = (m: Record<string, number>, n: number) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} (${v})`);
  const totales = [...c.totales].sort((a, b) => a - b);
  const lista = c.lineas.slice(0, 400).map(l => `- [${l.origen}] ${l.producto} | ${l.categoria.split(' / ').slice(-1)[0]} | ${l.detalle}`).join('\n');
  const nombre = c.ruts.map(r => r.nombre).filter(Boolean).join(' / ') || c.ruts[0].rut;
  const propuesta = await proponerConIA(nombre, lista, top(c.compradores, 10), top(c.regiones, 8));
  const p10 = totales[Math.floor(totales.length * 0.1)] ?? null, p90 = totales[Math.floor(totales.length * 0.9)] ?? null;
  const regionesTop = Object.entries(c.regiones).sort((a, b) => b[1] - a[1]).map(([k]) => k.trim());
  const dias = Math.max(...c.ruts.map(r => r.dias));
  await guardarEstado(clienteId, 'LISTO', `${c.oc.length} OC en ${dias} días y ${c.actas} actas con líneas ganadas (${c.ruts.length} RUT)`, {
    cursor: null,
    resultado: {
      rut: c.ruts[0].rut, ruts: c.ruts.map(r => ({ rut: r.rut, codigoProveedor: r.codigo ?? null, nombreMP: r.nombre || null, ordenes: r.encontradas, dias: r.dias })),
      codigoProveedor: c.ruts[0].codigo ?? null, nombreMP: nombre, diasRevisados: dias, ordenes: c.oc.length, licitaciones: c.licitaciones.length, actasConLineasGanadas: c.actas,
      lineas: c.lineas.length, montoTipico: { p10, p90 }, compradores: top(c.compradores, 10), regiones: top(c.regiones, 8), modelo: propuesta.modelo,
      sugeridas: propuesta.sugeridas, posibles: propuesta.posibles, negativas: propuesta.negativas, resumen: propuesta.resumen,
      // Las regiones del perfil BAJAN el nivel de las licitaciones de otras regiones (viabilidad por empresa): no se precargan con las
      // que alguna vez compraron (una sola venta en una región la dejaría como la única). Quedan vacías = todo Chile; el admin las elige.
      // El historial se muestra aparte en `regiones` (compradores por región).
      perfil: { ...propuesta.perfil, monto_min: p10, monto_max: p90, regiones: '' },
      regionesHistorial: regionesTop,
    },
  });
  return true;
}

async function proponerConIA(nombre: string, lista: string, compradores: string[], regiones: string[]) {
  if (!iaTextoConfigurada()) throw new Error('La IA no está disponible');
  const sistema = 'Eres experto en compras públicas de Chile (Mercado Público). A partir de lo que una empresa YA vendió al Estado, le recomiendas ' +
    'las palabras clave con que su radar debe encontrar licitaciones nuevas y el perfil con que la IA juzgará si le conviene postular. Responde SOLO un objeto JSON.';
  const usuario =
`EMPRESA: ${nombre}
LO QUE VENDIÓ (órdenes de compra [OC] y líneas que ganó en actas de adjudicación [ACTA]; formato: producto | categoría ONU | especificación):
${lista}

Principales compradores: ${compradores.join('; ') || '—'}
Regiones de los compradores: ${regiones.join('; ') || '—'}

Devuelve: {"resumen":"2-3 frases: qué vende, a quién y qué se repite más","sugeridas":["..."],"posibles":[{"rubro":"...","palabras":["..."]}],"negativas":["..."],"perfil":{"descripcion":"2-3 frases de qué vende","rubros":"rubros separados por coma","productos_si":"productos/servicios que SÍ vende, separados por coma","productos_no":"lo que claramente NO vende y podría confundirse","reglas":"0-2 reglas útiles para decidir si postular, sacadas de los datos (p. ej. tipo de comprador); vacío si no hay"}}
Reglas de palabras: términos de 1 a 3 palabras, en minúscula y singular, como aparecen en los NOMBRES de licitaciones ("mobiliario escolar", "camilla", "horno"); ni marcas ni modelos; nada tan genérico que traiga de todo ("sistema", "equipos", "adquisición", "insumos", "placa", "carro").
- "sugeridas" (15 a 25): las MEJORES, de lo que más se repite y más vende; son las que recomiendas activar ya.
- "posibles" (40 a 80 en total, agrupadas por rubro): TODAS las razonables para ampliar el radar dentro de sus mismos rubros, incluidas sinónimos y productos vecinos que una empresa así también vende (p. ej. si vende hornos: "horno convector", "cocina industrial"). No repitas las sugeridas.
- "negativas" (5 a 15): términos que aparecerían junto a sus palabras pero son de otro rubro (p. ej. "arriendo", "mantención", "obra civil" si solo vende productos).
No inventes rubros que no estén en la lista.`;
  const resp: any = await conModuloIA('otros', async () => crearChatIA({
    model: MODELO_TEXTO, temperature: 0.3,
    messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }],
  }, { proveedorPreferido: 'kimi_rapido', timeoutMs: 240_000 }))();
  const txt = String(resp?.choices?.[0]?.message?.content ?? '').replace(/```json|```/gi, '');
  const raw = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
  const limpiar = (v: unknown, n: number) => [...new Set((Array.isArray(v) ? v : []).map(x => String(x).toLowerCase().trim()).filter(x => x.length >= 3 && x.length <= 60))].slice(0, n);
  // La IA igual cuela palabras sueltas que traen de todo (probado con Comercial MP: «sistema», «placa», «carro») y plurales repetidos.
  const filtrar = (l: string[]) => l.filter((k, _, todas) => !GENERICAS.has(k) && !(k.endsWith('s') && todas.includes(k.replace(/e?s$/, ''))));
  const sugeridas = filtrar(limpiar(raw.sugeridas, 25));
  const vistas = new Set(sugeridas);
  const posibles = (Array.isArray(raw.posibles) ? raw.posibles : []).slice(0, 12).map((g: any) => ({
    rubro: String(g?.rubro || 'Otros').trim(),
    palabras: filtrar(limpiar(g?.palabras, 30)).filter(k => !vistas.has(k) && (vistas.add(k), true)),
  })).filter((g: { palabras: string[] }) => g.palabras.length);
  const p = raw.perfil || {};
  return {
    modelo: String(resp?.model || ''), resumen: String(raw.resumen || ''), sugeridas, posibles, negativas: limpiar(raw.negativas, 15),
    perfil: { descripcion: String(p.descripcion || ''), rubros: String(p.rubros || ''), productos_si: String(p.productos_si || ''), productos_no: String(p.productos_no || ''), reglas: String(p.reglas || '') },
  };
}
