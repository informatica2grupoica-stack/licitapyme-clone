// app/api/negocios/[id]/auditor/captura/[capturaId]/route.ts
// Imagen de una captura fechada de un link del AUDITOR (evidencia inmutable, auditor_captura).
import { NextRequest, NextResponse } from 'next/server';
import { contextoAuditor } from '@/app/lib/auditor-acceso';
import { imagenDeCapturaAuditor } from '@/app/lib/auditor-opciones';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; capturaId: string }> }) {
  const c = await contextoAuditor(request, params);
  if (c instanceof NextResponse) return c;
  const { capturaId } = await params;
  const img = await imagenDeCapturaAuditor(c.negocio.id, Number(capturaId));
  if (!img) return NextResponse.json({ error: 'La captura no tiene imagen.' }, { status: 404 });
  return new NextResponse(new Uint8Array(img), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' } });
}
