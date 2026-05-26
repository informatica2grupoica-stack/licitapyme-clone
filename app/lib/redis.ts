// src/lib/redis.ts
import { Redis } from '@upstash/redis';

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export interface DocumentJob {
  id: string;
  licitacionCodigo: string;
  documentoUrl: string;
  documentoNombre: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  resultUrl?: string;
  error?: string;
  createdAt: number;
}

export async function crearJob(job: Omit<DocumentJob, 'id' | 'status' | 'createdAt'>): Promise<string> {
  const id = `${job.licitacionCodigo}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  const fullJob: DocumentJob = {
    ...job,
    id,
    status: 'pending',
    createdAt: Date.now(),
  };

  // Upstash REST client auto-serializes objects — do not JSON.stringify
  await redis.set(`job:${id}`, fullJob as any);
  await redis.lpush('queue:downloads', id);

  console.log(`📝 Job creado: ${id}`);
  return id;
}

export async function obtenerJob(id: string): Promise<DocumentJob | null> {
  const data = await redis.get(`job:${id}`);
  if (!data) return null;
  // Upstash REST client auto-parses JSON — data is already an object
  if (typeof data === 'string') {
    try { return JSON.parse(data); } catch { return null; }
  }
  return data as DocumentJob;
}

export async function actualizarJob(id: string, updates: Partial<DocumentJob>): Promise<void> {
  const job = await obtenerJob(id);
  if (job) {
    const updated = { ...job, ...updates };
    await redis.set(`job:${id}`, updated as any);
  }
}