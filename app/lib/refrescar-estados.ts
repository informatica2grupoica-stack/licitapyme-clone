// app/lib/refrescar-estados.ts
// Capa 2 del estado de Mercado Público: refresco AUTORITATIVO desde la API para las licitaciones
// ASIGNADAS (negocios) que siguen vivas. El estado (CodigoEstado) se cachea al asignar y NO se
// actualiza solo; estado-mp.ts (Capa 1) solo deriva Publicada→Cerrada por FECHA. Los estados
// terminales que la fecha NO puede saber —Cerrada(6), Desierta(7), Adjudicada(8), Revocada(18),
// Suspendida(19)— requieren consultar la API. Aquí, por cada código asignado vivo, 1 llamada a MP;
// si el estado real difiere y es DEFINITIVO, se escribe `licitacion_estado` en AMBAS tablas:
//   · negocios  → lo ven el detalle del negocio, la lista y Análisis.
//   · alertas   → lo ve el radar/buscador (las asignadas también viven ahí).
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

const CODIGO_CONCURRENCIA = 4;       // detalles de MP consultados en paralelo
const PRESUPUESTO_MS       = 25_000; // tope de tiempo del paso (margen bajo maxDuration del cron)
const TIMEOUT_DETALLE_MS   = 8_000;  // timeout por llamada a MP
const MAX_CODIGOS          = 400;    // backstop de cuántos códigos se sondean por corrida

// Estados DEFINITIVOS que solo la API sabe (la fecha no los deriva). Si MP reporta uno de estos
// y difiere del cacheado, se persiste. Publicada(5) no se persiste (no aporta sobre la fecha).
const ESTADOS_DEFINITIVOS = new Set([6, 7, 8, 18, 19]);

// Estados del pipeline YA resueltos: no se refrescan aquí (POSTULADA la maneja procesar-postuladas).
const PIPELINE_RESUELTOS = ['POSTULADA', 'ADJUDICADA', 'PERDIDA', 'DESCARTADA'];

export async function refrescarEstadosAsignadas(
  opts: { presupuestoMs?: number; timeoutMs?: number } = {},
): Promise<{ codigos: number; actualizadas: number; errores: number }> {
  const presupuestoMs = opts.presupuestoMs ?? PRESUPUESTO_MS;
  const timeoutMs      = opts.timeoutMs ?? TIMEOUT_DETALLE_MS;
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

      const nuevoCodigo = codigoEstadoMP(lic.CodigoEstado ?? lic.EstadoNombre ?? null);
      if (nuevoCodigo == null) return;

      // Solo persistimos estados DEFINITIVOS que además DIFIEREN del cacheado (evita escrituras inútiles).
      const cacheCodigo = codigoEstadoMP(fila.estado_cache);
      if (!ESTADOS_DEFINITIVOS.has(nuevoCodigo) || nuevoCodigo === cacheCodigo) return;

      const nombre = CODIGO_ESTADO_MP[nuevoCodigo];
      if (!nombre) return;

      // Escribir en AMBAS tablas por código (negocios = detalle/lista; alertas = radar/buscador).
      await pool.query(
        `UPDATE negocios SET licitacion_estado = ?, updated_at = NOW() WHERE licitacion_codigo = ? AND activo = TRUE`,
        [nombre, codigo],
      );
      await pool.query(
        `UPDATE alertas SET licitacion_estado = ? WHERE licitacion_codigo = ?`,
        [nombre, codigo],
      ).catch(() => { /* la fila puede no existir en alertas: no rompe */ });

      stats.actualizadas++;
      console.log(`[refrescar-estados] ${codigo}: ${fila.estado_cache ?? '—'} → ${nombre}`);
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
    const nuevoCodigo = codigoEstadoMP(lic.CodigoEstado ?? lic.EstadoNombre ?? null);
    if (nuevoCodigo == null) return null;
    const cacheCodigo = codigoEstadoMP(estadoCache);
    if (!ESTADOS_DEFINITIVOS.has(nuevoCodigo) || nuevoCodigo === cacheCodigo) return null;
    const nombre = CODIGO_ESTADO_MP[nuevoCodigo];
    if (!nombre) return null;
    await pool.query(
      `UPDATE negocios SET licitacion_estado = ?, updated_at = NOW() WHERE licitacion_codigo = ? AND activo = TRUE`,
      [nombre, codigo],
    );
    await pool.query(
      `UPDATE alertas SET licitacion_estado = ? WHERE licitacion_codigo = ?`,
      [nombre, codigo],
    ).catch(() => {});
    console.log(`[refrescar-estados] on-demand ${codigo}: ${estadoCache ?? '—'} → ${nombre}`);
    return nombre;
  } catch (e) {
    console.error(`[refrescar-estados] on-demand "${codigo}" falló:`, String(e));
    return null;
  }
}
