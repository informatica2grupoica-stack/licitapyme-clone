// app/api/negocios/[id]/comercial/[itemId]/comparador/route.ts
// COMPARADOR DE FICHAS (PROMPT 4 v1.0) — para UNA línea técnica del checklist.
//
//   GET   → estado completo del comparador: inventario y mapa de fichas, matriz por característica
//           con su origen/ayuda, alerta de sobredimensionamiento, técnico-administrativo,
//           certificado de admisibilidad, bloqueos, mensajes al proveedor, lo que no se pudo leer.
//   POST  → { accion: 'comparar', documentos:[{url,nombre}], modelosConfirmados? }   L1 + L2
//           { accion: 'reverificar' }                                               L3
//           { accion: 'confirmar_propuesta', caracteristicaId, aceptar }
//           { accion: 'check_administrativo', caracteristicaId, marcado }
//           { accion: 'habilitar', caracteristicaId }        solo asesor (Encargado de MP)
//
// El certificado, los bloqueos, la alerta, el resumen y los mensajes se CALCULAN acá por código
// a partir de las filas (auditor-comparador-core.ts): siempre reflejan el estado real, incluso
// después de que una persona confirme, habilite o marque algo.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { publicarCambio } from '@/app/lib/sse-bus';
import { puedeVerNegocioAsignado } from '@/app/lib/api-auth';
import { ahoraChileSQL } from '@/app/lib/tz';
import { yaCongelado } from '@/app/lib/congelamiento';
import { descargarYExtraerTexto } from '@/app/lib/document-extraction';
import { agregarDocumentos } from '@/app/lib/checklist-comercial-db';
import { cargarNegocio, leerInforme, esAsesor, bitacora, nombreDe } from '../../route';
import {
  cargarItemLineaTecnica, filasDelComparador, intentarAutoTransicion, migracion127Aplicada,
  prepararSegmentosDeLaFicha, procesarProductosDeLaFicha,
} from '../caracteristicas/route';
import { inventariarFicha, compararRequisitos, reverificarRojos } from '@/app/lib/auditor-comparador';
import {
  procesarItemComparador, evaluarReverificacion, estadoDeFila, rutaDeCierre, resumenComparador,
  alertaSobredimensionamiento, certificadoAdmisibilidad, bloqueosDeLinea, mensajesPorProveedor,
  marcarDuplicados, proponerAsignacion, materiaAdministrativa,
  type FilaComparador, type FichaInventariada, type AsignacionFicha, type AnalisisCaracteristica,
} from '@/app/lib/auditor-comparador-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; itemId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  return { id: id ? parseInt(id) : null, rol: req.headers.get('x-user-rol') };
}

// ─── Lo que es de la LÍNEA (auditor_comparador_linea) ───────────────────────────────────────────
interface LineaJson {
  inventario: FichaInventariada[];
  mapa: AsignacionFicha[];
  sin_asignar: Array<{ archivo: string; motivo: string }>;
  no_pude_leer: Array<{ archivo: string; que: string; donde: string }>;
  modelos_confirmados: Record<string, string>;
  comparado_at: string | null;
}
const LINEA_VACIA: LineaJson = { inventario: [], mapa: [], sin_asignar: [], no_pude_leer: [], modelos_confirmados: {}, comparado_at: null };

async function leerLinea(itemId: number): Promise<LineaJson> {
  try {
    const [rows] = await pool.query(`SELECT resultado_json FROM auditor_comparador_linea WHERE item_id = ?`, [itemId]) as any;
    const raw = (rows as any[])[0]?.resultado_json;
    return raw ? { ...LINEA_VACIA, ...JSON.parse(raw) } : { ...LINEA_VACIA };
  } catch { return { ...LINEA_VACIA }; }
}

async function guardarLinea(itemId: number, negocioId: number, data: LineaJson) {
  await pool.query(
    `INSERT INTO auditor_comparador_linea (item_id, negocio_id, resultado_json) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE resultado_json = VALUES(resultado_json)`,
    [itemId, negocioId, JSON.stringify(data)],
  );
}

// ─── Estado completo (todo lo derivado se calcula acá, por código) ──────────────────────────────
async function armarEstado(item: any) {
  const filas = await filasDelComparador(item);
  const linea = await leerLinea(item.id);
  const tecnicas = filas.filter(f => f.analisis.ambito === 'tecnico');
  const administrativas = filas.filter(f => f.analisis.ambito === 'administrativo');

  const conEstado = filas.map(f => ({ ...f, estado: estadoDeFila(f), ruta_cierre: estadoDeFila(f) === 'CUMPLIDA' ? '' : rutaDeCierre(f) }));

  // Mensaje al proveedor: uno por producto, agrupado por proveedor (PARTE VII).
  const nombreFicha = (f: FichaInventariada) => `${f.marca} ${f.modelos[0] || ''}`.trim() || f.archivo;
  const unica = linea.mapa.length === 1 ? linea.inventario.find(i => i.archivo === linea.mapa[0].archivo) : undefined;
  const fichaDe = (fuente: string | undefined) => {
    const t = (fuente || '').toLowerCase();
    return linea.inventario.find(i => t && t.includes(i.archivo.toLowerCase().replace(/\.[a-z0-9]{2,4}$/, ''))) || unica;
  };
  const mensajes = mensajesPorProveedor(tecnicas
    .filter(f => estadoDeFila(f) !== 'CUMPLIDA' && f.analisis.ayuda?.pregunta_proveedor)
    .map(f => {
      const ficha = fichaDe(f.analisis.fuente_ficha);
      return { proveedor: ficha?.proveedor || ficha?.marca || '', producto: ficha ? nombreFicha(ficha) : item.titulo, pregunta: f.analisis.ayuda!.pregunta_proveedor };
    }));

  const sinConfirmar = linea.mapa.filter(m => !m.confirmado_por_humano).length;
  return {
    usado: filas.some(f => f.analisis.origen_dato) || linea.inventario.length > 0,
    caracteristicas: conEstado,
    resumen: resumenComparador(filas),
    alerta_sobredimensionamiento: alertaSobredimensionamiento(filas),
    tecnico_administrativo: administrativas.map(f => ({
      id: f.id, materia: f.analisis.materia || materiaAdministrativa(`${f.descripcion} ${f.valor_requerido_texto || ''}`) || 'otro',
      exige_base_literal: f.valor_requerido_texto && !f.descripcion.includes(f.valor_requerido_texto) ? `${f.descripcion} — ${f.valor_requerido_texto}` : f.descripcion,
      fuente_bases: f.analisis.fuente_bases || 'Bases técnicas',
      // Estricta sujeción: nos comprometemos EXACTAMENTE a lo que exigen las bases, ni más ni menos.
      se_compromete: f.analisis.admin?.se_compromete || f.valor_requerido_texto || f.descripcion,
      criticidad: f.criticidad, precargado_cumplido: true,
      check_confirmado: estadoDeFila(f) === 'CUMPLIDA',
    })),
    inventario_fichas: linea.inventario,
    mapa_asignacion: linea.mapa,
    lineas_sin_ficha: linea.mapa.length === 0 ? [{ linea: item.linea_numero, producto: item.titulo }] : [],
    archivos_sin_asignar: linea.sin_asignar,
    mensajes_proveedor: mensajes,
    certificado_admisibilidad: certificadoAdmisibilidad(filas),
    bloqueos: bloqueosDeLinea(filas, { asignacionesSinConfirmar: sinConfirmar, lineaSinFicha: linea.mapa.length === 0 && tecnicas.some(f => f.veredicto == null) }),
    no_pude_leer: linea.no_pude_leer,
    requiere_confirmacion_modelo: sinConfirmar > 0,
    comparado_at: linea.comparado_at,
    hay_tecnicas: tecnicas.length > 0,
  };
}

async function guardarAnalisis(id: number, analisis: AnalisisCaracteristica) {
  await pool.query(`UPDATE checklist_comercial_caracteristicas SET analisis_json = ? WHERE id = ?`, [JSON.stringify(analisis), id]);
}

/** El foro es parte integrante de las bases y manda sobre el texto original: si el informe lo trae, va a la IA. */
function foroDelInforme(informe: any): string | null {
  const f = informe?.foro ?? informe?.foro_qa ?? informe?.aclaraciones ?? null;
  if (!f) return null;
  const txt = typeof f === 'string' ? f : JSON.stringify(f);
  return txt.length > 20 ? txt.slice(0, 8000) : null;
}

async function bitacoraSegura(item: any, negocioId: number, accion: string, detalle: string, userId: number, nombre: string) {
  try { await bitacora(item.id, negocioId, accion, item.estado, item.estado, detalle, userId, nombre); } catch { /* la bitácora nunca tumba la acción */ }
}

// ═══ GET ════════════════════════════════════════════════════════════════════════
export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id, itemId } = await params;
  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
    const item = await cargarItemLineaTecnica(negocio.id, Number(itemId));
    if (!item) return NextResponse.json({ error: 'Línea no encontrada' }, { status: 404 });
    return NextResponse.json({ success: true, migracion: await migracion127Aplicada(), ...(await armarEstado(item)) });
  } catch (error) {
    console.error('[comercial][comparador][GET]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ═══ POST ═══════════════════════════════════════════════════════════════════════
export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id, itemId } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
    const item = await cargarItemLineaTecnica(negocio.id, Number(itemId));
    if (!item) return NextResponse.json({ error: 'Línea no encontrada' }, { status: 404 });
    if (!(await migracion127Aplicada()))
      return NextResponse.json({ error: 'Falta aplicar la migración 127 (node scripts/aplicar-migration-127.mjs).' }, { status: 409 });
    if (await yaCongelado(negocio.id, rol))
      return NextResponse.json({ error: 'Este negocio ya se postuló: el Auditor Técnico quedó congelado, de solo lectura.' }, { status: 409 });

    const body = await request.json().catch(() => ({}));
    const accion = String(body.accion || '');
    const nombreActor = request.headers.get('x-user-nombre') || (await nombreDe(userId)) || 'Usuario';

    // ── L1 + L2: inventario, mapa de asignación y comparación ───────────────────────────────────
    if (accion === 'comparar') {
      if (!process.env.KIMI_API_KEY)
        return NextResponse.json({ error: 'Kimi K3 no está configurado en este servidor (falta KIMI_API_KEY).' }, { status: 503 });

      const filas = await filasDelComparador(item);
      if (!filas.length)
        return NextResponse.json({ error: 'Primero valida la línea para clasificar sus características.' }, { status: 400 });
      const aComparar = filas.filter(f => f.analisis.ambito === 'tecnico' && !f.respuesta_manual);

      const documentos: Array<{ url: string; nombre: string }> = Array.isArray(body.documentos)
        ? body.documentos.filter((d: any) => d?.url).map((d: any) => ({ url: String(d.url), nombre: String(d.nombre || 'ficha técnica') })) : [];
      const linea = await leerLinea(item.id);
      const elegidos: Record<string, string> = { ...linea.modelos_confirmados };
      for (const [k, v] of Object.entries(body.modelosConfirmados || {})) if (typeof v === 'string' && v.trim()) elegidos[k] = v.trim();

      // Fichas de esta línea: las ya inventariadas que siguen adjuntas + las que llegan ahora.
      const [adj] = await pool.query(`SELECT url FROM checklist_comercial_documentos WHERE item_id = ?`, [item.id]) as any;
      const vigentes = new Set((adj as any[]).map(r => r.url));
      const previas = linea.inventario.filter(f => vigentes.has(f.url) && !documentos.some(d => d.url === f.url));
      const entradas = [
        ...previas.map(f => ({ url: f.url, nombre: f.archivo, tarjeta: f as FichaInventariada | null })),
        ...documentos.map(d => ({ url: d.url, nombre: d.nombre, tarjeta: linea.inventario.find(f => f.url === d.url) || null })),
      ];
      if (!entradas.length) return NextResponse.json({ error: 'Sube al menos una ficha técnica.' }, { status: 400 });

      const textos = new Map<string, string>();
      const noPudeLeer: LineaJson['no_pude_leer'] = [];
      const contexto = {
        licitacionCodigo: negocio.licitacion_codigo, linea: item.linea_numero, nombre: item.titulo,
        requisitos: aComparar.map(f => `${f.descripcion}${f.valor_requerido_texto ? ` (${f.valor_requerido_texto})` : ''}`),
      };
      // L1 — una llamada por archivo, en paralelo. Una ficha ya inventariada no se vuelve a leer con IA.
      const tarjetas = await Promise.all(entradas.map(async e => {
        const extraido = await descargarYExtraerTexto(e.url, e.nombre).catch(() => null);
        const texto = extraido?.texto && extraido.texto.trim().length >= 30 ? extraido.texto : null;
        if (texto) textos.set(e.url, texto);
        if (e.tarjeta) return e.tarjeta;
        const r = await inventariarFicha(e.nombre, e.url, texto, contexto);
        noPudeLeer.push(...r.noPudeLeer);
        return r.ficha;
      }));

      const inventario = marcarDuplicados(tarjetas);
      const { mapa, sinAsignar } = proponerAsignacion(inventario, elegidos);
      const lineaNueva: LineaJson = {
        inventario, mapa, sin_asignar: sinAsignar, modelos_confirmados: elegidos,
        no_pude_leer: [...noPudeLeer, ...linea.no_pude_leer.filter(x => !noPudeLeer.some(n => n.archivo === x.archivo && n.que === x.que))],
        comparado_at: linea.comparado_at,
      };
      await guardarLinea(item.id, negocio.id, lineaNueva);
      if (documentos.length) await agregarDocumentos(item.id, negocio.id, documentos, userId, nombreActor);

      // La asignación no se cierra sola: un catálogo con varios modelos espera a que una persona elija.
      if (mapa.some(m => !m.confirmado_por_humano)) {
        publicarCambio('checklist_comercial');
        return NextResponse.json({ success: true, requiereConfirmacion: true, ...(await armarEstado(item)) });
      }
      if (!mapa.length) {
        publicarCambio('checklist_comercial');
        return NextResponse.json({ success: true, sinFichas: true, ...(await armarEstado(item)) });
      }
      if (!aComparar.length) {
        return NextResponse.json({ success: true, aviso: 'No hay requisitos técnicos por comparar (los demás están contestados a mano o son compromisos).', ...(await armarEstado(item)) });
      }

      // L2 — por producto de la línea (una línea-paquete se compara producto por producto).
      const informe = await leerInforme(negocio.licitacion_codigo).catch(() => null);
      const foro = foroDelInforme(informe);
      const segmentosPorUrl = new Map<string, Awaited<ReturnType<typeof prepararSegmentosDeLaFicha>>>();
      await Promise.all(mapa.map(async m => {
        const texto = textos.get(m.url);
        if (!texto) return;
        segmentosPorUrl.set(m.url, await prepararSegmentosDeLaFicha({
          licitacionCodigo: negocio.licitacion_codigo, lineaNumero: item.linea_numero,
          documentoUrl: m.url, documentoNombre: m.archivo, textoCompleto: texto,
        }));
      }));

      // Cada fila conserva su cita de las bases ANTES de que la comparación pise fundamento_cita.
      for (const f of aComparar) {
        if (!f.analisis.fuente_bases) {
          f.analisis.fuente_bases = (f.origen === 'interrogatorio' && f.fundamento_cita)
            ? f.fundamento_cita : `Bases técnicas — “${f.descripcion.slice(0, 120)}”`;
        }
      }

      const grupos = new Map<number, FilaComparador[]>();
      for (const f of aComparar) {
        const idx = f.producto_index ?? 0;
        if (!grupos.has(idx)) grupos.set(idx, []);
        grupos.get(idx)!.push(f);
      }

      let sinRespuestaIA = 0;
      const noPudeLeerL2: LineaJson['no_pude_leer'] = [];
      await Promise.all(Array.from(grupos.entries()).map(async ([idx, filasGrupo]) => {
        const fichas = mapa.filter(m => textos.has(m.url)).map(m => {
          const tarjeta = inventario.find(t => t.archivo === m.archivo);
          const seg = segmentosPorUrl.get(m.url)?.segmentos.find(s => s.productoIndex === idx);
          return {
            archivo: m.archivo, modelo: m.modelo_propuesto, emisor: tarjeta?.emisor || 'desconocido',
            formalidad: tarjeta?.formalidad || 'formal', texto: seg?.texto || textos.get(m.url)!,
          };
        });
        const { items, noPudeLeer: nl, textoEnviado } = await compararRequisitos({
          licitacionCodigo: negocio.licitacion_codigo, lineaNumero: item.linea_numero, lineaNombre: item.titulo,
          filas: filasGrupo, fichas, foro,
        });
        noPudeLeerL2.push(...nl);
        for (const f of filasGrupo) {
          const crudo = items.get(f.id);
          if (!crudo) { sinRespuestaIA++; continue; }
          const r = procesarItemComparador(f, crudo, textoEnviado);
          await pool.query(
            `UPDATE checklist_comercial_caracteristicas
                SET valor_ofertado_texto = ?, valor_ofertado_numero = ?, unidad_ofertada_original = ?,
                    valor_convertido_numero = ?, veredicto = ?, pendiente_confirmacion_proveedor = ?,
                    fundamento_documento = ?, fundamento_cita = ?, confianza = NULL, origen = 'ficha',
                    analisis_json = ?
              WHERE id = ?`,
            [
              r.columnas.valor_ofertado_texto, r.columnas.valor_ofertado_numero, r.columnas.unidad_ofertada_original,
              r.columnas.valor_convertido_numero, r.columnas.veredicto, r.columnas.pendiente ? 1 : 0,
              r.columnas.fundamento_documento, r.columnas.fundamento_cita, JSON.stringify(r.analisis), f.id,
            ],
          );
        }
      }));

      // Marca/modelo/foto de cada ficha — determinista, nunca pisa lo confirmado a mano.
      for (const m of mapa) {
        const seg = segmentosPorUrl.get(m.url);
        if (!seg) continue;
        try {
          await procesarProductosDeLaFicha({
            itemId: item.id, negocioId: negocio.id, licitacionCodigo: negocio.licitacion_codigo,
            documentoNombre: m.archivo, segmentos: seg.segmentos, bufferPdf: seg.bufferPdf,
          });
        } catch (e) { console.error('[comercial][comparador] no se pudo leer marca/modelo:', String(e)); }
      }

      const finalLinea: LineaJson = {
        ...lineaNueva, comparado_at: ahoraChileSQL(),
        no_pude_leer: [...lineaNueva.no_pude_leer, ...noPudeLeerL2],
      };
      await guardarLinea(item.id, negocio.id, finalLinea);
      await bitacoraSegura(item, negocio.id, 'COMPARAR_FICHAS', `Comparador de fichas: ${aComparar.length} requisito(s) contra ${mapa.length} ficha(s)`, userId, nombreActor);
      await intentarAutoTransicion(item, negocio.id, userId, nombreActor);
      publicarCambio('checklist_comercial');
      return NextResponse.json({
        success: true, comparadas: aComparar.length - sinRespuestaIA,
        ...(sinRespuestaIA ? { aviso: `La IA no respondió ${sinRespuestaIA} requisito(s): quedaron sin tocar.` } : {}),
        ...(await armarEstado(item)),
      });
    }

    // ── L3: segunda lectura independiente de los CUMPLE críticos ───────────────────────────────
    if (accion === 'reverificar') {
      if (!process.env.KIMI_API_KEY)
        return NextResponse.json({ error: 'Kimi K3 no está configurado en este servidor (falta KIMI_API_KEY).' }, { status: 503 });
      const filas = await filasDelComparador(item);
      const rojos = filas.filter(f => f.analisis.ambito === 'tecnico' && f.criticidad === 'INADMISIBLE' && f.veredicto === 'CUMPLE'
        && f.origen === 'ficha' && !f.respuesta_manual && f.analisis.origen_dato && !f.analisis.reverificado);
      if (!rojos.length) return NextResponse.json({ success: true, reverificados: 0, ...(await armarEstado(item)) });

      const linea = await leerLinea(item.id);
      const fichas: Array<{ archivo: string; texto: string }> = [];
      for (const m of linea.mapa.filter(x => x.confirmado_por_humano)) {
        const extraido = await descargarYExtraerTexto(m.url, m.archivo).catch(() => null);
        if (extraido?.texto) fichas.push({ archivo: m.archivo, texto: extraido.texto });
      }
      if (!fichas.length) return NextResponse.json({ error: 'No se pudo releer ninguna ficha para reverificar.' }, { status: 400 });

      const { resultados, textoEnviado } = await reverificarRojos(rojos, fichas);
      let rectificados = 0;
      for (const f of rojos) {
        const r = resultados.get(f.id);
        if (!r) continue;   // sin respuesta: sigue sin reverificar (queda PENDIENTE, no se da por bueno)
        const ev = evaluarReverificacion(f, r, textoEnviado);
        if (ev.confirmado) {
          await guardarAnalisis(f.id, { ...f.analisis, reverificado: true, rectificacion: undefined });
        } else {
          rectificados++;
          const analisis: AnalisisCaracteristica = {
            ...f.analisis, reverificado: true, rectificacion: ev.motivo,
            notas_sistema: [...(f.analisis.notas_sistema || []), `Rectificado en la segunda lectura: ${ev.motivo}`],
            ayuda: f.analisis.ayuda || {
              diagnostico: ev.motivo, hipotesis_causa: [], pregunta_proveedor: '', veredicto_equivalencia: '', ruta: null, accion_concreta: '',
            },
          };
          await pool.query(
            `UPDATE checklist_comercial_caracteristicas SET veredicto = NULL, pendiente_confirmacion_proveedor = 1, analisis_json = ? WHERE id = ?`,
            [JSON.stringify(analisis), f.id],
          );
        }
      }
      await bitacoraSegura(item, negocio.id, 'REVERIFICAR_ROJOS', `Reverificación de ${rojos.length} ítem(s) críticos${rectificados ? `: ${rectificados} rectificado(s)` : ': todos confirmados'}`, userId, nombreActor);
      await intentarAutoTransicion(item, negocio.id, userId, nombreActor);
      publicarCambio('checklist_comercial');
      return NextResponse.json({ success: true, reverificados: rojos.length, rectificados, ...(await armarEstado(item)) });
    }

    // ── Confirmar / rechazar un emparejamiento o una equivalencia normativa propuestos ─────────
    if (accion === 'confirmar_propuesta') {
      const filas = await filasDelComparador(item);
      const f = filas.find(x => x.id === Number(body.caracteristicaId));
      if (!f?.analisis.propuesta) return NextResponse.json({ error: 'Esa característica no tiene una propuesta pendiente.' }, { status: 404 });
      const aceptar = body.aceptar === true;
      const p = f.analisis.propuesta;
      const analisis: AnalisisCaracteristica = { ...f.analisis, propuesta: { ...p, confirmado: aceptar } };
      if (aceptar && p.veredicto_propuesto) {
        await pool.query(
          `UPDATE checklist_comercial_caracteristicas SET veredicto = ?, pendiente_confirmacion_proveedor = 0, analisis_json = ? WHERE id = ?`,
          [p.veredicto_propuesto, JSON.stringify({ ...analisis, ayuda: undefined, reverificado: false }), f.id],
        );
      } else {
        await pool.query(`UPDATE checklist_comercial_caracteristicas SET veredicto = NULL, pendiente_confirmacion_proveedor = 1, analisis_json = ? WHERE id = ?`, [JSON.stringify(analisis), f.id]);
      }
      await bitacoraSegura(item, negocio.id, aceptar ? 'CONFIRMAR_PROPUESTA' : 'RECHAZAR_PROPUESTA', `${p.tipo === 'equivalencia_normativa' ? 'Equivalencia normativa' : 'Emparejamiento'}: ${p.parametro_bases} ↔ ${p.parametro_ficha}`, userId, nombreActor);
      await intentarAutoTransicion(item, negocio.id, userId, nombreActor);
      publicarCambio('checklist_comercial');
      return NextResponse.json({ success: true, ...(await armarEstado(item)) });
    }

    // ── Compromisos técnico-administrativos: precargados, el asistente solo confirma ───────────
    if (accion === 'check_administrativo') {
      const filas = await filasDelComparador(item);
      const f = filas.find(x => x.id === Number(body.caracteristicaId));
      if (!f || f.analisis.ambito !== 'administrativo') return NextResponse.json({ error: 'Ese punto no es un compromiso técnico-administrativo.' }, { status: 404 });
      const marcado = body.marcado === true;
      const seCompromete = f.valor_requerido_texto || f.descripcion;
      const analisis: AnalisisCaracteristica = { ...f.analisis, admin: { se_compromete: seCompromete, check_confirmado: marcado } };
      await pool.query(
        marcado
          ? `UPDATE checklist_comercial_caracteristicas SET veredicto = 'CUMPLE', valor_ofertado_texto = ?, pendiente_confirmacion_proveedor = 0, origen = 'manual', respuesta_manual = 1, analisis_json = ? WHERE id = ?`
          : `UPDATE checklist_comercial_caracteristicas SET veredicto = NULL, valor_ofertado_texto = NULL, pendiente_confirmacion_proveedor = 0, origen = 'interrogatorio', respuesta_manual = 0, analisis_json = ? WHERE id = ?`,
        marcado ? [seCompromete.slice(0, 1000), JSON.stringify(analisis), f.id] : [JSON.stringify(analisis), f.id],
      );
      await bitacoraSegura(item, negocio.id, marcado ? 'CHECK_COMPROMISO' : 'QUITAR_CHECK_COMPROMISO', f.descripcion.slice(0, 200), userId, nombreActor);
      await intentarAutoTransicion(item, negocio.id, userId, nombreActor);
      publicarCambio('checklist_comercial');
      return NextResponse.json({ success: true, ...(await armarEstado(item)) });
    }

    // ── Habilitación del Encargado de Mercado Público (datos que no vienen de una ficha formal) ─
    if (accion === 'habilitar') {
      if (!(await esAsesor(userId, rol)))
        return NextResponse.json({ error: 'Solo el Encargado de Mercado Público (o un administrador) puede habilitar este dato.' }, { status: 403 });
      const filas = await filasDelComparador(item);
      const f = filas.find(x => x.id === Number(body.caracteristicaId));
      if (!f) return NextResponse.json({ error: 'Característica no encontrada.' }, { status: 404 });
      const quitar = body.habilitar === false;
      await guardarAnalisis(f.id, { ...f.analisis, habilitado: quitar ? undefined : { por: nombreActor, at: ahoraChileSQL() } });
      await bitacoraSegura(item, negocio.id, quitar ? 'QUITAR_HABILITACION' : 'HABILITAR_DATO', f.descripcion.slice(0, 200), userId, nombreActor);
      await intentarAutoTransicion(item, negocio.id, userId, nombreActor);
      publicarCambio('checklist_comercial');
      return NextResponse.json({ success: true, ...(await armarEstado(item)) });
    }

    return NextResponse.json({ error: 'Acción desconocida' }, { status: 400 });
  } catch (error) {
    console.error('[comercial][comparador][POST]', String(error));
    return NextResponse.json({ error: String(error instanceof Error ? error.message : error) }, { status: 500 });
  }
}
