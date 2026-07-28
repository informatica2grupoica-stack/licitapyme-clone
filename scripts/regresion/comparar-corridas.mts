// Frente A.3 — AUTOMATIZA la "regla de promoción" del plan estratégico: "mejora sin empeorar
// ningún módulo, o no entra". Hasta hoy esta decisión era 100% manual (alguien comparaba dos
// reportes JSON a ojo). Este script compara DOS corridas de run.ts (una de ANTES de un cambio, una
// de DESPUÉS) caso por caso y MÉTRICA POR MÉTRICA (no un solo "aprobado/reprobado" global — así lo
// exige el plan: "métrica por módulo, no global"), y da un veredicto automático.
//
// Uso:
//   npx tsx scripts/regresion/run.ts --run                     # ANTES de tocar nada, guarda el reporte
//   ...hacés el cambio de código/prompt...
//   npx tsx scripts/regresion/run.ts --run                     # DESPUÉS del cambio, guarda otro reporte
//   npx tsx scripts/regresion/comparar-corridas.mts <reporte-antes.json> <reporte-despues.json>
//
// Los reportes son los que run.ts ya deja en el scratchpad (REPORTE_DIR) tras cada corrida.
import { readFileSync } from 'fs';

const [rutaAntes, rutaDespues] = process.argv.slice(2);
if (!rutaAntes || !rutaDespues) {
  console.error('Uso: npx tsx scripts/regresion/comparar-corridas.mts <reporte-antes.json> <reporte-despues.json>');
  process.exit(1);
}

interface Chequeo { metrica: string; esperado: string; obtenido: string; ok: boolean }
interface DetalleCaso { codigo: string; ok?: boolean; chequeos?: Chequeo[]; error?: string }
interface Reporte { etiqueta: string; casosOK: number; total: number; detalle: DetalleCaso[] }

const antes: Reporte = JSON.parse(readFileSync(rutaAntes, 'utf8'));
const despues: Reporte = JSON.parse(readFileSync(rutaDespues, 'utf8'));

const porCodigoAntes = new Map(antes.detalle.map(d => [d.codigo, d]));
const porCodigoDespues = new Map(despues.detalle.map(d => [d.codigo, d]));

type Cambio = { codigo: string; metrica: string; esperado: string; antes: string; despues: string };
const mejoras: Cambio[] = [];
const regresiones: Cambio[] = [];
const casosNuevos: string[] = [];   // en "después" pero no en "antes" — no se pueden comparar
const casosPerdidos: string[] = []; // en "antes" pero no en "después" — sospechoso, avisar

for (const [codigo, dDespues] of porCodigoDespues) {
  const dAntes = porCodigoAntes.get(codigo);
  if (!dAntes) { casosNuevos.push(codigo); continue; }
  const chequeosAntes = new Map((dAntes.chequeos || []).map(c => [c.metrica, c]));
  const chequeosDespues = new Map((dDespues.chequeos || []).map(c => [c.metrica, c]));
  for (const [metrica, cDespues] of chequeosDespues) {
    const cAntes = chequeosAntes.get(metrica);
    if (!cAntes) continue; // métrica nueva, sin línea base — no cuenta ni a favor ni en contra
    if (cAntes.ok && !cDespues.ok) {
      regresiones.push({ codigo, metrica, esperado: cDespues.esperado, antes: cAntes.obtenido, despues: cDespues.obtenido });
    } else if (!cAntes.ok && cDespues.ok) {
      mejoras.push({ codigo, metrica, esperado: cDespues.esperado, antes: cAntes.obtenido, despues: cDespues.obtenido });
    }
  }
}
for (const codigo of porCodigoAntes.keys()) {
  if (!porCodigoDespues.has(codigo)) casosPerdidos.push(codigo);
}

console.log(`\n================ COMPARACIÓN DE CORRIDAS (Frente A.3) ================`);
console.log(`Antes:   ${antes.etiqueta} — ${antes.casosOK}/${antes.total} casos perfectos`);
console.log(`Después: ${despues.etiqueta} — ${despues.casosOK}/${despues.total} casos perfectos`);

if (casosNuevos.length) console.log(`\n(${casosNuevos.length} caso(s) nuevo(s) en "después" sin línea base para comparar: ${casosNuevos.join(', ')})`);
if (casosPerdidos.length) console.log(`\n⚠ ${casosPerdidos.length} caso(s) que estaban en "antes" YA NO aparecen en "después" — revisar por qué: ${casosPerdidos.join(', ')}`);

console.log(`\n✅ MEJORAS (${mejoras.length}):`);
for (const m of mejoras) console.log(`   ${m.codigo} · ${m.metrica}: "${m.antes}" → "${m.despues}" (esperado: "${m.esperado}")`);
if (!mejoras.length) console.log('   (ninguna)');

console.log(`\n❌ REGRESIONES (${regresiones.length}):`);
for (const r of regresiones) console.log(`   ${r.codigo} · ${r.metrica}: "${r.antes}" → "${r.despues}" (esperado: "${r.esperado}")`);
if (!regresiones.length) console.log('   (ninguna)');

console.log(`\n================ VEREDICTO ================`);
if (regresiones.length > 0) {
  console.log(`❌ NO PROMUEVE — hay ${regresiones.length} regresión(es). La regla del plan es estricta: "mejora sin empeorar ningún módulo", así que basta UNA regresión para no entrar, aunque haya mejoras en paralelo.`);
  process.exitCode = 1;
} else if (mejoras.length > 0) {
  console.log(`✅ PROMUEVE — ${mejoras.length} mejora(s), cero regresiones.`);
} else {
  console.log(`➖ SIN CAMBIO NETO — no hay mejoras ni regresiones. No hace falta promover nada (o el cambio no tuvo efecto medible en el golden set).`);
}
