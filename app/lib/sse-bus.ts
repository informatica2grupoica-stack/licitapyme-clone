// Bus de notificaciones en memoria para Server-Sent Events (SSE).
// El servidor del notebook es un solo proceso Node, así que un pub/sub en memoria basta:
// cada usuario conectado tiene 1+ "clientes" (conexiones SSE abiertas); al registrar un
// evento se le empuja al instante. Se guarda en globalThis para sobrevivir al HMR de dev.
type Cliente = (chunk: string) => void;

const g = globalThis as any;
const clientes: Map<number, Set<Cliente>> = g.__sseClientes ?? (g.__sseClientes = new Map());

/** Suscribe una conexión SSE de un usuario. Devuelve la función para desuscribir. */
export function suscribir(userId: number, fn: Cliente): () => void {
  let set = clientes.get(userId);
  if (!set) { set = new Set(); clientes.set(userId, set); }
  set.add(fn);
  return () => {
    const s = clientes.get(userId);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) clientes.delete(userId);
  };
}

/** Empuja un evento (objeto JSON) a todas las conexiones SSE de un usuario. */
export function publicar(userId: number, evento: unknown): void {
  const set = clientes.get(userId);
  if (!set || set.size === 0) return;
  const payload = `event: notificacion\ndata: ${JSON.stringify(evento)}\n\n`;
  for (const fn of set) { try { fn(payload); } catch { /* conexión muerta: se limpia al abort */ } }
}

/**
 * Difunde a TODAS las conexiones abiertas que los datos cambiaron, para que los tableros
 * (dashboard, analítica, postuladas, adjudicadas, análisis) se recarguen al instante.
 *
 * Es distinto de publicar(): eso es la campana de UN usuario. Esto es "algo se movió en el
 * pipeline", y le concierne a cualquiera que esté mirando un tablero — incluido el admin,
 * que antes no se enteraba de nada porque los eventos solo iban al destinatario.
 *
 * El payload es deliberadamente mínimo (solo el tipo de cambio): la conexión SSE es común a
 * todos los roles, así que no puede llevar datos de licitaciones. Cada cliente recarga su
 * propio endpoint, que ya filtra por permisos.
 */
export function publicarCambio(tipo: string): void {
  const payload = `event: cambio\ndata: ${JSON.stringify({ tipo, at: Date.now() })}\n\n`;
  for (const set of clientes.values()) {
    for (const fn of set) { try { fn(payload); } catch { /* conexión muerta: se limpia al abort */ } }
  }
}

export function conexionesDe(userId: number): number {
  return clientes.get(userId)?.size ?? 0;
}
