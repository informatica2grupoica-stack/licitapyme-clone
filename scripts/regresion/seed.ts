// SEED del gold set. Lista las licitaciones que YA tienen informe v3 guardado + documentos en
// caché, y vuelca un esqueleto de gold.json PRE-RELLENADO con los valores ACTUALES. El experto
// solo tiene que: (1) borrar los casos que no quiera, (2) CORREGIR los valores que hoy están mal
// (esos son justo los que el harness debe cazar), (3) renombrar gold.seed.json → gold.json.
//
//   npx tsx scripts/regresion/seed.ts            (todos los que tengan informe v3)
//   npx tsx scripts/regresion/seed.ts 30         (máximo 30, los más recientes)
import { writeFileSync } from 'fs';
import mysql from 'mysql2/promise';
import { cargarEnv } from './_env';
import { extraerMetricas } from './_metricas';

cargarEnv();

async function main() {
  const limite = Number(process.argv[2]) || 500;
  const pool = mysql.createPool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, connectionLimit: 2, connectTimeout: 20000,
  });

  // Licitaciones con informe v3 guardado y al menos un documento con texto en caché.
  const [rows] = await pool.query(
    `SELECT v.licitacion_codigo, v.informe_ejecutivo, v.updated_at,
            (SELECT COUNT(*) FROM documentos_cache d
              WHERE d.licitacion_codigo = v.licitacion_codigo
                AND CHAR_LENGTH(COALESCE(d.texto_extraido,'')) >= 50) AS docs_ok
       FROM viabilidad_licitacion v
      ORDER BY v.updated_at DESC`);

  const casos: any[] = [];
  for (const r of rows as any[]) {
    let ie: any;
    try { ie = typeof r.informe_ejecutivo === 'string' ? JSON.parse(r.informe_ejecutivo) : r.informe_ejecutivo; } catch { continue; }
    const inf = ie?._informe_ia_v3;
    if (!inf) continue;                 // solo v3
    if (!r.docs_ok || r.docs_ok < 1) continue; // sin docs cacheados no se puede re-analizar
    const m = extraerMetricas(inf);
    casos.push({
      codigo: r.licitacion_codigo,
      _docs_ok: r.docs_ok,
      _actual: m,                        // valores de hoy (referencia; el harness NO lee esto)
      esperado: {                        // ← CORRIGE aquí lo que esté mal; borra lo que no quieras fijar
        modalidad: m.modalidad ?? undefined,
        adjudicacion: m.adjudicacion ?? undefined,
        n_criterios: m.n_criterios ?? undefined,
        suma_valida: m.suma_valida ?? undefined,
        n_items_min: m.n_items ?? undefined,
        veredicto: m.veredicto ?? undefined,
        revision_humana: m.revision_humana ?? undefined,
      },
    });
    if (casos.length >= limite) break;
  }

  const dest = 'D:/licitapyme-clone/scripts/regresion/gold.seed.json';
  writeFileSync(dest, JSON.stringify(casos, null, 2), 'utf8');
  console.log(`${casos.length} caso(s) con informe v3 + docs cacheados → ${dest}`);
  console.log('Revisa/corrige los "esperado", quédate con ~15-30, y renómbralo a gold.json');
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
