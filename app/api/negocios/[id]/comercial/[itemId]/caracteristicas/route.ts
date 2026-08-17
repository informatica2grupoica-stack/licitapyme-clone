// app/api/negocios/[id]/comercial/[itemId]/caracteristicas/route.ts
// AGENTE TÉCNICO — comparación de especificaciones de UNA línea técnica del checklist (item de
// checklist_comercial con tipo='linea_tecnica'). Hermana de .../comercial/route.ts, reusa sus
// helpers (cargarNegocio, leerInforme, esAsesor, bitacora, nombreDe, COLS) para no duplicar SQL.
//
//   GET   → detalle completo de las características de la línea (nivel 3 de la UI)
//   POST  → { accion: 'validar' }                         Agente 1: clasifica caracteristicas[]
//           { accion: 'comparar_ficha', documentoUrl, documentoNombre }  Agente 2 (camino B)
//   PATCH → { accion: 'responder', caracteristicaId, ... } camino A (interrogatorio)
//           { accion: 'corregir', caracteristicaId, veredicto, comentario }  solo asesor
//   DELETE ?caracteristicaId=  → borra una fila agregada por error
//
// Cuando todas las características de la línea quedan resueltas (veredicto no nulo, sin
// pendientes de proveedor), la cabecera pasa sola a CARGADO — el asesor sigue aprobando/
// observando la LÍNEA completa igual que cualquier otro punto del checklist (mismo transicion(),
// misma doble firma, mismo SSE).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { publicarCambio } from '@/app/lib/sse-bus';
import { puedeVerNegocioAsignado } from '@/app/lib/api-auth';
import { ahoraChileSQL } from '@/app/lib/tz';
import { transicion } from '@/app/lib/checklist-comercial';
import { yaCongelado } from '@/app/lib/congelamiento';
import { descargarYExtraerTexto } from '@/app/lib/document-extraction';
import {
  lineasTecnicasDelInforme, clasificarCaracteristicasLinea, compararFichaProveedor,
  evaluarCaracteristicaDeterminista, evaluarCaracteristicaConIA, slugCaracteristica,
} from '@/app/lib/auditor-tecnico';
import { cargarNegocio, leerInforme, esAsesor, bitacora, nombreDe, COLS, agregarDocumentos } from '../../route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; itemId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

const COLS_CARACT = `id, item_id, negocio_id, clave_caracteristica, orden, descripcion, tipo,
  valor_requerido_texto, valor_requerido_numero, valor_requerido_numero_max, unidad_requerida,
  valor_ofertado_texto, valor_ofertado_numero, unidad_ofertada_original, valor_convertido_numero,
  veredicto, pendiente_confirmacion_proveedor, fundamento_documento, fundamento_cita, confianza,
  origen, veredicto_ia, corregido_por, corregido_por_nombre, corregido_at, comentario_correccion`;

async function migracion50Aplicada(): Promise<boolean> {
  try { await pool.query('SELECT 1 FROM checklist_comercial_caracteristicas LIMIT 1'); return true; }
  catch { return false; }
}

/** El item debe pertenecer al negocio Y ser una cabecera de línea técnica (no cualquier punto). */
async function cargarItemLineaTecnica(negocioId: number, itemId: number) {
  const [rows] = await pool.query(
    `SELECT ${COLS} FROM checklist_comercial WHERE id = ? AND negocio_id = ? AND tipo = 'linea_tecnica' LIMIT 1`,
    [itemId, negocioId],
  ) as any;
  return (rows as any[])[0] || null;
}

async function leerCaracteristicas(itemId: number) {
  const [rows] = await pool.query(
    `SELECT ${COLS_CARACT} FROM checklist_comercial_caracteristicas WHERE item_id = ? ORDER BY orden, id`,
    [itemId],
  ) as any;
  return (rows as any[]).map(r => ({
    ...r,
    pendiente_confirmacion_proveedor: !!r.pendiente_confirmacion_proveedor,
    valor_requerido_numero: r.valor_requerido_numero === null ? null : Number(r.valor_requerido_numero),
    valor_requerido_numero_max: r.valor_requerido_numero_max === null ? null : Number(r.valor_requerido_numero_max),
    valor_ofertado_numero: r.valor_ofertado_numero === null ? null : Number(r.valor_ofertado_numero),
    valor_convertido_numero: r.valor_convertido_numero === null ? null : Number(r.valor_convertido_numero),
    confianza: r.confianza === null ? null : Number(r.confianza),
  }));
}

/**
 * Si TODAS las características de la línea quedaron resueltas (veredicto no nulo y sin
 * pendientes de proveedor): si TODAS dieron CUMPLE, la línea se aprueba SOLA — no tiene sentido
 * hacer esperar al asesor un punto donde no hay nada que decidir. Si quedó al menos un NO_CUMPLE
 * o CUMPLE_CON_COMPLEMENTO, pasa a CARGADO como antes (alguien tiene que mirarlo). La
 * auto-aprobación queda marcada como tal (aprobado_por_nombre distinto de una firma humana) y
 * sigue siendo reversible con "Reabrir" — que solo el asesor puede hacer — así que "aprobado
 * solo" no significa "sin control", solo que el control por defecto es revisar la excepción, no
 * cada línea perfecta.
 */
async function intentarAutoTransicion(item: any, negocioId: number, userId: number, nombreActor: string): Promise<void> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total, SUM(veredicto IS NULL) AS sin_evaluar, SUM(pendiente_confirmacion_proveedor = 1) AS pendientes,
            SUM(veredicto = 'NO_CUMPLE') AS no_cumplen, SUM(veredicto = 'CUMPLE_CON_COMPLEMENTO') AS con_complemento
       FROM checklist_comercial_caracteristicas WHERE item_id = ?`,
    [item.id],
  ) as any;
  const r = (rows as any[])[0];
  if (!r || Number(r.total) === 0) return;
  if (Number(r.sin_evaluar) > 0 || Number(r.pendientes) > 0) return;

  const ahora = ahoraChileSQL();
  const todoCumple = Number(r.no_cumplen) === 0 && Number(r.con_complemento) === 0;

  if (todoCumple) {
    await pool.query(
      `UPDATE checklist_comercial
          SET estado = 'APROBADO', cargado_por = ?, cargado_por_nombre = ?, cargado_at = ?,
              aprobado_por = NULL, aprobado_por_nombre = ?, aprobado_at = ?
        WHERE id = ?`,
      [userId, nombreActor, ahora, `Auto-aprobado (${Number(r.total)}/${Number(r.total)} cumple)`, ahora, item.id],
    );
    await bitacora(item.id, negocioId, 'AUTO_APROBAR', item.estado, 'APROBADO', `${Number(r.total)}/${Number(r.total)} características cumplen — sin excepciones que revisar`, userId, nombreActor);
    return;
  }

  const nuevo = transicion(item.estado, 'CARGAR');
  if (!nuevo) return;
  await pool.query(
    `UPDATE checklist_comercial
        SET estado = 'CARGADO', cargado_por = ?, cargado_por_nombre = ?, cargado_at = ?,
            aprobado_por = NULL, aprobado_por_nombre = NULL, aprobado_at = NULL
      WHERE id = ?`,
    [userId, nombreActor, ahora, item.id],
  );
  await bitacora(item.id, negocioId, 'CARGAR', item.estado, 'CARGADO', `${Number(r.total)}/${Number(r.total)} características evaluadas`, userId, nombreActor);
}

// ═══ GET — detalle completo (nivel 3) ═══════════════════════════════════════════
export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id, itemId } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
    if (!(await migracion50Aplicada()))
      return NextResponse.json({ error: 'Falta aplicar la migración 50 (checklist_comercial_caracteristicas).' }, { status: 409 });

    const item = await cargarItemLineaTecnica(negocio.id, Number(itemId));
    if (!item) return NextResponse.json({ error: 'Línea no encontrada' }, { status: 404 });

    const caracteristicas = await leerCaracteristicas(item.id);
    return NextResponse.json({ success: true, caracteristicas });
  } catch (error) {
    console.error('[comercial][caracteristicas][GET]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ═══ POST — validar (Agente 1) / comparar_ficha (Agente 2) ══════════════════════
export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id, itemId } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
    if (!(await migracion50Aplicada()))
      return NextResponse.json({ error: 'Falta aplicar la migración 50 (checklist_comercial_caracteristicas).' }, { status: 409 });

    const item = await cargarItemLineaTecnica(negocio.id, Number(itemId));
    if (!item) return NextResponse.json({ error: 'Línea no encontrada' }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const accion = String(body.accion || '');
    const nombreActor = request.headers.get('x-user-nombre') || (await nombreDe(userId)) || 'Usuario';

    // ── Reiniciar: borra TODAS las características de la línea (ficha equivocada, prueba con
    // datos de otra licitación, etc.) y la devuelve a PENDIENTE — vuelve a quedar como si nunca
    // se hubiera validado, para "Validar línea" / "Subir ficha" desde cero sin arrastrar datos
    // viejos mezclados con los nuevos.
    if (accion === 'reiniciar') {
      if (await yaCongelado(negocio.id))
        return NextResponse.json({ error: 'Este negocio ya se postuló: el Auditor Técnico quedó congelado, de solo lectura.' }, { status: 409 });

      const [delRows] = await pool.query(`DELETE FROM checklist_comercial_caracteristicas WHERE item_id = ?`, [item.id]) as any;
      await pool.query(
        `UPDATE checklist_comercial
            SET estado = 'PENDIENTE', observacion = NULL,
                cargado_por = NULL, cargado_por_nombre = NULL, cargado_at = NULL,
                aprobado_por = NULL, aprobado_por_nombre = NULL, aprobado_at = NULL
          WHERE id = ?`,
        [item.id],
      );
      await bitacora(item.id, negocio.id, 'REINICIAR', item.estado, 'PENDIENTE',
        `Se borraron ${(delRows as any).affectedRows || 0} característica(s) para volver a empezar`, userId, nombreActor);
      publicarCambio('checklist_comercial');
      return NextResponse.json({ success: true, caracteristicas: [] });
    }

    // ── Agente 1: clasifica caracteristicas[] del informe en PISO/TECHO/EXACTO/RANGO ──────────
    if (accion === 'validar') {
      const informe = await leerInforme(negocio.licitacion_codigo);
      if (!informe) return NextResponse.json({ error: 'Esta licitación aún no tiene informe de viabilidad.' }, { status: 400 });

      const linea = lineasTecnicasDelInforme(informe).find(l => l.linea === item.linea_numero);
      if (!linea || linea.caracteristicas.length === 0)
        return NextResponse.json({ error: 'El informe no trae características técnicas para esta línea.' }, { status: 400 });

      const clasificadas = await clasificarCaracteristicasLinea(linea, { licitacionCodigo: negocio.licitacion_codigo });
      let nuevas = 0;
      let orden = 0;
      for (const c of clasificadas) {
        const clave = slugCaracteristica(c.descripcion);
        const [r] = await pool.query(
          `INSERT IGNORE INTO checklist_comercial_caracteristicas
             (item_id, negocio_id, clave_caracteristica, orden, descripcion, tipo,
              valor_requerido_texto, valor_requerido_numero, valor_requerido_numero_max, unidad_requerida,
              fundamento_documento, fundamento_cita, confianza, origen)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Bases técnicas', ?, ?, 'interrogatorio')`,
          [
            item.id, negocio.id, clave, orden++, c.descripcion, c.tipo,
            c.valorRequeridoTexto, c.valorRequeridoNumero, c.valorRequeridoNumeroMax, c.unidadRequerida,
            c.fundamentoCita, c.confianza,
          ],
        ) as any;
        if ((r as any).affectedRows) nuevas++;
      }

      await intentarAutoTransicion(item, negocio.id, userId, nombreActor);
      publicarCambio('checklist_comercial');
      const caracteristicas = await leerCaracteristicas(item.id);
      return NextResponse.json({ success: true, nuevas, caracteristicas });
    }

    // ── Agente 2 (camino B): compara contra la ficha técnica del proveedor, en lote ───────────
    if (accion === 'comparar_ficha') {
      const documentoUrl = String(body.documentoUrl || '');
      const documentoNombre = String(body.documentoNombre || 'ficha técnica');
      if (!documentoUrl) return NextResponse.json({ error: 'Falta la ficha técnica.' }, { status: 400 });

      const existentes = await leerCaracteristicas(item.id);
      if (!existentes.length)
        return NextResponse.json({ error: 'Primero valida la línea para clasificar sus características.' }, { status: 400 });

      const extraido = await descargarYExtraerTexto(documentoUrl, documentoNombre);
      if (!extraido?.texto || extraido.texto.trim().length < 30)
        return NextResponse.json({ error: 'No se pudo leer texto de la ficha técnica.' }, { status: 400 });

      const veredictos = await compararFichaProveedor(
        existentes.map(c => ({
          id: c.id, descripcion: c.descripcion, tipo: c.tipo,
          valorRequeridoNumero: c.valor_requerido_numero, valorRequeridoNumeroMax: c.valor_requerido_numero_max,
          unidadRequerida: c.unidad_requerida, valorRequeridoTexto: c.valor_requerido_texto,
        })),
        extraido.texto, documentoNombre,
      );

      for (const c of existentes) {
        const v = veredictos.get(c.id);
        if (!v) continue;
        // Si la ficha trajo un valor numérico, intentamos resolver determinista (conversión de
        // unidades) — más confiable que dejar a la IA hacer la comparación numérica ella sola.
        let convertido: number | null = null;
        let veredictoFinal = v.veredicto;
        if (v.valorOfertadoNumero != null && c.valor_requerido_numero != null) {
          const det = evaluarCaracteristicaDeterminista({
            tipo: c.tipo, valorRequeridoNumero: c.valor_requerido_numero, valorRequeridoNumeroMax: c.valor_requerido_numero_max,
            unidadRequerida: c.unidad_requerida, valorOfertadoNumero: v.valorOfertadoNumero, unidadOfertadaOriginal: v.unidadOfertadaOriginal,
          });
          if (det) { convertido = det.valorConvertidoNumero; veredictoFinal = det.veredicto; }
        }
        await pool.query(
          `UPDATE checklist_comercial_caracteristicas
              SET valor_ofertado_texto = ?, valor_ofertado_numero = ?, unidad_ofertada_original = ?,
                  valor_convertido_numero = ?, veredicto = ?, pendiente_confirmacion_proveedor = ?,
                  fundamento_documento = ?, fundamento_cita = COALESCE(?, fundamento_cita), confianza = ?, origen = 'ficha'
            WHERE id = ?`,
          [
            v.valorOfertadoTexto, v.valorOfertadoNumero, v.unidadOfertadaOriginal, convertido,
            veredictoFinal, (v.pendienteConfirmacionProveedor || !veredictoFinal) ? 1 : 0,
            v.fundamentoDocumento, v.fundamentoCita, v.confianza, c.id,
          ],
        );
      }

      // Deja la ficha como evidencia adjunta de la línea — mismo "Ver documento" que cualquier
      // otro punto del checklist (DocumentViewerModal), en vez de un visor aparte solo para esto.
      await agregarDocumentos(item.id, negocio.id, [{ url: documentoUrl, nombre: documentoNombre }], userId, nombreActor);

      await intentarAutoTransicion(item, negocio.id, userId, nombreActor);
      publicarCambio('checklist_comercial');
      const caracteristicas = await leerCaracteristicas(item.id);
      return NextResponse.json({ success: true, caracteristicas });
    }

    return NextResponse.json({ error: 'Acción desconocida' }, { status: 400 });
  } catch (error) {
    console.error('[comercial][caracteristicas][POST]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ═══ PATCH — responder (camino A) / corregir (asesor) ═══════════════════════════
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id, itemId } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
    if (!(await migracion50Aplicada()))
      return NextResponse.json({ error: 'Falta aplicar la migración 50 (checklist_comercial_caracteristicas).' }, { status: 409 });

    const item = await cargarItemLineaTecnica(negocio.id, Number(itemId));
    if (!item) return NextResponse.json({ error: 'Línea no encontrada' }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const accion = String(body.accion || '');
    const nombreActor = request.headers.get('x-user-nombre') || (await nombreDe(userId)) || 'Usuario';

    // ── Camino A: el asistente responde una característica puntual ───────────────────────────
    if (accion === 'responder') {
      const caracteristicaId = Number(body.caracteristicaId);
      if (!caracteristicaId) return NextResponse.json({ error: 'Falta la característica.' }, { status: 400 });

      const [rows] = await pool.query(
        `SELECT ${COLS_CARACT} FROM checklist_comercial_caracteristicas WHERE id = ? AND item_id = ?`,
        [caracteristicaId, item.id],
      ) as any;
      const c = (rows as any[])[0];
      if (!c) return NextResponse.json({ error: 'Característica no encontrada.' }, { status: 404 });

      const valorOfertadoTexto = body.valorOfertadoTexto != null ? String(body.valorOfertadoTexto).slice(0, 300) : null;
      const valorOfertadoNumero = body.valorOfertadoNumero != null && body.valorOfertadoNumero !== ''
        ? Number(body.valorOfertadoNumero) : null;
      const unidadOfertadaOriginal = body.unidadOfertadaOriginal ? String(body.unidadOfertadaOriginal).slice(0, 40) : null;

      // Paso 1: determinista (conversión de unidades, sin IA). Paso 2 (fallback): IA barata,
      // solo si el paso 1 no pudo resolver (unidad desconocida o requisito no numérico).
      const det = evaluarCaracteristicaDeterminista({
        tipo: c.tipo,
        valorRequeridoNumero: c.valor_requerido_numero != null ? Number(c.valor_requerido_numero) : null,
        valorRequeridoNumeroMax: c.valor_requerido_numero_max != null ? Number(c.valor_requerido_numero_max) : null,
        unidadRequerida: c.unidad_requerida, valorOfertadoNumero, unidadOfertadaOriginal,
      });

      let veredicto: string; let convertido: number | null; let confianza: number;
      if (det) {
        veredicto = det.veredicto; convertido = det.valorConvertidoNumero; confianza = 100;
      } else {
        const ia = await evaluarCaracteristicaConIA({
          descripcion: c.descripcion, tipo: c.tipo, valorRequeridoTexto: c.valor_requerido_texto,
          valorOfertadoTexto: valorOfertadoTexto
            || (valorOfertadoNumero != null ? `${valorOfertadoNumero}${unidadOfertadaOriginal ? ` ${unidadOfertadaOriginal}` : ''}` : null),
        });
        veredicto = ia.veredicto; convertido = null; confianza = ia.confianza;
      }

      // Camino A: el asistente ES la fuente (no un tercero ambiguo como una ficha) — nunca queda
      // pendiente_confirmacion_proveedor, a diferencia del camino B.
      await pool.query(
        `UPDATE checklist_comercial_caracteristicas
            SET valor_ofertado_texto = ?, valor_ofertado_numero = ?, unidad_ofertada_original = ?,
                valor_convertido_numero = ?, veredicto = ?, pendiente_confirmacion_proveedor = 0,
                confianza = ?, origen = 'interrogatorio'
          WHERE id = ?`,
        [valorOfertadoTexto, valorOfertadoNumero, unidadOfertadaOriginal, convertido, veredicto, confianza, caracteristicaId],
      );

      await intentarAutoTransicion(item, negocio.id, userId, nombreActor);
      publicarCambio('checklist_comercial');
      const caracteristicas = await leerCaracteristicas(item.id);
      return NextResponse.json({ success: true, caracteristicas });
    }

    // ── El asesor corrige un veredicto (loop de aprendizaje) ──────────────────────────────────
    if (accion === 'corregir') {
      if (!(await esAsesor(userId, rol)))
        return NextResponse.json({ error: 'Solo el asesor puede corregir un veredicto.' }, { status: 403 });

      const caracteristicaId = Number(body.caracteristicaId);
      const nuevoVeredicto = String(body.veredicto || '').toUpperCase();
      if (!caracteristicaId || !['CUMPLE', 'NO_CUMPLE', 'CUMPLE_CON_COMPLEMENTO'].includes(nuevoVeredicto))
        return NextResponse.json({ error: 'Petición inválida.' }, { status: 400 });

      const [rows] = await pool.query(
        `SELECT id, veredicto FROM checklist_comercial_caracteristicas WHERE id = ? AND item_id = ?`,
        [caracteristicaId, item.id],
      ) as any;
      const c = (rows as any[])[0];
      if (!c) return NextResponse.json({ error: 'Característica no encontrada.' }, { status: 404 });

      await pool.query(
        `UPDATE checklist_comercial_caracteristicas
            SET veredicto = ?, veredicto_ia = COALESCE(veredicto_ia, ?), pendiente_confirmacion_proveedor = 0,
                corregido_por = ?, corregido_por_nombre = ?, corregido_at = ?, comentario_correccion = ?
          WHERE id = ?`,
        [nuevoVeredicto, c.veredicto, userId, nombreActor, ahoraChileSQL(), String(body.comentario || '').trim().slice(0, 2000) || null, caracteristicaId],
      );

      publicarCambio('checklist_comercial');
      const caracteristicas = await leerCaracteristicas(item.id);
      return NextResponse.json({ success: true, caracteristicas });
    }

    return NextResponse.json({ error: 'Acción desconocida' }, { status: 400 });
  } catch (error) {
    console.error('[comercial][caracteristicas][PATCH]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ═══ DELETE — borra una fila agregada por error ═════════════════════════════════
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id, itemId } = await params;
  const caracteristicaId = Number(request.nextUrl.searchParams.get('caracteristicaId'));
  if (!caracteristicaId) return NextResponse.json({ error: 'Falta caracteristicaId.' }, { status: 400 });

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });

    const item = await cargarItemLineaTecnica(negocio.id, Number(itemId));
    if (!item) return NextResponse.json({ error: 'Línea no encontrada' }, { status: 404 });

    await pool.query(`DELETE FROM checklist_comercial_caracteristicas WHERE id = ? AND item_id = ?`, [caracteristicaId, item.id]);
    publicarCambio('checklist_comercial');
    const caracteristicas = await leerCaracteristicas(item.id);
    return NextResponse.json({ success: true, caracteristicas });
  } catch (error) {
    console.error('[comercial][caracteristicas][DELETE]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
