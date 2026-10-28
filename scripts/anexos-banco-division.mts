// Banco de la SEPARACIÓN de anexos (anexos-dividir.ts): compara dónde corta detectarFormularios en
// la versión de git indicada (por defecto HEAD) contra la del disco, sobre .docx reales de la BD.
// Se corre después de tocar la detección de encabezados, antes de dar el cambio por bueno: un
// arreglo para una licitación puede partir o fusionar anexos en otras (27-oct-2026, 4022-19-LE26).
//
//   npx tsx scripts/anexos-banco-division.mts                  → 400 .docx más recientes vs HEAD
//   npx tsx scripts/anexos-banco-division.mts --limite 1000    → más documentos
//   npx tsx scripts/anexos-banco-division.mts --ref HEAD~3     → contra otra versión
//   npx tsx scripts/anexos-banco-division.mts --ids 30617,30601 → solo esos documentos
//   npx tsx scripts/anexos-banco-division.mts --fragmentos     → además compara con qué texto empieza
//     y termina cada fragmento ya armado (una tabla que caía en dos anexos, 28-oct-2026) y su categoría
//
// Imprime solo los documentos donde el corte cambió (índice de inicio + título de cada anexo).
// Cada diferencia hay que mirarla: anexo nuevo bien separado = mejora; anexo real perdido, título
// pegado al anexo anterior o corte en membrete repetido = retroceso.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim();
}

const arg = (nombre: string): string | undefined => {
  const i = process.argv.indexOf(nombre);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const ref = arg('--ref') ?? 'HEAD';
const limite = Number(arg('--limite') ?? 400);
const ids = (arg('--ids') ?? '').split(',').map(s => Number(s.trim())).filter(Boolean);

type Formulario = { titulo: string; indiceInicio: number };
type Detector = {
  detectarFormularios: (xml: string) => Formulario[];
  dividirPorFormularios: (buffer: Buffer, xml: string) => Promise<{ buffer: Buffer; categoria: string }[]>;
};
const conFragmentos = process.argv.includes('--fragmentos');

// La versión de referencia se copia a scripts/scratch/ (ignorada por git y por tsconfig).
mkdirSync('scripts/scratch', { recursive: true });
const rutaRef = resolve('scripts/scratch/_anexos-dividir-ref.ts');
writeFileSync(rutaRef, execFileSync('git', ['show', `${ref}:app/lib/anexos-dividir.ts`], { encoding: 'utf8' }));
const anterior = (await import(pathToFileURL(rutaRef).href)) as Detector;
const actual = (await import('@/app/lib/anexos-dividir')) as Detector;
const { abrirDocx, normalizarParaIds } = await import('@/app/lib/anexos-docx');
const pool = (await import('@/app/lib/db')).default;

const [filas] = await pool.query(
  ids.length
    ? `SELECT id, licitacion_codigo, documento_nombre, documento_url_local FROM documentos_cache WHERE id IN (?)`
    : `SELECT id, licitacion_codigo, documento_nombre, documento_url_local FROM documentos_cache
        WHERE documento_nombre LIKE '%.docx'
          AND categoria IN ('ANEXOS_OFERENTE','ANEXOS_ADMINISTRATIVOS','ANEXOS_TECNICOS','ANEXOS_ECONOMICOS','BASES_ADMINISTRATIVAS','BASES_TECNICAS')
        ORDER BY id DESC LIMIT ?`,
  [ids.length ? ids : limite],
);
const docs = filas as { id: number; licitacion_codigo: string; documento_nombre: string; documento_url_local: string }[];

const resumir = (fs: Formulario[]) => fs.map(f => `${f.indiceInicio}: ${f.titulo}`);
// Primera y última línea con texto de cada fragmento ya armado, y su categoría.
async function bordesDeFragmentos(d: Detector, buffer: Buffer, xml: string): Promise<string[]> {
  const out: string[] = [];
  for (const f of await d.dividirPorFormularios(buffer, xml)) {
    const lineas = [...(await abrirDocx(f.buffer)).xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
      .map(m => [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(t => t[1]).join('').trim()).filter(Boolean);
    out.push(`  [${lineas.length} líneas, ${f.categoria}] «${(lineas[0] ?? '').slice(0, 50)}» … «${(lineas.at(-1) ?? '').slice(0, 50)}»`);
  }
  return out;
}
let iguales = 0, distintos = 0, errores = 0;
for (const d of docs) {
  try {
    const res = await fetch(d.documento_url_local);
    if (!res.ok) { errores++; continue; }
    const buffer = Buffer.from(await res.arrayBuffer());
    const { xml } = normalizarParaIds((await abrirDocx(buffer)).xml);
    const antes = resumir(anterior.detectarFormularios(xml));
    const ahora = resumir(actual.detectarFormularios(xml));
    if (conFragmentos) {
      antes.push(...await bordesDeFragmentos(anterior, buffer, xml));
      ahora.push(...await bordesDeFragmentos(actual, buffer, xml));
    }
    if (JSON.stringify(antes) === JSON.stringify(ahora)) { iguales++; continue; }
    distintos++;
    console.log(`\n### ${d.id} ${d.licitacion_codigo} ${d.documento_nombre}`);
    console.log(`  ANTES (${antes.length}):\n    ${antes.join('\n    ')}`);
    console.log(`  AHORA (${ahora.length}):\n    ${ahora.join('\n    ')}`);
  } catch {
    errores++;
  }
}
console.log(`\nTOTAL ${docs.length}: iguales ${iguales}, distintos ${distintos}, errores ${errores} (referencia: ${ref})`);
process.exit(0);
