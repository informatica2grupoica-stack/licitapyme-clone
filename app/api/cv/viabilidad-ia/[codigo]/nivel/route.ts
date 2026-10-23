// app/api/cv/viabilidad-ia/[codigo]/nivel/route.ts — confirmación de datos dudosos (recalcula el nivel). Etapa posterior: aún no disponible para clientes.
import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ error: 'Confirmar datos dudosos estará disponible pronto para tu empresa.' }, { status: 501 });
}
