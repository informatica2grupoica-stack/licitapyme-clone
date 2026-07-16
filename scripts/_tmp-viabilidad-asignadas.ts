// Re-analiza viabilidad de negocios ASIGNADOS (activos) con cierre entre la próxima semana y
// fines de agosto, hasta encontrar una POR_LINEAS. Pre-ordena con los detectores deterministas
// (gratis) para analizar primero las candidatas con señales por-línea.
// Uso: npx tsx scripts/_tmp-viabilidad-asignadas.ts
import { cargarEnv } from './regresion/_env';
cargarEnv();

const MAX = 10;
const DESDE = '2026-07-20';
const HASTA = '2026-08-31 23:59:59';

async function main() {
  const { default: pool } = await import('@/app/lib/db');
  const {
    parsearPlanillaCosteo, detectarOfertaTotalUnico, detectarLenguajePorLinea,
    detectarOfertaSubconjuntoItems, detectarPresupuestoPorLinea,
  } = await import('@/app/lib/planilla-costeo-parser');

  const [rows] = await pool.query(
    `SELECT DISTINCT n.licitacion_codigo AS codigo, n.licitacion_cierre AS cierre, n.licitacion_nombre AS nombre
     FROM negocios n
     WHERE n.activo = 1
       AND n.estado_pipeline NOT IN ('DESCARTADA','PERDIDA','ADJUDICADA','POSTULADA')
       AND n.licitacion_cierre BETWEEN ? AND ?
     ORDER BY n.licitacion_cierre ASC
     LIMIT ?`, [DESDE, HASTA, MAX]);
  const cands = rows as { codigo: string; cierre: string; nombre: string }[];
  console.log(`[lote] ${cands.length} negocios asignados en la ventana ${DESDE} → ${HASTA}`);

  const { descargarDocumentosLicitacion } = await import('@/app/lib/mp-descarga-orquestador');

  // Pre-screen determinista con los textos cacheados (0 costo IA). Si el negocio no tiene
  // documentos descargados, se bajan primero (asignadas deberían tenerlos, pero hay huecos).
  const leerDocs = async (codigo: string) => {
    const [docs] = await pool.query(
      `SELECT documento_nombre AS nombre, texto_extraido AS texto FROM documentos_cache
       WHERE licitacion_codigo = ? AND texto_extraido IS NOT NULL AND categoria <> 'DOCUMENTOS_PROPIOS'`,
      [codigo]);
    return docs as { nombre: string; texto: string }[];
  };
  const conSenal: any[] = [];
  for (const c of cands) {
    let d = await leerDocs(c.codigo);
    if (d.length === 0) {
      console.log(`[docs] ${c.codigo}: sin documentos → descargando…`);
      try {
        const r = await descargarDocumentosLicitacion(c.codigo);
        console.log(`[docs] ${c.codigo}: descarga →`, JSON.stringify(r).slice(0, 200));
        d = await leerDocs(c.codigo);
      } catch (e: any) {
        console.warn(`[docs] ${c.codigo}: descarga falló:`, String(e?.message ?? e).slice(0, 150));
      }
    }
    const senales = {
      lenguaje: detectarLenguajePorLinea(d),
      subconjunto: detectarOfertaSubconjuntoItems(d),
      presupuesto: detectarPresupuestoPorLinea(d),
      totalUnico: detectarOfertaTotalUnico(d),
      planilla: (() => { const p = parsearPlanillaCosteo(d as any); return p ? `${p.estructura}/${p.numeracion}` : null; })(),
      nDocs: d.length,
    };
    const esperaPorLinea = !!(senales.lenguaje || senales.subconjunto || senales.presupuesto)
      || (senales.planilla?.startsWith('por_linea') && senales.planilla?.includes('reinicia'));
    conSenal.push({ ...c, senales, esperaPorLinea });
    console.log(`[screen] ${c.codigo} cierre=${String(c.cierre).slice(0, 10)} → ${esperaPorLinea ? '🎯 SEÑAL POR-LÍNEA' : 'sin señal'} ${JSON.stringify(senales).slice(0, 220)}`);
  }
  conSenal.sort((a, b) => Number(b.esperaPorLinea) - Number(a.esperaPorLinea));

  const { analizarYGuardarViabilidadIA } = await import('@/app/lib/viabilidad-ia');
  const resumen: any[] = [];
  for (const c of conSenal) {
    const t0 = Date.now();
    console.log(`\n===== ANALIZANDO ${c.codigo} (${c.nombre?.slice(0, 60)}) =====`);
    try {
      const v3 = await analizarYGuardarViabilidadIA(c.codigo);
      const adj = (v3 as any)?.adjudicacion?.como_se_adjudica || '—';
      const r = {
        codigo: c.codigo, adjudicacion: adj, modalidad: (v3 as any)?.modalidad?.tipo,
        score: (v3 as any)?.score_0_100, semaforo: (v3 as any)?.semaforo,
        evidencia: String((v3 as any)?.adjudicacion?.evidencia || '').slice(0, 150),
        min: Math.round((Date.now() - t0) / 6000) / 10,
      };
      resumen.push(r);
      console.log('[resultado]', JSON.stringify(r));
      if (adj.toUpperCase().includes('LINEA')) {
        console.log(`\n🎯 ENCONTRADA POR_LINEAS: ${c.codigo} — se detiene el lote.`);
        break;
      }
    } catch (e: any) {
      resumen.push({ codigo: c.codigo, error: String(e?.message ?? e).slice(0, 200) });
    }
  }

  console.log('\n===== RESUMEN =====');
  for (const r of resumen) console.log(JSON.stringify(r));
  await pool.end().catch(() => {});
  process.exit(0);
}

main().catch(e => { console.error('[lote] fatal:', e); process.exit(1); });
