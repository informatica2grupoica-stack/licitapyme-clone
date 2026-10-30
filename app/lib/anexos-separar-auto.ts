// Corte AUTOMÁTICO de los documentos Word que traen varios anexos/formularios pegados.
// Dueño (30-oct-2026, 1090-17-LE26): «que el sistema lo detecte y los corte solo, alertando».
// Calibrado con lo que el equipo ya hace a mano: 67 cortes en 45 licitaciones (ago-oct), casi todos
// un .docx de Anexos Oferente; el detector (detectarFormularios) vio ≥2 anexos en los 40 .docx que
// el equipo había separado (0 falsos negativos).
//
// Hace lo mismo que el botón «Separar anexos» (app/api/anexos/separar/route.ts, camino .docx):
// cada anexo sube como .docx a su caja de Documentos (clasificarAnexo), el original NO se toca, y
// queda un aviso en el historial del negocio. Solo Word (.doc/.docx); PDF no. Solo si ese documento
// no se separó antes (a mano o solo) y su nombre no es el de un anexo suelto («Anexo N°4.docx»).
import pool from '@/app/lib/db';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { cargarDocumentoParaSeparar } from '@/app/lib/anexos-datos';
import { abrirDocx, verificarXmlBienFormado, normalizarParaIds } from '@/app/lib/anexos-docx';
import { dividirPorFormularios } from '@/app/lib/anexos-dividir';
import { esArchivoDeAnexoSuelto } from '@/app/lib/checklist-comercial';
import { registrarEvento } from '@/app/lib/historial';

const CONTENT_TYPE_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// Igual que CATEGORIA_POR_CLASIFICACION de la ruta de separar.
const CAJA_POR_CATEGORIA: Record<string, string> = {
  administrativo: 'ANEXOS_ADMINISTRATIVOS', tecnico: 'ANEXOS_TECNICOS', economico: 'ANEXOS_ECONOMICOS', sin_clasificar: 'ANEXOS_OFERENTE',
};
const TIPO_EVENTO = 'ANEXOS_SEPARADOS_AUTO';

const enCurso = new Set<string>();
const revisados = new Set<string>(); // «id|updated_at» sin paquete: no se vuelve a abrir mientras corra el proceso

export const ACTOR_SEPARAR_AUTO = 'Separar anexos automático';

async function yaSeparado(codigo: string, nombre: string): Promise<boolean> {
  try {
    const [a] = await pool.query(
      `SELECT 1 FROM actividad_usuario WHERE accion = 'anexo_separado' AND entidad_id = ? AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.documento')) = ? LIMIT 1`,
      [codigo, nombre]) as any;
    if ((a as any[]).length) return true;
    const [h] = await pool.query(
      `SELECT 1 FROM historial_eventos WHERE tipo = ? AND licitacion_codigo = ? AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.documento')) = ? LIMIT 1`,
      [TIPO_EVENTO, codigo, nombre]) as any;
    return (h as any[]).length > 0;
  } catch { return true; } // ante la duda, no cortar
}

/** Revisa los Word de «Anexos Oferente» de la licitación y corta los que traen ≥2 anexos pegados.
 *  Devuelve cuántos archivos nuevos quedaron. Nunca lanza. `alTerminar` se llama solo si cortó algo
 *  (para que el Auditor cree las casillas de los anexos nuevos). */
export async function separarAnexosAutomatico(codigo: string, alTerminar?: () => Promise<void>): Promise<number> {
  if (enCurso.has(codigo)) return 0;
  enCurso.add(codigo);
  let total = 0;
  try {
    const [docs] = await pool.query(
      `SELECT id, documento_nombre, updated_at FROM documentos_cache
        WHERE licitacion_codigo = ? AND categoria = 'ANEXOS_OFERENTE' AND documento_nombre REGEXP '\\.docx?$'
          AND id NOT IN (SELECT documento_id FROM documentos_generados_separar)`,
      [codigo]) as any;
    for (const d of docs as Array<{ id: number; documento_nombre: string; updated_at: any }>) {
      const llave = `${d.id}|${d.updated_at}`;
      if (revisados.has(llave) || esArchivoDeAnexoSuelto(d.documento_nombre)) continue;
      if (await yaSeparado(codigo, d.documento_nombre)) { revisados.add(llave); continue; }
      try {
        const doc = await cargarDocumentoParaSeparar(codigo, String(d.id));
        if (doc.tipo !== 'docx') { revisados.add(llave); continue; }
        const { xml: crudo } = await abrirDocx(doc.bufferOriginal);
        const { xml } = normalizarParaIds(crudo);
        const formularios = await dividirPorFormularios(doc.bufferOriginal, xml);
        if (formularios.length < 2) { revisados.add(llave); continue; }
        // Todo o nada: si un fragmento sale mal formado no se sube ninguno (como el botón).
        for (const f of formularios) {
          const { xml: fxml } = await abrirDocx(f.buffer);
          if (!verificarXmlBienFormado(fxml).valido) throw new Error(`fragmento "${f.titulo}" mal formado`);
        }
        const subidos: { nombre: string; categoria: string }[] = [];
        for (const f of formularios) {
          const nombre = `${f.nombreArchivo}.docx`;
          const url = await subirDocumentoR2(codigo, nombre, f.buffer, CONTENT_TYPE_DOCX);
          const [r] = await pool.query(
            `INSERT INTO documentos_cache
               (licitacion_codigo, documento_nombre, documento_url_local, size_bytes, content_type, categoria, categoria_manual, usuario_id)
             VALUES (?, ?, ?, ?, ?, ?, 1, NULL)
             ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), documento_url_local = VALUES(documento_url_local),
               size_bytes = VALUES(size_bytes), categoria = VALUES(categoria), updated_at = CURRENT_TIMESTAMP`,
            [codigo, nombre, url, f.buffer.length, CONTENT_TYPE_DOCX, CAJA_POR_CATEGORIA[f.categoria] || 'ANEXOS_OFERENTE']) as any;
          await pool.query(`INSERT INTO documentos_generados_separar (documento_id) VALUES (?) ON DUPLICATE KEY UPDATE documento_id = documento_id`, [r.insertId]).catch(() => {});
          subidos.push({ nombre, categoria: f.categoria });
        }
        total += subidos.length;
        revisados.add(llave);
        await registrarEvento({
          tipo: TIPO_EVENTO, licitacionCodigo: codigo, actorNombre: ACTOR_SEPARAR_AUTO,
          mensaje: `«${d.documento_nombre}» traía ${subidos.length} anexos pegados y se cortó solo: revísalos en Documentos (el original no se tocó).`.slice(0, 500),
          metadata: { documento: d.documento_nombre, archivos: subidos },
        });
        console.log(`[anexos-separar-auto] ${codigo}: "${d.documento_nombre}" → ${subidos.length} anexos.`);
      } catch (e) {
        revisados.add(llave);
        console.error(`[anexos-separar-auto] ${codigo}: "${d.documento_nombre}" no se pudo cortar:`, String(e).slice(0, 200));
      }
    }
    if (total && alTerminar) await alTerminar().catch(() => {});
  } catch (e) {
    console.error(`[anexos-separar-auto] ${codigo}:`, String(e).slice(0, 200));
  } finally {
    enCurso.delete(codigo);
  }
  return total;
}
