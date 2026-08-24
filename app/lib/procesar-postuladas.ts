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
import { ahoraChileSQL } from '@/app/lib/tz';
import { construirDesdeLicitacion, enriquecer, guardarCache } from '@/app/lib/adjudicacion';
import { abrirEntregaSiCorresponde } from '@/app/lib/entrega-proyecto';
import { publicarCambio } from '@/app/lib/sse-bus';
import { idsEquivalentes, normalizarEstado } from '@/app/lib/pipeline';
import { avisarResultadoLicitacion } from '@/app/lib/avisar-resultado-licitacion';

// IDs (vigente + legados) que cuentan como "postulada" / "adjudicada" / "perdida" — ver misma
// nota en detectar-aperturas.ts.
const ESTADOS_POSTULADA = idsEquivalentes('POSTULADA');
const IN_POSTULADA = ESTADOS_POSTULADA.map(() => '?').join(', ');
const ESTADOS_RESUELTAS = [...idsEquivalentes('ADJUDICADA'), ...idsEquivalentes('PERDIDA')];
const IN_RESUELTAS = ESTADOS_RESUELTAS.map(() => '?').join(', ');

// MP rechaza las ráfagas con HTTP 429 "peticiones simultáneas" (verificado en vivo el
// 24-ago-2026: en lote de 4 en paralelo devolvía 429 a buena parte de las ~58 postuladas, y cada
// 429 era una licitación que se daba por NO adjudicada). Se consulta DE A UNA, con pausa entre
// consultas, en lotes rotativos — y si MP igual nos frena, el freno de más abajo corta la corrida.
const CODIGO_CONCURRENCIA = 1;      // MP rechaza las "peticiones simultáneas": de a una
const PAUSA_ENTRE_CONSULTAS_MS = 400; // ritmo entre consultas (evita el 429 por ráfaga)
const MAX_CODIGOS_POR_CORRIDA = 30;   // lote por corrida; la rotación cubre el resto en la siguiente
// 30 códigos × ~0.8s ≈ 25s. 30s + 15s de la 2ª pasada = 45s, bajo el maxDuration=60 del endpoint.
const PRESUPUESTO_MS       = 30_000; // tope de tiempo del paso principal
const PRESUPUESTO_RECONFIRMAR_MS = 15_000; // tope de la 2ª pasada (conjunto chico, no compite por tiempo)
const TIMEOUT_DETALLE_MS   = 8_000;  // timeout por llamada a MP

interface FilaPostulada {
  id: number;
  licitacion_codigo: string;
  licitacion_nombre: string | null;
  asignado_a: number;
  usuario_nombre: string | null;
  usuario_email: string | null;
}

function fmtCLP(n: number | null | undefined): string {
  if (!n) return '';
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
}

export async function procesarPostuladas(
  opts: { promover?: boolean; soloCerradas?: boolean; presupuestoMs?: number; maxCodigos?: number } = {},
): Promise<{
  codigos: number; procesados: number; sinPresupuesto: number;
  adjudicadas: number; perdidas: number; errores: number; entregasAbiertas: number;
  rateLimit: number;   // consultas que MP rechazó por ráfaga (si es >0, algo quedó sin revisar)
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
  // maxCodigos: tope de códigos POR CORRIDA. Con el cron corriendo cada 5 minutos, barrer las ~58
  // postuladas COMPLETAS en cada pasada gatilla el 429 de MP por ráfaga (verificado 24-ago-2026).
  // Un lote chico + la rotación por `consultado_en` (los más rancios primero) cubre igual a todas
  // en pocos minutos, sin pasarse del límite: 30 códigos cada 5 min = las 58 revisadas cada ~10
  // min, contra 1 hora que tardaba antes.
  const maxCodigos = opts.maxCodigos ?? MAX_CODIGOS_POR_CORRIDA;
  // `codigos` = candidatos totales · `procesados` = los que alcanzaron a consultarse ·
  // `sinPresupuesto` = los que quedaron fuera por tiempo (van primeros en la próxima corrida).
  const stats = { codigos: 0, procesados: 0, sinPresupuesto: 0, adjudicadas: 0, perdidas: 0, errores: 0, entregasAbiertas: 0, rateLimit: 0 };
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
    // OJO ZONA HORARIA: NO comparar contra NOW() del servidor MySQL de Bluehost — corre en OTRA
    // zona (verificado en vivo: 2h atrasado respecto a Chile), así que una licitación recién
    // se consideraba "cerrada" (elegible para revisar) hasta 2h después de que cerró de verdad
    // en Chile. Se pasa la hora de pared chilena como parámetro (mismo patrón que el resto del
    // código, ver app/lib/tz.ts).
    const [rows] = await pool.query(
      `SELECT n.id, n.licitacion_codigo, n.licitacion_nombre, n.asignado_a,
              u.nombre AS usuario_nombre, u.email AS usuario_email
       FROM negocios n
       JOIN usuarios u ON u.id = n.asignado_a AND u.activo = TRUE
       LEFT JOIN adjudicacion_cache c
         ON c.licitacion_codigo COLLATE utf8mb4_general_ci = n.licitacion_codigo COLLATE utf8mb4_general_ci
       WHERE n.activo = TRUE
         AND n.estado_pipeline IN (${IN_POSTULADA})
         ${soloCerradas ? 'AND n.licitacion_cierre IS NOT NULL AND n.licitacion_cierre < ?' : ''}
       ORDER BY
         -- PRIORIDAD 1: las que YA deberían estar resolviéndose. La ficha de MP trae la fecha en
         -- que el organismo piensa adjudicar; pasada esa fecha, la licitación puede cambiar a
         -- "Adjudicada" en cualquier momento y es donde el minuto de latencia importa. Las que
         -- aún no llegan a su fecha estimada no van a cambiar hoy: se revisan igual, pero después.
         -- (Caso 1114-12-LE26: estimada 24-ago 15:00, adjudicada ese mismo día.)
         (c.fecha_estimada_adjudicacion IS NOT NULL AND c.fecha_estimada_adjudicacion > ?) ASC,
         -- PRIORIDAD 2: rotación por antigüedad de consulta (nunca consultadas primero).
         (c.consultado_en IS NOT NULL), c.consultado_en ASC, n.licitacion_codigo`,
      soloCerradas
        ? [...ESTADOS_POSTULADA, ahoraChileSQL(), ahoraChileSQL()]
        : [...ESTADOS_POSTULADA, ahoraChileSQL()],
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
  // Tope por corrida. Como `filas` ya viene ordenada por `consultado_en` (los nunca consultados
  // primero, después los más rancios), recortar aquí toma justo los que más lo necesitan y deja
  // el resto de primeros en la próxima corrida — 5 minutos después, no una hora.
  const codigosTodos = Array.from(porCodigo.keys());
  const codigos = maxCodigos > 0 ? codigosTodos.slice(0, maxCodigos) : codigosTodos;
  if (codigos.length < codigosTodos.length) {
    console.log(`[procesar-postuladas] lote de ${codigos.length}/${codigosTodos.length} (rotación por consultado_en); el resto en la próxima corrida.`);
  }

  const client = getMercadoPublicoClient();

  // FRENO ANTE RATE-LIMIT. Si MP nos está frenando, seguir consultando no solo es inútil: cada
  // consulta rechazada es una licitación que se da por NO adjudicada (el fallo se ve igual que un
  // "no"). Ante varios rechazos SEGUIDOS se corta la corrida completa. Lo que quedó sin revisar
  // conserva su `consultado_en` viejo, así que la rotación lo pone de PRIMERO 5 minutos después
  // — no se pierde nada, solo se posterga hasta que MP nos deje de frenar.
  const CORTE_POR_RATE_LIMIT = 3;
  let rateLimitSeguidos = 0;
  let frenado = false;

  // Procesa UN código: 1 llamada a MP → resultado (promoción) y/o apertura.
  const procesarCodigo = async (codigo: string) => {
    // Sin presupuesto → salta. Gracias al ORDER BY por `consultado_en`, estas quedan de PRIMERAS
    // en la próxima corrida (antes se saltaban siempre las mismas y no se revisaban nunca).
    if (frenado || Date.now() - inicio > presupuestoMs) { stats.sinPresupuesto++; return; }
    const negocios = porCodigo.get(codigo) || [];
    stats.procesados++;
    try {
      const lic = await client.obtenerPorCodigoRapido(codigo, TIMEOUT_DETALLE_MS, 3, motivo => {
        if (motivo !== 'rate-limit') { rateLimitSeguidos = 0; return; }
        stats.rateLimit++;
        if (++rateLimitSeguidos >= CORTE_POR_RATE_LIMIT && !frenado) {
          frenado = true;
          console.warn(`[procesar-postuladas] MP nos está frenando (${rateLimitSeguidos} rate-limits seguidos) → se corta la corrida. Lo pendiente va primero en la próxima.`);
        }
      });
      if (lic) rateLimitSeguidos = 0;   // una respuesta buena reinicia la racha
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
          // Correo (asignado+admins) + WhatsApp (admins). Best-effort, no bloquea el cron.
          await avisarResultadoLicitacion({
            tipo: adj.ganamos ? 'ganada' : 'perdida',
            codigo, nombre: n.licitacion_nombre, monto: adj.montoNuestro ?? null,
            asignado: { id: n.asignado_a, nombre: n.usuario_nombre, email: n.usuario_email },
          });
        }
      }
    } catch (e) {
      stats.errores++;
      console.error(`[procesar-postuladas] "${codigo}" falló:`, String(e));
    }
  };

  // Concurrencia limitada + RITMO entre llamadas: MP no limita por cuota diaria sino por ráfaga
  // ("peticiones simultáneas", HTTP 429). Bajar la concurrencia no alcanzaba por sí solo — un
  // barrido de ~58 códigos sin pausa igual gatillaba 429 en más de 10 (medido 24-ago-2026), y
  // cada 429 es una licitación que se da por no adjudicada. La pausa corta entre consultas es lo
  // que mantiene el barrido completo bajo el límite.
  let i = 0;
  const workers = Array.from({ length: Math.min(CODIGO_CONCURRENCIA, codigos.length) }, async (_, w) => {
    // Arranque escalonado para que los workers no salgan todos en el mismo milisegundo.
    if (w > 0) await new Promise(r => setTimeout(r, w * PAUSA_ENTRE_CONSULTAS_MS));
    while (i < codigos.length) {
      const idx = i++;
      await procesarCodigo(codigos[idx]);
      await new Promise(r => setTimeout(r, PAUSA_ENTRE_CONSULTAS_MS));
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
              u.nombre AS usuario_nombre, u.email AS usuario_email
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
        await avisarResultadoLicitacion({
          tipo: adj.ganamos ? 'ganada' : 'perdida',
          codigo, nombre: n.licitacion_nombre, monto: adj.montoNuestro ?? null,
          asignado: { id: n.asignado_a, nombre: n.usuario_nombre, email: n.usuario_email },
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
