// app/api/negocios/[id]/comercial/documento-todas/route.ts
// AUDITOR TÉCNICO — UN solo PDF con las especificaciones de TODOS los ítems (pedido del usuario, 29-sep-2026).
//
//   POST { documento: { url, nombre } }
//     1. Lee el documento UNA vez (texto/OCR).
//     2. Lo parte por producto (segmentarPorItems) — si no encuentra estructura por ítem, NO inventa cortes: avisa.
//     3. Empareja cada bloque con su línea técnica POR NOMBRE (mapearBloquesALineas, umbral de parecido).
//     4. Cada línea emparejada se compara SOLO contra su propio bloque (mismo L2 del comparador, mismos guardarraíles).
//     Las líneas sin bloque quedan intactas y se listan; los bloques sin línea también se listan.
//
// Por qué no manda el documento completo a cada línea: produce falsos "0 de N cumple" (ver auditor-segmentacion.ts).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { publicarCambio } from '@/app/lib/sse-bus';
import { puedeVerNegocioAsignado } from '@/app/lib/api-auth';
import { yaCongelado } from '@/app/lib/congelamiento';
import { descargarYExtraerTexto } from '@/app/lib/document-extraction';
import { agregarDocumentos } from '@/app/lib/checklist-comercial-db';
import { cargarNegocio, leerInforme, nombreDe } from '../route';
import { cargarItemLineaTecnica, filasDelComparador, intentarAutoTransicion, migracion127Aplicada } from '../[itemId]/caracteristicas/route';
import { compararRequisitos } from '@/app/lib/auditor-comparador';
import { procesarItemComparador, type FilaComparador } from '@/app/lib/auditor-comparador-core';
import { segmentarPorItems, mapearBloquesALineas } from '@/app/lib/auditor-segmentacion';
import { paginasDelTexto, segmentarConIA } from '@/app/lib/auditor-segmentacion-ia';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

const CONCURRENCIA = 3;

function foroDelInforme(informe: any): string | null {
  const f = informe?.foro ?? informe?.foro_qa ?? informe?.aclaraciones ?? null;
  if (!f) return null;
  const txt = typeof f === 'string' ? f : JSON.stringify(f);
  return txt.length > 20 ? txt.slice(0, 8000) : null;
}

export async function POST(request: NextRequest, { params }: Params) {
  const idH = request.headers.get('x-user-id');
  const userId = idH ? parseInt(idH) : null;
  const rol = request.headers.get('x-user-rol');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
    if (!(await migracion127Aplicada()))
      return NextResponse.json({ error: 'Falta aplicar la migración 127 (node scripts/aplicar-migration-127.mjs).' }, { status: 409 });
    if (await yaCongelado(negocio.id, rol))
      return NextResponse.json({ error: 'Este negocio ya se postuló: el Auditor Técnico quedó congelado, de solo lectura.' }, { status: 409 });
    if (!process.env.KIMI_API_KEY)
      return NextResponse.json({ error: 'Kimi K3 no está configurado en este servidor (falta KIMI_API_KEY).' }, { status: 503 });

    const body = await request.json().catch(() => ({}));
    const url = String(body?.documento?.url || '');
    const nombre = String(body?.documento?.nombre || 'especificaciones técnicas');
    const forzar = body?.forzar === true;
    if (!url) return NextResponse.json({ error: 'Falta el documento.' }, { status: 400 });
    const nombreActor = request.headers.get('x-user-nombre') || (await nombreDe(userId)) || 'Usuario';

    const extraido = await descargarYExtraerTexto(url, nombre).catch(() => null);
    if (!extraido?.texto || extraido.texto.trim().length < 30)
      return NextResponse.json({ error: `No se pudo leer texto de "${nombre}". Si es un escaneo, súbelo de nuevo o revisa que no esté vacío.` }, { status: 422 });

    const [lrows] = await pool.query(
      `SELECT id, linea_numero, titulo, ofertamos FROM checklist_comercial WHERE negocio_id = ? AND tipo = 'linea_tecnica' ORDER BY linea_numero, id`,
      [negocio.id]) as any;
    const lineas = (lrows as any[]).filter(l => l.linea_numero != null && l.ofertamos !== 0 && l.ofertamos !== false);
    if (!lineas.length) return NextResponse.json({ error: 'Este negocio no tiene líneas técnicas para comparar.' }, { status: 400 });
    const aMapear = lineas.map(l => ({ linea: Number(l.linea_numero), nombre: String(l.titulo || '') }));

    // 1) Estructura explícita (ÍTEM N / tabla numerada) + emparejo por nombre. 2) Si no hay, la IA agrupa páginas por producto.
    let bloques = segmentarPorItems(extraido.texto);
    let mapeo = bloques.length >= 2 ? mapearBloquesALineas(aMapear, bloques) : null;
    let metodo: 'encabezados' | 'ia' = 'encabezados';
    if (!mapeo) {
      const paginas = paginasDelTexto(extraido.texto);
      if (paginas.length) {
        const ia = await segmentarConIA(paginas, aMapear).catch(() => null);
        if (ia && ia.bloques.length) {
          bloques = ia.bloques; metodo = 'ia';
          const usados = new Set(ia.porLinea.values());
          mapeo = { porLinea: ia.porLinea, sobrantes: ia.bloques.filter(b => !usados.has(b)) };
        }
      }
    }
    if (!mapeo)
      return NextResponse.json({
        error: 'No pude separar el documento por ítem/producto (no encontré encabezados tipo "ÍTEM 1: …" ni pude agrupar sus páginas por producto). Para no cruzar productos, no comparé nada: arrastra el documento directo a la fila de su línea.',
      }, { status: 422 });

    const informe = await leerInforme(negocio.licitacion_codigo).catch(() => null);
    const foro = foroDelInforme(informe);

    type Resultado = { linea: number; titulo: string; bloque: string; requisitos: number; comparados: number; cumple: number; noCumple: number; otros: number; aviso?: string };
    const resultados: Resultado[] = [];
    const emparejadas = lineas.filter(l => mapeo!.porLinea.has(Number(l.linea_numero)));

    const compararLinea = async (l: any) => {
      const bloque = mapeo!.porLinea.get(Number(l.linea_numero))!;
      const item = await cargarItemLineaTecnica(negocio.id, Number(l.id));
      const base: Resultado = { linea: Number(l.linea_numero), titulo: String(l.titulo || ''), bloque: bloque.titulo, requisitos: 0, comparados: 0, cumple: 0, noCumple: 0, otros: 0 };
      if (!item) { resultados.push({ ...base, aviso: 'La línea no se pudo cargar.' }); return; }
      const filas = await filasDelComparador(item);
      const tecnicas = filas.filter(f => f.analisis.ambito === 'tecnico' && !f.respuesta_manual);
      // Al repetir la subida solo se comparan los requisitos que aún no se compararon (un timeout de la IA no obliga a rehacer todo).
      const aComparar = forzar ? tecnicas : tecnicas.filter(f => !f.analisis.origen_dato);
      base.requisitos = tecnicas.length;
      if (tecnicas.length && !aComparar.length) { resultados.push({ ...base, aviso: 'Ya estaba comparada (usa "forzar" para rehacerla).' }); return; }
      if (!filas.length) { resultados.push({ ...base, aviso: 'La línea aún no está validada (sin características clasificadas).' }); return; }
      if (!aComparar.length) { resultados.push({ ...base, aviso: 'No hay requisitos técnicos por comparar (contestados a mano o son compromisos).' }); return; }

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
      let sinRespuesta = 0;
      await Promise.all(Array.from(grupos.values()).map(async filasGrupo => {
        const pedir = () => compararRequisitos({
          licitacionCodigo: negocio.licitacion_codigo, lineaNumero: item.linea_numero, lineaNombre: item.titulo,
          filas: filasGrupo,
          fichas: [{ archivo: nombre, modelo: '', emisor: 'desconocido', formalidad: 'formal', texto: bloque.texto }],
          foro,
        });
        // La IA a veces se pasa del tiempo (Kimi razona): un reintento resuelve la mayoría de los casos.
        let respuesta: Awaited<ReturnType<typeof compararRequisitos>>;
        try { respuesta = await pedir(); } catch { respuesta = await pedir(); }
        const { items, textoEnviado } = respuesta;
        for (const f of filasGrupo) {
          const crudo = items.get(f.id);
          if (!crudo) { sinRespuesta++; continue; }
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
          base.comparados++;
          if (r.columnas.veredicto === 'CUMPLE') base.cumple++;
          else if (r.columnas.veredicto === 'NO_CUMPLE') base.noCumple++;
          else base.otros++;
        }
      }));
      if (sinRespuesta) base.aviso = `La IA no respondió ${sinRespuesta} requisito(s): quedaron sin tocar.`;
      await agregarDocumentos(item.id, negocio.id, [{ url, nombre }], userId, nombreActor);
      await intentarAutoTransicion(item, negocio.id, userId, nombreActor);
      resultados.push(base);
    };

    // Lotes de CONCURRENCIA líneas a la vez: cada línea ya lanza sus propias llamadas en paralelo.
    for (let i = 0; i < emparejadas.length; i += CONCURRENCIA) {
      await Promise.all(emparejadas.slice(i, i + CONCURRENCIA).map(l => compararLinea(l).catch(e => {
        console.error('[comercial][documento-todas] línea', l.linea_numero, String(e));
        resultados.push({ linea: Number(l.linea_numero), titulo: String(l.titulo || ''), bloque: mapeo!.porLinea.get(Number(l.linea_numero))?.titulo || '', requisitos: 0, comparados: 0, cumple: 0, noCumple: 0, otros: 0, aviso: `Falló la comparación de esta línea (${String(e).slice(0, 120)}). Vuelve a subir el PDF: solo repetirá esta.` });
      })));
    }
    publicarCambio('checklist_comercial');

    return NextResponse.json({
      success: true,
      documento: nombre,
      metodo,
      bloquesEnDocumento: bloques.length,
      resultados: resultados.sort((a, b) => a.linea - b.linea),
      lineasSinBloque: lineas.filter(l => !mapeo!.porLinea.has(Number(l.linea_numero))).map(l => ({ linea: Number(l.linea_numero), titulo: String(l.titulo || '') })),
      bloquesSinLinea: mapeo!.sobrantes.map(b => ({ numero: b.numero, titulo: b.titulo })),
    });
  } catch (error) {
    console.error('[comercial][documento-todas]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
