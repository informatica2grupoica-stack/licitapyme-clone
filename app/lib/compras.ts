// app/lib/compras.ts
// MÓDULO DE COMPRAS — Fase 1: esqueleto de entrada (spec "ESPECIFICACIÓN FUNCIONAL — MÓDULO DE
// COMPRAS v2.0", sep-2026, §3-§5). Cuando el negocio pasa a ADJUDICADA (GANADO), este módulo:
//   1) abre una asignación con plazo de 3h hábiles para que el jefe de ventas designe un encargado
//      de Compras, con fallback automático al de menor carga si vence el plazo (§3.3);
//   2) marca la Cadena de Urgencia si el plazo de entrega ofertado es acotado (§3.7);
//   3) arma el Resumen Ejecutivo — de solo lectura, congelado al abrirse (§4);
//   4) siembra las tareas de Validación y Administrativas del catálogo enunciativo (§5).
//
// QUÉ NO ES ESTE ARCHIVO: no duplica el circuito de "Entrega de Proyectos" (Frente F.1,
// app/lib/entrega-proyecto.ts) — ese resuelve "quién debe acusar recibo de que ganamos". Compras
// resuelve "quién ejecuta la compra y con qué tareas". `construirResumenEjecutivo()` de
// entrega-proyecto.ts se REUSA como base del Resumen Ejecutivo (mismo dato, una sola fuente) y acá
// solo se le suman los campos propios de Compras (presupuesto, boleta/contrato exigidos, plazo de
// aceptación de OC, margen previsto) — ver ResumenEjecutivoCompras más abajo.
//
// SIN FERIADOS: "hábil" acá es Lunes-Viernes, sin calendario de feriados chilenos (simplificación
// explícita de Fase 1 — el peor caso es una tarea que aparece con un día de margen de más).
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';
import { permisosDeUsuario } from '@/app/lib/api-auth';
import { construirResumenEjecutivo, type ResumenEjecutivo } from '@/app/lib/entrega-proyecto';
import { obtenerContactosCliente } from '@/app/lib/congelamiento';
import { enviarAvisoComprasGanado } from '@/app/lib/email';

// ── Aritmética de fechas "de pared" (sin reinterpretar zona horaria) ───────────────────────────
// Se trabaja con Date "flotantes": los componentes de la hora de Chile (que ya vienen como texto de
// ahoraChileSQL()/columnas DATETIME) se cargan en un Date vía Date.UTC(), y se leen de vuelta con
// los getters UTC*. Nunca se usa el reloj real ni Intl acá adentro: es aritmética de calendario
// pura, no conversión de zona.
function parsearFechaPared(s: string): Date {
  const [fecha, hora] = String(s).replace('T', ' ').slice(0, 19).split(' ');
  const [y, mo, d] = fecha.split('-').map(Number);
  const [h, mi, se] = (hora || '00:00:00').split(':').map(Number);
  return new Date(Date.UTC(y, (mo || 1) - 1, d || 1, h || 0, mi || 0, se || 0));
}

function aTextoFechaPared(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

const HORA_INICIO_JORNADA = 9;
const HORA_FIN_JORNADA = 18;

function esDiaHabil(d: Date): boolean {
  const dow = d.getUTCDay(); // 0 domingo … 6 sábado
  return dow >= 1 && dow <= 5;
}

function alProximoInicioDeJornada(d: Date): Date {
  if (esDiaHabil(d) && d.getUTCHours() < HORA_INICIO_JORNADA) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), HORA_INICIO_JORNADA, 0, 0));
  }
  if (esDiaHabil(d) && d.getUTCHours() >= HORA_INICIO_JORNADA && d.getUTCHours() < HORA_FIN_JORNADA) return d;
  let x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, HORA_INICIO_JORNADA, 0, 0));
  while (!esDiaHabil(x)) x = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate() + 1, HORA_INICIO_JORNADA, 0, 0));
  return x;
}

/** Suma horas HÁBILES (Lun-Vie, 09:00-18:00) a una fecha de pared. Usado por el SLA de asignación (§3.3). */
export function sumarHorasHabiles(inicio: Date, horas: number): Date {
  let d = alProximoInicioDeJornada(inicio);
  let restante = horas;
  while (restante > 0) {
    const finJornada = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), HORA_FIN_JORNADA, 0, 0));
    const disponibleHoy = (finJornada.getTime() - d.getTime()) / 3_600_000;
    if (restante <= disponibleHoy) { d = new Date(d.getTime() + restante * 3_600_000); restante = 0; }
    else {
      restante -= disponibleHoy;
      d = alProximoInicioDeJornada(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, HORA_INICIO_JORNADA, 0, 0)));
    }
  }
  return d;
}

/** Suma días HÁBILES (Lun-Vie, cuenta días completos) a una fecha de pared. Usado por plazos de tareas. */
export function sumarDiasHabiles(inicio: Date, dias: number): Date {
  let d = new Date(inicio);
  let restantes = dias;
  while (restantes > 0) {
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, d.getUTCHours(), d.getUTCMinutes(), 0));
    if (esDiaHabil(d)) restantes--;
  }
  return d;
}

/** Suma días CORRIDOS a una fecha de pared. */
export function sumarDiasCorridos(inicio: Date, dias: number): Date {
  return new Date(inicio.getTime() + dias * 86_400_000);
}

// ── Resumen Ejecutivo extendido (§4) ────────────────────────────────────────────────────────────
export interface ResumenEjecutivoCompras extends ResumenEjecutivo {
  presupuestoProyecto: number | null;
  fechaCierreLicitacion: string | null;
  plazoEntregaOfertado: string | null;       // texto, ej. "45 días corridos — Entrega en bodega del cliente"
  plazoEntregaDias: number | null;           // el mismo dato, en crudo (alimenta la Cadena de Urgencia)
  hitoInicioPlazo: string | null;            // desde cuándo corre el plazo (emisión OC, aceptación OC, firma contrato, decreto)
  requiereBoletaFielCumplimiento: boolean;
  requiereFirmaContrato: boolean;
  plazoAceptacionOC: string;
  existeCosteo: boolean;
  montoCosteado: number | null;
  margenPrevisto: number | null;             // % — (precio de venta neto − costo neto) / precio de venta neto
}

/** Lo que el informe de viabilidad sabe de plazos, ya normalizado. Todo puede venir null: una
 *  licitación sin análisis IA, o con un esquema viejo, no debe romper la apertura de Compras. */
export interface PlazosDelInforme {
  plazoEntregaTexto: string | null;   // el de las bases (tope ofertable), tal como lo dice el informe
  plazoEntregaDias: number | null;    // el mismo, en crudo — alimenta la Cadena de Urgencia (§3.7)
  hitoInicioPlazo: string | null;     // desde cuándo corre (§4.2 campo 6)
  plazoAceptacionOC: string | null;   // §4.2 campo 10 — el REAL de estas bases, no el tope legal
}

/**
 * Lee los plazos del informe de viabilidad. DOS ESQUEMAS conviven en la base y hay que soportar
 * los dos: el prompt v3 los guarda bajo `plazos` (con `frontera`, `plazo_entrega_ofertable` y
 * `aceptacion_oc`), mientras que versiones anteriores usaban `linea_tiempo` (con
 * `frontera_inicio_computo` y una lista de `hitos`).
 *
 * BUG REAL (04-sep-2026, 1114-12-LE26): el código solo miraba `linea_tiempo`. Ese informe —como
 * todos los del prompt v3— trae `plazos`, así que el Resumen Ejecutivo salía sin plazo de entrega,
 * sin hito de inicio y con el plazo de aceptación de OC genérico ("tope legal 5 días"), cuando el
 * informe decía textualmente 2 días hábiles desde la emisión de la OC. Tres de los 14 campos
 * obligatorios de §4.2, vacíos por leer la clave equivocada.
 */
export function leerPlazosDelInforme(informe: any): PlazosDelInforme {
  const vacio: PlazosDelInforme = { plazoEntregaTexto: null, plazoEntregaDias: null, hitoInicioPlazo: null, plazoAceptacionOC: null };
  const nucleo = informe?._informe_ia_v3 || informe?._informe_ia || informe;
  if (!nucleo || typeof nucleo !== 'object') return vacio;

  const p = nucleo.plazos;
  const lt = nucleo.linea_tiempo;
  const out: PlazosDelInforme = { ...vacio };

  // Desde cuándo corre el plazo: `plazos.frontera` (v3) o `linea_tiempo.frontera_inicio_computo`.
  const frontera = p?.frontera || lt?.frontera_inicio_computo;
  if (frontera) {
    out.hitoInicioPlazo = [frontera.descripcion, frontera.base_computo].filter(Boolean).join(' — ') || null;
  }

  // Plazo de entrega. En v3 viene ya redactado ("50 días corridos"); si no, se arma del hito de
  // entrega de la línea de tiempo.
  const ofertable = p?.plazo_entrega_ofertable;
  if (ofertable?.valor) {
    out.plazoEntregaTexto = String(ofertable.valor);
    const n = /(\d+)/.exec(String(ofertable.valor));
    if (n) out.plazoEntregaDias = Number(n[1]);
  } else if (ofertable?.duracion != null) {
    out.plazoEntregaDias = Number(ofertable.duracion);
    out.plazoEntregaTexto = `${ofertable.duracion} ${ofertable.unidad || 'días'}`.trim();
  } else {
    const hitos = Array.isArray(p?.hitos) ? p.hitos : Array.isArray(lt?.hitos) ? lt.hitos : [];
    const entrega = hitos.find((h: any) => /entrega/i.test(String(h?.hito || '')));
    if (entrega) {
      const dias = entrega.duracion_dias ?? entrega.duracion_corridos ?? entrega.duracion;
      out.plazoEntregaDias = dias != null ? Number(dias) : null;
      out.plazoEntregaTexto = [
        out.plazoEntregaDias != null ? `${out.plazoEntregaDias} ${entrega.unidad || entrega.tipo_dias || 'días'}`.trim() : null,
        entrega.hito,
      ].filter(Boolean).join(' — ') || null;
    }
  }

  // Plazo para aceptar la OC: el de ESTAS bases si el informe lo identificó.
  const ac = p?.aceptacion_oc;
  if (ac?.duracion != null) {
    out.plazoAceptacionOC = `${ac.duracion} ${ac.unidad || 'días'}`.trim()
      + (ac.inferido ? ' (inferido de las bases)' : '');
  }

  return out;
}

/**
 * Arma el Resumen Ejecutivo de Compras: la base (`construirResumenEjecutivo`, ya usada por Entrega
 * de Proyectos) más los campos propios de Compras. Los campos de bases (boleta/contrato/hito de
 * plazo) salen del informe de viabilidad IA, que YA los extrae (Módulo Plazos del prompt v3) — no
 * se dispara ninguna llamada nueva a IA. Cobertura parcial: si la licitación no tiene ese análisis,
 * el campo queda en null/false y se anota en `faltantes`, nunca se inventa.
 */
export async function construirResumenEjecutivoCompras(
  negocioId: number, licitacionCodigo: string,
): Promise<ResumenEjecutivoCompras> {
  const base = await construirResumenEjecutivo(negocioId, licitacionCodigo);
  const faltantes = [...base.faltantes];

  let presupuestoProyecto: number | null = null;
  let fechaCierreLicitacion: string | null = null;
  try {
    const [rows] = await pool.query(
      `SELECT monto, DATE_FORMAT(fecha_cierre, '%Y-%m-%d %H:%i:%s') AS fecha_cierre
         FROM licitaciones_cache WHERE codigo = ? LIMIT 1`,
      [licitacionCodigo],
    ) as any;
    const f = (rows as any[])[0];
    if (f) {
      presupuestoProyecto = f.monto != null ? Number(f.monto) : null;
      fechaCierreLicitacion = f.fecha_cierre || null;
    }
  } catch (e) {
    console.error('[compras] licitaciones_cache no legible:', String(e).slice(0, 150));
  }

  let requiereBoletaFielCumplimiento = false;
  let requiereFirmaContrato = false;
  let plazos: PlazosDelInforme = { plazoEntregaTexto: null, plazoEntregaDias: null, hitoInicioPlazo: null, plazoAceptacionOC: null };
  try {
    const [rows] = await pool.query(
      `SELECT informe_ejecutivo FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`,
      [licitacionCodigo],
    ) as any;
    const raw = (rows as any[])[0]?.informe_ejecutivo;
    const informe = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    // El esquema v2.1/v3 del PROMPT 2 guarda estos campos en la raíz del informe crudo; según la
    // versión que analizó esta licitación puede venir directo o envuelto en _informe_ia(_v3).
    const nucleo = informe?._informe_ia_v3 || informe?._informe_ia || informe;
    const adm = nucleo?.requisitos_admisibilidad;
    if (adm) {
      requiereBoletaFielCumplimiento = !!(adm.fiel_cumplimiento?.exige ?? adm.boleta?.aplica);
      requiereFirmaContrato = !!adm.contrato?.exige;
    }
    plazos = leerPlazosDelInforme(informe);
    if (presupuestoProyecto == null && nucleo?.presupuesto) {
      presupuestoProyecto = nucleo.presupuesto.bruto ?? nucleo.presupuesto.neto ?? null;
    }
    if (!adm && !nucleo?.plazos && !nucleo?.linea_tiempo) {
      faltantes.push('Sin informe de viabilidad IA con datos de bases: boleta, contrato e inicio del plazo no se pudieron determinar automáticamente.');
    }
  } catch (e) {
    console.error('[compras] informe de viabilidad no legible:', String(e).slice(0, 150));
  }

  // §4.2 campo 5 pide el plazo "declarado en NUESTRA oferta", no el máximo que permitían las bases.
  // Ese es el que el asesor comprometió en el bloque comercial del Auditor Técnico, así que manda
  // ese; el de las bases entra solo como respaldo, y rotulado, para que nadie lo confunda con lo
  // que efectivamente ofertamos.
  const comprometido = (base.plazosComprometidos || []).find(pl => /entrega/i.test(pl.titulo) && (pl.valor || '').trim());
  const plazoEntregaOfertado = comprometido?.valor?.trim()
    || (plazos.plazoEntregaTexto ? `${plazos.plazoEntregaTexto} (tope de las bases — no se registró el plazo ofertado)` : null);
  const plazoEntregaDias = plazos.plazoEntregaDias;
  const hitoInicioPlazo = plazos.hitoInicioPlazo;

  // Plazo para aceptar la OC (§5.2): el de estas bases si el informe lo identificó, si no el legal.
  const plazoAceptacionOC = plazos.plazoAceptacionOC
    ? `${plazos.plazoAceptacionOC} — según las bases de esta licitación.`
    : 'Plazo de las bases; tope legal 5 días corridos si no está declarado.';

  // ── Costeo: el paquete congelado es la foto de la POSTULACIÓN, no del momento de ganar ──────
  // BUG REAL (04-sep-2026, negocio 717): el paquete de 1114-12-LE26 se congeló el 06-ago con
  // `costeo: null` — en ese momento no había costeo cargado. El costeo apareció después y quedó
  // vigente en checklist_comercial_costeo, pero el Resumen Ejecutivo seguía diciendo "sin costeo"
  // y sin margen previsto, que es justo el número del que depende la Compuerta 2 (§10.3, piso del
  // 20%). Si el paquete no lo trae, se busca AHORA en la fuente viva.
  let costeo = base.costeo;
  if (!costeo) {
    try {
      const [rows] = await pool.query(
        `SELECT version, archivo_nombre, total_costo_neto, total_precio_neto
           FROM checklist_comercial_costeo WHERE negocio_id = ? AND vigente = 1 LIMIT 1`,
        [negocioId],
      ) as any;
      const r = (rows as any[])[0];
      if (r) {
        costeo = {
          totalCostoNeto: r.total_costo_neto != null ? Number(r.total_costo_neto) : null,
          totalPrecioNeto: r.total_precio_neto != null ? Number(r.total_precio_neto) : null,
          archivoNombre: r.archivo_nombre, version: r.version,
        };
      }
    } catch (e) {
      console.error('[compras] costeo vigente no legible:', String(e).slice(0, 150));
    }
  }

  // ── Contactos del cliente: mismo caso ────────────────────────────────────────────────────────
  // Si MP estaba caído cuando se congeló el paquete, el hueco quedó ahí. Se vuelve a pedir ahora
  // (§4.2 campo 11: "nombre, teléfono, correo, todo dato disponible") — es la primera tarea del
  // encargado, §5.3, así que llegar sin ese dato es llegar sin poder empezar.
  let contactosCliente = base.contactosCliente;
  if (!contactosCliente) {
    try { contactosCliente = await obtenerContactosCliente(licitacionCodigo); } catch { /* MP caído: queda el faltante */ }
  }

  const existeCosteo = !!costeo;
  const montoCosteado = costeo?.totalCostoNeto ?? null;
  const margenPrevisto = (base.montoNuestro && montoCosteado != null && base.montoNuestro > 0)
    ? Math.round(((base.montoNuestro - montoCosteado) / base.montoNuestro) * 1000) / 10
    : null;
  if (!existeCosteo) faltantes.push('El negocio no tiene costeo registrado: no se puede calcular el margen previsto.');

  // Los faltantes que trae la base se recalculan: el respaldo de arriba puede haberlos resuelto, y
  // dejarlos igual sería avisar de un hueco que ya no existe.
  const faltantesFinales = faltantes.filter(f =>
    !(contactosCliente && /contactos del cliente/i.test(f)) &&
    !(existeCosteo && /costeo/i.test(f)));
  if (!plazoEntregaOfertado) faltantesFinales.push('No se pudo determinar el plazo de entrega: fíjalo a mano en la tarea del reloj de entrega.');

  return {
    ...base, faltantes: faltantesFinales, costeo, contactosCliente,
    presupuestoProyecto, fechaCierreLicitacion,
    plazoEntregaOfertado, plazoEntregaDias, hitoInicioPlazo,
    requiereBoletaFielCumplimiento, requiereFirmaContrato, plazoAceptacionOC,
    existeCosteo, montoCosteado, margenPrevisto,
  };
}

// Cadena de Urgencia (§3.7/§15.2): plazo comprometido menor a 3 días. Simplificación de Fase 1: no
// distingue hábiles/corridos para este umbral — cualquiera de los dos bajo 3 ya es urgente.
function esUrgentePorPlazo(plazoEntregaDias: number | null): boolean {
  return plazoEntregaDias != null && plazoEntregaDias < 3;
}

// ── Apertura (§3) ───────────────────────────────────────────────────────────────────────────────

/**
 * Abre Compras para un negocio recién ganado. IDEMPOTENTE (INSERT IGNORE sobre la PK): si ya
 * estaba abierta no hace nada. Nunca lanza — un fallo acá no debe romper la promoción a ADJUDICADA.
 * Devuelve true solo si la ABRIÓ en esta llamada (para saber si corresponde loguear).
 */
export async function abrirComprasSiCorresponde(
  negocioId: number, licitacionCodigo: string, asignadoOriginal: number | null,
): Promise<boolean> {
  try {
    const [ya] = await pool.query(`SELECT 1 FROM compras_asignacion WHERE negocio_id = ? LIMIT 1`, [negocioId]) as any;
    if ((ya as any[]).length > 0) return false;

    const resumen = await construirResumenEjecutivoCompras(negocioId, licitacionCodigo);
    const ahora = ahoraChileSQL();
    const vencimiento = aTextoFechaPared(sumarHorasHabiles(parsearFechaPared(ahora), 3));
    const urgente = esUrgentePorPlazo(resumen.plazoEntregaDias);

    const [r] = await pool.query(
      `INSERT IGNORE INTO compras_asignacion
         (negocio_id, licitacion_codigo, ganado_at, vencimiento_asignacion_at, urgente, resumen_json, resumen_generado_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [negocioId, licitacionCodigo, ahora, vencimiento, urgente ? 1 : 0, JSON.stringify(resumen), ahora, ahora],
    ) as any;
    if (!r?.affectedRows) return false; // otra corrida la abrió primero

    await notificarProyectoGanadoCompras(negocioId, licitacionCodigo, resumen.licitacionNombre, asignadoOriginal, urgente, {
      organismo: resumen.organismo, monto: resumen.montoNuestro,
      plazoEntrega: resumen.plazoEntregaOfertado, vencimientoAsignacion: vencimiento,
    });

    console.log(`[compras] abierta para negocio ${negocioId} (${licitacionCodigo})${urgente ? ' · URGENTE' : ''}` +
      (resumen.faltantes.length ? ` · ${resumen.faltantes.length} faltante(s) en el resumen` : ''));
    return true;
  } catch (e) {
    console.error('[compras] abrir compras falló (no bloquea la adjudicación):', String(e).slice(0, 300));
    return false;
  }
}

/**
 * Quién debe enterarse de que hay un proyecto nuevo esperando encargado de Compras: el asistente
 * comercial que lo trabajó, todos los admin, y cualquiera con el permiso `aprobar_comercial`
 * ("jefe de ventas" — ya es el permiso de quien aprueba el negocio comercial, no se creó uno nuevo).
 */
async function destinatariosAperturaCompras(asignadoOriginal: number | null): Promise<number[]> {
  const ids = new Set<number>();
  if (asignadoOriginal) ids.add(Number(asignadoOriginal));
  try {
    const [rows] = await pool.query(`SELECT id, rol FROM usuarios WHERE activo = TRUE`) as any;
    for (const u of rows as any[]) {
      if (u.rol === 'admin') { ids.add(Number(u.id)); continue; }
      if (u.rol === 'externo') continue;
      const p = await permisosDeUsuario(Number(u.id), u.rol);
      if (p.aprobar_comercial) ids.add(Number(u.id));
    }
  } catch (e) {
    console.error('[compras] no se pudo resolver destinatarios de apertura:', String(e).slice(0, 150));
  }
  return Array.from(ids);
}

async function notificarProyectoGanadoCompras(
  negocioId: number, licitacionCodigo: string, licitacionNombre: string | null,
  asignadoOriginal: number | null, urgente: boolean,
  datosCorreo: { organismo: string | null; monto: number | null; plazoEntrega: string | null; vencimientoAsignacion: string },
): Promise<void> {
  const destinatarios = await destinatariosAperturaCompras(asignadoOriginal);
  const prefijo = urgente ? '🔴 URGENTE — ' : '🛒 ';
  const mensaje = `${prefijo}Proyecto ganado, entra a Compras: ${licitacionNombre || licitacionCodigo}. Asignar encargado (3h hábiles).`;

  // Correo además de la campana: la spec (§3.2/§22) pide los DOS canales — "se notifica a todos los
  // intervinientes, por sistema y correo". Se resuelve nombre y correo de una sola consulta para no
  // pegarle a la tabla una vez por destinatario.
  let contactos = new Map<number, { nombre: string | null; email: string | null }>();
  if (destinatarios.length) {
    try {
      const [urows] = await pool.query(
        `SELECT id, nombre, email FROM usuarios WHERE id IN (${destinatarios.map(() => '?').join(',')})`,
        destinatarios,
      ) as any;
      contactos = new Map((urows as any[]).map(u => [Number(u.id), { nombre: u.nombre ?? null, email: u.email ?? null }]));
    } catch (e) {
      console.error('[compras] no se pudieron leer los correos de los destinatarios:', String(e).slice(0, 150));
    }
  }

  for (const uid of destinatarios) {
    const contacto = contactos.get(uid);
    try {
      await registrarEvento({
        tipo: 'COMPRAS_PROYECTO_GANADO',
        licitacionCodigo, licitacionNombre,
        usuarioId: uid, usuarioNombre: contacto?.nombre ?? null,
        actorId: null, actorNombre: 'Mercado Público',
        mensaje,
        metadata: { negocio_id: negocioId, licitacion_codigo: licitacionCodigo, urgente, requiere_asignacion: true },
      });
    } catch (e) {
      console.error(`[compras] no se pudo notificar al usuario ${uid}:`, String(e).slice(0, 150));
    }
    // El correo NUNCA bloquea la apertura: si el SMTP está caído, la campana ya avisó y el módulo
    // igual quedó abierto (enviarAvisoComprasGanado devuelve false y sigue).
    if (!contacto?.email) continue;
    try {
      await enviarAvisoComprasGanado({
        to: contacto.email, nombre: contacto.nombre,
        codigo: licitacionCodigo, licitacionNombre, organismo: datosCorreo.organismo, monto: datosCorreo.monto,
        urgente, plazoEntrega: datosCorreo.plazoEntrega,
        vencimientoAsignacion: datosCorreo.vencimientoAsignacion, negocioId,
      });
    } catch (e) {
      console.error(`[compras] no se pudo enviar el correo al usuario ${uid}:`, String(e).slice(0, 150));
    }
  }
}

// ── Asignación (§3.3) ───────────────────────────────────────────────────────────────────────────
export interface CandidatoEncargado { id: number; nombre: string | null; carga: number }

/** Candidatos a Encargado de Compras: admin + cualquiera con el permiso `compras`, con su carga actual. */
export async function candidatosEncargado(): Promise<CandidatoEncargado[]> {
  const [rows] = await pool.query(`SELECT id, nombre, rol FROM usuarios WHERE activo = TRUE`) as any;
  const candidatos: Array<{ id: number; nombre: string | null }> = [];
  for (const u of rows as any[]) {
    if (u.rol === 'externo') continue;
    if (u.rol === 'admin') { candidatos.push({ id: Number(u.id), nombre: u.nombre }); continue; }
    const p = await permisosDeUsuario(Number(u.id), u.rol);
    if (p.compras) candidatos.push({ id: Number(u.id), nombre: u.nombre });
  }
  if (candidatos.length === 0) return [];
  const ids = candidatos.map(c => c.id);
  const ph = ids.map(() => '?').join(',');
  const [cargaRows] = await pool.query(
    `SELECT responsable_id, COUNT(*) AS n FROM compras_tarea WHERE responsable_id IN (${ph}) AND estado <> 'HECHA' GROUP BY responsable_id`,
    ids,
  ) as any;
  const cargaPorId = new Map<number, number>((cargaRows as any[]).map(r => [Number(r.responsable_id), Number(r.n)]));
  return candidatos.map(c => ({ ...c, carga: cargaPorId.get(c.id) || 0 }));
}

/** Asigna (manual o por fallback) un encargado de Compras y le siembra las tareas del catálogo. */
export async function asignarEncargado(
  negocioId: number, encargadoId: number, encargadoNombre: string | null, asignadoPorId: number | null,
): Promise<void> {
  const ahora = ahoraChileSQL();
  const [r] = await pool.query(
    `UPDATE compras_asignacion SET asignado_a = ?, asignado_at = ?, asignado_por = ? WHERE negocio_id = ?`,
    [encargadoId, ahora, asignadoPorId, negocioId],
  ) as any;
  if (!r?.affectedRows) throw new Error('No existe apertura de Compras para este negocio.');

  const [rows] = await pool.query(`SELECT licitacion_codigo FROM compras_asignacion WHERE negocio_id = ? LIMIT 1`, [negocioId]) as any;
  const licitacionCodigo = (rows as any[])[0]?.licitacion_codigo || null;

  await crearTareasCatalogoSiCorresponde(negocioId, encargadoId, encargadoNombre);

  await registrarEvento({
    tipo: 'COMPRAS_ASIGNADO',
    licitacionCodigo, usuarioId: encargadoId, usuarioNombre: encargadoNombre,
    actorId: asignadoPorId, actorNombre: asignadoPorId == null ? 'Sistema (fallback automático)' : null,
    mensaje: `Se te asignó Compras de ${licitacionCodigo}${asignadoPorId == null ? ' (asignación automática por carga)' : ''}.`,
    metadata: { negocio_id: negocioId, automatico: asignadoPorId == null },
  });
}

async function crearTareasCatalogoSiCorresponde(
  negocioId: number, responsableId: number, responsableNombre: string | null,
): Promise<void> {
  const [ya] = await pool.query(`SELECT 1 FROM compras_tarea WHERE negocio_id = ? LIMIT 1`, [negocioId]) as any;
  if ((ya as any[]).length > 0) {
    // No reasignables hoy (§5.1: "hay una sola persona encargada") — solo se completa el
    // responsable de tareas que por algún motivo hubieran quedado sin nadie.
    await pool.query(
      `UPDATE compras_tarea SET responsable_id = ?, responsable_nombre = ? WHERE negocio_id = ? AND responsable_id IS NULL`,
      [responsableId, responsableNombre, negocioId],
    );
    return;
  }

  const [asigRows] = await pool.query(
    `SELECT DATE_FORMAT(ganado_at, '%Y-%m-%d %H:%i:%s') AS ganado_at, resumen_json
       FROM compras_asignacion WHERE negocio_id = ? LIMIT 1`,
    [negocioId],
  ) as any;
  const asig = (asigRows as any[])[0];
  if (!asig) return;
  let resumen: ResumenEjecutivoCompras | null = null;
  try { resumen = JSON.parse(asig.resumen_json); } catch { /* se sigue sin el resumen: no bloquea */ }

  const [catalogo] = await pool.query(
    `SELECT clave, categoria, titulo, descripcion, plazo_dias, plazo_tipo, orden
       FROM compras_tarea_catalogo WHERE activo = TRUE ORDER BY orden`,
  ) as any;

  const ganadoAt = parsearFechaPared(asig.ganado_at);
  const ahora = ahoraChileSQL();
  const filas: unknown[][] = [];
  for (const c of catalogo as any[]) {
    // Boleta y contrato solo se crean si el Resumen Ejecutivo los marca como exigidos.
    if (c.clave === 'boleta_fiel_cumplimiento' && resumen && !resumen.requiereBoletaFielCumplimiento) continue;
    if (c.clave === 'firma_contrato' && resumen && !resumen.requiereFirmaContrato) continue;

    const plazoAt = c.plazo_dias == null ? null
      : aTextoFechaPared(c.plazo_tipo === 'CORRIDOS' ? sumarDiasCorridos(ganadoAt, c.plazo_dias) : sumarDiasHabiles(ganadoAt, c.plazo_dias));

    filas.push([negocioId, c.clave, c.categoria, c.titulo, c.descripcion, 'PENDIENTE',
      responsableId, responsableNombre, plazoAt, ahora, 0, null, c.orden]);
  }
  if (filas.length === 0) return;
  const ph = filas.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
  await pool.query(
    `INSERT INTO compras_tarea
       (negocio_id, catalogo_clave, categoria, titulo, descripcion, estado,
        responsable_id, responsable_nombre, plazo_at, creado_at, es_manual, creado_por, orden)
     VALUES ${ph}`,
    filas.flat(),
  );
}

/**
 * Barrido del fallback automático (§3.3): asignaciones sin encargado cuyo plazo de 3h hábiles ya
 * venció. Pensado para un cron frecuente (cada 15-30 min). Nunca lanza por negocio: un fallo en uno
 * no debe frenar el resto del barrido.
 */
export interface ResumenFallbackAsignacion { revisadas: number; asignadas: number }

export async function asignacionAutomaticaFallback(): Promise<ResumenFallbackAsignacion> {
  const resumen: ResumenFallbackAsignacion = { revisadas: 0, asignadas: 0 };
  const ahora = ahoraChileSQL();
  const [rows] = await pool.query(
    `SELECT negocio_id FROM compras_asignacion WHERE asignado_a IS NULL AND vencimiento_asignacion_at <= ?`,
    [ahora],
  ) as any;
  const pendientes = rows as Array<{ negocio_id: number }>;
  resumen.revisadas = pendientes.length;

  for (const p of pendientes) {
    try {
      const candidatos = await candidatosEncargado();
      if (candidatos.length === 0) {
        console.warn(`[compras] fallback: ningún usuario con permiso 'compras' — no se pudo asignar negocio ${p.negocio_id}`);
        continue;
      }
      candidatos.sort((a, b) => a.carga - b.carga);
      const elegido = candidatos[0];
      await asignarEncargado(p.negocio_id, elegido.id, elegido.nombre, null);
      resumen.asignadas++;
    } catch (e) {
      console.error(`[compras] fallback de asignación falló para negocio ${p.negocio_id}:`, String(e).slice(0, 200));
    }
  }
  return resumen;
}

// ── Lectura para pantalla ───────────────────────────────────────────────────────────────────────
/** Orden de compra DEL CLIENTE (§3.6). No es la OC que nosotros le emitimos al proveedor (esa vive
 *  en OBUMA, §11.1): es la que el organismo emite a nuestro favor en Mercado Público. Manda sobre
 *  lo ofertado — "si el monto o alcance adjudicado difiere de lo ofertado, manda siempre la orden
 *  de compra" — por eso se guarda su monto y la marca de que difiere, no solo el número. */
export interface OrdenCompraCliente {
  numero: string | null;
  emitidaAt: string | null;      // fecha de emisión (YYYY-MM-DD)
  aceptadaAt: string | null;     // fecha en que el EM la aceptó en el portal
  monto: number | null;          // total CON IVA — es lo que muestra el portal
  totalNeto: number | null;      // el neto, que es lo comparable contra lo adjudicado
  difiere: boolean;              // el alcance/monto no calza con lo ofertado
  observacion: string | null;
  registradaPorNombre: string | null;
  actualizadaAt: string | null;
  // De dónde salió: 'mp' = la trajo el sistema solo desde Mercado Público · 'manual' = la tipeó
  // alguien · null = todavía no hay OC.
  origen: 'mp' | 'manual' | null;
  codigoMp: string | null;       // código de la orden en MP — la llave contra `ordenes_compra`
  estadoMp: string | null;       // Enviada a proveedor · Aceptada · Cancelada…
  vinculadaAt: string | null;
}

export interface AsignacionCompras {
  negocioId: number; licitacionCodigo: string;
  ganadoAt: string; vencimientoAsignacionAt: string; urgente: boolean;
  asignadoA: number | null; asignadoNombre: string | null; asignadoAt: string | null; asignadoPor: number | null;
  resumen: ResumenEjecutivoCompras | null;
  ordenCompra: OrdenCompraCliente;
}

export async function obtenerAsignacion(negocioId: number): Promise<AsignacionCompras | null> {
  const [rows] = await pool.query(
    `SELECT ca.negocio_id, ca.licitacion_codigo, ca.urgente, ca.asignado_a, ca.asignado_por, ca.resumen_json,
            DATE_FORMAT(ca.ganado_at, '%Y-%m-%d %H:%i:%s') AS ganado_at,
            DATE_FORMAT(ca.vencimiento_asignacion_at, '%Y-%m-%d %H:%i:%s') AS vencimiento_asignacion_at,
            DATE_FORMAT(ca.asignado_at, '%Y-%m-%d %H:%i:%s') AS asignado_at,
            ca.oc_numero, ca.oc_monto, ca.oc_difiere, ca.oc_observacion, ca.oc_registrada_por_nombre,
            ca.oc_origen, ca.oc_codigo_mp, ca.oc_estado_mp, ca.oc_total_neto,
            DATE_FORMAT(ca.oc_vinculada_at, '%Y-%m-%d %H:%i:%s') AS oc_vinculada_at,
            DATE_FORMAT(ca.oc_emitida_at, '%Y-%m-%d') AS oc_emitida_at,
            DATE_FORMAT(ca.oc_aceptada_at, '%Y-%m-%d') AS oc_aceptada_at,
            DATE_FORMAT(ca.oc_actualizada_at, '%Y-%m-%d %H:%i:%s') AS oc_actualizada_at,
            u.nombre AS asignado_nombre
       FROM compras_asignacion ca LEFT JOIN usuarios u ON u.id = ca.asignado_a
      WHERE ca.negocio_id = ? LIMIT 1`,
    [negocioId],
  ) as any;
  const r = (rows as any[])[0];
  if (!r) return null;
  let resumen: ResumenEjecutivoCompras | null = null;
  try { resumen = JSON.parse(r.resumen_json); } catch { /* se muestra sin resumen antes que romper */ }
  return {
    negocioId: r.negocio_id, licitacionCodigo: r.licitacion_codigo,
    ganadoAt: r.ganado_at, vencimientoAsignacionAt: r.vencimiento_asignacion_at, urgente: !!r.urgente,
    asignadoA: r.asignado_a, asignadoNombre: r.asignado_nombre, asignadoAt: r.asignado_at, asignadoPor: r.asignado_por,
    resumen,
    ordenCompra: {
      numero: r.oc_numero ?? null,
      emitidaAt: r.oc_emitida_at ?? null,
      aceptadaAt: r.oc_aceptada_at ?? null,
      monto: r.oc_monto == null ? null : Number(r.oc_monto),
      totalNeto: r.oc_total_neto == null ? null : Number(r.oc_total_neto),
      difiere: !!r.oc_difiere,
      observacion: r.oc_observacion ?? null,
      registradaPorNombre: r.oc_registrada_por_nombre ?? null,
      actualizadaAt: r.oc_actualizada_at ?? null,
      origen: (r.oc_origen as 'mp' | 'manual' | null) ?? null,
      codigoMp: r.oc_codigo_mp ?? null,
      estadoMp: r.oc_estado_mp ?? null,
      vinculadaAt: r.oc_vinculada_at ?? null,
    },
  };
}

export interface ComprasFila {
  negocioId: number; licitacionCodigo: string; licitacionNombre: string | null; licitacionOrganismo: string | null;
  urgente: boolean; asignadoA: number | null; asignadoNombre: string | null; asignadoAt: string | null;
  vencimientoAsignacionAt: string; ganadoAt: string; montoNuestro: number | null;
  tareasTotal: number; tareasHechas: number; tareasVencidas: number;
}

/** Listado transversal (pantalla /compras): una fila por negocio con asignación y avance de tareas. */
export async function listarAsignacionesCompras(): Promise<ComprasFila[]> {
  const ahora = ahoraChileSQL();
  const [rows] = await pool.query(
    `SELECT ca.negocio_id, ca.licitacion_codigo, ca.urgente, ca.asignado_a, ca.resumen_json,
            DATE_FORMAT(ca.ganado_at, '%Y-%m-%d %H:%i:%s') AS ganado_at,
            DATE_FORMAT(ca.vencimiento_asignacion_at, '%Y-%m-%d %H:%i:%s') AS vencimiento_asignacion_at,
            DATE_FORMAT(ca.asignado_at, '%Y-%m-%d %H:%i:%s') AS asignado_at,
            n.licitacion_nombre, n.licitacion_organismo, u.nombre AS asignado_nombre,
            (SELECT COUNT(*) FROM compras_tarea t WHERE t.negocio_id = ca.negocio_id) AS tareas_total,
            (SELECT COUNT(*) FROM compras_tarea t WHERE t.negocio_id = ca.negocio_id AND t.estado = 'HECHA') AS tareas_hechas,
            (SELECT COUNT(*) FROM compras_tarea t WHERE t.negocio_id = ca.negocio_id AND t.estado <> 'HECHA' AND t.plazo_at IS NOT NULL AND t.plazo_at < ?) AS tareas_vencidas
       FROM compras_asignacion ca
       JOIN negocios n ON n.id = ca.negocio_id
       LEFT JOIN usuarios u ON u.id = ca.asignado_a
      ORDER BY ca.urgente DESC, ca.ganado_at DESC`,
    [ahora],
  ) as any;
  return (rows as any[]).map(r => {
    let montoNuestro: number | null = null;
    try { montoNuestro = JSON.parse(r.resumen_json)?.montoNuestro ?? null; } catch { /* fila sin monto legible */ }
    return {
      negocioId: r.negocio_id, licitacionCodigo: r.licitacion_codigo,
      licitacionNombre: r.licitacion_nombre, licitacionOrganismo: r.licitacion_organismo,
      urgente: !!r.urgente, asignadoA: r.asignado_a, asignadoNombre: r.asignado_nombre, asignadoAt: r.asignado_at,
      vencimientoAsignacionAt: r.vencimiento_asignacion_at, ganadoAt: r.ganado_at, montoNuestro,
      tareasTotal: Number(r.tareas_total), tareasHechas: Number(r.tareas_hechas), tareasVencidas: Number(r.tareas_vencidas),
    };
  });
}

// ── Tareas (§5) ─────────────────────────────────────────────────────────────────────────────────
export type EstadoTarea = 'PENDIENTE' | 'EN_CURSO' | 'HECHA';

/** Un campo del formulario de registro de una tarea. Vive en `compras_tarea_catalogo.campos_json`,
 *  no en el código (§1.3.5: los catálogos son configuración editable, no listas cerradas): agregar
 *  una pregunta al cuestionario del vendedor es un UPDATE, no un deploy. */
export interface CampoRegistroTarea {
  clave: string;
  etiqueta: string;
  tipo: 'texto' | 'parrafo' | 'si_no';
  placeholder?: string;
}

export interface TareaCompras {
  id: number; catalogoClave: string | null; categoria: string; titulo: string; descripcion: string | null;
  estado: EstadoTarea; responsableId: number | null; responsableNombre: string | null;
  plazoAt: string | null; creadoAt: string; primerContactoAt: string | null;
  cerradoAt: string | null; cerradoPorNombre: string | null; notaCierre: string | null;
  esManual: boolean; vencida: boolean;
  // Qué se hizo en la tarea (§5.3/§5.4): las preguntas vienen del catálogo, las respuestas quedan
  // en la instancia. `hallazgo` = se ejecutó, pero lo que se encontró NO es lo esperado.
  campos: CampoRegistroTarea[];
  registro: Record<string, string> | null;
  registroAt: string | null;
  hallazgo: boolean;
}

/** Los campos declarados por el catálogo, tolerando basura: una tarea con el JSON mal escrito se
 *  muestra sin formulario antes que romper la pantalla entera de Compras. */
export function parsearCamposCatalogo(json: string | null): CampoRegistroTarea[] {
  if (!json) return [];
  try {
    const d = JSON.parse(json);
    const campos = Array.isArray(d) ? d : d?.campos;
    if (!Array.isArray(campos)) return [];
    return campos
      .filter((c: any) => c && typeof c.clave === 'string' && typeof c.etiqueta === 'string')
      .map((c: any) => ({
        clave: c.clave,
        etiqueta: c.etiqueta,
        tipo: c.tipo === 'parrafo' || c.tipo === 'si_no' ? c.tipo : 'texto',
        placeholder: typeof c.placeholder === 'string' ? c.placeholder : undefined,
      }));
  } catch { return []; }
}

export async function listarTareas(negocioId: number): Promise<TareaCompras[]> {
  const ahora = ahoraChileSQL();
  const [rows] = await pool.query(
    `SELECT t.id, t.catalogo_clave, t.categoria, t.titulo, t.descripcion, t.estado,
            t.responsable_id, t.responsable_nombre,
            DATE_FORMAT(t.plazo_at, '%Y-%m-%d %H:%i:%s') AS plazo_at,
            DATE_FORMAT(t.creado_at, '%Y-%m-%d %H:%i:%s') AS creado_at,
            DATE_FORMAT(t.primer_contacto_at, '%Y-%m-%d %H:%i:%s') AS primer_contacto_at,
            DATE_FORMAT(t.cerrado_at, '%Y-%m-%d %H:%i:%s') AS cerrado_at,
            DATE_FORMAT(t.registro_at, '%Y-%m-%d %H:%i:%s') AS registro_at,
            t.cerrado_por_nombre, t.nota_cierre, t.es_manual, t.registro_json, t.hallazgo,
            c.campos_json
       FROM compras_tarea t
       LEFT JOIN compras_tarea_catalogo c ON c.clave = t.catalogo_clave
      WHERE t.negocio_id = ? ORDER BY t.orden, t.id`,
    [negocioId],
  ) as any;
  return (rows as any[]).map(r => ({
    id: r.id, catalogoClave: r.catalogo_clave, categoria: r.categoria, titulo: r.titulo, descripcion: r.descripcion,
    estado: r.estado, responsableId: r.responsable_id, responsableNombre: r.responsable_nombre,
    plazoAt: r.plazo_at, creadoAt: r.creado_at, primerContactoAt: r.primer_contacto_at,
    cerradoAt: r.cerrado_at, cerradoPorNombre: r.cerrado_por_nombre, notaCierre: r.nota_cierre,
    esManual: !!r.es_manual,
    vencida: r.estado !== 'HECHA' && !!r.plazo_at && r.plazo_at < ahora,
    campos: parsearCamposCatalogo(r.campos_json ?? null),
    registro: (() => { try { return r.registro_json ? JSON.parse(r.registro_json) : null; } catch { return null; } })(),
    registroAt: r.registro_at ?? null,
    hallazgo: !!r.hallazgo,
  }));
}

/** Tarea manual (§5.1: "se crean tareas propias de cada proyecto fuera del catálogo"). */
export async function crearTareaManual(negocioId: number, p: {
  titulo: string; descripcion: string | null; responsableId: number | null; responsableNombre: string | null; creadoPor: number | null;
}): Promise<number> {
  const ahora = ahoraChileSQL();
  const [maxRow] = await pool.query(`SELECT COALESCE(MAX(orden), 0) AS m FROM compras_tarea WHERE negocio_id = ?`, [negocioId]) as any;
  const orden = (Number((maxRow as any[])[0]?.m) || 0) + 1;
  const [r] = await pool.query(
    `INSERT INTO compras_tarea
       (negocio_id, catalogo_clave, categoria, titulo, descripcion, estado, responsable_id, responsable_nombre, creado_at, es_manual, creado_por, orden)
     VALUES (?, NULL, 'MANUAL', ?, ?, 'PENDIENTE', ?, ?, ?, 1, ?, ?)`,
    [negocioId, p.titulo, p.descripcion, p.responsableId, p.responsableNombre, ahora, p.creadoPor, orden],
  ) as any;
  return (r as any).insertId;
}

// Sin estado "incumplida" (§5.1): solo PENDIENTE → EN_CURSO → HECHA. Volver a PENDIENTE/EN_CURSO
// limpia los datos de cierre en vez de dejarlos colgando de un estado que ya no aplica.
export async function cambiarEstadoTarea(
  tareaId: number, estado: EstadoTarea, p: { actorId: number | null; actorNombre: string | null; notaCierre?: string | null },
): Promise<void> {
  const ahora = ahoraChileSQL();
  const sets: string[] = ['estado = ?'];
  const params: unknown[] = [estado];
  if (estado === 'EN_CURSO') { sets.push('primer_contacto_at = COALESCE(primer_contacto_at, ?)'); params.push(ahora); }
  if (estado === 'HECHA') {
    sets.push('cerrado_at = ?', 'cerrado_por = ?', 'cerrado_por_nombre = ?', 'nota_cierre = ?');
    params.push(ahora, p.actorId, p.actorNombre, p.notaCierre ?? null);
  } else {
    sets.push('cerrado_at = NULL', 'cerrado_por = NULL', 'cerrado_por_nombre = NULL');
  }
  params.push(tareaId);
  await pool.query(`UPDATE compras_tarea SET ${sets.join(', ')} WHERE id = ?`, params);
}

// ── Registro de ejecución de la tarea (§5.3/§5.4) ───────────────────────────────────────────────

/**
 * Guarda QUÉ SE HIZO en una tarea: las respuestas al formulario que declara su catálogo, más la
 * marca de hallazgo. Es lo que la spec pide para las dos tareas obligatorias — el contacto inicial
 * "queda registrado en el sistema" (§5.3) y la validación de la cotización tiene salida explícita:
 * "cotización validada, o hallazgo levantado" (§5.4).
 *
 * Solo se guardan las claves que el catálogo declara: un cliente que mande campos de más no puede
 * inflar la fila con datos que nadie va a saber leer después.
 *
 * NO cambia el estado de la tarea — se puede ir anotando mientras está EN_CURSO y cerrarla aparte
 * (§5.1: el cierre sin ejecución no está permitido, pero anotar sin cerrar sí).
 */
export async function guardarRegistroTarea(
  tareaId: number,
  p: { registro: Record<string, unknown>; hallazgo: boolean },
): Promise<void> {
  const [rows] = await pool.query(
    `SELECT t.registro_json, c.campos_json
       FROM compras_tarea t LEFT JOIN compras_tarea_catalogo c ON c.clave = t.catalogo_clave
      WHERE t.id = ? LIMIT 1`,
    [tareaId],
  ) as any;
  const fila = (rows as any[])[0];
  if (!fila) throw new Error('Tarea no encontrada.');

  const campos = parsearCamposCatalogo(fila.campos_json ?? null);
  const limpio: Record<string, string> = {};
  for (const c of campos) {
    const v = p.registro[c.clave];
    if (v == null) continue;
    const txt = String(v).trim().slice(0, 4000);
    if (txt) limpio[c.clave] = txt;
  }
  // Una tarea manual (o una del catálogo sin formulario) igual puede llevar su nota: sin campos
  // declarados no hay nada que validar, así que se acepta el texto libre tal cual.
  if (campos.length === 0 && typeof p.registro.observaciones === 'string') {
    const txt = p.registro.observaciones.trim().slice(0, 4000);
    if (txt) limpio.observaciones = txt;
  }

  await pool.query(
    `UPDATE compras_tarea SET registro_json = ?, registro_at = ?, hallazgo = ? WHERE id = ?`,
    [Object.keys(limpio).length ? JSON.stringify(limpio) : null, ahoraChileSQL(), p.hallazgo ? 1 : 0, tareaId],
  );
}

// ── Orden de compra del cliente (§3.6) ──────────────────────────────────────────────────────────

/** Lo que se puede registrar de la OC del organismo. Todo opcional: la OC llega por partes (primero
 *  el número y la emisión, la aceptación días después), y obligar a tenerlo todo junto haría que no
 *  se registre nada hasta el final. */
export interface DatosOrdenCompraCliente {
  numero?: string | null;
  emitidaAt?: string | null;    // YYYY-MM-DD
  aceptadaAt?: string | null;   // YYYY-MM-DD
  monto?: number | null;
  difiere?: boolean;
  observacion?: string | null;
}

const soloFecha = (v: string | null | undefined): string | null => {
  const t = (v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
};

/**
 * Registra (o corrige) la orden de compra del cliente. Devuelve si además se dio por hecha la tarea
 * "Aceptación de la orden de compra": cuando se anota la fecha de aceptación, esa tarea ya está
 * cumplida por definición y pedirle al encargado que la marque a mano aparte es pedirle que
 * escriba dos veces el mismo hecho.
 *
 * La aceptación en el portal la ejecuta el EM (§3.6), pero quien deja constancia acá es quien esté
 * operando Compras — por eso se guarda el nombre de quien registró, no el de quien aceptó.
 */
export async function registrarOrdenCompraCliente(
  negocioId: number, datos: DatosOrdenCompraCliente,
  actor: { id: number | null; nombre: string | null },
): Promise<{ tareaAceptacionCerrada: boolean }> {
  const ahora = ahoraChileSQL();
  const aceptadaAt = soloFecha(datos.aceptadaAt);
  const [r] = await pool.query(
    `UPDATE compras_asignacion
        SET oc_numero = ?, oc_emitida_at = ?, oc_aceptada_at = ?, oc_monto = ?, oc_difiere = ?,
            oc_observacion = ?, oc_registrada_por = ?, oc_registrada_por_nombre = ?, oc_actualizada_at = ?,
            oc_origen = 'manual'
      WHERE negocio_id = ?`,
    [
      (datos.numero || '').trim() || null,
      soloFecha(datos.emitidaAt),
      aceptadaAt,
      Number.isFinite(datos.monto as number) ? datos.monto : null,
      datos.difiere ? 1 : 0,
      (datos.observacion || '').trim() || null,
      actor.id, actor.nombre, ahora, negocioId,
    ],
  ) as any;
  if (!r?.affectedRows) throw new Error('No existe apertura de Compras para este negocio.');

  let tareaAceptacionCerrada = false;
  if (aceptadaAt) {
    const [t] = await pool.query(
      `UPDATE compras_tarea
          SET estado = 'HECHA', cerrado_at = ?, cerrado_por = ?, cerrado_por_nombre = ?,
              nota_cierre = COALESCE(nota_cierre, ?), primer_contacto_at = COALESCE(primer_contacto_at, ?)
        WHERE negocio_id = ? AND catalogo_clave = 'aceptar_oc' AND estado <> 'HECHA'`,
      [ahora, actor.id, actor.nombre, `Orden de compra aceptada el ${aceptadaAt}.`, ahora, negocioId],
    ) as any;
    tareaAceptacionCerrada = !!t?.affectedRows;
  }

  const [asig] = await pool.query(
    `SELECT licitacion_codigo, asignado_a FROM compras_asignacion WHERE negocio_id = ? LIMIT 1`, [negocioId],
  ) as any;
  const fila = (asig as any[])[0];

  // El aviso solo tiene sentido si la OC difiere de lo ofertado: ahí manda la OC (§3.6) y el
  // encargado tiene que rehacer cuentas. Registrar una OC que calza no es noticia para nadie.
  if (datos.difiere && fila?.asignado_a) {
    try {
      await registrarEvento({
        tipo: 'COMPRAS_OC_DIFIERE',
        licitacionCodigo: fila.licitacion_codigo,
        usuarioId: Number(fila.asignado_a), usuarioNombre: null,
        actorId: actor.id, actorNombre: actor.nombre,
        mensaje: `La orden de compra de ${fila.licitacion_codigo} difiere de lo ofertado — manda la OC. Revisa alcance y monto.`,
        metadata: { negocio_id: negocioId, oc_numero: (datos.numero || '').trim() || null, oc_monto: datos.monto ?? null },
      });
    } catch (e) {
      console.error('[compras] no se pudo avisar que la OC difiere:', String(e).slice(0, 150));
    }
  }

  return { tareaAceptacionCerrada };
}

/**
 * Vuelve a armar el Resumen Ejecutivo de un negocio que ya está en Compras, y lo guarda.
 *
 * PENDIENTE #1 DE LA SPEC (§21): "¿el resumen se regenera cuando cambian datos del proyecto tras la
 * asignación, o queda congelado como foto del momento de ganar?". La respuesta que toma este
 * módulo, acotada a lo que el problema real exige: **NO se regenera solo, pero se puede regenerar a
 * mano**. Congelado sigue siendo el default —nadie quiere que la foto se mueva sola por la
 * espalda—, pero cuando la foto salió MAL (el paquete de traspaso se congeló antes de que
 * existiera el costeo, o Mercado Público estaba caído y no dio los contactos) tiene que haber una
 * salida que no sea borrar la fila a mano en la base.
 *
 * Es una acción explícita de una persona, no un cron. Lo que NO toca: la asignación, el encargado,
 * las tareas ya sembradas ni lo que se haya registrado en ellas.
 */
export async function regenerarResumen(negocioId: number): Promise<ResumenEjecutivoCompras> {
  const [rows] = await pool.query(
    `SELECT licitacion_codigo FROM compras_asignacion WHERE negocio_id = ? LIMIT 1`, [negocioId],
  ) as any;
  const licitacionCodigo = (rows as any[])[0]?.licitacion_codigo;
  if (!licitacionCodigo) throw new Error('No existe apertura de Compras para este negocio.');

  const resumen = await construirResumenEjecutivoCompras(negocioId, licitacionCodigo);
  const ahora = ahoraChileSQL();
  await pool.query(
    // La urgencia se recalcula con el resumen: si recién ahora se supo el plazo de entrega, la
    // Cadena de Urgencia (§3.7) tiene que activarse igual, aunque llegue tarde.
    `UPDATE compras_asignacion SET resumen_json = ?, resumen_generado_at = ?, urgente = ? WHERE negocio_id = ?`,
    [JSON.stringify(resumen), ahora, esUrgentePorPlazo(resumen.plazoEntregaDias) ? 1 : 0, negocioId],
  );
  return resumen;
}

// ── La OC del cliente llega sola desde Mercado Público (§3.6) ───────────────────────────────────

/** Lo que trae una orden de compra de MP, ya normalizado — lo llena ordenes-compra.ts al guardarla. */
export interface OrdenCompraMP {
  codigo: string;              // código de la orden en MP, ej. "1114-45-SE26"
  estado: string | null;       // Enviada a proveedor · Aceptada · Cancelada…
  fechaEmision: string | null; // YYYY-MM-DD — envío al proveedor, o creación si no hay envío
  fechaAceptacion: string | null;
  total: number | null;        // con IVA, como lo muestra el portal
  totalNeto: number | null;
}

/**
 * Engancha una orden de compra recién traída de Mercado Público a la ficha de Compras del negocio
 * ganado. Idempotente: si ya está enganchada esa misma OC en ese mismo estado, no hace nada y no
 * vuelve a avisar (el listado diario de MP es de MOVIMIENTOS — una orden reaparece cada vez que
 * cambia de estado, y avisar de nuevo por lo mismo es ruido).
 *
 * Lo que MP escribe: código, estado, fechas y montos. Es la fuente oficial — §3.6: "manda siempre
 * la orden de compra". Lo que NUNCA pisa: la observación escrita por una persona, y la marca
 * `difiere` cuando ya estaba encendida (alguien pudo marcarla porque cambió el ALCANCE, no el
 * monto; apagarla porque las cifras calzan sería borrar un hallazgo humano).
 *
 * Si había una OC anotada a mano con OTRO número, no se pierde: queda dicho en la observación.
 *
 * Nunca lanza: un problema acá no puede romper la sincronización de órdenes de compra.
 */
/**
 * ¿El monto de la orden de compra difiere de lo que se nos adjudicó? (§3.6: "si el monto o alcance
 * adjudicado difiere de lo ofertado, manda siempre la orden de compra").
 *
 * Se compara NETO contra NETO. `total` de la orden viene CON IVA y el monto adjudicado del resumen
 * es neto: compararlos directo marcaba una diferencia falsa del 19% en TODAS las órdenes, o sea la
 * alerta se habría vuelto ruido el primer día.
 *
 * Tolerancia de 1%: el portal redondea por línea y esas monedas de diferencia no son un cambio de
 * alcance. Sin ninguno de los dos datos no se afirma nada — false es "no consta que difiera", no
 * "calza" (ver la regla de no inventar datos del proyecto).
 */
export function ocDifiereDeLoAdjudicado(totalNetoOC: number | null, montoAdjudicado: number | null): boolean {
  if (!totalNetoOC || !montoAdjudicado || montoAdjudicado <= 0) return false;
  return Math.abs(totalNetoOC - montoAdjudicado) / montoAdjudicado > 0.01;
}

export async function vincularOrdenCompraDeMP(
  licitacionCodigo: string, oc: OrdenCompraMP,
): Promise<{ vinculada: boolean; difiere: boolean; negocioId: number | null }> {
  const nada = { vinculada: false, difiere: false, negocioId: null };
  try {
    const [rows] = await pool.query(
      `SELECT negocio_id, asignado_a, oc_codigo_mp, oc_estado_mp, oc_numero, oc_origen, oc_difiere,
              oc_observacion, resumen_json
         FROM compras_asignacion WHERE licitacion_codigo = ? LIMIT 1`,
      [licitacionCodigo],
    ) as any;
    const ficha = (rows as any[])[0];
    if (!ficha) return nada;   // la licitación no está (todavía) en Compras: nada que enganchar

    // Ya enganchada, misma orden y mismo estado → nada nuevo que contar.
    if (ficha.oc_codigo_mp === oc.codigo && (ficha.oc_estado_mp || null) === (oc.estado || null)) {
      return { vinculada: false, difiere: !!ficha.oc_difiere, negocioId: Number(ficha.negocio_id) };
    }

    // ¿Difiere de lo ofertado? Ver ocDifiereDeLoAdjudicado.
    let adjudicado: number | null = null;
    try { adjudicado = JSON.parse(ficha.resumen_json)?.montoNuestro ?? null; } catch { /* sin resumen legible */ }
    const difierePorMonto = ocDifiereDeLoAdjudicado(oc.totalNeto, adjudicado);
    const difiere = difierePorMonto || !!ficha.oc_difiere;   // solo se ENCIENDE, nunca se apaga sola

    // El número anotado a mano que no calza con el de MP no se borra: se deja dicho.
    const notaPrevia = (ficha.oc_observacion || '').trim();
    const numeroManualDistinto = ficha.oc_origen === 'manual' && ficha.oc_numero
      && String(ficha.oc_numero).trim() !== oc.codigo;
    const observacion = [
      notaPrevia || null,
      numeroManualDistinto ? `Antes estaba anotada a mano como "${String(ficha.oc_numero).trim()}"; Mercado Público informa ${oc.codigo}.` : null,
      difierePorMonto && adjudicado
        ? `El neto de la orden (${Math.round(oc.totalNeto as number).toLocaleString('es-CL')}) no calza con lo adjudicado (${Math.round(adjudicado).toLocaleString('es-CL')}).`
        : null,
    ].filter(Boolean).join(' ') || null;

    const ahora = ahoraChileSQL();
    await pool.query(
      `UPDATE compras_asignacion
          SET oc_origen = 'mp', oc_codigo_mp = ?, oc_estado_mp = ?, oc_numero = ?,
              oc_emitida_at = ?, oc_aceptada_at = ?, oc_monto = ?, oc_total_neto = ?,
              oc_difiere = ?, oc_observacion = ?, oc_vinculada_at = ?, oc_actualizada_at = ?
        WHERE negocio_id = ?`,
      [oc.codigo, oc.estado, oc.codigo, oc.fechaEmision, oc.fechaAceptacion, oc.total, oc.totalNeto,
       difiere ? 1 : 0, observacion, ahora, ahora, ficha.negocio_id],
    );

    // Aceptada en el portal = la tarea administrativa está cumplida, no hay que pedirle a nadie que
    // la marque a mano (mismo criterio que registrarOrdenCompraCliente).
    if (oc.fechaAceptacion) {
      await pool.query(
        `UPDATE compras_tarea
            SET estado = 'HECHA', cerrado_at = ?, cerrado_por_nombre = 'Mercado Público',
                nota_cierre = COALESCE(nota_cierre, ?), primer_contacto_at = COALESCE(primer_contacto_at, ?)
          WHERE negocio_id = ? AND catalogo_clave = 'aceptar_oc' AND estado <> 'HECHA'`,
        [ahora, `Orden ${oc.codigo} aceptada en el portal el ${oc.fechaAceptacion}.`, ahora, ficha.negocio_id],
      );
    }

    await avisarOrdenCompraLlegada(Number(ficha.negocio_id), licitacionCodigo, ficha.asignado_a, oc, difierePorMonto);
    console.log(`[compras] OC ${oc.codigo} (${oc.estado || 'sin estado'}) enganchada al negocio ${ficha.negocio_id}${difierePorMonto ? ' · DIFIERE de lo adjudicado' : ''}`);
    return { vinculada: true, difiere, negocioId: Number(ficha.negocio_id) };
  } catch (e) {
    console.error('[compras] no se pudo enganchar la orden de compra:', String(e).slice(0, 250));
    return nada;
  }
}

/**
 * Avisa que llegó (o cambió) la orden de compra del cliente. Va al encargado si ya hay uno; si
 * todavía no se asignó, a quienes tienen que enterarse igual (jefes de ventas y admins) — la OC
 * llega cuando llega, no espera a que alguien tome el caso.
 */
async function avisarOrdenCompraLlegada(
  negocioId: number, licitacionCodigo: string, asignadoA: number | null,
  oc: OrdenCompraMP, difierePorMonto: boolean,
): Promise<void> {
  const destinatarios = asignadoA ? [Number(asignadoA)] : await destinatariosAperturaCompras(null);
  const aceptada = !!oc.fechaAceptacion;
  const mensaje = difierePorMonto
    ? `⚠️ Llegó la orden de compra ${oc.codigo} de ${licitacionCodigo}, y el monto NO calza con lo adjudicado. Manda la OC: revisa alcance y monto.`
    : aceptada
      ? `Orden de compra ${oc.codigo} de ${licitacionCodigo}: aceptada en el portal.`
      : `📄 Llegó la orden de compra ${oc.codigo} de ${licitacionCodigo}${oc.estado ? ` (${oc.estado})` : ''}. Queda por aceptarla en el portal.`;

  for (const uid of destinatarios) {
    try {
      await registrarEvento({
        tipo: difierePorMonto ? 'COMPRAS_OC_DIFIERE' : 'COMPRAS_OC_RECIBIDA',
        licitacionCodigo,
        usuarioId: uid, usuarioNombre: null,
        actorId: null, actorNombre: 'Mercado Público',
        mensaje,
        metadata: {
          negocio_id: negocioId, oc_codigo: oc.codigo, oc_estado: oc.estado,
          oc_total_neto: oc.totalNeto, difiere: difierePorMonto,
        },
      });
    } catch (e) {
      console.error(`[compras] aviso de OC al usuario ${uid} falló:`, String(e).slice(0, 150));
    }
  }
}

/**
 * Engancha a sus fichas de Compras las órdenes de compra que YA están guardadas en `ordenes_compra`
 * pero que nunca se vincularon — las que llegaron antes de que este enganche existiera, y las de
 * cualquier corrida en que la licitación todavía no estaba abierta en Compras.
 *
 * Idempotente (vincularOrdenCompraDeMP no repite trabajo ni avisos). Pensada para correr junto al
 * cron de asignación: barata, una consulta y un UPDATE por orden nueva.
 */
export async function engancharOrdenesCompraPendientes(limite = 25): Promise<{ revisadas: number; enganchadas: number }> {
  const res = { revisadas: 0, enganchadas: 0 };
  try {
    const [rows] = await pool.query(
      `SELECT oc.codigo, oc.licitacion_codigo, oc.estado, oc.total, oc.total_neto,
              DATE_FORMAT(COALESCE(oc.fecha_envio, oc.fecha_creacion), '%Y-%m-%d') AS emitida,
              DATE_FORMAT(oc.fecha_aceptacion, '%Y-%m-%d') AS aceptada
         FROM ordenes_compra oc
         JOIN compras_asignacion ca ON ca.licitacion_codigo = oc.licitacion_codigo
        WHERE oc.es_nuestra = 1
          AND (ca.oc_codigo_mp IS NULL OR ca.oc_codigo_mp <> oc.codigo
               OR COALESCE(ca.oc_estado_mp, '') <> COALESCE(oc.estado, ''))
        ORDER BY oc.fecha_creacion DESC
        LIMIT ?`,
      [limite],
    ) as any;
    for (const r of rows as any[]) {
      res.revisadas++;
      const { vinculada } = await vincularOrdenCompraDeMP(r.licitacion_codigo, {
        codigo: r.codigo, estado: r.estado ?? null,
        fechaEmision: r.emitida ?? null, fechaAceptacion: r.aceptada ?? null,
        total: r.total == null ? null : Number(r.total),
        totalNeto: r.total_neto == null ? null : Number(r.total_neto),
      });
      if (vinculada) res.enganchadas++;
    }
  } catch (e) {
    console.error('[compras] enganche de órdenes pendientes falló:', String(e).slice(0, 200));
  }
  return res;
}
