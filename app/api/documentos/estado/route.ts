// src/app/api/documentos/estado/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { obtenerJob } from '@/app/lib/redis';

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ error: 'jobId requerido' }, { status: 400 });
  }

  try {
    const job = await obtenerJob(jobId);

    if (!job) {
      return NextResponse.json({ status: 'not_found' }, { status: 404 });
    }

    return NextResponse.json({
      status: job.status,
      url: job.resultUrl,
      error: job.error,
    });
  } catch (error) {
    return NextResponse.json({ status: 'error', error: String(error) }, { status: 500 });
  }
}