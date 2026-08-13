// app/api/anexos/separar/route.ts
// POST /api/anexos/separar { codigo, documentoId }
// Paso INDEPENDIENTE del relleno: toma un .docx TAL COMO se bajó de Mercado Público (nunca lo
// modifica) y, si trae varios anexos pegados en un solo archivo (patrón "FORMULARIO N°X" /
// "ANEXO N°X" — ver anexos-dividir.ts), sube un archivo nuevo por cada uno, nombrado por su
// título real. Cada archivo queda en su caja de "Documentos y Bases" según su categoría
// (ANEXOS_ADMINISTRATIVOS/TECNICOS/ECONOMICOS — ver CATEGORIA_POR_CLASIFICACION abajo), NUNCA en
// Documentos Propios (pedido explícito del usuario 13-ago-2026: separar es organizar la
// licitación, no generar un archivo nuestro aparte).
// Sirve para ORGANIZAR anexos antes de rellenar nada — a diferencia de /api/anexos/generar, que
// también divide pero solo como resultado de rellenar el documento combinado completo (ese SÍ
// sube a Documentos Propios: ahí el resultado es el anexo YA LISTO para presentar).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser, puedeVerLicitacion, esAdmin } from '@/app/lib/api-auth';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { cargarDocumentoBase } from '@/app/lib/anexos-datos';
import { abrirDocx, verificarXmlBienFormado } from '@/app/lib/anexos-docx';
import { dividirPorFormularios } from '@/app/lib/anexos-dividir';
import { registrarActividad } from '@/app/lib/actividad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CONTENT_TYPE_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Categoría de "Documentos y Bases" (NUNCA Documentos Propios — pedido explícito del usuario
// 13-ago-2026, así queda visible junto al resto de la licitación, no escondido en la sección de
// lo que nosotros subimos). "sin_clasificar" cae en ANEXOS_OFERENTE, la caja catch-all que ya
// existía para anexos sin separar — no amerita una 4ª caja nueva solo para lo no reconocido.
const CATEGORIA_POR_CLASIFICACION: Record<string, string> = {
  administrativo: 'ANEXOS_ADMINISTRATIVOS',
  tecnico: 'ANEXOS_TECNICOS',
  economico: 'ANEXOS_ECONOMICOS',
  sin_clasificar: 'ANEXOS_OFERENTE',
};

export async function POST(request: NextRequest) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const codigo = body?.codigo;
  const documentoId = body?.documentoId;

  if (!codigo || !documentoId) {
    return NextResponse.json({ error: 'Faltan parámetros: codigo, documentoId' }, { status: 400 });
  }
  if (!(await puedeVerLicitacion(request, codigo))) {
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  }
  // Mismo criterio que /api/anexos/generar (admin-only, pedido explícito jul-2026, ver ese
  // archivo) — separar anexos es parte del mismo flujo, todavía no abierto a otros roles.
  if (!(await esAdmin(request))) {
    return NextResponse.json({ error: 'Separar anexos está disponible solo para administradores por ahora' }, { status: 403 });
  }

  try {
    const { bufferOriginal, nombreOriginal } = await cargarDocumentoBase(codigo, documentoId);
    const { xml } = await abrirDocx(bufferOriginal);
    const formularios = await dividirPorFormularios(bufferOriginal, xml);

    if (formularios.length < 2) {
      return NextResponse.json({
        success: true,
        separado: false,
        archivos: [],
        mensaje: `"${nombreOriginal}" no trae más de un anexo pegado — no hay nada que separar.`,
      });
    }

    // Igual que /api/anexos/generar: valida TODOS los fragmentos antes de subir el primero, para
    // no dejar una subida a medias si uno sale mal formado y otro no.
    for (const f of formularios) {
      const { xml: fxml } = await abrirDocx(f.buffer);
      const chequeo = verificarXmlBienFormado(fxml);
      if (!chequeo.valido) {
        return NextResponse.json(
          { error: `El fragmento "${f.titulo}" quedó mal formado (${chequeo.error}). No se subió nada.` },
          { status: 500 },
        );
      }
    }

    const archivos: { nombre: string; categoria: string; titulo: string; url: string }[] = [];
    for (const f of formularios) {
      const nombre = `${f.nombreArchivo}.docx`;
      const categoriaCaja = CATEGORIA_POR_CLASIFICACION[f.categoria] || 'ANEXOS_OFERENTE';
      const url = await subirDocumentoR2(codigo, nombre, f.buffer, CONTENT_TYPE_DOCX);
      await pool.query(
        `INSERT INTO documentos_cache
           (licitacion_codigo, documento_nombre, documento_url_local, size_bytes, content_type, categoria, categoria_manual, usuario_id)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE
           documento_url_local = VALUES(documento_url_local),
           size_bytes          = VALUES(size_bytes),
           updated_at          = CURRENT_TIMESTAMP`,
        [codigo, nombre, url, f.buffer.length, CONTENT_TYPE_DOCX, categoriaCaja, usuario.id],
      );
      archivos.push({ nombre, categoria: f.categoria, titulo: f.titulo, url });
    }

    registrarActividad({
      usuarioId: usuario.id, accion: 'anexo_separado',
      entidadTipo: 'licitacion', entidadId: codigo,
      descripcion: `Separó "${nombreOriginal}" en ${archivos.length} anexos independientes`,
      metadata: {
        licitacion_codigo: codigo, documento: nombreOriginal,
        archivos: archivos.map(a => ({ nombre: a.nombre, categoria: a.categoria })),
      },
    });

    return NextResponse.json({ success: true, separado: true, archivos });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 400 });
  }
}
