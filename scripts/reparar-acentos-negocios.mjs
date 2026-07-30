// Repara los nombres/organismos de `negocios` que perdieron los acentos (U+FFFD).
//
// El texto bueno ya existe en `alertas_licitaciones` y `licitaciones_cache` (ambas limpias); acá
// solo se COPIA de ahí. Las que no tengan copia limpia se releen de la API oficial de MP.
// El origen quedó tapado en app/lib/texto-limpio.ts (lo usa POST /api/negocios), así que esto es
// una pasada de una vez sobre lo ya dañado.
//
// Uso:
//   node scripts/reparar-acentos-negocios.mjs            → SOLO reporta (no toca nada)
//   node scripts/reparar-acentos-negocios.mjs --aplicar  → repara
//   node scripts/reparar-acentos-negocios.mjs --aplicar --con-mp  → además relee de MP las que no
//                                                                   tienen copia limpia en la BD
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

const APLICAR = process.argv.includes('--aplicar');
const CON_MP  = process.argv.includes('--con-mp');

const env = {};
for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const c = await mysql.createConnection({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

const roto = s => typeof s === 'string' && s.includes('�');
const stats = { revisadas: 0, desdeBD: 0, desdeMP: 0, sinArreglo: 0 };

try {
  const [filas] = await c.query(
    `SELECT n.id, n.licitacion_codigo, n.licitacion_nombre, n.licitacion_organismo,
            a.licitacion_nombre AS n_alerta, a.licitacion_organismo AS o_alerta,
            lc.nombre AS n_cache, lc.organismo AS o_cache
       FROM negocios n
       LEFT JOIN alertas_licitaciones a ON a.licitacion_codigo = n.licitacion_codigo
       LEFT JOIN licitaciones_cache  lc ON lc.codigo           = n.licitacion_codigo
      WHERE n.licitacion_nombre    LIKE CONCAT('%', CONVERT(0xEFBFBD USING utf8mb4), '%')
         OR n.licitacion_organismo LIKE CONCAT('%', CONVERT(0xEFBFBD USING utf8mb4), '%')
      GROUP BY n.id`);

  console.log(`\n  ${filas.length} fila(s) con texto dañado${APLICAR ? '' : '  (modo REPORTE — usa --aplicar para reparar)'}\n`);

  const sinCopia = [];

  for (const f of filas) {
    stats.revisadas++;
    let nombre = f.licitacion_nombre;
    let organismo = f.licitacion_organismo;

    if (roto(nombre)) {
      const alt = [f.n_alerta, f.n_cache].find(v => v && !roto(v));
      if (alt) nombre = alt;
    }
    if (roto(organismo)) {
      const alt = [f.o_alerta, f.o_cache].find(v => v && !roto(v));
      if (alt) organismo = alt;
    }

    const arreglado = nombre !== f.licitacion_nombre || organismo !== f.licitacion_organismo;
    if (arreglado) {
      stats.desdeBD++;
      if (APLICAR) {
        await c.query(`UPDATE negocios SET licitacion_nombre = ?, licitacion_organismo = ? WHERE id = ?`,
          [nombre, organismo, f.id]);
      }
      console.log(`  ✔ ${f.licitacion_codigo}`);
      console.log(`      antes : ${String(f.licitacion_nombre).slice(0, 60)}`);
      console.log(`      ahora : ${String(nombre).slice(0, 60)}`);
    }
    if (roto(nombre) || roto(organismo)) sinCopia.push({ id: f.id, codigo: f.licitacion_codigo });
  }

  // ── Las que no tienen copia limpia en la BD: releer de la API oficial de MP ────────
  if (sinCopia.length && CON_MP && APLICAR) {
    const ticket = env.MERCADO_PUBLICO_TICKET;
    if (!ticket) {
      console.log(`\n  ${sinCopia.length} sin copia en BD y falta MERCADO_PUBLICO_TICKET → no se releen.`);
    } else {
      console.log(`\n  Releyendo ${sinCopia.length} desde la API de MP...`);
      for (const s of sinCopia) {
        try {
          const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=${encodeURIComponent(s.codigo)}&ticket=${ticket}`;
          const r = await fetch(url);
          const j = await r.json();
          const lic = j?.Listado?.[0];
          if (!lic?.Nombre || roto(lic.Nombre)) { stats.sinArreglo++; continue; }
          await c.query(`UPDATE negocios SET licitacion_nombre = ?, licitacion_organismo = COALESCE(?, licitacion_organismo) WHERE id = ?`,
            [lic.Nombre, lic.Comprador?.NombreOrganismo ?? null, s.id]);
          stats.desdeMP++;
          console.log(`  ✔ ${s.codigo} (desde MP): ${String(lic.Nombre).slice(0, 55)}`);
          await new Promise(r => setTimeout(r, 1200)); // gentil con la API
        } catch (e) {
          stats.sinArreglo++;
          console.log(`  ✗ ${s.codigo}: ${String(e.message).slice(0, 70)}`);
        }
      }
    }
  } else if (sinCopia.length) {
    stats.sinArreglo = sinCopia.length;
    console.log(`\n  ${sinCopia.length} sin copia limpia en la BD → requieren --con-mp para releerlas de MP.`);
  }

  // ── Verificación final ────────────────────────────────────────────────────────────
  const [[q]] = await c.query(
    `SELECT SUM(licitacion_nombre    LIKE CONCAT('%', CONVERT(0xEFBFBD USING utf8mb4), '%')) n,
            SUM(licitacion_organismo LIKE CONCAT('%', CONVERT(0xEFBFBD USING utf8mb4), '%')) o
       FROM negocios`);
  console.log(`\n  Resumen: ${stats.desdeBD} reparadas desde la BD · ${stats.desdeMP} desde MP · ${stats.sinArreglo} sin arreglo`);
  console.log(`  Quedan dañadas: ${Number(q.n || 0)} nombre(s) · ${Number(q.o || 0)} organismo(s)\n`);
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await c.end(); }
