// Aplica migration-162: ficha de importación POR PRODUCTO (pedido del dueño, 21-oct-2026). Una fila por producto importado con
// fabricante, país de origen, partida arancelaria, N° de proforma/factura, incoterm, moneda, FOB, cantidad, bultos, peso, volumen,
// arancel, seguro y notas. Los costos de flete/aduana/logística siguen en el embarque. Solo crea una tabla.
// Uso: node scripts/aplicar-migration-162.mjs
import mysql from 'mysql2/promise';
import { readFileSync, existsSync } from 'node:fs';

const env = { ...process.env };
for (const archivo of ['.env.local', '.env']) {
  if (!existsSync(archivo)) continue;
  for (const line of readFileSync(archivo, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  break;
}
if (!env.DB_HOST) { console.error('\n  Falta DB_HOST.\n'); process.exit(1); }

const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

try {
  console.log('\n  Aplicando migration-162 (compras_producto_importacion)...');
  await pool.query(`CREATE TABLE IF NOT EXISTS compras_producto_importacion (
    producto_id            INT           NOT NULL PRIMARY KEY,
    negocio_id             INT           NOT NULL,
    fabricante             VARCHAR(300)  NULL,
    pais_origen            VARCHAR(80)   NULL,
    partida_arancelaria    VARCHAR(30)   NULL,
    numero_factura         VARCHAR(80)   NULL,
    incoterm               VARCHAR(10)   NULL,
    moneda                 VARCHAR(6)    NULL,
    precio_fob             DECIMAL(18,4) NULL,
    cantidad_pedida        DECIMAL(18,3) NULL,
    bultos                 INT           NULL,
    peso_kg                DECIMAL(14,3) NULL,
    volumen_m3             DECIMAL(14,3) NULL,
    arancel_pct            DECIMAL(5,2)  NULL,
    seguro                 DECIMAL(18,2) NULL,
    notas                  TEXT          NULL,
    actualizado_por        INT           NULL,
    actualizado_por_nombre VARCHAR(160)  NULL,
    updated_at             DATETIME      NOT NULL,
    KEY idx_cpi_negocio (negocio_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  console.log('  Listo.\n');
} catch (e) {
  console.error('\n  Error:', e.message, '\n');
  process.exit(1);
} finally {
  await pool.end();
}
