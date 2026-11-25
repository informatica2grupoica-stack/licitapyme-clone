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
//   npx tsx scripts/anexos-banco.mts --lic COD1,COD2 --con-datos → todos los Word de esas licitaciones, con costeo,
//        bases, Auditor y OC como la ruta real (/api/anexos/generar), guardando el texto generado y los totales
//        para el diff (con --comparar muestra también los valores que CAMBIAN, no solo los que aparecen/desaparecen)
//
// `--generar` es el chequeo que ninguna métrica reemplaza: escribe el documento que realmente se
// subiría (mismo generarAnexoFinal que usa /api/anexos/generar, con las respuestas humanas
// vacías) para abrirlo en Word y MIRARLO. Un contador de "71 automáticos" no dice si el dato
// quedó en la casilla correcta ni si el formato sobrevivió.
//
// Va contra analizarAnexoParaUI — el motor 100% IA (anexos-ia-motor.ts, 3-ago-2026) reemplazó el
// diccionario, así que ya no tiene sentido reimplementar la resolución acá: se mide EXACTAMENTE
// lo mismo que ve /api/anexos/analizar, incluidas las casillas dentro de tablas (antes esta
// medición las dejaba fuera porque iba contra resolverCandidatosCelda directo).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const { abrirDocx } = await import('@/app/lib/anexos-docx');
const { analizarAnexoParaUI, generarAnexoFinal } = await import('@/app/lib/anexos-rellenar');
const { dividirPorFormularios } = await import('@/app/lib/anexos-dividir');
const { convertirDocADocx } = await import('@/app/lib/anexos-doc-legacy');
const { conCamposDerivados } = await import('@/app/lib/anexos-derivados');
const datosAnexo = await import('@/app/lib/anexos-datos');
const { textoPlanoDeXml } = await import('@/app/lib/anexos-dividir');

// Set por defecto: las licitaciones que HOY están en etapa ANEXOS, que son las únicas con una
// empresa realmente asignada (la asignación ocurre justo al entrar a esa etapa). Probar con
// cualquier otra licitación mide una combinación documento+empresa que no existe en producción.
const IDS_POR_DEFECTO = [20009, 21217, 21202];

const arg = (nombre: string) => {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const lics = arg('lic')?.split(',').map(x => x.trim()).filter(Boolean);
const conDatos = process.argv.includes('--con-datos');
let ids = (arg('ids')?.split(',').map(Number).filter(Boolean)) || IDS_POR_DEFECTO;
const empresaId = arg('empresa') ? Number(arg('empresa')) : undefined;
const salida = arg('out');
const comparar = arg('comparar');
const carpetaDocx = arg('generar');
if (carpetaDocx) mkdirSync(carpetaDocx, { recursive: true });

const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000,
});

// La empresa NO se elige a mano: es la que el negocio de esa licitación tiene asignada (se asigna
// al entrar a la etapa ANEXOS). Medir con otra empresa mide un caso que no existe. `--empresa`
// solo sirve para forzar una comparación puntual.
async function empresaDeLicitacion(codigo: string) {
  const id = empresaId ?? (await pool.query(
    `SELECT empresa_id FROM negocios WHERE licitacion_codigo = ? AND activo = TRUE AND empresa_id IS NOT NULL ORDER BY id DESC LIMIT 1`,
    [codigo],
  ) as any)[0][0]?.empresa_id;
  if (!id) return null;
  const [rows]: any = await pool.query(
    `SELECT razon_social, rut, direccion, region, giro, tipo_persona_juridica, fecha_sociedad,
            fecha_escritura, notaria, numero_repertorio, fojas_numero_anio,
            representante_nombre, representante_rut, representante_cargo,
            email1, telefono1, banco_tipo_cuenta, banco_numero, banco_nombre, banco_email, firma_url, timbre_url
       FROM empresas WHERE id = ?`, [id],
  );
  return rows[0] ? { id, empresa: conCamposDerivados(rows[0]) } : null;
}

interface ResultadoDoc {
  id: number; licitacion: string; nombre: string;
  auto: { etiqueta: string; campo: string; valor: string; via: string }[];
  pendientes: string[];
  alertas: string[];
  checklist: string[];
  error?: string;
  /** Solo con --con-datos: lo que queda escrito en el .docx final y los totales contra el costeo. */
  generado?: { lineas: string[]; totales: { etiqueta: string; valor: string }[]; avisos: string[]; costeoNeto: number | null; completados: number; firmaRequerida: boolean };
}

const resultados: ResultadoDoc[] = [];

// --lic: todos los Word de esas licitaciones (mismo criterio que la ruta real: cualquier .doc/.docx
// que no sea un documento propio).
if (lics?.length) {
  const [rows]: any = await pool.query(
    `SELECT id FROM documentos_cache WHERE licitacion_codigo IN (?) AND categoria <> 'DOCUMENTOS_PROPIOS'
        AND (documento_nombre LIKE '%.docx' OR documento_nombre LIKE '%.doc') ORDER BY licitacion_codigo, id`, [lics]);
  ids = rows.map((r: any) => r.id);
}
// Los bytes se guardan una vez en disco: así cada corrida mide el MISMO documento y no depende de la red.
const carpetaCache = join('scripts', 'scratch', 'cache-docs');
mkdirSync(carpetaCache, { recursive: true });

for (const id of ids) {
  const [docs]: any = await pool.query(
    `SELECT id, licitacion_codigo, documento_nombre, documento_url_local FROM documentos_cache WHERE id = ?`, [id],
  );
  const d = docs[0];
  if (!d) { console.log(`[${id}] no encontrado en documentos_cache`); continue; }

  const base: ResultadoDoc = { id, licitacion: d.licitacion_codigo, nombre: d.documento_nombre, auto: [], pendientes: [], alertas: [], checklist: [] };
  const asignada = await empresaDeLicitacion(d.licitacion_codigo);
  if (!asignada) { console.log(`[${id}] ${d.licitacion_codigo} no tiene empresa asignada — se omite`); continue; }
  let empresa = asignada.empresa;
  // Con --con-datos la ficha es la MISMA de la ruta real (ciudad/comuna, fecha del cierre, datos de la licitación).
  if (conDatos) { try { empresa = await datosAnexo.cargarEmpresaEnriquecida(d.licitacion_codigo, String(asignada.id)); } catch (e: any) { console.log(`  ERROR empresa: ${e?.message}`); resultados.push({ ...base, error: `empresa: ${e?.message}` }); continue; } }
  // El encabezado va ANTES del trabajo: la generación de .docx imprime sus propias líneas y sin
  // esto aparecían bajo el encabezado del documento anterior.
  console.log(`\n${'='.repeat(78)}\n[${base.licitacion}] ${base.nombre} (id ${id}) — empresa: ${empresa.razon_social}\n${'='.repeat(78)}`);
  try {
    const rutaCache = join(carpetaCache, `${id}.${/\.doc$/i.test(d.documento_nombre) ? 'docx' : 'bin'}`);
    let buffer: Buffer;
    if (existsSync(rutaCache)) buffer = readFileSync(rutaCache);
    else {
      const res = await fetch(d.documento_url_local);
      if (!res.ok) throw new Error(`descarga HTTP ${res.status}`);
      buffer = Buffer.from(await res.arrayBuffer());
      if (/\.doc$/i.test(d.documento_nombre)) buffer = Buffer.from(await convertirDocADocx(buffer));
      writeFileSync(rutaCache, buffer);
    }

    // Costeo, bases, Auditor y OC como la ruta real (los carga una sola vez por licitación).
    const extra = conDatos ? await (async () => {
      const [items, bases, auditor, expOc] = await Promise.all([
        datosAnexo.obtenerItemsCosteoParaAnexo(d.licitacion_codigo), datosAnexo.obtenerTextoBasesParaAnexo(d.licitacion_codigo),
        datosAnexo.obtenerDatosAuditorParaAnexo(d.licitacion_codigo), datosAnexo.obtenerExperienciaOcParaAnexo(Number(asignada.id)),
      ]);
      return { items, bases, auditor, expOc };
    })() : null;

    const analisis = extra
      ? await analizarAnexoParaUI(buffer, empresa, extra.items, extra.bases, extra.auditor, false, extra.expOc)
      : await analizarAnexoParaUI(buffer, empresa);

    for (const m of analisis.completadosAuto) base.auto.push({ etiqueta: m.etiqueta, campo: m.campo, valor: m.valor, via: m.via });
    // Las casillas de tabla (celda vacía dentro de una tabla real) NO están en completadosAuto —
    // el panel las muestra dentro de `tablas[].filas[].auto` (ver AnexoRellenoModal.tsx). Sin este
    // conteo, un anexo tipo "tabla de identificación" (Nombre/RUT/Dirección…) sin encabezado
    // aparecía con auto=0 aunque TODAS sus filas se hubieran completado solas — el banco medía mal
    // el caso justo donde más importa (bug real encontrado 6-ago-2026, 4999-8-LE26 Anexo N°1: 8 de
    // 10 filas se llenaban solas y el conteo decía 0).
    for (const t of analisis.tablas) {
      for (const f of t.filas) {
        for (const c of f) {
          if (c.auto) base.auto.push({ etiqueta: '(celda de tabla)', campo: '', valor: c.auto.valor, via: c.auto.via });
        }
      }
    }
    base.pendientes = [
      ...analisis.pendientesCelda.map(p => `${p.etiqueta}${p.categoria ? `  [${p.categoria}]` : ''}`),
      ...analisis.pendientesInline.map(p => `${(p.contexto || '(sin contexto)').trim()}  [inline${p.categoria ? `/${p.categoria}` : ''}]`),
      // Las casillas de tabla (celda vacía dentro de una tabla real) NO están en pendientesCelda —
      // el panel las muestra dentro de `tablas[].filas[].input` (ver AnexoRellenoModal.tsx). Se
      // cuentan igual acá para que el total refleje lo mismo que ve el usuario en el modal.
      ...analisis.tablas.flatMap(t => t.filas.flatMap(f => f.filter(c => c.input).map(() => '(celda de tabla)'))),
    ];
    base.alertas = (analisis.alertasInadmisibilidad || []).filter(a => !a.disponible).map(a => a.riesgo);
    base.checklist = analisis.checklistPendientes || [];

    if (extra) {
      const gen = await generarAnexoFinal(buffer, empresa, {}, extra.items, extra.bases, extra.auditor, extra.expOc);
      const xmlGen = (await abrirDocx(gen.buffer)).xml;
      const [cr]: any = await pool.query(
        `SELECT c.total_precio_neto FROM checklist_comercial_costeo c JOIN negocios n ON n.id = c.negocio_id
          WHERE n.licitacion_codigo = ? AND n.activo = TRUE AND c.vigente = 1 LIMIT 1`, [d.licitacion_codigo]);
      base.generado = {
        // Una línea por párrafo del documento tal como queda (para el diff antes/después).
        lineas: textoPlanoDeXml(xmlGen).split(/\n+/).map((x: string) => x.trim()).filter(Boolean),
        totales: (gen.totalesEscritos || []).map((t: any) => ({ etiqueta: t.etiqueta, valor: t.valor })),
        avisos: gen.avisos || [], costeoNeto: cr[0]?.total_precio_neto != null ? Number(cr[0].total_precio_neto) : null,
        completados: gen.completados, firmaRequerida: !!gen.firmaRequerida,
      };
    }

    // Mismo camino EXACTO que /api/anexos/generar (relleno + verificación de integridad +
    // división por formulario), con las respuestas humanas vacías — lo que se sube si el usuario
    // no escribe nada a mano.
    if (carpetaDocx) {
      const gen = extra
        ? await generarAnexoFinal(buffer, empresa, {}, extra.items, extra.bases, extra.auditor, extra.expOc)
        : await generarAnexoFinal(buffer, empresa, {});
      if (!gen.integridad.parrafosIguales) {
        console.log(`  ⚠ integridad FALLÓ (${gen.integridad.parrafosAntes} → ${gen.integridad.parrafosDespues} párrafos) — no se escribe`);
      } else {
        const formularios = await dividirPorFormularios(gen.buffer, (await abrirDocx(gen.buffer)).xml);
        const piezas = formularios.length >= 2
          ? formularios.map(f => ({ nombre: `${base.licitacion}_ANEXO_${f.nombreSufijo}_${d.documento_nombre}`, buffer: f.buffer }))
          : [{ nombre: `${base.licitacion}_ANEXO_${d.documento_nombre}`, buffer: gen.buffer }];
        for (const p of piezas) {
          writeFileSync(join(carpetaDocx, p.nombre), p.buffer);
          console.log(`  → ${join(carpetaDocx, p.nombre)}`);
        }
      }
    }
  } catch (e: any) {
    base.error = e?.message || String(e);
  }
  resultados.push(base);

  if (base.error) { console.log(`  ERROR: ${base.error}`); continue; }
  console.log(`  auto=${base.auto.length}  pendientes=${base.pendientes.length}  alertas=${base.alertas.length}  checklist=${base.checklist.length}`);
  for (const a of base.alertas) console.log(`   ⚠ ALERTA: ${a}`);
  for (const c of base.checklist) console.log(`   ☐ checklist: ${c}`);
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
      // Valores que CAMBIAN en una casilla que sigue automática (un dato equivocado nuevo no se vería de otro modo).
      const valorDe = (xs: { etiqueta: string; campo: string; valor: string }[]) => {
        const m = new Map<string, string[]>();
        for (const a of xs) m.set(claveAuto(a), [...(m.get(claveAuto(a)) || []), a.valor]);
        return m;
      };
      const vAntes = valorDe(antes.auto), vAhora = valorDe(ahora.auto);
      const cambiados: string[] = [];
      for (const [k, v] of vAhora) {
        const o = vAntes.get(k); if (!o) continue;
        if (JSON.stringify(o) !== JSON.stringify(v)) cambiados.push(`${k}: «${o.join('|')}» → «${v.join('|')}»`);
      }
      // Líneas del documento generado que aparecen / desaparecen.
      const lAntes = new Set(antes.generado?.lineas || []), lAhora = new Set(ahora.generado?.lineas || []);
      const lineasNuevas = antes.generado && ahora.generado ? [...lAhora].filter(l => !lAntes.has(l)) : [];
      const lineasPerdidas = antes.generado && ahora.generado ? [...lAntes].filter(l => !lAhora.has(l)) : [];
      if (!ganados.length && !perdidos.length && !cambiados.length && !lineasNuevas.length && !lineasPerdidas.length) continue;
      console.log(`\n[${ahora.licitacion}] ${ahora.nombre}  (${antes.auto.length} → ${ahora.auto.length} auto)`);
      for (const g of ganados) console.log(`   + ${g}`);
      for (const p of perdidos) console.log(`   - ${p}   ← REGRESIÓN, revisar`);
      for (const c of cambiados) console.log(`   ~ ${c}   ← VALOR DISTINTO, revisar`);
      for (const l of lineasPerdidas.slice(0, 12)) console.log(`   ◂ ${l.slice(0, 160)}`);
      for (const l of lineasNuevas.slice(0, 12)) console.log(`   ▸ ${l.slice(0, 160)}`);
    }
    const autoAntes = previo.reduce((s, r) => s + r.auto.length, 0);
    console.log(`\nTotal automáticos: ${autoAntes} → ${totalAuto}  (${totalAuto - autoAntes >= 0 ? '+' : ''}${totalAuto - autoAntes})`);
  }
}

await pool.end();

process.exit(0); // la conexión del pool de la app queda abierta y el proceso no terminaba solo
