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
// SEGUNDA PASADA (agregada 2026-07-21, caso real 3253-67-LE26): una licitación puede quedar en
// ADJUDICADA/PERDIDA puesta A MANO (alguien cambia el pipeline por un comentario) ANTES de que
// MP publique el acta oficial. Como esa licitación ya NO está en POSTULADA, el barrido de arriba
// nunca la vuelve a mirar y su cache queda pegado en el dato viejo para siempre. Esta segunda
// pasada busca justo esas: ADJUDICADA/PERDIDA cuyo cache todavía no confirma `es_adjudicada=1`,
// las reconsulta contra MP y corrige el cache (y el estado, si MP dice algo distinto a lo puesto
// a mano). El conjunto es chico por diseño (se autoexcluye apenas el cache confirma), así que un
// presupuesto de tiempo corto le alcanza.
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
import { abrirEntregaSiCorresponde } from '@/app/lib/entrega-proyecto';
import { publicarCambio } from '@/app/lib/sse-bus';
import { idsEquivalentes, normalizarEstado } from '@/app/lib/pipeline';

// IDs (vigente + legados) que cuentan como "postulada" / "adjudicada" / "perdida" — ver misma
// nota en detectar-aperturas.ts.
const ESTADOS_POSTULADA = idsEquivalentes('POSTULADA');
const IN_POSTULADA = ESTADOS_POSTULADA.map(() => '?').join(', ');
const ESTADOS_RESUELTAS = [...idsEquivalentes('ADJUDICADA'), ...idsEquivalentes('PERDIDA')];
const IN_RESUELTAS = ESTADOS_RESUELTAS.map(() => '?').join(', ');

const CODIGO_CONCURRENCIA = 4;      // detalles de MP consultados en paralelo
const PRESUPUESTO_MS       = 25_000; // tope de tiempo del paso principal (margen bajo maxDuration del cron)
const PRESUPUESTO_RECONFIRMAR_MS = 15_000; // tope de la 2ª pasada (conjunto chico, no compite por tiempo)
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

export async function procesarPostuladas(
  opts: { promover?: boolean; soloCerradas?: boolean; presupuestoMs?: number } = {},
): Promise<{
  codigos: number; procesados: number; sinPresupuesto: number;
  adjudicadas: number; perdidas: number; errores: number; entregasAbiertas: number;
}> {
  // promover: si mueve la postulada a ADJUDICADA/PERDIDA (saca de Postuladas). El usuario pidió
  //   que las adjudicadas SE QUEDEN en Postuladas → el cron de 2h llama con promover:false y solo
  //   refresca el cache (estado + adjudicación) para KPIs/filtros instantáneos.
  // soloCerradas: si limita a las que ya cerraron. false = también refresca las Publicadas
  //   (abiertas), para que el filtro por estado en Postuladas tenga el estado real al día.
  // presupuestoMs: tope de ESTE paso, pasado por el llamador según lo que ya gastó del maxDuration
  //   del cron. Sin esto, este paso siempre asumía un presupuesto fresco de PRESUPUESTO_MS aunque
  //   los pasos anteriores ya hubieran consumido casi todo el tiempo disponible.
  const promover     = opts.promover     ?? true;
  const soloCerradas = opts.soloCerradas ?? true;
  const presupuestoMs = opts.presupuestoMs ?? PRESUPUESTO_MS;
  // `codigos` = candidatos totales · `procesados` = los que alcanzaron a consultarse ·
  // `sinPresupuesto` = los que quedaron fuera por tiempo (van primeros en la próxima corrida).
  const stats = { codigos: 0, procesados: 0, sinPresupuesto: 0, adjudicadas: 0, perdidas: 0, errores: 0, entregasAbiertas: 0 };
  const inicio = Date.now();

  let filas: FilaPostulada[] = [];
  try {
    // Postuladas activas (opcionalmente solo las que ya cerraron: la adjudicación solo ocurre tras el cierre).
    //
    // ORDEN = ROTACIÓN (no alfabético). Con `ORDER BY licitacion_codigo` el orden era ESTABLE entre
    // corridas: si había más códigos de los que caben en PRESUPUESTO_MS, cada corrida procesaba
    // exactamente los mismos primeros N y la cola larga NO se revisaba nunca (inanición permanente,
    // no "se retoma la próxima corrida"). Ordenar por `consultado_en` del cache —las nunca
    // consultadas primero (NULL), después las más antiguas— hace que el presupuesto ROTE: lo que
    // no alcanzó hoy queda de primero mañana. Con eso la cobertura es completa aunque cada corrida
    // solo alcance a mirar una parte.
    const [rows] = await pool.query(
      `SELECT n.id, n.licitacion_codigo, n.licitacion_nombre, n.asignado_a,
              u.nombre AS usuario_nombre
       FROM negocios n
       JOIN usuarios u ON u.id = n.asignado_a AND u.activo = TRUE
       LEFT JOIN adjudicacion_cache c
         ON c.licitacion_codigo COLLATE utf8mb4_general_ci = n.licitacion_codigo COLLATE utf8mb4_general_ci
       WHERE n.activo = TRUE
         AND n.estado_pipeline IN (${IN_POSTULADA})
         ${soloCerradas ? 'AND n.licitacion_cierre IS NOT NULL AND n.licitacion_cierre < NOW()' : ''}
       ORDER BY (c.consultado_en IS NOT NULL), c.consultado_en ASC, n.licitacion_codigo`,
      ESTADOS_POSTULADA,
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
    // Sin presupuesto → salta. Gracias al ORDER BY por `consultado_en`, estas quedan de PRIMERAS
    // en la próxima corrida (antes se saltaban siempre las mismas y no se revisaban nunca).
    if (Date.now() - inicio > presupuestoMs) { stats.sinPresupuesto++; return; }
    const negocios = porCodigo.get(codigo) || [];
    stats.procesados++;
    try {
      const lic = await client.obtenerPorCodigoRapido(codigo, TIMEOUT_DETALLE_MS);
      if (!lic) return;

      const adj = await enriquecer(construirDesdeLicitacion(lic, codigo));
      // Refrescar el cache que lee el apartado Postuladas (best-effort). Esto es lo ÚNICO que
      // hace el cron de 2h (promover:false) → las adjudicadas se quedan en Postuladas.
      await guardarCache(codigo, adj);

      if (adj.esAdjudicada && promover) {
        // ── RESULTADO: promover cada negocio del código ──
        const nuevoEstado = adj.ganamos ? 'ADJUDICADA' : 'PERDIDA';
        for (const n of negocios) {
          const [upd] = await pool.query(
            `UPDATE negocios SET estado_pipeline = ?, updated_at = NOW()
             WHERE id = ? AND estado_pipeline IN (${IN_POSTULADA})`,
            [nuevoEstado, n.id, ...ESTADOS_POSTULADA],
          ) as any;
          // Solo cuenta como resultado NUEVO si el UPDATE movió la fila de verdad. Si otra
          // corrida (o alguien a mano) ya la había sacado de POSTULADA, no se vuelve a avisar.
          if (!upd?.affectedRows) continue;
          // El auto-avance POSTULADA→ADJUDICADA/PERDIDA es tan real como un PATCH manual — los
          // tableros de otros perfiles (admin viendo Postuladas/Adjudicadas ajenas, el dashboard)
          // deben enterarse en vivo, no solo el dueño del negocio vía la campana (auditoría ago-2026).
          publicarCambio('negocio');

          // ── ENTREGA DE PROYECTOS (Frente F.1) ──
          // Ganamos → se abre la entrega y arranca el circuito de acuse de recibo. Va atado a la
          // TRANSICIÓN (affectedRows), no al estado: por eso las adjudicadas que ya estaban en la
          // base antes de este módulo no disparan una avalancha de avisos retroactivos.
          if (adj.ganamos) {
            await abrirEntregaSiCorresponde(n.id, codigo, n.asignado_a)
              .then(abierta => { if (abierta) stats.entregasAbiertas++; })
              .catch(e => console.error('[procesar-postuladas] abrir entrega falló:', String(e).slice(0, 200)));
          }

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

  // ── 2ª pasada: reconfirmar ADJUDICADA/PERDIDA cuyo cache aún no lo confirma ────────────
  if (promover) await reconfirmarResueltasSinCache(client, stats);

  return stats;
}

// Busca negocios YA en ADJUDICADA/PERDIDA (puestos a mano o por una promoción vieja) cuyo
// adjudicacion_cache todavía no tiene es_adjudicada=1 — o sea, nadie los volvió a chequear contra
// MP desde que alguien cambió el pipeline. Los reconsulta, refresca el cache y, si MP confirma
// algo DISTINTO de lo puesto a mano (ganamos vs perdimos), corrige el estado y avisa — la fuente
// de verdad es siempre el acta de MP, no el estado interno.
async function reconfirmarResueltasSinCache(
  client: ReturnType<typeof getMercadoPublicoClient>,
  stats: { adjudicadas: number; perdidas: number; errores: number; entregasAbiertas: number },
): Promise<void> {
  const inicio = Date.now();
  let filas: FilaPostulada[] = [];
  try {
    const [rows] = await pool.query(
      `SELECT n.id, n.licitacion_codigo, n.licitacion_nombre, n.asignado_a, n.estado_pipeline,
              u.nombre AS usuario_nombre
       FROM negocios n
       JOIN usuarios u ON u.id = n.asignado_a AND u.activo = TRUE
       LEFT JOIN adjudicacion_cache c
         ON c.licitacion_codigo COLLATE utf8mb4_general_ci = n.licitacion_codigo COLLATE utf8mb4_general_ci
       WHERE n.activo = TRUE
         AND n.estado_pipeline IN (${IN_RESUELTAS})
         AND (c.licitacion_codigo IS NULL OR c.es_adjudicada = 0)
       ORDER BY (c.consultado_en IS NOT NULL), c.consultado_en ASC, n.licitacion_codigo`,
      ESTADOS_RESUELTAS,
    ) as any[];
    filas = rows as (FilaPostulada & { estado_pipeline: string })[];
  } catch (e) {
    console.error('[procesar-postuladas] reconfirmar: carga falló:', String(e));
    return;
  }
  if (filas.length === 0) return;

  const porCodigo = new Map<string, (FilaPostulada & { estado_pipeline: string })[]>();
  for (const f of filas as (FilaPostulada & { estado_pipeline: string })[]) {
    const arr = porCodigo.get(f.licitacion_codigo) || [];
    arr.push(f);
    porCodigo.set(f.licitacion_codigo, arr);
  }
  const codigos = Array.from(porCodigo.keys());

  const procesarUno = async (codigo: string) => {
    if (Date.now() - inicio > PRESUPUESTO_RECONFIRMAR_MS) return;
    const negocios = porCodigo.get(codigo) || [];
    try {
      const lic = await client.obtenerPorCodigoRapido(codigo, TIMEOUT_DETALLE_MS);
      if (!lic) return;
      const adj = await enriquecer(construirDesdeLicitacion(lic, codigo));
      await guardarCache(codigo, adj);
      if (!adj.esAdjudicada) return; // MP aún no publica el acta — nada que corregir todavía

      const resultadoReal = adj.ganamos ? 'ADJUDICADA' : 'PERDIDA';
      for (const n of negocios) {
        if (normalizarEstado(n.estado_pipeline) === resultadoReal) continue; // coincide con lo puesto a mano (o su alias legado): solo hacía falta el cache
        // MP dice algo DISTINTO de lo que había a mano → corrige y avisa (la verdad es el acta).
        await pool.query(`UPDATE negocios SET estado_pipeline = ?, updated_at = NOW() WHERE id = ?`, [resultadoReal, n.id]);
        publicarCambio('negocio');
        // Caso real: alguien la había marcado PERDIDA a mano y el acta dice que ganamos. Es una
        // victoria que nadie sabía que existía → también abre la entrega.
        if (adj.ganamos) {
          await abrirEntregaSiCorresponde(n.id, codigo, n.asignado_a)
            .then(abierta => { if (abierta) stats.entregasAbiertas++; })
            .catch(e => console.error('[procesar-postuladas] abrir entrega (reconfirmar) falló:', String(e).slice(0, 200)));
        }
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
            corregido_desde: n.estado_pipeline,
          },
        });
      }
    } catch (e) {
      stats.errores++;
      console.error(`[procesar-postuladas] reconfirmar "${codigo}" falló:`, String(e));
    }
  };

  let i = 0;
  const workers = Array.from({ length: Math.min(CODIGO_CONCURRENCIA, codigos.length) }, async () => {
    while (i < codigos.length) {
      const idx = i++;
      await procesarUno(codigos[idx]);
    }
  });
  await Promise.all(workers);
}
