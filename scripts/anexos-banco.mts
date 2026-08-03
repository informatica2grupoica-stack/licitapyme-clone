// Banco de pruebas del Anexo Creator — mide, sobre anexos REALES de licitaciones distintas,
// qué campos se completan solos y cuáles quedan pendientes. Es la mesa para iterar el prompt/
// diccionario: se corre ANTES de un cambio (baseline) y DESPUÉS, y se comparan los dos JSON.
//
//   npx tsx scripts/anexos-banco.mts                      → corre el set por defecto
//   npx tsx scripts/anexos-banco.mts --ids 21719,21712    → solo esos documentos
//   npx tsx scripts/anexos-banco.mts --empresa 1          → con otra empresa
//   npx tsx scripts/anexos-banco.mts --out baseline.json  → guarda para comparar
//   npx tsx scripts/anexos-banco.mts --comparar baseline.json  → corre y hace el diff
//   npx tsx scripts/anexos-banco.mts --generar salida/         → ADEMÁS escribe los .docx finales
//
// `--generar` es el chequeo que ninguna métrica reemplaza: escribe el documento que realmente se
// subiría (mismo generarAnexoFinal que usa /api/anexos/generar, con las respuestas humanas
// vacías) para abrirlo en Word y MIRARLO. Un contador de "71 automáticos" no dice si el dato
// quedó en la casilla correcta ni si el formato sobrevivió.
//
// Va contra resolverCandidatosCelda (no analizarAnexoParaUI) a propósito: necesita la ETIQUETA de
// cada pendiente, y la vista de UI las esconde dentro de la reconstrucción de tablas.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const { analizarAnexo } = await import('@/app/lib/anexos-detectar');
const { normalizarParaIds, abrirDocx } = await import('@/app/lib/anexos-docx');
const { resolverCandidatosCelda, resolverBlancosInline, resolverCamposConDosPuntos } = await import('@/app/lib/anexos-rellenar');
const { convertirDocADocx } = await import('@/app/lib/anexos-doc-legacy');
const { conCamposDerivados } = await import('@/app/lib/anexos-derivados');

// Set por defecto: las licitaciones que HOY están en etapa ANEXOS, que son las únicas con una
// empresa realmente asignada (la asignación ocurre justo al entrar a esa etapa). Probar con
// cualquier otra licitación mide una combinación documento+empresa que no existe en producción.
const IDS_POR_DEFECTO = [20009, 21217, 21202];

const arg = (nombre: string) => {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const ids = (arg('ids')?.split(',').map(Number).filter(Boolean)) || IDS_POR_DEFECTO;
const empresaId = arg('empresa') ? Number(arg('empresa')) : undefined;
const salida = arg('out');
const comparar = arg('comparar');

const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000,
});

// La empresa NO se elige a mano: es la que el negocio de esa licitación tiene asignada (se asigna
// al entrar a la etapa ANEXOS). Medir con otra empresa mide un caso que no existe. `--empresa`
// solo sirve para forzar una comparación puntual.
async function empresaDeLicitacion(codigo: string) {
  const id = empresaId ?? (await pool.query(
    `SELECT empresa_id FROM negocios WHERE licitacion_codigo = ? AND activo = TRUE AND empresa_id IS NOT NULL LIMIT 1`,
    [codigo],
  ) as any)[0][0]?.empresa_id;
  if (!id) return null;
  const [rows]: any = await pool.query(
    `SELECT razon_social, rut, direccion, region, giro, tipo_persona_juridica, fecha_sociedad,
            representante_nombre, representante_rut, representante_cargo,
            email1, telefono1, banco_tipo_cuenta, banco_numero, banco_nombre, banco_email, firma_url
       FROM empresas WHERE id = ?`, [id],
  );
  return rows[0] ? { id, empresa: conCamposDerivados(rows[0]) } : null;
}

interface ResultadoDoc {
  id: number; licitacion: string; nombre: string;
  auto: { etiqueta: string; campo: string; valor: string; via: string }[];
  pendientes: string[];
  error?: string;
}

const resultados: ResultadoDoc[] = [];

for (const id of ids) {
  const [docs]: any = await pool.query(
    `SELECT id, licitacion_codigo, documento_nombre, documento_url_local FROM documentos_cache WHERE id = ?`, [id],
  );
  const d = docs[0];
  if (!d) { console.log(`[${id}] no encontrado en documentos_cache`); continue; }

  const base: ResultadoDoc = { id, licitacion: d.licitacion_codigo, nombre: d.documento_nombre, auto: [], pendientes: [] };
  const asignada = await empresaDeLicitacion(d.licitacion_codigo);
  if (!asignada) { console.log(`[${id}] ${d.licitacion_codigo} no tiene empresa asignada — se omite`); continue; }
  const empresa = asignada.empresa;
  try {
    const res = await fetch(d.documento_url_local);
    if (!res.ok) throw new Error(`descarga HTTP ${res.status}`);
    let buffer: Buffer = Buffer.from(await res.arrayBuffer());
    if (/\.doc$/i.test(d.documento_nombre)) buffer = Buffer.from(await convertirDocADocx(buffer));

    const { xml: xmlCrudo } = await abrirDocx(buffer);
    const { xml } = normalizarParaIds(xmlCrudo);
    const analisis = analizarAnexo(xml);

    const { matcheados, pendientes, descartadosComoTitulo }
      = await resolverCandidatosCelda(analisis.candidatosCelda, empresa, analisis.indicesSoloManual);

    for (const m of matcheados) base.auto.push({ etiqueta: m.c.etiqueta, campo: m.campo, valor: m.valor, via: m.via });
    for (const r of resolverCamposConDosPuntos(analisis.camposConDosPuntos, empresa)) {
      base.auto.push({ etiqueta: r.c.etiqueta, campo: r.campo, valor: r.valor, via: 'dos-puntos' });
    }
    const inline = resolverBlancosInline(analisis.blancosInline, empresa);
    for (const a of inline.auto) base.auto.push({ etiqueta: a.etiqueta, campo: a.campo, valor: a.valor, via: 'inline' });

    base.pendientes = [
      ...pendientes.map(c => c.etiqueta),
      ...descartadosComoTitulo.map(c => `${c.etiqueta}  [visto como título]`),
      ...inline.pendientes.map(b => `${(b.contexto || '(sin contexto)').trim()}  [inline]`),
    ];
  } catch (e: any) {
    base.error = e?.message || String(e);
  }
  resultados.push(base);

  const cab = `[${base.licitacion}] ${base.nombre} (id ${id}) — empresa: ${empresa.razon_social}`;
  console.log(`\n${'='.repeat(78)}\n${cab}\n${'='.repeat(78)}`);
  if (base.error) { console.log(`  ERROR: ${base.error}`); continue; }
  console.log(`  auto=${base.auto.length}  pendientes=${base.pendientes.length}`);
  for (const a of base.auto) console.log(`   ✓ "${a.etiqueta}" → ${a.campo} = "${a.valor}"  (${a.via})`);
  for (const p of base.pendientes) console.log(`   · ${p}`);
}

const totalAuto = resultados.reduce((s, r) => s + r.auto.length, 0);
const totalPend = resultados.reduce((s, r) => s + r.pendientes.length, 0);
console.log(`\n${'#'.repeat(78)}\nTOTAL: ${totalAuto} completados automáticos · ${totalPend} pendientes · ${resultados.length} documentos\n${'#'.repeat(78)}`);

if (salida) {
  writeFileSync(salida, JSON.stringify(resultados, null, 2), 'utf8');
  console.log(`\nGuardado en ${salida}`);
}

if (comparar) {
  if (!existsSync(comparar)) { console.error(`\nNo existe ${comparar}`); }
  else {
    const previo: ResultadoDoc[] = JSON.parse(readFileSync(comparar, 'utf8'));
    console.log(`\n${'#'.repeat(78)}\nDIFF contra ${comparar}\n${'#'.repeat(78)}`);
    for (const ahora of resultados) {
      const antes = previo.find(p => p.id === ahora.id);
      if (!antes) { console.log(`\n[${ahora.licitacion}] ${ahora.nombre} — NUEVO en este set`); continue; }
      const claveAuto = (a: { etiqueta: string; campo: string }) => `${a.etiqueta} → ${a.campo}`;
      const antesAuto = new Set(antes.auto.map(claveAuto));
      const ahoraAuto = new Set(ahora.auto.map(claveAuto));
      const ganados = [...ahoraAuto].filter(k => !antesAuto.has(k));
      const perdidos = [...antesAuto].filter(k => !ahoraAuto.has(k));
      if (!ganados.length && !perdidos.length) continue;
      console.log(`\n[${ahora.licitacion}] ${ahora.nombre}  (${antes.auto.length} → ${ahora.auto.length} auto)`);
      for (const g of ganados) console.log(`   + ${g}`);
      for (const p of perdidos) console.log(`   - ${p}   ← REGRESIÓN, revisar`);
    }
    const autoAntes = previo.reduce((s, r) => s + r.auto.length, 0);
    console.log(`\nTotal automáticos: ${autoAntes} → ${totalAuto}  (${totalAuto - autoAntes >= 0 ? '+' : ''}${totalAuto - autoAntes})`);
  }
}

await pool.end();
