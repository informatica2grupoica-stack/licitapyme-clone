// Limpia duplicados YA MATERIALIZADOS en checklist_comercial (bloque ADMINISTRATIVO), causados
// por el bug descrito en checklist-comercial.ts (dedupe débil entre orden_anexos_propios,
// documentos_infaltables, garantías estructuradas y bloqueantes — corregido 24-ago-2026).
// sincronizar() es INSERT IGNORE puro: nunca borra, así que las filas duplicadas insertadas
// ANTES del fix se quedan ahí para siempre a menos que se limpien a mano. Esto lo hace.
//
// Importa numeroDeFormatoEn/nucleoDeTitulo/nucleosCoinciden DIRECTO de checklist-comercial.ts en
// vez de reimplementarlos acá: la primera versión de este script reimplementaba el criterio a
// mano y quedó desincronizada del código real en la primera pasada (el fallback 'sin_nombre' de
// slug() y el regex que no capturaba sub-índices como "6.1" causaban fusiones falsas que el
// código de producción ya no comete). Una sola fuente de verdad evita que se repita.
//
// Por defecto corre en modo DRY RUN (solo reporta, no borra nada). Pasar --aplicar para borrar
// de verdad. Solo borra un duplicado cuando es 100% seguro: SIN documentos adjuntos, estado
// PENDIENTE, sin observación/valor/aprobación — es decir, nadie lo tocó todavía. Si CUALQUIER
// ítem del grupo duplicado tiene evidencia real, el grupo entero se deja intacto y se reporta
// para revisión manual.
//
// Uso:
//   npx tsx scripts/limpiar-checklist-duplicados.mts            (dry run)
//   npx tsx scripts/limpiar-checklist-duplicados.mts --aplicar  (borra los duplicados seguros)
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import { numeroDeFormatoEn, nucleoDeTitulo, nucleosCoinciden } from '../app/lib/checklist-comercial.js';

const APLICAR = process.argv.includes('--aplicar');
// Los grupos "en conflicto" (evidencia cargada en MÁS de una fila del mismo anexo) se dejaban
// siempre para revisión manual, y así quedaron a la vista duplicados que nadie limpiaba nunca
// —el Anexo N°1 aprobado dos veces en 2724-35-LP26, los Anexos N°11 y N°12 en 3489-29-LP26
// (reportado 25-ago-2026). Con --fusionar se resuelven solos: gana la fila con el estado más
// avanzado (sus firmas se conservan tal cual, jamás se inventa una aprobación) y ABSORBE los
// documentos, el valor y la observación de las otras antes de borrarlas. Nada de evidencia se
// pierde: los adjuntos se reasignan, no se borran.
const FUSIONAR = process.argv.includes('--fusionar');
const RANK_ESTADO: Record<string, number> = { APROBADO: 3, CARGADO: 2, OBSERVADO: 1, PENDIENTE: 0 };

const env: Record<string, string> = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

interface Fila {
  id: number; negocio_id: number; licitacion_codigo: string; titulo: string; clave_origen: string;
  estado: string; observacion: string | null; valor_texto: string | null; valor_numero: number | null;
  cargado_por: number | null; aprobado_por: number | null;
}

function tieneEvidencia(fila: Fila, nDocs: number | undefined): boolean {
  return (nDocs || 0) > 0
    || fila.estado !== 'PENDIENTE'
    || fila.observacion != null
    || fila.valor_texto != null
    || fila.valor_numero != null
    || fila.cargado_por != null
    || fila.aprobado_por != null;
}

// Misma regla que coincidenEntradas() en checklist-comercial.ts: número explícito manda (igual o
// distinto veta), y solo cae a núcleo si a alguno le falta el número.
function coincide(a: Fila, b: Fila): boolean {
  const na = numeroDeFormatoEn(a.titulo);
  const nb = numeroDeFormatoEn(b.titulo);
  if (na != null && nb != null) return na === nb;
  return nucleosCoinciden(nucleoDeTitulo(a.titulo), nucleoDeTitulo(b.titulo));
}

async function main() {
  const [filas] = await pool.query(
    `SELECT id, negocio_id, licitacion_codigo, titulo, clave_origen, estado, observacion,
            valor_texto, valor_numero, cargado_por, aprobado_por
     FROM checklist_comercial
     WHERE bloque = 'ADMINISTRATIVO'
     ORDER BY negocio_id, id`,
  ) as unknown as [Fila[], unknown];
  const listaFilas = filas as unknown as Fila[];

  let docRows: Array<{ item_id: number; n: number }> = [];
  try {
    const [r] = await pool.query(`SELECT item_id, COUNT(*) AS n FROM checklist_comercial_documentos GROUP BY item_id`) as any;
    docRows = r;
  } catch { /* tabla puede no existir aún */ }
  const nDocsPorItem = new Map(docRows.map(r => [r.item_id, r.n]));

  const porNegocio = new Map<number, Fila[]>();
  for (const f of listaFilas) {
    if (!porNegocio.has(f.negocio_id)) porNegocio.set(f.negocio_id, []);
    porNegocio.get(f.negocio_id)!.push(f);
  }

  let gruposEncontrados = 0;
  let filasBorrables = 0;
  let gruposConConflicto = 0;
  const idsABorrar: number[] = [];
  const fusiones: Array<{ ganadora: Fila; perdedoras: Fila[] }> = [];
  const reporte: any[] = [];

  for (const [negocioId, items] of porNegocio) {
    // Los "bloqueantes" (clave_origen "bloqueante:...") quedan FUERA del cruce por número/núcleo:
    // citan un N° de anexo como contexto de una advertencia sin SER ese anexo — mismo criterio
    // que checklist-comercial.ts. Solo se agrupan entre sí por clave_origen idéntica.
    const documentos = items.filter(f => !f.clave_origen.startsWith('bloqueante:'));
    const bloqueantes = items.filter(f => f.clave_origen.startsWith('bloqueante:'));

    const grupos: Fila[][] = [];
    for (const f of documentos) {
      const grupo = grupos.find(g => coincide(f, g[0]));
      if (grupo) grupo.push(f); else grupos.push([f]);
    }
    const porClaveBloqueante = new Map<string, Fila[]>();
    for (const f of bloqueantes) {
      if (!porClaveBloqueante.has(f.clave_origen)) porClaveBloqueante.set(f.clave_origen, []);
      porClaveBloqueante.get(f.clave_origen)!.push(f);
    }
    for (const g of porClaveBloqueante.values()) grupos.push(g);

    for (const g of grupos) {
      if (g.length < 2) continue;
      gruposEncontrados++;
      const conEvidencia = g.filter(f => tieneEvidencia(f, nDocsPorItem.get(f.id)));
      if (conEvidencia.length > 1 && FUSIONAR) {
        // Estado primero (no se degrada una aprobación), después cantidad de adjuntos, y a
        // igualdad la más antigua — que es la que el equipo viene trabajando.
        const ganadora = [...g].sort((a, b) =>
          (RANK_ESTADO[b.estado] ?? 0) - (RANK_ESTADO[a.estado] ?? 0)
          || (nDocsPorItem.get(b.id) || 0) - (nDocsPorItem.get(a.id) || 0)
          || a.id - b.id)[0];
        const perdedoras = g.filter(f => f.id !== ganadora.id);
        fusiones.push({ ganadora, perdedoras });
        filasBorrables += perdedoras.length;
        idsABorrar.push(...perdedoras.map(f => f.id));
        reporte.push({
          negocioId, codigo: g[0].licitacion_codigo, tipo: 'FUSION',
          conserva: { id: ganadora.id, titulo: ganadora.titulo, estado: ganadora.estado },
          borra: perdedoras.map(f => ({ id: f.id, titulo: f.titulo, estado: f.estado, docs: nDocsPorItem.get(f.id) || 0 })),
        });
        continue;
      }
      if (conEvidencia.length > 1) {
        gruposConConflicto++;
        reporte.push({ negocioId, codigo: g[0].licitacion_codigo, tipo: 'CONFLICTO', filas: g.map(f => ({ id: f.id, titulo: f.titulo, estado: f.estado })) });
        continue;
      }
      const conservar = conEvidencia[0] || g.reduce((a, b) => (a.id < b.id ? a : b));
      const borrar = g.filter(f => f.id !== conservar.id);
      filasBorrables += borrar.length;
      idsABorrar.push(...borrar.map(f => f.id));
      reporte.push({
        negocioId, codigo: g[0].licitacion_codigo, tipo: 'SEGURO',
        conserva: { id: conservar.id, titulo: conservar.titulo },
        borra: borrar.map(f => ({ id: f.id, titulo: f.titulo })),
      });
    }
  }

  console.log(`\nNegocios revisados: ${porNegocio.size}`);
  console.log(`Grupos duplicados encontrados: ${gruposEncontrados}`);
  console.log(`  → seguros de limpiar: ${gruposEncontrados - gruposConConflicto} grupo(s), ${filasBorrables} fila(s) a borrar`);
  console.log(`  → con conflicto (evidencia en más de una fila, revisión manual): ${gruposConConflicto}`);

  console.log('\n--- Detalle ---');
  for (const r of reporte) {
    if (r.tipo === 'SEGURO') {
      console.log(`\n[SEGURO] negocio=${r.negocioId} (${r.codigo})`);
      console.log(`  conserva #${r.conserva.id}: "${r.conserva.titulo}"`);
      for (const b of r.borra) console.log(`  borra    #${b.id}: "${b.titulo}"`);
    } else if (r.tipo === 'FUSION') {
      console.log(`\n[FUSIÓN] negocio=${r.negocioId} (${r.codigo})`);
      console.log(`  conserva #${r.conserva.id} [${r.conserva.estado}]: "${r.conserva.titulo}"`);
      for (const b of r.borra) console.log(`  absorbe  #${b.id} [${b.estado}, ${b.docs} doc(s)] y la borra: "${b.titulo}"`);
    } else {
      console.log(`\n[CONFLICTO] negocio=${r.negocioId} (${r.codigo}) — requiere revisión manual:`);
      for (const f of r.filas) console.log(`  #${f.id} [${f.estado}]: "${f.titulo}"`);
    }
  }

  if (!APLICAR) {
    console.log(`\n(DRY RUN — no se borró nada. Correr con --aplicar para aplicar sobre ${filasBorrables} fila(s).${FUSIONAR ? '' : ' Agregar --fusionar para resolver también los grupos en conflicto.'})\n`);
  } else if (idsABorrar.length) {
    // Primero se rescata TODO lo de las filas que van a desaparecer: adjuntos reasignados a la
    // ganadora, y valor/observación solo si la ganadora no tenía nada propio.
    for (const { ganadora, perdedoras } of fusiones) {
      const ids = perdedoras.map(f => f.id);
      await pool.query(`UPDATE checklist_comercial_documentos SET item_id = ? WHERE item_id IN (?)`, [ganadora.id, ids]).catch(() => {});
      const conValor = perdedoras.find(f => f.valor_texto != null || f.valor_numero != null);
      if (ganadora.valor_texto == null && ganadora.valor_numero == null && conValor) {
        await pool.query(`UPDATE checklist_comercial SET valor_texto = ?, valor_numero = ? WHERE id = ?`,
          [conValor.valor_texto, conValor.valor_numero, ganadora.id]);
      }
      const conObs = perdedoras.find(f => f.observacion != null);
      if (ganadora.observacion == null && conObs) {
        await pool.query(`UPDATE checklist_comercial SET observacion = ? WHERE id = ?`, [conObs.observacion, ganadora.id]);
      }
    }
    const idsFusionados = new Set(fusiones.flatMap(f => f.perdedoras.map(p => p.id)));
    const soloBorrar = idsABorrar.filter(id => !idsFusionados.has(id));
    if (soloBorrar.length) await pool.query(`DELETE FROM checklist_comercial_documentos WHERE item_id IN (?)`, [soloBorrar]).catch(() => {});
    const [res] = await pool.query(`DELETE FROM checklist_comercial WHERE id IN (?)`, [idsABorrar]) as any;
    console.log(`\nBorradas ${res.affectedRows} filas duplicadas.\n`);
  } else {
    console.log('\nNada que borrar.\n');
  }
}

main()
  .catch(e => { console.error('\nERROR:', e.message, '\n'); process.exitCode = 1; })
  .finally(() => pool.end());
