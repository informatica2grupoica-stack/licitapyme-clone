// app/api/documentos/organizar/route.ts
// Mueve un documento PROPIO a una caja manual definida por el usuario (drag & drop en
// "Documentos para MP"). A diferencia de /api/documentos/clasificar (IA, solo para los
// documentos oficiales de la licitación), esto es 100% manual: el usuario elige el
// nombre de la caja y nunca la IA. El WHERE categoria = 'DOCUMENTOS_PROPIOS' impide que
// esto toque documentos de la licitación aunque el front tenga un bug.

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { puedeVerLicitacion } from '@/app/lib/api-auth';

export async function PATCH(req: NextRequest) {
  try {
    const { codigo, documento_nombre, subcategoria } = await req.json();
    if (!codigo || !documento_nombre) {
      return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 });
    }
    if (!(await puedeVerLicitacion(req, String(codigo))))
      return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

    await pool.query(
      `UPDATE documentos_cache SET subcategoria = ?
       WHERE licitacion_codigo = ? AND documento_nombre = ? AND categoria = 'DOCUMENTOS_PROPIOS'`,
      [subcategoria || null, codigo, documento_nombre],
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
