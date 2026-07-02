// Auditoría de MODALIDAD (suma_alzada vs por_linea) sobre TODAS las licitaciones ya
// analizadas. NO llama al LLM: corre los detectores DETERMINISTAS reales
// (planilla-costeo-parser.ts) sobre el texto cacheado en documentos_cache y compara el
// veredicto determinista contra la modalidad grabada en
// viabilidad_licitacion.informe_ejecutivo._informe_ia.modalidad.tipo.
//
// Objetivo: listar las licitaciones cuya modalidad quedó MAL, según la evidencia de los
// documentos, para poder re-analizarlas. Solo lectura (dry-run).
//
// Uso:  npx tsx scripts/auditar-modalidad.mts
import fs from 'fs';
import mysql from 'mysql2/promise';
import {
  parsearPlanillaCosteo,
  detectarLineasFormulario,
  detectarOfertaTotalUnico,
  detectarLenguajePorLinea,
} from '../app/lib/planilla-costeo-parser';

const env: Record<string, string> = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

type DocRow = { documento_nombre: string; categoria: string | null; texto_extraido: string | null; metodo_extraccion: string | null };

// Veredicto DETERMINISTA con la MISMA prioridad que construirSenalModalidad (viabilidad-ia.ts).
// Devuelve { tipo, conf, motivo } o tipo=null si no hay señal suficiente.
function veredictoDeterminista(docsAll: DocRow[]) {
  const leidos = docsAll
    .map(d => ({ nombre: d.documento_nombre, categoria: d.categoria, texto: (d.texto_extraido || '').trim(), metodo: d.metodo_extraccion }))
    .filter(d => d.texto.length >= 50);
  if (leidos.length === 0) return { tipo: null as string | null, conf: 'sin_texto', motivo: 'ningún documento con texto cacheado' };

  const lenguaje = detectarLenguajePorLinea(leidos);
  if (lenguaje) return { tipo: 'por_linea', conf: 'alta', motivo: `lenguaje explícito: "${lenguaje}"` };

  const totalUnico = detectarOfertaTotalUnico(leidos);
  if (totalUnico) return { tipo: 'suma_alzada', conf: 'alta', motivo: 'oferta económica con total único consolidado' };

  const fuentes = leidos.filter(d => (d.categoria || '').toUpperCase() !== 'DOCUMENTOS_PROPIOS' && !/^COSTEO_/i.test(d.nombre));
  let planilla: ReturnType<typeof parsearPlanillaCosteo> = null;
  try { planilla = parsearPlanillaCosteo(fuentes); } catch { /* noop */ }

  if (planilla && planilla.items.length >= 8) {
    if (planilla.estructura === 'por_linea' && planilla.lineas.length >= 2 && planilla.numeracion === 'reinicia')
      return { tipo: 'por_linea', conf: 'media', motivo: `${planilla.lineas.length} líneas/lotes con numeración que reinicia` };
    if (planilla.estructura === 'por_categoria')
      return { tipo: 'suma_alzada', conf: 'media', motivo: `${planilla.categorias.length} rubros/categorías bajo un total (por_categoria)` };
    if (planilla.numeracion === 'continua')
      return { tipo: 'suma_alzada', conf: 'media-baja', motivo: `${planilla.items.length} ítems correlativos continuos 1..N` };
  }

  const lineasForm = detectarLineasFormulario(leidos);
  if (lineasForm.length >= 2) return { tipo: 'por_linea', conf: 'media', motivo: `${lineasForm.length} fichas "FORMULARIO Línea N°X"` };

  return { tipo: null, conf: 'indeterminado', motivo: 'sin señal determinista fuerte' };
}

const [viab] = await pool.query<any[]>(
  `SELECT licitacion_codigo, informe_ejecutivo FROM viabilidad_licitacion`);

let total = 0, conModalidad = 0, sinTexto = 0, indet = 0, coincide = 0;
const conflictos: any[] = [];

for (const r of viab as any[]) {
  total++;
  let ie: any; try { ie = typeof r.informe_ejecutivo === 'string' ? JSON.parse(r.informe_ejecutivo) : r.informe_ejecutivo; } catch { continue; }
  const ia = ie?._informe_ia; if (!ia) continue;
  const grabada = (ia.modalidad?.tipo || '').toLowerCase();
  if (grabada !== 'suma_alzada' && grabada !== 'por_linea') continue;
  conModalidad++;

  const [docs] = await pool.query<any[]>(
    `SELECT documento_nombre, categoria, texto_extraido, metodo_extraccion FROM documentos_cache WHERE licitacion_codigo = ?`, [r.licitacion_codigo]);
  const v = veredictoDeterminista(docs as DocRow[]);

  if (v.conf === 'sin_texto') { sinTexto++; continue; }
  if (!v.tipo) { indet++; continue; }
  if (v.tipo === grabada) { coincide++; continue; }

  conflictos.push({
    codigo: r.licitacion_codigo,
    grabada,
    determinista: v.tipo,
    conf: v.conf,
    motivo: v.motivo,
    estado: ia.modalidad?.estado || '',
    confianza_ia: ia.modalidad?.confianza ?? '',
  });
}

// Orden: conflictos de alta confianza primero; dentro, los que la IA marcó DETERMINADA.
const rank = (c: string) => (c === 'alta' ? 0 : c === 'media' ? 1 : 2);
conflictos.sort((a, b) => rank(a.conf) - rank(b.conf));

console.log('\n================ AUDITORÍA DE MODALIDAD ================');
console.log(`Viabilidades totales:            ${total}`);
console.log(`Con modalidad grabada:           ${conModalidad}`);
console.log(`  ✓ coincide con documentos:     ${coincide}`);
console.log(`  ~ sin texto cacheado:          ${sinTexto}`);
console.log(`  ~ sin señal determinista:      ${indet}`);
console.log(`  ✗ CONFLICTO (posible error):   ${conflictos.length}`);

const altas = conflictos.filter(c => c.conf === 'alta');
console.log(`\n---- CONFLICTOS DE ALTA CONFIANZA (${altas.length}) ----`);
for (const c of altas)
  console.log(`  ${c.codigo}  grabada=${c.grabada}  →  debería=${c.determinista}  [${c.motivo}]  (IA: estado=${c.estado}, conf=${c.confianza_ia})`);

const resto = conflictos.filter(c => c.conf !== 'alta');
console.log(`\n---- CONFLICTOS DE MENOR CONFIANZA (${resto.length}) ----`);
for (const c of resto)
  console.log(`  ${c.codigo}  grabada=${c.grabada}  →  ${c.determinista}?  conf=${c.conf}  [${c.motivo}]`);

// Desglose de la dirección del error
const falsoPorLinea = conflictos.filter(c => c.grabada === 'por_linea' && c.determinista === 'suma_alzada');
const falsoSuma = conflictos.filter(c => c.grabada === 'suma_alzada' && c.determinista === 'por_linea');
console.log(`\n---- DIRECCIÓN DEL ERROR ----`);
console.log(`  grabada por_linea que sería suma_alzada:  ${falsoPorLinea.length}  (${falsoPorLinea.map(c => c.codigo).join(', ') || '—'})`);
console.log(`  grabada suma_alzada que sería por_linea:  ${falsoSuma.length}  (${falsoSuma.map(c => c.codigo).join(', ') || '—'})`);

await pool.end();
