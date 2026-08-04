// Backfill histórico de órdenes de compra: barre hacia atrás el listado diario de Mercado Público
// (y la consulta directa por proveedor, para las empresas que ya tienen su código descubierto) y
// cruza contra TODAS las licitaciones que alguna vez ofertamos (POSTULADA/POSIBLE_ADJ/ADJUDICADA/
// PERDIDA), no solo los últimos 3 días como hace el cron diario.
//
// Reusa exactamente la misma lógica que el cron (sincronizarOrdenesCompra en app/lib/ordenes-compra.ts):
// mismo cruce por nombre, misma verificación por RUT del proveedor (nunca por la licitación, para no
// robarle al competidor su OC como si fuera nuestra), mismo guardado con items/comprador completos.
// La única diferencia es `avisar: false`: sin esto, cargar meses de OC ya "viejas" dispararía una
// campana y un correo por cada una, como si fueran noticia del día.
//
// Uso: npx tsx scripts/backfill-ordenes-compra.mjs [dias]
//   dias por defecto: 125 (cubre desde la adjudicación real más antigua registrada, 13-abr-2026,
//   hasta hoy — ver adjudicacion_cache.fecha_adjudicacion).
//
// OJO: tarda. Son ~2 llamadas por día (barrido + 1 por empresa con código de proveedor ya
// descubierto) con 1.2s de pausa entre cada una para no gatillar el "Código 10500" de la API.
// app/lib/db.ts lee process.env.DB_* directo (Next.js carga .env.local solo, un script suelto no).
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}

const { sincronizarOrdenesCompra } = await import('../app/lib/ordenes-compra.ts');

const dias = Math.max(1, parseInt(process.argv[2] || '125', 10));
console.log(`Backfill de órdenes de compra: barriendo ${dias} días hacia atrás, sin avisos...\n`);

const t0 = Date.now();
const r = await sincronizarOrdenesCompra({ dias, avisar: false });
const seg = Math.round((Date.now() - t0) / 1000);

console.log(JSON.stringify(r, null, 2));
console.log(`\nListo en ${seg}s. Nuevas: ${r.nuevas} · cambios de estado: ${r.cambiosEstado} · de terceros (no nuestras): ${r.deTerceros}`);
process.exit(0);
