// scripts/verificar-estados-mp.mjs
// AUDITORÍA: ¿los estados/resultados que muestra la app son datos REALES de la API de MP?
// Toma una muestra de licitaciones ASIGNADAS (negocios) y, por cada una, consulta la API oficial
// (api.mercadopublico.cl) EN VIVO y compara contra lo guardado en la BD:
//   · licitacion_estado (negocios)              vs  Estado/CodigoEstado en vivo
//   · adjudicacion_cache (es_adjudicada/ganamos) vs  recomputado desde los Items en vivo (por RUT)
// "ganamos" se recalcula igual que la app: alguna línea adjudicada con RUT de NUESTRAS empresas.
// Uso:  node scripts/verificar-estados-mp.mjs [limite]     (limite por defecto = 15)
// OJO: la API pública de MP rate-limitea (429) en ráfaga; el script hace backoff y espacia las
// llamadas ~1.2s. Muestras chicas (10-20) andan bien; para más, córrelo por tandas.
// Solo LECTURA: no escribe nada en la BD.

import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

// ── env ──────────────────────────────────────────────────────────────────────
const env = {};
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const TICKET = env.MERCADO_PUBLICO_TICKET;
if (!TICKET) { console.error('Falta MERCADO_PUBLICO_TICKET en .env.local'); process.exit(1); }
const LIMITE = parseInt(process.argv[2] || '15', 10);

const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});
const q = async (sql, p = []) => (await pool.query(sql, p))[0];

// ── helpers (misma lógica que la app) ─────────────────────────────────────────
const CODIGO_ESTADO = { 5: 'Publicada', 6: 'Cerrada', 7: 'Desierta', 8: 'Adjudicada', 15: 'Revocada', 18: 'Revocada', 19: 'Suspendida' };
const normRut = r => String(r || '').toUpperCase().replace(/[^0-9K]/g, '');
const norm = s => (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Estado canónico a partir del CodigoEstado/Estado crudos de MP (por nombre primero, robusto).
function estadoCanonico(codigoEstado, estadoTexto) {
  const t = norm(estadoTexto);
  for (const [re, nom] of [[/revocad/, 'Revocada'], [/desiert/, 'Desierta'], [/adjudicad/, 'Adjudicada'], [/suspend/, 'Suspendida'], [/cerrad/, 'Cerrada'], [/publicad/, 'Publicada']])
    if (re.test(t)) return nom;
  return CODIGO_ESTADO[Number(codigoEstado)] || estadoTexto || '—';
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchMP(codigo, intentos = 4) {
  const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=${encodeURIComponent(codigo)}&ticket=${TICKET}`;
  let res;
  for (let i = 0; i < intentos; i++) {
    res = await globalThis.fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (res && res.ok) break;
    if (res && res.status === 429) { await sleep(5000 * (i + 1)); continue; } // backoff creciente
    if (!res) { await sleep(2000); continue; }
    break;
  }
  if (!res || !res.ok) return { error: `HTTP ${res?.status ?? 'red'}` };
  const data = await res.json();
  const it = data?.Listado?.[0];
  if (!it) return { error: 'sin Listado' };
  const estado = estadoCanonico(it.CodigoEstado, it.Estado);
  const esAdjudicada = Number(it.CodigoEstado) === 8 || norm(it.Estado).includes('adjudicad');
  const lineas = (it.Items?.Listado || [])
    .filter(l => l.Adjudicacion?.RutProveedor)
    .map(l => ({ rut: l.Adjudicacion.RutProveedor, monto: (Number(l.Adjudicacion.MontoUnitario) || 0) * (Number(l.Adjudicacion.Cantidad) || 1) }));
  return { estado, codigoEstado: Number(it.CodigoEstado), esAdjudicada, lineas, fechaCierre: it.FechaCierre || null };
}

// ── main ──────────────────────────────────────────────────────────────────────
try {
  // RUT de nuestras empresas (para recomputar "ganamos").
  const emp = await q(`SELECT rut FROM empresas WHERE activo = TRUE`).catch(() => []);
  const nuestros = new Set(emp.map(e => normRut(e.rut)).filter(Boolean));
  console.log(`Empresas nuestras: ${nuestros.size} RUT(s) → ${[...nuestros].join(', ') || '(ninguna)'}\n`);

  // Muestra: asignadas vivas, priorizando las que la app marca como resueltas (adjudicada/terminal)
  // y algunas Cerradas, para auditar justo lo que el usuario ve.
  // Dos queries sin JOIN (evita el choque de collation utf8/utf8mb4 entre las dos tablas).
  const negs = await q(
    `SELECT n.licitacion_codigo AS codigo,
            MAX(n.licitacion_estado) AS estado_db,
            MAX(n.estado_pipeline)   AS pipeline
     FROM negocios n
     WHERE n.activo = TRUE
     GROUP BY n.licitacion_codigo`,
  );
  const negMap = new Map(negs.map(n => [n.codigo, n]));
  // Cache de adjudicación (tabla chica) → mapa.
  const cache = await q(`SELECT licitacion_codigo, es_adjudicada, estado, lineas FROM adjudicacion_cache`).catch(() => []);
  const cacheMap = new Map(cache.map(c => [c.licitacion_codigo, c]));

  // Prioridad de auditoría = lo que el usuario DUDA: 1º adjudicadas (Ganada/Perdida), 2º terminales
  // (Cerrada/Desierta/Revocada), 3º el resto. Así la muestra acotada por rate-limit cubre lo clave.
  const TERMINALES = new Set(['cerrada', 'desierta', 'revocada', 'suspendida', 'adjudicada']);
  const prioridad = n => {
    const c = cacheMap.get(n.codigo);
    if (c?.es_adjudicada === 1) return 0;
    if (TERMINALES.has(norm(n.estado_db))) return 1;
    return 2;
  };
  const filas = negs
    .map(n => {
      const c = cacheMap.get(n.codigo);
      return { ...n, es_adjudicada: c?.es_adjudicada ?? null, cache_estado: c?.estado ?? null, cache_lineas: c?.lineas ?? null };
    })
    .sort((a, b) => prioridad(a) - prioridad(b))
    .slice(0, LIMITE);
  console.log(`Auditando ${filas.length} licitación(es) contra MP en vivo…\n`);

  const ganamosDe = (lineas) => lineas.some(l => nuestros.has(normRut(l.rut)));
  let ok = 0, mismatch = 0, sinResp = 0;
  const problemas = [];

  for (const f of filas) {
    const live = await fetchMP(f.codigo);
    if (live.error) { sinResp++; console.log(`  ⏳ ${f.codigo}  (MP: ${live.error})`); continue; }

    // Resultado real recomputado en vivo.
    const ganamosLive = live.esAdjudicada && ganamosDe(live.lineas);
    const etiquetaLive = live.esAdjudicada ? (ganamosLive ? 'Ganada' : 'Perdida') : live.estado;

    // Lo que muestra la app hoy (misma prioridad que EstadoMpBadge): cache manda para adjudicada.
    let etiquetaApp;
    if (f.es_adjudicada === 1) {
      let cacheGanamos = false;
      try { cacheGanamos = (JSON.parse(f.cache_lineas || '[]')).some(l => nuestros.has(normRut(l.rutProveedor))); } catch {}
      etiquetaApp = cacheGanamos ? 'Ganada' : 'Perdida';
    } else {
      etiquetaApp = estadoCanonico(null, f.estado_db);
    }

    const coincide = norm(etiquetaApp) === norm(etiquetaLive)
      // Cerrada-por-fecha: la app dice Cerrada y MP sigue Publicada pero ya venció → correcto.
      || (norm(etiquetaApp) === 'cerrada' && norm(etiquetaLive) === 'publicada' && live.fechaCierre && new Date(live.fechaCierre) < new Date());

    if (coincide) { ok++; console.log(`  ✅ ${f.codigo}  app=${etiquetaApp}  live=${etiquetaLive}`); }
    else {
      mismatch++;
      console.log(`  ⚠️  ${f.codigo}  app=${etiquetaApp}  ≠  live=${etiquetaLive}  (MP estado=${live.estado}, adj=${live.esAdjudicada}, líneas nuestras=${live.lineas.filter(l => nuestros.has(normRut(l.rut))).length})`);
      problemas.push({ codigo: f.codigo, app: etiquetaApp, live: etiquetaLive });
    }
    await sleep(1200); // gentileza con MP (el backoff maneja los 429)
  }

  console.log(`\n== RESUMEN ==`);
  console.log(`Coinciden con MP: ${ok}   ·   Discrepan: ${mismatch}   ·   Sin respuesta MP: ${sinResp}`);
  if (problemas.length) {
    console.log(`\nDiscrepancias (revisar — el cron las corrige al refrescar, o falta refrescar):`);
    for (const p of problemas) console.log(`  · ${p.codigo}: app dice "${p.app}", MP dice "${p.live}"`);
  } else if (mismatch === 0 && sinResp === 0) {
    console.log(`\n🎯 Todo lo auditado calza 100% con Mercado Público.`);
  }
} catch (e) {
  console.error('Error:', e);
} finally {
  await pool.end();
}
