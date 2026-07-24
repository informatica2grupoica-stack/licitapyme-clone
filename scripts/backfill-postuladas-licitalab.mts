// Backfill de postulaciones históricas desde "Informe Postuladas INV Claro.xlsx" (Licitalab, el
// sistema anterior) hacia negocios/Postuladas de Licitank. Fuente: hoja "Cargar a Postuladas" del
// reporte generado el 24-jul-2026 (138 filas verificadas por historial de comentarios: cada una
// tiene evidencia real de postulación — no solo "visado" o "descartada").
//
// Reglas de mapeo (confirmadas con el usuario, 24-jul-2026):
//   · Empresa sin sufijo CMP explícito → Inversiones Claro ARZ SPA (todo el informe es "INV Claro";
//     JV/CG en las etiquetas PostuladoJV/PostuladoCG/AdjudicadoJV/AdjudicadoCG son personas —
//     Jefe Ventas / Carolina González —, no empresa distinta).
//   · Asignado: 'Generico'→Generico G, 'Carolina'→Carolina Gonzalez, 'Asesor'→Asesor.
//     'Mixi' (9 filas) NO tiene usuario exacto en Licitank → cae a Generico G como resto, y
//     queda marcado con nota "REVISAR ASIGNADO" en el comentario del negocio para que se corrija
//     a mano si se sabe quién es.
//
// Si YA existe una fila para (asignado_a, codigo) — incl. la fila "fantasma" inactiva que dejó el
// radar en ASIGNADO — se REACTIVA y actualiza en vez de insertar (la unique no mira `activo`).
//
//   npx tsx scripts/backfill-postuladas-licitalab.mts --dry      (default: no toca la BD)
//   npx tsx scripts/backfill-postuladas-licitalab.mts --commit   (aplica de verdad)
import { cargarEnv } from './regresion/_env.js';
cargarEnv();
const pool = (await import('../app/lib/db.js')).default;
const XLSX = 'D:/licitapyme-clone/scripts/Postuladas_faltantes_INV_Claro.xlsx';

const COMMIT = process.argv.includes('--commit');

const USUARIO_ID: Record<string, number> = {
  'Generico': 10,   // Generico G
  'Carolina': 12,   // Carolina Gonzalez
  'Asesor': 7,      // Asesor
  'Mixi': 10,       // sin match exacto → Generico G (revisar a mano)
};
const EMPRESA_ID: Record<string, number> = {
  'Inversiones Claro ARZ SPA': 1,
  'Comercial MP SpA': 2,
};
const ADMIN_ID = 1; // Alexis Tobar — asignado_por del backfill

// Lee la hoja "Cargar a Postuladas" del Excel entregado, vía un subproceso Python (no hay
// paquete xlsx nativo en Node en este proyecto).
const { execFileSync } = await import('node:child_process');
const pyScript = `
import json, openpyxl
wb = openpyxl.load_workbook(r"${XLSX}", data_only=True)
ws = wb['Cargar a Postuladas']
rows = list(ws.iter_rows(min_row=2, values_only=True))
out = []
for r in rows:
    out.append({
        'codigo': r[0], 'nombre': r[1], 'organismo': r[2], 'monto': r[3], 'monto_ofertado': r[4],
        'cierre': str(r[5]) if r[5] else None, 'estado_mp': r[6], 'etiqueta': r[7],
        'estado_pipeline': r[9], 'empresa': r[10], 'asignado': r[11],
    })
print(json.dumps(out, ensure_ascii=False, default=str))
`;
const salida = execFileSync('python', ['-c', pyScript], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 });
const filas: any[] = JSON.parse(salida);
console.log(`Leídas ${filas.length} filas de "Cargar a Postuladas".\n`);

let insertados = 0, reactivados = 0, saltados = 0;

for (const f of filas) {
  const asignadoKey = String(f.asignado || '').trim();
  const asignado_a = USUARIO_ID[asignadoKey];
  if (!asignado_a) {
    console.log(`⚠ SALTADO ${f.codigo}: asignado "${f.asignado}" sin mapeo — revisar a mano.`);
    saltados++;
    continue;
  }
  const empresaKey = String(f.empresa || '').trim();
  const empresa_id = EMPRESA_ID[empresaKey] ?? EMPRESA_ID['Inversiones Claro ARZ SPA']; // default INVC

  const notaMixi = asignadoKey === 'Mixi' ? ' [REVISAR ASIGNADO: original Licitalab decía "Mixi", sin match exacto en Licitank]' : '';
  const cierreSql = f.cierre ? f.cierre.replace('T', ' ') : null;

  const [existentes] = await pool.query(
    `SELECT id, asignado_a, activo FROM negocios WHERE licitacion_codigo = ? AND asignado_a = ? LIMIT 1`,
    [f.codigo, asignado_a],
  ) as any;
  const existente = (existentes as any[])[0];

  if (existente) {
    console.log(`${COMMIT ? 'REACTIVANDO' : '[dry] reactivaría'} ${f.codigo} (id ${existente.id}, activo=${existente.activo}) → asignado=${asignado_a} estado=${f.estado_pipeline} empresa=${empresa_id}${notaMixi}`);
    if (COMMIT) {
      await pool.query(
        `UPDATE negocios SET activo = 1, estado_pipeline = ?, empresa_id = ?, monto_ofertado = ?,
                licitacion_nombre = ?, licitacion_organismo = ?, licitacion_monto = ?, licitacion_cierre = ?,
                licitacion_estado = ?, licitacion_tipo = ?
          WHERE id = ?`,
        [f.estado_pipeline, empresa_id, f.monto_ofertado || 0, f.nombre, f.organismo, f.monto || null,
         cierreSql, f.estado_mp, null, existente.id],
      );
    }
    reactivados++;
  } else {
    console.log(`${COMMIT ? 'INSERTANDO' : '[dry] insertaría'} ${f.codigo} → asignado=${asignado_a} estado=${f.estado_pipeline} empresa=${empresa_id}${notaMixi}`);
    if (COMMIT) {
      await pool.query(
        `INSERT INTO negocios
           (licitacion_codigo, licitacion_nombre, licitacion_organismo, licitacion_monto, licitacion_cierre,
            licitacion_estado, estado_pipeline, monto_ofertado, asignado_a, asignado_por, empresa_id, activo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [f.codigo, f.nombre, f.organismo, f.monto || null, cierreSql, f.estado_mp, f.estado_pipeline,
         f.monto_ofertado || 0, asignado_a, ADMIN_ID, empresa_id],
      );
    }
    insertados++;
  }
}

console.log(`\n${COMMIT ? 'APLICADO' : 'DRY-RUN'} — insertar/insertados: ${insertados} · reactivar/reactivados: ${reactivados} · saltados: ${saltados}`);
if (!COMMIT) console.log('\nEsto fue una SIMULACIÓN. Corre con --commit para aplicar de verdad.');
await pool.end();
