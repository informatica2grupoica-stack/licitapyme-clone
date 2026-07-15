// Corre viabilidad completa (fase 1 + score híbrido + informe IA v3 + costeo) sobre 5
// licitaciones activas que pasaron el prefiltro y aún no tienen viabilidad.
// Descarga los documentos si faltan. Uso: npx tsx scripts/_tmp-viabilidad-lote5.ts
import { cargarEnv } from './regresion/_env';
cargarEnv();

const LOTE = 5;

async function main() {
  const { default: pool } = await import('@/app/lib/db');

  // Candidatas: activas (cierre futuro), prefiltro PASA/REVISION_HUMANA, sin viabilidad.
  // Primero las que YA tienen documentos; si no alcanzan, las sin documentos (se descargan).
  const [rows] = await pool.query(
    `SELECT DISTINCT al.licitacion_codigo AS codigo, MIN(al.licitacion_cierre) AS cierre,
            EXISTS(SELECT 1 FROM documentos_cache dc WHERE dc.licitacion_codigo = al.licitacion_codigo) AS con_docs
     FROM alertas_licitaciones al
     WHERE al.licitacion_cierre > DATE_ADD(NOW(), INTERVAL 1 DAY)
       AND EXISTS (SELECT 1 FROM prefiltro_licitacion pf
                   WHERE pf.licitacion_codigo = al.licitacion_codigo
                     AND pf.decision IN ('PASA','REVISION_HUMANA'))
       AND NOT EXISTS (SELECT 1 FROM viabilidad_licitacion v WHERE v.licitacion_codigo = al.licitacion_codigo)
     GROUP BY al.licitacion_codigo
     ORDER BY con_docs DESC, cierre ASC
     LIMIT ?`, [LOTE]);
  const candidatas = rows as { codigo: string; cierre: string; con_docs: number }[];
  console.log(`[lote] ${candidatas.length} candidatas:`, candidatas.map(c => `${c.codigo}${c.con_docs ? '' : ' (sin docs)'}`).join(', '));
  if (!candidatas.length) { await pool.end().catch(() => {}); return; }

  const { descargarDocumentosLicitacion } = await import('@/app/lib/mp-descarga-orquestador');
  const { procesarLicitacionCompleta } = await import('@/app/lib/pipeline-licitacion');
  const { analizarYGuardarViabilidadIA } = await import('@/app/lib/viabilidad-ia');

  const resumen: any[] = [];
  for (const c of candidatas) {
    const t0 = Date.now();
    console.log(`\n===== ${c.codigo} (cierre ${c.cierre}) =====`);
    try {
      if (!c.con_docs) {
        console.log(`[lote] ${c.codigo}: sin documentos → descargando…`);
        const d = await descargarDocumentosLicitacion(c.codigo);
        console.log(`[lote] ${c.codigo}: descarga →`, JSON.stringify(d).slice(0, 300));
      }
      const r = await procesarLicitacionCompleta(c.codigo);
      if (!r.ok) { resumen.push({ codigo: c.codigo, ok: false, error: r.error }); continue; }
      const sv = r.viabilidad?.score_viabilidad;
      console.log(`[lote] ${c.codigo}: score híbrido OK (${sv?.total} · ${sv?.semaforo}) → informe IA v3…`);
      const v3 = await analizarYGuardarViabilidadIA(c.codigo);
      resumen.push({
        codigo: c.codigo, ok: !!v3,
        score: v3?.score_0_100 ?? sv?.total, semaforo: v3?.semaforo ?? sv?.semaforo,
        adjudicacion: (v3 as any)?.adjudicacion?.como_se_adjudica,
        modalidad: (v3 as any)?.modalidad?.tipo,
        veredicto: (v3 as any)?.tarjeta_decision?.veredicto,
        min: Math.round((Date.now() - t0) / 6000) / 10,
      });
    } catch (e: any) {
      resumen.push({ codigo: c.codigo, ok: false, error: String(e?.message ?? e).slice(0, 200) });
    }
  }

  console.log('\n===== RESUMEN =====');
  for (const r of resumen) console.log(JSON.stringify(r));
  await pool.end().catch(() => {});
  process.exit(0);
}

main().catch(e => { console.error('[lote] fatal:', e); process.exit(1); });
