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
  await poblarProductosCompra(negocioId).catch(e =>
    console.error(`[compras] no se pudieron poblar los productos del negocio ${negocioId}:`, String(e).slice(0, 200)));

  await registrarEvento({
    tipo: 'COMPRAS_ASIGNADO',
    licitacionCodigo, usuarioId: encargadoId, usuarioNombre: encargadoNombre,
    actorId: asignadoPorId, actorNombre: asignadoPorId == null ? 'Sistema (fallback automático)' : null,
    mensaje: `Se te asignó Compras de ${licitacionCodigo}${asignadoPorId == null ? ' (asignación automática por carga)' : ''}.`,
    metadata: { negocio_id: negocioId, automatico: asignadoPorId == null },
  });
}

export async function crearTareasCatalogoSiCorresponde(
  negocioId: number, responsableId: number, responsableNombre: string | null,
): Promise<void> {
  const [ya] = await pool.query(`SELECT catalogo_clave FROM compras_tarea WHERE negocio_id = ?`, [negocioId]) as any;
  const yaExistentes = new Set((ya as any[]).map(r => r.catalogo_clave).filter(Boolean));
  if (yaExistentes.size > 0) {
    // No reasignables hoy (§5.1: "hay una sola persona encargada") — solo se completa el
    // responsable de tareas que por algún motivo hubieran quedado sin nadie.
    await pool.query(
      `UPDATE compras_tarea SET responsable_id = ?, responsable_nombre = ? WHERE negocio_id = ? AND responsable_id IS NULL`,
      [responsableId, responsableNombre, negocioId],
    );
    // Backfill: negocios asignados ANTES de que existiera una tarea nueva en el catálogo (ej.
    // "contacto_pagos", §17.3, sumada en migration-96) nunca la sembraron — se completa acá, sin
    // tocar las que ya existen.
    await sembrarTareasFaltantes(negocioId, responsableId, responsableNombre, yaExistentes);
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

/** Backfill del catálogo: inserta las tareas de `compras_tarea_catalogo` que un negocio YA
 *  asignado todavía no tiene (porque la tarea se agregó al catálogo después). Mismo criterio de
 *  boleta/contrato condicionales que `crearTareasCatalogoSiCorresponde`. */
async function sembrarTareasFaltantes(
  negocioId: number, responsableId: number, responsableNombre: string | null, yaExistentes: Set<string>,
): Promise<void> {
  const [catalogo] = await pool.query(
    `SELECT clave, categoria, titulo, descripcion, plazo_dias, plazo_tipo, orden FROM compras_tarea_catalogo WHERE activo = TRUE ORDER BY orden`,
  ) as any;
  const faltantes = (catalogo as any[]).filter(c => !yaExistentes.has(c.clave));
  if (faltantes.length === 0) return;

  const [asigRows] = await pool.query(
    `SELECT DATE_FORMAT(ganado_at, '%Y-%m-%d %H:%i:%s') AS ganado_at, resumen_json FROM compras_asignacion WHERE negocio_id = ? LIMIT 1`,
    [negocioId],
  ) as any;
  const asig = (asigRows as any[])[0];
  if (!asig) return;
  let resumen: ResumenEjecutivoCompras | null = null;
  try { resumen = JSON.parse(asig.resumen_json); } catch { /* sigue sin resumen */ }

  const ganadoAt = parsearFechaPared(asig.ganado_at);
  const ahora = ahoraChileSQL();
  const filas: unknown[][] = [];
  for (const c of faltantes) {
    if (c.clave === 'boleta_fiel_cumplimiento' && resumen && !resumen.requiereBoletaFielCumplimiento) continue;
    if (c.clave === 'firma_contrato' && resumen && !resumen.requiereFirmaContrato) continue;
    const plazoAt = c.plazo_dias == null ? null
      : aTextoFechaPared(c.plazo_tipo === 'CORRIDOS' ? sumarDiasCorridos(ganadoAt, c.plazo_dias) : sumarDiasHabiles(ganadoAt, c.plazo_dias));
    filas.push([negocioId, c.clave, c.categoria, c.titulo, c.descripcion, 'PENDIENTE', responsableId, responsableNombre, plazoAt, ahora, 0, null, c.orden]);
  }
  if (filas.length === 0) return;
  const ph2 = filas.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
  await pool.query(
    `INSERT INTO compras_tarea (negocio_id, catalogo_clave, categoria, titulo, descripcion, estado, responsable_id, responsable_nombre, plazo_at, creado_at, es_manual, creado_por, orden)
     VALUES ${ph2}`,
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
  actor?: { id: number; nombre: string | null },
): Promise<void> {
  const [rows] = await pool.query(
    `SELECT t.registro_json, t.hallazgo, t.negocio_id, t.titulo, c.campos_json
       FROM compras_tarea t LEFT JOIN compras_tarea_catalogo c ON c.clave = t.catalogo_clave
      WHERE t.id = ? LIMIT 1`,
    [tareaId],
  ) as any;
  const fila = (rows as any[])[0];
  if (!fila) throw new Error('Tarea no encontrada.');
  const hallazgoNuevo = p.hallazgo && !fila.hallazgo; // solo dispara en la transición false→true

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

  // §9.2 — origen AUTOMATICA: "las validaciones son fuente natural: 'sin stock' o 'plazo
  // incompatible' es una incidencia y debe abrirse sola." El hallazgo de una tarea de Validación es
  // exactamente esa señal. Vive acá (no en compras-incidencias.ts) para no crear un ciclo de
  // imports entre los dos archivos — mismo criterio que invalidarAprobacionesCompras.
  if (hallazgoNuevo) {
    const ahora = ahoraChileSQL();
    const descripcion = `Hallazgo en la tarea "${fila.titulo}": ${Object.entries(limpio).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'sin detalle adicional'}`;
    await pool.query(
      `INSERT INTO compras_incidencia
         (negocio_id, tarea_id, naturaleza, origen, tipo_libre, descripcion, estado, abierta_por, abierta_por_nombre, abierta_at, created_at, updated_at)
       VALUES (?, ?, 'DEFENSIVA', 'AUTOMATICA', 'Hallazgo en tarea de validación', ?, 'ABIERTA', ?, ?, ?, ?, ?)`,
      [fila.negocio_id, tareaId, descripcion.slice(0, 2000), actor?.id ?? null, actor?.nombre ?? null, ahora, ahora, ahora],
    );
    await registrarEvento({
      tipo: 'COMPRAS_INCIDENCIA_ABIERTA', licitacionCodigo: null, actorId: actor?.id, actorNombre: actor?.nombre,
      mensaje: `Se abrió una incidencia automática por hallazgo en "${fila.titulo}".`,
      metadata: { negocio_id: fila.negocio_id, tarea_id: tareaId, automatica: true },
    });
  }
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

// ── Estados y subestados de cobertura por producto (§14) ───────────────────────────────────────
// El proyecto es dicotómico (se entrega o no se entrega, §14.1); lo que tiene grados es CADA
// producto. "Cobertura total o nada" (§14.2): con un solo producto pendiente, el proyecto entero
// no se puede entregar.
export type SubestadoProducto = 'PENDIENTE' | 'COTIZANDO' | 'COMPRADO' | 'EN_BODEGA' | 'LISTO_ENTREGA' | 'ENTREGADO' | 'RENUNCIADO';

export interface ProductoCompra {
  id: number; negocioId: number; correlativo: number | null; descripcion: string;
  cantidad: number | null; unidad: string | null; montoUnitario: number | null;
  subestado: SubestadoProducto;
  renunciaMotivo: string | null; renunciaPropuestaPorNombre: string | null; renunciaPropuestaAt: string | null;
  renunciaAprobadaPorNombre: string | null; renunciaAprobadaAt: string | null;
}

/** Puebla `compras_producto` con los PRODUCTOS REALES a comprar — no el catálogo de MercadoPúblico,
 *  que a menudo agrupa varios productos distintos bajo una sola línea/ítem (caso real 1114-12-LE26:
 *  el catálogo de MP trae UN ítem "Sensores de presión" cuyo texto menciona también "plataformas
 *  satelitales", pero Viabilidad y el Costeo ya lo saben desglosado en 2 productos reales: "línea
 *  real" 1 y 2 del análisis, un espacio de numeración PROPIO que no tiene por qué coincidir con el
 *  correlativo de MP). La fuente correcta es el mismo Costeo digital que ya usa Viabilidad/el Anexo
 *  Económico (`negocio_costeo_editor`, vía `editorAFilasCosteo` — spec §6.4: "la estructura
 *  conceptual de la tabla se mantiene"), no `adjudicacion_cache.lineas`.
 *
 *  NO se filtra por `adjudicacion_cache.lineas`/correlativo: probado en 1114-12-LE26 que filtrar así
 *  descartaba en silencio un producto real (la línea 2 del costeo no calzaba con el único correlativo
 *  1 del catálogo de MP — espacios de numeración distintos). Si una línea específica de verdad no se
 *  ganó, se saca a mano con "Renunciar línea" (§14.5) una vez visible — mejor un producto de más que
 *  uno perdido sin que nadie lo note.
 *
 *  Idempotente: no repite si ya hay filas para el negocio. Sin costeo cargado en el editor, cae al
 *  desglose del acta de MP; sin ninguno de los dos, a una sola fila "global". */
export async function poblarProductosCompra(negocioId: number): Promise<void> {
  const [ya] = await pool.query(`SELECT 1 FROM compras_producto WHERE negocio_id = ? LIMIT 1`, [negocioId]) as any;
  if ((ya as any[]).length > 0) return;

  const [negRows] = await pool.query(
    `SELECT licitacion_codigo, monto_ofertado FROM negocios WHERE id = ? LIMIT 1`, [negocioId],
  ) as any;
  const neg = (negRows as any[])[0];
  if (!neg) return;

  const ahora = ahoraChileSQL();
  const filasCosteo = await filasProductoDelCosteo(neg.licitacion_codigo);

  if (filasCosteo.length > 0) {
    const filas = filasCosteo.map(f => [
      negocioId, f.lineaPublicada ?? null, (f.detalle || 'Producto sin nombre').slice(0, 500),
      f.cantidadOriginal ?? null, f.unidad ?? null, f.precioUnitarioSinDecimales ?? null, 'PENDIENTE', ahora, ahora,
    ]);
    const ph = filas.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
    await pool.query(
      `INSERT INTO compras_producto
         (negocio_id, correlativo, descripcion, cantidad, unidad, monto_unitario, subestado, created_at, updated_at)
       VALUES ${ph}`,
      filas.flat(),
    );
    return;
  }

  // Sin costeo digital todavía: cae al desglose del acta de MP si lo trae (mejor que la fila global).
  const [adjRows] = await pool.query(
    `SELECT lineas FROM adjudicacion_cache WHERE licitacion_codigo = ? LIMIT 1`, [neg.licitacion_codigo],
  ) as any;
  let nuestras: any[] = [];
  try {
    const lineas = JSON.parse((adjRows as any[])[0]?.lineas || '[]');
    if (Array.isArray(lineas)) nuestras = lineas.filter((l: any) => l?.esNuestra);
  } catch { /* sigue al fallback global de abajo */ }

  if (nuestras.length === 0) {
    await pool.query(
      `INSERT INTO compras_producto (negocio_id, descripcion, monto_unitario, subestado, created_at, updated_at)
       VALUES (?, 'Proyecto (adjudicación total, sin detalle de líneas)', ?, 'PENDIENTE', ?, ?)`,
      [negocioId, neg.monto_ofertado ?? null, ahora, ahora],
    );
    return;
  }

  const filas = nuestras.map((l: any) => [
    negocioId, l.correlativo ?? null, String(l.producto || l.descripcion || 'Producto sin nombre').slice(0, 500),
    l.cantidad ?? null, l.unidad ?? null, l.montoUnitario ?? null, 'PENDIENTE', ahora, ahora,
  ]);
  const ph = filas.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
  await pool.query(
    `INSERT INTO compras_producto
       (negocio_id, correlativo, descripcion, cantidad, unidad, monto_unitario, subestado, created_at, updated_at)
     VALUES ${ph}`,
    filas.flat(),
  );
}

/** Lee el Costeo digital del negocio (mismo origen que Viabilidad/Anexo Económico) y lo aplana a
 *  filas producto por producto, con la línea REAL de cada una (`lineaPublicada`). [] si el negocio
 *  todavía no tiene costeo cargado en el editor. */
async function filasProductoDelCosteo(licitacionCodigo: string): Promise<import('@/app/lib/motor-comercial').FilaCosteo[]> {
  const { editorAFilasCosteo, MARGEN_VENTA_DEFECTO } = await import('@/app/lib/costeo-editor');
  const [negRows] = await pool.query(
    `SELECT id FROM negocios WHERE licitacion_codigo = ? AND activo = TRUE ORDER BY id DESC LIMIT 1`, [licitacionCodigo],
  ) as any;
  const negocioId = (negRows as any[])[0]?.id;
  if (!negocioId) return [];
  const [rows] = await pool.query(`SELECT modalidad, datos_json FROM negocio_costeo_editor WHERE negocio_id = ? LIMIT 1`, [negocioId]) as any;
  const row = (rows as any[])[0];
  if (!row) return [];
  try {
    const datos = typeof row.datos_json === 'string' ? JSON.parse(row.datos_json) : row.datos_json;
    const grupos = (datos?.grupos || []).map((g: any) => ({ ...g, ofertamos: g.ofertamos !== false }));
    return editorAFilasCosteo({ modalidad: row.modalidad, margenVenta: Number(datos?.margenVenta) || MARGEN_VENTA_DEFECTO, grupos });
  } catch {
    return [];
  }
}

export async function listarProductosCompra(negocioId: number): Promise<ProductoCompra[]> {
  const [rows] = await pool.query(
    `SELECT id, negocio_id, correlativo, descripcion, cantidad, unidad, monto_unitario, subestado,
            renuncia_motivo, renuncia_propuesta_por_nombre, DATE_FORMAT(renuncia_propuesta_at, '%Y-%m-%d %H:%i:%s') AS renuncia_propuesta_at,
            renuncia_aprobada_por_nombre, DATE_FORMAT(renuncia_aprobada_at, '%Y-%m-%d %H:%i:%s') AS renuncia_aprobada_at
       FROM compras_producto WHERE negocio_id = ? ORDER BY correlativo IS NULL, correlativo, id`,
    [negocioId],
  ) as any;
  return (rows as any[]).map(r => ({
    id: r.id, negocioId: r.negocio_id, correlativo: r.correlativo, descripcion: r.descripcion,
    cantidad: r.cantidad == null ? null : Number(r.cantidad), unidad: r.unidad,
    montoUnitario: r.monto_unitario == null ? null : Number(r.monto_unitario),
    subestado: r.subestado, renunciaMotivo: r.renuncia_motivo,
    renunciaPropuestaPorNombre: r.renuncia_propuesta_por_nombre, renunciaPropuestaAt: r.renuncia_propuesta_at,
    renunciaAprobadaPorNombre: r.renuncia_aprobada_por_nombre, renunciaAprobadaAt: r.renuncia_aprobada_at,
  }));
}

const SUBESTADOS_VALIDOS: SubestadoProducto[] = ['PENDIENTE', 'COTIZANDO', 'COMPRADO', 'EN_BODEGA', 'LISTO_ENTREGA', 'ENTREGADO', 'RENUNCIADO'];

export async function cambiarSubestadoProducto(productoId: number, subestado: SubestadoProducto): Promise<void> {
  if (!SUBESTADOS_VALIDOS.includes(subestado)) throw new Error(`Subestado inválido: ${subestado}`);
  const [r] = await pool.query(
    `UPDATE compras_producto SET subestado = ?, updated_at = ? WHERE id = ? AND subestado <> 'RENUNCIADO'`,
    [subestado, ahoraChileSQL(), productoId],
  ) as any;
  if (!r?.affectedRows) throw new Error('Producto no encontrado, o está renunciado (no admite cambio de estado).');
}

/** Propone renunciar a una línea (§14.5): "las circunstancias las plantea el encargado de compras,
 *  la aprueba el jefe de ventas". Queda PROPUESTA hasta que alguien con permiso de aprobación la
 *  confirme — no sale del cómputo de cobertura hasta ese momento. */
export async function proponerRenunciaLinea(
  productoId: number, motivo: string, actorId: number, actorNombre: string | null,
): Promise<void> {
  const ahora = ahoraChileSQL();
  const [r] = await pool.query(
    `UPDATE compras_producto
        SET renuncia_motivo = ?, renuncia_propuesta_por = ?, renuncia_propuesta_por_nombre = ?, renuncia_propuesta_at = ?,
            renuncia_aprobada_por = NULL, renuncia_aprobada_por_nombre = NULL, renuncia_aprobada_at = NULL
      WHERE id = ? AND subestado <> 'RENUNCIADO'`,
    [motivo, actorId, actorNombre, ahora, productoId],
  ) as any;
  if (!r?.affectedRows) throw new Error('Producto no encontrado, o ya está renunciado.');

  const [prodRows] = await pool.query(
    `SELECT cp.negocio_id, cp.descripcion, n.licitacion_codigo FROM compras_producto cp
       JOIN negocios n ON n.id = cp.negocio_id WHERE cp.id = ?`, [productoId],
  ) as any;
  const prod = (prodRows as any[])[0];
  if (prod) {
    await registrarEvento({
      tipo: 'COMPRAS_RENUNCIA_PROPUESTA', licitacionCodigo: prod.licitacion_codigo, actorId, actorNombre,
      mensaje: `Se propuso renunciar a la línea "${prod.descripcion}": ${motivo}. Pendiente de aprobación del jefe de ventas (spec §14.5).`,
      metadata: { negocio_id: prod.negocio_id, producto_id: productoId },
    });
  }
}

export async function aprobarRenunciaLinea(productoId: number, actorId: number, actorNombre: string | null): Promise<void> {
  const ahora = ahoraChileSQL();
  const [r] = await pool.query(
    `UPDATE compras_producto
        SET subestado = 'RENUNCIADO', renuncia_aprobada_por = ?, renuncia_aprobada_por_nombre = ?, renuncia_aprobada_at = ?, updated_at = ?
      WHERE id = ? AND renuncia_motivo IS NOT NULL AND subestado <> 'RENUNCIADO'`,
    [actorId, actorNombre, ahora, ahora, productoId],
  ) as any;
  if (!r?.affectedRows) throw new Error('No hay renuncia propuesta pendiente para este producto.');

  // Renunciar una línea cambia el alcance de la compra — invalida cualquier aprobación ya dada (§10.5).
  const [prodRows] = await pool.query(
    `SELECT cp.negocio_id, cp.descripcion, n.licitacion_codigo FROM compras_producto cp
       JOIN negocios n ON n.id = cp.negocio_id WHERE cp.id = ?`, [productoId],
  ) as any;
  const prod = (prodRows as any[])[0];
  if (prod) {
    await invalidarAprobacionesCompras(prod.negocio_id, 'Se renunció a una línea del proyecto.');
    await registrarEvento({
      tipo: 'COMPRAS_RENUNCIA_APROBADA', licitacionCodigo: prod.licitacion_codigo, actorId, actorNombre,
      mensaje: `Se aprobó la renuncia a la línea "${prod.descripcion}". Formalizar por correo con el cliente (spec §14.5).`,
      metadata: { negocio_id: prod.negocio_id, producto_id: productoId },
    });
  }
}

// ── Compuertas de aprobación (§10) ──────────────────────────────────────────────────────────────
// "Todo cambio posterior a una aprobación la invalida y devuelve el proyecto a la bandeja" (§10.5).
// Vive acá (no en compras-aprobaciones.ts) para que tanto ese módulo como compras-auditor.ts (al
// elegir un escenario) puedan llamarla sin crear un ciclo de imports entre los tres archivos.
export async function invalidarAprobacionesCompras(negocioId: number, motivo: string): Promise<void> {
  const ahora = ahoraChileSQL();
  await pool.query(
    `UPDATE compras_aprobacion
        SET estado = 'PENDIENTE', motivo = ?, resuelto_por = NULL, resuelto_por_nombre = NULL, resuelto_at = NULL,
            comentario_resolucion = NULL, updated_at = ?
      WHERE negocio_id = ? AND estado IN ('APROBADA', 'APROBADA_CON_MODIFICACION')`,
    [motivo, ahora, negocioId],
  );
}

export interface CoberturaProyecto { total: number; listos: number; renunciados: number; cobertura: boolean }

/** Cobertura total o nada (§14.2): las líneas RENUNCIADAS salen del cómputo (§14.5); de las que
 *  quedan, TODAS deben estar en ENTREGADO para que el proyecto sea entregable. */
export async function coberturaProyecto(negocioId: number): Promise<CoberturaProyecto> {
  const productos = await listarProductosCompra(negocioId);
  const vigentes = productos.filter(p => p.subestado !== 'RENUNCIADO');
  const listos = vigentes.filter(p => p.subestado === 'ENTREGADO').length;
  return {
    total: vigentes.length, listos, renunciados: productos.length - vigentes.length,
    cobertura: vigentes.length > 0 && listos === vigentes.length,
  };
}

// ── Contadores por pestaña (UI, sep-2026) ───────────────────────────────────────────────────────
// La pantalla se reordenó en 5 pestañas por etapa (ver ComprasSection.tsx) para no apilar 12
// tarjetas — pero eso escondió información: antes de entrar a "Entrega y Cierre" no había forma de
// saber si había una incidencia abierta esperando. Este resumen es SOLO para pintar un número en
// cada pestaña ("2 tareas vencidas", "1 incidencia abierta") — nunca decide nada, y cada conteo se
// obtiene con su propia consulta liviana envuelta en try/catch: si una tabla no existe todavía o
// una consulta falla, ese contador queda en 0 en vez de romper toda la pantalla.
export interface ResumenFasesCompras {
  tareas: { vencidas: number };
  costeo: { productosSinCotizacion: number };
  aprobacion: { compuertasPendientes: number };
  compra: { hitosAdminPendientes: number | null }; // null = Compuerta 1 no aprobada, no aplica todavía
  entrega: { incidenciasAbiertas: number; relojVencido: boolean };
}

async function contarProductosSinCotizacion(negocioId: number): Promise<number> {
  try {
    const [[r]]: any = await pool.query(
      `SELECT COUNT(*) n FROM compras_producto p
        WHERE p.negocio_id = ? AND p.subestado != 'RENUNCIADO'
          AND NOT EXISTS (
            SELECT 1 FROM compras_cotizacion_item ci
              JOIN compras_cotizacion c ON c.id = ci.cotizacion_id
             WHERE c.negocio_id = p.negocio_id AND ci.producto_id = p.id AND ci.cumple != 'NO_ES_EL_PRODUCTO'
          )`,
      [negocioId],
    );
    return Number(r?.n || 0);
  } catch { return 0; }
}

async function contarCompuertasPendientes(negocioId: number): Promise<number> {
  try {
    const [[r]]: any = await pool.query(
      `SELECT COUNT(*) n FROM compras_aprobacion WHERE negocio_id = ? AND estado = 'PENDIENTE'`,
      [negocioId],
    );
    return Number(r?.n || 0);
  } catch { return 0; }
}

/** null si la Compuerta 1 (compra) todavía no está aprobada — §11.2 dice que estos hitos son
 *  "tareas paralelas AL APROBARSE la compra", así que antes de eso el contador no aplica (mismo
 *  criterio que ya usa RepartoAdminCard.tsx para decidir si se muestra). */
async function contarHitosAdminPendientes(negocioId: number): Promise<number | null> {
  try {
    const [[apr]]: any = await pool.query(
      `SELECT estado FROM compras_aprobacion WHERE negocio_id = ? AND tipo = 'COMPRA' LIMIT 1`,
      [negocioId],
    );
    if (!apr || !['APROBADA', 'APROBADA_CON_MODIFICACION'].includes(apr.estado)) return null;
    const [[r]]: any = await pool.query(
      `SELECT
         (oc_emitida_at IS NULL) + (pago_registrado_at IS NULL) + (anticipo_pagado_at IS NULL) +
         (factura_compra_registrada_at IS NULL) + (carpeta_proyecto_creada_at IS NULL) +
         (provision_fondos_at IS NULL) AS n
       FROM compras_reparto_administrativo WHERE negocio_id = ?`,
      [negocioId],
    );
    // Sin fila todavía (nadie tocó el checklist): los 6 hitos están pendientes.
    return r ? Number(r.n) : 6;
  } catch { return null; }
}

async function contarIncidenciasAbiertas(negocioId: number): Promise<number> {
  try {
    const [[r]]: any = await pool.query(
      `SELECT COUNT(*) n FROM compras_incidencia WHERE negocio_id = ? AND estado = 'ABIERTA'`,
      [negocioId],
    );
    return Number(r?.n || 0);
  } catch { return 0; }
}

async function relojEstaVencido(negocioId: number): Promise<boolean> {
  try {
    const [[r]]: any = await pool.query(
      `SELECT fecha_limite, prorroga_fecha_limite, entrega_con_multa FROM compras_reloj WHERE negocio_id = ?`,
      [negocioId],
    );
    if (!r || r.entrega_con_multa) return false; // sin reloj fijado, o ya autorizada la entrega con multa: no es "vencido silencioso"
    const limite = r.prorroga_fecha_limite || r.fecha_limite;
    if (!limite) return false;
    const hoy = ahoraChileSQL().slice(0, 10);
    return String(limite).slice(0, 10) < hoy;
  } catch { return false; }
}

export async function obtenerResumenFases(negocioId: number, tareas: { vencida: boolean }[]): Promise<ResumenFasesCompras> {
  const [productosSinCotizacion, compuertasPendientes, hitosAdminPendientes, incidenciasAbiertas, relojVencido] =
    await Promise.all([
      contarProductosSinCotizacion(negocioId),
      contarCompuertasPendientes(negocioId),
      contarHitosAdminPendientes(negocioId),
      contarIncidenciasAbiertas(negocioId),
      relojEstaVencido(negocioId),
    ]);
  return {
    tareas: { vencidas: tareas.filter(t => t.vencida).length },
    costeo: { productosSinCotizacion },
    aprobacion: { compuertasPendientes },
    compra: { hitosAdminPendientes },
    entrega: { incidenciasAbiertas, relojVencido },
  };
}
