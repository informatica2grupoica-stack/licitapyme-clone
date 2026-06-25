// app/api/historial/stream/route.ts
// SSE: mantiene una conexión abierta y empuja al usuario sus notificaciones en tiempo real.
// Auth por cookie (EventSource envía cookies same-origin). Corre en el notebook (Node), NO Vercel.
import { NextRequest } from 'next/server';
import { getAuthedUser } from '@/app/lib/api-auth';
import { suscribir } from '@/app/lib/sse-bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(req: NextRequest) {
  const usuario = await getAuthedUser(req);
  if (!usuario) return new Response('No autenticado', { status: 401 });

  const encoder = new TextEncoder();
  let unsub: () => void = () => {};
  let ping: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (s: string) => { try { controller.enqueue(encoder.encode(s)); } catch { /* cerrado */ } };

      // Reintento del cliente a 5s + evento inicial de conexión.
      send('retry: 5000\n\n');
      send(`event: conectado\ndata: ${JSON.stringify({ ok: true })}\n\n`);

      // Suscribir este usuario al bus (recibe los eventos que registrarEvento publique).
      unsub = suscribir(usuario.id, send);

      // Ping cada 25s para que proxies (Cloudflare) no corten la conexión por inactividad.
      ping = setInterval(() => send(': ping\n\n'), 25_000);

      // Cierre limpio cuando el cliente se desconecta.
      req.signal.addEventListener('abort', () => {
        if (ping) clearInterval(ping);
        unsub();
        try { controller.close(); } catch { /* ya cerrado */ }
      });
    },
    cancel() {
      if (ping) clearInterval(ping);
      unsub();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // evita buffering en proxies
    },
  });
}
