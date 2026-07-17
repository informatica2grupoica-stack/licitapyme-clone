// app/lib/refrescar-estados.ts
// Capa 2 del estado de Mercado Público: refresco AUTORITATIVO desde la API para las licitaciones
// ASIGNADAS (negocios) que siguen vivas. El estado (CodigoEstado) se cachea al asignar y NO se
// actualiza solo; estado-mp.ts (Capa 1) solo deriva Publicada→Cerrada por FECHA. Los estados
// terminales que la fecha NO puede saber —Cerrada(6), Desierta(7), Adjudicada(8), Revocada(18),
// Suspendida(19)— requieren consultar la API. Aquí, por cada código asignado vivo, 1 llamada a MP;
// si el estado real difiere y es DEFINITIVO, se escribe `licitacion_estado` en AMBAS tablas:
//   · negocios             → lo ven el detalle del negocio, la lista y Análisis.
//   · alertas_licitaciones → lo ve el radar/buscador (las asignadas también viven ahí).
// Como el front lee `licitacion_estado` vía los helpers de estado-mp.ts en todas las vistas, con
// solo actualizar la columna los badges muestran el estado real en todos lados, sin tocar el front.
//
// Usa la API oficial (api.mercadopublico.cl), que NO exige IP chilena → corre donde sea. Best-effort
// y acotado en tiempo: se engancha como paso final del cron /api/cron/alertas. Las POSTULADAS se
// refrescan aparte (procesar-postuladas.ts, que además promueve a ADJUDICADA/PERDIDA), así que aquí
// se excluyen para no duplicar trabajo.

import pool from '@/app/lib/db';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';
import { CODIGO_ESTADO_MP, codigoEstadoMP } from '@/app/lib/estado-mp';
import { registrarActividad } from '@/app/lib/actividad';
import { registrarEvento } from '@/app/lib/historial';
import { enviarCorreoCambio } from '@/app/lib/email';

const CODIGO_CONCURRENCIA = 4;       // detalles de MP consultados en paralelo
const PRESUPUESTO_MS       = 25_000; // tope de tiempo del paso (margen bajo maxDuration del cron)
const TIMEOUT_DETALLE_MS   = 8_000;  // timeout por llamada a MP
const MAX_CODIGOS          = 400;    // backstop de cuántos códigos se sondean por corrida

// Estados DEFINITIVOS que solo la API sabe (la fecha no los deriva). Si MP reporta uno de estos
// y difiere del cacheado, se persiste. Publicada(5) no se persiste (no aporta sobre la fecha).
const ESTADOS_DEFINITIVOS = new Set([6, 7, 8, 18, 19]);

// Estados que DISPARAN CORREO al admin + asignado (decisión del dueño). El resto de terminales
// (Adjudicada/Suspendida) igual se persisten y avisan por campana, pero sin correo.
const ESTADOS_CON_CORREO = new Set(['Cerrada', 'Revocada', 'Desierta']);

// Estados del pipeline YA resueltos: no se refrescan aquí (POSTULADA la maneja procesar-postuladas).
const PIPELINE_RESUELTOS = ['POSTULADA', 'ADJUDICADA', 'PERDIDA', 'DESCARTADA'];

// Detección de estado terminal por NOMBRE. IMPORTANTE: MP usa códigos INCONSISTENTES para el mismo
// estado (verificado en vivo: 2831-17-LR26 "Revocada" llega como CodigoEstado 15, no 18), así que
// comparar solo por número se pierde casos reales. El texto ("Revocada"/"Desierta"/…) es fiable:
// el cliente lo expone en EstadoNombre (cae al Estado crudo de la API cuando el código no está en
// el mapa). Se resuelve por nombre primero y, de respaldo, por el código conocido.
const TERMINALES_POR_NOMBRE: Array<[RegExp, string]> = [
  [/revocad/, 'Revocada'],
  [/desiert/, 'Desierta'],
  [/adjudicad/, 'Adjudicada'],
  [/suspend/, 'Suspendida'],
  [/cerrad/, 'Cerrada'],
];

function normNombre(s: string | number | null | undefined): string {
  return (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Nombre canónico del estado DEFINITIVO de la licitación (uno de los 5 terminales), o null si sigue
// publicada / no es terminal. Por NOMBRE primero (robusto ante códigos MP variables), luego por código.
function estadoDefinitivoCanonico(lic: { EstadoNombre?: string; CodigoEstado?: number | null }): string | null {
  const texto = normNombre(lic.EstadoNombre);
  for (const [re, nombre] of TERMINALES_POR_NOMBRE) if (re.test(texto)) return nombre;
  const cod = codigoEstadoMP(lic.CodigoEstado ?? null);
  if (cod != null && ESTADOS_DEFINITIVOS.has(cod)) return CODIGO_ESTADO_MP[cod] ?? null;
  return null;
}

// ── Barrido DETERMINISTA (sin API): Publicada vencida → Cerrada, en TODA la base ──────────────
// El estado terminal más común (Cerrada por cierre) NO necesita la API: es pura fecha. Este barrido
// persiste `licitacion_estado='Cerrada'` para cada licitación cuyo cierre ya pasó y que sigue figurando
// Publicada, en negocios (cualquier pipeline, incluidas POSTULADA/etc.: es el estado de MP, no el
// nuestro) y en el radar (alertas_licitaciones). Es barato (2 UPDATEs), cubre las ~1000+ que hoy están
// desactualizadas y se corre en cada cron. SILENCIOSO: no dispara campana/correo (un cierre por fecha
// es predecible y son demasiadas para notificar). Los estados que la fecha NO puede saber
// (Revocada/Desierta/Adjudicada) se refrescan desde la API por separado, y esos SÍ notifican (asignadas).
export async function marcarCerradasPorFecha(): Promise<{ negocios: number; radar: number }> {
  // Publicada, código '5', o sin estado; con cierre en el pasado.
  const pub = `(licitacion_estado IS NULL OR licitacion_estado IN ('Publicada','5'))`;
  const venc = `licitacion_cierre IS NOT NULL AND licitacion_cierre < NOW()`;
  let negocios = 0, radar = 0;
  try {
    // OJO: NO se toca updated_at (evita falsear el semáforo de frescura del negocio).
    const [rn] = await pool.query(
      `UPDATE negocios SET licitacion_estado = 'Cerrada' WHERE activo = TRUE AND ${pub} AND ${venc}`,
    ) as any[];
    negocios = (rn as any)?.affectedRows ?? 0;
  } catch (e) { console.error('[refrescar-estados] barrido negocios falló:', String(e)); }
  try {
    const [rr] = await pool.query(
      `UPDATE alertas_licitaciones SET licitacion_estado = 'Cerrada' WHERE ${pub} AND ${venc}`,
    ) as any[];
    radar = (rr as any)?.affectedRows ?? 0;
  } catch (e) { console.error('[refrescar-estados] barrido radar falló:', String(e)); }
  if (negocios || radar) console.log(`[refrescar-estados] barrido Cerrada por fecha: ${negocios} negocios, ${radar} radar`);
  return { negocios, radar };
}

// Persiste el estado en negocios + alertas y, SI hubo transición real, notifica una sola vez.
// El UPDATE es ATÓMICO con guardia `licitacion_estado <> ?`: affectedRows>0 ⇒ cambió de verdad,
// aun si dos corridas (cron + on-demand) coinciden → la notificación no se duplica.
// notificar: si dispara campana/correo/historial cuando hay transición. true para asignadas en vivo
// (cron/on-demand); false para BACKFILL inicial (evita inundar de correos por cambios históricos) y
// para el barrido del radar (no hay a quién avisar de 10k licitaciones no asignadas).
async function persistirYNotificar(codigo: string, nombre: string, notificar = true): Promise<boolean> {
  const [res] = await pool.query(
    `UPDATE negocios SET licitacion_estado = ?, updated_at = NOW()
     WHERE licitacion_codigo = ? AND activo = TRUE
       AND (licitacion_estado IS NULL OR licitacion_estado <> ?)`,
    [nombre, codigo, nombre],
  ) as any[];
  const cambioNegocio = ((res as any)?.affectedRows ?? 0) > 0;
  // El radar (tabla alertas_licitaciones) se alinea siempre (idempotente); no gatilla notificación
  // por sí solo. Puede haber varias filas por código (una por perfil): se actualizan todas.
  const [resR] = await pool.query(
    `UPDATE alertas_licitaciones SET licitacion_estado = ?
     WHERE licitacion_codigo = ? AND (licitacion_estado IS NULL OR licitacion_estado <> ?)`,
    [nombre, codigo, nombre],
  ).catch(() => [{ affectedRows: 0 }] as any[]);
  const cambioRadar = ((resR as any)?.affectedRows ?? 0) > 0;

  // Solo notificamos si cambió un NEGOCIO (hay a quién avisar); el radar puro no notifica.
  if (cambioNegocio && notificar) {
    await notificarCambioEstado(codigo, nombre).catch(e =>
      console.error(`[refrescar-estados] notificar "${codigo}" falló:`, String(e)));
  }
  return cambioNegocio || cambioRadar;
}

// Bitácora + campana + correo cuando MP cambia el estado a uno terminal. Best-effort.
async function notificarCambioEstado(codigo: string, nombre: string): Promise<void> {
  // Negocios activos del código (asignado + email + nombre de la licitación).
  const [nrows] = await pool.query(
    `SELECT n.licitacion_nombre, n.asignado_a, u.nombre AS usuario_nombre, u.email AS usuario_email
     FROM negocios n JOIN usuarios u ON u.id = n.asignado_a AND u.activo = TRUE
     WHERE n.licitacion_codigo = ? AND n.activo = TRUE`,
    [codigo],
  ) as any[];
  const negs = nrows as Array<{ licitacion_nombre: string | null; asignado_a: number; usuario_nombre: string | null; usuario_email: string | null }>;

  // Sin negocio ACTIVO con un usuario asignado VÁLIDO (activo) → no la trabaja nadie:
  // NO se notifica (ni a los admins). Antes, si el asignado había sido eliminado o el
  // negocio quedó inactivo, el JOIN dejaba `negs` vacío pero igual se avisaba a todos los
  // admins con solo el código ("2295-68-LE26 pasó a Adjudicada") → ruido de licitaciones
  // ajenas del radar general de Mercado Público. La bitácora del código igual se registra
  // aparte (persistirYNotificar solo llama aquí cuando cambió un negocio del código).
  if (negs.length === 0) {
    await registrarActividad({
      usuarioId: null, accion: 'estado_mp',
      entidadTipo: 'licitacion', entidadId: codigo,
      descripcion: `Mercado Público marcó la licitación como ${nombre}`,
      metadata: { licitacion_codigo: codigo, estado: nombre },
    }).catch(() => {});
    return;
  }
  const licNombre = negs[0]?.licitacion_nombre || codigo;

  // Admins (siempre reciben campana; y correo en los estados con correo).
  const [arows] = await pool.query(
    `SELECT id, nombre, email FROM usuarios WHERE rol = 'admin' AND activo = TRUE`,
  ) as any[];
  const admins = arows as Array<{ id: number; nombre: string | null; email: string | null }>;

  // 1) Historial de la licitación (actor = Mercado Público). Aparece en el timeline del detalle.
  await registrarActividad({
    usuarioId: null, accion: 'estado_mp',
    entidadTipo: 'licitacion', entidadId: codigo,
    descripcion: `Mercado Público marcó la licitación como ${nombre}`,
    metadata: { licitacion_codigo: codigo, estado: nombre },
  });

  // Destinatarios = asignado(s) + admins, deduplicados por id de usuario.
  const dest = new Map<number, { nombre: string | null; email: string | null }>();
  for (const n of negs) if (n.asignado_a) dest.set(Number(n.asignado_a), { nombre: n.usuario_nombre, email: n.usuario_email });
  for (const a of admins) dest.set(Number(a.id), { nombre: a.nombre, email: a.email });

  // 2) Campana + SSE.
  const mensaje = `${licNombre} pasó a ${nombre} en Mercado Público`;
  for (const [uid, u] of dest) {
    registrarEvento({
      tipo: 'ESTADO_MP', licitacionCodigo: codigo, licitacionNombre: licNombre,
      usuarioId: uid, usuarioNombre: u.nombre,
      actorId: null, actorNombre: 'Mercado Público',
      mensaje, metadata: { licitacion_codigo: codigo, estado: nombre },
    }).catch(() => {});
  }

  // 3) Correo SOLO para Cerrada/Revocada/Desierta, a admins + asignado (best-effort).
  if (ESTADOS_CON_CORREO.has(nombre)) {
    for (const [, u] of dest) {
      if (!u.email) continue;
      enviarCorreoCambio({
        to: u.email, nombre: u.nombre, codigo, licitacionNombre: licNombre,
        cambios: [{ tipo: 'Estado', detalle: `Estado en Mercado Público: ${nombre}` }],
        actorNombre: 'Mercado Público',
      }).catch(() => {});
    }
  }
}

export async function refrescarEstadosAsignadas(
  opts: { presupuestoMs?: number; timeoutMs?: number; notificar?: boolean } = {},
): Promise<{ codigos: number; actualizadas: number; errores: number }> {
  const presupuestoMs = opts.presupuestoMs ?? PRESUPUESTO_MS;
  const timeoutMs      = opts.timeoutMs ?? TIMEOUT_DETALLE_MS;
  const notificar      = opts.notificar ?? true;
  const stats = { codigos: 0, actualizadas: 0, errores: 0 };
  const inicio = Date.now();

  // Códigos asignados VIVOS (pipeline no resuelto). Se trae el estado cacheado para comparar y
  // así solo escribir cuando cambia. Cierre ASC = las que cerraron primero se sondean antes (más
  // probable que ya tengan resultado); pero NO se filtran por cierre: una revocación/suspensión
  // puede ocurrir con la licitación aún publicada.
  let filas: Array<{ codigo: string; estado_cache: string | null }> = [];
  try {
    const placeholders = PIPELINE_RESUELTOS.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT n.licitacion_codigo AS codigo,
              MAX(n.licitacion_estado) AS estado_cache
       FROM negocios n
       WHERE n.activo = TRUE
         AND (n.estado_pipeline IS NULL OR n.estado_pipeline NOT IN (${placeholders}))
       GROUP BY n.licitacion_codigo
       ORDER BY MIN(n.licitacion_cierre) ASC
       LIMIT ${MAX_CODIGOS}`,
      PIPELINE_RESUELTOS,
    ) as any[];
    filas = rows as Array<{ codigo: string; estado_cache: string | null }>;
  } catch (e) {
    console.error('[refrescar-estados] carga inicial falló:', String(e));
    return stats;
  }

  if (filas.length === 0) return stats;

  const client = getMercadoPublicoClient();

  const procesarCodigo = async (fila: { codigo: string; estado_cache: string | null }) => {
    if (Date.now() - inicio > presupuestoMs) return; // sin presupuesto → salta (se retoma la próxima corrida)
    const codigo = fila.codigo;
    try {
      const lic = await client.obtenerPorCodigoRapido(codigo, timeoutMs);
      if (!lic) return;

      // Estado DEFINITIVO por nombre (robusto ante códigos MP variables). null = sigue publicada.
      const nombre = estadoDefinitivoCanonico(lic);
      if (!nombre) return;

      // Corto-circuito barato: si el cache ya coincide, ni intentamos escribir.
      if (normNombre(fila.estado_cache) === normNombre(nombre)) return;

      // Persistir (negocios + alertas) y notificar UNA vez si fue transición real.
      const cambio = await persistirYNotificar(codigo, nombre, notificar);
      if (cambio) {
        stats.actualizadas++;
        console.log(`[refrescar-estados] ${codigo}: ${fila.estado_cache ?? '—'} → ${nombre}`);
      }
    } catch (e) {
      stats.errores++;
      console.error(`[refrescar-estados] "${codigo}" falló:`, String(e));
    }
  };

  // Concurrencia limitada (no golpear MP en ráfaga).
  let i = 0;
  const workers = Array.from({ length: Math.min(CODIGO_CONCURRENCIA, filas.length) }, async () => {
    while (i < filas.length) {
      const idx = i++;
      await procesarCodigo(filas[idx]);
    }
  });
  await Promise.all(workers);

  stats.codigos = filas.length;
  return stats;
}

// Refresco PUNTUAL de UN código (sensación de tiempo real al abrir el detalle de un negocio).
// Cache-first en el sentido de que solo escribe si el estado definitivo de la API difiere del
// cacheado. Devuelve el nombre canónico persistido, o null si no cambió / no se pudo consultar.
export async function refrescarEstadoCodigo(
  codigo: string,
  estadoCache: string | null,
  timeoutMs = TIMEOUT_DETALLE_MS,
): Promise<string | null> {
  try {
    const client = getMercadoPublicoClient();
    const lic = await client.obtenerPorCodigoRapido(codigo, timeoutMs);
    if (!lic) return null;
    const nombre = estadoDefinitivoCanonico(lic);
    if (!nombre) return null;
    if (normNombre(estadoCache) === normNombre(nombre)) return null;
    const cambio = await persistirYNotificar(codigo, nombre);
    if (cambio) console.log(`[refrescar-estados] on-demand ${codigo}: ${estadoCache ?? '—'} → ${nombre}`);
    // Devuelve el nombre aunque no haya "cambio" nuevo (otra corrida pudo escribirlo): el detalle
    // igual debe reflejar el estado terminal actual.
    return nombre;
  } catch (e) {
    console.error(`[refrescar-estados] on-demand "${codigo}" falló:`, String(e));
    return null;
  }
}

// ── Refresco RODANTE del RADAR completo (alertas_licitaciones) ────────────────────────────────
// Para capturar Revocada/Desierta/Adjudicada en TODO el radar (no solo asignadas). Como son ~10k y
// la API tiene tope de tasa, se procesa un LOTE por corrida, priorizando por cierre DESC (las más
// recientes primero: es donde ocurren las transiciones que importan en tiempo real). Se excluyen las
// que YA tienen un estado DEFINITIVO de API (Desierta/Adjudicada/Revocada) → esas dejan de gastar
// llamadas y el foco se corre naturalmente hacia el resto. Las "Cerrada"/"Publicada" recientes se
// re-consultan (una Cerrada puede pasar a Adjudicada semanas después). SILENCIOSO: no notifica (el
// radar no está asignado a nadie); si un código además es un negocio, el refresco de asignadas avisa.
export async function refrescarEstadosRadar(
  opts: { limite?: number; presupuestoMs?: number; timeoutMs?: number } = {},
): Promise<{ codigos: number; actualizadas: number; errores: number }> {
  const limite        = opts.limite ?? 400;
  const presupuestoMs = opts.presupuestoMs ?? PRESUPUESTO_MS;
  const timeoutMs      = opts.timeoutMs ?? TIMEOUT_DETALLE_MS;
  const stats = { codigos: 0, actualizadas: 0, errores: 0 };
  const inicio = Date.now();

  let codigos: string[] = [];
  try {
    // Candidatas: radar sin estado DEFINITIVO de API todavía (Publicada/Cerrada/otros), por cierre
    // DESC (recientes primero). Un código puede tener varias filas → DISTINCT.
    const [rows] = await pool.query(
      `SELECT licitacion_codigo AS codigo
       FROM alertas_licitaciones
       WHERE (licitacion_estado IS NULL
              OR licitacion_estado NOT IN ('Desierta','Adjudicada','Revocada'))
       GROUP BY licitacion_codigo
       ORDER BY MAX(licitacion_cierre) DESC
       LIMIT ${Math.max(1, limite)}`,
    ) as any[];
    codigos = (rows as Array<{ codigo: string }>).map(r => r.codigo);
  } catch (e) {
    console.error('[refrescar-estados] radar carga inicial falló:', String(e));
    return stats;
  }
  if (codigos.length === 0) return stats;

  const client = getMercadoPublicoClient();
  const procesar = async (codigo: string) => {
    if (Date.now() - inicio > presupuestoMs) return;
    try {
      const lic = await client.obtenerPorCodigoRapido(codigo, timeoutMs);
      if (!lic) return;
      const nombre = estadoDefinitivoCanonico(lic);
      if (!nombre) return;                          // sigue publicada → nada que persistir
      const cambio = await persistirYNotificar(codigo, nombre, false); // radar = silencioso
      if (cambio) stats.actualizadas++;
    } catch (e) {
      stats.errores++;
      console.error(`[refrescar-estados] radar "${codigo}" falló:`, String(e));
    }
  };

  let i = 0;
  const workers = Array.from({ length: Math.min(CODIGO_CONCURRENCIA, codigos.length) }, async () => {
    while (i < codigos.length) await procesar(codigos[i++]);
  });
  await Promise.all(workers);
  stats.codigos = codigos.length;
  if (stats.actualizadas) console.log(`[refrescar-estados] radar: ${stats.actualizadas} actualizadas de ${stats.codigos} consultadas`);
  return stats;
}
