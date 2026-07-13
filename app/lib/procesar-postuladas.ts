// app/lib/procesar-postuladas.ts
// Recorrido sobre las licitaciones POSTULADAS (negocios activos en estado POSTULADA) que ya
// cerraron. Por cada CÓDIGO se consulta el detalle (API de MP) y, si MP ya adjudicó
// (CodigoEstado 8), la postulada se auto-promueve a:
//   · ADJUDICADA  → si una de NUESTRAS empresas ganó ≥1 línea (por RUT).
//   · PERDIDA     → si se adjudicó a terceros.
// Se avisa al perfil (campana + SSE) y se refresca adjudicacion_cache. Al salir de POSTULADA,
// la licitación deja de reprocesarse (idempotente) y aparece en /adjudicadas. Esto hace que
// "Análisis de licitación" muestre datos REALES (cuenta por estado_pipeline, que ahora refleja
// el resultado de MP, no el estado puesto a mano).
//
// Usa la API oficial (api.mercadopublico.cl), que NO exige IP chilena → puede correr donde sea.
// La detección de APERTURA es aparte (portal de MP, IP chilena): ver app/lib/detectar-aperturas.ts.
//
// Best-effort y acotado en tiempo: si MP no responde o falta presupuesto, no rompe nada
// (se engancha como paso final del cron /api/cron/alertas).

import pool from '@/app/lib/db';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';
import { registrarEvento } from '@/app/lib/historial';
import { construirDesdeLicitacion, enriquecer, guardarCache } from '@/app/lib/adjudicacion';

const CODIGO_CONCURRENCIA = 4;      // detalles de MP consultados en paralelo
const PRESUPUESTO_MS       = 25_000; // tope de tiempo del paso (margen bajo maxDuration del cron)
const TIMEOUT_DETALLE_MS   = 8_000;  // timeout por llamada a MP

interface FilaPostulada {
  id: number;
  licitacion_codigo: string;
  licitacion_nombre: string | null;
  asignado_a: number;
  usuario_nombre: string | null;
}

function fmtCLP(n: number | null | undefined): string {
  if (!n) return '';
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
}

export async function procesarPostuladas(): Promise<{
  codigos: number; adjudicadas: number; perdidas: number; errores: number;
}> {
  const stats = { codigos: 0, adjudicadas: 0, perdidas: 0, errores: 0 };
  const inicio = Date.now();

  let filas: FilaPostulada[] = [];
  try {
    // Postuladas activas cuyo cierre YA pasó (la adjudicación solo ocurre tras el cierre).
    const [rows] = await pool.query(
      `SELECT n.id, n.licitacion_codigo, n.licitacion_nombre, n.asignado_a,
              u.nombre AS usuario_nombre
       FROM negocios n
       JOIN usuarios u ON u.id = n.asignado_a AND u.activo = TRUE
       WHERE n.activo = TRUE
         AND n.estado_pipeline = 'POSTULADA'
         AND n.licitacion_cierre IS NOT NULL
         AND n.licitacion_cierre < NOW()
       ORDER BY n.licitacion_codigo`,
    ) as any[];
    filas = rows as FilaPostulada[];
  } catch (e) {
    console.error('[procesar-postuladas] carga inicial falló:', String(e));
    return stats;
  }

  if (filas.length === 0) return stats;

  // Agrupar por código: un mismo código puede estar asignado a varios perfiles.
  const porCodigo = new Map<string, FilaPostulada[]>();
  for (const f of filas) {
    const arr = porCodigo.get(f.licitacion_codigo) || [];
    arr.push(f);
    porCodigo.set(f.licitacion_codigo, arr);
  }
  const codigos = Array.from(porCodigo.keys());

  const client = getMercadoPublicoClient();

  // Procesa UN código: 1 llamada a MP → resultado (promoción) y/o apertura.
  const procesarCodigo = async (codigo: string) => {
    if (Date.now() - inicio > PRESUPUESTO_MS) return; // sin presupuesto → salta (se retoma la próxima corrida)
    const negocios = porCodigo.get(codigo) || [];
    try {
      const lic = await client.obtenerPorCodigoRapido(codigo, TIMEOUT_DETALLE_MS);
      if (!lic) return;

      const adj = await enriquecer(construirDesdeLicitacion(lic, codigo));
      // Refrescar el cache que lee el apartado Postuladas (best-effort).
      await guardarCache(codigo, adj);

      if (adj.esAdjudicada) {
        // ── RESULTADO: promover cada negocio del código ──
        const nuevoEstado = adj.ganamos ? 'ADJUDICADA' : 'PERDIDA';
        for (const n of negocios) {
          await pool.query(
            `UPDATE negocios SET estado_pipeline = ?, updated_at = NOW()
             WHERE id = ? AND estado_pipeline = 'POSTULADA'`,
            [nuevoEstado, n.id],
          );
          if (adj.ganamos) stats.adjudicadas++; else stats.perdidas++;

          const mensaje = adj.ganamos
            ? `🏆 ¡Adjudicada! Ganaste ${n.licitacion_nombre || codigo}${adj.montoNuestro ? ` · ${fmtCLP(adj.montoNuestro)}` : ''}`
            : `Resultado publicado: ${n.licitacion_nombre || codigo} se adjudicó a terceros`;
          await registrarEvento({
            tipo: 'RESULTADO_ADJUDICACION',
            licitacionCodigo: codigo, licitacionNombre: n.licitacion_nombre,
            usuarioId: n.asignado_a, usuarioNombre: n.usuario_nombre,
            actorId: null, actorNombre: 'Mercado Público',
            mensaje,
            metadata: {
              licitacion_codigo: codigo, resultado: adj.ganamos ? 'ganada' : 'perdida',
              monto_nuestro: adj.montoNuestro, url_acta: adj.adjudicacion?.urlActa ?? null,
            },
          });
        }
      }
    } catch (e) {
      stats.errores++;
      console.error(`[procesar-postuladas] "${codigo}" falló:`, String(e));
    }
  };

  // Concurrencia limitada (no golpear MP en ráfaga).
  let i = 0;
  const workers = Array.from({ length: Math.min(CODIGO_CONCURRENCIA, codigos.length) }, async () => {
    while (i < codigos.length) {
      const idx = i++;
      await procesarCodigo(codigos[idx]);
    }
  });
  await Promise.all(workers);

  stats.codigos = codigos.length;
  return stats;
}
