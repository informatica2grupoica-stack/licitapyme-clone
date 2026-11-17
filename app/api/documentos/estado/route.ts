// src/app/api/documentos/estado/route.ts
import { mensajeSeguro } from '@/app/lib/errores-api';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerJob } from '@/app/lib/redis';
import { clienteIdOrNull } from '@/app/lib/api-auth';

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ error: 'jobId requerido' }, { status: 400 });
  }

  try {
    const job = await obtenerJob(jobId);

    // SEC-003: el job solo se entrega a la empresa que lo pidió (jobs viejos sin clienteId: se entregan, expiran solos).
    const clienteId = await clienteIdOrNull(request);
    if (job && job.clienteId !== undefined && job.clienteId !== clienteId) {
      return NextResponse.json({ status: 'not_found' }, { status: 404 });
    }

    if (!job) {
      return NextResponse.json({ status: 'not_found' }, { status: 404 });
    }

    return NextResponse.json({
      status: job.status,
      url: job.resultUrl,
      error: job.error,
    });
  } catch (error) {
    return NextResponse.json({ status: 'error', error: mensajeSeguro(error, 'No se pudo completar la operación.') }, { status: 500 });
  }
}