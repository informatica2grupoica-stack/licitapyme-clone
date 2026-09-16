// scheduler/scheduler.mjs
// Scheduler del NOTEBOOK chileno. Corre como un contenedor propio dentro del docker-compose,
// junto a la app. Golpea los endpoints internos de la app (http://app:3000) con el CRON_SECRET.
//
// POR QUÉ EN EL NOTEBOOK (y no en Vercel): la descarga de documentos sale a Mercado Público
// y exige IP chilena → solo el notebook. Aquí unificamos TODA la automatización:
//
//   Intake  (alertas)      cada 4h   → 00,04,08,12,16,20
//   Enriquecer             +30 min   → 00:30,04:30,...
//   Prefiltro              +1h       → 01,05,09,13,17,21  (1 hora DESPUÉS del intake)
//   Viabilidad             +1h30     → 01:30,05:30,...    (30 min DESPUÉS del prefiltro)
//   Descarga docs Negocios cada 2h   → reintenta las asignadas que quedaron sin docs
//   Ganada/perdida          cada 30 min → estados-asignadas + procesar-postuladas (consumen cuota MP)
//   Aperturas               cada 1h     → detección de apertura (scraping portal, no gasta cuota MP)
//   Ofertas competencia + preguntas  cada 1h (:15) → scraping del portal (caro, no urgente)
//   Órdenes de compra      1×/día 07:40 → busca la OC de las licitaciones que ya ofertamos
//
// Robustez:
//   • restart: unless-stopped en compose → sobrevive apagones/reinicios del notebook.
//   • Apunta a http://app:3000 (red interna de compose), NO a la URL de Cloudflare (que cambia).
//   • Cada job es un LOOP: llama el endpoint por lotes hasta que quede en 0 pendientes o se
//     alcance un límite de pasadas (los endpoints son resumibles: lo que no alcance queda para
//     la próxima corrida).
//   • Respeta NEXT_PUBLIC_AUTOMATIZACION_PAUSADA=true → si está en modo manual, no dispara nada.
//   • TZ America/Santiago (los cron se interpretan en hora Chile).

import cron from 'node-cron';

const BASE   = process.env.SCHEDULER_APP_URL || 'http://app:3000';
const SECRET = process.env.CRON_SECRET || '';
const TZ     = process.env.TZ || 'America/Santiago';
const PAUSADA = String(process.env.NEXT_PUBLIC_AUTOMATIZACION_PAUSADA || '').toLowerCase() === 'true';

if (!SECRET) {
  console.error('[scheduler] ⚠️ CRON_SECRET no definido — los endpoints rechazarán las llamadas (401).');
}

function ahora() {
  return new Date().toLocaleString('es-CL', { timeZone: TZ });
}

// POST a un endpoint con el CRON_SECRET. Devuelve el JSON o null si falla.
async function llamar(path, body = {}) {
  try {
    const r = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SECRET}`,
        'x-cron-secret': SECRET,
      },
      body: JSON.stringify(body),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error(`[scheduler] ${path} → HTTP ${r.status}`, JSON.stringify(json).slice(0, 300));
      return null;
    }
    return json;
  } catch (e) {
    console.error(`[scheduler] ${path} → error de red:`, String(e).slice(0, 200));
    return null;
  }
}

// Ejecuta un endpoint resumible en LOOP hasta completar o agotar `maxPasadas`.
async function loop(nombre, path, { lote, maxPasadas = 30, body = {} } = {}) {
  if (PAUSADA) { console.log(`[scheduler] ⏸ ${nombre} omitido (AUTOMATIZACION_PAUSADA)`); return; }
  console.log(`[scheduler] ▶ ${nombre} — ${ahora()}`);
  let pasada = 0;
  while (pasada < maxPasadas) {
    pasada++;
    const res = await llamar(path, { ...(lote ? { lote } : {}), ...body });
    if (!res) break; // error → cortar, se reintenta en la próxima corrida programada
    const pend = res.pendientes ?? 0;
    console.log(`[scheduler]   ${nombre} pasada ${pasada}: ${JSON.stringify(res).slice(0, 200)}`);
    if (res.completado || pend === 0) break;
  }
  console.log(`[scheduler] ✔ ${nombre} listo (${pasada} pasada/s) — ${ahora()}`);
}

// Evita que dos corridas del MISMO job se pisen. node-cron dispara según el reloj, sin mirar si
// la corrida anterior terminó: con cadencias cortas (cada 5 min) una corrida lenta se apilaría
// sobre la siguiente y se multiplicarían las llamadas a Mercado Público. Si la anterior sigue
// viva, esta se salta — la próxima sale en 5 minutos igual, no se pierde nada.
const enCurso = new Set();
async function sinSolapar(nombre, fn) {
  if (enCurso.has(nombre)) {
    console.log(`[scheduler] ⏭ ${nombre} omitido: la corrida anterior sigue en curso — ${ahora()}`);
    return;
  }
  enCurso.add(nombre);
  try { await fn(); }
  catch (e) { console.error(`[scheduler] ${nombre} falló:`, String(e).slice(0, 300)); }
  finally { enCurso.delete(nombre); }
}

// ── Jobs ──────────────────────────────────────────────────────────────────────
// alertas/enriquecer no exponen `pendientes` (corren una sola pasada); prefiltro y
// docs-negocios sí son resumibles y se loopean hasta vaciar la cola.

async function jobIntake()     { await loop('intake (alertas)', '/api/cron/alertas',   { maxPasadas: 1 }); }
async function jobEnriquecer() { await loop('enriquecer',       '/api/cron/enriquecer', { maxPasadas: 1 }); }
async function jobPrefiltro()  { await loop('prefiltro',        '/api/cron/prefiltro',  { lote: 45, maxPasadas: 40 }); }
async function jobDocsNeg()    { await loop('descarga docs negocios', '/api/cron/descargar-docs-negocios', { lote: 6, maxPasadas: 60 }); }
// Viabilidad: analiza las que tienen documentos y pasaron el prefiltro pero siguen sin informe.
// Cada una es una llamada a la IA → lote chico y pocas pasadas (tope de costo por corrida).
// El conjunto se autovacía, así que entre corridas la cobertura llega a 0 sola.
async function jobViabilidad() { await loop('viabilidad',       '/api/cron/viabilidad', { lote: 3, maxPasadas: 4 }); }
// Piloto: mismo trabajo pero acotado a los perfiles con permisos.viabilidad_automatica=true
// (hoy solo "Asesor"). Va DESPUÉS del cron de sistema para no competir por el mismo cupo de IA
// en el mismo instante; universo chico → lote/pasadas bajos.
async function jobViabilidadPerfil() { await loop('viabilidad (perfil piloto)', '/api/cron/viabilidad-perfil', { lote: 2, maxPasadas: 3 }); }

// ── RESULTADO (ganamos/perdimos): lo más importante, pero ya NO cada 5 min ────────────────
// Mercado Público solo avisa "Adjudicada"; quién ganó hay que ir a buscarlo. Mientras no se
// consulte, la licitación se queda en POSTULADA y nadie se entera del resultado.
//
// CAMBIO 2026-09-15 (pedido explícito del dueño, tras agotarse la cuota diaria del ticket):
// esto vivía junto a 'aperturas' en un solo job cada 5 min. Entre estados-asignadas (hasta 400
// códigos de backstop) y procesar-postuladas (recorre TODA la cola de postuladas sin veredicto,
// ~56-80 códigos) cada 5 minutos, eran miles de consultas/día — el mayor consumo de cuota de
// toda la app. Bajado a cada 30 min: sigue siendo lo más rápido de la agenda (es lo que el
// usuario pidió priorizar) pero consume ~6× menos cuota. El gobernador de cuota
// (presupuestoPorCorrida, mercado-publico.ts) ya reparte lo que quede del día entre las
// corridas restantes — bajar la cadencia además de eso es un segundo frente: menos corridas,
// cada una con más presupuesto propio, así que también degrada menos ante un pico de volumen.
async function jobGanadaPerdida() {
  // Estados MP de las asignadas que NO llegaron a marcarse POSTULADA (ASIGNADO/EN_PROCESO/
  // POSIBLE_ADJ/ANEXOS). Medido en producción, es la vía que MÁS "ganada/perdida" detecta.
  await loop('estados asignadas',    '/api/cron/estados-asignadas', { maxPasadas: 1 });
  // La cola son TODAS las que no tienen veredicto de MP. El endpoint devuelve `pendientes`, así
  // que el loop corta SOLO cuando la cola queda vacía; las pasadas de más no cuestan nada.
  await loop('resultado postuladas', '/api/cron/procesar-postuladas', { maxPasadas: 6 });
}

// ── APERTURA: NO consume cuota de la API con ticket (portal scraping, IP chilena) ─────────
// Se separó de jobGanadaPerdida para poder bajarle la cadencia a esa (que sí gasta cuota) sin
// tocar esta. Como no compite por cuota, se deja en 1h — mismo criterio de "no urgente/caro" que
// ofertas-competencia/preguntas, aunque técnicamente podría ir más rápido sin costo de cuota.
async function jobAperturas() {
  await loop('aperturas', '/api/cron/aperturas', { lote: 40, maxPasadas: 20 });
}

// Lo caro y no urgente: scraping del portal. Sigue en ritmo horario.
// 'ofertas competencia' se alimenta de lo que 'aperturas' marcó en jobResultados.
async function jobPostuladasLento() {
  await loop('ofertas competencia',  '/api/cron/ofertas-competencia', { lote: 10, maxPasadas: 10, body: { docs: 20 } });
  await loop('preguntas y respuestas', '/api/cron/preguntas', { lote: 20, maxPasadas: 15 });
}

// Órdenes de compra: busca en Mercado Público la OC de las licitaciones que ya ofertamos, la
// guarda y avisa (campana + correo). UNA VEZ AL DÍA a propósito: la API no permite consultar por
// licitación, así que hay que descargar el listado completo del día (~16.000 órdenes de todo
// Chile) y cruzarlo. Una orden de compra no aparece "en minutos" —el organismo la emite días o
// semanas después de adjudicar—, así que consultarla cada hora sería puro gasto. La ventana de 3
// días cubre el fin de semana y cualquier corrida caída.
async function jobOrdenesCompra() { await loop('órdenes de compra', '/api/cron/ordenes-compra', { maxPasadas: 1, body: { dias: 3 } }); }

// Compras de Obuma (nuestro ERP): busca las que mencionan una licitación que ya ofertamos. También
// UNA VEZ AL DÍA — es el mismo ritmo que las OC de Mercado Público del lado de la venta, y las
// compras nuevas siempre están en las primeras páginas (comprasOc.list.json entrega más reciente
// primero), así que un barrido corto (5 páginas ≈ últimas 500 compras) alcanza sin re-barrer el
// historial completo cada día.
async function jobComprasObuma() { await loop('compras Obuma', '/api/cron/obuma-compras', { maxPasadas: 1, body: { paginas: 5 } }); }

// Módulo de Compras (§3.3): fallback de asignación — si el jefe de ventas no asignó encargado
// dentro de las 3h hábiles, el sistema asigna solo al de menor carga. Cada 20 min: bastante rápido
// para que el SLA de 3h no se sienta, sin ser tan frecuente como el aviso de resultados.
async function jobComprasAsignacion() { await loop('compras asignación', '/api/cron/compras-asignacion', { maxPasadas: 1 }); }

// ── Programación (hora Chile) ───────────────────────────────────────────────────
const opts = { timezone: TZ };

cron.schedule('0 */4 * * *',    jobIntake,     opts);   // 00,04,08,12,16,20
cron.schedule('30 */4 * * *',   jobEnriquecer, opts);   // +30 min
cron.schedule('0 1-23/4 * * *', jobPrefiltro,  opts);   // 01,05,09,13,17,21 (1h después del intake)
cron.schedule('0 */2 * * *',    jobDocsNeg,    opts);   // cada 2h: reintenta descargas de asignadas
// CADA 30 MINUTOS: resultado de adjudicación (ganamos/perdimos) — lo más importante, bajado desde
// 5 min el 2026-09-15 porque agotaba la cuota diaria del ticket de MP (ver comentario en jobGanadaPerdida).
// sinSolapar() evita que se apilen corridas si una se atrasa.
cron.schedule('*/30 * * * *',   () => sinSolapar('ganada-perdida', jobGanadaPerdida), opts);
// CADA 1 HORA (:10): apertura técnica/económica. No gasta cuota de MP (portal scraping), separada
// de ganada/perdida para poder bajarle la cadencia a esa sin tocar esta.
cron.schedule('10 * * * *',     () => sinSolapar('aperturas', jobAperturas), opts);
cron.schedule('15 * * * *',     () => sinSolapar('postuladas-lento', jobPostuladasLento), opts); // cada 1h: scraping del portal
cron.schedule('30 1-23/4 * * *', jobViabilidad, opts);  // 01:30,05:30,... (30 min DESPUÉS del prefiltro)
cron.schedule('35 1-23/4 * * *', jobViabilidadPerfil, opts); // 01:35,05:35,... (5 min DESPUÉS del cron de sistema)
// 07:40: temprano, para que el aviso de "salió la orden de compra" esté cuando se abre la app, y
// fuera de las horas en punto donde ya corren el intake y las postuladas.
cron.schedule('40 7 * * *',     jobOrdenesCompra, opts);
// 07:45: justo después de las OC de MP, mismo criterio de horario.
cron.schedule('45 7 * * *',     jobComprasObuma, opts);
// CADA 20 MINUTOS: fallback de asignación de Compras (§3.3). Barato (sin llamadas externas, solo BD).
cron.schedule('*/20 * * * *',   () => sinSolapar('compras-asignacion', jobComprasAsignacion), opts);

console.log(`[scheduler] 🚀 iniciado — base=${BASE} TZ=${TZ} pausada=${PAUSADA} — ${ahora()}`);
console.log('[scheduler] agenda: intake 0 */4 · enriquecer 30 */4 · prefiltro 0 1-23/4 · viabilidad 30 1-23/4 · viabilidad-perfil 35 1-23/4 · docs-negocios 0 */2 · ganada/perdida (estados-asignadas+postuladas) */30 · aperturas 10 * (cada hora) · ofertas+preguntas 15 * (cada hora) · órdenes de compra 40 7 · compras Obuma 45 7 (1×/día) · compras-asignación */20 (fallback 3h hábiles)');

// Al arrancar, dispara una pasada de reintento de descargas (recupera lo que quedó pendiente
// mientras el scheduler estuvo caído). No dispara intake para no duplicar con el cron horario.
jobDocsNeg().catch(e => console.error('[scheduler] arranque docsNeg:', String(e)));
// También refresca el resultado (ganada/perdida) al arrancar → el apartado (que lee solo cache)
// queda al día apenas se despliega, sin esperar el primer tick de los 30 min.
jobGanadaPerdida().catch(e => console.error('[scheduler] arranque ganada-perdida:', String(e)));
jobAperturas().catch(e => console.error('[scheduler] arranque aperturas:', String(e)));
