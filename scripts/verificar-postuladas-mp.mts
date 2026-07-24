// Verifica contra la API OFICIAL de Mercado Público (no la etiqueta manual de Licitalab) el
// resultado real de cada postulada sin caché de adjudicación confirmado — el hueco que dejó el
// backfill de scripts/backfill-postuladas-licitalab.mts (138 negocios con estado_pipeline puesto
// a mano, sin que MP lo haya confirmado todavía).
//
// Por cada código: consulta MP, guarda adjudicacion_cache (fuente que YA lee /postuladas tras el
// fix de resultadoDeNegocio), y CORRIGE estado_pipeline si MP dice algo distinto de la etiqueta:
//   · MP dice adjudicada y ganamos (RUT)        → ADJUDICADA
//   · MP dice adjudicada y ganó un tercero      → PERDIDA
//   · MP dice Desierta/Revocada (cerrado SIN adjudicar a nadie) → PERDIDA. Es terminal para
//     siempre (no va a "resolverse" después) y no ganamos nada, así que aunque no exista un
//     ganador tampoco es "aún pendiente" — encontrado en el spot-check (1230848-29-LE26 Desierta,
//     3986-34-LE26 Revocada): ambos habrían quedado mostrando "vuelve a POSTULADA" como si
//     siguieran en trámite, y ya nunca van a moverse de ahí.
//   · Cualquier otro caso (Publicada/Cerrada sin resultado aún) → vuelve a POSTULADA (la etiqueta
//     de Licitalab se adelantó o el acta todavía no se publica; no inventamos un resultado que
//     MP no dio, esto SÍ puede resolverse más adelante).
//
// Sin notificaciones (a propósito): esto es ponerse al día con datos de hace meses, no "noticias"
// para el equipo — llamar a procesarPostuladas() tal cual habría mandado ~100 campanazos de golpe
// a 3 perfiles por resultados que ya conocían desde Licitalab. Se reusan las mismas piezas
// (construirDesdeLicitacion/enriquecer/guardarCache) que sí usa el cron real.
//
//   npx tsx scripts/verificar-postuladas-mp.mts --dry      (default: no escribe estado_pipeline,
//                                                            pero SÍ guarda el caché — es de solo
//                                                            lectura respecto de MP, no de la BD)
//   npx tsx scripts/verificar-postuladas-mp.mts --commit    (corrige estado_pipeline si difiere)
import { cargarEnv } from './regresion/_env.js';
cargarEnv();
const pool = (await import('../app/lib/db.js')).default;
const { getMercadoPublicoClient } = await import('../app/lib/mercado-publico.js');
const { construirDesdeLicitacion, enriquecer, guardarCache } = await import('../app/lib/adjudicacion.js');

const COMMIT = process.argv.includes('--commit');
const CONCURRENCIA = 4;
const TIMEOUT_MS = 8_000;

const [rows] = await pool.query(
  `SELECT n.id, n.licitacion_codigo, n.estado_pipeline
     FROM negocios n
     LEFT JOIN adjudicacion_cache c
       ON c.licitacion_codigo COLLATE utf8mb4_general_ci = n.licitacion_codigo COLLATE utf8mb4_general_ci
    WHERE n.activo = 1
      AND n.estado_pipeline IN ('POSTULADA','POSIBLE_ADJ','ADJUDICADA','PERDIDA')
      AND (c.licitacion_codigo IS NULL OR c.es_adjudicada = 0)
    ORDER BY n.licitacion_codigo`,
) as any;
const filas = rows as Array<{ id: number; licitacion_codigo: string; estado_pipeline: string }>;
console.log(`${filas.length} negocios sin confirmación real de MP. Consultando (${COMMIT ? 'COMMIT' : 'dry'})…\n`);

const porCodigo = new Map<string, typeof filas>();
for (const f of filas) { const a = porCodigo.get(f.licitacion_codigo) || []; a.push(f); porCodigo.set(f.licitacion_codigo, a); }
const codigos = Array.from(porCodigo.keys());

const client = getMercadoPublicoClient();
let confirmadas = 0, corregidas = 0, aunSinResultado = 0, desiertaRevocada = 0, errores = 0, con429 = 0;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Mismo criterio por NOMBRE que refrescar-estados.ts (TERMINALES_POR_NOMBRE): MP usa códigos
// inconsistentes para el mismo estado (Revocada llegó como CodigoEstado 15, no 18, en el propio
// spot-check de hoy) — el texto es la señal confiable.
function normNombre(s: string | number | null | undefined): string {
  return (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
function esDesiertaORevocada(lic: { EstadoNombre?: string | null }): boolean {
  const t = normNombre(lic.EstadoNombre);
  return /desiert/.test(t) || /revocad/.test(t);
}

// Mismo patrón de backoff que refrescar-estados.ts (obtenerConReintento): en ráfaga con
// concurrencia 4, MP responde 429 en la mayoría de las llamadas — medido en vivo por ese módulo
// (14/20 con 429). obtenerPorCodigoRapido NO distingue eso de "no existe" y devuelve null en
// silencio, perdiendo el trabajo. obtenerDetalleConEstado sí expone el status → reintenta con
// espera creciente en vez de darse por vencido al primer 429.
async function obtenerConReintento(codigo: string, maxReintentos = 4, baseDelayMs = 900, maxDelayMs = 8_000) {
  let delay = baseDelayMs;
  for (let intento = 0; intento <= maxReintentos; intento++) {
    const { lic, status } = await client.obtenerDetalleConEstado(codigo, TIMEOUT_MS);
    if (status !== 429) return lic;
    con429++;
    if (intento === maxReintentos) return null;
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.7), maxDelayMs);
  }
  return null;
}

let i = 0;
const worker = async () => {
  while (i < codigos.length) {
    const codigo = codigos[i++];
    const negs = porCodigo.get(codigo)!;
    try {
      const lic = await obtenerConReintento(codigo);
      if (!lic) { console.log(`⚠ ${codigo}: MP no devolvió datos (agotó reintentos)`); errores++; continue; }

      const adj = await enriquecer(construirDesdeLicitacion(lic, codigo));
      if (COMMIT) await guardarCache(codigo, adj);

      if (!adj.esAdjudicada) {
        if (esDesiertaORevocada(lic)) {
          // Cerrado para siempre, sin ganador: no es "pendiente", es PERDIDA (no ganamos nada).
          desiertaRevocada++;
          const distintos = negs.filter(n => n.estado_pipeline !== 'PERDIDA');
          if (distintos.length) {
            console.log(`⊘ ${codigo}: MP dice ${lic.EstadoNombre} (cerrado sin adjudicar, tenía ${distintos[0].estado_pipeline}) → PERDIDA`);
            if (COMMIT) for (const n of distintos) await pool.query(`UPDATE negocios SET estado_pipeline='PERDIDA', updated_at=NOW() WHERE id=?`, [n.id]);
          }
          continue;
        }
        // MP aún no publica resultado oficial: la etiqueta de Licitalab (ADJUDICADA/PERDIDA) se
        // adelantó. Vuelve a POSTULADA — no inventamos un resultado que MP no dio.
        aunSinResultado++;
        const distintos = negs.filter(n => n.estado_pipeline !== 'POSTULADA');
        if (distintos.length) {
          console.log(`↩ ${codigo}: MP dice SIN RESOLVER aún (${lic.EstadoNombre}, tenía ${distintos[0].estado_pipeline}) → vuelve a POSTULADA`);
          if (COMMIT) for (const n of distintos) await pool.query(`UPDATE negocios SET estado_pipeline='POSTULADA', updated_at=NOW() WHERE id=?`, [n.id]);
        }
        continue;
      }

      const real = adj.ganamos ? 'ADJUDICADA' : 'PERDIDA';
      const distintos = negs.filter(n => n.estado_pipeline !== real);
      if (distintos.length) {
        console.log(`✎ ${codigo}: MP confirma ${real}${adj.ganamos && adj.montoNuestro ? ` ($${adj.montoNuestro.toLocaleString('es-CL')})` : ''} (Licitalab decía ${distintos[0].estado_pipeline}) → corrigiendo`);
        corregidas++;
        if (COMMIT) for (const n of distintos) await pool.query(`UPDATE negocios SET estado_pipeline=?, updated_at=NOW() WHERE id=?`, [real, n.id]);
      } else {
        confirmadas++;
      }
    } catch (e) {
      errores++;
      console.log(`✗ ${codigo}: ${String(e).slice(0, 140)}`);
    }
  }
};
await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, codigos.length) }, worker));

console.log(`\n${COMMIT ? 'APLICADO' : 'DRY-RUN'} — ${codigos.length} códigos consultados a MP:`);
console.log(`  Confirmados tal cual (coincide con Licitalab): ${confirmadas}`);
console.log(`  Corregidos (MP decía otra cosa): ${corregidas}`);
console.log(`  Aún sin resultado oficial en MP → vuelto a POSTULADA: ${aunSinResultado}`);
console.log(`  Desierta/Revocada (cerrado sin ganador) → PERDIDA: ${desiertaRevocada}`);
console.log(`  Errores/timeouts (sin tocar, reintentar después): ${errores}`);
console.log(`  (rate-limit 429 recibidos y absorbidos por reintento: ${con429})`);
if (!COMMIT) console.log('\nEsto fue una SIMULACIÓN (ni el caché ni estado_pipeline se tocaron). Corre con --commit para aplicar.');
await pool.end();
